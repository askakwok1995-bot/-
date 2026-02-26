const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTEXT_CHARS = 18000;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_CHARS = 4000;
const MAX_REPAIR_SOURCE_CHARS = 8000;
const SUPABASE_AUTH_USER_PATH = "/auth/v1/user";
const AUTH_UPSTREAM_TIMEOUT_MS = 12000;
const GEMINI_UPSTREAM_TIMEOUT_MS = 30000;
const TOTAL_CHAT_BUDGET_MS = 35000;
const FIRST_STAGE_BUDGET_MS = 18000;
const FIRST_AND_RETRY_BUDGET_MS = 24000;
const SCHEMA_INVALID_REPAIR_BUDGET_MS = 22000;
const SCHEMA_INVALID_REPAIR_MIN_OUTPUT_CHARS = 300;
const FETCH_TIMEOUT_CODE = "FETCH_TIMEOUT";
const DEFAULT_MAX_OUTPUT_TOKENS = 1536;
const RETRY_MAX_OUTPUT_TOKENS = 2048;
const MIN_SUMMARY_CHARS = 70;
const MIN_HIGHLIGHTS_COUNT = 1;
const MIN_EVIDENCE_COUNT = 1;
const MIN_ACTIONS_COUNT = 1;
const GEMINI_STREAM_ALT = "alt=sse";

const CHAT_ERROR_CODES = Object.freeze({
  UNAUTHORIZED: "UNAUTHORIZED",
  AUTH_CONFIG_MISSING: "AUTH_CONFIG_MISSING",
  AUTH_UPSTREAM_TIMEOUT: "AUTH_UPSTREAM_TIMEOUT",
  AUTH_UPSTREAM_ERROR: "AUTH_UPSTREAM_ERROR",
  CONFIG_MISSING: "CONFIG_MISSING",
  BAD_REQUEST: "BAD_REQUEST",
  MESSAGE_REQUIRED: "MESSAGE_REQUIRED",
  MESSAGE_TOO_LONG: "MESSAGE_TOO_LONG",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  UPSTREAM_AUTH_ERROR: "UPSTREAM_AUTH_ERROR",
  UPSTREAM_RATE_LIMIT: "UPSTREAM_RATE_LIMIT",
  UPSTREAM_NETWORK_ERROR: "UPSTREAM_NETWORK_ERROR",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  EMPTY_REPLY: "EMPTY_REPLY",
});

const CHAT_MODES = Object.freeze({
  BRIEFING: "briefing",
  DIAGNOSIS: "diagnosis",
  ACTION_PLAN: "action-plan",
});
const CHAT_HISTORY_ROLES = Object.freeze({
  USER: "user",
  ASSISTANT: "assistant",
});

const CHAT_FORMAT_REASONS = Object.freeze({
  STRUCTURED_OK: "structured_ok",
  JSON_PARSE_FAILED: "json_parse_failed",
  SCHEMA_INVALID: "schema_invalid",
  OUTPUT_TRUNCATED: "output_truncated",
  EMPTY_REPLY: "empty_reply",
});

const MODE_DEFINITIONS = Object.freeze({
  [CHAT_MODES.BRIEFING]: {
    label: "简报模式",
    goal: "用于周报或阶段汇报，先给结论，再给证据和动作。",
    focus: "强调总体结论、亮点、风险、下周动作。",
  },
  [CHAT_MODES.DIAGNOSIS]: {
    label: "诊断模式",
    goal: "用于定位问题根因，优先解释下滑或异常波动。",
    focus: "强调异常定位、影响范围、可验证假设。",
  },
  [CHAT_MODES.ACTION_PLAN]: {
    label: "行动模式",
    goal: "用于制定执行清单，输出可落地动作。",
    focus: "强调负责人、时间、追踪指标与下一步检查点。",
  },
});

const MODE_QUALITY_THRESHOLDS = Object.freeze({
  [CHAT_MODES.BRIEFING]: {
    minSummaryChars: 70,
    minHighlightsCount: 1,
    minEvidenceCount: 1,
    minActionsCount: 1,
  },
  [CHAT_MODES.DIAGNOSIS]: {
    minSummaryChars: 60,
    minHighlightsCount: 1,
    minEvidenceCount: 1,
    minActionsCount: 0,
  },
  [CHAT_MODES.ACTION_PLAN]: {
    minSummaryChars: 60,
    minHighlightsCount: 0,
    minEvidenceCount: 1,
    minActionsCount: 1,
  },
});

const CHAT_RESPONSE_SCHEMA = Object.freeze({
  type: "OBJECT",
  required: ["summary", "highlights", "evidence", "risks", "actions", "nextQuestions"],
  properties: {
    summary: { type: "STRING" },
    highlights: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    evidence: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["label", "value", "insight"],
        properties: {
          label: { type: "STRING" },
          value: { type: "STRING" },
          insight: { type: "STRING" },
        },
      },
    },
    risks: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["title", "owner", "timeline", "metric"],
        properties: {
          title: { type: "STRING" },
          owner: { type: "STRING" },
          timeline: { type: "STRING" },
          metric: { type: "STRING" },
        },
      },
    },
    nextQuestions: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
  },
});

const MODE_SCHEMA_REQUIRED_FIELDS = Object.freeze({
  [CHAT_MODES.BRIEFING]: ["summary", "highlights", "evidence", "risks", "actions"],
  [CHAT_MODES.DIAGNOSIS]: ["summary", "highlights", "evidence", "risks"],
  [CHAT_MODES.ACTION_PLAN]: ["summary", "evidence", "actions"],
});

