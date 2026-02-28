"use strict";

const DEFAULT_DELAY_MS = 4000;
const DEFAULT_THRESHOLD = Object.freeze({
  maxFailureRate: 0.2,
  maxTimeoutRate: 0.1,
  maxAttempt3Rate: 0.3,
  minStructuredRate: 0.6,
  maxP95Ms: 15000,
});
const UNKNOWN_SOURCE_SUFFIX = "(unknown_source)";

const BASELINE_METRICS = Object.freeze({
  p50ElapsedMs: 30815,
  p95ElapsedMs: 45849,
  structuredRate: 0.5,
  attempt3Rate: 0.4,
  mode: Object.freeze({
    briefing: Object.freeze({ repairRate: 1.0, textFallbackRate: 0 }),
    diagnosis: Object.freeze({ repairRate: 0, textFallbackRate: 2 / 3 }),
    "action-plan": Object.freeze({ repairRate: 0, textFallbackRate: 1.0 }),
  }),
});

const TEST_CASES = Object.freeze([
  { mode: "briefing", type: "short", message: "请给我一段本月简报。" },
  { mode: "briefing", type: "short", message: "总结Q1达成情况。" },
  { mode: "briefing", type: "short", message: "列出主要风险点。" },
  {
    mode: "briefing",
    type: "medium",
    message: "请用简报模式总结近期销售表现，并给出下周可执行的2条动作建议。",
  },
  {
    mode: "diagnosis",
    type: "medium",
    message: "请诊断Q1未达成的关键原因，按影响度排序，并说明你最有把握的两个证据。",
  },
  {
    mode: "diagnosis",
    type: "medium",
    message: "请诊断最近两个月的波动来源，指出是结构性问题还是短期因素，并给出验证方法。",
  },
  {
    mode: "diagnosis",
    type: "medium",
    message: "请从产品和医院两个维度诊断增长瓶颈，并指出最需要优先干预的对象。",
  },
  {
    mode: "action-plan",
    type: "medium",
    message: "请输出下周行动计划：包含负责人、时间点、追踪指标，要求可执行。",
  },
  {
    mode: "action-plan",
    type: "long",
    message:
      "请基于当前区间数据制定一个四周行动计划：先给总体目标，再拆到产品与医院两个维度，每条动作都要包含负责人、里程碑、成功判定指标，并补充潜在风险及应对方案。",
  },
  {
    mode: "action-plan",
    type: "long",
    message:
      "请把下季度销售改善策略细化成执行清单，要求覆盖周节奏、重点客户推进、资源协调、阶段复盘机制，并明确每条动作的量化验收口径与优先级。",
  },
]);

function printHelp() {
  console.log(
    [
      "用法:",
      "  node scripts/chat-stability-check.js --endpoint <https://xxx.pages.dev/api/chat> --token <SUPABASE_ACCESS_TOKEN>",
      "",
      "参数:",
      "  --endpoint   聊天接口完整地址（也可用 CHAT_API_ENDPOINT）",
      "  --token      Supabase access token（也可用 CHAT_AUTH_TOKEN）",
      "  --delayMs    每次请求间隔毫秒，默认 4000",
      "  --stream     true/false，默认 false",
      "  --help       显示帮助",
      "",
      "示例:",
      "  CHAT_API_ENDPOINT=https://<domain>/api/chat CHAT_AUTH_TOKEN=<token> npm run check:chat-stability",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function toInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const safe = Math.floor(parsed);
  return safe >= 0 ? safe : fallback;
}

function toBool(value, fallback = false) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function sleep(ms) {
  const safeMs = toInt(ms, 0);
  if (safeMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, safeMs);
  });
}

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatusCodeList(rawStatuses) {
  if (!Array.isArray(rawStatuses)) {
    return [];
  }
  return rawStatuses
    .map((status) => Number(status))
    .filter((status) => Number.isFinite(status) && status > 0)
    .map((status) => Math.floor(status));
}

function classifyWaitFeeling(durationMs) {
  const safe = toInt(durationMs, 0);
  if (safe <= 3000) return "快";
  if (safe <= 10000) return "中";
  return "慢";
}

function sanitizeHistory(history, maxItems = 8, maxChars = 2000) {
  if (!Array.isArray(history)) {
    return [];
  }

  const normalized = history
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const role = trim(item.role).toLowerCase();
      if (role !== "user" && role !== "assistant") return null;
      const content = trim(item.content);
      if (!content) return null;
      return { role, content };
    })
    .filter((item) => item !== null);

  const limitedByItems = normalized.length > maxItems ? normalized.slice(normalized.length - maxItems) : normalized;
  let chars = 0;
  const collected = [];
  for (let index = limitedByItems.length - 1; index >= 0; index -= 1) {
    const item = limitedByItems[index];
    const nextChars = chars + item.content.length;
    if (nextChars > maxChars && collected.length > 0) break;
    chars = Math.min(nextChars, maxChars);
    collected.unshift(item);
    if (chars >= maxChars) break;
  }
  return collected;
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function normalizeAttemptDiagnostics(rawDiagnostics) {
  if (!Array.isArray(rawDiagnostics)) {
    return [];
  }
  return rawDiagnostics
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const stageCandidate = trim(item.stage);
      const stage = stageCandidate === "retry" || stageCandidate === "repair" ? stageCandidate : "first";
      const formatReason = trim(item.formatReason) || "unknown_reason";
      const qualityIssues = Array.isArray(item.qualityIssues)
        ? item.qualityIssues.map((issue) => trim(issue)).filter((issue) => issue)
        : [];
      return { stage, formatReason, qualityIssues };
    })
    .filter((item) => item !== null);
}

