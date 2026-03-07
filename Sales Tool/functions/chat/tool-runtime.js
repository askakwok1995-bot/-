import {
  ASSISTANT_ROLE_DEFINITION,
  OUTPUT_POLICY_BOUNDED_ANSWER,
  OUTPUT_POLICY_DIRECT_ANSWER,
  PLANNER_ROLE_DEFINITION,
  QUESTION_JUDGMENT_CODES,
  QUESTION_JUDGMENT_LABELS,
  ROUTE_DECISION_CODES,
  TOOL_RUNTIME_MAX_CALLS,
  TOOL_RUNTIME_MAX_ROUNDS,
  buildAssistantRoleSystemInstruction,
  buildPlannerRoleSystemInstruction,
  normalizeBusinessSnapshot,
  normalizeNumericValue,
  trimString,
} from "./shared.js";
import { buildToolDeclarations } from "./tool-registry.js";
import { createToolRuntimeContext, executeToolByName } from "./tool-executors.js";
import { extractGeminiReply, requestGeminiGenerateContent, shouldLogPhase2Trace } from "./output.js";

const TOOL_FALLBACK_REASONS = Object.freeze({
  INVALID_ANALYSIS_RANGE: "invalid_analysis_range",
  TOOL_LOOP_LIMIT_EXCEEDED: "tool_loop_limit_exceeded",
  TOOL_EXECUTION_FAILED: "tool_execution_failed",
  GEMINI_ERROR: "gemini_error",
  EMPTY_FINAL_REPLY: "empty_final_reply",
  PLANNER_CALL_MISSING: "planner_call_missing",
  PLANNER_RELEVANT_WITHOUT_TOOL: "planner_relevant_without_tool",
});

const PLANNER_FUNCTION_NAME = "submit_analysis_plan";
const QUESTION_TYPE_VALUES = Object.freeze(["overview", "report", "diagnosis", "compare", "why", "contribution", "trend"]);
const EVIDENCE_TYPE_VALUES = Object.freeze(["aggregate", "timeseries", "breakdown", "ranking", "diagnostics"]);
const PLANNER_VIEW_NAMES = Object.freeze([
  "scope_aggregate",
  "scope_timeseries",
  "scope_breakdown",
  "scope_diagnostics",
  "get_overall_summary",
  "get_product_summary",
  "get_hospital_summary",
  "get_product_hospital_contribution",
  "get_trend_summary",
  "get_period_comparison_summary",
  "get_product_trend",
  "get_hospital_trend",
  "get_entity_ranking",
  "get_share_breakdown",
  "get_anomaly_insights",
  "get_risk_opportunity_summary",
]);

const TOOL_FIRST_SYSTEM_INSTRUCTION = [
  "当前链路已为你提供一组受控业务工具。",
  `第一轮必须先调用 ${PLANNER_FUNCTION_NAME}，输出你对问题的规划判断。`,
  "planner 必须显式判断：是否相关、是否拒答、是否需要带边界回答、需要哪些分析视角、首批工具调用计划。",
  "相关问题默认至少调用一个工具后再决定是否带边界回答；只有明显无关的问题才允许零工具直接拒答。",
  "对“分析/为什么/结构/贡献来源/风险机会”类问题，通常先拿整体结论，再补趋势、结构、排行或风险中的至少一个支撑视角。",
  "如果目前只拿到单一摘要视角，且用户问题明显需要解释原因、结构或异常，不要急于结束，继续调用更合适的工具。",
  "工具结果是本轮回答的主要事实依据；若工具结果 coverage=partial/none、存在未匹配实体，或结论仍有明显边界，请按 bounded_answer 风格回答。",
  "若工具结果 coverage=full，按 direct_answer 风格回答；若 coverage=full 且 rows 为空但结果明确为0贡献，请直接说明“当前范围内贡献为0/未产生贡献”，不要写成“数据不足”。",
  "最终总结时必须综合本轮全部已调用工具的结果，不要只基于最后一个工具回复。",
  "禁止输出任何内部过程词、工具名、函数名、调取过程。",
  "",
  "planner 规则：",
  "1）无关问题：relevance=irrelevant，route_intent=refuse，可不调工具；",
  "2）相关问题：relevance=relevant，required_tool_call_min 至少为 1；",
  "3）若问题相关但你暂时判断可能信息不足，先规划最合适的工具验证，不要直接 bounded；",
  "4）不要覆写已给定的时间范围和 seed context 中的事实约束。",
  "5）当 question_type=report 时，required_evidence 至少包含 aggregate、timeseries、breakdown、diagnostics。",
  "6）当 question_type=why 时，required_evidence 至少包含 aggregate、timeseries、breakdown。",
  "7）当 question_type=contribution 时，required_evidence 至少包含 breakdown、ranking。",
  "8）当 question_type=diagnosis 或 risk 场景时，required_evidence 至少包含 timeseries、diagnostics。",
  "9）如果 required_evidence 里的证据没有取齐，不要把回答当成稳定 direct_answer。",
  "",
  "direct_answer 结构要求：",
  OUTPUT_POLICY_DIRECT_ANSWER,
  "",
  "bounded_answer 结构要求：",
  OUTPUT_POLICY_BOUNDED_ANSWER,
].join("\n");

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