function jsonResponse(payload, status = 200, requestId = "") {
  const safeRequestId = trimString(requestId);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (safeRequestId) {
    headers["x-request-id"] = safeRequestId;
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

function ndjsonResponse(stream, requestId = "") {
  const safeRequestId = trimString(requestId);
  const headers = {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
  };
  if (safeRequestId) {
    headers["x-request-id"] = safeRequestId;
  }

  return new Response(stream, {
    status: 200,
    headers,
  });
}

function errorResponse(code, message, status, requestId, details = null) {
  const errorPayload = {
    code,
    message,
  };
  const safeDetails = details && typeof details === "object" ? details : null;
  const safeStage = trimString(safeDetails?.stage);
  if (safeStage === "first" || safeStage === "retry" || safeStage === "repair") {
    errorPayload.stage = safeStage;
  }
  const safeUpstreamStatus = Number(safeDetails?.upstreamStatus);
  if (Number.isFinite(safeUpstreamStatus) && safeUpstreamStatus > 0) {
    errorPayload.upstreamStatus = Math.floor(safeUpstreamStatus);
  }
  const safeDurationMs = Number(safeDetails?.durationMs);
  if (Number.isFinite(safeDurationMs) && safeDurationMs >= 0) {
    errorPayload.durationMs = Math.floor(safeDurationMs);
  }

  return jsonResponse(
    {
      error: errorPayload,
      requestId,
    },
    status,
    requestId,
  );
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getEnvString(env, name) {
  return trimString(env && typeof env === "object" ? env[name] : "");
}

function sanitizeModelName(rawModel) {
  const model = trimString(rawModel) || DEFAULT_GEMINI_MODEL;
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return model;
}

function sanitizeMode(rawMode) {
  const mode = trimString(rawMode).toLowerCase();
  if (mode === CHAT_MODES.DIAGNOSIS || mode === CHAT_MODES.ACTION_PLAN || mode === CHAT_MODES.BRIEFING) {
    return mode;
  }
  return CHAT_MODES.BRIEFING;
}

function isValidHistoryRole(role) {
  return role === CHAT_HISTORY_ROLES.USER || role === CHAT_HISTORY_ROLES.ASSISTANT;
}

function sanitizeHistoryList(rawHistory) {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  const normalizedItems = rawHistory
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const role = trimString(item.role).toLowerCase();
      if (!isValidHistoryRole(role)) {
        return null;
      }
      const content = trimString(item.content);
      if (!content) {
        return null;
      }
      const limitedContent =
        content.length > MAX_HISTORY_CHARS ? content.slice(content.length - MAX_HISTORY_CHARS) : content;
      return { role, content: limitedContent };
    })
    .filter((item) => item !== null);

  const limitedByCount =
    normalizedItems.length > MAX_HISTORY_ITEMS
      ? normalizedItems.slice(normalizedItems.length - MAX_HISTORY_ITEMS)
      : normalizedItems;

  let totalChars = 0;
  const limitedByChars = [];
  for (let index = limitedByCount.length - 1; index >= 0; index -= 1) {
    const item = limitedByCount[index];
    const nextLength = item.content.length + totalChars;
    if (nextLength > MAX_HISTORY_CHARS && limitedByChars.length > 0) {
      break;
    }
    totalChars = Math.min(nextLength, MAX_HISTORY_CHARS);
    limitedByChars.unshift(item);
    if (totalChars >= MAX_HISTORY_CHARS) {
      break;
    }
  }

  return limitedByChars;
}

function formatHistoryText(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return "[]";
  }

  return history
    .map((item, index) => {
      const roleLabel = item.role === CHAT_HISTORY_ROLES.ASSISTANT ? "助手" : "用户";
      return `${index + 1}. ${roleLabel}：${item.content}`;
    })
    .join("\n");
}

function safeJsonLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch (_error) {
    return 0;
  }
}

function sanitizeContextPayload(rawContext) {
  if (!rawContext || typeof rawContext !== "object") {
    return {};
  }
  return rawContext;
}

function getModeTokenProfile(mode, messageLength = 0) {
  const safeMode = sanitizeMode(mode);
  let first = DEFAULT_MAX_OUTPUT_TOKENS;
  let retry = RETRY_MAX_OUTPUT_TOKENS;
  if (safeMode === CHAT_MODES.BRIEFING) {
    first = 1024;
    retry = 1408;
  } else if (safeMode === CHAT_MODES.DIAGNOSIS) {
    first = 1280;
    retry = 1792;
  } else if (safeMode === CHAT_MODES.ACTION_PLAN) {
    first = 1536;
    retry = 2048;
  }

  const safeLength = Number.isFinite(Number(messageLength)) ? Math.floor(Number(messageLength)) : 0;
  if (safeLength > 120) {
    first = Math.min(first + 256, RETRY_MAX_OUTPUT_TOKENS);
    retry = Math.min(retry + 256, 2048);
  }

  return { first, retry };
}

function buildChatSuccessPayload(params) {
  const {
    evaluation,
    model,
    requestId,
    mode,
    retryCount = 0,
    repairApplied = false,
    repairSucceeded = false,
    attemptCount = 1,
    totalDurationMs = 0,
    stageDurations = {},
    finalStage = "first",
    contextChars = 0,
    historyChars = 0,
    attemptDiagnostics = [],
  } = params || {};
  const format = evaluation && evaluation.format === "structured" ? "structured" : "text_fallback";
  const structured = format === "structured" ? evaluation.structured : null;
  const fallbackReply = trimString(evaluation?.reply) || "结构化输出未完成，请重试。";
  const reply = format === "structured" ? structured.summary : fallbackReply;
  const safeAttemptCount = Number.isFinite(Number(attemptCount)) && Number(attemptCount) > 0 ? Math.floor(Number(attemptCount)) : 1;
  const totalDuration = Number.isFinite(Number(totalDurationMs)) && Number(totalDurationMs) >= 0 ? Math.floor(Number(totalDurationMs)) : 0;
  const safeFirstDuration = Number.isFinite(Number(stageDurations?.first)) && Number(stageDurations.first) >= 0 ? Math.floor(Number(stageDurations.first)) : 0;
  const safeRetryDuration = Number.isFinite(Number(stageDurations?.retry)) && Number(stageDurations.retry) >= 0 ? Math.floor(Number(stageDurations.retry)) : undefined;
  const safeRepairDuration = Number.isFinite(Number(stageDurations?.repair)) && Number(stageDurations.repair) >= 0 ? Math.floor(Number(stageDurations.repair)) : undefined;
  const safeFinalStage = trimString(finalStage);
  const normalizedFinalStage =
    safeFinalStage === "retry" || safeFinalStage === "repair" ? safeFinalStage : "first";
  const safeContextChars = Number.isFinite(Number(contextChars)) && Number(contextChars) >= 0 ? Math.floor(Number(contextChars)) : 0;
  const safeHistoryChars = Number.isFinite(Number(historyChars)) && Number(historyChars) >= 0 ? Math.floor(Number(historyChars)) : 0;
  const safeAttemptDiagnostics = Array.isArray(attemptDiagnostics)
    ? attemptDiagnostics
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const stageCandidate = trimString(item.stage);
          const stage = stageCandidate === "retry" || stageCandidate === "repair" ? stageCandidate : "first";
          const format = item.format === "structured" ? "structured" : "text_fallback";
          const formatReason = trimString(item.formatReason) || CHAT_FORMAT_REASONS.JSON_PARSE_FAILED;
          const finishReason = trimString(item.finishReason);
          const outputCharsRaw = Number(item.outputChars);
          const elapsedMsRaw = Number(item.elapsedMs);
          const maxOutputTokensRaw = Number(item.maxOutputTokens);
          return {
            stage,
            format,
            formatReason,
            finishReason,
            outputChars: Number.isFinite(outputCharsRaw) && outputCharsRaw >= 0 ? Math.floor(outputCharsRaw) : 0,
            elapsedMs: Number.isFinite(elapsedMsRaw) && elapsedMsRaw >= 0 ? Math.floor(elapsedMsRaw) : 0,
            maxOutputTokens: Number.isFinite(maxOutputTokensRaw) && maxOutputTokensRaw > 0 ? Math.floor(maxOutputTokensRaw) : 0,
          };
        })
        .filter((item) => item !== null)
    : [];

  return {
    reply,
    model,
    requestId,
    mode,
    format,
    structured,
    meta: {
      formatReason: evaluation?.formatReason || CHAT_FORMAT_REASONS.JSON_PARSE_FAILED,
      retryCount: retryCount === 1 ? 1 : 0,
      finishReason: trimString(evaluation?.finishReason),
      outputChars: Number.isFinite(evaluation?.outputChars) ? evaluation.outputChars : 0,
      repairApplied: Boolean(repairApplied),
      repairSucceeded: Boolean(repairSucceeded),
      attemptCount: safeAttemptCount,
      totalDurationMs: totalDuration,
      stageDurations: {
        first: safeFirstDuration,
        retry: safeRetryDuration,
        repair: safeRepairDuration,
      },
      finalStage: normalizedFinalStage,
      contextChars: safeContextChars,
      historyChars: safeHistoryChars,
      attemptDiagnostics: safeAttemptDiagnostics,
    },
  };
}