function normalizeResult(index, testCase, response, payload, durationMs) {
  const requestId = trim(response.headers.get("x-request-id")) || trim(payload?.requestId);
  const error = payload && typeof payload.error === "object" ? payload.error : null;
  const meta = payload && typeof payload.meta === "object" ? payload.meta : null;

  const code = trim(error?.code);
  const stage = trim(error?.stage);
  const upstreamStatusRaw = Number(error?.upstreamStatus);
  const upstreamStatus =
    Number.isFinite(upstreamStatusRaw) && upstreamStatusRaw > 0 ? Math.floor(upstreamStatusRaw) : null;
  const durationRaw = Number(error?.durationMs);
  const upstreamDuration = Number.isFinite(durationRaw) && durationRaw >= 0 ? Math.floor(durationRaw) : null;

  const format = trim(payload?.format) || "-";
  const attemptCountRaw = Number(meta?.attemptCount);
  const attemptCount = Number.isFinite(attemptCountRaw) && attemptCountRaw > 0 ? Math.floor(attemptCountRaw) : null;
  const repairApplied = typeof meta?.repairApplied === "boolean" ? meta.repairApplied : null;
  const finalStage = trim(meta?.finalStage);
  const metaFormatReason = trim(meta?.formatReason) || "-";
  const attemptDiagnostics = normalizeAttemptDiagnostics(meta?.attemptDiagnostics);
  const totalDurationRaw = Number(meta?.totalDurationMs);
  const totalDurationMs =
    Number.isFinite(totalDurationRaw) && totalDurationRaw >= 0 ? Math.floor(totalDurationRaw) : toInt(durationMs, 0);
  const elapsedMs = toInt(durationMs, 0);
  const firstTransportAttemptsRaw = Number(meta?.firstTransportAttempts ?? error?.firstTransportAttempts);
  const firstTransportAttempts =
    Number.isFinite(firstTransportAttemptsRaw) && firstTransportAttemptsRaw > 0
      ? Math.floor(firstTransportAttemptsRaw)
      : null;
  const firstTransportRetryApplied =
    typeof meta?.firstTransportRetryApplied === "boolean"
      ? meta.firstTransportRetryApplied
      : typeof error?.firstTransportRetryApplied === "boolean"
        ? error.firstTransportRetryApplied
        : null;
  const firstTransportRetryRecovered =
    typeof meta?.firstTransportRetryRecovered === "boolean" ? meta.firstTransportRetryRecovered : null;
  const firstTransportStatuses = normalizeStatusCodeList(meta?.firstTransportStatuses);
  const firstTransportStatusesFromError =
    firstTransportStatuses.length > 0 ? firstTransportStatuses : normalizeStatusCodeList(error?.firstTransportStatuses);
  const mergedStatuses = [...firstTransportStatusesFromError];
  if (upstreamStatus === 503 && !mergedStatuses.includes(503)) {
    mergedStatuses.push(503);
  }
  const hasUpstream503 = mergedStatuses.includes(503);

  return {
    row: index + 1,
    mode: testCase.mode,
    questionType: testCase.type,
    http: response.status,
    errorCode: code || "-",
    stage: stage || "-",
    upstreamStatus: upstreamStatus === null ? "-" : String(upstreamStatus),
    durationMs: upstreamDuration === null ? "-" : String(upstreamDuration),
    format: format || "-",
    attemptCount: attemptCount === null ? "-" : String(attemptCount),
    repairApplied:
      repairApplied === null
        ? "-"
        : repairApplied
          ? "true"
          : "false",
    requestId: requestId || "-",
    waitFeeling: classifyWaitFeeling(durationMs),
    elapsedMs,
    totalDurationMs,
    finalStage: finalStage || "-",
    metaFormatReason,
    attemptDiagnostics,
    firstTransportAttempts: firstTransportAttempts === null ? "-" : String(firstTransportAttempts),
    firstTransportRetryApplied:
      firstTransportRetryApplied === null
        ? "-"
        : firstTransportRetryApplied
          ? "true"
          : "false",
    firstTransportRetryRecovered:
      firstTransportRetryRecovered === null
        ? "-"
        : firstTransportRetryRecovered
          ? "true"
          : "false",
    firstTransportStatuses: mergedStatuses,
    hasUpstream503,
    isFailure: response.status >= 400 || Boolean(code),
  };
}

function getFallbackReasonByStage(row, stage) {
  const formatReason = trim(row?.metaFormatReason);
  if (!formatReason || formatReason === "-") {
    return "";
  }
  const finalStage = trim(row?.finalStage);
  if (stage === "first" && finalStage === "first") {
    return `${formatReason} ${UNKNOWN_SOURCE_SUFFIX}`;
  }
  if (stage === "retry" && (finalStage === "retry" || finalStage === "repair")) {
    return `${formatReason} ${UNKNOWN_SOURCE_SUFFIX}`;
  }
  return "";
}

