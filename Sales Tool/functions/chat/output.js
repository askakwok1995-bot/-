import {
  ASSISTANT_ROLE_DEFINITION,
  CHAT_ERROR_CODES,
  GEMINI_API_BASE,
  GEMINI_UPSTREAM_TIMEOUT_MS,
  INTERNAL_PROCESS_WORDS,
  OUTPUT_POLICY_BOUNDED_ANSWER,
  OUTPUT_POLICY_DIRECT_ANSWER,
  OUTPUT_POLICY_REFUSE,
  QC_ACTIONS,
  QC_BOUNDARY_HINT_WORDS,
  QC_BOUNDED_BOUNDARY_TEXT,
  QC_BUSINESS_EVIDENCE_WORDS,
  QC_HIGH_DUP_SENTENCE_MIN,
  QC_HIGH_DUP_UNIQUE_RATIO_MAX,
  QC_MIN_EFFECTIVE_CHARS,
  QC_NON_SEVERE_FALLBACK_MIN,
  QC_REASON_CODES,
  QC_REFUSE_EXAMPLES_TEXT,
  QC_ROUTE_MISMATCH_SHORT_MAX_CHARS,
  QC_STRONG_REFUSE_WORDS,
  ROUTE_DECISION_CODES,
  buildAssistantRoleSystemInstruction,
  fetchWithTimeout,
  getEnvString,
  normalizeBusinessSnapshot,
  normalizeNumericValue,
  parseJsonSafe,
  sanitizeModelName,
  trimString,
} from "./shared.js";
import { buildTimeWindowBoundaryReplyFromOutputContext } from "./time-intent.js";

export function buildOutputContext(finalRouteDecision, finalQuestionJudgment, finalDataAvailability) {
  const routeCode = trimString(finalRouteDecision?.route?.code);
  const primaryDimensionCode = trimString(finalQuestionJudgment?.primary_dimension?.code);
  const granularityCode = trimString(finalQuestionJudgment?.granularity?.code);
  const hospitalMonthlyDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "hospital_monthly";
  const productHospitalDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "product_hospital";
  const hospitalNamedDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "hospital_named";
  const productFullDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "product_full";
  const productNamedDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "product_named";
  const overallPeriodCompareMode = trimString(finalDataAvailability?.detail_request_mode) === "overall_period_compare";
  return {
    route_code: routeCode,
    primary_dimension_code: primaryDimensionCode,
    granularity_code: granularityCode,
    boundary_needed: routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER,
    refuse_mode: routeCode === ROUTE_DECISION_CODES.REFUSE,
    hospital_monthly_detail_mode: hospitalMonthlyDetailMode,
    product_hospital_detail_mode: productHospitalDetailMode,
    hospital_named_detail_mode: hospitalNamedDetailMode,
    product_full_detail_mode: productFullDetailMode,
    product_named_detail_mode: productNamedDetailMode,
    overall_period_compare_mode: overallPeriodCompareMode,
    product_hospital_support_code: trimString(finalDataAvailability?.product_hospital_support),
    product_hospital_hospital_count_value: normalizeNumericValue(finalDataAvailability?.product_hospital_hospital_count_value),
    hospital_named_support_code: trimString(finalDataAvailability?.hospital_named_support),
    product_full_support_code: trimString(finalDataAvailability?.product_full_support),
    product_named_support_code: trimString(finalDataAvailability?.product_named_support),
    dimension_availability_code: trimString(finalDataAvailability?.dimension_availability?.code),
    answer_depth_code: trimString(finalDataAvailability?.answer_depth?.code),
    product_hospital_zero_result_mode: trimString(finalDataAvailability?.product_hospital_zero_result) === "yes",
    tool_route_mode: "legacy",
    tool_route_type: "none",
    tool_route_name: "",
    tool_result_coverage_code: "",
    tool_result_row_count_value: 0,
    tool_result_row_names: [],
    tool_result_matched_products: [],
    requested_time_window_kind: "none",
    requested_time_window_label: "",
    requested_time_window_start_month: "",
    requested_time_window_end_month: "",
    requested_time_window_period: "",
    requested_time_window_anchor_mode: "none",
    time_window_coverage_code: "none",
    available_time_window_start_month: "",
    available_time_window_end_month: "",
    available_time_window_period: "",
    comparison_time_window_kind: "none",
    comparison_time_window_label: "",
    comparison_time_window_start_month: "",
    comparison_time_window_end_month: "",
    comparison_time_window_period: "",
    comparison_time_window_anchor_mode: "none",
    comparison_time_window_coverage_code: "none",
    comparison_available_time_window_start_month: "",
    comparison_available_time_window_end_month: "",
    comparison_available_time_window_period: "",
    time_compare_mode: "none",
    tool_result_primary_period: "",
    tool_result_comparison_period: "",
    tool_result_delta_sales_amount_change_ratio: null,
    tool_result_delta_sales_volume_change_ratio: null,
    tool_result_delta_achievement_change_ratio: null,
    tool_result_delta_sales_amount_change: "",
    tool_result_delta_sales_volume_change: "",
    local_response_mode: "none",
  };
}

export function shouldLogPhase2Trace(env) {
  return getEnvString(env, "DEBUG_TRACE") === "1" || getEnvString(env, "NODE_ENV") !== "production";
}

function toQuestionJudgmentTrace(questionJudgment) {
  return {
    primary_dimension: trimString(questionJudgment?.primary_dimension?.code),
    granularity: trimString(questionJudgment?.granularity?.code),
    relevance: trimString(questionJudgment?.relevance?.code),
  };
}

function toDataAvailabilityTrace(dataAvailability) {
  return {
    has_business_data: trimString(dataAvailability?.has_business_data?.code),
    dimension_availability: trimString(dataAvailability?.dimension_availability?.code),
    answer_depth: trimString(dataAvailability?.answer_depth?.code),
    gap_hint_needed: trimString(dataAvailability?.gap_hint_needed?.code),
    detail_request_mode: trimString(dataAvailability?.detail_request_mode),
    hospital_monthly_support: trimString(dataAvailability?.hospital_monthly_support),
    product_hospital_support: trimString(dataAvailability?.product_hospital_support),
    hospital_named_support: trimString(dataAvailability?.hospital_named_support),
    product_full_support: trimString(dataAvailability?.product_full_support),
    product_named_support: trimString(dataAvailability?.product_named_support),
    product_named_match_mode: trimString(dataAvailability?.product_named_match_mode),
    requested_product_count_value: normalizeNumericValue(dataAvailability?.requested_product_count_value) ?? 0,
    product_hospital_hospital_count_value: normalizeNumericValue(dataAvailability?.product_hospital_hospital_count_value) ?? 0,
    product_hospital_zero_result: trimString(dataAvailability?.product_hospital_zero_result),
  };
}

function toSessionStateTrace(sessionState) {
  return {
    is_followup: Boolean(sessionState?.is_followup),
    inherit_primary_dimension: Boolean(sessionState?.inherit_primary_dimension),
    inherit_scope: Boolean(sessionState?.inherit_scope),
    topic_shift_detected: Boolean(sessionState?.topic_shift_detected),
  };
}

function toRouteDecisionTrace(routeDecision) {
  const reasonCodes = Array.isArray(routeDecision?.reason_codes)
    ? routeDecision.reason_codes.map((item) => trimString(item)).filter((item) => item)
    : [];
  return {
    route_code: trimString(routeDecision?.route?.code),
    reason_codes: reasonCodes,
  };
}

function toRetrievalStateTrace(retrievalState) {
  return {
    triggered: Boolean(retrievalState?.triggered),
    target_dimension: trimString(retrievalState?.target_dimension),
    success: Boolean(retrievalState?.success),
    window_capped: Boolean(retrievalState?.window_capped),
    degraded_to_bounded: Boolean(retrievalState?.degraded_to_bounded),
  };
}

function toOutputContextTrace(outputContext) {
  return {
    route_code: trimString(outputContext?.route_code),
    boundary_needed: Boolean(outputContext?.boundary_needed),
    refuse_mode: Boolean(outputContext?.refuse_mode),
    local_response_mode: trimString(outputContext?.local_response_mode),
  };
}

function toQcStateTrace(qcState) {
  const reasonCodes = Array.isArray(qcState?.reason_codes)
    ? qcState.reason_codes.map((item) => trimString(item)).filter((item) => item)
    : [];
  return {
    applied: Boolean(qcState?.applied),
    action: trimString(qcState?.action),
    reason_codes: reasonCodes,
  };
}

