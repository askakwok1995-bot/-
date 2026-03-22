import {
  QUESTION_JUDGMENT_CODES,
  ROUTE_DECISION_CODES,
  TOOL_RUNTIME_MAX_CALLS,
  TOOL_RUNTIME_MAX_ROUNDS,
  normalizeBusinessSnapshot,
  normalizeNumericValue,
  trimString,
} from "./shared.js";
import { createToolRuntimeContext, executeToolByName } from "./tool-executors.js";
import { extractGeminiReply, requestGeminiGenerateContent, shouldLogPhase2Trace } from "./output.js";
import {
  buildPlannerFunctionResponse,
  buildToolPayload,
  collectCompletedEvidenceTypes,
  computeMissingEvidenceTypes,
  DIMENSION_REPORT_MACRO_TOOL_NAMES,
  extractRuntimeCalls,
  isBroadOverallMacroStartCandidate,
  MACRO_TOOL_NAMES,
  normalizePlannerState,
  PLANNER_VIEW_NAMES,
  shouldUseDimensionReportMacroFirstRound,
  shouldUseMacroOnlyFirstRound,
  validatePlannerState,
} from "./tool-runtime-planner.js";

const TOOL_FALLBACK_REASONS = Object.freeze({
  INVALID_ANALYSIS_RANGE: "invalid_analysis_range",
  TOOL_LOOP_LIMIT_EXCEEDED: "tool_loop_limit_exceeded",
  TOOL_EXECUTION_FAILED: "tool_execution_failed",
  GEMINI_ERROR: "gemini_error",
  EMPTY_FINAL_REPLY: "empty_final_reply",
  PLANNER_CALL_MISSING: "planner_call_missing",
  PLANNER_RELEVANT_WITHOUT_TOOL: "planner_relevant_without_tool",
  PLANNER_REJECTED_WITHOUT_RESUBMISSION: "planner_rejected_without_resubmission",
});

export function createInitialToolRuntimeState() {
  return {
    attempted: false,
    planner_completed: false,
    used_tools: [],
    tool_call_count: 0,
    rounds: 0,
    final_route_code: "",
    success: false,
    fallback_reason: "",
    question_type: "overview",
    evidence_types_requested: [],
    evidence_types_completed: [],
    missing_evidence_types: [],
  };
}

function buildToolSeedPrompt(message, businessSnapshot, conversationState = null, followupContext = null) {
  const normalizedSnapshot = normalizeBusinessSnapshot(businessSnapshot);
  const snapshotPeriod = trimString(normalizedSnapshot?.analysis_range?.period);
  const promptLines = [
    "以下是当前分析范围内的轻量业务快照（seed context），可作为初始背景，但不是唯一数据来源。",
    "所有分析必须以当前报表区间为准，不解释用户问题中的时间词。",
    "一旦工具返回结果，后续结论、数值、coverage 和对象范围必须以工具结果为准。",
    "如需更具体的数据，请优先调用业务工具。",
  ];
  const scopedHospitals = Array.isArray(conversationState?.entity_scope?.hospitals)
    ? conversationState.entity_scope.hospitals.map((item) => trimString(item)).filter((item) => item)
    : [];
  const scopedProducts = Array.isArray(conversationState?.entity_scope?.products)
    ? conversationState.entity_scope.products.map((item) => trimString(item)).filter((item) => item)
    : [];
  const primaryDimensionCode = trimString(conversationState?.primary_dimension_code);
  const sourcePeriod = trimString(conversationState?.source_period);
  if (primaryDimensionCode || scopedHospitals.length > 0 || scopedProducts.length > 0 || sourcePeriod) {
    promptLines.push("", "当前会话上下文：");
    if (primaryDimensionCode) {
      promptLines.push(`- 延续主分析维度：${primaryDimensionCode}`);
    }
    if (sourcePeriod) {
      const sourcePeriodHint =
        snapshotPeriod && sourcePeriod !== snapshotPeriod
          ? `${sourcePeriod}（仅供承接上下文；若与当前 analysis_range 冲突，一律以 ${snapshotPeriod} 为准）`
          : sourcePeriod;
      promptLines.push(`- 上一轮来源时间段：${sourcePeriodHint}`);
    }
    if (scopedHospitals.length > 0) {
      promptLines.push(`- 已确认医院对象：${scopedHospitals.join("、")}`);
    }
    if (scopedProducts.length > 0) {
      promptLines.push(`- 已确认产品对象：${scopedProducts.join("、")}`);
    }
  }
  if (trimString(followupContext?.kind) === "entity_scope_followup") {
    promptLines.push("", "本轮用户使用的是延续指代，请默认沿用上一轮已确认对象继续分析。");
    if (trimString(followupContext?.primary_entity_type) === "hospital" && scopedHospitals.length > 0) {
      promptLines.push(`- 本轮默认分析医院对象：${scopedHospitals.join("、")}`);
    } else if (trimString(followupContext?.primary_entity_type) === "product" && scopedProducts.length > 0) {
      promptLines.push(`- 本轮默认分析产品对象：${scopedProducts.join("、")}`);
    }
  }
  promptLines.push(
    "",
    "seed_context:",
    JSON.stringify(normalizedSnapshot, null, 2),
    "",
    `用户问题：${message}`,
  );
  return promptLines.join("\n");
}

