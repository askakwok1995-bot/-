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
import { isValidChatMode } from "../chat/contracts.js";
import { buildChatSuccessPayload, buildEvidenceBundleFromToolResult } from "../chat/render.js";

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

    const rawMode = trimString(body?.mode);
    if (!isValidChatMode(rawMode)) {
      return errorResponse(
        CHAT_ERROR_CODES.BAD_REQUEST,
        "mode 仅支持 auto；briefing、diagnosis、action-plan 已移除。",
        400,
        requestId,
      );
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
      return buildNonDirectResponse(toolFirstResult, requestId);
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
