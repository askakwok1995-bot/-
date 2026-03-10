const fs = require("node:fs");
const path = require("node:path");

const TOOL_TRACE_PREFIX = "[chat.tool.trace]";
const CHAT_ERROR_PREFIX = "[chat.error]";
const DEFAULT_REPORT_TITLE = "# AI 对话助手真实日志采样报告";

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeReadFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function extractJsonPayload(line, prefix) {
  const safeLine = trimString(line);
  if (!safeLine) {
    return null;
  }
  if (safeLine.startsWith(prefix)) {
    return safeJsonParse(trimString(safeLine.slice(prefix.length)));
  }
  if (safeLine.startsWith("{")) {
    return safeJsonParse(safeLine);
  }
  return null;
}

function parseToolTraceLogText(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .map((line) => extractJsonPayload(line, TOOL_TRACE_PREFIX))
    .filter((item) => item && trimString(item.requestId));
}

function parseChatErrorLogText(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .map((line) => extractJsonPayload(line, CHAT_ERROR_PREFIX))
    .filter((item) => item && trimString(item.requestId));
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((item) => trimString(item));
}

function parseManualSamplesCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/\uFEFF/u, ""))
    .filter((line) => trimString(line));
  if (lines.length === 0) {
    return [];
  }
  const [headerLine, ...rows] = lines;
  const headers = parseCsvLine(headerLine);
  return rows
    .map((line) => {
      const values = parseCsvLine(line);
      const record = {};
      headers.forEach((header, index) => {
        record[header] = values[index] || "";
      });
      return {
        requestId: trimString(record.requestId),
        category: trimString(record.category),
        question: trimString(record.question),
        analysisRange: trimString(record.analysisRange),
        uiResult: trimString(record.uiResult).toLowerCase(),
        notes: trimString(record.notes),
      };
    })
    .filter((item) => item.requestId || item.question);
}

function parseManualSamples(text, extension = ".csv") {
  if (extension === ".json") {
    const payload = safeJsonParse(text);
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload.map((item) => ({
      requestId: trimString(item?.requestId),
      category: trimString(item?.category),
      question: trimString(item?.question),
      analysisRange: trimString(item?.analysisRange),
      uiResult: trimString(item?.uiResult).toLowerCase(),
      notes: trimString(item?.notes),
    }));
  }
  return parseManualSamplesCsv(text);
}