function collectStageReasons(rows, stage) {
  const normalizedStage = stage === "retry" ? "retry" : "first";
  const reasonCount = new Map();
  let sampleCount = 0;
  for (const row of rows) {
    const fromDiagnostics = Array.isArray(row?.attemptDiagnostics)
      ? row.attemptDiagnostics
          .filter((item) => item && item.stage === normalizedStage)
          .map((item) => trim(item.formatReason))
          .filter((reason) => reason)
      : [];
    let reasons = fromDiagnostics;
    if (reasons.length === 0) {
      const fallback = getFallbackReasonByStage(row, normalizedStage);
      reasons = fallback ? [fallback] : [];
    }
    if (reasons.length === 0) {
      continue;
    }
    sampleCount += 1;
    for (const reason of reasons) {
      reasonCount.set(reason, (reasonCount.get(reason) || 0) + 1);
    }
  }

  const entries = Array.from(reasonCount.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.reason.localeCompare(b.reason, "zh-CN");
    });

  return {
    stage: normalizedStage,
    sampleCount,
    entries,
  };
}

function buildAttemptReasonStats(results) {
  const safeResults = Array.isArray(results) ? results : [];
  const grouped = new Map();
  for (const row of safeResults) {
    const mode = row?.mode || "unknown";
    if (!grouped.has(mode)) {
      grouped.set(mode, []);
    }
    grouped.get(mode).push(row);
  }
  return {
    overall: {
      first: collectStageReasons(safeResults, "first"),
      retry: collectStageReasons(safeResults, "retry"),
    },
    byMode: Array.from(grouped.entries()).map(([mode, rows]) => ({
      mode,
      total: rows.length,
      first: collectStageReasons(rows, "first"),
      retry: collectStageReasons(rows, "retry"),
    })),
  };
}

function collectSchemaInvalidIssueStats(rows, stage) {
  const normalizedStage = stage === "retry" ? "retry" : "first";
  const issueCount = new Map();
  let sampleCount = 0;
  for (const row of rows) {
    const diagnostics = Array.isArray(row?.attemptDiagnostics) ? row.attemptDiagnostics : [];
    const related = diagnostics.filter(
      (item) => item && item.stage === normalizedStage && item.formatReason === "schema_invalid",
    );
    if (related.length === 0) {
      continue;
    }
    sampleCount += related.length;
    for (const item of related) {
      const issues = Array.isArray(item.qualityIssues) ? item.qualityIssues : [];
      if (issues.length === 0) {
        issueCount.set("unknown_issue", (issueCount.get("unknown_issue") || 0) + 1);
        continue;
      }
      for (const issue of issues) {
        issueCount.set(issue, (issueCount.get(issue) || 0) + 1);
      }
    }
  }

  const entries = Array.from(issueCount.entries())
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.issue.localeCompare(b.issue, "zh-CN");
    });
  return {
    stage: normalizedStage,
    sampleCount,
    entries,
  };
}

function buildSchemaInvalidIssueStats(results) {
  const safeResults = Array.isArray(results) ? results : [];
  const grouped = new Map();
  for (const row of safeResults) {
    const mode = row?.mode || "unknown";
    if (!grouped.has(mode)) {
      grouped.set(mode, []);
    }
    grouped.get(mode).push(row);
  }
  return {
    overall: {
      first: collectSchemaInvalidIssueStats(safeResults, "first"),
      retry: collectSchemaInvalidIssueStats(safeResults, "retry"),
    },
    byMode: Array.from(grouped.entries()).map(([mode, rows]) => ({
      mode,
      total: rows.length,
      first: collectSchemaInvalidIssueStats(rows, "first"),
      retry: collectSchemaInvalidIssueStats(rows, "retry"),
    })),
  };
}

function printTopReasonsTable(title, stageStats, totalRows, topN = 5) {
  console.log(title);
  console.log("| stage | reason | count | rate |");
  console.log("|-------|--------|-------|------|");
  const safeTotalRows = Number.isFinite(Number(totalRows)) && Number(totalRows) > 0 ? Math.floor(Number(totalRows)) : 1;
  const firstRows = stageStats.first.entries.slice(0, topN);
  const retryRows = stageStats.retry.entries.slice(0, topN);
  if (firstRows.length === 0 && retryRows.length === 0) {
    console.log("| - | - | 0 | 0.0% |");
    return;
  }
  for (const item of firstRows) {
    console.log(`| first | ${item.reason} | ${item.count} | ${toPercent(item.count / safeTotalRows)} |`);
  }
  for (const item of retryRows) {
    console.log(`| retry | ${item.reason} | ${item.count} | ${toPercent(item.count / safeTotalRows)} |`);
  }
}

function printAttemptReasonStats(results) {
  const stats = buildAttemptReasonStats(results);
  console.log("\n=== attemptDiagnostics.formatReason 分布（overall）===");
  printTopReasonsTable("overall top reasons", stats.overall, results.length);
  console.log("\n=== attemptDiagnostics.formatReason 分布（by mode）===");
  for (const item of stats.byMode) {
    printTopReasonsTable(`mode=${item.mode}`, item, item.total);
  }
  return stats;
}

function getStageReasonCount(stageStats, reason) {
  if (!stageStats || !Array.isArray(stageStats.entries)) {
    return 0;
  }
  const found = stageStats.entries.find((item) => item && item.reason === reason);
  return found ? found.count : 0;
}