export function buildPhase2Trace({
  requestId,
  questionJudgment,
  dataAvailability,
  sessionState,
  routeDecision,
  retrievalState,
  outputContext,
  forcedBounded,
  qcState,
  toolRouteMode = "",
  toolRouteType = "",
  toolRouteName = "",
  toolRouteFallbackReason = "",
}) {
  return {
    requestId: trimString(requestId),
    questionJudgment: toQuestionJudgmentTrace(questionJudgment),
    dataAvailability: toDataAvailabilityTrace(dataAvailability),
    sessionState: toSessionStateTrace(sessionState),
    routeDecision: toRouteDecisionTrace(routeDecision),
    retrievalState: toRetrievalStateTrace(retrievalState),
    outputContext: toOutputContextTrace(outputContext),
    toolRouteMode: trimString(toolRouteMode),
    toolRouteType: trimString(toolRouteType),
    toolRouteName: trimString(toolRouteName),
    toolRouteFallbackReason: trimString(toolRouteFallbackReason),
    forced_bounded: Boolean(forcedBounded),
    qc: toQcStateTrace(qcState),
  };
}

export function logPhase2Trace(tracePayload, env) {
  if (!shouldLogPhase2Trace(env)) {
    return;
  }
  try {
    console.log("[chat.phase2.trace]", JSON.stringify(tracePayload));
  } catch (_error) {
    // trace logging should never affect primary request flow.
  }
}

