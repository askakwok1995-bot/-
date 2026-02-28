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
const FIRST_TRANSPORT_RETRY_BASE_DELAY_MS = 350;
const FIRST_TRANSPORT_RETRY_JITTER_MS = 150;
const FIRST_TRANSPORT_MIN_REMAINING_BUDGET_MS = 2500;
const FIRST_TRANSPORT_TIMEOUT_MIN_REMAINING_BUDGET_MS = 9000;
const FIRST_TRANSPORT_TIMEOUT_RETRY_TIMEOUT_MS = 12000;
const FIRST_TRANSPORT_TIMEOUT_RETRY_BUDGET_BUFFER_MS = 1000;
const FETCH_TIMEOUT_CODE = "FETCH_TIMEOUT";
const DEFAULT_MAX_OUTPUT_TOKENS = 1536;
const RETRY_MAX_OUTPUT_TOKENS = 2048;
const NATURAL_MAX_OUTPUT_TOKENS = 768;
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
const CHAT_REQUEST_MODES = Object.freeze({
  AUTO: "auto",
  BRIEFING: CHAT_MODES.BRIEFING,
  DIAGNOSIS: CHAT_MODES.DIAGNOSIS,
  ACTION_PLAN: CHAT_MODES.ACTION_PLAN,
});
const RESPONSE_ACTIONS = Object.freeze({
  NATURAL: "natural_answer",
  STRUCTURED: "structured_answer",
  CLARIFY: "clarify",
});
const BUSINESS_INTENTS = Object.freeze({
  CHAT: "chat",
  BRIEFING: CHAT_MODES.BRIEFING,
  DIAGNOSIS: CHAT_MODES.DIAGNOSIS,
  ACTION_PLAN: CHAT_MODES.ACTION_PLAN,
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
const SHORT_CIRCUIT_REASONS = Object.freeze({
  EMPTY_CONTEXT: "empty_context",
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
  const safeFirstTransportAttempts = Number(safeDetails?.firstTransportAttempts);
  if (Number.isFinite(safeFirstTransportAttempts) && safeFirstTransportAttempts > 0) {
    errorPayload.firstTransportAttempts = Math.floor(safeFirstTransportAttempts);
  }
  const safeFirstTransportStatuses = normalizeStatusCodeList(safeDetails?.firstTransportStatuses);
  if (safeFirstTransportStatuses.length > 0) {
    errorPayload.firstTransportStatuses = safeFirstTransportStatuses;
  }
  if (typeof safeDetails?.firstTransportRetryApplied === "boolean") {
    errorPayload.firstTransportRetryApplied = safeDetails.firstTransportRetryApplied;
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

function normalizeStatusCodeList(rawStatuses) {
  if (!Array.isArray(rawStatuses)) {
    return [];
  }
  return rawStatuses
    .map((status) => Number(status))
    .filter((status) => Number.isFinite(status) && status > 0)
    .map((status) => Math.floor(status));
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

function sanitizeRequestedMode(rawMode) {
  const mode = trimString(rawMode).toLowerCase();
  if (
    mode === CHAT_REQUEST_MODES.AUTO ||
    mode === CHAT_REQUEST_MODES.BRIEFING ||
    mode === CHAT_REQUEST_MODES.DIAGNOSIS ||
    mode === CHAT_REQUEST_MODES.ACTION_PLAN
  ) {
    return mode;
  }
  return CHAT_REQUEST_MODES.AUTO;
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

function sanitizeStringList(value, maxItems = 6) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => trimString(item))
    .filter((item) => item)
    .slice(0, maxItems);
}

function sanitizeEvidenceRefs(value, maxItems = 2) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const label = trimString(item.label);
      const valueText = trimString(item.value);
      const source = trimString(item.source) || "reportRecords";
      if (!label || !valueText) {
        return null;
      }
      return { label, value: valueText, source };
    })
    .filter((item) => item !== null)
    .slice(0, maxItems);
}

function sanitizeScope(rawScope) {
  const scope = rawScope && typeof rawScope === "object" ? rawScope : {};
  const levelCandidate = trimString(scope.level).toLowerCase();
  const levelSet = new Set(["overall", "product", "hospital", "mixed", "unknown"]);
  return {
    period: {
      startYm: trimString(scope?.period?.startYm),
      endYm: trimString(scope?.period?.endYm),
      label: trimString(scope?.period?.label),
      isExplicit: Boolean(scope?.period?.isExplicit),
    },
    entities: {
      products: sanitizeStringList(scope?.entities?.products, 8),
      hospitals: sanitizeStringList(scope?.entities?.hospitals, 8),
      regions: sanitizeStringList(scope?.entities?.regions, 8),
    },
    level: levelSet.has(levelCandidate) ? levelCandidate : "unknown",
  };
}

function sanitizeSession(rawSession) {
  const session = rawSession && typeof rawSession === "object" ? rawSession : {};
  const intentCandidate = trimString(session.lastIntent).toLowerCase();
  const actionCandidate = trimString(session.lastResponseAction).toLowerCase();
  return {
    lastIntent:
      intentCandidate === BUSINESS_INTENTS.BRIEFING ||
      intentCandidate === BUSINESS_INTENTS.DIAGNOSIS ||
      intentCandidate === BUSINESS_INTENTS.ACTION_PLAN ||
      intentCandidate === BUSINESS_INTENTS.CHAT
        ? intentCandidate
        : "",
    lastResponseAction:
      actionCandidate === RESPONSE_ACTIONS.NATURAL ||
      actionCandidate === RESPONSE_ACTIONS.STRUCTURED ||
      actionCandidate === RESPONSE_ACTIONS.CLARIFY
        ? actionCandidate
        : "",
    lastScope: session.lastScope && typeof session.lastScope === "object" ? session.lastScope : null,
    unresolvedClarify: trimString(session.unresolvedClarify),
  };
}

function sanitizeBusiness(rawBusiness) {
  const business = rawBusiness && typeof rawBusiness === "object" ? rawBusiness : {};
  const legacyContext =
    business.legacyContext && typeof business.legacyContext === "object" ? business.legacyContext : {};
  return {
    overview: business.overview && typeof business.overview === "object" ? business.overview : {},
    trend: business.trend && typeof business.trend === "object" ? business.trend : {},
    evidenceTop: sanitizeEvidenceRefs(business.evidenceTop, 3),
    riskTop: sanitizeStringList(business.riskTop, 4),
    outline: business.outline && typeof business.outline === "object" ? business.outline : {},
    legacyContext,
  };
}

function inferHasDataFromLegacyContext(legacyContext) {
  if (legacyContext && typeof legacyContext === "object") {
    const explicitFlag = legacyContext?.analysis?.meta?.hasData;
    if (explicitFlag === true || explicitFlag === false) {
      return explicitFlag;
    }
  }
  return hasEffectiveAnalysisContext(legacyContext);
}

function sanitizeQuality(rawQuality, legacyContext) {
  const quality = rawQuality && typeof rawQuality === "object" ? rawQuality : {};
  const confidenceCandidate = trimString(quality.confidence).toLowerCase();
  const sourceCandidate = trimString(quality.source);
  const hasData =
    typeof quality.hasData === "boolean" ? quality.hasData : inferHasDataFromLegacyContext(legacyContext);
  return {
    hasData,
    confidence:
      confidenceCandidate === "high" || confidenceCandidate === "low"
        ? confidenceCandidate
        : "medium",
    missingFields: sanitizeStringList(quality.missingFields, 8),
    source: sourceCandidate || "reportRecords",
  };
}

function isContextV1(rawContext) {
  if (!rawContext || typeof rawContext !== "object" || Array.isArray(rawContext)) {
    return false;
  }
  return Boolean(rawContext.query || rawContext.scope || rawContext.session || rawContext.business || rawContext.quality);
}

function pickLegacyContextFromV1Business(business) {
  if (business?.legacyContext && hasMeaningfulContextObject(business.legacyContext)) {
    return business.legacyContext;
  }

  const fallback = {
    analysis: business?.overview?.analysis || {},
    kpi: business?.overview?.kpi || business?.overview || {},
    trendOverview: business?.trend?.trendOverview || business?.trend || {},
    trend: business?.trend?.trend || business?.trend || {},
    risk: {
      ok: Array.isArray(business?.riskTop) ? business.riskTop.length > 0 : false,
      summary: Array.isArray(business?.riskTop) ? business.riskTop.join("；") : "",
      items: Array.isArray(business?.riskTop)
        ? business.riskTop.map((item, index) => ({
            id: `risk_${index + 1}`,
            title: "风险提示",
            summary: item,
          }))
        : [],
    },
    overviewMetric: business?.overview?.overviewMetric || null,
    keyEvidence:
      Array.isArray(business?.evidenceTop) && business.evidenceTop.length > 0
        ? business.evidenceTop[0]
        : null,
    outline: business?.outline || {},
  };
  return fallback;
}

function normalizeContextV1(rawContext, message) {
  const raw = rawContext && typeof rawContext === "object" ? rawContext : {};
  if (isContextV1(raw)) {
    const business = sanitizeBusiness(raw.business);
    const legacyContext = pickLegacyContextFromV1Business(business);
    return {
      query: {
        text: trimString(raw?.query?.text) || trimString(message),
      },
      scope: sanitizeScope(raw.scope),
      session: sanitizeSession(raw.session),
      business,
      quality: sanitizeQuality(raw.quality, legacyContext),
      legacyContext,
    };
  }

  const legacyContext = sanitizeContextPayload(rawContext);
  const derivedEvidence =
    legacyContext?.keyEvidence && typeof legacyContext.keyEvidence === "object"
      ? sanitizeEvidenceRefs([legacyContext.keyEvidence], 1)
      : [];
  const derivedRisks = sanitizeStringList(
    Array.isArray(legacyContext?.risk?.items)
      ? legacyContext.risk.items.map((item) => trimString(item?.summary || item?.title))
      : [],
    3,
  );
  return {
    query: {
      text: trimString(message),
    },
    scope: sanitizeScope(null),
    session: sanitizeSession(null),
    business: {
      overview: legacyContext,
      trend: legacyContext?.trend || legacyContext?.trendOverview || {},
      evidenceTop: derivedEvidence,
      riskTop: derivedRisks,
      outline: legacyContext?.outline || {},
      legacyContext,
    },
    quality: sanitizeQuality(null, legacyContext),
    legacyContext,
  };
}

function hasPeriodSignal(message) {
  const text = trimString(message);
  if (!text) {
    return false;
  }
  return /(同比|环比|本月|上月|季度|q[1-4]|趋势|变化|增长|下降|今年|去年|月度|季度)/i.test(text);
}

function resolveResponseAction(requestedMode, message, contextV1) {
  const explicitMode = sanitizeMode(requestedMode);
  if (requestedMode !== CHAT_REQUEST_MODES.AUTO) {
    return {
      responseAction: RESPONSE_ACTIONS.STRUCTURED,
      businessIntent: explicitMode,
      structuredMode: explicitMode,
      ruleId: "explicit_mode",
      routeSource: "explicit",
      confidence: "high",
    };
  }

  if (contextV1?.quality?.hasData === false) {
    return {
      responseAction: RESPONSE_ACTIONS.CLARIFY,
      businessIntent: BUSINESS_INTENTS.CHAT,
      structuredMode: "",
      ruleId: "clarify_no_data",
      routeSource: "rule",
      confidence: "high",
      clarifyReason: "no_data",
    };
  }

  const periodExplicit = Boolean(contextV1?.scope?.period?.isExplicit);
  const hasSessionPeriod =
    Boolean(trimString(contextV1?.session?.lastScope?.period?.startYm)) ||
    Boolean(trimString(contextV1?.session?.lastScope?.period?.endYm)) ||
    Boolean(trimString(contextV1?.session?.lastScope?.period?.label));
  if (hasPeriodSignal(message) && !periodExplicit && !hasSessionPeriod) {
    return {
      responseAction: RESPONSE_ACTIONS.CLARIFY,
      businessIntent: BUSINESS_INTENTS.CHAT,
      structuredMode: "",
      ruleId: "clarify_missing_period",
      routeSource: "rule",
      confidence: "high",
      clarifyReason: "missing_period",
    };
  }

  const safeMessage = trimString(message);
  if (
    /(简报|汇报|周报|月报|总结|概览|诊断|分析|原因|为什么|根因|瓶颈|异常|行动|计划|执行|落地|负责人|步骤|清单)/i.test(
      safeMessage,
    )
  ) {
    let structuredMode = CHAT_MODES.BRIEFING;
    let ruleId = "structured_briefing";
    if (/(行动|计划|执行|落地|负责人|步骤|清单|里程碑)/i.test(safeMessage)) {
      structuredMode = CHAT_MODES.ACTION_PLAN;
      ruleId = "structured_action_plan";
    } else if (/(诊断|分析|原因|为什么|根因|瓶颈|异常|下滑|波动)/i.test(safeMessage)) {
      structuredMode = CHAT_MODES.DIAGNOSIS;
      ruleId = "structured_diagnosis";
    }
    return {
      responseAction: RESPONSE_ACTIONS.STRUCTURED,
      businessIntent: structuredMode,
      structuredMode,
      ruleId,
      routeSource: "rule",
      confidence: "medium",
    };
  }

  return {
    responseAction: RESPONSE_ACTIONS.NATURAL,
    businessIntent: BUSINESS_INTENTS.CHAT,
    structuredMode: "",
    ruleId: "default_chat",
    routeSource: "rule",
    confidence: "high",
  };
}

function buildClarifyResponse(contextV1, reason) {
  if (reason === "no_data") {
    return {
      surfaceReply: "我现在拿不到可用业务数据。请先同步销售记录或目标配置，我再给你可执行的结论。",
      internalStructured: {
        kind: "clarify",
        missingSlot: "data",
        confidence: "high",
        question: "请先确认是否已导入本期销售数据与目标口径。",
      },
    };
  }

  const currentPeriod = trimString(contextV1?.scope?.period?.label);
  return {
    surfaceReply: currentPeriod
      ? `你想看的时间范围是哪个？当前可用范围是“${currentPeriod}”，我也可以按你指定的月份或季度重算。`
      : "你想看的时间范围是哪个？例如“本月 / 上月 / 2026Q1”。确认后我再继续回答。",
    internalStructured: {
      kind: "clarify",
      missingSlot: "period",
      confidence: "high",
      question: "请补充 period（例如本月、上月、季度）。",
    },
  };
}

function buildNaturalResponse(contextV1, message, modelReply = "") {
  const evidenceRefs = sanitizeEvidenceRefs(contextV1?.business?.evidenceTop, 2);
  const trendSummary =
    trimString(contextV1?.business?.trend?.summary) || trimString(contextV1?.business?.overview?.trendOverview?.summary);
  const overviewSummary =
    trimString(contextV1?.business?.overview?.kpi?.summary) || trimString(contextV1?.business?.overview?.summary);
  const fallbackSummary = contextV1?.quality?.hasData
    ? "已基于当前业务数据给出简要结论。"
    : "当前数据不足，以下回复仅供参考。";
  const summary = overviewSummary || trendSummary || fallbackSummary;
  const evidenceText =
    evidenceRefs.length > 0 ? `关键依据：${evidenceRefs.map((item) => `${item.label}${item.value}`).join("；")}。` : "";
  const disclaimerList = [];
  if (!contextV1?.quality?.hasData) {
    disclaimerList.push("数据不足");
  }
  if (Array.isArray(contextV1?.quality?.missingFields) && contextV1.quality.missingFields.length > 0) {
    disclaimerList.push("部分口径信息不完整");
  }
  const disclaimerText = disclaimerList.length > 0 ? `说明：${disclaimerList.join("；")}。` : "";
  const questionHint = trimString(message) ? "" : "请告诉我你想看的指标或时间范围。";
  const fallbackReply = [summary, evidenceText, disclaimerText, questionHint].filter((item) => item).join(" ");
  const modelText = trimString(modelReply);
  const surfaceReply = modelText || fallbackReply;
  const summaryText = modelText ? trimString(modelText.split(/[。！？\n]/)[0]) || modelText.slice(0, 120) : summary;

  return {
    surfaceReply,
    internalStructured: {
      kind: "natural",
      summary: summaryText,
      evidenceRefs,
      confidence: contextV1?.quality?.confidence || "medium",
      scopeUsed: {
        period: trimString(contextV1?.scope?.period?.label),
        entities: [
          ...sanitizeStringList(contextV1?.scope?.entities?.products, 4),
          ...sanitizeStringList(contextV1?.scope?.entities?.hospitals, 4),
          ...sanitizeStringList(contextV1?.scope?.entities?.regions, 4),
        ].slice(0, 6),
      },
      disclaimers: disclaimerList,
    },
  };
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

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasMeaningfulContextObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function hasMeaningfulContextArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasEffectiveAnalysisContext(contextPayload) {
  if (!contextPayload || typeof contextPayload !== "object" || Array.isArray(contextPayload)) {
    return false;
  }
  const topLevelKeys = Object.keys(contextPayload);
  if (topLevelKeys.length === 0) {
    return false;
  }

  const knownKeys = new Set([
    "analysis",
    "kpi",
    "risk",
    "trendOverview",
    "trend",
    "product",
    "hospital",
    "overviewMetric",
    "keyEvidence",
    "outline",
  ]);
  const hasUnknownTopLevelKeys = topLevelKeys.some((key) => !knownKeys.has(key));
  if (hasUnknownTopLevelKeys) {
    return true;
  }

  const hasDataFlag = contextPayload?.analysis?.meta?.hasData;
  if (hasDataFlag === true) {
    return true;
  }
  if (hasDataFlag === false) {
    return false;
  }

  const summaryCandidates = [
    contextPayload?.kpi?.summary,
    contextPayload?.risk?.summary,
    contextPayload?.trendOverview?.summary,
    contextPayload?.trend?.summary,
    contextPayload?.product?.summary,
    contextPayload?.hospital?.summary,
    contextPayload?.outline?.summary,
  ];
  if (summaryCandidates.some((value) => Boolean(trimString(value)))) {
    return true;
  }

  const itemCandidates = [
    contextPayload?.kpi?.items,
    contextPayload?.risk?.items,
    contextPayload?.trend?.items,
    contextPayload?.product?.items,
    contextPayload?.hospital?.items,
    contextPayload?.outline?.sections,
  ];
  if (itemCandidates.some((value) => hasMeaningfulContextArray(value))) {
    return true;
  }

  if (hasMeaningfulContextObject(contextPayload?.overviewMetric) || hasMeaningfulContextObject(contextPayload?.keyEvidence)) {
    return true;
  }

  if (hasMeaningfulContextObject(contextPayload?.kpi?.metrics)) {
    const metricValues = Object.values(contextPayload.kpi.metrics || {});
    if (metricValues.some((value) => hasFiniteNumber(value))) {
      return true;
    }
  }

  return false;
}

function buildEmptyContextStructured(mode) {
  const safeMode = sanitizeMode(mode);
  if (safeMode === CHAT_MODES.DIAGNOSIS) {
    return {
      summary:
        "当前上下文缺少诊断所需的销售与结构数据，暂无法判断波动成因或瓶颈环节。请补充按产品、医院、月份拆分的金额与达成信息后，再执行诊断分析并输出可验证结论。",
      highlights: ["诊断输入数据不足"],
      evidence: [
        {
          label: "数据可用性",
          value: "缺少有效分析上下文",
          insight: "未收到可用于定位原因的销售明细与对比数据",
        },
      ],
      risks: ["在数据不足情况下推进诊断，可能导致错误归因和错误决策。"],
      actions: [
        {
          title: "补齐诊断数据",
          owner: "销售运营",
          timeline: "本周内",
          metric: "完成产品/医院/月度数据补录并通过校验",
        },
      ],
      nextQuestions: ["可否先提供最近三个月按产品与医院拆分的金额与达成率？"],
    };
  }

  if (safeMode === CHAT_MODES.ACTION_PLAN) {
    return {
      summary:
        "当前缺少生成行动清单所需的业务数据与优先级信息，暂无法输出可信的执行计划。请先补充目标差距、重点客户进展与资源约束，再生成可落地的行动方案。",
      highlights: ["行动计划输入不足"],
      evidence: [
        {
          label: "计划依据",
          value: "上下文为空或关键字段缺失",
          insight: "无法完成任务拆解与负责人分配",
        },
      ],
      risks: ["在缺少依据时直接排计划，执行优先级和资源分配容易失真。"],
      actions: [
        {
          title: "补齐行动计划输入",
          owner: "销售负责人",
          timeline: "本周内",
          metric: "目标差距、客户进展、资源约束三类数据齐全",
        },
      ],
      nextQuestions: ["是否先确认本周最关键的目标缺口与优先客户名单？"],
    };
  }

  return {
    summary:
      "当前未检测到可用于本月简报的销售数据与目标口径，暂无法形成可信的业绩结论。建议先同步本月销售记录、目标配置和重点医院进展后，再生成正式的阶段性简报。",
    highlights: ["简报输入数据不足"],
    evidence: [
      {
        label: "数据状态",
        value: "未收到有效分析上下文",
        insight: "缺少本月销售与目标数据，无法形成可靠结论",
      },
    ],
    risks: ["在数据不足时输出简报，可能造成经营判断偏差。"],
    actions: [
      {
        title: "补齐本月简报数据",
        owner: "销售运营",
        timeline: "本周内",
        metric: "销售记录与目标口径完整度达到100%",
      },
    ],
    nextQuestions: ["何时可以提供本月完整销售数据与目标配置？"],
  };
}

function buildEmptyContextShortCircuitEvaluation(contextPayload, mode) {
  if (hasEffectiveAnalysisContext(contextPayload)) {
    return null;
  }

  const structured = buildEmptyContextStructured(mode);
  const quality = validateStructuredQuality(structured, mode);
  if (!quality.ok) {
    return null;
  }
  const reply = JSON.stringify(structured);

  return {
    format: "structured",
    structured,
    reply,
    formatReason: CHAT_FORMAT_REASONS.STRUCTURED_OK,
    finishReason: "SHORT_CIRCUIT_EMPTY_CONTEXT",
    outputChars: reply.length,
    shouldRetry: false,
    qualityIssues: [],
    qualityCounts: quality.counts || null,
  };
}

function getModeTokenProfile(mode, messageLength = 0) {
  const safeMode = sanitizeMode(mode);
  let first = DEFAULT_MAX_OUTPUT_TOKENS;
  let retry = RETRY_MAX_OUTPUT_TOKENS;
  if (safeMode === CHAT_MODES.BRIEFING) {
    first = 1280;
    retry = 1408;
  } else if (safeMode === CHAT_MODES.DIAGNOSIS) {
    first = 1408;
    retry = 1792;
  } else if (safeMode === CHAT_MODES.ACTION_PLAN) {
    first = 1664;
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
    surfaceReply = "",
    internalStructured = null,
    responseAction = RESPONSE_ACTIONS.STRUCTURED,
    businessIntent = BUSINESS_INTENTS.BRIEFING,
    legacyStructured,
    routing = null,
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
    firstTransportAttempts = 1,
    firstTransportRetryApplied = false,
    firstTransportRetryRecovered = false,
    firstTransportStatuses = [],
    shortCircuitReason = "",
  } = params || {};
  const format = evaluation && evaluation.format === "structured" ? "structured" : "text_fallback";
  const normalizedStructured =
    format === "structured" && evaluation && typeof evaluation.structured === "object"
      ? evaluation.structured
      : null;
  const structured = typeof legacyStructured === "undefined" ? normalizedStructured : legacyStructured;
  const fallbackReply = trimString(evaluation?.reply) || "结构化输出未完成，请重试。";
  const computedReply = format === "structured" && structured && trimString(structured.summary)
    ? trimString(structured.summary)
    : fallbackReply;
  const reply = trimString(surfaceReply) || computedReply;
  const safeResponseAction =
    responseAction === RESPONSE_ACTIONS.NATURAL ||
    responseAction === RESPONSE_ACTIONS.CLARIFY ||
    responseAction === RESPONSE_ACTIONS.STRUCTURED
      ? responseAction
      : RESPONSE_ACTIONS.STRUCTURED;
  const safeBusinessIntent =
    businessIntent === BUSINESS_INTENTS.CHAT ||
    businessIntent === BUSINESS_INTENTS.BRIEFING ||
    businessIntent === BUSINESS_INTENTS.DIAGNOSIS ||
    businessIntent === BUSINESS_INTENTS.ACTION_PLAN
      ? businessIntent
      : BUSINESS_INTENTS.BRIEFING;
  const safeInternalStructured =
    internalStructured && typeof internalStructured === "object" ? internalStructured : null;
  const safeRouting = routing && typeof routing === "object" ? routing : null;
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
          const qualityIssues = Array.isArray(item.qualityIssues)
            ? item.qualityIssues.map((issue) => trimString(issue)).filter((issue) => issue)
            : [];
          const qualityCountsRaw = item.qualityCounts && typeof item.qualityCounts === "object" ? item.qualityCounts : null;
          const qualityCounts = qualityCountsRaw
            ? {
                summaryChars: Number.isFinite(Number(qualityCountsRaw.summaryChars)) && Number(qualityCountsRaw.summaryChars) >= 0
                  ? Math.floor(Number(qualityCountsRaw.summaryChars))
                  : 0,
                highlightsCount:
                  Number.isFinite(Number(qualityCountsRaw.highlightsCount)) && Number(qualityCountsRaw.highlightsCount) >= 0
                    ? Math.floor(Number(qualityCountsRaw.highlightsCount))
                    : 0,
                evidenceCount:
                  Number.isFinite(Number(qualityCountsRaw.evidenceCount)) && Number(qualityCountsRaw.evidenceCount) >= 0
                    ? Math.floor(Number(qualityCountsRaw.evidenceCount))
                    : 0,
                actionsCount:
                  Number.isFinite(Number(qualityCountsRaw.actionsCount)) && Number(qualityCountsRaw.actionsCount) >= 0
                    ? Math.floor(Number(qualityCountsRaw.actionsCount))
                    : 0,
                minSummaryChars:
                  Number.isFinite(Number(qualityCountsRaw.minSummaryChars)) && Number(qualityCountsRaw.minSummaryChars) >= 0
                    ? Math.floor(Number(qualityCountsRaw.minSummaryChars))
                    : 0,
                minHighlightsCount:
                  Number.isFinite(Number(qualityCountsRaw.minHighlightsCount)) && Number(qualityCountsRaw.minHighlightsCount) >= 0
                    ? Math.floor(Number(qualityCountsRaw.minHighlightsCount))
                    : 0,
                minEvidenceCount:
                  Number.isFinite(Number(qualityCountsRaw.minEvidenceCount)) && Number(qualityCountsRaw.minEvidenceCount) >= 0
                    ? Math.floor(Number(qualityCountsRaw.minEvidenceCount))
                    : 0,
                minActionsCount:
                  Number.isFinite(Number(qualityCountsRaw.minActionsCount)) && Number(qualityCountsRaw.minActionsCount) >= 0
                    ? Math.floor(Number(qualityCountsRaw.minActionsCount))
                    : 0,
              }
            : undefined;
          return {
            stage,
            format,
            formatReason,
            finishReason,
            outputChars: Number.isFinite(outputCharsRaw) && outputCharsRaw >= 0 ? Math.floor(outputCharsRaw) : 0,
            elapsedMs: Number.isFinite(elapsedMsRaw) && elapsedMsRaw >= 0 ? Math.floor(elapsedMsRaw) : 0,
            maxOutputTokens: Number.isFinite(maxOutputTokensRaw) && maxOutputTokensRaw > 0 ? Math.floor(maxOutputTokensRaw) : 0,
            qualityIssues,
            qualityCounts,
          };
        })
        .filter((item) => item !== null)
    : [];
  const safeFirstTransportAttempts =
    Number.isFinite(Number(firstTransportAttempts)) && Number(firstTransportAttempts) > 0
      ? Math.floor(Number(firstTransportAttempts))
      : 1;
  const safeFirstTransportRetryApplied = Boolean(firstTransportRetryApplied);
  const safeFirstTransportRetryRecovered = Boolean(firstTransportRetryRecovered);
  const safeFirstTransportStatuses = normalizeStatusCodeList(firstTransportStatuses);
  const safeShortCircuitReason = trimString(shortCircuitReason);

  const payload = {
    reply,
    surfaceReply: reply,
    internalStructured: safeInternalStructured,
    responseAction: safeResponseAction,
    businessIntent: safeBusinessIntent,
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
      firstTransportAttempts: safeFirstTransportAttempts,
      firstTransportRetryApplied: safeFirstTransportRetryApplied,
      firstTransportRetryRecovered: safeFirstTransportRetryRecovered,
      firstTransportStatuses: safeFirstTransportStatuses,
    },
  };
  if (safeRouting) {
    payload.meta.routing = {
      requestedMode:
        trimString(safeRouting.requestedMode) === CHAT_REQUEST_MODES.BRIEFING ||
        trimString(safeRouting.requestedMode) === CHAT_REQUEST_MODES.DIAGNOSIS ||
        trimString(safeRouting.requestedMode) === CHAT_REQUEST_MODES.ACTION_PLAN
          ? trimString(safeRouting.requestedMode)
          : CHAT_REQUEST_MODES.AUTO,
      responseAction:
        trimString(safeRouting.responseAction) === RESPONSE_ACTIONS.NATURAL ||
        trimString(safeRouting.responseAction) === RESPONSE_ACTIONS.CLARIFY
          ? trimString(safeRouting.responseAction)
          : RESPONSE_ACTIONS.STRUCTURED,
      businessIntent:
        trimString(safeRouting.businessIntent) === BUSINESS_INTENTS.CHAT ||
        trimString(safeRouting.businessIntent) === BUSINESS_INTENTS.DIAGNOSIS ||
        trimString(safeRouting.businessIntent) === BUSINESS_INTENTS.ACTION_PLAN
          ? trimString(safeRouting.businessIntent)
          : BUSINESS_INTENTS.BRIEFING,
      routeSource: trimString(safeRouting.routeSource) === "explicit" ? "explicit" : "rule",
      confidence: trimString(safeRouting.confidence) === "high" ? "high" : "medium",
      ruleId: trimString(safeRouting.ruleId) || "rule_default",
    };
  }
  if (safeShortCircuitReason) {
    payload.meta.shortCircuitReason = safeShortCircuitReason;
  }
  return payload;
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
  const thresholds = getModeQualityThreshold(safeMode);
  const contextText = safeContextText(context);
  const strictJsonOnly = Boolean(options && options.strictJsonOnly);
  const history = sanitizeHistoryList(options?.history);
  const historyText = formatHistoryText(history);
  const modeFirstRule =
    safeMode === CHAT_MODES.BRIEFING
      ? "首轮模板：summary 70~100字；highlights/evidence/risks/actions 各 1 条；nextQuestions 0~1 条。"
      : safeMode === CHAT_MODES.DIAGNOSIS
        ? "首轮模板：summary 60~100字；highlights 1 条；evidence 1 条；risks 1 条；actions 0~1 条（最小合格条目优先）。"
        : "首轮模板：summary 60~100字；evidence 1 条；actions 1 条；risks/highlights 0~1 条。";
  const modeCompactRule =
    safeMode === CHAT_MODES.BRIEFING
      ? "条目上限：highlights<=2, evidence<=2, risks<=2, actions<=1, nextQuestions<=1。"
      : safeMode === CHAT_MODES.DIAGNOSIS
        ? "条目上限：highlights<=2, evidence<=2, risks<=2, actions<=1, nextQuestions<=1。"
        : "条目上限：evidence<=2, actions<=2, risks<=1, highlights<=1, nextQuestions<=1。";
  const strictMinimalRepairRule = strictJsonOnly
    ? "纠错重试：只输出满足阈值的最小结构，数组保持最低必要条数，不补充解释文本。"
    : "";

  return [
    "你是销售分析助手，请严格基于给定上下文回答，不要编造数据。",
    "输出语言：简体中文。",
    `当前模式：${modeDefinition.label}。`,
    `模式目标：${modeDefinition.goal}`,
    `模式重点：${modeDefinition.focus}`,
    strictJsonOnly ? "本次为纠错重试，请只返回合法 JSON。" : "本次为首轮输出，请优先保证结构化完整性。",
    strictJsonOnly ? "必须满足最小条数和 summary 最小长度，否则视为无效输出。" : "首轮请优先满足最小条数，不要扩展冗长描述。",
    strictMinimalRepairRule,
    "必须输出单个 JSON 对象，禁止输出除 JSON 外的解释文字。",
    "JSON 字段必须完整：summary(string), highlights(string[]), evidence([{label,value,insight}]), risks(string[]), actions([{title,owner,timeline,metric}]), nextQuestions(string[])。",
    `质量门槛：summary 至少 ${thresholds.minSummaryChars} 字；highlights>=${thresholds.minHighlightsCount}，evidence>=${thresholds.minEvidenceCount}，actions>=${thresholds.minActionsCount}。`,
    modeFirstRule,
    modeCompactRule,
    "每个数组优先最小条数；每个字符串字段使用短句（建议 8~24 字）。",
    "禁止复述 analysis/context 原文或长清单；仅保留结论级证据。",
    "若接近输出上限，优先保证合法 JSON + 最小条目，避免超长句子。",
    "若上下文不足，也要输出合法 JSON，并在 summary 或 risks 中明确“数据不足/口径不足”。",
    "禁止使用 Markdown 代码块。",
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

function buildNaturalPrompt(message, contextV1, history) {
  const safeMessage = trimString(message);
  const safeHistory = sanitizeHistoryList(history);
  const historyText = formatHistoryText(safeHistory);
  const naturalContext = {
    scope: contextV1?.scope || {},
    business: {
      overview: contextV1?.business?.overview || {},
      trend: contextV1?.business?.trend || {},
      evidenceTop: contextV1?.business?.evidenceTop || [],
      riskTop: contextV1?.business?.riskTop || [],
    },
    quality: contextV1?.quality || {},
  };
  const contextText = safeContextText(naturalContext);

  return [
    "你是销售分析助手，请严格基于给定上下文回答，不要编造数据。",
    "输出语言：简体中文。",
    "回答形态：自然问答（非结构化模板）。",
    "回答要求：先给结论，再给1-2条关键依据；必要时给1条可执行建议。",
    "语气要求：像业务助手，避免机械模板句，不要输出 JSON 或 Markdown 代码块。",
    "如果信息不足，请明确说明不足点，并给出一个自然的补充问题。",
    "优先参考最近对话上下文，但以当前业务口径为准。",
    "",
    "最近对话摘要（按时间顺序）：",
    historyText,
    "",
    "用户问题：",
    safeMessage,
    "",
    "业务上下文(JSON)：",
    contextText,
  ].join("\n");
}

function buildGeminiNaturalPayload(message, contextV1, history, thinkingBudget = null) {
  const safeThinkingBudget = Number(thinkingBudget);
  const hasThinkingBudget = Number.isFinite(safeThinkingBudget) && safeThinkingBudget >= 0;
  const generationConfig = {
    temperature: 0.25,
    topP: 0.9,
    maxOutputTokens: NATURAL_MAX_OUTPUT_TOKENS,
  };
  if (hasThinkingBudget) {
    generationConfig.thinkingConfig = {
      thinkingBudget: Math.floor(safeThinkingBudget),
    };
  }

  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildNaturalPrompt(message, contextV1, history),
          },
        ],
      },
    ],
    generationConfig,
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
      issues: [],
      counts: null,
    };
  }

  const threshold = getModeQualityThreshold(mode);
  const counts = {
    summaryChars: structured.summary.length,
    highlightsCount: structured.highlights.length,
    evidenceCount: structured.evidence.length,
    actionsCount: structured.actions.length,
    minSummaryChars: threshold.minSummaryChars,
    minHighlightsCount: threshold.minHighlightsCount,
    minEvidenceCount: threshold.minEvidenceCount,
    minActionsCount: threshold.minActionsCount,
  };
  const issues = [];
  if (structured.summary.length < threshold.minSummaryChars) {
    issues.push("summary_too_short");
  }
  if (structured.highlights.length < threshold.minHighlightsCount) {
    issues.push("highlights_below_min");
  }
  if (structured.evidence.length < threshold.minEvidenceCount) {
    issues.push("evidence_below_min");
  }
  if (structured.actions.length < threshold.minActionsCount) {
    issues.push("actions_below_min");
  }

  if (issues.length > 0) {
    return {
      ok: false,
      reason: CHAT_FORMAT_REASONS.SCHEMA_INVALID,
      issues,
      counts,
    };
  }

  return {
    ok: true,
    reason: CHAT_FORMAT_REASONS.STRUCTURED_OK,
    issues: [],
    counts,
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
      qualityIssues: [],
      qualityCounts: null,
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
      qualityIssues: [],
      qualityCounts: null,
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
      qualityIssues: [],
      qualityCounts: null,
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
      qualityIssues: quality.issues || [],
      qualityCounts: quality.counts || null,
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
    qualityIssues: quality.issues || [],
    qualityCounts: quality.counts || null,
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
    thinkingBudget = null,
  } = params || {};
  const responseSchema = getModeResponseSchema(mode);
  const safeThinkingBudget = Number(thinkingBudget);
  const hasThinkingBudget = Number.isFinite(safeThinkingBudget) && safeThinkingBudget >= 0;
  const generationConfig = {
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens,
    responseMimeType: "application/json",
    responseSchema,
  };
  if (hasThinkingBudget) {
    generationConfig.thinkingConfig = {
      thinkingBudget: Math.floor(safeThinkingBudget),
    };
  }

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
    generationConfig,
  };
}