function buildToolSeedPrompt(message, businessSnapshot, requestedTimeWindow = null) {
  const normalizedSnapshot = normalizeBusinessSnapshot(businessSnapshot);
  const promptLines = [
    "以下是当前分析范围内的轻量业务快照（seed context），可作为初始背景，但不是唯一数据来源。",
    "如需更具体的数据，请优先调用业务工具。",
  ];
  const requestedPeriod = trimString(requestedTimeWindow?.period);
  if (requestedPeriod) {
    promptLines.push(`本轮用户请求的实际时间区间为 ${requestedPeriod}，请严格按该区间理解“本月/近三个月”等时间表达，不要偷换成报表尾部月份。`);
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

function buildInitialContents(historyWindow, message, businessSnapshot, requestedTimeWindow = null) {
  const contents = [];
  const safeHistory = Array.isArray(historyWindow) ? historyWindow : [];
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
    parts: [{ text: buildToolSeedPrompt(message, businessSnapshot, requestedTimeWindow) }],
  });
  return contents;
}

function buildToolPayload(contents) {
  return {
    systemInstruction: {
      parts: [
        {
          text: `${buildPlannerRoleSystemInstruction(PLANNER_ROLE_DEFINITION)}\n\n${buildAssistantRoleSystemInstruction(ASSISTANT_ROLE_DEFINITION)}\n\n${TOOL_FIRST_SYSTEM_INSTRUCTION}`,
        },
      ],
    },
    contents,
    tools: [
      {
        functionDeclarations: [buildPlannerDeclaration(), ...buildToolDeclarations()],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: "AUTO",
      },
    },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
  };
}

function buildPlannerDeclaration() {
  return {
    name: PLANNER_FUNCTION_NAME,
    description: "提交本轮问题的分析规划，包括相关性、目标路由、分析视角和首批工具调用计划。",
    parameters: {
      type: "OBJECT",
      properties: {
        relevance: {
          type: "STRING",
          enum: [
            QUESTION_JUDGMENT_CODES.relevance.RELEVANT,
            QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT,
          ],
        },
        primary_dimension: {
          type: "STRING",
          enum: [
            QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
            QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
            QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
            QUESTION_JUDGMENT_CODES.primary_dimension.TREND,
            QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY,
            QUESTION_JUDGMENT_CODES.primary_dimension.OTHER,
          ],
        },
        granularity: {
          type: "STRING",
          enum: [
            QUESTION_JUDGMENT_CODES.granularity.SUMMARY,
            QUESTION_JUDGMENT_CODES.granularity.DETAIL,
          ],
        },
        route_intent: {
          type: "STRING",
          enum: [
            ROUTE_DECISION_CODES.DIRECT_ANSWER,
            ROUTE_DECISION_CODES.BOUNDED_ANSWER,
            ROUTE_DECISION_CODES.REFUSE,
          ],
        },
        question_type: {
          type: "STRING",
          enum: QUESTION_TYPE_VALUES,
        },
        required_evidence: {
          type: "ARRAY",
          items: {
            type: "STRING",
            enum: EVIDENCE_TYPE_VALUES,
          },
        },
        requested_views: {
          type: "ARRAY",
          items: {
            type: "STRING",
            enum: PLANNER_VIEW_NAMES,
          },
        },
        refuse_reason: { type: "STRING" },
        bounded_reason: { type: "STRING" },
        synthesis_expectation: { type: "STRING" },
        required_tool_call_min: { type: "NUMBER" },
        initial_tools: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: {
                type: "STRING",
                enum: PLANNER_VIEW_NAMES,
              },
              args_json: { type: "STRING" },
            },
            required: ["name"],
          },
        },
      },
      required: [
        "relevance",
        "primary_dimension",
        "granularity",
        "route_intent",
        "question_type",
        "required_evidence",
        "requested_views",
        "required_tool_call_min",
      ],
    },
  };
}

function deriveRequiredEvidenceByQuestionType(questionType) {
  if (questionType === "report") {
    return ["aggregate", "timeseries", "breakdown", "diagnostics"];
  }
  if (questionType === "diagnosis") {
    return ["aggregate", "timeseries", "diagnostics"];
  }
  if (questionType === "compare") {
    return ["aggregate", "timeseries"];
  }
  if (questionType === "why") {
    return ["aggregate", "timeseries", "breakdown"];
  }
  if (questionType === "contribution") {
    return ["breakdown", "ranking"];
  }
  if (questionType === "trend") {
    return ["aggregate", "timeseries"];
  }
  return ["aggregate"];
}