function logGeminiCallBreadcrumb(prefix, eventName, payload) {
  try {
    console.log(`[gemini.${prefix}.${eventName}]`, JSON.stringify(payload));
  } catch (_error) {
    // Gemini breadcrumb logging should never affect primary request flow.
  }
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeQcComparableText(text) {
  return trimString(text)
    .toLocaleLowerCase()
    .replace(/[\s`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?，。！？；：、（）【】《》“”‘’…—]+/g, "");
}

function getEffectiveCharCount(text) {
  return normalizeQcComparableText(text).length;
}

function splitTextByQcSentenceRule(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/[\n。！？；]+/g)
    .map((item) => trimString(item))
    .filter((item) => item);
}

function containsAnyKeywordIgnoreCase(text, keywords) {
  const target = trimString(text).toLocaleLowerCase();
  if (!target || !Array.isArray(keywords) || keywords.length === 0) {
    return false;
  }
  return keywords.some((keyword) => {
    const probe = trimString(keyword).toLocaleLowerCase();
    return probe ? target.includes(probe) : false;
  });
}

function hasRefuseExamples(text) {
  if (!text) return false;
  const lowered = text.toLocaleLowerCase();
  const bulletCount = (text.match(/^\s*-\s+/gm) || []).length;
  return lowered.includes("你可以这样问") || lowered.includes("你可以问") || lowered.includes("例如") || /1\).+2\)/.test(text) || bulletCount >= 2;
}

function hasRefuseExamplesForQc(text) {
  if (hasRefuseExamples(text)) {
    return true;
  }
  const normalized = trimString(text);
  if (!normalized) {
    return false;
  }
  const bulletCount = (normalized.match(/^\s*-\s+/gm) || []).length;
  if (bulletCount >= 2) {
    return true;
  }
  const numberedCount = (normalized.match(/\d+[).、]/g) || []).length;
  if (numberedCount >= 2 && (normalized.includes("你可以问") || normalized.includes("例如") || normalized.includes("你可以这样问"))) {
    return true;
  }
  return false;
}

function hasBoundaryHintSentence(text) {
  if (!text) return false;
  return containsAnyKeywordIgnoreCase(text, QC_BOUNDARY_HINT_WORDS);
}

function hasBoundarySentenceForQc(text) {
  return hasBoundaryHintSentence(text) || containsAnyKeywordIgnoreCase(text, QC_BOUNDARY_HINT_WORDS);
}

function containsInternalProcessWords(text) {
  return containsAnyKeywordIgnoreCase(text, INTERNAL_PROCESS_WORDS);
}

function containsDataInsufficientWording(text) {
  return containsAnyKeywordIgnoreCase(text, ["数据不足", "未提供细分", "无法直接判断", "无法直接给出", "未包含", "无法提供"]);
}

function hasExplicitRequestedTimeWindow(text, outputContext) {
  const requestedPeriod = trimString(outputContext?.requested_time_window_period);
  if (!requestedPeriod) {
    return true;
  }
  return trimString(text).includes(requestedPeriod);
}

function looksLikeTimeWindowReinterpreted(text, outputContext) {
  const coverageCode = trimString(outputContext?.time_window_coverage_code);
  const requestedPeriod = trimString(outputContext?.requested_time_window_period);
  const availablePeriod = trimString(outputContext?.available_time_window_period);
  if (!requestedPeriod || !availablePeriod || (coverageCode !== "partial" && coverageCode !== "none")) {
    return false;
  }
  const normalizedText = trimString(text);
  return normalizedText.includes(availablePeriod) && !normalizedText.includes(requestedPeriod);
}

function isCompareUnderexplained(text, outputContext) {
  if (!Boolean(outputContext?.overall_period_compare_mode)) {
    return false;
  }
  const normalized = trimString(text);
  if (!normalized) {
    return false;
  }
  const primaryPeriod = trimString(outputContext?.requested_time_window_period);
  const comparisonPeriod = trimString(outputContext?.comparison_time_window_period);
  if (primaryPeriod && !normalized.includes(primaryPeriod)) {
    return true;
  }
  if (comparisonPeriod && !normalized.includes(comparisonPeriod)) {
    return true;
  }
  const hasDelta =
    containsAnyKeywordIgnoreCase(normalized, ["相比", "对比", "变化", "增幅", "下降", "上升"]) ||
    Boolean(trimString(outputContext?.tool_result_delta_sales_amount_change)) ||
    Boolean(trimString(outputContext?.tool_result_delta_sales_volume_change));
  return !hasDelta;
}

function countMentionedToolRowNames(text, outputContext) {
  const normalizedText = trimString(text);
  const rowNames = Array.isArray(outputContext?.tool_result_row_names) ? outputContext.tool_result_row_names : [];
  if (!normalizedText || rowNames.length === 0) {
    return 0;
  }
  let count = 0;
  rowNames.forEach((name) => {
    const safeName = trimString(name);
    if (safeName && normalizedText.includes(safeName)) {
      count += 1;
    }
  });
  return count;
}

function buildDeterministicProductHospitalSummary(outputContext) {
  const productNames = Array.isArray(outputContext?.tool_result_matched_products) ? outputContext.tool_result_matched_products : [];
  const topRowNames = Array.isArray(outputContext?.tool_result_row_names) ? outputContext.tool_result_row_names : [];
  const productLabel = productNames.length > 0 ? productNames.join("、") : "该产品";
  if (Boolean(outputContext?.product_hospital_zero_result_mode)) {
    return `在当前分析范围内，${productLabel}未产生医院销量贡献（贡献为0）。`;
  }
  if (topRowNames.length === 0) {
    return "";
  }
  return `在当前分析范围内，${productLabel}的主要贡献医院包括${topRowNames.slice(0, 3).join("、")}。`;
}

function buildDeterministicProductHospitalList(outputContext) {
  const topRowNames = Array.isArray(outputContext?.tool_result_row_names) ? outputContext.tool_result_row_names : [];
  return topRowNames.slice(0, 3).map((name, index) => `${index + 1}. ${name}`).join("\n");
}

function buildAnchoredQuarterPrefix(outputContext) {
  const anchorMode = trimString(outputContext?.requested_time_window_anchor_mode);
  const requestedLabel = trimString(outputContext?.requested_time_window_label);
  const requestedPeriod = trimString(outputContext?.requested_time_window_period);
  const requestedStart = trimString(outputContext?.requested_time_window_start_month);
  if (anchorMode !== "analysis_year" || !requestedLabel || !requestedPeriod || !requestedStart) {
    return "";
  }
  const year = requestedStart.slice(0, 4);
  const quarterMatch = requestedLabel.match(/[Qq]\s*([1-4])|([1-4])季度|第([一二三四])季度|([一二三四])季度/);
  let quarterLabel = "";
  if (quarterMatch) {
    quarterLabel = quarterMatch[1]
      ? `Q${quarterMatch[1]}`
      : quarterMatch[2]
        ? `Q${quarterMatch[2]}`
        : quarterMatch[3] === "一" || quarterMatch[4] === "一"
          ? "Q1"
          : quarterMatch[3] === "二" || quarterMatch[4] === "二"
            ? "Q2"
            : quarterMatch[3] === "三" || quarterMatch[4] === "三"
              ? "Q3"
              : quarterMatch[3] === "四" || quarterMatch[4] === "四"
                ? "Q4"
                : "";
  }
  if (!year || !quarterLabel) {
    return "";
  }
  return `按当前数据年份口径，这里将 ${requestedLabel} 解释为 ${year}年${quarterLabel}（${requestedPeriod}）。`;
}

function buildExplicitTimePrefix(outputContext) {
  const anchoredQuarterPrefix = buildAnchoredQuarterPrefix(outputContext);
  if (anchoredQuarterPrefix) {
    return anchoredQuarterPrefix;
  }
  const requestedPeriod = trimString(outputContext?.requested_time_window_period);
  if (!requestedPeriod) {
    return "";
  }
  return `本轮分析时间区间为 ${requestedPeriod}。`;
}

function hasExplicitComparisonTimeWindow(text, outputContext) {
  const primaryPeriod = trimString(outputContext?.requested_time_window_period);
  const comparisonPeriod = trimString(outputContext?.comparison_time_window_period);
  if (!primaryPeriod || !comparisonPeriod) {
    return true;
  }
  const normalized = trimString(text);
  return normalized.includes(primaryPeriod) && normalized.includes(comparisonPeriod);
}

function buildExplicitComparisonPrefix(outputContext) {
  const primaryPeriod = trimString(outputContext?.requested_time_window_period);
  const comparisonPeriod = trimString(outputContext?.comparison_time_window_period);
  if (!primaryPeriod || !comparisonPeriod) {
    return "";
  }
  const anchorMode = trimString(outputContext?.requested_time_window_anchor_mode);
  const label = trimString(outputContext?.requested_time_window_label);
  const comparisonLabel = trimString(outputContext?.comparison_time_window_label);
  const requestedStart = trimString(outputContext?.requested_time_window_start_month);
  if (anchorMode === "analysis_year" && requestedStart) {
    const year = requestedStart.slice(0, 4);
    const requestedQuarter = trimString(label).replace(/\s+/g, "");
    const comparisonQuarter = trimString(comparisonLabel).replace(/\s+/g, "");
    return `按当前数据年份口径，这里将 ${requestedQuarter || "主窗口"} 解释为 ${year}年${requestedQuarter || ""}（${primaryPeriod}），将 ${comparisonQuarter || "对比窗口"} 解释为 ${year}年${comparisonQuarter || ""}（${comparisonPeriod}）。`;
  }
  const requestedLabel = trimString(label);
  const comparisonWindowLabel = trimString(comparisonLabel);
  if (requestedLabel || comparisonWindowLabel) {
    return `本轮主分析区间${requestedLabel ? `（${requestedLabel}）` : ""}为 ${primaryPeriod}，对比区间${comparisonWindowLabel ? `（${comparisonWindowLabel}）` : ""}为 ${comparisonPeriod}。`;
  }
  return `本轮主分析区间为 ${primaryPeriod}，对比区间为 ${comparisonPeriod}。`;
}

function toWanTextFromValue(rawValue) {
  const numeric = normalizeNumericValue(rawValue);
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return "--";
  }
  return `${(numeric / 10000).toFixed(2)}万元`;
}

function toRatioText(rawValue) {
  const numeric = normalizeNumericValue(rawValue);
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return "--";
  }
  return `${(numeric * 100).toFixed(2)}%`;
}

function toSignedRatioText(rawValue) {
  const numeric = normalizeNumericValue(rawValue);
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return "--";
  }
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${(numeric * 100).toFixed(2)}%`;
}

function buildLocalProductHospitalReply(toolResult, outputContext) {
  const productNames = Array.isArray(toolResult?.matched_entities?.products) ? toolResult.matched_entities.products : [];
  const rows = Array.isArray(toolResult?.rows) ? toolResult.rows : [];
  const productLabel = productNames.length > 0 ? productNames.join("、") : "该产品";
  const lines = [];
  const timePrefix = buildExplicitTimePrefix(outputContext);
  if (timePrefix) {
    lines.push(timePrefix);
  }
  if (rows.length === 0) {
    lines.push(`在当前分析范围内，${productLabel}未产生医院销量贡献（贡献为0）。`);
    lines.push("建议优先确认该产品在目标医院的铺货和采购触达情况，再评估后续放量空间。");
    return lines.join("\n");
  }
  const topRows = rows.slice(0, 3);
  const topNames = topRows.map((row) => trimString(row?.hospital_name)).filter((item) => item);
  if (topNames.length > 0) {
    lines.push(`${productLabel}的主要贡献医院集中在${topNames.join("、")}。`);
  }
  topRows.forEach((row, index) => {
    const hospitalName = trimString(row?.hospital_name) || `医院${index + 1}`;
    const amountText = trimString(row?.sales_amount) || toWanTextFromValue(row?.sales_amount_value);
    const shareText = trimString(row?.sales_share) || toRatioText(row?.sales_share_ratio);
    const changeText = trimString(row?.change_value) || trimString(row?.amount_mom) || toSignedRatioText(row?.amount_mom_ratio);
    const changeSuffix = changeText && changeText !== "--" ? `，最近变化 ${changeText}` : "";
    lines.push(`${index + 1}. ${hospitalName}：销售额 ${amountText}，占比 ${shareText}${changeSuffix}。`);
  });
  lines.push(`建议优先复盘${topRows[0] && trimString(topRows[0].hospital_name) ? trimString(topRows[0].hospital_name) : "核心医院"}的贡献驱动，并对比其他重点医院的持续性。`);
  return lines.join("\n");
}

function buildLocalHospitalNamedReply(toolResult, outputContext) {
  const hospitals = Array.isArray(toolResult?.matched_entities?.hospitals) ? toolResult.matched_entities.hospitals : [];
  const summary = toolResult?.summary && typeof toolResult.summary === "object" ? toolResult.summary : {};
  const hospitalLabel = hospitals.length > 0 ? hospitals.join("、") : "该机构";
  const lines = [];
  const timePrefix = buildExplicitTimePrefix(outputContext);
  if (timePrefix) {
    lines.push(timePrefix);
  }
  const amountText = trimString(summary?.sales_amount) || toWanTextFromValue(summary?.sales_amount_value);
  const volumeText = trimString(summary?.sales_volume) || (
    typeof normalizeNumericValue(summary?.sales_volume_value) === "number"
      ? `${normalizeNumericValue(summary.sales_volume_value)}盒`
      : "--"
  );
  const changeText =
    trimString(summary?.latest_key_change) ||
    trimString(summary?.amount_mom) ||
    toSignedRatioText(summary?.latest_key_change_ratio) ||
    toSignedRatioText(summary?.amount_mom_ratio);
  lines.push(`${hospitalLabel}在当前分析区间内整体表现${amountText !== "--" ? `较为明确，销售额为 ${amountText}` : "已有可参考业务信号"}${volumeText !== "--" ? `，销量 ${volumeText}` : ""}。`);
  if (changeText && changeText !== "--") {
    lines.push(`近期变化方面，关键指标变动为 ${changeText}。`);
  }
  lines.push(`建议继续跟踪${hospitalLabel}的采购节奏和波动月份，判断当前增长或回落是否具备持续性。`);
  return lines.join("\n");
}

function buildLocalProductFullReply(toolResult, outputContext) {
  const rows = Array.isArray(toolResult?.rows) ? toolResult.rows : [];
  const lines = [];
  const timePrefix = buildExplicitTimePrefix(outputContext);
  if (timePrefix) {
    lines.push(timePrefix);
  }
  if (rows.length === 0) {
    lines.push("当前分析区间内未看到可列示的产品贡献结果。");
    lines.push("建议优先确认当前筛选范围内是否已覆盖目标产品，并再判断是否需要按产品线拆分查看。");
    return lines.join("\n");
  }
  const topRows = rows.slice(0, 3);
  lines.push(`当前产品表现可先聚焦${topRows.map((row) => trimString(row?.product_name)).filter((item) => item).join("、")}等核心产品。`);
  topRows.forEach((row, index) => {
    const productName = trimString(row?.product_name) || `产品${index + 1}`;
    const amountText = trimString(row?.sales_amount) || toWanTextFromValue(row?.sales_amount_value);
    const shareText = trimString(row?.sales_share) || toRatioText(row?.sales_share_ratio);
    lines.push(`${index + 1}. ${productName}：销售额 ${amountText}，占比 ${shareText}。`);
  });
  if (rows.length > 3) {
    lines.push(`当前回答优先覆盖前 ${Math.min(rows.length, 3)} 个重点产品，其余产品可继续按当前区间补充展开。`);
  }
  return lines.join("\n");
}

function buildLocalHospitalMonthlyReply(toolResult, outputContext) {
  const rows = Array.isArray(toolResult?.rows) ? toolResult.rows : [];
  const lines = [];
  const timePrefix = buildExplicitTimePrefix(outputContext);
  if (timePrefix) {
    lines.push(timePrefix);
  }
  if (rows.length === 0) {
    lines.push("当前分析区间内未形成可列示的医院月度摘要。");
    lines.push("建议先确认当前时间范围内是否已有月度医院记录，再继续逐月分析。");
    return lines.join("\n");
  }
  const firstRow = rows[0];
  const hospitalLabel = trimString(firstRow?.hospital_name) || "该机构";
  const monthlyPoints = Array.isArray(firstRow?.monthly_points) ? firstRow.monthly_points : [];
  lines.push(`${hospitalLabel}在当前分析区间内存在明显的月度波动。`);
  monthlyPoints.slice(0, 3).forEach((point, index) => {
    const period = trimString(point?.period);
    const amountText = trimString(point?.sales_amount) || toWanTextFromValue(point?.sales_amount_value);
    const changeText = trimString(point?.amount_mom) || toSignedRatioText(point?.amount_mom_ratio);
    lines.push(`${index + 1}. ${period}：销售额 ${amountText}${changeText && changeText !== "--" ? `，环比 ${changeText}` : ""}。`);
  });
  lines.push(`建议重点关注${hospitalLabel}波动较大的月份，并结合采购节奏判断后续稳定性。`);
  return lines.join("\n");
}

function buildLocalOverallTimeWindowReply(toolResult, outputContext) {
  const summary = toolResult?.summary && typeof toolResult.summary === "object" ? toolResult.summary : {};
  const rows = Array.isArray(toolResult?.rows) ? toolResult.rows : [];
  const lines = [];
  const timePrefix = buildExplicitTimePrefix(outputContext);
  if (timePrefix) {
    lines.push(timePrefix);
  }

  const salesAmountText = trimString(summary?.sales_amount) || toWanTextFromValue(summary?.sales_amount_value);
  const salesVolumeText =
    trimString(summary?.sales_volume) ||
    (typeof normalizeNumericValue(summary?.sales_volume_value) === "number"
      ? `${normalizeNumericValue(summary?.sales_volume_value)}盒`
      : "--");
  const latestChangeText =
    trimString(summary?.latest_key_change) || toSignedRatioText(summary?.latest_key_change_ratio);
  const keySignals = Array.isArray(summary?.key_business_signals)
    ? summary.key_business_signals.map((item) => trimString(item)).filter((item) => item)
    : [];

  if (salesAmountText !== "--") {
    lines.push(`整体销售在该时间区间内已有明确结果，销售额为 ${salesAmountText}${salesVolumeText !== "--" ? `，销量 ${salesVolumeText}` : ""}。`);
  } else if (keySignals.length > 0) {
    lines.push(`整体销售在该时间区间内已有可参考的业务信号。`);
  } else {
    lines.push("当前时间区间内可参考的整体业务结果有限。");
  }

  if (latestChangeText && latestChangeText !== "--") {
    lines.push(`关键变化方面，${latestChangeText}。`);
  }

  const topRows = rows.slice(-3);
  if (topRows.length > 0) {
    lines.push("时间区间内的关键月度表现如下：");
    topRows.forEach((row, index) => {
      const period = trimString(row?.period) || `月份${index + 1}`;
      const amountText = trimString(row?.sales_amount) || toWanTextFromValue(row?.sales_amount_value);
      const momText = trimString(row?.amount_mom) || toSignedRatioText(row?.amount_mom_ratio);
      lines.push(`${index + 1}. ${period}：销售额 ${amountText}${momText && momText !== "--" ? `，环比 ${momText}` : ""}。`);
    });
  } else if (keySignals.length > 0) {
    lines.push(`重点信号：${keySignals.slice(0, 2).join("；")}`);
  }

  lines.push("建议结合该时间区间内的波动月份，继续复盘增长驱动和回落原因，避免把阶段性表现误读为全年趋势。");
  return lines.join("\n");
}

function buildLocalOverallPeriodCompareReply(toolResult, outputContext) {
  const summary = toolResult?.summary && typeof toolResult.summary === "object" ? toolResult.summary : {};
  const primary = summary?.primary && typeof summary.primary === "object" ? summary.primary : {};
  const comparison = summary?.comparison && typeof summary.comparison === "object" ? summary.comparison : {};
  const delta = summary?.delta && typeof summary.delta === "object" ? summary.delta : {};
  const lines = [];
  const timePrefix = buildExplicitComparisonPrefix(outputContext);
  if (timePrefix) {
    lines.push(timePrefix);
  }
  const primaryAmount = trimString(primary?.sales_amount) || toWanTextFromValue(primary?.sales_amount_value);
  const primaryVolume =
    trimString(primary?.sales_volume) ||
    (typeof normalizeNumericValue(primary?.sales_volume_value) === "number"
      ? `${normalizeNumericValue(primary?.sales_volume_value)}盒`
      : "--");
  const comparisonAmount = trimString(comparison?.sales_amount) || toWanTextFromValue(comparison?.sales_amount_value);
  const comparisonVolume =
    trimString(comparison?.sales_volume) ||
    (typeof normalizeNumericValue(comparison?.sales_volume_value) === "number"
      ? `${normalizeNumericValue(comparison?.sales_volume_value)}盒`
      : "--");
  const amountDelta =
    trimString(delta?.sales_amount_change) ||
    trimString(outputContext?.tool_result_sales_amount_change) ||
    toSignedRatioText(delta?.sales_amount_change_ratio ?? outputContext?.tool_result_sales_amount_change_ratio);
  const volumeDelta =
    trimString(delta?.sales_volume_change) ||
    trimString(outputContext?.tool_result_sales_volume_change) ||
    toSignedRatioText(delta?.sales_volume_change_ratio ?? outputContext?.tool_result_sales_volume_change_ratio);
  lines.push(`主窗口整体销售额为 ${primaryAmount}${primaryVolume !== "--" ? `，销量 ${primaryVolume}` : ""}。`);
  lines.push(`对比窗口整体销售额为 ${comparisonAmount}${comparisonVolume !== "--" ? `，销量 ${comparisonVolume}` : ""}。`);
  if (amountDelta && amountDelta !== "--") {
    lines.push(`与对比窗口相比，销售额变化为 ${amountDelta}${volumeDelta && volumeDelta !== "--" ? `，销量变化为 ${volumeDelta}` : ""}。`);
  } else if (volumeDelta && volumeDelta !== "--") {
    lines.push(`与对比窗口相比，销量变化为 ${volumeDelta}。`);
  }
  lines.push("建议继续结合季度内关键月份和核心产品表现，判断本轮变化是阶段性波动还是持续性趋势。");
  return lines.join("\n");
}

export function buildLocalDeterministicToolReply(toolResult, outputContext) {
  const routeType = trimString(outputContext?.tool_route_type);
  if (routeType === "product_hospital") {
    return buildLocalProductHospitalReply(toolResult, outputContext);
  }
  if (routeType === "hospital_named") {
    return buildLocalHospitalNamedReply(toolResult, outputContext);
  }
  if (routeType === "product_full") {
    return buildLocalProductFullReply(toolResult, outputContext);
  }
  if (routeType === "hospital_monthly") {
    return buildLocalHospitalMonthlyReply(toolResult, outputContext);
  }
  if (routeType === "overall_time_window") {
    return buildLocalOverallTimeWindowReply(toolResult, outputContext);
  }
  if (routeType === "overall_period_compare") {
    return buildLocalOverallPeriodCompareReply(toolResult, outputContext);
  }
  return "";
}

function hasHighDuplication(text) {
  const sentences = splitTextByQcSentenceRule(text);
  if (sentences.length < QC_HIGH_DUP_SENTENCE_MIN) {
    return false;
  }
  const normalizedSentences = sentences.map((item) => normalizeQcComparableText(item)).filter((item) => item);
  if (normalizedSentences.length < QC_HIGH_DUP_SENTENCE_MIN) {
    return false;
  }
  const uniqueCount = new Set(normalizedSentences).size;
  const uniqueRatio = uniqueCount / normalizedSentences.length;
  return uniqueRatio <= QC_HIGH_DUP_UNIQUE_RATIO_MAX;
}

function stripRefuseExamplesForMismatch(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return "";
  }
  const lines = normalized
    .split(/\n+/)
    .map((item) => trimString(item))
    .filter((item) => item);
  if (lines.length === 0) {
    return "";
  }

  const cutIndex = lines.findIndex((line) => {
    return line.includes("你可以问") || line.includes("你可以这样问") || line.includes("例如") || /^\s*-\s+/.test(line) || /^\s*\d+[).、]/.test(line);
  });

  if (cutIndex === -1) {
    return normalized;
  }
  return trimString(lines.slice(0, cutIndex).join("\n"));
}

function isStrongRouteMismatch(reply, routeCode) {
  const text = trimString(reply);
  if (!text) {
    return false;
  }
  if (routeCode !== ROUTE_DECISION_CODES.REFUSE) {
    return containsAnyKeywordIgnoreCase(text, QC_STRONG_REFUSE_WORDS) && text.length < QC_ROUTE_MISMATCH_SHORT_MAX_CHARS;
  }
  const refuseMainText = stripRefuseExamplesForMismatch(text);
  if (!refuseMainText) {
    return false;
  }
  const sentenceCount = splitTextByQcSentenceRule(refuseMainText).length;
  return sentenceCount >= 3 && containsAnyKeywordIgnoreCase(refuseMainText, QC_BUSINESS_EVIDENCE_WORDS);
}

function splitQcFindingsBySeverity(findings) {
  const safeFindings = Array.isArray(findings) ? findings : [];
  const severeSet = new Set([QC_REASON_CODES.EMPTY_OR_TOO_SHORT, QC_REASON_CODES.IRRELEVANT_REFUSE_MISMATCH]);
  const severeFindings = safeFindings.filter((code) => severeSet.has(code));
  const nonSevereFindings = safeFindings.filter((code) => !severeSet.has(code));
  return {
    severe_findings: severeFindings,
    non_severe_findings: nonSevereFindings,
  };
}

function evaluateReplyQuality(reply, outputContext, routeDecision) {
  const findings = [];
  const routeCode = trimString(routeDecision?.route?.code) || trimString(outputContext?.route_code);
  const text = trimString(reply);

  if (!text || getEffectiveCharCount(text) < QC_MIN_EFFECTIVE_CHARS) {
    findings.push(QC_REASON_CODES.EMPTY_OR_TOO_SHORT);
  }
  if (containsInternalProcessWords(text)) {
    findings.push(QC_REASON_CODES.CONTAINS_INTERNAL_PROCESS_WORDS);
  }
  if (routeCode === ROUTE_DECISION_CODES.REFUSE && !hasRefuseExamplesForQc(text)) {
    findings.push(QC_REASON_CODES.REFUSE_MISSING_EXAMPLES);
  }
  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER && !hasBoundarySentenceForQc(text)) {
    findings.push(QC_REASON_CODES.BOUNDED_MISSING_BOUNDARY_SENTENCE);
  }
  if (hasHighDuplication(text)) {
    findings.push(QC_REASON_CODES.HIGH_DUPLICATION);
  }
  if (isStrongRouteMismatch(text, routeCode)) {
    findings.push(QC_REASON_CODES.IRRELEVANT_REFUSE_MISMATCH);
  }
  const deterministicToolRoute = trimString(outputContext?.tool_route_mode) === "deterministic";
  const toolCoverageCode = trimString(outputContext?.tool_result_coverage_code);
  const toolRowCount = normalizeNumericValue(outputContext?.tool_result_row_count_value) ?? 0;
  if (deterministicToolRoute && toolCoverageCode === "full") {
    if (
      (toolRowCount > 0 && containsDataInsufficientWording(text)) ||
      (toolRowCount === 0 && (containsDataInsufficientWording(text) || !containsAnyKeywordIgnoreCase(text, ["贡献为0", "未产生医院销量贡献", "无贡献"])))
    ) {
      findings.push(QC_REASON_CODES.TOOL_RESULT_CONTRADICTION);
    }
    if (
      Boolean(outputContext?.product_hospital_detail_mode) &&
      toolRowCount >= 3 &&
      countMentionedToolRowNames(text, outputContext) < 2
    ) {
      findings.push(QC_REASON_CODES.TOOL_RESULT_UNDERLISTED);
    }
  }
  if (trimString(outputContext?.requested_time_window_kind) !== "none" && !hasExplicitRequestedTimeWindow(text, outputContext)) {
    if (trimString(outputContext?.time_compare_mode) === "none") {
      findings.push(QC_REASON_CODES.TIME_WINDOW_NOT_EXPLICIT);
    }
  }
  if (looksLikeTimeWindowReinterpreted(text, outputContext)) {
    findings.push(QC_REASON_CODES.TIME_WINDOW_REINTERPRETED);
  }
  if (trimString(outputContext?.time_compare_mode) !== "none" && !hasExplicitComparisonTimeWindow(text, outputContext)) {
    findings.push(QC_REASON_CODES.COMPARE_WINDOW_NOT_EXPLICIT);
  }
  if (isCompareUnderexplained(text, outputContext)) {
    findings.push(QC_REASON_CODES.COMPARE_RESULT_UNDEREXPLAINED);
  }

  const dedupedFindings = [];
  for (const finding of findings) {
    if (!dedupedFindings.includes(finding)) {
      dedupedFindings.push(finding);
    }
  }
  return {
    findings: dedupedFindings,
    ...splitQcFindingsBySeverity(dedupedFindings),
  };
}

