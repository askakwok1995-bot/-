import {
  QUESTION_JUDGMENT_CODES,
  QUESTION_JUDGMENT_LABELS,
  ROUTE_DECISION_CODES,
  TOOL_RUNTIME_PLANNER_RECOVERY_APPEND_PROMPT,
  TOOL_RUNTIME_STATE_MACHINE_SYSTEM_PROMPT,
  trimString,
} from "./shared.js";
import { buildToolDeclarations } from "./tool-registry.js";

const PLANNER_FUNCTION_NAME = "submit_analysis_plan";
const QUESTION_TYPE_VALUES = Object.freeze(["overview", "report", "diagnosis", "compare", "why", "contribution", "trend"]);
const EVIDENCE_TYPE_VALUES = Object.freeze(["aggregate", "timeseries", "breakdown", "ranking", "diagnostics"]);
export const MACRO_TOOL_NAMES = Object.freeze([
  "get_sales_overview_brief",
  "get_sales_trend_brief",
  "get_dimension_overview_brief",
]);
export const DIMENSION_REPORT_MACRO_TOOL_NAMES = Object.freeze(["get_dimension_report_brief"]);
export const PLANNER_VIEW_NAMES = Object.freeze([
  "get_sales_overview_brief",
  "get_sales_trend_brief",
  "get_dimension_overview_brief",
  "get_dimension_report_brief",
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
const BROAD_QUERY_KEYWORDS = Object.freeze([
  "生成销售分析报告",
  "销售分析报告",
  "分析销售情况",
  "分析销售趋势",
  "销售趋势",
  "趋势如何",
  "走势如何",
  "分析医院表现",
  "医院表现",
  "分析产品表现",
  "产品表现",
  "整体表现",
  "整体情况",
]);
const BROAD_OVERALL_INTENT_KEYWORDS = Object.freeze(["报告", "分析", "趋势", "情况", "表现", "概况", "概览", "汇报"]);
const OVERALL_SCOPE_KEYWORDS = Object.freeze(["销售", "整体", "业务", "当前区间", "当前分析区间", "本区间", "报表区间"]);
const DEEP_DIVE_QUERY_KEYWORDS = Object.freeze([
  "为什么",
  "原因",
  "贡献",
  "哪些医院",
  "哪家医院",
  "逐月",
  "每月",
  "结构",
  "占比",
  "排行",
  "top",
  "bottom",
  "异常",
  "风险",
  "机会",
  "对比",
  "比较",
]);
const GENERIC_HOSPITAL_MENTIONS = Object.freeze([
  "医院",
  "分析医院",
  "医院表现",
  "哪些医院",
  "哪家医院",
  "这个医院",
  "这家医院",
  "某医院",
]);
const QUANTITY_INTENT_KEYWORDS = ["盒数", "销量", "数量"];
const SPEC_INTENT_KEYWORDS = ["规格", "品规", "具体产品", "分别卖了什么"];
const DETAIL_INTENT_KEYWORDS = ["全部", "详细", "列出来", "清单", "分别是多少"];
const DETAIL_RESULT_LIMIT = 10;

const TOOL_DECLARATION_BY_NAME = new Map(
  buildToolDeclarations().map((declaration) => [trimString(declaration?.name), declaration]),
);

function buildAllowedToolDeclarations(allowedViewNames) {
  const safeAllowed = Array.isArray(allowedViewNames) ? allowedViewNames.map((item) => trimString(item)).filter((item) => item) : [];
  if (safeAllowed.length === 0) {
    return buildToolDeclarations();
  }
  const allowedSet = new Set(safeAllowed);
  return buildToolDeclarations().filter((item) => allowedSet.has(trimString(item?.name)));
}

function buildPlannerDeclaration(allowedViewNames = PLANNER_VIEW_NAMES) {
  const safeAllowedViewNames = Array.isArray(allowedViewNames)
    ? allowedViewNames.map((item) => trimString(item)).filter((item) => PLANNER_VIEW_NAMES.includes(item))
    : PLANNER_VIEW_NAMES;
  const enumViewNames = safeAllowedViewNames.length > 0 ? safeAllowedViewNames : PLANNER_VIEW_NAMES;
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
            enum: enumViewNames,
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
                enum: enumViewNames,
              },
              args: { type: "OBJECT" },
            },
            required: ["name", "args"],
          },
        },
      },
      required: [
        "primary_dimension",
        "granularity",
        "route_intent",
        "question_type",
        "required_evidence",
        "required_tool_call_min",
      ],
    },
  };
}