function normalizeEvidenceTypes(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => trimString(item)).filter((item) => EVIDENCE_TYPE_VALUES.includes(item))));
}

function computeMissingEvidenceTypes(plannerState, completedEvidenceTypes) {
  const requiredEvidence = Array.isArray(plannerState?.required_evidence) ? plannerState.required_evidence : [];
  const completed = new Set(Array.isArray(completedEvidenceTypes) ? completedEvidenceTypes.map((item) => trimString(item)).filter((item) => item) : []);
  return requiredEvidence.filter((item) => !completed.has(item));
}

function collectCompletedEvidenceTypes(executionResult) {
  const coverageCode = trimString(executionResult?.result?.coverage?.code);
  if (coverageCode === "none") {
    return [];
  }
  const metaEvidenceTypes = Array.isArray(executionResult?.meta?.evidence_types) ? executionResult.meta.evidence_types : [];
  return Array.from(new Set(metaEvidenceTypes.map((item) => trimString(item)).filter((item) => item)));
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

function extractRuntimeCalls(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const candidate = candidates[0];
  const content = candidate?.content && typeof candidate.content === "object" ? candidate.content : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  let plannerCall = null;
  const toolCalls = [];
  parts.forEach((part) => {
    const functionCall = part?.functionCall;
    const name = trimString(functionCall?.name);
    if (!name) {
      return;
    }
    let args = functionCall?.args;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (_error) {
        args = {};
      }
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      args = {};
    }
    const normalizedCall = {
      name,
      args,
    };
    if (name === PLANNER_FUNCTION_NAME && !plannerCall) {
      plannerCall = normalizedCall;
      return;
    }
    toolCalls.push(normalizedCall);
  });
  return {
    content,
    plannerCall,
    toolCalls,
  };
}

function parsePlannerInitialTools(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const name = trimString(item.name);
      if (!PLANNER_VIEW_NAMES.includes(name)) {
        return null;
      }
      let args = item.args_json;
      if (typeof args === "string" && trimString(args)) {
        try {
          args = JSON.parse(args);
        } catch (_error) {
          args = {};
        }
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        args = {};
      }
      return { name, args };
    })
    .filter((item) => item !== null);
}

function buildPlannerQuestionJudgment(plannerArgs, fallbackQuestionJudgment) {
  const fallback = fallbackQuestionJudgment && typeof fallbackQuestionJudgment === "object" ? fallbackQuestionJudgment : {};
  const primaryDimensionCandidate = trimString(plannerArgs?.primary_dimension);
  const primaryDimensionCode = Object.values(QUESTION_JUDGMENT_CODES.primary_dimension).includes(primaryDimensionCandidate)
    ? primaryDimensionCandidate
    : trimString(fallback?.primary_dimension?.code) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  const granularityCandidate = trimString(plannerArgs?.granularity);
  const granularityCode = Object.values(QUESTION_JUDGMENT_CODES.granularity).includes(granularityCandidate)
    ? granularityCandidate
    : trimString(fallback?.granularity?.code) || QUESTION_JUDGMENT_CODES.granularity.SUMMARY;
  const relevanceCandidate = trimString(plannerArgs?.relevance);
  const relevanceCode = Object.values(QUESTION_JUDGMENT_CODES.relevance).includes(relevanceCandidate)
    ? relevanceCandidate
    : trimString(fallback?.relevance?.code) || QUESTION_JUDGMENT_CODES.relevance.RELEVANT;
  return {
    ...fallback,
    primary_dimension: {
      code: primaryDimensionCode,
      label: QUESTION_JUDGMENT_LABELS.primary_dimension[primaryDimensionCode] || trimString(fallback?.primary_dimension?.label),
    },
    granularity: {
      code: granularityCode,
      label: QUESTION_JUDGMENT_LABELS.granularity[granularityCode] || trimString(fallback?.granularity?.label),
    },
    relevance: {
      code: relevanceCode,
      label: QUESTION_JUDGMENT_LABELS.relevance[relevanceCode] || trimString(fallback?.relevance?.label),
    },
  };
}