function printFirstHitQualityStats(reasonStats, totalRows = 0) {
  const safeTotalRows =
    Number.isFinite(Number(totalRows)) && Number(totalRows) > 0 ? Math.floor(Number(totalRows)) : 1;
  const overallFirstStats = reasonStats?.overall?.first || { entries: [] };
  const overallStructuredOkCount = getStageReasonCount(overallFirstStats, "structured_ok");
  const overallOutputTruncatedCount = getStageReasonCount(overallFirstStats, "output_truncated");
  console.log("\n=== 首轮命中质量（overall）===");
  console.log("| first structured_ok 占比 | first output_truncated 占比 |");
  console.log("|--------------------------|-----------------------------|");
  console.log(
    `| ${toPercent(overallStructuredOkCount / safeTotalRows)} | ${toPercent(overallOutputTruncatedCount / safeTotalRows)} |`,
  );

  const byMode = Array.isArray(reasonStats?.byMode) ? reasonStats.byMode : [];
  console.log("\n=== 首轮命中质量（by mode）===");
  console.log("| mode | 样本数 | first structured_ok 占比 | first output_truncated 占比 |");
  console.log("|------|--------|--------------------------|-----------------------------|");
  const modeRows = byMode.map((item) => {
    const total = Number.isFinite(Number(item?.total)) && Number(item.total) > 0 ? Math.floor(Number(item.total)) : 1;
    const firstStats = item?.first || { entries: [] };
    const structuredOkCount = getStageReasonCount(firstStats, "structured_ok");
    const outputTruncatedCount = getStageReasonCount(firstStats, "output_truncated");
    console.log(
      `| ${item.mode} | ${total} | ${toPercent(structuredOkCount / total)} | ${toPercent(outputTruncatedCount / total)} |`,
    );
    return {
      mode: item.mode,
      total,
      firstStructuredOkRate: structuredOkCount / total,
      firstOutputTruncatedRate: outputTruncatedCount / total,
    };
  });

  return {
    overall: {
      firstStructuredOkRate: overallStructuredOkCount / safeTotalRows,
      firstOutputTruncatedRate: overallOutputTruncatedCount / safeTotalRows,
    },
    byMode: modeRows,
  };
}

function printSchemaInvalidIssueTable(title, stageStats, totalRows, topN = 5) {
  console.log(title);
  console.log("| stage | issue | count | rate |");
  console.log("|-------|-------|-------|------|");
  const safeTotalRows = Number.isFinite(Number(totalRows)) && Number(totalRows) > 0 ? Math.floor(Number(totalRows)) : 1;
  const firstRows = stageStats.first.entries.slice(0, topN);
  const retryRows = stageStats.retry.entries.slice(0, topN);
  if (firstRows.length === 0 && retryRows.length === 0) {
    console.log("| - | - | 0 | 0.0% |");
    return;
  }
  for (const item of firstRows) {
    console.log(`| first | ${item.issue} | ${item.count} | ${toPercent(item.count / safeTotalRows)} |`);
  }
  for (const item of retryRows) {
    console.log(`| retry | ${item.issue} | ${item.count} | ${toPercent(item.count / safeTotalRows)} |`);
  }
}

function printSchemaInvalidIssueStats(results) {
  const stats = buildSchemaInvalidIssueStats(results);
  console.log("\n=== schema_invalid 失败项分布（overall）===");
  printSchemaInvalidIssueTable("overall schema_invalid issues", stats.overall, results.length);
  console.log("\n=== schema_invalid 失败项分布（by mode）===");
  for (const item of stats.byMode) {
    printSchemaInvalidIssueTable(`mode=${item.mode}`, item, item.total);
  }
  return stats;
}

function pickTopReason(stageStats) {
  if (!stageStats || !Array.isArray(stageStats.entries) || stageStats.entries.length === 0) {
    return "-";
  }
  const first = stageStats.entries[0];
  return `${first.reason} (${first.count})`;
}

function printFocusMetrics(summary, modeStats, reasonStats, firstTransportStats, firstHitQualityStats) {
  console.log("\n=== 重点指标 ===");
  console.log(`- structured 占比: ${toPercent(summary.metrics.structuredRate)}`);
  console.log(`- finalStage=first 占比: ${toPercent(summary.metrics.finalStageFirstRate)}`);
  console.log("- text_fallback by mode:");
  for (const item of modeStats) {
    console.log(`  - ${item.mode}: ${toPercent(item.textFallbackRate)}`);
  }
  if (firstTransportStats && typeof firstTransportStats === "object") {
    console.log(`- firstTransportRetryApplied 占比: ${toPercent(firstTransportStats.overall.appliedRate)}`);
    console.log(`- firstTransportRetryRecovered 占比: ${toPercent(firstTransportStats.overall.recoveredRate)}`);
    console.log(`- upstreamStatus=503 占比: ${toPercent(firstTransportStats.overall.upstream503Rate)}`);
  }
  if (firstHitQualityStats && typeof firstHitQualityStats === "object") {
    console.log(`- first structured_ok 占比: ${toPercent(firstHitQualityStats.overall.firstStructuredOkRate)}`);
    console.log(`- first output_truncated 占比: ${toPercent(firstHitQualityStats.overall.firstOutputTruncatedRate)}`);
  }
  console.log(`- first top formatReason: ${pickTopReason(reasonStats?.overall?.first)}`);
  console.log(`- retry top formatReason: ${pickTopReason(reasonStats?.overall?.retry)}`);
}

function toPercent(value) {
  const safe = Number(value);
  if (!Number.isFinite(safe)) return "0.0%";
  return `${(safe * 100).toFixed(1)}%`;
}

function calcPercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const safePercentile = Math.max(0, Math.min(100, Number(percentile)));
  const sorted = values
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil((safePercentile / 100) * sorted.length) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, rank));
  return Math.floor(sorted[index]);
}

function buildModeStats(results) {
  const grouped = new Map();
  for (const row of results) {
    const mode = row.mode || "unknown";
    if (!grouped.has(mode)) {
      grouped.set(mode, []);
    }
    grouped.get(mode).push(row);
  }

  return Array.from(grouped.entries()).map(([mode, rows]) => {
    const total = rows.length || 1;
    const attempt3Count = rows.filter((row) => row.attemptCount === "3").length;
    const textFallbackCount = rows.filter((row) => row.format === "text_fallback").length;
    const finalStageFirstCount = rows.filter((row) => row.finalStage === "first").length;
    const finalStageRetryCount = rows.filter((row) => row.finalStage === "retry").length;
    const finalStageRepairCount = rows.filter((row) => row.finalStage === "repair").length;
    const elapsedValues = rows.map((row) => Number(row.elapsedMs)).filter((value) => Number.isFinite(value) && value >= 0);
    const p95 = calcPercentile(elapsedValues, 95);
    const firstTransportRetryAppliedCount = rows.filter((row) => row.firstTransportRetryApplied === "true").length;
    const firstTransportRetryRecoveredCount = rows.filter((row) => row.firstTransportRetryRecovered === "true").length;
    const upstream503Count = rows.filter((row) => Boolean(row.hasUpstream503)).length;
    return {
      mode,
      total,
      attempt3Rate: attempt3Count / total,
      textFallbackRate: textFallbackCount / total,
      finalStageFirstRate: finalStageFirstCount / total,
      finalStageRetryRate: finalStageRetryCount / total,
      finalStageRepairRate: finalStageRepairCount / total,
      firstTransportRetryAppliedRate: firstTransportRetryAppliedCount / total,
      firstTransportRetryRecoveredRate: firstTransportRetryRecoveredCount / total,
      upstream503Rate: upstream503Count / total,
      p95ElapsedMs: p95,
    };
  });
}

function buildFirstTransportStats(results) {
  const total = results.length || 1;
  const overallAppliedCount = results.filter((row) => row.firstTransportRetryApplied === "true").length;
  const overallRecoveredCount = results.filter((row) => row.firstTransportRetryRecovered === "true").length;
  const overallUpstream503Count = results.filter((row) => Boolean(row.hasUpstream503)).length;
  const modeStats = buildModeStats(results).map((item) => ({
    mode: item.mode,
    total: item.total,
    appliedRate: item.firstTransportRetryAppliedRate,
    recoveredRate: item.firstTransportRetryRecoveredRate,
    upstream503Rate: item.upstream503Rate,
  }));
  return {
    overall: {
      total,
      appliedRate: overallAppliedCount / total,
      recoveredRate: overallRecoveredCount / total,
      upstream503Rate: overallUpstream503Count / total,
      appliedCount: overallAppliedCount,
      recoveredCount: overallRecoveredCount,
      upstream503Count: overallUpstream503Count,
    },
    byMode: modeStats,
  };
}

function evaluateThresholds(results) {
  const total = results.length || 1;
  const failureCount = results.filter((row) => row.isFailure).length;
  const timeoutCount = results.filter((row) => row.errorCode === "UPSTREAM_TIMEOUT").length;
  const attempt3Count = results.filter((row) => row.attemptCount === "3").length;
  const structuredCount = results.filter((row) => row.format === "structured").length;
  const finalStageFirstCount = results.filter((row) => row.finalStage === "first").length;
  const finalStageRetryCount = results.filter((row) => row.finalStage === "retry").length;
  const finalStageRepairCount = results.filter((row) => row.finalStage === "repair").length;
  const elapsedValues = results.map((row) => Number(row.elapsedMs)).filter((value) => Number.isFinite(value) && value >= 0);
  const p50ElapsedMs = calcPercentile(elapsedValues, 50);
  const p95ElapsedMs = calcPercentile(elapsedValues, 95);

  const metrics = {
    failureRate: failureCount / total,
    timeoutRate: timeoutCount / total,
    attempt3Rate: attempt3Count / total,
    structuredRate: structuredCount / total,
    finalStageFirstRate: finalStageFirstCount / total,
    finalStageRetryRate: finalStageRetryCount / total,
    finalStageRepairRate: finalStageRepairCount / total,
    p50ElapsedMs,
    p95ElapsedMs,
  };

  return {
    counts: {
      total,
      failureCount,
      timeoutCount,
      attempt3Count,
      structuredCount,
      finalStageFirstCount,
      finalStageRetryCount,
      finalStageRepairCount,
      elapsedValues,
    },
    metrics,
    checks: [
      {
        label: "总失败率 <= 20%",
        value: toPercent(metrics.failureRate),
        pass: metrics.failureRate <= DEFAULT_THRESHOLD.maxFailureRate,
      },
      {
        label: "UPSTREAM_TIMEOUT 占比 <= 10%",
        value: toPercent(metrics.timeoutRate),
        pass: metrics.timeoutRate <= DEFAULT_THRESHOLD.maxTimeoutRate,
      },
      {
        label: "attemptCount=3 占比 <= 30%",
        value: toPercent(metrics.attempt3Rate),
        pass: metrics.attempt3Rate <= DEFAULT_THRESHOLD.maxAttempt3Rate,
      },
      {
        label: "structured 占比 >= 60%",
        value: toPercent(metrics.structuredRate),
        pass: metrics.structuredRate >= DEFAULT_THRESHOLD.minStructuredRate,
      },
      {
        label: "p95 elapsedMs <= 15000ms",
        value: `${metrics.p95ElapsedMs}ms`,
        pass: metrics.p95ElapsedMs <= DEFAULT_THRESHOLD.maxP95Ms,
      },
    ],
  };
}