function scrubInternalProcessWords(text) {
  let output = trimString(text);
  for (const keyword of INTERNAL_PROCESS_WORDS) {
    const safeKeyword = trimString(keyword);
    if (!safeKeyword) {
      continue;
    }
    output = output.replace(new RegExp(escapeRegExp(safeKeyword), "gi"), "");
  }
  output = output
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\(\s*\)/g, "")
    .replace(/（\s*）/g, "");
  return trimString(output);
}

function removeTailDuplicatedContent(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return "";
  }

  const lines = normalized
    .split(/\n+/)
    .map((item) => trimString(item))
    .filter((item) => item);
  if (lines.length > 1) {
    while (lines.length > 1) {
      const last = normalizeQcComparableText(lines[lines.length - 1]);
      const previous = new Set(lines.slice(0, -1).map((item) => normalizeQcComparableText(item)));
      if (last && previous.has(last)) {
        lines.pop();
        continue;
      }
      break;
    }
  }

  let output = lines.join("\n");
  const sentences = splitTextByQcSentenceRule(output);
  if (sentences.length > 1) {
    while (sentences.length > 1) {
      const last = normalizeQcComparableText(sentences[sentences.length - 1]);
      const previous = new Set(sentences.slice(0, -1).map((item) => normalizeQcComparableText(item)));
      if (last && previous.has(last)) {
        sentences.pop();
        continue;
      }
      break;
    }
    output = sentences.join("。");
  }
  return trimString(output);
}

