import {
  ASSISTANT_ROLE_DEFINITION,
  AUTH_UPSTREAM_TIMEOUT_MS,
  CHAT_ERROR_CODES,
  MAX_MESSAGE_LENGTH,
  QUESTION_JUDGMENT_CODES,
  SUPABASE_AUTH_USER_PATH,
  buildAssistantRoleSystemInstruction,
  fetchWithTimeout,
  getEnvString,
  normalizeBusinessSnapshot,
  trimString,
} from "../chat/shared.js";
import { normalizeSessionHistoryWindow } from "../chat/session.js";
import { runToolFirstChat } from "../chat/tool-runtime.js";
import { normalizeConversationState } from "../chat/conversation-state.js";
import { buildChatSuccessPayload, buildEvidenceBundleFromToolResult } from "../chat/render.js";
import { extractGeminiReply, requestGeminiGenerateContent } from "../chat/output.js";

const TERM_EXPLAIN_CUE_RE = /(什么意思|是什么|指什么|怎么理解)/u;
const EXPLICIT_TERM_RE = /([A-Za-z0-9\u4e00-\u9fa5]{1,16}(?:覆盖率|占比|集中度|贡献|趋势))/u;
const REFERENTIAL_ENTITY_CUE_RE = /(这两家|这几个|这两个|它们|这些)/u;
const DEMO_WORKSPACE_MODE = "demo";
const LIVE_WORKSPACE_MODE = "live";
const DEMO_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const DEMO_RATE_LIMIT_MAX_REQUESTS = 6;
const demoRateLimitBuckets = new Map();

function normalizeWorkspaceMode(value) {
  return trimString(value).toLowerCase() === DEMO_WORKSPACE_MODE ? DEMO_WORKSPACE_MODE : LIVE_WORKSPACE_MODE;
}

function mapHistoryRoleToGeminiRole(role) {
  return trimString(role) === "assistant" ? "model" : "user";
}

function cleanupDemoRateLimitBuckets(nowMs = Date.now()) {
  for (const [key, bucket] of demoRateLimitBuckets.entries()) {
    if (!bucket || !Number.isFinite(bucket.resetAtMs) || bucket.resetAtMs <= nowMs) {
      demoRateLimitBuckets.delete(key);
    }
  }
}

function resolveDemoRateLimitFingerprint(request) {
  const cfIp = trimString(request?.headers?.get("cf-connecting-ip"));
  if (cfIp) {
    return `ip:${cfIp}`;
  }

  const forwardedFor = trimString(request?.headers?.get("x-forwarded-for"));
  if (forwardedFor) {
    const firstForwardedIp = trimString(forwardedFor.split(",")[0]);
    if (firstForwardedIp) {
      return `xff:${firstForwardedIp}`;
    }
  }

  const userAgent = trimString(request?.headers?.get("user-agent"));
  if (userAgent) {
    return `ua:${userAgent}`;
  }

  return "anonymous";
}

function consumeDemoRateLimit(request) {
  const nowMs = Date.now();
  cleanupDemoRateLimitBuckets(nowMs);
  const key = resolveDemoRateLimitFingerprint(request);
  const existingBucket = demoRateLimitBuckets.get(key);
  const bucket =
    existingBucket && Number.isFinite(existingBucket.resetAtMs) && existingBucket.resetAtMs > nowMs
      ? existingBucket
      : {
          count: 0,
          resetAtMs: nowMs + DEMO_RATE_LIMIT_WINDOW_MS,
        };

  if (bucket.count >= DEMO_RATE_LIMIT_MAX_REQUESTS) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000)),
    };
  }

  bucket.count += 1;
  demoRateLimitBuckets.set(key, bucket);
  return {
    ok: true,
    remaining: Math.max(0, DEMO_RATE_LIMIT_MAX_REQUESTS - bucket.count),
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000)),
  };
}

function normalizeStringArray(value, maxItems = 6) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => trimString(item))
        .filter((item) => item),
    ),
  ).slice(0, maxItems);
}

function extractNamedEntitiesFromRows(rows, key) {
  return normalizeStringArray(
    (Array.isArray(rows) ? rows : []).map((row) => {
      if (!row || typeof row !== "object") {
        return "";
      }
      return trimString(row[key]);
    }),
  );
}