function mapHistoryRole(role) {
  const safeRole = trimString(role).toLocaleLowerCase();
  return safeRole === "assistant" ? "model" : "user";
}

function buildInitialContents(historyWindow, message, businessSnapshot, conversationState, followupContext, options = {}) {
  const contents = [];
  const safeHistory = compactHistoryWindow(historyWindow, options);
  safeHistory.forEach((item) => {
    const content = trimString(item?.content);
    if (!content) {
      return;
    }
    contents.push({
      role: mapHistoryRole(item?.role),
      parts: [{ text: content }],
    });
  });
  contents.push({
    role: "user",
    parts: [{ text: buildToolSeedPrompt(message, businessSnapshot, conversationState, followupContext) }],
  });
  return contents;
}

function compactHistoryWindow(historyWindow, options = {}) {
  const safeHistory = Array.isArray(historyWindow) ? historyWindow : [];
  if (!options?.compactBroadOverallHistory) {
    return safeHistory;
  }
  return safeHistory.slice(-2);
}

async function executePlannedCalls({
  plannedCalls,
  state,
  runtimeContext,
  deps,
  executeToolByNameImpl,
  lastToolResultRef,
  toolCallTrace,
  contents,
  env,
  requestId,
}) {
  for (const call of plannedCalls) {
    if (state.tool_call_count >= TOOL_RUNTIME_MAX_CALLS) {
      state.fallback_reason = TOOL_FALLBACK_REASONS.TOOL_LOOP_LIMIT_EXCEEDED;
      logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
      return {
        ok: false,
        fallbackReason: state.fallback_reason,
        toolRuntimeState: state,
        toolCallTrace,
      };
    }
    let executionResult;
    try {
      executionResult = await executeToolByNameImpl(call.name, call.args, runtimeContext, deps);
    } catch (_error) {
      state.fallback_reason = TOOL_FALLBACK_REASONS.TOOL_EXECUTION_FAILED;
      logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
      return {
        ok: false,
        fallbackReason: state.fallback_reason,
        toolRuntimeState: state,
        toolCallTrace,
      };
    }
    state.tool_call_count += 1;
    state.used_tools.push(trimString(call.name));
    state.evidence_types_completed = Array.from(
      new Set([...state.evidence_types_completed, ...collectCompletedEvidenceTypes(executionResult)]),
    );
    lastToolResultRef.current = executionResult;
    toolCallTrace.push(buildToolCallTraceEntry(call, executionResult));
    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: trimString(call.name),
            response: executionResult.result,
          },
        },
      ],
    });
  }
  return { ok: true };
}

function buildAnalysisConfidence(routeCode, missingEvidenceTypes, coverageCode) {
  if (routeCode === ROUTE_DECISION_CODES.REFUSE) {
    return "low";
  }
  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER) {
    return missingEvidenceTypes.length > 0 || coverageCode !== "full" ? "low" : "medium";
  }
  if (missingEvidenceTypes.length > 0 || coverageCode === "partial") {
    return "medium";
  }
  return "high";
}

