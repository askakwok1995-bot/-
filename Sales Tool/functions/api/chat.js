import {
  CHAT_ERROR_CODES,
  MAX_MESSAGE_LENGTH,
  QUESTION_JUDGMENT_CODES,
  normalizeBusinessSnapshot,
  trimString,
} from "../chat/shared.js";
import { normalizeSessionHistoryWindow } from "../chat/session.js";
import { runToolFirstChat } from "../chat/tool-runtime.js";
import { buildEvidenceBundleFromToolResult } from "../chat/render.js";
import { checkActiveEntitlement, verifySupabaseAccessToken } from "./chat-auth.js";
import { consumeDemoRateLimit, requestDemoSnapshotChat } from "./chat-demo.js";
import {
  buildConversationStatePayload,
  buildEntityScopeFollowupContext,
  buildTermExplainPayload,
  syncConversationStateWithSnapshot,
} from "./chat-followup.js";
import {
  buildNonDirectResponse,
  buildToolFirstFailureResponse,
  errorResponse,
  jsonResponse,
  logChatError,
  successResponse,
} from "./chat-response.js";

const DEMO_WORKSPACE_MODE = "demo";
const LIVE_WORKSPACE_MODE = "live";

function normalizeWorkspaceMode(value) {
  return trimString(value).toLowerCase() === DEMO_WORKSPACE_MODE ? DEMO_WORKSPACE_MODE : LIVE_WORKSPACE_MODE;
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

export async function handleChatRequest(context, requestId = crypto.randomUUID(), deps = {}) {
  const verifySupabaseAccessTokenImpl = deps.verifySupabaseAccessToken || verifySupabaseAccessToken;
  const checkActiveEntitlementImpl = deps.checkActiveEntitlement || checkActiveEntitlement;
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
    const normalizedBusinessSnapshot = normalizeBusinessSnapshotImpl(body?.business_snapshot);
    const incomingConversationState = syncConversationStateWithSnapshot(
      body?.conversation_state,
      normalizedBusinessSnapshot,
    );
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
      return successResponse(
        {
          replyText: demoChatResult.replyText,
          evidenceBundle: demoChatResult.evidenceBundle,
          model: demoChatResult.model,
          requestId,
          conversationState: demoChatResult.conversationState,
        },
        requestId,
      );
    }

    stage = "auth";
    const authResult = await verifySupabaseAccessTokenImpl(context.request, context.env);
    if (!authResult.ok) {
      return errorResponse(authResult.code, authResult.message, authResult.status, requestId);
    }
    if (trimString(authResult?.userId)) {
      const entitlementResult = await checkActiveEntitlementImpl(authResult, context.env);
      if (!entitlementResult?.ok) {
        return errorResponse(
          entitlementResult?.code || CHAT_ERROR_CODES.UNAUTHORIZED,
          trimString(entitlementResult?.message) || "当前账号授权不可用。",
          Number(entitlementResult?.status) || 403,
          requestId,
        );
      }
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
    return successResponse(
      {
        replyText: toolFirstResult.reply,
        evidenceBundle,
        model: toolFirstResult.model,
        requestId,
        conversationState,
      },
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

export { buildTermExplainPayload };