function containsKeyword(text, keywords) {
  const safeText = trimString(text).toLocaleLowerCase();
  if (!safeText) {
    return false;
  }
  return keywords.some((keyword) => safeText.includes(trimString(keyword).toLocaleLowerCase()));
}

function hasQuantityIntent(text) {
  return containsKeyword(text, QUANTITY_INTENT_KEYWORDS);
}

function hasSpecIntent(text) {
  return containsKeyword(text, SPEC_INTENT_KEYWORDS);
}

function hasDetailIntent(text) {
  return containsKeyword(text, DETAIL_INTENT_KEYWORDS);
}

function hasNamedProductLikeQuestion(text) {
  return /[A-Za-z][A-Za-z0-9-]{2,}/.test(trimString(text));
}

function hasSpecificHospitalLikeQuestion(text) {
  const matches = trimString(text).match(/[A-Za-z0-9\u4e00-\u9fa5]{2,}(医院|门诊|诊所|机构)/g) || [];
  return matches.some((item) => !GENERIC_HOSPITAL_MENTIONS.includes(trimString(item)));
}

export function shouldUseMacroOnlyFirstRound(message) {
  const safeMessage = trimString(message);
  if (!safeMessage) {
    return false;
  }
  if (containsKeyword(safeMessage, DEEP_DIVE_QUERY_KEYWORDS)) {
    return false;
  }
  if (hasNamedProductLikeQuestion(safeMessage) || hasSpecificHospitalLikeQuestion(safeMessage)) {
    return false;
  }
  return containsKeyword(safeMessage, BROAD_QUERY_KEYWORDS) || isBroadOverallIntentLike(safeMessage);
}

function isBroadOverallIntentLike(message) {
  const safeMessage = trimString(message);
  if (!safeMessage) {
    return false;
  }
  const hasScopeSignal = containsKeyword(safeMessage, OVERALL_SCOPE_KEYWORDS);
  const hasIntentSignal = containsKeyword(safeMessage, BROAD_OVERALL_INTENT_KEYWORDS);
  if (!(hasScopeSignal && hasIntentSignal)) {
    return false;
  }
  if (!safeMessage.includes("销售") && !safeMessage.includes("整体") && !safeMessage.includes("业务")) {
    return false;
  }
  return true;
}

export function shouldUseDimensionReportMacroFirstRound(message) {
  const safeMessage = trimString(message);
  if (!safeMessage) {
    return false;
  }
  if (hasNamedProductLikeQuestion(safeMessage) || hasSpecificHospitalLikeQuestion(safeMessage)) {
    return false;
  }
  const hasDimensionMention = safeMessage.includes("产品") || safeMessage.includes("医院");
  if (!hasDimensionMention) {
    return false;
  }
  const hasReportIntent = safeMessage.includes("报告") || safeMessage.includes("汇报");
  const hasPerformanceIntent = safeMessage.includes("表现");
  const hasAdviceIntent =
    safeMessage.includes("建议") ||
    safeMessage.includes("问题") ||
    safeMessage.includes("风险") ||
    safeMessage.includes("机会");
  return hasReportIntent || (hasPerformanceIntent && hasAdviceIntent);
}

export function isBroadOverallMacroStartCandidate(message) {
  const safeMessage = trimString(message);
  if (!safeMessage) {
    return false;
  }
  if (!shouldUseMacroOnlyFirstRound(safeMessage) || shouldUseDimensionReportMacroFirstRound(safeMessage)) {
    return false;
  }
  if (safeMessage.includes("产品") || safeMessage.includes("医院")) {
    return false;
  }
  return true;
}

function normalizeScopedEntityNames(value) {
  return Array.isArray(value) ? value.map((item) => trimString(item)).filter((item) => item) : [];
}