function deriveFinalRouteCode(lastToolResult, plannerState) {
  if (trimString(plannerState?.route_intent) === ROUTE_DECISION_CODES.REFUSE) {
    return ROUTE_DECISION_CODES.REFUSE;
  }
  const coverageCode = trimString(lastToolResult?.result?.coverage?.code);
  const hasUnmatchedEntities =
    (Array.isArray(lastToolResult?.result?.unmatched_entities?.products) && lastToolResult.result.unmatched_entities.products.length > 0) ||
    (Array.isArray(lastToolResult?.result?.unmatched_entities?.hospitals) && lastToolResult.result.unmatched_entities.hospitals.length > 0);
  if (
    trimString(plannerState?.route_intent) === ROUTE_DECISION_CODES.BOUNDED_ANSWER ||
    (Array.isArray(plannerState?.missing_evidence_types) && plannerState.missing_evidence_types.length > 0) ||
    coverageCode === "partial" ||
    coverageCode === "none" ||
    hasUnmatchedEntities
  ) {
    return ROUTE_DECISION_CODES.BOUNDED_ANSWER;
  }
  return ROUTE_DECISION_CODES.DIRECT_ANSWER;
}

export function buildToolOutputContext(questionJudgment, lastToolResult, plannerState = null) {
  const routeCode = deriveFinalRouteCode(lastToolResult, plannerState);
  if (routeCode === ROUTE_DECISION_CODES.REFUSE) {
    return {
      route_code: ROUTE_DECISION_CODES.REFUSE,
      primary_dimension_code: trimString(questionJudgment?.primary_dimension?.code),
      granularity_code: trimString(questionJudgment?.granularity?.code),
      boundary_needed: false,
      refuse_mode: true,
      planner_route_intent: trimString(plannerState?.route_intent),
      planner_question_type: trimString(plannerState?.question_type),
      planner_required_evidence: Array.isArray(plannerState?.required_evidence) ? plannerState.required_evidence.slice(0, 6) : [],
      planner_requested_views: Array.isArray(plannerState?.requested_views) ? plannerState.requested_views.slice(0, 6) : [],
      planner_missing_evidence_types: Array.isArray(plannerState?.missing_evidence_types)
        ? plannerState.missing_evidence_types.slice(0, 6)
        : [],
      local_response_mode: "planner_refuse",
    };
  }
  const detailRequestMode = trimString(lastToolResult?.meta?.detail_request_mode);
  const matchedHospitals = Array.isArray(lastToolResult?.meta?.matched_hospitals) ? lastToolResult.meta.matched_hospitals : [];
  const matchedProducts = Array.isArray(lastToolResult?.meta?.matched_products) ? lastToolResult.meta.matched_products : [];
  const rows = Array.isArray(lastToolResult?.result?.rows) ? lastToolResult.result.rows : [];
  const primarySummary = lastToolResult?.result?.summary?.primary && typeof lastToolResult.result.summary.primary === "object"
    ? lastToolResult.result.summary.primary
    : {};
  const comparisonSummary = lastToolResult?.result?.summary?.comparison && typeof lastToolResult.result.summary.comparison === "object"
    ? lastToolResult.result.summary.comparison
    : {};
  const comparisonRange = lastToolResult?.result?.comparison_range && typeof lastToolResult.result.comparison_range === "object"
    ? lastToolResult.result.comparison_range
    : {};
  const deltaSummary = lastToolResult?.result?.summary?.delta && typeof lastToolResult.result.summary.delta === "object"
    ? lastToolResult.result.summary.delta
    : {};
  const rowNames = rows
    .map((row) => trimString(row?.hospital_name || row?.product_name || row?.period))
    .filter((item) => item)
    .slice(0, 5);
  return {
    route_code: routeCode,
    primary_dimension_code: trimString(questionJudgment?.primary_dimension?.code),
    granularity_code: trimString(questionJudgment?.granularity?.code),
    boundary_needed: routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER,
    refuse_mode: false,
    hospital_monthly_detail_mode: detailRequestMode === "hospital_monthly",
    product_hospital_detail_mode: detailRequestMode === "product_hospital",
    hospital_named_detail_mode: detailRequestMode === "hospital_named",
    product_full_detail_mode: detailRequestMode === "product_full",
    product_named_detail_mode: detailRequestMode === "product_named",
    overall_period_compare_mode: detailRequestMode === "overall_period_compare",
    product_hospital_support_code:
      detailRequestMode === "product_hospital" ? trimString(lastToolResult?.meta?.coverage_code) : "",
    product_hospital_hospital_count_value:
      detailRequestMode === "product_hospital"
        ? Array.isArray(lastToolResult?.result?.rows)
          ? lastToolResult.result.rows.length
          : 0
        : 0,
    hospital_named_support_code:
      detailRequestMode === "hospital_named" ? trimString(lastToolResult?.meta?.coverage_code) : "",
    product_full_support_code:
      detailRequestMode === "product_full" ? trimString(lastToolResult?.meta?.coverage_code) : "",
    product_named_support_code:
      detailRequestMode === "product_named" ? trimString(lastToolResult?.meta?.coverage_code) : "",
    dimension_availability_code: trimString(lastToolResult?.meta?.coverage_code) === "partial" ? "partial" : "available",
    answer_depth_code: trimString(questionJudgment?.granularity?.code) === "detail" ? "focused" : "focused",
    tool_matched_hospital_count_value: matchedHospitals.length,
    tool_matched_product_count_value: matchedProducts.length,
    product_hospital_zero_result_mode: trimString(lastToolResult?.meta?.product_hospital_zero_result) === "yes",
    tool_result_coverage_code: trimString(lastToolResult?.result?.coverage?.code),
    tool_result_diagnostic_flags: Array.isArray(lastToolResult?.result?.diagnostic_flags)
      ? lastToolResult.result.diagnostic_flags.map((item) => trimString(item)).filter((item) => item)
      : [],
    tool_result_row_count_value: rows.length,
    tool_result_row_names: rowNames,
    tool_result_matched_products: matchedProducts.slice(0, 5),
    tool_result_primary_period: trimString(lastToolResult?.meta?.primary_period) || trimString(lastToolResult?.result?.range?.period),
    tool_result_comparison_period: trimString(lastToolResult?.meta?.comparison_period) || trimString(comparisonRange?.period),
    tool_result_primary_sales_amount: trimString(primarySummary?.sales_amount),
    tool_result_primary_sales_volume: trimString(primarySummary?.sales_volume),
    tool_result_primary_sales_amount_value: normalizeNumericValue(primarySummary?.sales_amount_value),
    tool_result_primary_sales_volume_value: normalizeNumericValue(primarySummary?.sales_volume_value),
    tool_result_comparison_sales_amount: trimString(comparisonSummary?.sales_amount),
    tool_result_comparison_sales_volume: trimString(comparisonSummary?.sales_volume),
    tool_result_comparison_sales_amount_value: normalizeNumericValue(comparisonSummary?.sales_amount_value),
    tool_result_comparison_sales_volume_value: normalizeNumericValue(comparisonSummary?.sales_volume_value),
    tool_result_delta_sales_amount_change_ratio: lastToolResult?.result?.summary?.delta?.sales_amount_change_ratio,
    tool_result_delta_sales_volume_change_ratio: lastToolResult?.result?.summary?.delta?.sales_volume_change_ratio,
    tool_result_delta_achievement_change_ratio: lastToolResult?.result?.summary?.delta?.achievement_change_ratio,
    tool_result_delta_sales_amount_change: trimString(deltaSummary?.sales_amount_change),
    tool_result_delta_sales_volume_change: trimString(deltaSummary?.sales_volume_change),
    planner_route_intent: trimString(plannerState?.route_intent),
    planner_question_type: trimString(plannerState?.question_type),
    planner_required_evidence: Array.isArray(plannerState?.required_evidence) ? plannerState.required_evidence.slice(0, 6) : [],
    planner_requested_views: Array.isArray(plannerState?.requested_views) ? plannerState.requested_views.slice(0, 6) : [],
    planner_missing_evidence_types: Array.isArray(plannerState?.missing_evidence_types)
      ? plannerState.missing_evidence_types.slice(0, 6)
      : [],
  };
}