function buildDiagnosis(results, summary = null) {
  const failures = results.filter((item) => item.isFailure);
  if (failures.length === 0) {
    return ["未观测到失败请求，可进入下一阶段质量增强。"];
  }

  const timeoutFirstCount = failures.filter((item) => item.errorCode === "UPSTREAM_TIMEOUT" && item.stage === "first").length;
  const upstream5xxCount = failures.filter(
    (item) => item.errorCode === "UPSTREAM_ERROR" && (item.upstreamStatus === "500" || item.upstreamStatus === "503"),
  ).length;
  const rateLimitCount = failures.filter((item) => item.errorCode === "UPSTREAM_RATE_LIMIT" && item.upstreamStatus === "429").length;
  const authErrorCount = failures.filter((item) => item.errorCode === "UPSTREAM_AUTH_ERROR").length;
  const textFallbackCount = results.filter((item) => item.format === "text_fallback").length;

  const notes = [];
  if (timeoutFirstCount >= 2) {
    notes.push("高频 `UPSTREAM_TIMEOUT + stage=first`：首轮请求偏慢，优先继续瘦身上下文或降低输出复杂度。");
  }
  if (upstream5xxCount >= 2) {
    notes.push("高频 `UPSTREAM_ERROR + upstreamStatus=500/503`：上游波动明显，建议后端增加指数退避重试。");
  }
  if (rateLimitCount >= 2) {
    notes.push("高频 `UPSTREAM_RATE_LIMIT + 429`：建议增加客户端节流与服务端限流提示。");
  }
  if (authErrorCount >= 1) {
    notes.push("出现 `UPSTREAM_AUTH_ERROR`：优先检查 Gemini Key 权限和 Cloudflare Secret 生效情况。");
  }
  if (textFallbackCount >= 4) {
    notes.push("`text_fallback` 占比较高：结构化稳定性仍不足，建议优化 schema/prompt 约束。");
  }
  if (notes.length === 0) {
    notes.push("失败分布无明显单一瓶颈，建议结合 requestId 逐条查看 Cloudflare Function 日志。");
  }
  const p95 = Number(summary?.metrics?.p95ElapsedMs);
  if (Number.isFinite(p95) && p95 > 15000 && p95 <= 18000) {
    notes.push("p95 位于 15000~18000ms：先保留详细分布观察，不建议为追目标激进压缩回答质量。");
  }
  return notes;
}

function printTable(results) {
  console.log(
    "| # | mode | 问题类型 | HTTP | error.code | stage | upstreamStatus | durationMs | format | attemptCount | repairApplied | finalStage | firstTxAttempts | firstTxRetry | firstTxRecovered | elapsedMs | requestId | 等待体感 |",
  );
  console.log(
    "|---|------|----------|------|------------|-------|----------------|------------|--------|--------------|---------------|------------|-----------------|--------------|------------------|-----------|-----------|----------|",
  );
  for (const row of results) {
    console.log(
      `| ${row.row} | ${row.mode} | ${row.questionType} | ${row.http} | ${row.errorCode} | ${row.stage} | ${row.upstreamStatus} | ${row.durationMs} | ${row.format} | ${row.attemptCount} | ${row.repairApplied} | ${row.finalStage} | ${row.firstTransportAttempts} | ${row.firstTransportRetryApplied} | ${row.firstTransportRetryRecovered} | ${row.elapsedMs} | ${row.requestId} | ${row.waitFeeling} |`,
    );
  }
}

function printModeStats(results) {
  const stats = buildModeStats(results);
  console.log(
    "| mode | 样本数 | attemptCount=3 占比 | text_fallback 占比 | finalStage=first 占比 | finalStage=retry 占比 | finalStage=repair 占比 | p95 elapsedMs |",
  );
  console.log(
    "|------|--------|----------------------|--------------------|-----------------------|-----------------------|------------------------|---------------|",
  );
  for (const item of stats) {
    console.log(
      `| ${item.mode} | ${item.total} | ${toPercent(item.attempt3Rate)} | ${toPercent(item.textFallbackRate)} | ${toPercent(item.finalStageFirstRate)} | ${toPercent(item.finalStageRetryRate)} | ${toPercent(item.finalStageRepairRate)} | ${item.p95ElapsedMs}ms |`,
    );
  }
  return stats;
}

function printFirstTransportStats(results) {
  const stats = buildFirstTransportStats(results);
  console.log("\n=== 首轮可用性重试统计（overall）===");
  console.log("| firstTransportRetryApplied 占比 | firstTransportRetryRecovered 占比 | upstreamStatus=503 占比 |");
  console.log("|-------------------------------|----------------------------------|-----------------------|");
  console.log(
    `| ${toPercent(stats.overall.appliedRate)} | ${toPercent(stats.overall.recoveredRate)} | ${toPercent(stats.overall.upstream503Rate)} |`,
  );
  console.log("\n=== 首轮可用性重试统计（by mode）===");
  console.log("| mode | 样本数 | firstTransportRetryApplied 占比 | firstTransportRetryRecovered 占比 | upstreamStatus=503 占比 |");
  console.log("|------|--------|-------------------------------|----------------------------------|-----------------------|");
  for (const item of stats.byMode) {
    console.log(
      `| ${item.mode} | ${item.total} | ${toPercent(item.appliedRate)} | ${toPercent(item.recoveredRate)} | ${toPercent(item.upstream503Rate)} |`,
    );
  }
  return stats;
}