function appendRefuseExamplesText(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return QC_REFUSE_EXAMPLES_TEXT;
  }
  if (hasRefuseExamplesForQc(normalized)) {
    return normalized;
  }
  return [normalized, QC_REFUSE_EXAMPLES_TEXT].join("\n");
}

function injectBoundedBoundarySentence(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return QC_BOUNDED_BOUNDARY_TEXT;
  }
  if (hasBoundarySentenceForQc(normalized)) {
    return normalized;
  }
  const lines = normalized.split(/\n+/).map((item) => trimString(item)).filter((item) => item);
  if (lines.length === 0) {
    return QC_BOUNDED_BOUNDARY_TEXT;
  }
  if (lines.length === 1) {
    return [lines[0], QC_BOUNDED_BOUNDARY_TEXT].join("\n\n");
  }
  return [lines[0], QC_BOUNDED_BOUNDARY_TEXT, ...lines.slice(1)].join("\n");
}

function injectExplicitTimeWindow(text, outputContext) {
  const requestedPeriod = trimString(outputContext?.requested_time_window_period);
  if (!requestedPeriod) {
    return trimString(text);
  }
  const normalized = trimString(text);
  if (!normalized) {
    return `本轮分析时间区间为 ${requestedPeriod}。`;
  }
  if (normalized.includes(requestedPeriod)) {
    return normalized;
  }
  return [`本轮分析时间区间为 ${requestedPeriod}。`, normalized].join("\n");
}

function injectExplicitComparisonWindow(text, outputContext) {
  const prefix = buildExplicitComparisonPrefix(outputContext);
  if (!prefix) {
    return trimString(text);
  }
  const normalized = trimString(text);
  if (!normalized) {
    return prefix;
  }
  if (hasExplicitComparisonTimeWindow(normalized, outputContext)) {
    return normalized;
  }
  return [prefix, normalized].join("\n");
}