export function buildToolCallTraceEntry(call, executionResult) {
  return {
    tool_name: trimString(call?.name),
    analysis_view: trimString(executionResult?.meta?.analysis_view),
    evidence_types: Array.isArray(executionResult?.meta?.evidence_types)
      ? executionResult.meta.evidence_types.map((item) => trimString(item)).filter((item) => item)
      : [],
    detail_request_mode: trimString(executionResult?.meta?.detail_request_mode),
    coverage_code: trimString(executionResult?.result?.coverage?.code),
    row_count: Array.isArray(executionResult?.result?.rows) ? executionResult.result.rows.length : 0,
    matched_products: Array.isArray(executionResult?.meta?.matched_products) ? executionResult.meta.matched_products.length : 0,
    matched_hospitals: Array.isArray(executionResult?.meta?.matched_hospitals) ? executionResult.meta.matched_hospitals.length : 0,
    diagnostic_flags: Array.isArray(executionResult?.result?.diagnostic_flags)
      ? executionResult.result.diagnostic_flags.map((item) => trimString(item)).filter((item) => item)
      : [],
  };
}

function logToolTrace(tracePayload, env) {
  if (!shouldLogPhase2Trace(env)) {
    return;
  }
  try {
    console.log("[chat.tool.trace]", JSON.stringify(tracePayload));
  } catch (_error) {
    // Tool trace logging should never affect primary flow.
  }
}

