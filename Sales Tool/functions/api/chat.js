import {
  AUTH_UPSTREAM_TIMEOUT_MS,
  CHAT_ERROR_CODES,
  MAX_MESSAGE_LENGTH,
  ROUTE_DECISION_CODES,
  SUPABASE_AUTH_USER_PATH,
  fetchWithTimeout,
  getEnvString,
  trimString,
} from "../chat/shared.js";
import {
  buildEffectiveQuestionJudgment,
  buildQuestionJudgment,
  isFullProductRequest,
  isHospitalMonthlyDetailRequest,
} from "../chat/judgment.js";
import { normalizeSessionHistoryWindow, buildSessionState } from "../chat/session.js";
import { buildDataAvailability } from "../chat/availability.js";
import { buildRouteDecision, forceBoundedRouteDecision } from "../chat/routing.js";
import {
  buildOnDemandSnapshotEnhancement,
  createInitialRetrievalState,
  normalizeBusinessSnapshot,
  resolveHospitalNamedRequestContext,
  resolveRetrievalWindowFromSnapshot,
  resolveProductHospitalRequestContext,
  resolveProductNamedRequestContext,
} from "../chat/retrieval.js";
import {
  applyQualityControl,
  buildOutputContext,
  buildPhase2Trace,
  buildRefuseReplyTemplate,
  callGemini,
  logPhase2Trace,
  normalizeOutputReply,
} from "../chat/output.js";
import { createInitialToolRuntimeState, runToolFirstChat } from "../chat/tool-runtime.js";

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