function applyMinimalPatch(reply, findings, outputContext) {
  let patched = trimString(reply);
  const routeCode = trimString(outputContext?.route_code);
  const findingSet = new Set(Array.isArray(findings) ? findings : []);
  const deterministicProductHospitalPatch =
    Boolean(outputContext?.product_hospital_detail_mode) &&
    (findingSet.has(QC_REASON_CODES.TOOL_RESULT_CONTRADICTION) || findingSet.has(QC_REASON_CODES.TOOL_RESULT_UNDERLISTED));
  const deterministicComparePatch =
    Boolean(outputContext?.overall_period_compare_mode) &&
    (findingSet.has(QC_REASON_CODES.COMPARE_WINDOW_NOT_EXPLICIT) || findingSet.has(QC_REASON_CODES.COMPARE_RESULT_UNDEREXPLAINED));

  if (findingSet.has(QC_REASON_CODES.CONTAINS_INTERNAL_PROCESS_WORDS)) {
    patched = scrubInternalProcessWords(patched);
  }
  if (findingSet.has(QC_REASON_CODES.HIGH_DUPLICATION)) {
    patched = removeTailDuplicatedContent(patched);
  }
  if (deterministicProductHospitalPatch) {
    const summaryText = buildDeterministicProductHospitalSummary(outputContext);
    const listText = buildDeterministicProductHospitalList(outputContext);
    patched = trimString([summaryText, listText].filter((item) => trimString(item)).join("\n"));
  }
  if (deterministicComparePatch) {
    patched = buildLocalOverallPeriodCompareReply(
      {
        summary: {
          primary: {
            sales_amount: "",
            sales_volume: "",
          },
          comparison: {
            sales_amount: "",
            sales_volume: "",
          },
          delta: {
            sales_amount_change: trimString(outputContext?.tool_result_delta_sales_amount_change),
            sales_volume_change: trimString(outputContext?.tool_result_delta_sales_volume_change),
            sales_amount_change_ratio: outputContext?.tool_result_delta_sales_amount_change_ratio,
            sales_volume_change_ratio: outputContext?.tool_result_delta_sales_volume_change_ratio,
          },
        },
      },
      outputContext,
    );
  }
  if (routeCode === ROUTE_DECISION_CODES.REFUSE && findingSet.has(QC_REASON_CODES.REFUSE_MISSING_EXAMPLES)) {
    patched = appendRefuseExamplesText(patched);
  }
  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER && findingSet.has(QC_REASON_CODES.BOUNDED_MISSING_BOUNDARY_SENTENCE)) {
    patched = injectBoundedBoundarySentence(patched);
  }
  if (
    findingSet.has(QC_REASON_CODES.TIME_WINDOW_REINTERPRETED) ||
    (findingSet.has(QC_REASON_CODES.TIME_WINDOW_NOT_EXPLICIT) &&
      trimString(outputContext?.time_window_coverage_code) !== "partial" &&
      trimString(outputContext?.time_window_coverage_code) !== "none")
  ) {
    patched = findingSet.has(QC_REASON_CODES.TIME_WINDOW_REINTERPRETED)
      ? buildTimeWindowBoundaryReplyFromOutputContext(outputContext)
      : injectExplicitTimeWindow(patched, outputContext);
  }
  if (
    findingSet.has(QC_REASON_CODES.COMPARE_WINDOW_NOT_EXPLICIT) ||
    findingSet.has(QC_REASON_CODES.COMPARE_RESULT_UNDEREXPLAINED)
  ) {
    patched = injectExplicitComparisonWindow(patched, outputContext);
  }

  return trimString(patched).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function buildQualityFallbackReply(routeCode, outputContext) {
  const safeRouteCode = trimString(routeCode) || trimString(outputContext?.route_code);
  if (safeRouteCode === ROUTE_DECISION_CODES.REFUSE) {
    return buildRefuseReplyTemplate(outputContext);
  }
  if (safeRouteCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER) {
    if (Boolean(outputContext?.overall_period_compare_mode)) {
      return buildLocalOverallPeriodCompareReply(
        {
          summary: {
            primary: {},
            comparison: {},
            delta: {
              sales_amount_change: trimString(outputContext?.tool_result_delta_sales_amount_change),
              sales_volume_change: trimString(outputContext?.tool_result_delta_sales_volume_change),
              sales_amount_change_ratio: outputContext?.tool_result_delta_sales_amount_change_ratio,
              sales_volume_change_ratio: outputContext?.tool_result_delta_sales_volume_change_ratio,
            },
          },
        },
        outputContext,
      );
    }
    return [
      "基于当前可用业务信息，可以先给出方向性判断：当前表现已有可参考信号。",
      QC_BOUNDED_BOUNDARY_TEXT,
      "如果继续深入，建议优先按产品、医院和时间层级逐步细拆。",
    ].join("\n");
  }
  return [
    "基于当前可用业务信息，可以先给出方向性结论：请优先聚焦对业绩影响最大的产品或医院。",
    "依据是现有快照已提供关键业务信号与近期趋势。",
    "下一步建议围绕重点对象制定可执行推进动作，并持续跟踪变化。",
  ].join("\n");
}

export function applyQualityControl(replyDraft, outputContext, routeDecision) {
  const initial = evaluateReplyQuality(replyDraft, outputContext, routeDecision);
  if (initial.findings.includes(QC_REASON_CODES.TIME_WINDOW_REINTERPRETED)) {
    return {
      finalReplyText: buildTimeWindowBoundaryReplyFromOutputContext(outputContext),
      qcState: {
        applied: true,
        reason_codes: initial.findings,
        action: QC_ACTIONS.SAFE_FALLBACK,
      },
    };
  }
  const deterministicToolConsistencyPatch =
    trimString(outputContext?.tool_route_mode) === "deterministic" &&
    initial.findings.some(
      (code) => code === QC_REASON_CODES.TOOL_RESULT_CONTRADICTION || code === QC_REASON_CODES.TOOL_RESULT_UNDERLISTED,
    );
  const deterministicComparePatch =
    trimString(outputContext?.tool_route_mode) === "deterministic" &&
    initial.findings.some(
      (code) => code === QC_REASON_CODES.COMPARE_WINDOW_NOT_EXPLICIT || code === QC_REASON_CODES.COMPARE_RESULT_UNDEREXPLAINED,
    );
  const timeWindowExplicitPatchAllowed =
    initial.findings.includes(QC_REASON_CODES.TIME_WINDOW_NOT_EXPLICIT) &&
    initial.severe_findings.length > 0 &&
    initial.severe_findings.every((code) => code === QC_REASON_CODES.EMPTY_OR_TOO_SHORT);
  const severeFindingsAllowDeterministicPatch =
    (deterministicToolConsistencyPatch || deterministicComparePatch) &&
    initial.severe_findings.length > 0 &&
    initial.severe_findings.every((code) => code === QC_REASON_CODES.EMPTY_OR_TOO_SHORT);
  if (initial.findings.length === 0) {
    return {
      finalReplyText: replyDraft,
      qcState: {
        applied: false,
        reason_codes: [],
        action: QC_ACTIONS.PASS_THROUGH,
      },
    };
  }

  if (
    initial.severe_findings.length > 0 &&
    !severeFindingsAllowDeterministicPatch &&
    !timeWindowExplicitPatchAllowed
  ) {
    return {
      finalReplyText: buildQualityFallbackReply(trimString(routeDecision?.route?.code), outputContext),
      qcState: {
        applied: true,
        reason_codes: initial.findings,
        action: QC_ACTIONS.SAFE_FALLBACK,
      },
    };
  }

  const patchedReply = applyMinimalPatch(replyDraft, initial.findings, outputContext);
  const rechecked = evaluateReplyQuality(patchedReply, outputContext, routeDecision);
  const remainingDeterministicToolFindings = rechecked.findings.filter(
    (code) => code === QC_REASON_CODES.TOOL_RESULT_CONTRADICTION || code === QC_REASON_CODES.TOOL_RESULT_UNDERLISTED,
  );
  const remainingCompareFindings = rechecked.findings.filter(
    (code) => code === QC_REASON_CODES.COMPARE_WINDOW_NOT_EXPLICIT || code === QC_REASON_CODES.COMPARE_RESULT_UNDEREXPLAINED,
  );
  if (
    (deterministicToolConsistencyPatch || deterministicComparePatch) &&
    rechecked.severe_findings.length === 0 &&
    remainingDeterministicToolFindings.length === 0 &&
    remainingCompareFindings.length === 0
  ) {
    return {
      finalReplyText: patchedReply,
      qcState: {
        applied: true,
        reason_codes: initial.findings,
        action: QC_ACTIONS.MINIMAL_PATCH,
      },
    };
  }
  const shouldFallback =
    rechecked.severe_findings.length > 0 ||
    (initial.non_severe_findings.length >= QC_NON_SEVERE_FALLBACK_MIN && rechecked.findings.length >= 1);
  if (shouldFallback) {
    const reasonCodes = [...initial.findings];
    for (const code of rechecked.findings) {
      if (!reasonCodes.includes(code)) {
        reasonCodes.push(code);
      }
    }
    return {
      finalReplyText: buildQualityFallbackReply(trimString(routeDecision?.route?.code), outputContext),
      qcState: {
        applied: true,
        reason_codes: reasonCodes,
        action: QC_ACTIONS.SAFE_FALLBACK,
      },
    };
  }

  return {
    finalReplyText: patchedReply,
    qcState: {
      applied: true,
      reason_codes: initial.findings,
      action: QC_ACTIONS.MINIMAL_PATCH,
    },
  };
}