function buildGeminiEndpoint(model, streaming = false) {
  const base = `${GEMINI_API_BASE}/${encodeURIComponent(model)}`;
  if (streaming) {
    return `${base}:streamGenerateContent?${GEMINI_STREAM_ALT}`;
  }
  return `${base}:generateContent`;
}

function safeContextText(context) {
  if (!context || typeof context !== "object") {
    return "{}";
  }

  try {
    const json = JSON.stringify(context);
    if (json.length <= MAX_CONTEXT_CHARS) {
      return json;
    }
    return `${json.slice(0, MAX_CONTEXT_CHARS)}...(truncated)`;
  } catch (_error) {
    return "{}";
  }
}

function buildPrompt(message, context, mode, options = {}) {
  const safeMessage = trimString(message);
  const safeMode = sanitizeMode(mode);
  const modeDefinition = MODE_DEFINITIONS[safeMode] || MODE_DEFINITIONS[CHAT_MODES.BRIEFING];
  const contextText = safeContextText(context);
  const strictJsonOnly = Boolean(options && options.strictJsonOnly);
  const history = sanitizeHistoryList(options?.history);
  const historyText = formatHistoryText(history);
  const modeCompactRule =
    safeMode === CHAT_MODES.BRIEFING
      ? "简报模式请紧凑输出：highlights<=2, evidence<=2, risks<=2, actions<=2, nextQuestions<=2。"
      : safeMode === CHAT_MODES.DIAGNOSIS
        ? "诊断模式请紧凑输出：highlights<=2, evidence<=3, risks<=2, actions<=1, nextQuestions<=1。"
        : "行动模式请紧凑输出：actions<=3, evidence<=3, risks<=1, highlights<=1, nextQuestions<=1。";

  return [
    "你是销售分析助手，请严格基于给定上下文回答，不要编造数据。",
    "输出语言：简体中文。",
    `当前模式：${modeDefinition.label}。`,
    `模式目标：${modeDefinition.goal}`,
    `模式重点：${modeDefinition.focus}`,
    strictJsonOnly
      ? "本次为纠错重试：你上次输出未通过结构化校验。请只返回合法 JSON。"
      : "本次为首轮输出，请优先保证结构化完整性和可读性。",
    "必须输出单个 JSON 对象，禁止输出除 JSON 外的解释文字。",
    "JSON 字段必须完整：summary(string), highlights(string[]), evidence([{label,value,insight}]), risks(string[]), actions([{title,owner,timeline,metric}]), nextQuestions(string[])。",
    modeCompactRule,
    "宁可减少条目数量，也必须一次输出完整 JSON，不要输出超长句子。",
    "若上下文不足，也要输出合法 JSON，并在 summary 或 risks 中明确“数据不足/口径不足”。",
    "禁止使用 Markdown 代码块；如果无法保证格式，仍优先输出可解析 JSON。",
    "优先参考最近对话上下文，但以当前传入数据口径为准。",
    "",
    "最近对话摘要（按时间顺序）：",
    historyText,
    "",
    "用户问题：",
    safeMessage,
    "",
    "分析上下文(JSON)：",
    contextText,
  ].join("\n");
}

function getModeResponseSchema(mode) {
  const safeMode = sanitizeMode(mode);
  const requiredFields = MODE_SCHEMA_REQUIRED_FIELDS[safeMode] || MODE_SCHEMA_REQUIRED_FIELDS[CHAT_MODES.BRIEFING];
  return {
    ...CHAT_RESPONSE_SCHEMA,
    required: requiredFields,
  };
}