function normalizePlannerState(plannerArgs, fallbackQuestionJudgment) {
  const relevance = trimString(plannerArgs?.relevance) === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT
    ? QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT
    : QUESTION_JUDGMENT_CODES.relevance.RELEVANT;
  const routeIntentCandidate = trimString(plannerArgs?.route_intent);
  const routeIntent = [
    ROUTE_DECISION_CODES.DIRECT_ANSWER,
    ROUTE_DECISION_CODES.BOUNDED_ANSWER,
    ROUTE_DECISION_CODES.REFUSE,
  ].includes(routeIntentCandidate)
    ? routeIntentCandidate
    : relevance === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT
      ? ROUTE_DECISION_CODES.REFUSE
      : ROUTE_DECISION_CODES.DIRECT_ANSWER;
  const requestedViews = Array.isArray(plannerArgs?.requested_views)
    ? plannerArgs.requested_views.map((item) => trimString(item)).filter((item) => PLANNER_VIEW_NAMES.includes(item))
    : [];
  const questionTypeCandidate = trimString(plannerArgs?.question_type);
  const questionType = QUESTION_TYPE_VALUES.includes(questionTypeCandidate) ? questionTypeCandidate : "overview";
  const requiredEvidence = normalizeEvidenceTypes(plannerArgs?.required_evidence);
  const normalizedRequiredEvidence = relevance === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT
    ? []
    :
    requiredEvidence.length > 0
      ? Array.from(new Set([...deriveRequiredEvidenceByQuestionType(questionType), ...requiredEvidence]))
      : deriveRequiredEvidenceByQuestionType(questionType);
  const requiredToolCallMinRaw = Number(plannerArgs?.required_tool_call_min);
  const requiredToolCallMin = relevance === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT
    ? 0
    : Math.max(1, Number.isFinite(requiredToolCallMinRaw) ? Math.floor(requiredToolCallMinRaw) : 1);
  return {
    relevance,
    route_intent: routeIntent,
    question_type: questionType,
    required_evidence: normalizedRequiredEvidence,
    requested_views: requestedViews,
    refuse_reason: trimString(plannerArgs?.refuse_reason),
    bounded_reason: trimString(plannerArgs?.bounded_reason),
    synthesis_expectation: trimString(plannerArgs?.synthesis_expectation),
    required_tool_call_min: requiredToolCallMin,
    zero_tool_refuse: relevance === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT && routeIntent === ROUTE_DECISION_CODES.REFUSE,
    initial_tools: parsePlannerInitialTools(plannerArgs?.initial_tools),
    missing_evidence_types: [],
    analysis_confidence: "low",
    questionJudgment: buildPlannerQuestionJudgment(plannerArgs, fallbackQuestionJudgment),
  };
}

function buildPlannerFunctionResponse(plannerState, accepted, note = "") {
  return {
    role: "user",
    parts: [
      {
        functionResponse: {
          name: PLANNER_FUNCTION_NAME,
          response: {
            accepted: Boolean(accepted),
            relevance: trimString(plannerState?.relevance),
            route_intent: trimString(plannerState?.route_intent),
            question_type: trimString(plannerState?.question_type),
            required_evidence: Array.isArray(plannerState?.required_evidence) ? plannerState.required_evidence : [],
            requested_views: Array.isArray(plannerState?.requested_views) ? plannerState.requested_views : [],
            required_tool_call_min: plannerState?.required_tool_call_min ?? 0,
            note: trimString(note),
          },
        },
      },
    ],
  };
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
  requestedTimeWindow = null,
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
      requestedTimeWindow,
      authToken,
      env,
    },
    deps,
  );
  const toolCallTrace = [];
  const executeToolByNameImpl = deps.executeToolByName || executeToolByName;
  const requestGeminiGenerateContentImpl = deps.requestGeminiGenerateContent || requestGeminiGenerateContent;

  const contents = buildInitialContents(historyWindow, message, businessSnapshot, requestedTimeWindow);
  let lastToolResult = null;
  let plannerState = null;

  for (let roundIndex = 0; roundIndex < TOOL_RUNTIME_MAX_ROUNDS; roundIndex += 1) {
    state.rounds = roundIndex + 1;
    const geminiResponse = await requestGeminiGenerateContentImpl(buildToolPayload(contents), env, requestId, "tool");
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
        state.fallback_reason = TOOL_FALLBACK_REASONS.PLANNER_CALL_MISSING;
        logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
        return {
          ok: false,
          fallbackReason: state.fallback_reason,
          toolRuntimeState: state,
          toolCallTrace,
        };
      }
      plannerState = normalizePlannerState(plannerCall.args, questionJudgment);
      state.planner_completed = true;
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
        lastToolResult = executionResult;
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
      const outputContext = buildToolOutputContext(plannerQuestionJudgment, lastToolResult, plannerState);
      const coverageCode = trimString(lastToolResult?.result?.coverage?.code);
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
        toolResult: lastToolResult?.result || null,
        toolRuntimeState: state,
        toolCallTrace,
      };
    }

    if (content) {
      contents.push(content);
    }

    for (const call of toolCalls) {
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
      lastToolResult = executionResult;
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
