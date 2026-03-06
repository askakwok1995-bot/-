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

export async function onRequestPost(context) {
  const requestId = crypto.randomUUID();
  const authResult = await verifySupabaseAccessToken(context.request, context.env);
  if (!authResult.ok) {
    return errorResponse(authResult.code, authResult.message, authResult.status, requestId);
  }

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

  const questionJudgment = buildQuestionJudgment(message);
  const hospitalMonthlyDetailRequested = isHospitalMonthlyDetailRequest(message, questionJudgment);
  const productFullRequested = isFullProductRequest(message, questionJudgment);
  const productNamedContext = await resolveProductNamedRequestContext({
    message,
    questionJudgment,
    productFullRequested,
    token: authResult.token,
    env: context.env,
  });
  const productNamedRequested = Boolean(productNamedContext.productNamedRequested);
  const requestedProducts = Array.isArray(productNamedContext.requestedProducts) ? productNamedContext.requestedProducts : [];
  const productNamedMatchMode = trimString(productNamedContext.productNamedMatchMode).toLocaleLowerCase() || "none";
  const hospitalNamedContext = resolveHospitalNamedRequestContext({
    message,
    questionJudgment,
    productFullRequested,
    productNamedRequested,
  });
  const hospitalNamedRequested = Boolean(hospitalNamedContext.hospitalNamedRequested);
  const requestedHospitals = Array.isArray(hospitalNamedContext.requestedHospitals)
    ? hospitalNamedContext.requestedHospitals
    : [];
  const productHospitalContext = resolveProductHospitalRequestContext({
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

  const normalizedBusinessSnapshot = normalizeBusinessSnapshot(body?.business_snapshot);
  const historyWindow = normalizeSessionHistoryWindow(body?.history);
  const sessionState = buildSessionState(message, historyWindow, questionJudgment);

  let dataAvailability = buildDataAvailability(normalizedBusinessSnapshot, effectiveQuestionJudgment, {
    hospitalMonthlyDetailRequested,
    productHospitalRequested,
    hospitalNamedRequested,
    requestedHospitals,
    productFullRequested,
    productNamedRequested,
    productNamedMatchMode,
    requestedProducts,
  });
  let routeDecision = buildRouteDecision(effectiveQuestionJudgment, dataAvailability, {
    productHospitalRequested,
    hospitalNamedRequested,
    productFullRequested,
    productNamedRequested,
  });
  let effectiveBusinessSnapshot = normalizedBusinessSnapshot;
  let retrievalState = createInitialRetrievalState();

  if (routeDecision.route.code === ROUTE_DECISION_CODES.NEED_MORE_DATA) {
    const enhancementResult = await buildOnDemandSnapshotEnhancement({
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
    effectiveBusinessSnapshot = normalizeBusinessSnapshot(enhancementResult.effectiveSnapshot);
    retrievalState = enhancementResult.retrievalState;

    dataAvailability = buildDataAvailability(effectiveBusinessSnapshot, effectiveQuestionJudgment, {
      hospitalMonthlyDetailRequested,
      productHospitalRequested,
      hospitalNamedRequested,
      requestedHospitals,
      productFullRequested,
      productNamedRequested,
      productNamedMatchMode,
      requestedProducts,
    });
    routeDecision = buildRouteDecision(effectiveQuestionJudgment, dataAvailability, {
      productHospitalRequested,
      hospitalNamedRequested,
      productFullRequested,
      productNamedRequested,
    });

    if (routeDecision.route.code === ROUTE_DECISION_CODES.NEED_MORE_DATA) {
      routeDecision = forceBoundedRouteDecision(dataAvailability);
      retrievalState.degraded_to_bounded = true;
    }
  }

  let forcedBounded = false;
  if (routeDecision.route.code === ROUTE_DECISION_CODES.NEED_MORE_DATA) {
    routeDecision = forceBoundedRouteDecision(dataAvailability);
    forcedBounded = true;
  }

  const outputContext = buildOutputContext(routeDecision, effectiveQuestionJudgment, dataAvailability);
  let modelReplyText = "";
  let responseModel = "local-template-refuse";

  if (outputContext.refuse_mode) {
    modelReplyText = buildRefuseReplyTemplate(outputContext);
  } else {
    const geminiResult = await callGemini(message, effectiveBusinessSnapshot, outputContext, context.env);
    if (!geminiResult.ok) {
      return errorResponse(geminiResult.code, geminiResult.message, geminiResult.status, requestId);
    }
    responseModel = geminiResult.model;
    modelReplyText = geminiResult.reply;
  }

  const replyDraft = normalizeOutputReply(modelReplyText);
  const qcResult = applyQualityControl(replyDraft, outputContext, routeDecision);
  const finalReply = qcResult.finalReplyText;

  const phase2Trace = buildPhase2Trace({
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
  logPhase2Trace(phase2Trace, context.env);

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
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS",
    },
  });
}