function safeRepairSourceText(rawReply) {
  const text = trimString(rawReply);
  if (!text) {
    return "";
  }
  if (text.length <= MAX_REPAIR_SOURCE_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_REPAIR_SOURCE_CHARS)}...(truncated)`;
}

function buildRepairPrompt(rawReply, mode) {
  const safeMode = sanitizeMode(mode);
  const modeDefinition = MODE_DEFINITIONS[safeMode] || MODE_DEFINITIONS[CHAT_MODES.BRIEFING];
  const thresholds = MODE_QUALITY_THRESHOLDS[safeMode] || MODE_QUALITY_THRESHOLDS[CHAT_MODES.BRIEFING];
  const sourceText = safeRepairSourceText(rawReply);

  return [
    "你是销售分析助手的 JSON 修复器。",
    "任务：将下面这段模型输出修复为一个合法、可解析的 JSON 对象。",
    "禁止输出解释文字、禁止 Markdown 代码块，只能输出 JSON 对象。",
    `当前模式：${modeDefinition.label}。`,
    "字段必须完整：summary(string), highlights(string[]), evidence([{label,value,insight}]), risks(string[]), actions([{title,owner,timeline,metric}]), nextQuestions(string[])。",
    `summary 至少 ${thresholds.minSummaryChars} 字；highlights>=${thresholds.minHighlightsCount}，evidence>=${thresholds.minEvidenceCount}，actions>=${thresholds.minActionsCount}。`,
    "若源文本信息不足，可在 risks 中明确“信息不足”，但仍需输出合法结构。",
    "",
    "待修复文本：",
    sourceText || "{}",
  ].join("\n");
}

function pickGeminiReply(data) {
  if (!data || typeof data !== "object") return { reply: "", finishReason: "" };
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const finishReason = trimString(candidate?.finishReason);
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    const chunks = parts
      .map((part) => trimString(part && part.text))
      .filter((text) => text);
    if (chunks.length > 0) {
      return {
        reply: chunks.join("\n"),
        finishReason,
      };
    }
  }

  return {
    reply: "",
    finishReason: trimString(candidates[0]?.finishReason),
  };
}

function normalizeStringList(value, maxItems = 6) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => trimString(item))
    .filter((item) => item)
    .slice(0, maxItems);
}

function normalizeEvidenceList(value, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const label = trimString(item.label);
      const rawValue = item.value;
      const valueText =
        typeof rawValue === "number" || typeof rawValue === "string" ? trimString(String(rawValue)) : trimString(item.valueText);
      const insight = trimString(item.insight);
      if (!label || !valueText) return null;
      return { label, value: valueText, insight };
    })
    .filter((item) => item !== null)
    .slice(0, maxItems);
}

function normalizeActionList(value, maxItems = 6) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = trimString(item.title);
      if (!title) return null;
      return {
        title,
        owner: trimString(item.owner),
        timeline: trimString(item.timeline),
        metric: trimString(item.metric),
      };
    })
    .filter((item) => item !== null)
    .slice(0, maxItems);
}

function normalizeStructuredPayload(value) {
  if (!value || typeof value !== "object") return null;
  const summary = trimString(value.summary);
  if (!summary) return null;

  return {
    summary,
    highlights: normalizeStringList(value.highlights, 6),
    evidence: normalizeEvidenceList(value.evidence, 8),
    risks: normalizeStringList(value.risks, 6),
    actions: normalizeActionList(value.actions, 6),
    nextQuestions: normalizeStringList(value.nextQuestions, 6),
  };
}

function parseJsonCandidate(text) {
  const safeText = trimString(text);
  if (!safeText) return null;
  try {
    return JSON.parse(safeText);
  } catch (_error) {
    return null;
  }
}

function pickStructuredFromObject(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.structured && typeof candidate.structured === "object") {
    const nested = normalizeStructuredPayload(candidate.structured);
    if (nested) return nested;
  }
  return normalizeStructuredPayload(candidate);
}

function extractStructuredPayload(rawReply) {
  const safeReply = trimString(rawReply);
  if (!safeReply) return null;

  const directCandidate = parseJsonCandidate(safeReply);
  const directStructured = pickStructuredFromObject(directCandidate);
  if (directStructured) return directStructured;

  const fencedJsonMatch = safeReply.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJsonMatch && fencedJsonMatch[1]) {
    const fencedCandidate = parseJsonCandidate(fencedJsonMatch[1]);
    const fencedStructured = pickStructuredFromObject(fencedCandidate);
    if (fencedStructured) return fencedStructured;
  }

  const firstBraceIndex = safeReply.indexOf("{");
  const lastBraceIndex = safeReply.lastIndexOf("}");
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    const maybeJson = safeReply.slice(firstBraceIndex, lastBraceIndex + 1);
    const embeddedCandidate = parseJsonCandidate(maybeJson);
    const embeddedStructured = pickStructuredFromObject(embeddedCandidate);
    if (embeddedStructured) return embeddedStructured;
  }

  return null;
}

function isTruncatedFinishReason(reason) {
  const safeReason = trimString(reason).toUpperCase();
  if (!safeReason) return false;
  return (
    safeReason === "MAX_TOKENS" ||
    safeReason === "MAX_OUTPUT_TOKENS" ||
    safeReason === "STOP_REASON_MAX_TOKENS" ||
    safeReason.includes("MAX_TOKENS")
  );
}

function getModeQualityThreshold(mode) {
  const safeMode = sanitizeMode(mode);
  return MODE_QUALITY_THRESHOLDS[safeMode] || MODE_QUALITY_THRESHOLDS[CHAT_MODES.BRIEFING];
}

function validateStructuredQuality(structured, mode) {
  if (!structured || typeof structured !== "object") {
    return {
      ok: false,
      reason: CHAT_FORMAT_REASONS.JSON_PARSE_FAILED,
    };
  }

  const threshold = getModeQualityThreshold(mode);

  if (structured.summary.length < threshold.minSummaryChars) {
    return {
      ok: false,
      reason: CHAT_FORMAT_REASONS.SCHEMA_INVALID,
    };
  }

  if (
    structured.highlights.length < threshold.minHighlightsCount ||
    structured.evidence.length < threshold.minEvidenceCount ||
    structured.actions.length < threshold.minActionsCount
  ) {
    return {
      ok: false,
      reason: CHAT_FORMAT_REASONS.SCHEMA_INVALID,
    };
  }

  return {
    ok: true,
    reason: CHAT_FORMAT_REASONS.STRUCTURED_OK,
  };
}

function evaluateGeminiOutput(reply, finishReason, mode) {
  const safeReply = trimString(reply);
  const safeFinishReason = trimString(finishReason);
  const outputChars = safeReply.length;

  if (!safeReply) {
    return {
      format: "text_fallback",
      structured: null,
      reply: "",
      formatReason: CHAT_FORMAT_REASONS.EMPTY_REPLY,
      finishReason: safeFinishReason,
      outputChars,
      shouldRetry: true,
    };
  }

  if (isTruncatedFinishReason(safeFinishReason)) {
    return {
      format: "text_fallback",
      structured: null,
      reply: safeReply,
      formatReason: CHAT_FORMAT_REASONS.OUTPUT_TRUNCATED,
      finishReason: safeFinishReason,
      outputChars,
      shouldRetry: true,
    };
  }

  const structured = extractStructuredPayload(safeReply);
  if (!structured) {
    return {
      format: "text_fallback",
      structured: null,
      reply: safeReply,
      formatReason: CHAT_FORMAT_REASONS.JSON_PARSE_FAILED,
      finishReason: safeFinishReason,
      outputChars,
      shouldRetry: true,
    };
  }

  const quality = validateStructuredQuality(structured, mode);
  if (!quality.ok) {
    return {
      format: "text_fallback",
      structured: null,
      reply: safeReply,
      formatReason: quality.reason,
      finishReason: safeFinishReason,
      outputChars,
      shouldRetry: true,
    };
  }

  return {
    format: "structured",
    structured,
    reply: safeReply,
    formatReason: CHAT_FORMAT_REASONS.STRUCTURED_OK,
    finishReason: safeFinishReason,
    outputChars,
    shouldRetry: false,
  };
}

function buildGeminiPayload(params) {
  const {
    message,
    contextPayload,
    history,
    mode,
    maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    strictJsonOnly = false,
  } = params || {};
  const responseSchema = getModeResponseSchema(mode);

  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildPrompt(message, contextPayload, mode, {
              strictJsonOnly,
              history,
            }),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens,
      responseMimeType: "application/json",
      responseSchema,
    },
  };
}

function buildGeminiRepairPayload(rawReply, mode) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildRepairPrompt(rawReply, mode),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens: RETRY_MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseSchema: CHAT_RESPONSE_SCHEMA,
    },
  };
}

function readUpstreamErrorMessage(payload) {
  if (!payload || typeof payload !== "object") return "";
  const topLevelMessage = trimString(payload.message);
  if (topLevelMessage) return topLevelMessage;
  if (payload.error && typeof payload.error === "object") {
    const message = trimString(payload.error.message);
    if (message) return message;
  }
  return "";
}

function createTimeoutError(timeoutMs) {
  const timeoutError = new Error(`请求超时（>${timeoutMs}ms）。`);
  timeoutError.code = FETCH_TIMEOUT_CODE;
  return timeoutError;
}

function isTimeoutError(error) {
  return Boolean(error && typeof error === "object" && error.code === FETCH_TIMEOUT_CODE);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 12000) {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return fetch(url, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw createTimeoutError(timeout);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractBearerToken(request) {
  const authHeader = trimString(request?.headers?.get("authorization"));
  if (!authHeader) {
    return "";
  }

  const matched = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!matched) {
    return "";
  }

  return trimString(matched[1]);
}

function buildSupabaseAuthUserEndpoint(env) {
  const supabaseUrl = getEnvString(env, "SUPABASE_URL");
  if (!supabaseUrl) {
    return "";
  }

  return `${supabaseUrl.replace(/\/+$/, "")}${SUPABASE_AUTH_USER_PATH}`;
}

async function verifySupabaseAccessToken(request, env) {
  const token = extractBearerToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: CHAT_ERROR_CODES.UNAUTHORIZED,
      message: "缺少或无效的 Authorization Bearer Token。",
    };
  }

  const supabaseAnonKey = getEnvString(env, "SUPABASE_ANON_KEY");
  const authUserEndpoint = buildSupabaseAuthUserEndpoint(env);
  if (!supabaseAnonKey || !authUserEndpoint) {
    return {
      ok: false,
      status: 500,
      code: CHAT_ERROR_CODES.AUTH_CONFIG_MISSING,
      message: "服务端缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY，无法校验登录态。",
    };
  }

  let authResponse;
  try {
    authResponse = await fetchWithTimeout(
      authUserEndpoint,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
        },
      },
      AUTH_UPSTREAM_TIMEOUT_MS,
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return {
        ok: false,
        status: 504,
        code: CHAT_ERROR_CODES.AUTH_UPSTREAM_TIMEOUT,
        message: `登录态校验超时（>${AUTH_UPSTREAM_TIMEOUT_MS}ms），请稍后重试。`,
      };
    }

    return {
      ok: false,
      status: 502,
      code: CHAT_ERROR_CODES.AUTH_UPSTREAM_ERROR,
      message: `登录态校验请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
    };
  }

  const authPayload = await parseJsonSafe(authResponse);
  if (!authResponse.ok) {
    const reason = readUpstreamErrorMessage(authPayload) || "登录态无效或已过期，请重新登录。";
    return {
      ok: false,
      status: 401,
      code: CHAT_ERROR_CODES.UNAUTHORIZED,
      message: reason,
    };
  }

  const userId = trimString(authPayload?.id);
  if (!userId) {
    return {
      ok: false,
      status: 401,
      code: CHAT_ERROR_CODES.UNAUTHORIZED,
      message: "登录态无效或已过期，请重新登录。",
    };
  }

  return {
    ok: true,
    status: 200,
    code: "",
    message: "",
    user: {
      id: userId,
      email: trimString(authPayload?.email),
    },
  };
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}
function buildChatError(code, message, status, details = null) {
  const error = {
    code,
    message,
    status,
  };
  const safeDetails = details && typeof details === "object" ? details : null;
  const safeStage = trimString(safeDetails?.stage);
  if (safeStage === "first" || safeStage === "retry" || safeStage === "repair") {
    error.stage = safeStage;
  }
  const safeUpstreamStatus = Number(safeDetails?.upstreamStatus);
  if (Number.isFinite(safeUpstreamStatus) && safeUpstreamStatus > 0) {
    error.upstreamStatus = Math.floor(safeUpstreamStatus);
  }
  const safeDurationMs = Number(safeDetails?.durationMs);
  if (Number.isFinite(safeDurationMs) && safeDurationMs >= 0) {
    error.durationMs = Math.floor(safeDurationMs);
  }
  return error;
}