function normalizePlannerToolCalls(toolCalls, message, conversationState = null) {
  const quantityIntent = hasQuantityIntent(message);
  const specIntent = hasSpecIntent(message);
  const detailIntent = hasDetailIntent(message);
  const scopedHospitals = normalizeScopedEntityNames(conversationState?.entity_scope?.hospitals);
  const normalizedCalls = Array.isArray(toolCalls)
    ? toolCalls.map((call) => {
        const name = trimString(call?.name);
        const args =
          call?.args && typeof call.args === "object" && !Array.isArray(call.args)
            ? { ...call.args }
            : {};
        return { name, args };
      })
    : [];

  return normalizedCalls.map((call) => {
    const toolName = trimString(call?.name);
    const nextArgs =
      call?.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? { ...call.args }
        : {};

    if (detailIntent && !Number.isFinite(Number(nextArgs.limit))) {
      nextArgs.limit = DETAIL_RESULT_LIMIT;
    }

    if (quantityIntent && ["get_entity_ranking", "scope_breakdown"].includes(toolName) && !trimString(nextArgs.metric)) {
      nextArgs.metric = "sales_volume";
    }

    const shouldPromoteToHospitalProductBreakdown =
      specIntent &&
      scopedHospitals.length > 0 &&
      [
        "get_dimension_overview_brief",
        "get_dimension_report_brief",
        "get_hospital_summary",
        "get_entity_ranking",
      ].includes(toolName);

    if (shouldPromoteToHospitalProductBreakdown) {
      return {
        name: "scope_breakdown",
        args: {
          scope_dimension: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
          breakdown_dimension: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
          target_names: scopedHospitals,
          metric: quantityIntent ? "sales_volume" : "sales_amount",
          limit: Number.isFinite(Number(nextArgs.limit)) ? Number(nextArgs.limit) : DETAIL_RESULT_LIMIT,
        },
      };
    }

    if (specIntent && toolName === "scope_breakdown") {
      if (!trimString(nextArgs.scope_dimension)) {
        nextArgs.scope_dimension =
          scopedHospitals.length > 0
            ? QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL
            : QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
      }
      if (!trimString(nextArgs.breakdown_dimension)) {
        nextArgs.breakdown_dimension = QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
      }
      if (scopedHospitals.length > 0 && !Array.isArray(nextArgs.target_names)) {
        nextArgs.target_names = scopedHospitals;
      }
      if (!trimString(nextArgs.metric) && quantityIntent) {
        nextArgs.metric = "sales_volume";
      }
    }

    return {
      name: toolName,
      args: nextArgs,
    };
  });
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

export function computeMissingEvidenceTypes(plannerState, completedEvidenceTypes) {
  const requiredEvidence = Array.isArray(plannerState?.required_evidence) ? plannerState.required_evidence : [];
  const completed = new Set(
    Array.isArray(completedEvidenceTypes) ? completedEvidenceTypes.map((item) => trimString(item)).filter((item) => item) : [],
  );
  return requiredEvidence.filter((item) => !completed.has(item));
}

export function collectCompletedEvidenceTypes(executionResult) {
  const coverageCode = trimString(executionResult?.result?.coverage?.code);
  if (coverageCode === "none") {
    return [];
  }
  const metaEvidenceTypes = Array.isArray(executionResult?.meta?.evidence_types) ? executionResult.meta.evidence_types : [];
  return Array.from(new Set(metaEvidenceTypes.map((item) => trimString(item)).filter((item) => item)));
}

export function extractRuntimeCalls(payload) {
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
      let args = item.args;
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        args = {};
      }
      return { name, args };
    })
    .filter((item) => item !== null);
}

function getRequiredToolParameterNames(toolName) {
  const declaration = TOOL_DECLARATION_BY_NAME.get(trimString(toolName));
  const required = Array.isArray(declaration?.parameters?.required) ? declaration.parameters.required : [];
  return required.map((item) => trimString(item)).filter((item) => item);
}

