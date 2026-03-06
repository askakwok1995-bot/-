import {
  AUTH_UPSTREAM_TIMEOUT_MS,
  CHAT_ERROR_CODES,
  MAX_MESSAGE_LENGTH,
  QUESTION_JUDGMENT_LABELS,
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
import { buildDeterministicToolRoute } from "../chat/tool-router.js";
import { runDirectToolChat } from "../chat/tool-direct.js";
import {
  buildConversationState,
  normalizeConversationState,
  resolveConversationContext,
  resolveConversationEntityScope,
} from "../chat/conversation-state.js";
import { normalizeChatMode } from "../chat/contracts.js";
import { buildChatSuccessPayload, buildEvidenceBundleFromSnapshot, buildEvidenceBundleFromToolResult } from "../chat/render.js";
import {
  applyRequestedTimeWindowToSnapshot,
  buildComparisonTimeWindowOutputContextFields,
  buildTimeCompareBoundaryReply,
  buildTimeWindowBoundaryReply,
  buildTimeWindowCoverage,
  buildTimeWindowOutputContextFields,
  parseTimeIntent,
} from "../chat/time-intent.js";

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

function createEmptySessionStateTraceValue() {
  return {
    is_followup: false,
    inherit_primary_dimension: false,
    inherit_scope: false,
    topic_shift_detected: false,
  };
}

function buildToolPathDataAvailability(outputContext = {}) {
  const detailRequestMode = Boolean(outputContext?.overall_period_compare_mode)
    ? "overall_period_compare"
    : Boolean(outputContext?.product_hospital_detail_mode)
      ? "product_hospital"
      : Boolean(outputContext?.hospital_monthly_detail_mode)
        ? "hospital_monthly"
        : Boolean(outputContext?.hospital_named_detail_mode)
          ? "hospital_named"
          : Boolean(outputContext?.product_full_detail_mode)
            ? "product_full"
            : Boolean(outputContext?.product_named_detail_mode)
              ? "product_named"
              : "generic";
  return {
    has_business_data: { code: "available", label: "有" },
    dimension_availability: {
      code: trimString(outputContext?.route_code) === ROUTE_DECISION_CODES.BOUNDED_ANSWER ? "partial" : "available",
      label: "",
    },
    answer_depth: { code: trimString(outputContext?.answer_depth_code) || "focused", label: "" },
    gap_hint_needed: {
      code: Boolean(outputContext?.boundary_needed) ? "yes" : "no",
      label: "",
    },
    detail_request_mode: detailRequestMode,
    hospital_monthly_support: Boolean(outputContext?.hospital_monthly_detail_mode) ? "full" : "none",
    product_hospital_support: trimString(outputContext?.product_hospital_support_code),
    hospital_named_support: trimString(outputContext?.hospital_named_support_code),
    product_full_support: trimString(outputContext?.product_full_support_code),
    product_named_support: trimString(outputContext?.product_named_support_code),
    product_named_match_mode: "",
    requested_product_count_value: Array.isArray(outputContext?.tool_result_matched_products)
      ? outputContext.tool_result_matched_products.length
      : 0,
    product_hospital_hospital_count_value: outputContext?.product_hospital_hospital_count_value ?? 0,
    product_hospital_zero_result: Boolean(outputContext?.product_hospital_zero_result_mode) ? "yes" : "no",
  };
}

function buildToolPathRouteDecision(outputContext = {}) {
  const routeCode = trimString(outputContext?.route_code) || ROUTE_DECISION_CODES.DIRECT_ANSWER;
  return {
    route: { code: routeCode, label: "" },
    reason_codes: routeCode === ROUTE_DECISION_CODES.DIRECT_ANSWER ? ["sufficient"] : [],
  };
}

function buildToolPathRetrievalState(toolRuntimeState = {}, toolRouteType = "") {
  let targetDimension = "";
  if (toolRouteType === "product_hospital" || toolRouteType === "hospital_named" || toolRouteType === "hospital_monthly") {
    targetDimension = "hospital";
  } else if (toolRouteType === "product_full") {
    targetDimension = "product";
  }
  return {
    triggered: Boolean(toolRuntimeState?.attempted),
    target_dimension: targetDimension,
    success: Boolean(toolRuntimeState?.success),
    window_capped: false,
    degraded_to_bounded: false,
  };
}

function buildTimeBoundaryDataAvailability() {
  return {
    has_business_data: { code: "available", label: "有" },
    dimension_availability: { code: "partial", label: "部分具备" },
    answer_depth: { code: "overall", label: "总体判断" },
    gap_hint_needed: { code: "yes", label: "是" },
    detail_request_mode: "generic",
    hospital_monthly_support: "none",
    product_hospital_support: "none",
    hospital_named_support: "none",
    product_full_support: "none",
    product_named_support: "none",
    product_named_match_mode: "none",
    requested_product_count_value: 0,
    product_hospital_hospital_count_value: 0,
    product_hospital_zero_result: "no",
  };
}

function buildTimeBoundaryRouteDecision() {
  return {
    route: { code: ROUTE_DECISION_CODES.BOUNDED_ANSWER, label: "带边界回答" },
    reason_codes: ["gap_hint_needed"],
  };
}

function overrideQuestionJudgmentPrimaryDimension(questionJudgment, primaryDimensionCode) {
  const safeCode = trimString(primaryDimensionCode);
  const base = questionJudgment && typeof questionJudgment === "object" ? questionJudgment : null;
  if (!base || !safeCode || safeCode === trimString(base?.primary_dimension?.code)) {
    return base;
  }
  return {
    ...base,
    primary_dimension: {
      code: safeCode,
      label: QUESTION_JUDGMENT_LABELS.primary_dimension[safeCode] || trimString(base?.primary_dimension?.label),
    },
  };
}

function buildSuccessChatResponse({
  mode,
  businessSnapshot,
  questionJudgment,
  dataAvailability,
  sessionState,
  routeDecision,
  retrievalState,
  outputContext,
  replyText,
  model,
  requestId,
  env,
  toolRouteMode = "",
  toolRouteType = "",
  toolRouteName = "",
  toolRouteFallbackReason = "",
  forcedBounded = false,
  toolResult = null,
  requestedProducts = [],
  requestedHospitals = [],
  requestedTimeWindow = null,
  comparisonTimeWindow = null,
  timeCompareMode = "none",
  normalizeOutputReplyImpl = normalizeOutputReply,
  applyQualityControlImpl = applyQualityControl,
  buildPhase2TraceImpl = buildPhase2Trace,
  logPhase2TraceImpl = logPhase2Trace,
}) {
  const replyDraft = normalizeOutputReplyImpl(replyText);
  const qcResult = applyQualityControlImpl(replyDraft, outputContext, routeDecision);
  const finalReply = qcResult.finalReplyText;
  const evidenceBundle = toolResult
    ? buildEvidenceBundleFromToolResult({
        toolResult,
        outputContext,
        questionJudgment,
        routeDecision,
        requestedProducts,
        requestedHospitals,
      })
    : buildEvidenceBundleFromSnapshot({
        businessSnapshot,
        outputContext,
        questionJudgment,
        routeDecision,
        requestedProducts,
        requestedHospitals,
      });
  const conversationState = buildConversationState({
    questionJudgment,
    requestedTimeWindow,
    comparisonTimeWindow,
    timeCompareMode,
    requestedProducts,
    requestedHospitals,
    routeDecision,
    outputContext,
  });
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
    toolRouteMode,
    toolRouteType,
    toolRouteName,
    toolRouteFallbackReason,
  });
  logPhase2TraceImpl(phase2Trace, env);
  return jsonResponse(
    buildChatSuccessPayload({
      mode,
      replyText: finalReply,
      evidenceBundle,
      questionJudgment,
      routeDecision,
      model,
      requestId,
      conversationState,
    }),
    200,
    requestId,
  );
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
  const buildDeterministicToolRouteImpl = deps.buildDeterministicToolRoute || buildDeterministicToolRoute;
  const runDirectToolChatImpl = deps.runDirectToolChat || runDirectToolChat;
  const parseTimeIntentImpl = deps.parseTimeIntent || parseTimeIntent;
  const buildTimeWindowCoverageImpl = deps.buildTimeWindowCoverage || buildTimeWindowCoverage;
  const applyRequestedTimeWindowToSnapshotImpl =
    deps.applyRequestedTimeWindowToSnapshot || applyRequestedTimeWindowToSnapshot;
  const buildTimeWindowBoundaryReplyImpl = deps.buildTimeWindowBoundaryReply || buildTimeWindowBoundaryReply;
  const buildTimeCompareBoundaryReplyImpl = deps.buildTimeCompareBoundaryReply || buildTimeCompareBoundaryReply;
  const buildTimeWindowOutputContextFieldsImpl =
    deps.buildTimeWindowOutputContextFields || buildTimeWindowOutputContextFields;
  const buildComparisonTimeWindowOutputContextFieldsImpl =
    deps.buildComparisonTimeWindowOutputContextFields || buildComparisonTimeWindowOutputContextFields;
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
    const mode = normalizeChatMode(body?.mode);
    const incomingConversationState = normalizeConversationState(body?.conversation_state);
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
    const rawQuestionJudgment = buildQuestionJudgmentImpl(message);
    const historyWindow = normalizeSessionHistoryWindowImpl(body?.history);
    const normalizedBusinessSnapshot = normalizeBusinessSnapshotImpl(body?.business_snapshot);
    const timeIntent = parseTimeIntentImpl(message, {
      analysisRange: normalizedBusinessSnapshot?.analysis_range,
    });
    let requestedTimeWindow = timeIntent?.requested_time_window || {
      kind: "none",
      label: "",
      start_month: "",
      end_month: "",
      period: "",
      anchor_mode: "none",
    };
    let comparisonTimeWindow = timeIntent?.comparison_time_window || {
      kind: "none",
      label: "",
      start_month: "",
      end_month: "",
      period: "",
      anchor_mode: "none",
    };
    let timeCompareMode = trimString(timeIntent?.time_compare_mode) || "none";
    const sessionState = buildSessionStateImpl(message, historyWindow, rawQuestionJudgment);
    const conversationContext = resolveConversationContext({
      conversationState: incomingConversationState,
      sessionState,
      questionJudgment: rawQuestionJudgment,
      requestedTimeWindow,
      comparisonTimeWindow,
      timeCompareMode,
    });
    const questionJudgment = overrideQuestionJudgmentPrimaryDimension(
      rawQuestionJudgment,
      conversationContext.primary_dimension_code,
    );
    requestedTimeWindow = conversationContext.requested_time_window;
    comparisonTimeWindow = conversationContext.comparison_time_window;
    timeCompareMode = conversationContext.time_compare_mode;
    const timeWindowCoverage = buildTimeWindowCoverageImpl(requestedTimeWindow, normalizedBusinessSnapshot);
    const comparisonTimeWindowCoverage =
      timeCompareMode !== "none"
        ? buildTimeWindowCoverageImpl(comparisonTimeWindow, normalizedBusinessSnapshot)
        : {
            code: "none",
            available_start_month: trimString(normalizedBusinessSnapshot?.analysis_range?.start_month),
            available_end_month: trimString(normalizedBusinessSnapshot?.analysis_range?.end_month),
            available_period: trimString(normalizedBusinessSnapshot?.analysis_range?.period),
          };

    if (trimString(questionJudgment?.relevance?.code) === "irrelevant") {
      const routeDecision = {
        route: { code: ROUTE_DECISION_CODES.REFUSE, label: "拒绝/收住" },
        reason_codes: ["irrelevant"],
      };
      const dataAvailability = {};
      const outputContext = buildOutputContextImpl(routeDecision, questionJudgment, dataAvailability);
      return buildSuccessChatResponse({
        mode,
        businessSnapshot: normalizedBusinessSnapshot,
        questionJudgment,
        dataAvailability,
        sessionState,
        routeDecision,
        retrievalState: createInitialRetrievalStateImpl(),
        outputContext,
        replyText: buildRefuseReplyTemplateImpl(outputContext),
        model: "local-template-refuse",
        requestId,
        env: context.env,
        requestedTimeWindow,
        comparisonTimeWindow,
        timeCompareMode,
        normalizeOutputReplyImpl,
        applyQualityControlImpl,
        buildPhase2TraceImpl,
        logPhase2TraceImpl,
      });
    }

    const hospitalMonthlyDetailRequested = isHospitalMonthlyDetailRequest(message, questionJudgment);
    const productFullRequested = isFullProductRequest(message, questionJudgment);
    const requestedTimeWindowFields = buildTimeWindowOutputContextFieldsImpl(requestedTimeWindow, timeWindowCoverage);
    const comparisonTimeWindowFields = buildComparisonTimeWindowOutputContextFieldsImpl(
      comparisonTimeWindow,
      comparisonTimeWindowCoverage,
      timeCompareMode,
    );

    const requestedTimeWindowKind = trimString(requestedTimeWindow?.kind);
    const requestedTimeWindowAnchorMode = trimString(requestedTimeWindow?.anchor_mode);
    const requestedTimeWindowHasExecutableRange =
      Boolean(trimString(requestedTimeWindow?.start_month)) && Boolean(trimString(requestedTimeWindow?.end_month));
    const requestedTimeWindowIsAmbiguous =
      requestedTimeWindowKind === "absolute" && requestedTimeWindowAnchorMode === "none";
    const comparisonTimeWindowKind = trimString(comparisonTimeWindow?.kind);
    const comparisonTimeWindowAnchorMode = trimString(comparisonTimeWindow?.anchor_mode);
    const comparisonTimeWindowHasExecutableRange =
      Boolean(trimString(comparisonTimeWindow?.start_month)) && Boolean(trimString(comparisonTimeWindow?.end_month));
    const comparisonTimeWindowIsAmbiguous =
      comparisonTimeWindowKind === "absolute" && comparisonTimeWindowAnchorMode === "none";

    if (
      timeCompareMode !== "none" &&
      (
        !requestedTimeWindowHasExecutableRange ||
        !comparisonTimeWindowHasExecutableRange ||
        requestedTimeWindowIsAmbiguous ||
        comparisonTimeWindowIsAmbiguous ||
        trimString(timeWindowCoverage?.code) !== "full" ||
        trimString(comparisonTimeWindowCoverage?.code) !== "full"
      )
    ) {
      const routeDecision = buildTimeBoundaryRouteDecision();
      const dataAvailability = buildTimeBoundaryDataAvailability();
      const outputContext = {
        ...buildOutputContextImpl(routeDecision, questionJudgment, dataAvailability),
        ...requestedTimeWindowFields,
        ...comparisonTimeWindowFields,
        local_response_mode: "time_boundary",
      };
      return buildSuccessChatResponse({
        mode,
        businessSnapshot: normalizedBusinessSnapshot,
        questionJudgment,
        dataAvailability,
        sessionState,
        routeDecision,
        retrievalState: createInitialRetrievalStateImpl(),
        outputContext,
        replyText: buildTimeCompareBoundaryReplyImpl({
          requestedTimeWindow,
          comparisonTimeWindow,
          primaryCoverage: timeWindowCoverage,
          comparisonCoverage: comparisonTimeWindowCoverage,
          timeCompareMode,
        }),
        model: "local-template-time-boundary",
        requestId,
        env: context.env,
        toolRouteMode: "legacy",
        toolRouteType: "none",
        toolRouteName: "",
        toolRouteFallbackReason:
          (!requestedTimeWindowHasExecutableRange ||
            !comparisonTimeWindowHasExecutableRange ||
            requestedTimeWindowIsAmbiguous ||
            comparisonTimeWindowIsAmbiguous)
            ? "time_compare_year_ambiguous"
            : "time_compare_not_fully_covered",
        requestedTimeWindow,
        comparisonTimeWindow,
        timeCompareMode,
        normalizeOutputReplyImpl,
        applyQualityControlImpl,
        buildPhase2TraceImpl,
        logPhase2TraceImpl,
      });
    }

    if (
      requestedTimeWindowKind !== "none" &&
      (!requestedTimeWindowHasExecutableRange ||
        requestedTimeWindowIsAmbiguous ||
        trimString(timeWindowCoverage?.code) !== "full")
    ) {
      const routeDecision = buildTimeBoundaryRouteDecision();
      const dataAvailability = buildTimeBoundaryDataAvailability();
      const outputContext = {
        ...buildOutputContextImpl(routeDecision, questionJudgment, dataAvailability),
        ...requestedTimeWindowFields,
        ...comparisonTimeWindowFields,
        local_response_mode: "time_boundary",
      };
      return buildSuccessChatResponse({
        mode,
        businessSnapshot: normalizedBusinessSnapshot,
        questionJudgment,
        dataAvailability,
        sessionState,
        routeDecision,
        retrievalState: createInitialRetrievalStateImpl(),
        outputContext,
        replyText: buildTimeWindowBoundaryReplyImpl({
          requestedTimeWindow,
          coverage: timeWindowCoverage,
        }),
        model: "local-template-time-boundary",
        requestId,
        env: context.env,
        toolRouteMode: "legacy",
        toolRouteType: "none",
        toolRouteName: "",
        toolRouteFallbackReason:
          requestedTimeWindowKind !== "none" && (!requestedTimeWindowHasExecutableRange || requestedTimeWindowIsAmbiguous)
            ? "time_window_year_ambiguous"
            : "time_window_not_fully_covered",
        requestedTimeWindow,
        comparisonTimeWindow,
        timeCompareMode,
        normalizeOutputReplyImpl,
        applyQualityControlImpl,
        buildPhase2TraceImpl,
        logPhase2TraceImpl,
      });
    }

    const scopedBusinessSnapshot =
      timeCompareMode === "none" && requestedTimeWindowKind !== "none" && trimString(timeWindowCoverage?.code) === "full"
        ? applyRequestedTimeWindowToSnapshotImpl(normalizedBusinessSnapshot, requestedTimeWindow)
        : normalizedBusinessSnapshot;

    stage = "retrieval";
    const productNamedContext = await resolveProductNamedRequestContextImpl({
      message,
      questionJudgment,
      productFullRequested,
      token: authResult.token,
      env: context.env,
    });
    let productNamedRequested = Boolean(productNamedContext.productNamedRequested);
    let requestedProducts = Array.isArray(productNamedContext.requestedProducts)
      ? productNamedContext.requestedProducts
      : [];
    const productNamedMatchMode = trimString(productNamedContext.productNamedMatchMode).toLocaleLowerCase() || "none";
    const hospitalNamedContext = resolveHospitalNamedRequestContextImpl({
      message,
      questionJudgment,
      productFullRequested,
      productNamedRequested,
    });
    let hospitalNamedRequested = Boolean(hospitalNamedContext.hospitalNamedRequested);
    let requestedHospitals = Array.isArray(hospitalNamedContext.requestedHospitals)
      ? hospitalNamedContext.requestedHospitals
      : [];
    const conversationEntityScope = resolveConversationEntityScope({
      conversationState: incomingConversationState,
      sessionState,
      requestedProducts,
      requestedHospitals,
      productNamedRequested,
      hospitalNamedRequested,
    });
    productNamedRequested = conversationEntityScope.product_named_requested;
    hospitalNamedRequested = conversationEntityScope.hospital_named_requested;
    requestedProducts = conversationEntityScope.requested_products;
    requestedHospitals = conversationEntityScope.requested_hospitals;
    const productHospitalContext = resolveProductHospitalRequestContextImpl({
      message,
      questionJudgment,
      productFullRequested,
      productNamedRequested,
      requestedProducts,
    });
    const productHospitalRequested = Boolean(productHospitalContext.productHospitalRequested);
    const effectiveProductNamedContext = {
      ...productNamedContext,
      productNamedRequested,
      requestedProducts,
    };
    const effectiveHospitalNamedContext = {
      ...hospitalNamedContext,
      hospitalNamedRequested,
      requestedHospitals,
    };
    const planningQuestionJudgment = questionJudgment;

    const toolWindow = resolveRetrievalWindowFromSnapshotImpl(scopedBusinessSnapshot);
    let toolRuntimeState = createInitialToolRuntimeStateImpl();
    let toolCallTrace = [];
    let toolFallbackReason = "";
    let toolRouteMode = "legacy";
    let toolRouteType = "none";
    let toolRouteName = "";
    const deterministicToolRoute = buildDeterministicToolRouteImpl({
      message,
      questionJudgment: planningQuestionJudgment,
      requestedTimeWindow,
      comparisonTimeWindow,
      timeCompareMode,
      primaryWindowCoverageCode: trimString(timeWindowCoverage?.code),
      comparisonWindowCoverageCode: trimString(comparisonTimeWindowCoverage?.code),
      productFullRequested,
      hospitalMonthlyDetailRequested,
      productNamedContext: effectiveProductNamedContext,
      hospitalNamedContext: effectiveHospitalNamedContext,
      productHospitalContext,
    });
    if (deterministicToolRoute.matched) {
      toolRouteType = trimString(deterministicToolRoute.route_type);
      toolRouteName = trimString(deterministicToolRoute.tool_name);
    }
    if (!toolWindow.valid) {
      toolFallbackReason = "invalid_analysis_range";
    } else if (deterministicToolRoute.matched) {
      toolRouteMode = "deterministic";
      stage = "tool";
      const directToolResult = await runDirectToolChatImpl(
        {
          message,
          businessSnapshot: scopedBusinessSnapshot,
          requestedTimeWindow,
          comparisonTimeWindow,
          timeCompareMode,
          questionJudgment: planningQuestionJudgment,
          authToken: authResult.token,
          env: context.env,
          requestId,
          deterministicToolRoute,
        },
        deps,
      );
      toolRuntimeState = directToolResult.toolRuntimeState || toolRuntimeState;
      toolCallTrace = Array.isArray(directToolResult.toolCallTrace) ? directToolResult.toolCallTrace : [];
      toolFallbackReason = trimString(directToolResult.fallbackReason) || "";
      if (directToolResult.ok) {
        const routeDecision = buildToolPathRouteDecision(directToolResult.outputContext);
        const outputContext = {
          ...directToolResult.outputContext,
          ...requestedTimeWindowFields,
          ...comparisonTimeWindowFields,
          local_response_mode: trimString(directToolResult.outputContext?.local_response_mode) || "none",
        };
        return buildSuccessChatResponse({
          mode,
          businessSnapshot: scopedBusinessSnapshot,
          questionJudgment: planningQuestionJudgment,
          dataAvailability: buildToolPathDataAvailability(outputContext),
          sessionState,
          routeDecision,
          retrievalState: buildToolPathRetrievalState(toolRuntimeState, toolRouteType),
          outputContext,
          replyText: directToolResult.reply,
          model: directToolResult.model,
          requestId,
          env: context.env,
          toolRouteMode,
          toolRouteType,
          toolRouteName,
          toolRouteFallbackReason: "",
          toolResult: directToolResult.toolResult,
          requestedProducts,
          requestedHospitals,
          requestedTimeWindow,
          comparisonTimeWindow,
          timeCompareMode,
          normalizeOutputReplyImpl,
          applyQualityControlImpl,
          buildPhase2TraceImpl,
          logPhase2TraceImpl,
        });
      }
      toolRouteMode = "legacy";
    } else if (toolWindow.valid) {
      toolRouteMode = "auto";
      stage = "tool";
      const toolFirstResult = await runToolFirstChatImpl({
        message,
        historyWindow,
        businessSnapshot: scopedBusinessSnapshot,
        requestedTimeWindow,
        questionJudgment: planningQuestionJudgment,
        authToken: authResult.token,
        env: context.env,
        requestId,
        deps,
      });
      toolRuntimeState = toolFirstResult.toolRuntimeState || toolRuntimeState;
      toolCallTrace = Array.isArray(toolFirstResult.toolCallTrace) ? toolFirstResult.toolCallTrace : [];
      toolFallbackReason = trimString(toolFirstResult.fallbackReason) || "tool_first_failed";
      if (toolFirstResult.ok) {
        const routeDecision = buildToolPathRouteDecision(toolFirstResult.outputContext);
        const outputContext = {
          ...toolFirstResult.outputContext,
          ...requestedTimeWindowFields,
          ...comparisonTimeWindowFields,
          tool_route_mode: "auto",
          tool_route_type: "none",
          tool_route_name: "",
          local_response_mode: trimString(toolFirstResult.outputContext?.local_response_mode) || "none",
        };
        return buildSuccessChatResponse({
          mode,
          businessSnapshot: scopedBusinessSnapshot,
          questionJudgment: planningQuestionJudgment,
          dataAvailability: buildToolPathDataAvailability(outputContext),
          sessionState,
          routeDecision,
          retrievalState: buildToolPathRetrievalState(toolRuntimeState, "generic"),
          outputContext,
          replyText: toolFirstResult.reply,
          model: toolFirstResult.model,
          requestId,
          env: context.env,
          toolRouteMode,
          toolRouteType,
          toolRouteName,
          toolRouteFallbackReason: "",
          toolResult: toolFirstResult.toolResult,
          requestedProducts,
          requestedHospitals,
          requestedTimeWindow,
          comparisonTimeWindow,
          timeCompareMode,
          normalizeOutputReplyImpl,
          applyQualityControlImpl,
          buildPhase2TraceImpl,
          logPhase2TraceImpl,
        });
      }
      toolRouteMode = "legacy";
    }

    // Legacy fallback is a single保底链路：仅在 analysis_range 无效、tool-first 失败/超限/异常
    // 或未形成稳定最终回答时进入。新业务能力应优先进入 tool executors，而不是继续扩 fallback。
    const effectiveQuestionJudgment = buildEffectiveQuestionJudgment(questionJudgment, {
      productFullRequested,
      productHospitalRequested,
      productNamedRequested,
      hospitalNamedRequested,
    });

    stage = "availability";
    let dataAvailability = buildDataAvailabilityImpl(scopedBusinessSnapshot, effectiveQuestionJudgment, {
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
    let effectiveBusinessSnapshot = scopedBusinessSnapshot;
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
    const outputContext = {
      ...buildOutputContextImpl(routeDecision, effectiveQuestionJudgment, dataAvailability),
      ...requestedTimeWindowFields,
      ...comparisonTimeWindowFields,
    };
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

    return buildSuccessChatResponse({
      mode,
      businessSnapshot: effectiveBusinessSnapshot,
      questionJudgment: effectiveQuestionJudgment,
      dataAvailability,
      sessionState,
      routeDecision,
      retrievalState,
      outputContext,
      replyText: modelReplyText,
      model: responseModel,
      requestId,
      env: context.env,
      toolRouteMode,
      toolRouteType,
      toolRouteName,
      toolRouteFallbackReason: toolFallbackReason,
      forcedBounded,
      requestedProducts,
      requestedHospitals,
      requestedTimeWindow,
      comparisonTimeWindow,
      timeCompareMode,
      normalizeOutputReplyImpl,
      applyQualityControlImpl,
      buildPhase2TraceImpl,
      logPhase2TraceImpl,
    });
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