function mapGeminiUpstreamHttpError(status, upstreamMessage, diagnostics = null) {
  const safeStatus = Number(status);
  const safeMessage = trimString(upstreamMessage);
  const safeDiagnostics =
    diagnostics && typeof diagnostics === "object"
      ? {
          ...diagnostics,
          upstreamStatus: safeStatus,
        }
      : {
          upstreamStatus: safeStatus,
        };

  if (safeStatus === 401 || safeStatus === 403) {
    return buildChatError(
      CHAT_ERROR_CODES.UPSTREAM_AUTH_ERROR,
      safeMessage || "Gemini Key 无效或无权限，请检查 GEMINI_API_KEY 配置。",
      502,
      safeDiagnostics,
    );
  }

  if (safeStatus === 429) {
    return buildChatError(
      CHAT_ERROR_CODES.UPSTREAM_RATE_LIMIT,
      safeMessage || "Gemini 请求过于频繁或配额受限，请稍后重试。",
      429,
      safeDiagnostics,
    );
  }

  return buildChatError(
    CHAT_ERROR_CODES.UPSTREAM_ERROR,
    safeMessage || `Gemini 返回异常状态：HTTP ${safeStatus}`,
    502,
    safeDiagnostics,
  );
}

async function requestGeminiNonStreaming(model, key, upstreamPayload, options = null) {
  const stage = trimString(options?.stage);
  const startedAt = Date.now();
  const endpoint = buildGeminiEndpoint(model, false);

  let upstreamResponse;
  try {
    upstreamResponse = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify(upstreamPayload),
      },
      GEMINI_UPSTREAM_TIMEOUT_MS,
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return {
        ok: false,
        error: buildChatError(
          CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
          `Gemini 请求超时（>${GEMINI_UPSTREAM_TIMEOUT_MS}ms），请稍后重试。`,
          504,
          {
            stage,
            durationMs: Date.now() - startedAt,
          },
        ),
      };
    }
    return {
      ok: false,
      error: buildChatError(
        CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
        `Gemini 网络请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
        502,
        {
          stage,
          durationMs: Date.now() - startedAt,
        },
      ),
    };
  }

  const upstreamData = await parseJsonSafe(upstreamResponse);
  if (!upstreamResponse.ok) {
    const upstreamMessage = readUpstreamErrorMessage(upstreamData);
    return {
      ok: false,
      error: mapGeminiUpstreamHttpError(upstreamResponse.status, upstreamMessage, {
        stage,
        durationMs: Date.now() - startedAt,
      }),
    };
  }

  const picked = pickGeminiReply(upstreamData);
  return {
    ok: true,
    reply: picked.reply,
    finishReason: picked.finishReason,
  };
}

async function attemptRepairStructured(model, key, rawReply, mode) {
  const sourceText = trimString(rawReply);
  if (!sourceText) {
    return {
      ok: false,
      evaluation: null,
      error: null,
    };
  }

  const repairPayload = buildGeminiRepairPayload(sourceText, mode);
  const repairAttempt = await requestGeminiNonStreaming(model, key, repairPayload, {
    stage: "repair",
  });
  if (!repairAttempt.ok) {
    return {
      ok: false,
      evaluation: null,
      error: repairAttempt.error || null,
    };
  }

  return {
    ok: true,
    evaluation: evaluateGeminiOutput(repairAttempt.reply, repairAttempt.finishReason, mode),
    error: null,
  };
}

function buildAttemptDiagnostic(stage, evaluation, maxOutputTokens, elapsedMs) {
  const stageCandidate = trimString(stage);
  const normalizedStage = stageCandidate === "retry" || stageCandidate === "repair" ? stageCandidate : "first";
  const normalizedFormat = evaluation?.format === "structured" ? "structured" : "text_fallback";
  const formatReason = trimString(evaluation?.formatReason) || CHAT_FORMAT_REASONS.JSON_PARSE_FAILED;
  const finishReason = trimString(evaluation?.finishReason);
  const outputCharsRaw = Number(evaluation?.outputChars);
  const elapsedMsRaw = Number(elapsedMs);
  const maxOutputTokensRaw = Number(maxOutputTokens);
  return {
    stage: normalizedStage,
    format: normalizedFormat,
    formatReason,
    finishReason,
    outputChars: Number.isFinite(outputCharsRaw) && outputCharsRaw >= 0 ? Math.floor(outputCharsRaw) : 0,
    elapsedMs: Number.isFinite(elapsedMsRaw) && elapsedMsRaw >= 0 ? Math.floor(elapsedMsRaw) : 0,
    maxOutputTokens: Number.isFinite(maxOutputTokensRaw) && maxOutputTokensRaw > 0 ? Math.floor(maxOutputTokensRaw) : 0,
  };
}

function buildAttemptDiagnosticFromError(stage, error, maxOutputTokens, elapsedMs) {
  const code = trimString(error?.code).toLowerCase() || "upstream_error";
  return {
    stage: stage === "retry" || stage === "repair" ? stage : "first",
    format: "text_fallback",
    formatReason: code,
    finishReason: "",
    outputChars: 0,
    elapsedMs: Number.isFinite(Number(elapsedMs)) && Number(elapsedMs) >= 0 ? Math.floor(Number(elapsedMs)) : 0,
    maxOutputTokens: Number.isFinite(Number(maxOutputTokens)) && Number(maxOutputTokens) > 0 ? Math.floor(Number(maxOutputTokens)) : 0,
  };
}

function consumeSseChunk(chunk, state, onEventData) {
  const nextChunk = String(chunk || "");
  if (!nextChunk) return;

  state.buffer += nextChunk.replace(/\r\n/g, "\n");
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() || "";

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (state.dataLines.length > 0) {
        const eventData = state.dataLines.join("\n").trim();
        state.dataLines = [];
        if (eventData) {
          onEventData(eventData);
        }
      }
      continue;
    }

    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("data:")) {
      state.dataLines.push(line.slice(5).trimStart());
    }
  }
}

function flushSseState(state, onEventData) {
  if (state.buffer) {
    consumeSseChunk("\n", state, onEventData);
  }
  if (state.dataLines.length > 0) {
    const eventData = state.dataLines.join("\n").trim();
    state.dataLines = [];
    if (eventData) {
      onEventData(eventData);
    }
  }
}

async function requestGeminiStreaming(model, key, upstreamPayload, onDelta, options = null) {
  const stage = trimString(options?.stage);
  const startedAt = Date.now();
  const endpoint = buildGeminiEndpoint(model, true);

  let upstreamResponse;
  try {
    upstreamResponse = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify(upstreamPayload),
      },
      GEMINI_UPSTREAM_TIMEOUT_MS,
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return {
        ok: false,
        error: buildChatError(
          CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
          `Gemini 请求超时（>${GEMINI_UPSTREAM_TIMEOUT_MS}ms），请稍后重试。`,
          504,
          {
            stage,
            durationMs: Date.now() - startedAt,
          },
        ),
      };
    }
    return {
      ok: false,
      error: buildChatError(
        CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
        `Gemini 网络请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
        502,
        {
          stage,
          durationMs: Date.now() - startedAt,
        },
      ),
    };
  }

  if (!upstreamResponse.ok) {
    const upstreamData = await parseJsonSafe(upstreamResponse);
    const upstreamMessage = readUpstreamErrorMessage(upstreamData);
    return {
      ok: false,
      error: mapGeminiUpstreamHttpError(upstreamResponse.status, upstreamMessage, {
        stage,
        durationMs: Date.now() - startedAt,
      }),
    };
  }

  if (!upstreamResponse.body || typeof upstreamResponse.body.getReader !== "function") {
    return {
      ok: false,
      error: buildChatError(CHAT_ERROR_CODES.UPSTREAM_ERROR, "Gemini 流式响应不可读。", 502, {
        stage,
        durationMs: Date.now() - startedAt,
      }),
    };
  }

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  const sseState = { buffer: "", dataLines: [] };
  let finishReason = "";
  let fullReply = "";
  let hasDelta = false;

  const handleEventData = (eventData) => {
    if (eventData === "[DONE]") {
      return;
    }

    const candidate = parseJsonCandidate(eventData);
    if (!candidate) {
      return;
    }
    const picked = pickGeminiReply(candidate);
    if (picked.finishReason) {
      finishReason = picked.finishReason;
    }

    const piece = trimString(picked.reply);
    if (!piece) {
      return;
    }

    let delta = piece;
    if (fullReply && piece.startsWith(fullReply)) {
      delta = piece.slice(fullReply.length);
    }

    if (!delta && piece !== fullReply) {
      delta = piece;
    }

    if (!delta) {
      return;
    }

    fullReply += delta;
    hasDelta = true;
    if (typeof onDelta === "function") {
      onDelta(delta);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      consumeSseChunk(chunk, sseState, handleEventData);
    }

    const flushChunk = decoder.decode();
    if (flushChunk) {
      consumeSseChunk(flushChunk, sseState, handleEventData);
    }
    flushSseState(sseState, handleEventData);
  } catch (error) {
    return {
      ok: false,
      error: buildChatError(
        CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
        `Gemini 流式读取失败：${error instanceof Error ? error.message : "请稍后重试"}`,
        502,
        {
          stage,
          durationMs: Date.now() - startedAt,
        },
      ),
      hasDelta,
      partialReply: fullReply,
      finishReason,
    };
  } finally {
    try {
      reader.releaseLock();
    } catch (_error) {
      // no-op
    }
  }

  return {
    ok: true,
    reply: fullReply,
    finishReason,
    hasDelta,
  };
}

