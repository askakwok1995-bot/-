import { CHAT_ERROR_CODES, QUESTION_JUDGMENT_CODES, trimString } from "../chat/shared.js";
import { buildChatSuccessPayload } from "../chat/render.js";

export function jsonResponse(payload, status = 200, requestId = "") {
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

export function errorResponse(code, message, status, requestId, details = null) {
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

export function successResponse(payload, requestId, status = 200) {
  return jsonResponse(buildChatSuccessPayload(payload), status, requestId);
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

export function logChatError({ requestId, stage, error }) {
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

export function buildToolFirstFailureResponse(toolFirstResult, requestId) {
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

export function buildNonDirectResponse(toolFirstResult, requestId) {
  const routeCode = trimString(toolFirstResult?.outputContext?.route_code);
  if (
    routeCode === "refuse" ||
    trimString(toolFirstResult?.plannerState?.relevance) === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT
  ) {
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