export function buildOutputInstructionText(outputContext) {
  const routeCode = trimString(outputContext?.route_code);
  const hospitalMonthlyDetailMode = Boolean(outputContext?.hospital_monthly_detail_mode);
  const productHospitalDetailMode = Boolean(outputContext?.product_hospital_detail_mode);
  const hospitalNamedDetailMode = Boolean(outputContext?.hospital_named_detail_mode);
  const productFullDetailMode = Boolean(outputContext?.product_full_detail_mode);
  const productNamedDetailMode = Boolean(outputContext?.product_named_detail_mode);
  const productHospitalSupportCode = trimString(outputContext?.product_hospital_support_code);
  const productHospitalHospitalCountValue = normalizeNumericValue(outputContext?.product_hospital_hospital_count_value) ?? 0;
  const toolResultCoverageCode = trimString(outputContext?.tool_result_coverage_code);
  const toolResultRowCountValue = normalizeNumericValue(outputContext?.tool_result_row_count_value) ?? 0;
  const hospitalNamedSupportCode = trimString(outputContext?.hospital_named_support_code);
  const productFullSupportCode = trimString(outputContext?.product_full_support_code);
  const productNamedSupportCode = trimString(outputContext?.product_named_support_code);
  const requestedTimeWindowKind = trimString(outputContext?.requested_time_window_kind);
  const requestedTimeWindowPeriod = trimString(outputContext?.requested_time_window_period);
  const requestedTimeWindowAnchorMode = trimString(outputContext?.requested_time_window_anchor_mode);
  const requestedTimeWindowLabel = trimString(outputContext?.requested_time_window_label);
  const timeWindowCoverageCode = trimString(outputContext?.time_window_coverage_code);
  const availableTimeWindowPeriod = trimString(outputContext?.available_time_window_period);
  const comparisonTimeWindowPeriod = trimString(outputContext?.comparison_time_window_period);
  const comparisonTimeWindowLabel = trimString(outputContext?.comparison_time_window_label);
  const timeCompareMode = trimString(outputContext?.time_compare_mode);
  const timeWindowInstructionText =
    requestedTimeWindowKind !== "none" && requestedTimeWindowPeriod
      ? `时间口径约束：本轮回答必须显式写出实际采用的时间区间 ${requestedTimeWindowPeriod}，不要只写“本月/近三个月”。${
          requestedTimeWindowAnchorMode === "analysis_year" && requestedTimeWindowLabel
            ? `并明确说明这是按当前数据年份口径将“${requestedTimeWindowLabel}”解释为该区间。`
            : ""
        }${
          timeWindowCoverageCode === "partial" || timeWindowCoverageCode === "none"
            ? `当前可用区间为 ${availableTimeWindowPeriod}，不得把请求时间偷换成报表尾部月份。`
            : ""
        }`
      : "";
  const compareInstructionText =
    timeCompareMode !== "none" && requestedTimeWindowPeriod && comparisonTimeWindowPeriod
      ? `对比口径约束：本轮回答必须同时写出主窗口 ${requestedTimeWindowPeriod} 和对比窗口 ${comparisonTimeWindowPeriod}，并明确说明两者的变化或对比结论。${
          requestedTimeWindowAnchorMode === "analysis_year" && requestedTimeWindowLabel && comparisonTimeWindowLabel
            ? `若是按当前数据年份口径锚定，需明确说明“${requestedTimeWindowLabel}”和“${comparisonTimeWindowLabel}”分别对应的绝对区间。`
            : ""
        }`
      : "";
  if (routeCode === ROUTE_DECISION_CODES.DIRECT_ANSWER) {
    if (Boolean(outputContext?.overall_period_compare_mode)) {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：本轮是时间窗口对比问题，必须同时给出主窗口与对比窗口的结论，并至少给出一项变化结果（金额或销量）。${compareInstructionText}`;
    }
    if (hospitalMonthlyDetailMode) {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题要求医院逐月明细时，优先按月份组织医院表现要点，覆盖当前分析区间并突出关键波动。${timeWindowInstructionText}`;
    }
    if (productHospitalDetailMode) {
      const listConstraint =
        (toolResultRowCountValue || productHospitalHospitalCountValue) >= 3
          ? "若医院条目不少于3家，至少列出Top3医院贡献点（不要只给Top1）。"
          : "若医院条目不足3家，按实际可见条目逐条说明。";
      const contradictionConstraint =
        toolResultCoverageCode === "full" && (toolResultRowCountValue || productHospitalHospitalCountValue) > 0
          ? "当前工具结果已完整覆盖该产品的医院贡献，不得写成“数据不足/未提供细分明细/无法判断”。"
          : "";
      const zeroResultConstraint =
        toolResultCoverageCode === "full" && Boolean(outputContext?.product_hospital_zero_result_mode)
          ? "当前工具结果明确为0贡献，必须写成“当前范围内该产品医院贡献为0/未产生贡献”，不得写成“缺数据”。"
          : "";
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题要求“某产品由哪些医院贡献”时，优先给出该产品对应的医院贡献结构与重点医院结论。${listConstraint}${contradictionConstraint}${zeroResultConstraint}${timeWindowInstructionText}`;
    }
    if (hospitalNamedDetailMode) {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题点名具体医院时，优先逐条覆盖命名医院结论与依据，避免退化为泛医院Top摘要。${timeWindowInstructionText}`;
    }
    if (productFullDetailMode) {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题要求全产品分析时，优先覆盖当前可见产品范围并明确产品盘点口径。${timeWindowInstructionText}`;
    }
    if (productNamedDetailMode) {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题点名具体产品时，优先逐条覆盖命名产品的结论与依据；无销售记录产品使用“本期无销售记录/贡献为0”的业务表达。${timeWindowInstructionText}`;
    }
    if (trimString(outputContext?.tool_route_type) === "overall_time_window") {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题是在明确时间窗口内询问整体销售或趋势时，必须围绕该时间区间直接回答，不要退回到全年汇总口径。若存在月度行数据，优先概括该时间区间内的关键月份变化。${timeWindowInstructionText}`;
    }
    return timeWindowInstructionText ? `${OUTPUT_POLICY_DIRECT_ANSWER}\n${timeWindowInstructionText}` : OUTPUT_POLICY_DIRECT_ANSWER;
  }

  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER) {
    if (Boolean(outputContext?.overall_period_compare_mode)) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：时间窗口对比场景下，先给主窗口与对比窗口的方向性结论，再说明当前边界，且必须写出两个绝对时间区间。${compareInstructionText}`;
    }
    if (hospitalMonthlyDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：医院逐月明细场景下，先给逐月可得结论，再用业务口吻说明当前逐月覆盖边界。${timeWindowInstructionText}`;
    }
    if (productHospitalDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：产品×医院交叉场景下，先给该产品的医院贡献结论，再说明当前医院覆盖范围（${productHospitalSupportCode || "partial"}）。${timeWindowInstructionText}`;
    }
    if (hospitalNamedDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：命名医院场景下，先给可得结论，再说明当前已覆盖命名医院范围（${hospitalNamedSupportCode || "partial"}）。${timeWindowInstructionText}`;
    }
    if (productFullDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：全产品分析场景下，先给当前可得产品结论，再说明当前覆盖范围（${productFullSupportCode || "partial"}）。${timeWindowInstructionText}`;
    }
    if (productNamedDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：命名产品场景下，先给可得结论，再说明当前已覆盖命名产品范围（${productNamedSupportCode || "partial"}）。${timeWindowInstructionText}`;
    }
    return timeWindowInstructionText ? `${OUTPUT_POLICY_BOUNDED_ANSWER}\n${timeWindowInstructionText}` : OUTPUT_POLICY_BOUNDED_ANSWER;
  }

  if (routeCode === ROUTE_DECISION_CODES.REFUSE) {
    return OUTPUT_POLICY_REFUSE;
  }

  return "";
}

export function buildRefuseReplyTemplate(_outputContext) {
  return [
    "这个问题不属于我当前的医药销售业务分析职责范围。",
    "你可以问：",
    "- 本月整体业绩和达成率的核心变化是什么？",
    "- 当前哪个产品最值得优先推进，原因是什么？",
    "- 近三个月医院表现有哪些关键波动，对应风险和机会在哪里？",
  ].join("\n");
}

export function normalizeOutputReply(reply) {
  return trimString(reply).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

export function buildGeminiPayload(message, businessSnapshot, outputContext) {
  const systemInstructionText = buildAssistantRoleSystemInstruction(ASSISTANT_ROLE_DEFINITION);
  const outputInstructionText = buildOutputInstructionText(outputContext);
  const mergedSystemInstructionText = outputInstructionText
    ? `${systemInstructionText}\n\n${outputInstructionText}`
    : systemInstructionText;
  const normalizedSnapshot = normalizeBusinessSnapshot(businessSnapshot);
  const userPromptText = [
    "以下是当前业务快照（business_snapshot），请将其作为本轮回答的事实依据。",
    "如果快照中的数据不足，请明确说明“数据不足”，不要编造。",
    trimString(outputContext?.requested_time_window_period)
      ? `本轮实际时间区间：${trimString(outputContext?.requested_time_window_period)}。不得将其偷换成 analysis_range 尾部月份。`
      : "",
    trimString(outputContext?.comparison_time_window_period)
      ? `本轮对比时间区间：${trimString(outputContext?.comparison_time_window_period)}。`
      : "",
    "",
    "business_snapshot:",
    JSON.stringify(normalizedSnapshot, null, 2),
    "",
    `用户问题：${message}`,
  ].join("\n");
  return {
    systemInstruction: {
      parts: [{ text: mergedSystemInstructionText }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPromptText }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
    },
  };
}

export function buildGeminiPayloadFromToolResult(message, toolResult, outputContext) {
  const systemInstructionText = buildAssistantRoleSystemInstruction(ASSISTANT_ROLE_DEFINITION);
  const outputInstructionText = buildOutputInstructionText(outputContext);
  const mergedSystemInstructionText = outputInstructionText
    ? `${systemInstructionText}\n\n${outputInstructionText}\n\n请严格以 tool_result 为本轮回答的主要事实来源，不要被 seed context 或既往快照覆盖。`
    : `${systemInstructionText}\n\n请严格以 tool_result 为本轮回答的主要事实来源，不要被 seed context 或既往快照覆盖。`;
  const toolResultPromptText = [
    "以下是当前问题对应的工具执行结果（tool_result），请将其作为本轮回答的主事实依据。",
    "如 tool_result.coverage=full 且 rows 非空，请直接给出明确结论，不要写成“数据不足”。",
    "如 tool_result.coverage=full 且 rows 为空，请直接说明当前范围内贡献为0/未产生贡献。",
    trimString(outputContext?.requested_time_window_period)
      ? `本轮实际时间区间：${trimString(outputContext?.requested_time_window_period)}。不得将其偷换成 analysis_range 尾部月份。`
      : "",
    trimString(outputContext?.comparison_time_window_period)
      ? `本轮对比时间区间：${trimString(outputContext?.comparison_time_window_period)}。若是对比问题，必须同时基于主窗口和对比窗口回答。`
      : "",
    "",
    "tool_result:",
    JSON.stringify(toolResult ?? {}, null, 2),
    "",
    `用户问题：${message}`,
  ].join("\n");
  return {
    systemInstruction: {
      parts: [{ text: mergedSystemInstructionText }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: toolResultPromptText }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
    },
  };
}

export function extractGeminiReply(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map((part) => trimString(part?.text))
      .filter((item) => item)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

export async function requestGeminiGenerateContent(payload, env, requestId = "", breadcrumbPrefix = "call") {
  const model = sanitizeModelName(getEnvString(env, "GEMINI_MODEL"));
  const apiKey = getEnvString(env, "GEMINI_API_KEY");
  if (!apiKey) {
    logGeminiCallBreadcrumb(breadcrumbPrefix, "result", {
      requestId: trimString(requestId),
      model,
      ok: false,
      status: 500,
      error_code: CHAT_ERROR_CODES.CONFIG_MISSING,
    });
    return {
      ok: false,
      code: CHAT_ERROR_CODES.CONFIG_MISSING,
      message: "服务端未配置 GEMINI_API_KEY。",
      status: 500,
      model,
    };
  }

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  logGeminiCallBreadcrumb(breadcrumbPrefix, "start", {
    requestId: trimString(requestId),
    model,
  });

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      GEMINI_UPSTREAM_TIMEOUT_MS,
    );

    const responsePayload = await parseJsonSafe(response);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        logGeminiCallBreadcrumb(breadcrumbPrefix, "result", {
          requestId: trimString(requestId),
          model,
          ok: false,
          status: response.status,
          error_code: CHAT_ERROR_CODES.UPSTREAM_AUTH_ERROR,
        });
        return {
          ok: false,
          code: CHAT_ERROR_CODES.UPSTREAM_AUTH_ERROR,
          message: "Gemini Key 无效或无权限，请检查服务端密钥配置。",
          status: 502,
          model,
          payload: responsePayload,
        };
      }
      if (response.status === 429) {
        logGeminiCallBreadcrumb(breadcrumbPrefix, "result", {
          requestId: trimString(requestId),
          model,
          ok: false,
          status: response.status,
          error_code: CHAT_ERROR_CODES.UPSTREAM_RATE_LIMIT,
        });
        return {
          ok: false,
          code: CHAT_ERROR_CODES.UPSTREAM_RATE_LIMIT,
          message: "Gemini 请求过于频繁或配额受限，请稍后重试。",
          status: 429,
          model,
          payload: responsePayload,
        };
      }
      const upstreamMessage = trimString(responsePayload?.error?.message);
      logGeminiCallBreadcrumb(breadcrumbPrefix, "result", {
        requestId: trimString(requestId),
        model,
        ok: false,
        status: response.status,
        error_code: CHAT_ERROR_CODES.UPSTREAM_ERROR,
      });
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UPSTREAM_ERROR,
        message: upstreamMessage || `Gemini 服务异常（HTTP ${response.status}）。`,
        status: response.status >= 500 ? 502 : 400,
        model,
        payload: responsePayload,
      };
    }

    logGeminiCallBreadcrumb(breadcrumbPrefix, "result", {
      requestId: trimString(requestId),
      model,
      ok: true,
      status: response.status,
      error_code: "",
    });
    return {
      ok: true,
      model,
      payload: responsePayload,
      status: response.status,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logGeminiCallBreadcrumb(breadcrumbPrefix, "result", {
        requestId: trimString(requestId),
        model,
        ok: false,
        status: 504,
        error_code: CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
      });
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
        message: "Gemini 请求超时，请稍后重试。",
        status: 504,
        model,
      };
    }
    logGeminiCallBreadcrumb(breadcrumbPrefix, "result", {
      requestId: trimString(requestId),
      model,
      ok: false,
      status: 502,
      error_code: CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
    });
    return {
      ok: false,
      code: CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
      message: `Gemini 网络请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      status: 502,
      model,
    };
  }
}