async function generateChatResponse(model, key, message, contextPayload, mode, history) {
  const startedAt = Date.now();
  const hasBudgetForNextAttempt = () => Date.now() - startedAt < TOTAL_CHAT_BUDGET_MS;
  const stageDurations = {};
  const modeTokenProfile = getModeTokenProfile(mode, trimString(message).length);
  const safeContextChars = safeJsonLength(contextPayload);
  const safeHistoryChars = safeJsonLength(history);
  const safeMode = sanitizeMode(mode);
  let attemptCount = 0;
  let retryCount = 0;
  let repairApplied = false;
  let repairSucceeded = false;
  let finalStage = "first";
  let retryEvaluated = false;
  const attemptDiagnostics = [];

  const firstAttemptPayload = buildGeminiPayload({
    message,
    contextPayload,
    history,
    mode,
    maxOutputTokens: modeTokenProfile.first,
    strictJsonOnly: false,
  });
  attemptCount += 1;
  const firstStageStartedAt = Date.now();
  const firstAttempt = await requestGeminiNonStreaming(model, key, firstAttemptPayload, {
    stage: "first",
  });
  stageDurations.first = Date.now() - firstStageStartedAt;
  if (!firstAttempt.ok) {
    return firstAttempt;
  }

  let finalEvaluation = evaluateGeminiOutput(firstAttempt.reply, firstAttempt.finishReason, safeMode);
  attemptDiagnostics.push(
    buildAttemptDiagnostic("first", finalEvaluation, modeTokenProfile.first, stageDurations.first),
  );
  const firstElapsed = stageDurations.first;
  const shouldTriggerRetry =
    finalEvaluation.formatReason === CHAT_FORMAT_REASONS.JSON_PARSE_FAILED ||
    finalEvaluation.formatReason === CHAT_FORMAT_REASONS.OUTPUT_TRUNCATED;
  if (shouldTriggerRetry && hasBudgetForNextAttempt() && firstElapsed < FIRST_STAGE_BUDGET_MS) {
    retryCount = 1;
    const retryPayload = buildGeminiPayload({
      message,
      contextPayload,
      history,
      mode,
      maxOutputTokens: modeTokenProfile.retry,
      strictJsonOnly: true,
    });
    attemptCount += 1;
    const retryStageStartedAt = Date.now();
    const retryAttempt = await requestGeminiNonStreaming(model, key, retryPayload, {
      stage: "retry",
    });
    stageDurations.retry = Date.now() - retryStageStartedAt;
    if (retryAttempt.ok) {
      const retryEvaluation = evaluateGeminiOutput(retryAttempt.reply, retryAttempt.finishReason, safeMode);
      retryEvaluated = true;
      attemptDiagnostics.push(
        buildAttemptDiagnostic("retry", retryEvaluation, modeTokenProfile.retry, stageDurations.retry),
      );
      if (retryEvaluation.format === "structured" || retryEvaluation.reply) {
        finalEvaluation = retryEvaluation;
        finalStage = "retry";
      }
    } else {
      attemptDiagnostics.push(
        buildAttemptDiagnosticFromError("retry", retryAttempt.error, modeTokenProfile.retry, stageDurations.retry),
      );
    }
  }

  const elapsedAfterRetry = Date.now() - startedAt;
  const allowSchemaInvalidRepair =
    safeMode !== CHAT_MODES.BRIEFING &&
    retryEvaluated &&
    finalStage === "retry" &&
    finalEvaluation.formatReason === CHAT_FORMAT_REASONS.SCHEMA_INVALID &&
    elapsedAfterRetry < SCHEMA_INVALID_REPAIR_BUDGET_MS &&
    Number(finalEvaluation.outputChars) >= SCHEMA_INVALID_REPAIR_MIN_OUTPUT_CHARS;
  const shouldAttemptRepair =
    finalEvaluation.format !== "structured" &&
    trimString(finalEvaluation.reply) &&
    hasBudgetForNextAttempt() &&
    elapsedAfterRetry < FIRST_AND_RETRY_BUDGET_MS &&
    (finalEvaluation.formatReason === CHAT_FORMAT_REASONS.JSON_PARSE_FAILED ||
      finalEvaluation.formatReason === CHAT_FORMAT_REASONS.OUTPUT_TRUNCATED ||
      allowSchemaInvalidRepair);
  if (shouldAttemptRepair) {
    repairApplied = true;
    attemptCount += 1;
    const repairStageStartedAt = Date.now();
    const repairAttempt = await attemptRepairStructured(model, key, finalEvaluation.reply, mode);
    stageDurations.repair = Date.now() - repairStageStartedAt;
    if (repairAttempt.ok && repairAttempt.evaluation) {
      attemptDiagnostics.push(
        buildAttemptDiagnostic("repair", repairAttempt.evaluation, RETRY_MAX_OUTPUT_TOKENS, stageDurations.repair),
      );
      if (repairAttempt.evaluation.format === "structured") {
        finalEvaluation = repairAttempt.evaluation;
        repairSucceeded = true;
        finalStage = "repair";
      }
    } else {
      attemptDiagnostics.push(
        buildAttemptDiagnosticFromError("repair", repairAttempt.error, RETRY_MAX_OUTPUT_TOKENS, stageDurations.repair),
      );
    }
  }

  return {
    ok: true,
    evaluation: finalEvaluation,
    retryCount,
    repairApplied,
    repairSucceeded,
    attemptCount,
    totalDurationMs: Date.now() - startedAt,
    stageDurations,
    finalStage,
    contextChars: safeContextChars,
    historyChars: safeHistoryChars,
    attemptDiagnostics,
  };
}