function buildGeminiRepairPayload(rawReply, mode, thinkingBudget = null) {
  const safeThinkingBudget = Number(thinkingBudget);
  const hasThinkingBudget = Number.isFinite(safeThinkingBudget) && safeThinkingBudget >= 0;
  const generationConfig = {
    temperature: 0.1,
    topP: 0.8,
    maxOutputTokens: RETRY_MAX_OUTPUT_TOKENS,
    responseMimeType: "application/json",
    responseSchema: CHAT_RESPONSE_SCHEMA,
  };
  if (hasThinkingBudget) {
    generationConfig.thinkingConfig = {
      thinkingBudget: Math.floor(safeThinkingBudget),
    };
  }
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
    generationConfig,
  };
}

function sanitizeThinkingBudget(rawBudget) {
  const safeRaw = trimString(rawBudget);
  if (!safeRaw) {
    return null;
  }
  const numeric = Number(safeRaw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.floor(numeric);
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

function sleep(ms) {
  const safeMs = Number(ms);
  if (!Number.isFinite(safeMs) || safeMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, Math.floor(safeMs));
  });
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
  const safeFirstTransportAttempts = Number(safeDetails?.firstTransportAttempts);
  if (Number.isFinite(safeFirstTransportAttempts) && safeFirstTransportAttempts > 0) {
    error.firstTransportAttempts = Math.floor(safeFirstTransportAttempts);
  }
  const safeFirstTransportStatuses = normalizeStatusCodeList(safeDetails?.firstTransportStatuses);
  if (safeFirstTransportStatuses.length > 0) {
    error.firstTransportStatuses = safeFirstTransportStatuses;
  }
  if (typeof safeDetails?.firstTransportRetryApplied === "boolean") {
    error.firstTransportRetryApplied = safeDetails.firstTransportRetryApplied;
  }
  if (typeof safeDetails?.firstTransportRetryRecovered === "boolean") {
    error.firstTransportRetryRecovered = safeDetails.firstTransportRetryRecovered;
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
  const timeoutMsRaw = Number(options?.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
    ? Math.floor(timeoutMsRaw)
    : GEMINI_UPSTREAM_TIMEOUT_MS;
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
      timeoutMs,
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return {
        ok: false,
        error: buildChatError(
          CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
          `Gemini 请求超时（>${timeoutMs}ms），请稍后重试。`,
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
    upstreamStatus: upstreamResponse.status,
  };
}

function isRetryableUpstreamStatus(status) {
  const safeStatus = Number(status);
  return safeStatus === 500 || safeStatus === 502 || safeStatus === 503 || safeStatus === 429;
}

function pickAttemptUpstreamStatus(attempt) {
  if (!attempt || typeof attempt !== "object") {
    return 0;
  }
  if (attempt.ok) {
    const safeStatus = Number(attempt.upstreamStatus);
    return Number.isFinite(safeStatus) && safeStatus > 0 ? Math.floor(safeStatus) : 200;
  }
  const errorStatus = Number(attempt.error?.upstreamStatus);
  return Number.isFinite(errorStatus) && errorStatus > 0 ? Math.floor(errorStatus) : 0;
}

async function requestGeminiFirstStageWithAvailabilityRetry(model, key, upstreamPayload, options = null) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const requestStartedAt = Number(safeOptions.requestStartedAt);
  const canUseBudget =
    Number.isFinite(requestStartedAt) &&
    requestStartedAt > 0 &&
    requestStartedAt <= Date.now();

  const firstAttempt = await requestGeminiNonStreaming(model, key, upstreamPayload, {
    stage: "first",
  });
  const firstStatus = pickAttemptUpstreamStatus(firstAttempt);
  const firstTransportStatuses = firstStatus > 0 ? [firstStatus] : [];
  const firstTransport = {
    firstTransportAttempts: 1,
    firstTransportRetryApplied: false,
    firstTransportRetryRecovered: false,
    firstTransportStatuses,
  };
  if (firstAttempt.ok) {
    return {
      ...firstAttempt,
      firstTransport,
    };
  }

  const errorCode = trimString(firstAttempt.error?.code);
  const isTimeoutRetry = errorCode === CHAT_ERROR_CODES.UPSTREAM_TIMEOUT;
  const retryableCode =
    errorCode === CHAT_ERROR_CODES.UPSTREAM_ERROR ||
    errorCode === CHAT_ERROR_CODES.UPSTREAM_RATE_LIMIT ||
    isTimeoutRetry;
  const retryableStatus = isTimeoutRetry ? true : isRetryableUpstreamStatus(firstAttempt.error?.upstreamStatus);
  const remainingBudgetMs = canUseBudget ? TOTAL_CHAT_BUDGET_MS - (Date.now() - requestStartedAt) : TOTAL_CHAT_BUDGET_MS;
  const minRemainingBudgetMs = isTimeoutRetry
    ? FIRST_TRANSPORT_TIMEOUT_MIN_REMAINING_BUDGET_MS
    : FIRST_TRANSPORT_MIN_REMAINING_BUDGET_MS;
  const canRetry = retryableCode && retryableStatus && remainingBudgetMs >= minRemainingBudgetMs;
  if (!canRetry) {
    return {
      ...firstAttempt,
      firstTransport,
    };
  }

  const retryDelayMs =
    FIRST_TRANSPORT_RETRY_BASE_DELAY_MS +
    Math.floor(Math.random() * (FIRST_TRANSPORT_RETRY_JITTER_MS + 1));
  await sleep(retryDelayMs);
  const postDelayRemainingBudgetMs = canUseBudget
    ? TOTAL_CHAT_BUDGET_MS - (Date.now() - requestStartedAt)
    : TOTAL_CHAT_BUDGET_MS;
  const timeoutRetryTimeoutMs = Math.floor(
    Math.min(
      FIRST_TRANSPORT_TIMEOUT_RETRY_TIMEOUT_MS,
      postDelayRemainingBudgetMs - FIRST_TRANSPORT_TIMEOUT_RETRY_BUDGET_BUFFER_MS,
    ),
  );
  const secondTimeoutMs =
    isTimeoutRetry && timeoutRetryTimeoutMs > 0 ? timeoutRetryTimeoutMs : GEMINI_UPSTREAM_TIMEOUT_MS;
  const secondAttempt = await requestGeminiNonStreaming(model, key, upstreamPayload, {
    stage: "first",
    timeoutMs: secondTimeoutMs,
  });
  const secondStatus = pickAttemptUpstreamStatus(secondAttempt);
  if (secondStatus > 0) {
    firstTransportStatuses.push(secondStatus);
  }

  return {
    ...secondAttempt,
    firstTransport: {
      firstTransportAttempts: 2,
      firstTransportRetryApplied: true,
      firstTransportRetryRecovered: Boolean(secondAttempt.ok),
      firstTransportStatuses,
    },
  };
}

async function generateNaturalModelReply(model, key, message, contextV1, history, thinkingBudget = null) {
  const startedAt = Date.now();
  const payload = buildGeminiNaturalPayload(message, contextV1, history, thinkingBudget);
  const firstAttempt = await requestGeminiFirstStageWithAvailabilityRetry(model, key, payload, {
    requestStartedAt: startedAt,
  });
  if (!firstAttempt.ok) {
    if (firstAttempt.error && typeof firstAttempt.error === "object") {
      firstAttempt.error.firstTransportAttempts = Number(firstAttempt?.firstTransport?.firstTransportAttempts) > 1 ? 2 : 1;
      firstAttempt.error.firstTransportRetryApplied = Boolean(firstAttempt?.firstTransport?.firstTransportRetryApplied);
      firstAttempt.error.firstTransportRetryRecovered = Boolean(firstAttempt?.firstTransport?.firstTransportRetryRecovered);
      firstAttempt.error.firstTransportStatuses = normalizeStatusCodeList(firstAttempt?.firstTransport?.firstTransportStatuses);
    }
    return firstAttempt;
  }

  return {
    ok: true,
    reply: trimString(firstAttempt.reply),
    finishReason: trimString(firstAttempt.finishReason),
    totalDurationMs: Date.now() - startedAt,
    firstTransportAttempts: Number(firstAttempt?.firstTransport?.firstTransportAttempts) > 1 ? 2 : 1,
    firstTransportRetryApplied: Boolean(firstAttempt?.firstTransport?.firstTransportRetryApplied),
    firstTransportRetryRecovered: Boolean(firstAttempt?.firstTransport?.firstTransportRetryRecovered),
    firstTransportStatuses: normalizeStatusCodeList(firstAttempt?.firstTransport?.firstTransportStatuses),
  };
}

async function attemptRepairStructured(model, key, rawReply, mode, thinkingBudget = null) {
  const sourceText = trimString(rawReply);
  if (!sourceText) {
    return {
      ok: false,
      evaluation: null,
      error: null,
    };
  }

  const repairPayload = buildGeminiRepairPayload(sourceText, mode, thinkingBudget);
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
  const qualityIssues = Array.isArray(evaluation?.qualityIssues)
    ? evaluation.qualityIssues.map((issue) => trimString(issue)).filter((issue) => issue)
    : [];
  const qualityCountsRaw =
    evaluation?.qualityCounts && typeof evaluation.qualityCounts === "object" ? evaluation.qualityCounts : null;
  const qualityCounts = qualityCountsRaw
    ? {
        summaryChars: Number.isFinite(Number(qualityCountsRaw.summaryChars)) && Number(qualityCountsRaw.summaryChars) >= 0
          ? Math.floor(Number(qualityCountsRaw.summaryChars))
          : 0,
        highlightsCount:
          Number.isFinite(Number(qualityCountsRaw.highlightsCount)) && Number(qualityCountsRaw.highlightsCount) >= 0
            ? Math.floor(Number(qualityCountsRaw.highlightsCount))
            : 0,
        evidenceCount:
          Number.isFinite(Number(qualityCountsRaw.evidenceCount)) && Number(qualityCountsRaw.evidenceCount) >= 0
            ? Math.floor(Number(qualityCountsRaw.evidenceCount))
            : 0,
        actionsCount:
          Number.isFinite(Number(qualityCountsRaw.actionsCount)) && Number(qualityCountsRaw.actionsCount) >= 0
            ? Math.floor(Number(qualityCountsRaw.actionsCount))
            : 0,
        minSummaryChars:
          Number.isFinite(Number(qualityCountsRaw.minSummaryChars)) && Number(qualityCountsRaw.minSummaryChars) >= 0
            ? Math.floor(Number(qualityCountsRaw.minSummaryChars))
            : 0,
        minHighlightsCount:
          Number.isFinite(Number(qualityCountsRaw.minHighlightsCount)) && Number(qualityCountsRaw.minHighlightsCount) >= 0
            ? Math.floor(Number(qualityCountsRaw.minHighlightsCount))
            : 0,
        minEvidenceCount:
          Number.isFinite(Number(qualityCountsRaw.minEvidenceCount)) && Number(qualityCountsRaw.minEvidenceCount) >= 0
            ? Math.floor(Number(qualityCountsRaw.minEvidenceCount))
            : 0,
        minActionsCount:
          Number.isFinite(Number(qualityCountsRaw.minActionsCount)) && Number(qualityCountsRaw.minActionsCount) >= 0
            ? Math.floor(Number(qualityCountsRaw.minActionsCount))
            : 0,
      }
    : null;
  return {
    stage: normalizedStage,
    format: normalizedFormat,
    formatReason,
    finishReason,
    outputChars: Number.isFinite(outputCharsRaw) && outputCharsRaw >= 0 ? Math.floor(outputCharsRaw) : 0,
    elapsedMs: Number.isFinite(elapsedMsRaw) && elapsedMsRaw >= 0 ? Math.floor(elapsedMsRaw) : 0,
    maxOutputTokens: Number.isFinite(maxOutputTokensRaw) && maxOutputTokensRaw > 0 ? Math.floor(maxOutputTokensRaw) : 0,
    qualityIssues,
    qualityCounts,
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

async function generateChatResponse(model, key, message, contextPayload, mode, history, thinkingBudget = null) {
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
  let firstTransportAttempts = 1;
  let firstTransportRetryApplied = false;
  let firstTransportRetryRecovered = false;
  let firstTransportStatuses = [];
  const attemptDiagnostics = [];

  const firstAttemptPayload = buildGeminiPayload({
    message,
    contextPayload,
    history,
    mode,
    maxOutputTokens: modeTokenProfile.first,
    strictJsonOnly: false,
    thinkingBudget,
  });
  attemptCount += 1;
  const firstStageStartedAt = Date.now();
  const firstAttempt = await requestGeminiFirstStageWithAvailabilityRetry(model, key, firstAttemptPayload, {
    requestStartedAt: startedAt,
  });
  stageDurations.first = Date.now() - firstStageStartedAt;
  firstTransportAttempts = Number(firstAttempt?.firstTransport?.firstTransportAttempts) > 1 ? 2 : 1;
  firstTransportRetryApplied = Boolean(firstAttempt?.firstTransport?.firstTransportRetryApplied);
  firstTransportRetryRecovered = Boolean(firstAttempt?.firstTransport?.firstTransportRetryRecovered);
  firstTransportStatuses = normalizeStatusCodeList(firstAttempt?.firstTransport?.firstTransportStatuses);
  if (!firstAttempt.ok) {
    if (firstAttempt.error && typeof firstAttempt.error === "object") {
      firstAttempt.error.firstTransportAttempts = firstTransportAttempts;
      firstAttempt.error.firstTransportRetryApplied = firstTransportRetryApplied;
      firstAttempt.error.firstTransportRetryRecovered = firstTransportRetryRecovered;
      firstAttempt.error.firstTransportStatuses = firstTransportStatuses;
    }
    return firstAttempt;
  }

  let finalEvaluation = evaluateGeminiOutput(firstAttempt.reply, firstAttempt.finishReason, safeMode);
  attemptDiagnostics.push(
    buildAttemptDiagnostic("first", finalEvaluation, modeTokenProfile.first, stageDurations.first),
  );
  const firstElapsed = stageDurations.first;
  const shouldTriggerRetry =
    finalEvaluation.formatReason === CHAT_FORMAT_REASONS.JSON_PARSE_FAILED ||
    finalEvaluation.formatReason === CHAT_FORMAT_REASONS.OUTPUT_TRUNCATED ||
    finalEvaluation.formatReason === CHAT_FORMAT_REASONS.SCHEMA_INVALID;
  if (shouldTriggerRetry && hasBudgetForNextAttempt() && firstElapsed < FIRST_STAGE_BUDGET_MS) {
    retryCount = 1;
    const retryPayload = buildGeminiPayload({
      message,
      contextPayload,
      history,
      mode,
      maxOutputTokens: modeTokenProfile.retry,
      strictJsonOnly: true,
      thinkingBudget,
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
    const repairAttempt = await attemptRepairStructured(model, key, finalEvaluation.reply, mode, thinkingBudget);
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
    firstTransportAttempts,
    firstTransportRetryApplied,
    firstTransportRetryRecovered,
    firstTransportStatuses,
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
  const thinkingBudget = sanitizeThinkingBudget(getEnvString(context.env, "GEMINI_THINKING_BUDGET"));

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
  const normalizedContext = normalizeContextV1(body && body.context, message);
  const contextPayload = sanitizeContextPayload(normalizedContext.legacyContext);
  const history = sanitizeHistoryList(body && body.history);
  const requestedMode = sanitizeRequestedMode(body && body.mode);
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

  const route = resolveResponseAction(requestedMode, message, normalizedContext);
  const compatibleMode =
    route.responseAction === RESPONSE_ACTIONS.STRUCTURED
      ? sanitizeMode(route.structuredMode)
      : sanitizeMode(normalizedContext?.session?.lastIntent);
  const routingMeta = {
    requestedMode,
    responseAction: route.responseAction,
    businessIntent: route.businessIntent,
    routeSource: route.routeSource,
    confidence: route.confidence,
    ruleId: route.ruleId,
  };

  if (route.responseAction === RESPONSE_ACTIONS.CLARIFY) {
    const clarify = buildClarifyResponse(normalizedContext, route.clarifyReason);
    const evaluation = {
      format: "structured",
      structured: null,
      reply: clarify.surfaceReply,
      formatReason: CHAT_FORMAT_REASONS.STRUCTURED_OK,
      finishReason: "CLARIFY_ROUTED",
      outputChars: clarify.surfaceReply.length,
      shouldRetry: false,
      qualityIssues: [],
      qualityCounts: null,
    };
    return jsonResponse(
      buildChatSuccessPayload({
        evaluation,
        surfaceReply: clarify.surfaceReply,
        internalStructured: clarify.internalStructured,
        responseAction: RESPONSE_ACTIONS.CLARIFY,
        businessIntent: BUSINESS_INTENTS.CHAT,
        legacyStructured: null,
        routing: routingMeta,
        model,
        requestId,
        mode: compatibleMode,
        retryCount: 0,
        repairApplied: false,
        repairSucceeded: false,
        attemptCount: 1,
        totalDurationMs: 0,
        stageDurations: {
          first: 0,
        },
        finalStage: "first",
        contextChars: requestContextChars,
        historyChars: requestHistoryChars,
        attemptDiagnostics: [buildAttemptDiagnostic("first", evaluation, 0, 0)],
      }),
      200,
      requestId,
    );
  }

  if (route.responseAction === RESPONSE_ACTIONS.NATURAL) {
    const naturalModel = await generateNaturalModelReply(model, key, message, normalizedContext, history, thinkingBudget);
    const modelReply = naturalModel.ok ? trimString(naturalModel.reply) : "";
    const natural = buildNaturalResponse(normalizedContext, message, modelReply);
    const naturalDurationMs = naturalModel.ok
      ? Number(naturalModel.totalDurationMs || 0)
      : Number(naturalModel?.error?.durationMs || 0);
    const safeNaturalDurationMs =
      Number.isFinite(naturalDurationMs) && naturalDurationMs >= 0 ? Math.floor(naturalDurationMs) : 0;
    const naturalFormatReason = modelReply
      ? CHAT_FORMAT_REASONS.STRUCTURED_OK
      : trimString(naturalModel?.error?.code).toLowerCase() || CHAT_FORMAT_REASONS.JSON_PARSE_FAILED;
    const evaluation = {
      format: modelReply ? "structured" : "text_fallback",
      structured: null,
      reply: natural.surfaceReply,
      formatReason: naturalFormatReason,
      finishReason: modelReply
        ? trimString(naturalModel.finishReason) || "NATURAL_ROUTED"
        : trimString(naturalModel?.error?.code) || "NATURAL_FALLBACK",
      outputChars: natural.surfaceReply.length,
      shouldRetry: false,
      qualityIssues: [],
      qualityCounts: null,
    };
    const firstTransportAttempts = naturalModel.ok
      ? Number(naturalModel.firstTransportAttempts || 1)
      : Number(naturalModel?.error?.firstTransportAttempts || 1);
    const firstTransportRetryApplied = naturalModel.ok
      ? Boolean(naturalModel.firstTransportRetryApplied)
      : Boolean(naturalModel?.error?.firstTransportRetryApplied);
    const firstTransportRetryRecovered = naturalModel.ok
      ? Boolean(naturalModel.firstTransportRetryRecovered)
      : Boolean(naturalModel?.error?.firstTransportRetryRecovered);
    const firstTransportStatuses = naturalModel.ok
      ? normalizeStatusCodeList(naturalModel.firstTransportStatuses)
      : normalizeStatusCodeList(naturalModel?.error?.firstTransportStatuses);
    const naturalAttemptDiagnostics =
      naturalModel.ok || modelReply
        ? [buildAttemptDiagnostic("first", evaluation, NATURAL_MAX_OUTPUT_TOKENS, safeNaturalDurationMs)]
        : [buildAttemptDiagnosticFromError("first", naturalModel.error, NATURAL_MAX_OUTPUT_TOKENS, safeNaturalDurationMs)];

    return jsonResponse(
      buildChatSuccessPayload({
        evaluation,
        surfaceReply: natural.surfaceReply,
        internalStructured: natural.internalStructured,
        responseAction: RESPONSE_ACTIONS.NATURAL,
        businessIntent: BUSINESS_INTENTS.CHAT,
        legacyStructured: null,
        routing: routingMeta,
        model,
        requestId,
        mode: compatibleMode,
        retryCount: 0,
        repairApplied: false,
        repairSucceeded: false,
        attemptCount: 1,
        totalDurationMs: safeNaturalDurationMs,
        stageDurations: {
          first: safeNaturalDurationMs,
        },
        finalStage: "first",
        contextChars: requestContextChars,
        historyChars: requestHistoryChars,
        attemptDiagnostics: naturalAttemptDiagnostics,
        firstTransportAttempts,
        firstTransportRetryApplied,
        firstTransportRetryRecovered,
        firstTransportStatuses,
      }),
      200,
      requestId,
    );
  }

  const mode = compatibleMode;
  const shortCircuitEvaluation = buildEmptyContextShortCircuitEvaluation(contextPayload, mode);
  if (shortCircuitEvaluation) {
    return jsonResponse(
      buildChatSuccessPayload({
        evaluation: shortCircuitEvaluation,
        surfaceReply: shortCircuitEvaluation.structured?.summary || shortCircuitEvaluation.reply,
        internalStructured: shortCircuitEvaluation.structured,
        responseAction: RESPONSE_ACTIONS.STRUCTURED,
        businessIntent: route.businessIntent,
        routing: routingMeta,
        model,
        requestId,
        mode,
        retryCount: 0,
        repairApplied: false,
        repairSucceeded: false,
        attemptCount: 1,
        totalDurationMs: 0,
        stageDurations: {
          first: 0,
        },
        finalStage: "first",
        contextChars: requestContextChars,
        historyChars: requestHistoryChars,
        attemptDiagnostics: [buildAttemptDiagnostic("first", shortCircuitEvaluation, 0, 0)],
        shortCircuitReason: SHORT_CIRCUIT_REASONS.EMPTY_CONTEXT,
      }),
      200,
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
            thinkingBudget,
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
              const fallback = await generateChatResponse(model, key, message, contextPayload, mode, history, thinkingBudget);
              if (fallback.ok) {
                const payload = buildChatSuccessPayload({
                  evaluation: fallback.evaluation,
                  surfaceReply:
                    fallback.evaluation?.structured?.summary || trimString(fallback.evaluation?.reply),
                  internalStructured:
                    fallback.evaluation?.format === "structured" ? fallback.evaluation.structured : null,
                  responseAction: RESPONSE_ACTIONS.STRUCTURED,
                  businessIntent: route.businessIntent,
                  routing: routingMeta,
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
                  shortCircuitReason: fallback.shortCircuitReason,
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
            const fallback = await generateChatResponse(model, key, message, contextPayload, mode, history, thinkingBudget);
            if (fallback.ok) {
              const payload = buildChatSuccessPayload({
                evaluation: fallback.evaluation,
                surfaceReply:
                  fallback.evaluation?.structured?.summary || trimString(fallback.evaluation?.reply),
                internalStructured:
                  fallback.evaluation?.format === "structured" ? fallback.evaluation.structured : null,
                responseAction: RESPONSE_ACTIONS.STRUCTURED,
                businessIntent: route.businessIntent,
                routing: routingMeta,
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
                shortCircuitReason: fallback.shortCircuitReason,
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
            surfaceReply: streamEvaluation?.structured?.summary || trimString(streamEvaluation?.reply),
            internalStructured: streamEvaluation?.format === "structured" ? streamEvaluation.structured : null,
            responseAction: RESPONSE_ACTIONS.STRUCTURED,
            businessIntent: route.businessIntent,
            routing: routingMeta,
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

  const generated = await generateChatResponse(model, key, message, contextPayload, mode, history, thinkingBudget);
  if (!generated.ok) {
    return errorResponse(generated.error.code, generated.error.message, generated.error.status, requestId, {
      stage: generated.error.stage,
      upstreamStatus: generated.error.upstreamStatus,
      durationMs: generated.error.durationMs,
      firstTransportAttempts: generated.error.firstTransportAttempts,
      firstTransportStatuses: generated.error.firstTransportStatuses,
      firstTransportRetryApplied: generated.error.firstTransportRetryApplied,
    });
  }

  return jsonResponse(
    buildChatSuccessPayload({
      evaluation: generated.evaluation,
      surfaceReply: generated.evaluation?.structured?.summary || trimString(generated.evaluation?.reply),
      internalStructured: generated.evaluation?.format === "structured" ? generated.evaluation.structured : null,
      responseAction: RESPONSE_ACTIONS.STRUCTURED,
      businessIntent: route.businessIntent,
      routing: routingMeta,
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
      firstTransportAttempts: generated.firstTransportAttempts,
      firstTransportRetryApplied: generated.firstTransportRetryApplied,
      firstTransportRetryRecovered: generated.firstTransportRetryRecovered,
      firstTransportStatuses: generated.firstTransportStatuses,
      shortCircuitReason: generated.shortCircuitReason,
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