function validateRawPlannerInitialTools(rawInitialTools, allowedSet) {
  if (!Array.isArray(rawInitialTools)) {
    return { accepted: true, note: "" };
  }

  for (const rawItem of rawInitialTools) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return {
        accepted: false,
        note: "initial_tools 中存在非法条目；每项都必须是包含 name 和 args 的对象。",
      };
    }

    const toolName = trimString(rawItem.name);
    if (!toolName) {
      return {
        accepted: false,
        note: "initial_tools 中存在缺少 name 的条目。",
      };
    }

    if (!allowedSet.has(toolName)) {
      return {
        accepted: false,
        note: `initial_tools.${toolName} 不属于当前阶段允许调用的工具。`,
      };
    }

    if (Object.prototype.hasOwnProperty.call(rawItem, "args_json")) {
      return {
        accepted: false,
        note: `initial_tools.${toolName} 仍在使用旧字段 args_json；请改为结构化 args 对象。`,
      };
    }

    if (!Object.prototype.hasOwnProperty.call(rawItem, "args")) {
      return {
        accepted: false,
        note: `initial_tools.${toolName} 缺少 args；请提供结构化参数对象。`,
      };
    }

    if (!rawItem.args || typeof rawItem.args !== "object" || Array.isArray(rawItem.args)) {
      return {
        accepted: false,
        note: `initial_tools.${toolName}.args 必须是对象，不能是字符串、数组或空值。`,
      };
    }

    const requiredParams = getRequiredToolParameterNames(toolName);
    for (const requiredParam of requiredParams) {
      if (!Object.prototype.hasOwnProperty.call(rawItem.args, requiredParam)) {
        return {
          accepted: false,
          note: `initial_tools.${toolName} 缺少必填参数 ${requiredParam}。`,
        };
      }
    }
  }

  return { accepted: true, note: "" };
}

function hasOwnNumericField(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key) && Number.isFinite(Number(value?.[key]));
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

export function normalizePlannerState(plannerArgs, fallbackQuestionJudgment, message = "", conversationState = null) {
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
  let normalizedInitialTools = normalizePlannerToolCalls(parsePlannerInitialTools(plannerArgs?.initial_tools), message, conversationState);
  const requestedViewsFromInitialTools = normalizedInitialTools.map((item) => trimString(item?.name)).filter((item) => item);
  const normalizedRequestedViews = requestedViewsFromInitialTools.length > 0
    ? Array.from(new Set(requestedViewsFromInitialTools))
    : requestedViews;
  const quantityIntent = hasQuantityIntent(message);
  const specIntent = hasSpecIntent(message);
  const requiredEvidence = normalizeEvidenceTypes(plannerArgs?.required_evidence);
  const normalizedPlannerEvidence =
    specIntent && normalizedInitialTools.some((item) => trimString(item?.name) === "scope_breakdown")
      ? ["breakdown", "ranking"]
      : requiredEvidence;
  const normalizedRequiredEvidence = relevance === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT
    ? []
    : normalizedPlannerEvidence.length > 0
      ? normalizedPlannerEvidence
      : deriveRequiredEvidenceByQuestionType(questionType);
  const requiredToolCallMinRaw = Number(plannerArgs?.required_tool_call_min);
  const requiredToolCallMin = relevance === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT
    ? 0
    : Math.max(1, Number.isFinite(requiredToolCallMinRaw) ? Math.floor(requiredToolCallMinRaw) : 1);
  const plannerQuestionJudgment = buildPlannerQuestionJudgment(
    {
      ...plannerArgs,
      granularity:
        specIntent || hasDetailIntent(message)
          ? QUESTION_JUDGMENT_CODES.granularity.DETAIL
          : plannerArgs?.granularity,
    },
    fallbackQuestionJudgment,
  );
  if (quantityIntent && normalizedInitialTools.some((item) => trimString(item?.name) === "get_entity_ranking")) {
    normalizedInitialTools = normalizedInitialTools.map((item) =>
      trimString(item?.name) === "get_entity_ranking" && !trimString(item?.args?.metric)
        ? { ...item, args: { ...item.args, metric: "sales_volume" } }
        : item,
    );
  }
  return {
    relevance,
    route_intent: routeIntent,
    question_type: questionType,
    required_evidence: normalizedRequiredEvidence,
    requested_views: normalizedRequestedViews,
    refuse_reason: trimString(plannerArgs?.refuse_reason),
    bounded_reason: trimString(plannerArgs?.bounded_reason),
    synthesis_expectation: trimString(plannerArgs?.synthesis_expectation),
    required_tool_call_min: requiredToolCallMin,
    zero_tool_refuse: relevance === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT && routeIntent === ROUTE_DECISION_CODES.REFUSE,
    initial_tools: normalizedInitialTools,
    missing_evidence_types: [],
    analysis_confidence: "low",
    questionJudgment: plannerQuestionJudgment,
  };
}