function buildToolTracePayload({ requestId, state, toolCallTrace }) {
  const safeTrace = Array.isArray(toolCallTrace) ? toolCallTrace : [];
  const views = Array.from(
    new Set(
      safeTrace
        .map((item) => trimString(item?.analysis_view) || trimString(item?.tool_name))
        .filter((item) => item),
    ),
  );
  return {
    requestId,
    tool_call_count: state.tool_call_count,
    rounds: state.rounds,
    final_route_code: trimString(state.final_route_code),
    fallback_reason: trimString(state.fallback_reason),
    planning_depth: views.length > 1 ? "multi_view" : views.length === 1 ? "single_view" : "none",
    views_requested: views,
    views_completed: views,
    tool_selection_reason:
      views.length > 1 ? "model_multi_view_planning" : views.length === 1 ? "model_single_view_planning" : "none",
    final_synthesis_mode:
      state.tool_call_count > 1 ? "multi_tool_synthesis" : state.tool_call_count === 1 ? "single_tool_synthesis" : "none",
    planner_relevance: trimString(state.planner_relevance),
    planner_route_intent: trimString(state.planner_route_intent),
    planner_question_type: trimString(state.question_type),
    evidence_types_requested: Array.isArray(state.evidence_types_requested) ? state.evidence_types_requested : [],
    evidence_types_completed: Array.isArray(state.evidence_types_completed) ? state.evidence_types_completed : [],
    missing_evidence_types: Array.isArray(state.missing_evidence_types) ? state.missing_evidence_types : [],
    planner_requested_views: Array.isArray(state.planner_requested_views) ? state.planner_requested_views : [],
    planner_refuse_reason: trimString(state.planner_refuse_reason),
    planner_bounded_reason: trimString(state.planner_bounded_reason),
    planner_zero_tool_refuse: Boolean(state.planner_zero_tool_refuse),
    tool_calls: safeTrace,
  };
}