function writeNdjsonEvent(controller, encoder, event) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

export async function onRequestPost(context) {
  const requestId = crypto.randomUUID();
  const authResult = await verifySupabaseAccessToken(context.request, context.env);
  if (!authResult.ok) {
    return errorResponse(authResult.code, authResult.message, authResult.status, requestId);
  }

  const key = getEnvString(context.env, "GEMINI_API_KEY");
  const model = sanitizeModelName(getEnvString(context.env, "GEMINI_MODEL"));

  if (!key) {
    return errorResponse(CHAT_ERROR_CODES.CONFIG_MISSING, "服务端缺少 GEMINI_API_KEY 配置。", 500, requestId);
  }

  let body;
  try {
    body = await context.request.json();
  } catch (_error) {
    return errorResponse(CHAT_ERROR_CODES.BAD_REQUEST, "请求体必须是合法 JSON。", 400, requestId);
  }

  const message = trimString(body && body.message);
  const contextPayload = sanitizeContextPayload(body && body.context);
  const history = sanitizeHistoryList(body && body.history);
  const mode = sanitizeMode(body && body.mode);
  const stream = Boolean(body && body.stream);
  const requestContextChars = safeJsonLength(contextPayload);
  const requestHistoryChars = safeJsonLength(history);

  if (!message) {
    return errorResponse(CHAT_ERROR_CODES.MESSAGE_REQUIRED, "message 不能为空。", 400, requestId);
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(
      CHAT_ERROR_CODES.MESSAGE_TOO_LONG,
      `message 过长，最多 ${MAX_MESSAGE_LENGTH} 个字符。`,
      400,
      requestId,
    );
  }

  if (stream) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start: async (controller) => {
        let hasDelta = false;
        const streamStartedAt = Date.now();
        const emit = (event) => writeNdjsonEvent(controller, encoder, event);
        const modeTokenProfile = getModeTokenProfile(mode, message.length);

        try {
          emit({ type: "start", requestId, mode });
          emit({ type: "thinking", requestId, message: "AI 思考中..." });

          const streamPayload = buildGeminiPayload({
            message,
            contextPayload,
            history,
            mode,
            maxOutputTokens: modeTokenProfile.first,
            strictJsonOnly: false,
          });

          const streamResult = await requestGeminiStreaming(
            model,
            key,
            streamPayload,
            (delta) => {
              const safeDelta = typeof delta === "string" ? delta : String(delta || "");
              if (!safeDelta) return;
              hasDelta = true;
              emit({
                type: "delta",
                requestId,
                text: safeDelta,
              });
            },
            {
              stage: "first",
            },
          );

          if (!streamResult.ok) {
            if (!hasDelta) {
              const fallback = await generateChatResponse(model, key, message, contextPayload, mode, history);
              if (fallback.ok) {
                const payload = buildChatSuccessPayload({
                  evaluation: fallback.evaluation,
                  model,
                  requestId,
                  mode,
                  retryCount: fallback.retryCount,
                  repairApplied: fallback.repairApplied,
                  repairSucceeded: fallback.repairSucceeded,
                  attemptCount: fallback.attemptCount,
                  totalDurationMs: fallback.totalDurationMs,
                  stageDurations: fallback.stageDurations,
                  finalStage: fallback.finalStage,
                  contextChars: fallback.contextChars,
                  historyChars: fallback.historyChars,
                });
                emit({
                  type: "done",
                  ...payload,
                });
                controller.close();
                return;
              }
            }

            const errorInfo = streamResult.error || buildChatError("UNKNOWN_ERROR", "流式处理失败。", 500);
            emit({
              type: "error",
              requestId,
              error: {
                code: errorInfo.code,
                message: errorInfo.message,
                stage: trimString(errorInfo.stage),
                upstreamStatus: Number.isFinite(Number(errorInfo.upstreamStatus))
                  ? Math.floor(Number(errorInfo.upstreamStatus))
                  : undefined,
                durationMs: Number.isFinite(Number(errorInfo.durationMs))
                  ? Math.floor(Number(errorInfo.durationMs))
                  : undefined,
              },
            });
            controller.close();
            return;
          }

          if (!streamResult.hasDelta) {
            const fallback = await generateChatResponse(model, key, message, contextPayload, mode, history);
            if (fallback.ok) {
              const payload = buildChatSuccessPayload({
                evaluation: fallback.evaluation,
                model,
                requestId,
                mode,
                retryCount: fallback.retryCount,
                repairApplied: fallback.repairApplied,
                repairSucceeded: fallback.repairSucceeded,
                attemptCount: fallback.attemptCount,
                totalDurationMs: fallback.totalDurationMs,
                stageDurations: fallback.stageDurations,
                finalStage: fallback.finalStage,
                contextChars: fallback.contextChars,
                historyChars: fallback.historyChars,
              });
              emit({
                type: "done",
                ...payload,
              });
              controller.close();
              return;
            }

            emit({
              type: "error",
              requestId,
              error: {
                code: fallback.error.code,
                message: fallback.error.message,
                stage: trimString(fallback.error.stage),
                upstreamStatus: Number.isFinite(Number(fallback.error.upstreamStatus))
                  ? Math.floor(Number(fallback.error.upstreamStatus))
                  : undefined,
                durationMs: Number.isFinite(Number(fallback.error.durationMs))
                  ? Math.floor(Number(fallback.error.durationMs))
                  : undefined,
              },
            });
            controller.close();
            return;
          }

          const streamEvaluation = evaluateGeminiOutput(streamResult.reply, streamResult.finishReason, mode);
          const payload = buildChatSuccessPayload({
            evaluation: streamEvaluation,
            model,
            requestId,
            mode,
            retryCount: 0,
            repairApplied: false,
            repairSucceeded: false,
            attemptCount: 1,
            totalDurationMs: Date.now() - streamStartedAt,
            stageDurations: {
              first: Date.now() - streamStartedAt,
            },
            finalStage: "first",
            contextChars: requestContextChars,
            historyChars: requestHistoryChars,
            attemptDiagnostics: [
              buildAttemptDiagnostic("first", streamEvaluation, modeTokenProfile.first, Date.now() - streamStartedAt),
            ],
          });
          emit({
            type: "done",
            ...payload,
          });
          controller.close();
        } catch (error) {
          emit({
            type: "error",
            requestId,
            error: {
              code: CHAT_ERROR_CODES.UPSTREAM_ERROR,
              message: `流式处理异常：${error instanceof Error ? error.message : "请稍后重试"}`,
            },
          });
          controller.close();
        }
      },
    });

    return ndjsonResponse(readable, requestId);
  }

  const generated = await generateChatResponse(model, key, message, contextPayload, mode, history);
  if (!generated.ok) {
    return errorResponse(generated.error.code, generated.error.message, generated.error.status, requestId, {
      stage: generated.error.stage,
      upstreamStatus: generated.error.upstreamStatus,
      durationMs: generated.error.durationMs,
    });
  }

  return jsonResponse(
    buildChatSuccessPayload({
      evaluation: generated.evaluation,
      model,
      requestId,
      mode,
      retryCount: generated.retryCount,
      repairApplied: generated.repairApplied,
      repairSucceeded: generated.repairSucceeded,
      attemptCount: generated.attemptCount,
      totalDurationMs: generated.totalDurationMs,
      stageDurations: generated.stageDurations,
      finalStage: generated.finalStage,
      contextChars: generated.contextChars,
      historyChars: generated.historyChars,
      attemptDiagnostics: generated.attemptDiagnostics,
    }),
    200,
    requestId,
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS",
    },
  });
}