function printFinalStageSummary(summary) {
  console.log("| finalStage=first 占比 | finalStage=retry 占比 | finalStage=repair 占比 |");
  console.log("|-----------------------|-----------------------|------------------------|");
  console.log(
    `| ${toPercent(summary.metrics.finalStageFirstRate)} | ${toPercent(summary.metrics.finalStageRetryRate)} | ${toPercent(summary.metrics.finalStageRepairRate)} |`,
  );
}

function formatDeltaPercent(currentRate, baselineRate) {
  const current = Number(currentRate);
  const baseline = Number(baselineRate);
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) {
    return "-";
  }
  const delta = (current - baseline) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}pp`;
}

function formatDeltaMs(currentMs, baselineMs) {
  const current = Number(currentMs);
  const baseline = Number(baselineMs);
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) {
    return "-";
  }
  const delta = current - baseline;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${Math.floor(delta)}ms`;
}

function printBaselineComparison(results, summary) {
  const modeStats = buildModeStats(results);
  const modeStatMap = Object.fromEntries(modeStats.map((item) => [item.mode, item]));
  console.log("| 指标 | baseline | 当前 | 变化 |");
  console.log("|------|----------|------|------|");
  console.log(
    `| p50 elapsedMs | ${BASELINE_METRICS.p50ElapsedMs}ms | ${summary.metrics.p50ElapsedMs}ms | ${formatDeltaMs(summary.metrics.p50ElapsedMs, BASELINE_METRICS.p50ElapsedMs)} |`,
  );
  console.log(
    `| p95 elapsedMs | ${BASELINE_METRICS.p95ElapsedMs}ms | ${summary.metrics.p95ElapsedMs}ms | ${formatDeltaMs(summary.metrics.p95ElapsedMs, BASELINE_METRICS.p95ElapsedMs)} |`,
  );
  console.log(
    `| structured 占比 | ${toPercent(BASELINE_METRICS.structuredRate)} | ${toPercent(summary.metrics.structuredRate)} | ${formatDeltaPercent(summary.metrics.structuredRate, BASELINE_METRICS.structuredRate)} |`,
  );
  console.log(
    `| attemptCount=3 占比 | ${toPercent(BASELINE_METRICS.attempt3Rate)} | ${toPercent(summary.metrics.attempt3Rate)} | ${formatDeltaPercent(summary.metrics.attempt3Rate, BASELINE_METRICS.attempt3Rate)} |`,
  );

  const briefingStats = modeStatMap.briefing || null;
  const diagnosisStats = modeStatMap.diagnosis || null;
  const actionPlanStats = modeStatMap["action-plan"] || null;

  if (briefingStats) {
    console.log(
      `| briefing finalStage=repair 占比 | ${toPercent(BASELINE_METRICS.mode.briefing.repairRate)} | ${toPercent(briefingStats.finalStageRepairRate)} | ${formatDeltaPercent(briefingStats.finalStageRepairRate, BASELINE_METRICS.mode.briefing.repairRate)} |`,
    );
  }
  if (diagnosisStats) {
    console.log(
      `| diagnosis text_fallback 占比 | ${toPercent(BASELINE_METRICS.mode.diagnosis.textFallbackRate)} | ${toPercent(diagnosisStats.textFallbackRate)} | ${formatDeltaPercent(diagnosisStats.textFallbackRate, BASELINE_METRICS.mode.diagnosis.textFallbackRate)} |`,
    );
  }
  if (actionPlanStats) {
    console.log(
      `| action-plan text_fallback 占比 | ${toPercent(BASELINE_METRICS.mode["action-plan"].textFallbackRate)} | ${toPercent(actionPlanStats.textFallbackRate)} | ${formatDeltaPercent(actionPlanStats.textFallbackRate, BASELINE_METRICS.mode["action-plan"].textFallbackRate)} |`,
    );
  }
}

