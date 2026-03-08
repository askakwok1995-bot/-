import {
  AUTH_UPSTREAM_TIMEOUT_MS,
  CHAT_ERROR_CODES,
  MAX_MESSAGE_LENGTH,
  QUESTION_JUDGMENT_CODES,
  SUPABASE_AUTH_USER_PATH,
  fetchWithTimeout,
  getEnvString,
  normalizeBusinessSnapshot,
  trimString,
} from "../chat/shared.js";
import { normalizeSessionHistoryWindow } from "../chat/session.js";
import { runToolFirstChat } from "../chat/tool-runtime.js";
import { normalizeConversationState } from "../chat/conversation-state.js";
import { buildChatSuccessPayload, buildEvidenceBundleFromToolResult } from "../chat/render.js";

const TERM_EXPLAIN_CUE_RE = /(什么意思|是什么|指什么|怎么理解)/u;
const EXPLICIT_TERM_RE = /([A-Za-z0-9\u4e00-\u9fa5]{1,16}(?:覆盖率|占比|集中度|贡献|趋势))/u;

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
  return {
    ...baseState,
    primary_dimension_code:
      trimString(questionJudgment?.primary_dimension?.code) || trimString(baseState.primary_dimension_code),
    source_period:
      trimString(toolResult?.range?.period) ||
      trimString(baseState.source_period),
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

export async function handleChatRequest(context, requestId = crypto.randomUUID(), deps = {}) {
  const verifySupabaseAccessTokenImpl = deps.verifySupabaseAccessToken || verifySupabaseAccessToken;
  const normalizeSessionHistoryWindowImpl = deps.normalizeSessionHistoryWindow || normalizeSessionHistoryWindow;
  const normalizeBusinessSnapshotImpl = deps.normalizeBusinessSnapshot || normalizeBusinessSnapshot;
  const runToolFirstChatImpl = deps.runToolFirstChat || runToolFirstChat;
  let stage = "auth";

  try {
    const authResult = await verifySupabaseAccessTokenImpl(context.request, context.env);
    if (!authResult.ok) {
      return errorResponse(authResult.code, authResult.message, authResult.status, requestId);
    }

    stage = "body";
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

    stage = "normalize";
    const historyWindow = normalizeSessionHistoryWindowImpl(body?.history);
    const incomingConversationState = normalizeConversationState(body?.conversation_state);
    const normalizedBusinessSnapshot = normalizeBusinessSnapshotImpl(body?.business_snapshot);

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