function extractEntityScopeFromToolResult(toolResult) {
  const safeToolResult = toolResult && typeof toolResult === "object" ? toolResult : {};
  const matchedEntities =
    safeToolResult.matched_entities && typeof safeToolResult.matched_entities === "object"
      ? safeToolResult.matched_entities
      : {};
  const rows = Array.isArray(safeToolResult.rows) ? safeToolResult.rows : [];
  const matchedProducts = normalizeStringArray(matchedEntities.products);
  const matchedHospitals = normalizeStringArray(matchedEntities.hospitals);
  return {
    products: matchedProducts.length > 0 ? matchedProducts : extractNamedEntitiesFromRows(rows, "product_name"),
    hospitals: matchedHospitals.length > 0 ? matchedHospitals : extractNamedEntitiesFromRows(rows, "hospital_name"),
  };
}

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

function errorResponse(code, message, status, requestId, details = null) {
  const payload = {
    error: {
      code,
      message,
    },
    requestId,
  };
  if (details && typeof details === "object") {
    payload.error.details = details;
  }
  return jsonResponse(payload, status, requestId);
}

function summarizeErrorStack(error) {
  if (!(error instanceof Error) || !trimString(error.stack)) {
    return "";
  }
  return error.stack
    .split("\n")
    .map((line) => trimString(line))
    .filter((line) => line)
    .slice(0, 5)
    .join(" | ");
}

function logChatError({ requestId, stage, error }) {
  const payload = {
    requestId: trimString(requestId),
    stage: trimString(stage) || "unknown",
    error_name: error instanceof Error ? trimString(error.name) || "Error" : "UnknownError",
    error_message: error instanceof Error ? trimString(error.message) : "Unknown error",
  };
  const stack = summarizeErrorStack(error);
  if (stack) {
    payload.stack = stack;
  }
  try {
    console.error("[chat.error]", JSON.stringify(payload));
  } catch (_loggingError) {
    // Error logging should never affect primary request flow.
  }
}

function extractBearerToken(request) {
  const raw = trimString(request?.headers?.get("authorization"));
  if (!raw) {
    return "";
  }
  const matched = raw.match(/^Bearer\s+(.+)$/i);
  return matched ? trimString(matched[1]) : "";
}