function printElapsedDistribution(results) {
  const values = results
    .map((row) => Number(row.elapsedMs))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (values.length === 0) {
    console.log("- 无有效耗时样本。");
    return;
  }
  console.log(`- elapsedMs 升序: ${values.join(", ")}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    printHelp();
    return;
  }

  const endpoint = trim(args.endpoint || process.env.CHAT_API_ENDPOINT);
  const token = trim(args.token || process.env.CHAT_AUTH_TOKEN || process.env.SUPABASE_ACCESS_TOKEN);
  const delayMs = toInt(args.delayMs, DEFAULT_DELAY_MS);
  const stream = toBool(args.stream, false);

  if (!endpoint || !token) {
    printHelp();
    throw new Error("缺少 endpoint 或 token。请使用 --endpoint/--token 或环境变量 CHAT_API_ENDPOINT/CHAT_AUTH_TOKEN。");
  }

  const results = [];
  let history = [];
  console.log(`开始执行 10 次稳态验证，endpoint: ${endpoint}`);
  console.log(`配置: stream=${stream}, delayMs=${delayMs}`);

  for (let index = 0; index < TEST_CASES.length; index += 1) {
    const testCase = TEST_CASES[index];
    const requestBody = {
      message: testCase.message,
      mode: testCase.mode,
      stream,
      context: {},
      history: sanitizeHistory(history),
    };

    const startedAt = Date.now();
    let response;
    let payload = null;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      payload = await parseJsonSafe(response);
    } catch (error) {
      const pseudoResult = {
        row: index + 1,
        mode: testCase.mode,
        questionType: testCase.type,
        http: 0,
        errorCode: "NETWORK_ERROR",
        stage: "-",
        upstreamStatus: "-",
        durationMs: "-",
        format: "-",
        attemptCount: "-",
        repairApplied: "-",
        finalStage: "-",
        metaFormatReason: "-",
        attemptDiagnostics: [],
        firstTransportAttempts: "-",
        firstTransportRetryApplied: "-",
        firstTransportRetryRecovered: "-",
        firstTransportStatuses: [],
        hasUpstream503: false,
        elapsedMs: toInt(Date.now() - startedAt, 0),
        totalDurationMs: toInt(Date.now() - startedAt, 0),
        requestId: "-",
        waitFeeling: classifyWaitFeeling(Date.now() - startedAt),
        isFailure: true,
      };
      results.push(pseudoResult);
      console.error(`[${index + 1}/10] 请求失败: ${error instanceof Error ? error.message : "unknown error"}`);
      await sleep(delayMs);
      continue;
    }

    const row = normalizeResult(index, testCase, response, payload, Date.now() - startedAt);
    results.push(row);

    history.push({ role: "user", content: testCase.message });
    const assistantText = trim(payload?.reply) || trim(payload?.structured?.summary);
    if (!row.isFailure && assistantText) {
      history.push({ role: "assistant", content: assistantText });
    }
    history = sanitizeHistory(history);

    console.log(
      `[${index + 1}/10] mode=${row.mode}, http=${row.http}, code=${row.errorCode}, format=${row.format}, elapsed=${row.elapsedMs}ms, requestId=${row.requestId}`,
    );
    if (index < TEST_CASES.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log("\n=== 明细记录表 ===");
  printTable(results);
  console.log("\n=== 按 mode 统计 ===");
  const modeStats = printModeStats(results);
  const reasonStats = printAttemptReasonStats(results);
  const firstHitQualityStats = printFirstHitQualityStats(reasonStats, results.length);
  const schemaInvalidIssueStats = printSchemaInvalidIssueStats(results);
  const firstTransportStats = printFirstTransportStats(results);

  const summary = evaluateThresholds(results);
  printFocusMetrics(summary, modeStats, reasonStats, firstTransportStats, firstHitQualityStats);
  console.log("\n=== FinalStage 总体占比 ===");
  printFinalStageSummary(summary);
  console.log("\n=== 判定结果 ===");
  for (const check of summary.checks) {
    console.log(`- [${check.pass ? "PASS" : "FAIL"}] ${check.label} -> ${check.value}`);
  }

  console.log("\n=== 核心计数 ===");
  console.log(`- 总请求: ${summary.counts.total}`);
  console.log(`- 失败数: ${summary.counts.failureCount}`);
  console.log(`- 超时数: ${summary.counts.timeoutCount}`);
  console.log(`- attemptCount=3 数: ${summary.counts.attempt3Count}`);
  console.log(`- structured 数: ${summary.counts.structuredCount}`);
  console.log(`- finalStage=first 数: ${summary.counts.finalStageFirstCount}`);
  console.log(`- finalStage=retry 数: ${summary.counts.finalStageRetryCount}`);
  console.log(`- finalStage=repair 数: ${summary.counts.finalStageRepairCount}`);
  console.log(`- p50 elapsedMs: ${summary.metrics.p50ElapsedMs}ms`);
  console.log(`- p95 elapsedMs: ${summary.metrics.p95ElapsedMs}ms`);
  console.log("\n=== 与 baseline 对比 ===");
  printBaselineComparison(results, summary);
  if (summary.metrics.p95ElapsedMs > 15000 && summary.metrics.p95ElapsedMs <= 18000) {
    console.log("\n=== 耗时分布观察（15000~18000ms 区间）===");
    printElapsedDistribution(results);
  }

  console.log("\n=== 日志判读建议 ===");
  for (const note of buildDiagnosis(results, summary)) {
    console.log(`- ${note}`);
  }
  const topSchemaFirstIssue =
    schemaInvalidIssueStats?.overall?.first?.entries && schemaInvalidIssueStats.overall.first.entries.length > 0
      ? `${schemaInvalidIssueStats.overall.first.entries[0].issue} (${schemaInvalidIssueStats.overall.first.entries[0].count})`
      : "-";
  const topSchemaRetryIssue =
    schemaInvalidIssueStats?.overall?.retry?.entries && schemaInvalidIssueStats.overall.retry.entries.length > 0
      ? `${schemaInvalidIssueStats.overall.retry.entries[0].issue} (${schemaInvalidIssueStats.overall.retry.entries[0].count})`
      : "-";
  console.log(`- schema_invalid first top issue: ${topSchemaFirstIssue}`);
  console.log(`- schema_invalid retry top issue: ${topSchemaRetryIssue}`);

  const allPass = summary.checks.every((item) => item.pass);
  if (!allPass) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error(`[chat-stability-check] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