export function validatePlannerState(plannerArgs, plannerState, allowedViewNames) {
  const safeArgs = plannerArgs && typeof plannerArgs === "object" ? plannerArgs : {};
  const allowedSet = new Set(
    Array.isArray(allowedViewNames)
      ? allowedViewNames.map((item) => trimString(item)).filter((item) => item)
      : PLANNER_VIEW_NAMES,
  );

  if (
    trimString(plannerState?.route_intent) === ROUTE_DECISION_CODES.REFUSE &&
    trimString(plannerState?.relevance) !== QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT
  ) {
    return {
      accepted: false,
      note: "只有明显无关的问题才能使用 refuse；若问题相关，请改为 direct_answer 或 bounded_answer 并规划工具。",
    };
  }

  const initialTools = Array.isArray(plannerState?.initial_tools) ? plannerState.initial_tools : [];
  const rawInitialTools = Array.isArray(safeArgs?.initial_tools) ? safeArgs.initial_tools : [];
  const requestedViews = Array.isArray(plannerState?.requested_views) ? plannerState.requested_views : [];
  const hasInitialTools = initialTools.length > 0;
  const isZeroToolRefuse =
    trimString(plannerState?.relevance) === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT &&
    trimString(plannerState?.route_intent) === ROUTE_DECISION_CODES.REFUSE;

  if (!isZeroToolRefuse && !hasInitialTools) {
    return {
      accepted: false,
      note: "相关问题必须提供 initial_tools，作为首批工具调用计划。",
    };
  }

  const rawInitialToolValidation = validateRawPlannerInitialTools(rawInitialTools, allowedSet);
  if (!rawInitialToolValidation.accepted) {
    return rawInitialToolValidation;
  }

  if (trimString(plannerState?.relevance) === QUESTION_JUDGMENT_CODES.relevance.RELEVANT) {
    if (!hasOwnNumericField(safeArgs, "required_tool_call_min") || Number(plannerState?.required_tool_call_min) < 1) {
      return {
        accepted: false,
        note: "相关问题的 required_tool_call_min 必须大于等于 1。",
      };
    }
  }

  if (initialTools.some((item) => !allowedSet.has(trimString(item?.name)))) {
    return {
      accepted: false,
      note: "initial_tools 中包含当前阶段不可调用的工具，请改用当前允许暴露的工具。",
    };
  }

  if (requestedViews.some((item) => !allowedSet.has(trimString(item)))) {
    return {
      accepted: false,
      note: "requested_views 中包含当前阶段不可用的工具，请改用当前允许暴露的工具。",
    };
  }

  return {
    accepted: true,
    note: "planner_accepted",
  };
}

export function buildPlannerFunctionResponse(plannerState, accepted, note = "") {
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

export function buildToolPayload(contents, allowedViewNames = PLANNER_VIEW_NAMES, options = {}) {
  const plannerOnly = Boolean(options?.plannerOnly);
  const forcePlannerRecovery = Boolean(options?.forcePlannerRecovery);
  const systemInstructionText = forcePlannerRecovery
    ? `${TOOL_RUNTIME_STATE_MACHINE_SYSTEM_PROMPT}\n\n${TOOL_RUNTIME_PLANNER_RECOVERY_APPEND_PROMPT}`
    : TOOL_RUNTIME_STATE_MACHINE_SYSTEM_PROMPT;
  return {
    systemInstruction: {
      parts: [
        {
          text: systemInstructionText,
        },
      ],
    },
    contents,
    tools: [
      {
        functionDeclarations: plannerOnly
          ? [buildPlannerDeclaration(allowedViewNames)]
          : [buildPlannerDeclaration(allowedViewNames), ...buildAllowedToolDeclarations(allowedViewNames)],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: "AUTO",
      },
    },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1800,
    },
  };
}