function bucketCounts(items) {
  return items.reduce((acc, item) => {
    const key = trimString(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function inferOutcome(sample, trace) {
  const sampleResult = trimString(sample?.uiResult).toLowerCase();
  if (sampleResult === "success" || sampleResult === "failure") {
    return sampleResult;
  }
  if (trimString(trace?.fallback_reason)) {
    return "failure";
  }
  if (trimString(trace?.final_route_code)) {
    return "success";
  }
  return "unknown";
}

function pickPrimaryReason(trace, error) {
  return (
    trimString(trace?.fallback_reason) ||
    trimString(error?.error_name) ||
    trimString(error?.error_message) ||
    "unknown"
  );
}

function createRecordMap(traces, errors, samples) {
  const records = new Map();
  function ensureRecord(requestId) {
    const key = trimString(requestId) || `missing:${records.size + 1}`;
    if (!records.has(key)) {
      records.set(key, {
        requestId: key.startsWith("missing:") ? "" : key,
        trace: null,
        error: null,
        sample: null,
      });
    }
    return records.get(key);
  }

  traces.forEach((trace) => {
    const record = ensureRecord(trace.requestId);
    record.trace = trace;
  });
  errors.forEach((error) => {
    const record = ensureRecord(error.requestId);
    record.error = error;
  });
  samples.forEach((sample, index) => {
    const requestId = trimString(sample.requestId) || `sample-only:${index + 1}`;
    const record = ensureRecord(requestId);
    record.sample = sample;
  });

  return Array.from(records.values()).map((record) => {
    const outcome = inferOutcome(record.sample, record.trace);
    return {
      ...record,
      category: trimString(record.sample?.category) || "未分类",
      question: trimString(record.sample?.question),
      analysisRange: trimString(record.sample?.analysisRange),
      uiResult: trimString(record.sample?.uiResult),
      outcome,
      primaryReason: pickPrimaryReason(record.trace, record.error),
    };
  });
}

function summarizeByCategory(records) {
  const summary = new Map();
  records.forEach((record) => {
    const key = trimString(record.category) || "未分类";
    if (!summary.has(key)) {
      summary.set(key, { category: key, total: 0, success: 0, failure: 0, unknown: 0 });
    }
    const bucket = summary.get(key);
    bucket.total += 1;
    bucket[record.outcome] = (bucket[record.outcome] || 0) + 1;
  });
  return Array.from(summary.values()).sort((a, b) => b.total - a.total);
}

function summarizeFailureReasons(records) {
  return bucketCounts(records.filter((item) => item.outcome === "failure").map((item) => item.primaryReason));
}

function determinePrioritySuggestion(reasonCounts) {
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];
  const reason = topReason?.[0] || "";
  if (reason === "planner_call_missing" || reason === "planner_rejected_without_resubmission") {
    return "优先修首轮入口和 planner 协议。";
  }
  if (reason === "empty_final_reply") {
    return "优先修最终总结生成。";
  }
  if (reason === "tool_loop_limit_exceeded") {
    return "优先修宏工具覆盖或 planner-取数匹配。";
  }
  if (reason === "tool_execution_failed") {
    return "优先修具体工具字段、参数和执行器。";
  }
  if (reason === "gemini_error") {
    return "优先看上游模型稳定性和重试策略。";
  }
  return "优先抽样 requestId 级链路，确认主失败层级后再改。";
}

function formatCountMap(countMap) {
  const entries = Object.entries(countMap).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return "- 无\n";
  }
  return entries.map(([key, value]) => `- ${key}: ${value}`).join("\n") + "\n";
}

function formatCategoryTable(rows) {
  if (rows.length === 0) {
    return "无\n";
  }
  const header = "| 类别 | 总样本 | 成功 | 失败 | 未知 | 成功率 |\n| --- | ---: | ---: | ---: | ---: | ---: |";
  const body = rows.map((row) => {
    const successRate = row.total > 0 ? `${((row.success / row.total) * 100).toFixed(1)}%` : "0.0%";
    return `| ${row.category} | ${row.total} | ${row.success} | ${row.failure} | ${row.unknown} | ${successRate} |`;
  });
  return [header, ...body].join("\n") + "\n";
}

function formatRequestSamples(records, outcome, limit = 10) {
  const rows = records.filter((item) => item.outcome === outcome).slice(0, limit);
  if (rows.length === 0) {
    return "- 无\n";
  }
  return (
    rows
      .map((item) => {
        const requestId = trimString(item.requestId) || "无 requestId";
        const question = trimString(item.question) || "未记录问题文本";
        const reason = trimString(item.primaryReason) || "unknown";
        const views = Array.isArray(item.trace?.planner_requested_views) ? item.trace.planner_requested_views.join(", ") : "";
        const toolCalls = Array.isArray(item.trace?.tool_calls) ? item.trace.tool_calls.length : 0;
        return `- \`${requestId}\` | 问题：${question} | 原因：${reason} | 规划视角：${views || "无"} | 工具调用：${toolCalls}`;
      })
      .join("\n") + "\n"
  );
}

function buildMarkdownReport({ traces, errors, samples, records }) {
  const categoryRows = summarizeByCategory(records);
  const failureReasons = summarizeFailureReasons(records);
  const prioritySuggestion = determinePrioritySuggestion(failureReasons);
  const traceCount = traces.length;
  const errorCount = errors.length;
  const sampleCount = samples.length;
  const totalRecords = records.length;
  return [
    DEFAULT_REPORT_TITLE,
    "",
    "## 样本总量",
    `- 手工样本数：${sampleCount}`,
    `- tool trace 数：${traceCount}`,
    `- error 日志数：${errorCount}`,
    `- requestId 串联记录数：${totalRecords}`,
    "",
    "## 五类问题成功率",
    formatCategoryTable(categoryRows),
    "## 失败原因分布",
    formatCountMap(failureReasons),
    "## 失败样本（最多 10 条）",
    formatRequestSamples(records, "failure", 10),
    "## 成功样本（最多 5 条）",
    formatRequestSamples(records, "success", 5),
    "## 下一轮修复优先级建议",
    `- ${prioritySuggestion}`,
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    toolLog: "",
    errorLog: "",
    samples: "",
    out: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--tool-log" && args[index + 1]) {
      options.toolLog = path.resolve(process.cwd(), args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--error-log" && args[index + 1]) {
      options.errorLog = path.resolve(process.cwd(), args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--samples" && args[index + 1]) {
      options.samples = path.resolve(process.cwd(), args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--out" && args[index + 1]) {
      options.out = path.resolve(process.cwd(), args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }
  return options;
}

function buildUsageText() {
  return [
    "用法：",
    "  node scripts/analyze-chat-runtime-samples.js --tool-log <tool.log> [--error-log <error.log>] [--samples <samples.csv>] [--out <report.md>]",
    "",
    "说明：",
    "  --tool-log   包含 [chat.tool.trace] 的日志文件，支持纯 JSONL 或混合文本日志。",
    "  --error-log  包含 [chat.error] 的日志文件，可选。",
    "  --samples    手工样本 CSV/JSON，可选。",
    "  --out        将 Markdown 报告写入文件，可选；未提供时输出到 stdout。",
  ].join("\n");
}

function runAnalysis({ toolLogText, errorLogText = "", sampleText = "", sampleExtension = ".csv" }) {
  const traces = parseToolTraceLogText(toolLogText);
  const errors = parseChatErrorLogText(errorLogText);
  const samples = sampleText ? parseManualSamples(sampleText, sampleExtension) : [];
  const records = createRecordMap(traces, errors, samples);
  return {
    traces,
    errors,
    samples,
    records,
    report: buildMarkdownReport({ traces, errors, samples, records }),
  };
}

function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.toolLog) {
    console.log(buildUsageText());
    process.exit(options.help ? 0 : 1);
  }
  const toolLogText = safeReadFile(options.toolLog);
  const errorLogText = options.errorLog ? safeReadFile(options.errorLog) : "";
  const sampleText = options.samples ? safeReadFile(options.samples) : "";
  const sampleExtension = options.samples ? path.extname(options.samples).toLowerCase() : ".csv";
  const result = runAnalysis({
    toolLogText,
    errorLogText,
    sampleText,
    sampleExtension,
  });
  if (options.out) {
    fs.writeFileSync(options.out, result.report, "utf8");
    console.log(`[analyze-chat-runtime] Wrote ${options.out}`);
    return;
  }
  process.stdout.write(result.report);
}

if (require.main === module) {
  main();
}

module.exports = {
  TOOL_TRACE_PREFIX,
  CHAT_ERROR_PREFIX,
  parseToolTraceLogText,
  parseChatErrorLogText,
  parseManualSamplesCsv,
  parseManualSamples,
  createRecordMap,
  summarizeByCategory,
  summarizeFailureReasons,
  determinePrioritySuggestion,
  buildMarkdownReport,
  runAnalysis,
};