async function verifySupabaseAccessToken(request, env) {
  const token = extractBearerToken(request);
  if (!token) {
    return {
      ok: false,
      code: CHAT_ERROR_CODES.UNAUTHORIZED,
      message: "登录状态已失效，请重新登录后再试。",
      status: 401,
    };
  }

  const supabaseUrl = getEnvString(env, "SUPABASE_URL");
  const supabaseAnonKey = getEnvString(env, "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      code: CHAT_ERROR_CODES.AUTH_CONFIG_MISSING,
      message: "服务端缺少 Supabase 校验配置（SUPABASE_URL/SUPABASE_ANON_KEY）。",
      status: 500,
    };
  }

  const userUrl = `${supabaseUrl.replace(/\/+$/, "")}${SUPABASE_AUTH_USER_PATH}`;
  try {
    const response = await fetchWithTimeout(
      userUrl,
      {
        method: "GET",
        headers: {
          apikey: supabaseAnonKey,
          authorization: `Bearer ${token}`,
        },
      },
      AUTH_UPSTREAM_TIMEOUT_MS,
    );

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UNAUTHORIZED,
        message: "登录状态已失效，请重新登录后再试。",
        status: 401,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: CHAT_ERROR_CODES.AUTH_UPSTREAM_ERROR,
        message: `服务端登录态校验失败（HTTP ${response.status}）。`,
        status: 502,
      };
    }

    return {
      ok: true,
      token,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        code: CHAT_ERROR_CODES.AUTH_UPSTREAM_TIMEOUT,
        message: "服务端登录态校验超时，请稍后重试。",
        status: 504,
      };
    }
    return {
      ok: false,
      code: CHAT_ERROR_CODES.AUTH_UPSTREAM_ERROR,
      message: `服务端登录态校验失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      status: 502,
    };
  }
}

function createDefaultQuestionJudgment() {
  return {
    primary_dimension: {
      code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
      label: "整体",
    },
    granularity: {
      code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY,
      label: "摘要级",
    },
    relevance: {
      code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT,
      label: "医药销售相关",
    },
  };
}

function buildConversationStatePayload(incomingConversationState, questionJudgment, toolResult) {
  const baseState = normalizeConversationState(incomingConversationState);
  const nextEntityScope = extractEntityScopeFromToolResult(toolResult);
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  const shouldPreferHospitals = primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL;
  const shouldPreferProducts = primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  return {
    ...baseState,
    primary_dimension_code: primaryDimensionCode || trimString(baseState.primary_dimension_code),
    entity_scope: {
      products:
        shouldPreferHospitals && nextEntityScope.hospitals.length > 0
          ? baseState.entity_scope.products
          : nextEntityScope.products.length > 0
            ? nextEntityScope.products
            : baseState.entity_scope.products,
      hospitals:
        shouldPreferProducts && nextEntityScope.products.length > 0
          ? baseState.entity_scope.hospitals
          : nextEntityScope.hospitals.length > 0
            ? nextEntityScope.hospitals
            : baseState.entity_scope.hospitals,
    },
    source_period:
      trimString(toolResult?.range?.period) ||
      trimString(baseState.source_period),
  };
}

function buildEntityScopeFollowupContext(message, conversationState) {
  const safeMessage = trimString(message);
  if (!safeMessage || safeMessage.length > 40 || !REFERENTIAL_ENTITY_CUE_RE.test(safeMessage)) {
    return null;
  }
  const safeState = normalizeConversationState(conversationState);
  const hospitals = normalizeStringArray(safeState.entity_scope?.hospitals);
  const products = normalizeStringArray(safeState.entity_scope?.products);
  if (hospitals.length === 0 && products.length === 0) {
    return null;
  }
  const primaryDimensionCode = trimString(safeState.primary_dimension_code);
  let primaryEntityType = "";
  if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL && hospitals.length > 0) {
    primaryEntityType = "hospital";
  } else if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT && products.length > 0) {
    primaryEntityType = "product";
  } else if (hospitals.length > 0 && products.length === 0) {
    primaryEntityType = "hospital";
  } else if (products.length > 0 && hospitals.length === 0) {
    primaryEntityType = "product";
  } else if (hospitals.length > 0) {
    primaryEntityType = "hospital";
  } else {
    primaryEntityType = "product";
  }
  return {
    kind: "entity_scope_followup",
    primary_entity_type: primaryEntityType,
    hospitals,
    products,
  };
}

function buildToolFirstFailureResponse(toolFirstResult, requestId) {
  const details = {};
  if (trimString(toolFirstResult?.fallbackReason)) {
    details.reason = trimString(toolFirstResult.fallbackReason);
  }
  return errorResponse(
    CHAT_ERROR_CODES.INTERNAL_ERROR,
    "AI 工具分析未形成稳定结果，请缩小分析范围后重试。",
    502,
    requestId,
    Object.keys(details).length > 0 ? details : null,
  );
}

function getLatestAssistantHistoryText(historyWindow) {
  if (!Array.isArray(historyWindow) || historyWindow.length === 0) {
    return "";
  }
  for (let index = historyWindow.length - 1; index >= 0; index -= 1) {
    const item = historyWindow[index];
    if (trimString(item?.role) === "assistant") {
      return trimString(item?.content);
    }
  }
  return "";
}

function extractExplainTargetTerm(message, assistantText) {
  const safeMessage = trimString(message);
  const safeAssistantText = trimString(assistantText);
  if (!safeMessage || !safeAssistantText || !TERM_EXPLAIN_CUE_RE.test(safeMessage)) {
    return "";
  }
  const explicitMatched = safeMessage.match(EXPLICIT_TERM_RE);
  const explicitTerm = trimString(explicitMatched?.[1]);
  if (explicitTerm && safeAssistantText.includes(explicitTerm)) {
    return explicitTerm;
  }
  return "";
}

function inferExplainContextLabel(assistantText) {
  const safeText = trimString(assistantText);
  if (!safeText) {
    return "对象";
  }
  if (safeText.includes("医院")) {
    return "医院";
  }
  if (safeText.includes("产品")) {
    return "产品";
  }
  return "对象";
}

function buildExplainDefinition(term, contextLabel, sourcePeriod) {
  const safeTerm = trimString(term);
  const safeContextLabel = trimString(contextLabel) || "对象";
  const safeSourcePeriod = trimString(sourcePeriod);
  if (!safeTerm) {
    return "";
  }
  if (safeTerm.includes("月度") && safeTerm.endsWith("覆盖率")) {
    return `“${safeTerm}”通常指在${safeSourcePeriod || "当前报表区间"}内，某个${safeContextLabel}实际形成销售记录的月份数，占该区间总月份数的比例，用来判断业务覆盖是否连续。`;
  }
  if (safeTerm.endsWith("覆盖率")) {
    return `“${safeTerm}”通常指在${safeSourcePeriod || "当前报表区间"}内，实际发生销售记录的${safeContextLabel}范围，占目标${safeContextLabel}池或应覆盖范围的比例，用来判断业务覆盖完整度。`;
  }
  if (safeTerm.endsWith("占比")) {
    return `“${safeTerm}”通常指某个${safeContextLabel}或某类贡献，在整体销售额、销量或目标结构中的占比，用来判断贡献份额大小。`;
  }
  if (safeTerm.endsWith("集中度")) {
    return `“${safeTerm}”通常指销售贡献是否集中在少数${safeContextLabel}上，用来判断结构是否过于依赖头部对象。`;
  }
  if (safeTerm.endsWith("贡献")) {
    return `“${safeTerm}”通常指某个${safeContextLabel}对整体销售额、销量或增长结果的贡献程度，用来判断它对整体表现的支撑作用。`;
  }
  if (safeTerm.endsWith("趋势")) {
    return `“${safeTerm}”通常指该${safeContextLabel}在${safeSourcePeriod || "当前报表区间"}内随月份变化的方向和节奏，用来判断是在上升、回落还是波动。`;
  }
  return `“${safeTerm}”指的是当前业务分析里被单独拿出来观察的一个指标或概念，用来帮助判断${safeContextLabel}表现。`;
}

function buildExplainImportance(term, contextLabel, sourcePeriod) {
  const safeTerm = trimString(term);
  const safeContextLabel = trimString(contextLabel) || "对象";
  const safeSourcePeriod = trimString(sourcePeriod);
  if (!safeTerm) {
    return "";
  }
  if (safeTerm.includes("月度") && safeTerm.endsWith("覆盖率")) {
    return `在你刚才那段${safeContextLabel}分析里，它主要用于判断${safeContextLabel}在${safeSourcePeriod || "当前报表区间"}内的月度业务是否连续；覆盖率偏低，通常说明部分月份没有形成稳定销售或合作存在断档。`;
  }
  if (safeTerm.endsWith("覆盖率")) {
    return `在当前业务分析里，它的作用是帮助判断${safeContextLabel}覆盖是否充分；如果覆盖率偏低，通常意味着还有未被稳定触达或未持续形成销售的部分。`;
  }
  if (safeTerm.endsWith("占比")) {
    return `在当前分析里，它能帮助你快速判断哪个${safeContextLabel}是真正的主要贡献来源，以及结构是否过度集中。`;
  }
  if (safeTerm.endsWith("集中度")) {
    return `在当前分析里，它主要用来判断结构风险；集中度越高，往往意味着对少数头部${safeContextLabel}的依赖越强。`;
  }
  if (safeTerm.endsWith("贡献")) {
    return `在当前分析里，它主要用来解释为什么某些${safeContextLabel}会被单独点名，因为这些对象对整体结果的拉动更明显。`;
  }
  if (safeTerm.endsWith("趋势")) {
    return `在当前分析里，它主要帮助判断这个${safeContextLabel}的变化方向是否健康，以及增长或回落是不是持续性的。`;
  }
  return `在当前分析里，它主要是帮助你理解刚才回答中提到的关键业务概念。`;
}

export function buildTermExplainPayload({
  message,
  historyWindow,
  businessSnapshot,
  conversationState,
  requestId,
} = {}) {
  const safeMessage = trimString(message);
  if (!safeMessage || safeMessage.length > 40 || !TERM_EXPLAIN_CUE_RE.test(safeMessage)) {
    return null;
  }
  const latestAssistantText = getLatestAssistantHistoryText(historyWindow);
  const targetTerm = extractExplainTargetTerm(safeMessage, latestAssistantText);
  if (!targetTerm) {
    return null;
  }
  const sourcePeriod =
    trimString(businessSnapshot?.analysis_range?.period) ||
    trimString(conversationState?.source_period);
  const contextLabel = inferExplainContextLabel(latestAssistantText);
  const replyText = [
    buildExplainDefinition(targetTerm, contextLabel, sourcePeriod),
    buildExplainImportance(targetTerm, contextLabel, sourcePeriod),
  ]
    .map((item) => trimString(item))
    .filter((item) => item)
    .join("\n\n");
  if (!replyText) {
    return null;
  }
  return buildChatSuccessPayload({
    replyText,
    evidenceBundle: {
      source_period: sourcePeriod,
      question_type: "overview",
      evidence_types: [],
      missing_evidence_types: [],
      analysis_confidence: "high",
      evidence: [],
      actions: [],
    },
    model: "term_explainer",
    requestId,
    conversationState: normalizeConversationState(conversationState),
  });
}

function buildNonDirectResponse(toolFirstResult, requestId) {
  const routeCode = trimString(toolFirstResult?.outputContext?.route_code);
  if (routeCode === "refuse" || trimString(toolFirstResult?.plannerState?.relevance) === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT) {
    return errorResponse(
      CHAT_ERROR_CODES.BAD_REQUEST,
      "当前仅支持医药销售分析相关问题。",
      400,
      requestId,
    );
  }
  if (routeCode === "bounded_answer") {
    return null;
  }
  return errorResponse(
    CHAT_ERROR_CODES.BAD_REQUEST,
    "当前未形成稳定分析结果，请缩小分析对象或换一种问法后重试。",
    400,
    requestId,
    {
      question_type: trimString(toolFirstResult?.plannerState?.question_type),
      missing_evidence_types: Array.isArray(toolFirstResult?.missingEvidenceTypes) ? toolFirstResult.missingEvidenceTypes : [],
    },
  );
}

function pushEvidenceItem(bucket, label, value, insight = "") {
  const safeLabel = trimString(label);
  const safeValue = trimString(value);
  if (!safeLabel || !safeValue) {
    return;
  }

  const safeInsight = trimString(insight);
  const duplicated = bucket.some((item) => item.label === safeLabel && item.value === safeValue);
  if (duplicated) {
    return;
  }

  bucket.push({
    label: safeLabel,
    value: safeValue,
    insight: safeInsight,
  });
}

function buildSnapshotRowValue(row) {
  const safeRow = row && typeof row === "object" ? row : {};
  return (
    trimString(safeRow.sales_amount) ||
    trimString(safeRow.amount_target) ||
    trimString(safeRow.sales_volume) ||
    trimString(safeRow.quantity_target) ||
    trimString(safeRow.change_value)
  );
}

function buildSnapshotRowInsight(row) {
  const safeRow = row && typeof row === "object" ? row : {};
  const changeMetric = trimString(safeRow.change_metric);
  const changeValue = trimString(safeRow.change_value);
  if (changeMetric && changeValue) {
    return `${changeMetric}${changeValue}`;
  }
  return trimString(safeRow.amount_achievement) || trimString(safeRow.sales_share) || trimString(safeRow.period);
}

function inferDemoQuestionType(message) {
  const safeMessage = trimString(message);
  if (!safeMessage) {
    return "overview";
  }
  if (/(报告|汇报|总结|复盘)/u.test(safeMessage)) {
    return "report";
  }
  if (/(趋势|环比|同比|变化|波动)/u.test(safeMessage)) {
    return "trend";
  }
  if (/(风险|机会|异常|原因|为什么|诊断)/u.test(safeMessage)) {
    return "diagnosis";
  }
  return "overview";
}

function buildDemoRequiredEvidenceTypes(questionType) {
  if (questionType === "trend") {
    return ["aggregate", "timeseries"];
  }
  if (questionType === "report" || questionType === "diagnosis") {
    return ["aggregate", "timeseries", "breakdown"];
  }
  return ["aggregate"];
}

function inferDemoAnalysisConfidence(evidenceTypes, missingEvidenceTypes) {
  if (!Array.isArray(evidenceTypes) || evidenceTypes.length === 0) {
    return "low";
  }
  if (Array.isArray(missingEvidenceTypes) && missingEvidenceTypes.length > 0) {
    return evidenceTypes.length >= 2 ? "medium" : "low";
  }
  return evidenceTypes.length >= 2 ? "high" : "medium";
}

function buildDemoSnapshotActions(snapshot, sourcePeriod) {
  const safeSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
  const periodText = trimString(sourcePeriod);
  const actions = [];

  (Array.isArray(safeSnapshot.opportunity_hints) ? safeSnapshot.opportunity_hints : []).slice(0, 2).forEach((item) => {
    const title = trimString(item);
    if (!title) {
      return;
    }
    actions.push({
      title,
      timeline: periodText ? `${periodText} 后续跟进` : "下一轮跟进",
      metric: "机会线索",
    });
  });

  (Array.isArray(safeSnapshot.risk_alerts) ? safeSnapshot.risk_alerts : []).slice(0, 1).forEach((item) => {
    const title = trimString(item);
    if (!title) {
      return;
    }
    actions.push({
      title,
      timeline: periodText ? `${periodText} 重点复盘` : "下一轮复盘",
      metric: "风险信号",
    });
  });

  return actions.slice(0, 3);
}

function buildDemoSnapshotEvidenceBundle(snapshot, message) {
  const safeSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
  const overview = safeSnapshot.performance_overview && typeof safeSnapshot.performance_overview === "object"
    ? safeSnapshot.performance_overview
    : {};
  const sourcePeriod = trimString(safeSnapshot.analysis_range?.period);
  const questionType = inferDemoQuestionType(message);
  const evidence = [];
  const evidenceTypes = [];

  pushEvidenceItem(evidence, "销售额", trimString(overview.sales_amount), sourcePeriod);
  pushEvidenceItem(evidence, "金额目标", trimString(overview.amount_target), sourcePeriod);
  pushEvidenceItem(evidence, "金额达成率", trimString(overview.amount_achievement), trimString(overview.latest_key_change));
  pushEvidenceItem(evidence, "销量", trimString(overview.sales_volume), sourcePeriod);
  pushEvidenceItem(evidence, "数量达成率", trimString(overview.quantity_achievement), sourcePeriod);
  if (evidence.length > 0) {
    evidenceTypes.push("aggregate");
  }

  (Array.isArray(safeSnapshot.key_business_signals) ? safeSnapshot.key_business_signals : []).slice(0, 2).forEach((item, index) => {
    pushEvidenceItem(evidence, `业务信号${index + 1}`, trimString(item), sourcePeriod);
  });

  const breakdownRows = [
    ...(Array.isArray(safeSnapshot.product_performance) ? safeSnapshot.product_performance : []).slice(0, 2),
    ...(Array.isArray(safeSnapshot.hospital_performance) ? safeSnapshot.hospital_performance : []).slice(0, 2),
  ];
  breakdownRows.forEach((row, index) => {
    const label =
      trimString(row?.product_name) ||
      trimString(row?.hospital_name) ||
      trimString(row?.name) ||
      `对象${index + 1}`;
    pushEvidenceItem(evidence, label, buildSnapshotRowValue(row), buildSnapshotRowInsight(row));
  });
  if (breakdownRows.length > 0) {
    evidenceTypes.push("breakdown");
  }

  const recentTrends = Array.isArray(safeSnapshot.recent_trends) ? safeSnapshot.recent_trends : [];
  recentTrends.slice(-2).forEach((row) => {
    const period = trimString(row?.period);
    pushEvidenceItem(
      evidence,
      period || "最近趋势",
      trimString(row?.sales_amount) || trimString(row?.sales_volume),
      trimString(row?.amount_mom),
    );
  });
  if (recentTrends.length > 0) {
    evidenceTypes.push("timeseries");
  }

  const requiredEvidenceTypes = buildDemoRequiredEvidenceTypes(questionType);
  const missingEvidenceTypes = requiredEvidenceTypes.filter((type) => !evidenceTypes.includes(type));
  return {
    source_period: sourcePeriod,
    question_type: questionType,
    evidence_types: evidenceTypes,
    missing_evidence_types: missingEvidenceTypes,
    analysis_confidence: inferDemoAnalysisConfidence(evidenceTypes, missingEvidenceTypes),
    evidence: evidence.slice(0, 8),
    actions: buildDemoSnapshotActions(safeSnapshot, sourcePeriod),
  };
}

function buildDemoConversationStatePayload(incomingConversationState, businessSnapshot) {
  const baseState = normalizeConversationState(incomingConversationState);
  const sourcePeriod = trimString(businessSnapshot?.analysis_range?.period) || trimString(baseState.source_period);
  return {
    ...baseState,
    source_period: sourcePeriod,
  };
}

function buildDemoSnapshotSeedPrompt(message, businessSnapshot, conversationState) {
  const promptSections = [
    "当前工作台模式：demo（模拟数据）。",
    "你只能依据下面的 business_snapshot 和对话上下文作答，不要声称访问了数据库、Supabase、真实账号或更多后台数据。",
    "不要在每条回答前重复提醒这是演示模式；只在信息边界相关时自然说明即可。",
  ];

  const sourcePeriod = trimString(businessSnapshot?.analysis_range?.period);
  if (sourcePeriod) {
    promptSections.push(`当前分析区间：${sourcePeriod}。`);
  }

  const safeConversationState = normalizeConversationState(conversationState);
  const hasConversationState =
    trimString(safeConversationState.primary_dimension_code) ||
    trimString(safeConversationState.source_period) ||
    safeConversationState.entity_scope.products.length > 0 ||
    safeConversationState.entity_scope.hospitals.length > 0;
  if (hasConversationState) {
    promptSections.push(`当前会话状态：${JSON.stringify(safeConversationState, null, 2)}`);
  }

  promptSections.push(`demo_business_snapshot:\n${JSON.stringify(businessSnapshot, null, 2)}`);
  promptSections.push(`用户问题：${trimString(message)}`);
  return promptSections.join("\n\n");
}

function buildDemoSnapshotContents(historyWindow, message, businessSnapshot, conversationState) {
  const contents = [];
  (Array.isArray(historyWindow) ? historyWindow : []).forEach((item) => {
    const content = trimString(item?.content);
    if (!content) {
      return;
    }
    contents.push({
      role: mapHistoryRoleToGeminiRole(item?.role),
      parts: [{ text: content }],
    });
  });
  contents.push({
    role: "user",
    parts: [{ text: buildDemoSnapshotSeedPrompt(message, businessSnapshot, conversationState) }],
  });
  return contents;
}

async function requestDemoSnapshotChat({
  message,
  historyWindow,
  businessSnapshot,
  conversationState,
  env,
  requestId,
  deps = {},
} = {}) {
  const requestGeminiGenerateContentImpl = deps.requestGeminiGenerateContent || requestGeminiGenerateContent;
  const extractGeminiReplyImpl = deps.extractGeminiReply || extractGeminiReply;
  const systemInstruction = [
    buildAssistantRoleSystemInstruction(ASSISTANT_ROLE_DEFINITION),
    "补充约束：",
    "1. 当前处于演示工作台，所有数据都是模拟数据，绝不能推断或暗示任何真实账号、真实客户、真实产品或真实医院信息。",
    "2. 只能依据 business_snapshot 和最近对话历史作答；如果快照没有提供足够信息，要明确说明边界。",
    "3. 回答仍使用简体中文自然表达，结论先行，不输出 JSON。",
    "4. 不执行任何数据写入、删除、导出或登录态相关操作；如被要求执行，仅说明当前只能做演示分析。",
  ].join("\n");

  const geminiResponse = await requestGeminiGenerateContentImpl(
    {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: buildDemoSnapshotContents(historyWindow, message, businessSnapshot, conversationState),
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 1400,
      },
    },
    env,
    requestId,
    "demo",
  );

  if (!geminiResponse?.ok) {
    return geminiResponse;
  }

  const replyText = trimString(extractGeminiReplyImpl(geminiResponse.payload));
  if (!replyText) {
    return {
      ok: false,
      code: CHAT_ERROR_CODES.EMPTY_REPLY,
      message: "模型未返回有效回复，请稍后重试。",
      status: 502,
      model: trimString(geminiResponse.model),
    };
  }

  return {
    ok: true,
    replyText,
    model: trimString(geminiResponse.model),
    evidenceBundle: buildDemoSnapshotEvidenceBundle(businessSnapshot, message),
    conversationState: buildDemoConversationStatePayload(conversationState, businessSnapshot),
  };
}

export async function handleChatRequest(context, requestId = crypto.randomUUID(), deps = {}) {
  const verifySupabaseAccessTokenImpl = deps.verifySupabaseAccessToken || verifySupabaseAccessToken;
  const normalizeSessionHistoryWindowImpl = deps.normalizeSessionHistoryWindow || normalizeSessionHistoryWindow;
  const normalizeBusinessSnapshotImpl = deps.normalizeBusinessSnapshot || normalizeBusinessSnapshot;
  const runToolFirstChatImpl = deps.runToolFirstChat || runToolFirstChat;
  const consumeDemoRateLimitImpl = deps.consumeDemoRateLimit || consumeDemoRateLimit;
  const requestDemoSnapshotChatImpl = deps.requestDemoSnapshotChat || requestDemoSnapshotChat;
  let stage = "body";

  try {
    let body;
    try {
      body = await context.request.json();
    } catch (_error) {
      return errorResponse(CHAT_ERROR_CODES.BAD_REQUEST, "请求体必须是合法 JSON。", 400, requestId);
    }

    const message = trimString(body?.message);
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

    const workspaceMode = normalizeWorkspaceMode(body?.workspace_mode);

    stage = "normalize";
    const historyWindow = normalizeSessionHistoryWindowImpl(body?.history);
    const incomingConversationState = normalizeConversationState(body?.conversation_state);
    const normalizedBusinessSnapshot = normalizeBusinessSnapshotImpl(body?.business_snapshot);
    if (workspaceMode === DEMO_WORKSPACE_MODE) {
      stage = "demo_rate_limit";
      const rateLimitResult = consumeDemoRateLimitImpl(context.request);
      if (!rateLimitResult?.ok) {
        return errorResponse(
          CHAT_ERROR_CODES.RATE_LIMITED,
          "演示 AI 请求过于频繁，请稍后再试。",
          429,
          requestId,
          {
            retry_after_sec: Number(rateLimitResult?.retryAfterSec) || 0,
          },
        );
      }

      const termExplainPayload = buildTermExplainPayload({
        message,
        historyWindow,
        businessSnapshot: normalizedBusinessSnapshot,
        conversationState: incomingConversationState,
        requestId,
      });
      if (termExplainPayload) {
        return jsonResponse(termExplainPayload, 200, requestId);
      }

      stage = "demo_gemini";
      const demoChatResult = await requestDemoSnapshotChatImpl({
        message,
        historyWindow,
        businessSnapshot: normalizedBusinessSnapshot,
        conversationState: incomingConversationState,
        env: context.env,
        requestId,
        deps,
      });
      if (!demoChatResult?.ok) {
        return errorResponse(
          demoChatResult?.code || CHAT_ERROR_CODES.INTERNAL_ERROR,
          trimString(demoChatResult?.message) || "聊天服务暂时不可用，请稍后重试。",
          Number(demoChatResult?.status) || 500,
          requestId,
        );
      }

      stage = "response";
      return jsonResponse(
        buildChatSuccessPayload({
          replyText: demoChatResult.replyText,
          evidenceBundle: demoChatResult.evidenceBundle,
          model: demoChatResult.model,
          requestId,
          conversationState: demoChatResult.conversationState,
        }),
        200,
        requestId,
      );
    }

    stage = "auth";
    const authResult = await verifySupabaseAccessTokenImpl(context.request, context.env);
    if (!authResult.ok) {
      return errorResponse(authResult.code, authResult.message, authResult.status, requestId);
    }

    const followupContext = buildEntityScopeFollowupContext(message, incomingConversationState);

    const termExplainPayload = buildTermExplainPayload({
      message,
      historyWindow,
      businessSnapshot: normalizedBusinessSnapshot,
      conversationState: incomingConversationState,
      requestId,
    });
    if (termExplainPayload) {
      return jsonResponse(termExplainPayload, 200, requestId);
    }

    stage = "tool";
    const toolFirstResult = await runToolFirstChatImpl({
      message,
      historyWindow,
      businessSnapshot: normalizedBusinessSnapshot,
      questionJudgment: createDefaultQuestionJudgment(),
      conversationState: incomingConversationState,
      followupContext,
      authToken: authResult.token,
      env: context.env,
      requestId,
      deps,
    });

    if (!toolFirstResult?.ok) {
      return buildToolFirstFailureResponse(toolFirstResult, requestId);
    }

    if (trimString(toolFirstResult?.outputContext?.route_code) !== "direct_answer") {
      const nonDirectResponse = buildNonDirectResponse(toolFirstResult, requestId);
      if (nonDirectResponse) {
        return nonDirectResponse;
      }
    }

    stage = "response";
    const conversationState = buildConversationStatePayload(
      incomingConversationState,
      toolFirstResult.questionJudgment,
      toolFirstResult.toolResult,
    );
    const evidenceBundle = buildEvidenceBundleFromToolResult({
      toolResult: toolFirstResult.toolResult,
      plannerState: toolFirstResult.plannerState,
      toolRuntimeState: toolFirstResult.toolRuntimeState,
    });
    return jsonResponse(
      buildChatSuccessPayload({
        replyText: toolFirstResult.reply,
        evidenceBundle,
        model: toolFirstResult.model,
        requestId,
        conversationState,
      }),
      200,
      requestId,
    );
  } catch (error) {
    logChatError({ requestId, stage, error });
    return errorResponse(
      CHAT_ERROR_CODES.INTERNAL_ERROR,
      "聊天服务暂时不可用，请稍后重试。",
      500,
      requestId,
    );
  }
}

export async function onRequestPost(context) {
  return handleChatRequest(context);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
    },
  });
}