export async function handleChatRequest(context, requestId = crypto.randomUUID(), deps = {}) {
  const verifySupabaseAccessTokenImpl = deps.verifySupabaseAccessToken || verifySupabaseAccessToken;
  const buildQuestionJudgmentImpl = deps.buildQuestionJudgment || buildQuestionJudgment;
  const normalizeSessionHistoryWindowImpl = deps.normalizeSessionHistoryWindow || normalizeSessionHistoryWindow;
  const buildSessionStateImpl = deps.buildSessionState || buildSessionState;
  const resolveProductNamedRequestContextImpl =
    deps.resolveProductNamedRequestContext || resolveProductNamedRequestContext;
  const resolveHospitalNamedRequestContextImpl =
    deps.resolveHospitalNamedRequestContext || resolveHospitalNamedRequestContext;
  const resolveProductHospitalRequestContextImpl =
    deps.resolveProductHospitalRequestContext || resolveProductHospitalRequestContext;
  const normalizeBusinessSnapshotImpl = deps.normalizeBusinessSnapshot || normalizeBusinessSnapshot;
  const resolveRetrievalWindowFromSnapshotImpl =
    deps.resolveRetrievalWindowFromSnapshot || resolveRetrievalWindowFromSnapshot;
  const buildDataAvailabilityImpl = deps.buildDataAvailability || buildDataAvailability;
  const buildRouteDecisionImpl = deps.buildRouteDecision || buildRouteDecision;
  const createInitialRetrievalStateImpl = deps.createInitialRetrievalState || createInitialRetrievalState;
  const buildOnDemandSnapshotEnhancementImpl =
    deps.buildOnDemandSnapshotEnhancement || buildOnDemandSnapshotEnhancement;
  const forceBoundedRouteDecisionImpl = deps.forceBoundedRouteDecision || forceBoundedRouteDecision;
  const buildOutputContextImpl = deps.buildOutputContext || buildOutputContext;
  const buildRefuseReplyTemplateImpl = deps.buildRefuseReplyTemplate || buildRefuseReplyTemplate;
  const callGeminiImpl = deps.callGemini || callGemini;
  const normalizeOutputReplyImpl = deps.normalizeOutputReply || normalizeOutputReply;
  const applyQualityControlImpl = deps.applyQualityControl || applyQualityControl;
  const buildPhase2TraceImpl = deps.buildPhase2Trace || buildPhase2Trace;
  const logPhase2TraceImpl = deps.logPhase2Trace || logPhase2Trace;
  const runToolFirstChatImpl = deps.runToolFirstChat || runToolFirstChat;
  const createInitialToolRuntimeStateImpl = deps.createInitialToolRuntimeState || createInitialToolRuntimeState;
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

    stage = "judgment";
    const questionJudgment = buildQuestionJudgmentImpl(message);
    const historyWindow = normalizeSessionHistoryWindowImpl(body?.history);
    const normalizedBusinessSnapshot = normalizeBusinessSnapshotImpl(body?.business_snapshot);

    if (trimString(questionJudgment?.relevance?.code) === "irrelevant") {
      const routeDecision = {
        route: { code: ROUTE_DECISION_CODES.REFUSE, label: "拒绝/收住" },
        reason_codes: ["irrelevant"],
      };
      stage = "output";
      const outputContext = buildOutputContextImpl(routeDecision, questionJudgment, {});
      const modelReplyText = buildRefuseReplyTemplateImpl(outputContext);
      stage = "qc";
      const replyDraft = normalizeOutputReplyImpl(modelReplyText);
      const qcResult = applyQualityControlImpl(replyDraft, outputContext, routeDecision);
      return jsonResponse(
        {
          reply: qcResult.finalReplyText,
          surfaceReply: qcResult.finalReplyText,
          responseAction: "natural_answer",
          businessIntent: "chat",
          model: "local-template-refuse",
          requestId,
        },
        200,
        requestId,
      );
    }

    const toolWindow = resolveRetrievalWindowFromSnapshotImpl(normalizedBusinessSnapshot);
    let toolRuntimeState = createInitialToolRuntimeStateImpl();
    let toolCallTrace = [];
    let toolFallbackReason = "";
    if (!toolWindow.valid) {
      toolFallbackReason = "invalid_analysis_range";
    }
    if (toolWindow.valid) {
      stage = "tool";
      const toolFirstResult = await runToolFirstChatImpl({
        message,
        historyWindow,
        businessSnapshot: normalizedBusinessSnapshot,
        questionJudgment,
        authToken: authResult.token,
        env: context.env,
        requestId,
        deps,
      });
      toolRuntimeState = toolFirstResult.toolRuntimeState || toolRuntimeState;
      toolCallTrace = Array.isArray(toolFirstResult.toolCallTrace) ? toolFirstResult.toolCallTrace : [];
      toolFallbackReason = trimString(toolFirstResult.fallbackReason) || "tool_first_failed";
      if (toolFirstResult.ok) {
        stage = "qc";
        const routeDecision = {
          route: { code: trimString(toolFirstResult.outputContext?.route_code), label: "" },
          reason_codes: [],
        };
        const replyDraft = normalizeOutputReplyImpl(toolFirstResult.reply);
        const qcResult = applyQualityControlImpl(replyDraft, toolFirstResult.outputContext, routeDecision);
        return jsonResponse(
          {
            reply: qcResult.finalReplyText,
            surfaceReply: qcResult.finalReplyText,
            responseAction: "natural_answer",
            businessIntent: "chat",
            model: toolFirstResult.model,
            requestId,
          },
          200,
          requestId,
        );
      }
    }

    // Legacy fallback is a single保底链路：仅在 analysis_range 无效、tool-first 失败/超限/异常
    // 或未形成稳定最终回答时进入。新业务能力应优先进入 tool executors，而不是继续扩 fallback。

    const hospitalMonthlyDetailRequested = isHospitalMonthlyDetailRequest(message, questionJudgment);
    const productFullRequested = isFullProductRequest(message, questionJudgment);
    const sessionState = buildSessionStateImpl(message, historyWindow, questionJudgment);

    stage = "retrieval";
    const productNamedContext = await resolveProductNamedRequestContextImpl({
      message,
      questionJudgment,
      productFullRequested,
      token: authResult.token,
      env: context.env,
    });
    const productNamedRequested = Boolean(productNamedContext.productNamedRequested);
    const requestedProducts = Array.isArray(productNamedContext.requestedProducts)
      ? productNamedContext.requestedProducts
      : [];
    const productNamedMatchMode = trimString(productNamedContext.productNamedMatchMode).toLocaleLowerCase() || "none";
    const hospitalNamedContext = resolveHospitalNamedRequestContextImpl({
      message,
      questionJudgment,
      productFullRequested,
      productNamedRequested,
    });
    const hospitalNamedRequested = Boolean(hospitalNamedContext.hospitalNamedRequested);
    const requestedHospitals = Array.isArray(hospitalNamedContext.requestedHospitals)
      ? hospitalNamedContext.requestedHospitals
      : [];
    const productHospitalContext = resolveProductHospitalRequestContextImpl({
      message,
      questionJudgment,
      productFullRequested,
      productNamedRequested,
      requestedProducts,
    });
    const productHospitalRequested = Boolean(productHospitalContext.productHospitalRequested);
    const effectiveQuestionJudgment = buildEffectiveQuestionJudgment(questionJudgment, {
      productFullRequested,
      productHospitalRequested,
      productNamedRequested,
      hospitalNamedRequested,
    });

    stage = "availability";
    let dataAvailability = buildDataAvailabilityImpl(normalizedBusinessSnapshot, effectiveQuestionJudgment, {
      hospitalMonthlyDetailRequested,
      productHospitalRequested,
      hospitalNamedRequested,
      requestedHospitals,
      productFullRequested,
      productNamedRequested,
      productNamedMatchMode,
      requestedProducts,
    });

    stage = "routing";
    let routeDecision = buildRouteDecisionImpl(effectiveQuestionJudgment, dataAvailability, {
      productHospitalRequested,
      hospitalNamedRequested,
      productFullRequested,
      productNamedRequested,
    });
    let effectiveBusinessSnapshot = normalizedBusinessSnapshot;
    let retrievalState = createInitialRetrievalStateImpl();

    if (routeDecision.route.code === ROUTE_DECISION_CODES.NEED_MORE_DATA) {
      stage = "retrieval";
      const enhancementResult = await buildOnDemandSnapshotEnhancementImpl({
        questionJudgment: effectiveQuestionJudgment,
        dataAvailability,
        routeDecision,
        sessionState,
        hospitalMonthlyDetailRequested,
        productHospitalRequested,
        hospitalNamedRequested,
        requestedHospitals,
        productFullRequested,
        productNamedRequested,
        requestedProducts,
        businessSnapshot: effectiveBusinessSnapshot,
        authToken: authResult.token,
        env: context.env,
      });
      effectiveBusinessSnapshot = normalizeBusinessSnapshotImpl(enhancementResult.effectiveSnapshot);
      retrievalState = enhancementResult.retrievalState;

      stage = "availability";
      dataAvailability = buildDataAvailabilityImpl(effectiveBusinessSnapshot, effectiveQuestionJudgment, {
        hospitalMonthlyDetailRequested,
        productHospitalRequested,
        hospitalNamedRequested,
        requestedHospitals,
        productFullRequested,
        productNamedRequested,
        productNamedMatchMode,
        requestedProducts,
      });
      stage = "routing";
      routeDecision = buildRouteDecisionImpl(effectiveQuestionJudgment, dataAvailability, {
        productHospitalRequested,
        hospitalNamedRequested,
        productFullRequested,
        productNamedRequested,
      });

      if (routeDecision.route.code === ROUTE_DECISION_CODES.NEED_MORE_DATA) {
        routeDecision = forceBoundedRouteDecisionImpl(dataAvailability);
        retrievalState.degraded_to_bounded = true;
      }
    }

    let forcedBounded = false;
    if (routeDecision.route.code === ROUTE_DECISION_CODES.NEED_MORE_DATA) {
      routeDecision = forceBoundedRouteDecisionImpl(dataAvailability);
      forcedBounded = true;
    }

    stage = "output";
    const outputContext = buildOutputContextImpl(routeDecision, effectiveQuestionJudgment, dataAvailability);
    let modelReplyText = "";
    let responseModel = "local-template-refuse";

    if (outputContext.refuse_mode) {
      modelReplyText = buildRefuseReplyTemplateImpl(outputContext);
    } else {
      stage = "gemini";
      const geminiResult = await callGeminiImpl(message, effectiveBusinessSnapshot, outputContext, context.env, requestId);
      if (!geminiResult.ok) {
        return errorResponse(geminiResult.code, geminiResult.message, geminiResult.status, requestId);
      }
      responseModel = geminiResult.model;
      modelReplyText = geminiResult.reply;
    }

    stage = "qc";
    const replyDraft = normalizeOutputReplyImpl(modelReplyText);
    const qcResult = applyQualityControlImpl(replyDraft, outputContext, routeDecision);
    const finalReply = qcResult.finalReplyText;

    const phase2Trace = buildPhase2TraceImpl({
      requestId,
      questionJudgment,
      dataAvailability,
      sessionState,
      routeDecision,
      retrievalState,
      outputContext,
      forcedBounded,
      qcState: qcResult.qcState,
    });
    logPhase2TraceImpl(phase2Trace, context.env);

    return jsonResponse(
      {
        reply: finalReply,
        surfaceReply: finalReply,
        responseAction: "natural_answer",
        businessIntent: "chat",
        model: responseModel,
        requestId,
      },
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
  return handleChatRequest(context, crypto.randomUUID());
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS",
    },
  });
}