export async function runToolFirstChat({
  message,
  historyWindow,
  businessSnapshot,
  conversationState,
  followupContext,
  questionJudgment,
  authToken,
  env,
  requestId,
  deps = {},
}) {
  const state = createInitialToolRuntimeState();
  state.attempted = true;
  const runtimeContext = createToolRuntimeContext(
    {
      businessSnapshot,
      authToken,
      env,
    },
    deps,
  );
  const toolCallTrace = [];
  const executeToolByNameImpl = deps.executeToolByName || executeToolByName;
  const requestGeminiGenerateContentImpl = deps.requestGeminiGenerateContent || requestGeminiGenerateContent;

  const compactBroadOverallHistory = isBroadOverallMacroStartCandidate(message);
  const contents = buildInitialContents(
    historyWindow,
    message,
    businessSnapshot,
    conversationState,
    followupContext,
    { compactBroadOverallHistory },
  );
  const lastToolResultRef = { current: null };
  let plannerState = null;
  let plannerRecoveryAttempted = false;
  const firstRoundDimensionReportMacroOnly = shouldUseDimensionReportMacroFirstRound(message);
  const firstRoundMacroOnly = shouldUseMacroOnlyFirstRound(message);

  for (let roundIndex = 0; roundIndex < TOOL_RUNTIME_MAX_ROUNDS; roundIndex += 1) {
    state.rounds = roundIndex + 1;
    const allowedViewNames =
      !state.planner_completed && roundIndex === 0
        ? firstRoundDimensionReportMacroOnly
          ? DIMENSION_REPORT_MACRO_TOOL_NAMES
          : firstRoundMacroOnly
            ? MACRO_TOOL_NAMES
            : PLANNER_VIEW_NAMES
        : PLANNER_VIEW_NAMES;
    const shouldForcePlannerRecovery =
      !state.planner_completed && state.tool_call_count === 0 && plannerRecoveryAttempted;
    const shouldExposePlannerOnly = !state.planner_completed;
    const geminiResponse = await requestGeminiGenerateContentImpl(
      buildToolPayload(contents, allowedViewNames, {
        plannerOnly: shouldExposePlannerOnly,
        forcePlannerRecovery: shouldForcePlannerRecovery,
      }),
      env,
      requestId,
      "tool",
    );
    if (!geminiResponse.ok) {
      state.fallback_reason = TOOL_FALLBACK_REASONS.GEMINI_ERROR;
      logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
      return {
        ok: false,
        fallbackReason: state.fallback_reason,
        toolRuntimeState: state,
        toolCallTrace,
      };
    }

    const replyText = extractGeminiReply(geminiResponse.payload);
    const { content, plannerCall, toolCalls } = extractRuntimeCalls(geminiResponse.payload);

    if (!state.planner_completed) {
      if (!plannerCall) {
        const canRetryPlanner =
          !plannerRecoveryAttempted &&
          roundIndex === 0 &&
          state.tool_call_count === 0 &&
          trimString(questionJudgment?.relevance?.code) !== QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT;
        if (canRetryPlanner) {
          plannerRecoveryAttempted = true;
          continue;
        }
        state.fallback_reason = TOOL_FALLBACK_REASONS.PLANNER_CALL_MISSING;
        logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
        return {
          ok: false,
          fallbackReason: state.fallback_reason,
          toolRuntimeState: state,
          toolCallTrace,
        };
      }
      const candidatePlannerState = normalizePlannerState(plannerCall.args, questionJudgment, message, conversationState);
      const plannerValidation = validatePlannerState(plannerCall.args, candidatePlannerState, allowedViewNames);

      if (content) {
        contents.push(content);
      }

      if (!plannerValidation.accepted) {
        contents.push(buildPlannerFunctionResponse(candidatePlannerState, false, plannerValidation.note));
        continue;
      }

      plannerState = candidatePlannerState;
      state.planner_completed = true;
      state.planner_relevance = plannerState.relevance;
      state.planner_route_intent = plannerState.route_intent;
      state.question_type = plannerState.question_type;
      state.evidence_types_requested = plannerState.required_evidence.slice(0, 8);
      state.planner_requested_views = plannerState.requested_views.slice(0, 6);
      state.planner_refuse_reason = plannerState.refuse_reason;
      state.planner_bounded_reason = plannerState.bounded_reason;
      state.planner_zero_tool_refuse = plannerState.zero_tool_refuse;

      const plannedCalls = toolCalls.length > 0 ? toolCalls : plannerState.initial_tools;
      if (plannerState.relevance === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT && plannerState.route_intent === ROUTE_DECISION_CODES.REFUSE) {
        contents.push(buildPlannerFunctionResponse(plannerState, true, "irrelevant_zero_tool_refuse"));
        continue;
      }

      if (plannedCalls.length === 0) {
        contents.push(
          buildPlannerFunctionResponse(
            plannerState,
            false,
            "相关问题至少先调用一个工具，再决定是否 direct_answer 或 bounded_answer。",
          ),
        );
        continue;
      }

      contents.push(buildPlannerFunctionResponse(plannerState, true, "planner_accepted"));
      const plannedCallResult = await executePlannedCalls({
        plannedCalls,
        state,
        runtimeContext,
        deps,
        executeToolByNameImpl,
        lastToolResultRef,
        toolCallTrace,
        contents,
        env,
        requestId,
      });
      if (!plannedCallResult.ok) {
        return plannedCallResult;
      }
      continue;
    }

    if (toolCalls.length === 0) {
      if (
        plannerState?.relevance === QUESTION_JUDGMENT_CODES.relevance.RELEVANT &&
        state.tool_call_count < (plannerState?.required_tool_call_min ?? 1)
      ) {
        state.fallback_reason = TOOL_FALLBACK_REASONS.PLANNER_RELEVANT_WITHOUT_TOOL;
        logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
        return {
          ok: false,
          fallbackReason: state.fallback_reason,
          toolRuntimeState: state,
          toolCallTrace,
        };
      }
      if (!replyText) {
        state.fallback_reason = TOOL_FALLBACK_REASONS.EMPTY_FINAL_REPLY;
        logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
        return {
          ok: false,
          fallbackReason: state.fallback_reason,
          toolRuntimeState: state,
          toolCallTrace,
        };
      }
      const plannerQuestionJudgment = plannerState?.questionJudgment || questionJudgment;
      const missingEvidenceTypes = computeMissingEvidenceTypes(plannerState, state.evidence_types_completed);
      plannerState.missing_evidence_types = missingEvidenceTypes;
      const outputContext = buildToolOutputContext(plannerQuestionJudgment, lastToolResultRef.current, plannerState);
      const coverageCode = trimString(lastToolResultRef.current?.result?.coverage?.code);
      plannerState.analysis_confidence = buildAnalysisConfidence(
        trimString(outputContext.route_code),
        missingEvidenceTypes,
        coverageCode,
      );
      state.success = true;
      state.final_route_code = trimString(outputContext.route_code);
      state.missing_evidence_types = missingEvidenceTypes;
      logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
      return {
        ok: true,
        reply: replyText,
        model: geminiResponse.model,
        outputContext,
        plannerState,
        questionType: trimString(plannerState?.question_type),
        evidenceTypesCompleted: state.evidence_types_completed.slice(0, 8),
        missingEvidenceTypes,
        analysisConfidence: trimString(plannerState?.analysis_confidence),
        questionJudgment: plannerQuestionJudgment,
        toolResult: lastToolResultRef.current?.result || null,
        toolRuntimeState: state,
        toolCallTrace,
      };
    }

    if (plannerCall) {
      const candidatePlannerState = normalizePlannerState(
        plannerCall.args,
        plannerState?.questionJudgment || questionJudgment,
        message,
        conversationState,
      );
      const plannerValidation = validatePlannerState(plannerCall.args, candidatePlannerState, PLANNER_VIEW_NAMES);
      if (!plannerValidation.accepted) {
        if (content) {
          contents.push(content);
        }
        contents.push(buildPlannerFunctionResponse(candidatePlannerState, false, plannerValidation.note));
        continue;
      }

      plannerState = {
        ...plannerState,
        ...candidatePlannerState,
      };
      state.planner_relevance = plannerState.relevance;
      state.planner_route_intent = plannerState.route_intent;
      state.question_type = plannerState.question_type;
      state.evidence_types_requested = plannerState.required_evidence.slice(0, 8);
      state.planner_requested_views = plannerState.requested_views.slice(0, 6);
      state.planner_refuse_reason = plannerState.refuse_reason;
      state.planner_bounded_reason = plannerState.bounded_reason;
      state.planner_zero_tool_refuse = plannerState.zero_tool_refuse;

      if (content) {
        contents.push(content);
      }

      const plannedCalls = toolCalls.length > 0 ? toolCalls : plannerState.initial_tools;
      if (plannedCalls.length === 0) {
        contents.push(
          buildPlannerFunctionResponse(
            plannerState,
            false,
            "相关问题至少先调用一个工具，再决定是否 direct_answer 或 bounded_answer。",
          ),
        );
        continue;
      }

      contents.push(buildPlannerFunctionResponse(plannerState, true, "planner_accepted"));
      const plannedCallResult = await executePlannedCalls({
        plannedCalls,
        state,
        runtimeContext,
        deps,
        executeToolByNameImpl,
        lastToolResultRef,
        toolCallTrace,
        contents,
        env,
        requestId,
      });
      if (!plannedCallResult.ok) {
        return plannedCallResult;
      }
      continue;
    }

    if (toolCalls.length > 0) {
      state.fallback_reason = TOOL_FALLBACK_REASONS.PLANNER_REJECTED_WITHOUT_RESUBMISSION;
      logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
      return {
        ok: false,
        fallbackReason: state.fallback_reason,
        toolRuntimeState: state,
        toolCallTrace,
      };
    }

    if (content) {
      contents.push(content);
    }

    const directToolResult = await executePlannedCalls({
      plannedCalls: toolCalls,
      state,
      runtimeContext,
      deps,
      executeToolByNameImpl,
      lastToolResultRef,
      toolCallTrace,
      contents,
      env,
      requestId,
    });
    if (!directToolResult.ok) {
      return directToolResult;
    }
  }

  state.fallback_reason = TOOL_FALLBACK_REASONS.TOOL_LOOP_LIMIT_EXCEEDED;
  logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
  return {
    ok: false,
    fallbackReason: state.fallback_reason,
    toolRuntimeState: state,
    toolCallTrace,
  };
}