export async function callGemini(message, businessSnapshot, outputContext, env, requestId = "") {
  const response = await requestGeminiGenerateContent(
    buildGeminiPayload(message, businessSnapshot, outputContext),
    env,
    requestId,
    "call",
  );
  if (!response.ok) {
    return response;
  }
  const reply = extractGeminiReply(response.payload);
  if (!reply) {
    logGeminiCallBreadcrumb("call", "result", {
      requestId: trimString(requestId),
      model: response.model,
      ok: false,
      status: 502,
      error_code: CHAT_ERROR_CODES.EMPTY_REPLY,
    });
    return {
      ok: false,
      code: CHAT_ERROR_CODES.EMPTY_REPLY,
      message: "Gemini 返回为空，请稍后重试。",
      status: 502,
      model: response.model,
    };
  }
  return {
    ok: true,
    reply,
    model: response.model,
  };
}

export async function callGeminiWithToolResult(message, toolResult, outputContext, env, requestId = "") {
  const response = await requestGeminiGenerateContent(
    buildGeminiPayloadFromToolResult(message, toolResult, outputContext),
    env,
    requestId,
    "direct",
  );
  if (!response.ok) {
    return response;
  }
  const reply = extractGeminiReply(response.payload);
  if (!reply) {
    logGeminiCallBreadcrumb("direct", "result", {
      requestId: trimString(requestId),
      model: response.model,
      ok: false,
      status: 502,
      error_code: CHAT_ERROR_CODES.EMPTY_REPLY,
    });
    return {
      ok: false,
      code: CHAT_ERROR_CODES.EMPTY_REPLY,
      message: "Gemini 返回为空，请稍后重试。",
      status: 502,
      model: response.model,
    };
  }
  return {
    ok: true,
    reply,
    model: response.model,
  };
}
