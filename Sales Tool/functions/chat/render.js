import { CHAT_RESPONSE_ACTIONS, buildBusinessIntent, normalizeChatMode, resolveAnswerStyle } from "./contracts.js";
import { QUESTION_JUDGMENT_CODES, ROUTE_DECISION_CODES, normalizeNumericValue, trimString } from "./shared.js";

function getReplySummary(replyText) {
  const normalized = trimString(replyText);
  if (!normalized) {
    return "";
  }
  const firstLine = normalized
    .split(/\n+/)
    .map((item) => trimString(item))
    .find((item) => item);
  if (!firstLine) {
    return "";
  }
  const sentenceMatched = firstLine.match(/^(.+?[。！？!?])/u);
  if (sentenceMatched) {
    return trimString(sentenceMatched[1]);
  }
  return firstLine;
}

function createEvidenceItem(label, value, insight = "") {
  const safeLabel = trimString(label);
  const safeValue = trimString(value);
  const safeInsight = trimString(insight);
  if (!safeLabel || !safeValue) {
    return null;
  }
  return {
    label: safeLabel,
    value: safeValue,
    insight: safeInsight,
  };
}

function pushEvidenceItem(bucket, label, value, insight = "") {
  const item = createEvidenceItem(label, value, insight);
  if (!item) {
    return;
  }
  const existed = bucket.some((entry) => entry.label === item.label && entry.value === item.value);
  if (!existed) {
    bucket.push(item);
  }
}

function buildRowValueText(row) {
  const salesAmount = trimString(row?.sales_amount);
  const salesVolume = trimString(row?.sales_volume);
  const salesShare = trimString(row?.sales_share);
  const amount = trimString(typeof row?.amount === "number" ? String(row.amount) : row?.amount);
  const quantity = trimString(typeof row?.quantity === "number" ? String(row.quantity) : row?.quantity);
  if (salesAmount && salesVolume) {
    return `${salesAmount} / ${salesVolume}`;
  }
  if (salesAmount && salesShare) {
    return `${salesAmount} / 占比${salesShare}`;
  }
  if (salesAmount) {
    return salesAmount;
  }
  if (salesVolume) {
    return salesVolume;
  }
  if (amount && quantity) {
    return `${amount} / ${quantity}`;
  }
  if (amount) {
    return amount;
  }
  if (quantity) {
    return quantity;
  }
  const changeValue = trimString(row?.change_value);
  if (changeValue) {
    return changeValue;
  }
  return "";
}

function buildRowInsightText(row) {
  const changeMetric = trimString(row?.change_metric);
  const changeValue = trimString(row?.change_value);
  if (changeMetric && changeValue) {
    return `${changeMetric}${changeValue}`;
  }
  const period = trimString(row?.period || row?.ym);
  if (period) {
    return `时间点：${period}`;
  }
  return "";
}

function collectToolSummaryEvidence(toolResult, outputContext, bucket) {
  const summary = toolResult?.summary && typeof toolResult.summary === "object" ? toolResult.summary : {};
  const primarySummary = summary?.primary && typeof summary.primary === "object" ? summary.primary : null;
  const comparisonSummary = summary?.comparison && typeof summary.comparison === "object" ? summary.comparison : null;
  const deltaSummary = summary?.delta && typeof summary.delta === "object" ? summary.delta : null;

  if (primarySummary || comparisonSummary) {
    pushEvidenceItem(bucket, "主窗口销售额", trimString(primarySummary?.sales_amount), trimString(outputContext?.tool_result_primary_period));
    pushEvidenceItem(bucket, "主窗口销量", trimString(primarySummary?.sales_volume), trimString(outputContext?.tool_result_primary_period));
    pushEvidenceItem(bucket, "对比窗口销售额", trimString(comparisonSummary?.sales_amount), trimString(outputContext?.tool_result_comparison_period));
    pushEvidenceItem(bucket, "对比窗口销量", trimString(comparisonSummary?.sales_volume), trimString(outputContext?.tool_result_comparison_period));
    pushEvidenceItem(bucket, "销售额变化", trimString(deltaSummary?.sales_amount_change), "主窗口对比对比窗口");
    pushEvidenceItem(bucket, "销量变化", trimString(deltaSummary?.sales_volume_change), "主窗口对比对比窗口");
    return;
  }

  pushEvidenceItem(bucket, "销售额", trimString(summary?.sales_amount), trimString(outputContext?.tool_result_primary_period));
  pushEvidenceItem(bucket, "达成率", trimString(summary?.amount_achievement), "当前时间范围");
  pushEvidenceItem(bucket, "销量", trimString(summary?.sales_volume), trimString(outputContext?.tool_result_primary_period));

  const keySignals = Array.isArray(summary?.key_business_signals) ? summary.key_business_signals : [];
  keySignals.slice(0, 2).forEach((signal, index) => {
    pushEvidenceItem(bucket, `业务信号${index + 1}`, trimString(signal), "");
  });
}

function collectToolRowsEvidence(toolResult, bucket) {
  const rows = Array.isArray(toolResult?.rows) ? toolResult.rows : [];
  rows.slice(0, 3).forEach((row, index) => {
    const label =
      trimString(row?.hospital_name) ||
      trimString(row?.product_name) ||
      trimString(row?.period) ||
      trimString(row?.ym) ||
      `条目${index + 1}`;
    pushEvidenceItem(bucket, label, buildRowValueText(row), buildRowInsightText(row));
  });
}

function collectSnapshotRowsEvidence(questionJudgment, businessSnapshot, bucket) {
  const snapshot = businessSnapshot && typeof businessSnapshot === "object" ? businessSnapshot : {};
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  let rows = [];
  if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    rows = Array.isArray(snapshot?.product_performance) ? snapshot.product_performance : [];
  } else if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    rows = Array.isArray(snapshot?.hospital_performance) ? snapshot.hospital_performance : [];
  } else {
    rows = Array.isArray(snapshot?.recent_trends) ? snapshot.recent_trends : [];
  }
  rows.slice(0, 3).forEach((row, index) => {
    const label =
      trimString(row?.product_name) ||
      trimString(row?.hospital_name) ||
      trimString(row?.period) ||
      trimString(row?.ym) ||
      `条目${index + 1}`;
    const value =
      trimString(row?.sales_amount) ||
      trimString(row?.sales_volume) ||
      trimString(row?.change_value) ||
      trimString(row?.sales_share);
    const insight =
      trimString(row?.change_metric && row?.change_value ? `${row.change_metric}${row.change_value}` : "") ||
      trimString(row?.latest_key_change) ||
      "";
    pushEvidenceItem(bucket, label, value, insight);
  });
}

function buildBoundaries({
  routeDecision,
  outputContext,
  toolResult,
  requestedProducts,
  requestedHospitals,
} = {}) {
  const boundaries = [];
  const routeCode = trimString(routeDecision?.route?.code) || trimString(outputContext?.route_code);
  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER) {
    boundaries.push("当前回答基于现有口径给出方向性结论，暂不支持更细颗粒度拆解。");
  }
  const timeWindowCoverageCode = trimString(outputContext?.time_window_coverage_code);
  const availableTimeWindowPeriod = trimString(outputContext?.available_time_window_period);
  const requestedTimeWindowPeriod = trimString(outputContext?.requested_time_window_period);
  if ((timeWindowCoverageCode === "partial" || timeWindowCoverageCode === "none") && requestedTimeWindowPeriod) {
    boundaries.push(
      availableTimeWindowPeriod
        ? `请求时间范围为 ${requestedTimeWindowPeriod}，当前可用数据范围为 ${availableTimeWindowPeriod}。`
        : `请求时间范围为 ${requestedTimeWindowPeriod}，当前没有完整覆盖该时间范围的数据。`,
    );
  }

  const coverageMessage = trimString(toolResult?.coverage?.message);
  if (coverageMessage) {
    boundaries.push(coverageMessage);
  }

  const unmatchedProducts = Array.isArray(toolResult?.unmatched_entities?.products)
    ? toolResult.unmatched_entities.products
    : [];
  const unmatchedHospitals = Array.isArray(toolResult?.unmatched_entities?.hospitals)
    ? toolResult.unmatched_entities.hospitals
    : [];
  if (unmatchedProducts.length > 0) {
    boundaries.push(`未完全匹配的产品：${unmatchedProducts.slice(0, 3).join("、")}。`);
  }
  if (unmatchedHospitals.length > 0) {
    boundaries.push(`未完全匹配的医院：${unmatchedHospitals.slice(0, 3).join("、")}。`);
  }
  if (requestedProducts.length > 0 && trimString(outputContext?.product_named_support_code) === "partial") {
    boundaries.push("命名产品仅部分覆盖，结论以当前已命中的产品范围为准。");
  }
  if (requestedHospitals.length > 0 && trimString(outputContext?.hospital_named_support_code) === "partial") {
    boundaries.push("命名医院仅部分覆盖，结论以当前已命中的医院范围为准。");
  }
  return Array.from(new Set(boundaries.map((item) => trimString(item)).filter((item) => item))).slice(0, 4);
}

function buildRecommendedActions(questionJudgment, routeDecision, sourcePeriod) {
  const routeCode = trimString(routeDecision?.route?.code);
  if (routeCode === ROUTE_DECISION_CODES.REFUSE) {
    return [];
  }
  const dimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  if (dimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    return [
      {
        title: "复盘重点产品贡献变化，确认下轮主推优先级",
        owner: "本人",
        timeline: sourcePeriod ? `${sourcePeriod} 后续跟进` : "下次复盘前",
        metric: "销售额/贡献占比",
      },
    ];
  }
  if (dimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    return [
      {
        title: "聚焦重点医院贡献与波动，确认是否需要分层跟进",
        owner: "本人",
        timeline: sourcePeriod ? `${sourcePeriod} 后续跟进` : "下次复盘前",
        metric: "医院贡献额/销量",
      },
    ];
  }
  if (dimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY) {
    return [
      {
        title: "把当前主要风险与机会拆到产品和医院层面",
        owner: "本人",
        timeline: "本轮分析后",
        metric: "风险项/机会项闭环数",
      },
    ];
  }
  return [
    {
      title: "定位关键月份与核心驱动，判断是阶段性波动还是可延续趋势",
      owner: "本人",
      timeline: sourcePeriod ? `${sourcePeriod} 复盘` : "本轮分析后",
      metric: "销售额/达成率",
    },
  ];
}

function buildNextQuestions(questionJudgment) {
  const dimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  if (dimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    return [
      "这个产品主要由哪些医院贡献？",
      "近三个月该产品波动最大的月份是哪个？",
    ];
  }
  if (dimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    return [
      "这家医院的核心贡献产品是什么？",
      "近三个月这家医院波动最大的月份是哪个？",
    ];
  }
  if (dimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY) {
    return [
      "把当前主要风险按产品和医院拆开看。",
      "下一步最值得优先推进的动作是什么？",
    ];
  }
  return [
    "按产品拆开看这个时间段的贡献结构。",
    "按医院看这段时间的主要贡献来源。",
  ];
}

function buildHighlights(replySummary, evidence, boundaries) {
  const highlights = [];
  if (replySummary) {
    highlights.push(replySummary);
  }
  evidence.forEach((item) => {
    const text = trimString(item?.insight) || `${trimString(item?.label)}：${trimString(item?.value)}`;
    if (text && !highlights.includes(text)) {
      highlights.push(text);
    }
  });
  boundaries.forEach((item) => {
    if (item && !highlights.includes(item)) {
      highlights.push(item);
    }
  });
  return highlights.slice(0, 3);
}

function buildStructuredAnswer(answer) {
  return {
    summary: trimString(answer?.summary),
    highlights: Array.isArray(answer?.highlights) ? answer.highlights.slice(0, 6) : [],
    evidence: Array.isArray(answer?.evidence) ? answer.evidence.slice(0, 8) : [],
    risks: Array.isArray(answer?.boundaries) ? answer.boundaries.slice(0, 6) : [],
    actions: Array.isArray(answer?.actions) ? answer.actions.slice(0, 6) : [],
    nextQuestions: Array.isArray(answer?.next_questions) ? answer.next_questions.slice(0, 6) : [],
  };
}

function buildSourcePeriod(outputContext, businessSnapshot, toolResult) {
  return (
    trimString(outputContext?.requested_time_window_period) ||
    trimString(outputContext?.tool_result_primary_period) ||
    trimString(toolResult?.range?.period) ||
    trimString(businessSnapshot?.analysis_range?.period)
  );
}

function shouldDeriveStructuredAnswer(answer, routeDecision) {
  if (trimString(routeDecision?.route?.code) === ROUTE_DECISION_CODES.REFUSE) {
    return false;
  }
  if (!trimString(answer?.summary)) {
    return false;
  }
  return (
    (Array.isArray(answer?.evidence) && answer.evidence.length > 0) ||
    (Array.isArray(answer?.boundaries) && answer.boundaries.length > 0) ||
    (Array.isArray(answer?.actions) && answer.actions.length > 0) ||
    (Array.isArray(answer?.next_questions) && answer.next_questions.length > 0)
  );
}

export function buildEvidenceBundleFromToolResult({
  toolResult,
  outputContext,
  questionJudgment,
  routeDecision,
  requestedProducts = [],
  requestedHospitals = [],
} = {}) {
  const evidence = [];
  const safeToolResult = toolResult && typeof toolResult === "object" ? toolResult : {};
  collectToolSummaryEvidence(safeToolResult, outputContext, evidence);
  collectToolRowsEvidence(safeToolResult, evidence);
  return {
    source: "tool",
    source_period: buildSourcePeriod(outputContext, {}, safeToolResult),
    coverage_code: trimString(safeToolResult?.coverage?.code) || trimString(outputContext?.tool_result_coverage_code),
    evidence,
    boundaries: buildBoundaries({
      routeDecision,
      outputContext,
      toolResult: safeToolResult,
      requestedProducts,
      requestedHospitals,
    }),
    actions: buildRecommendedActions(questionJudgment, routeDecision, buildSourcePeriod(outputContext, {}, safeToolResult)),
    next_questions: buildNextQuestions(questionJudgment),
  };
}

export function buildEvidenceBundleFromSnapshot({
  businessSnapshot,
  outputContext,
  questionJudgment,
  routeDecision,
  requestedProducts = [],
  requestedHospitals = [],
} = {}) {
  const safeSnapshot = businessSnapshot && typeof businessSnapshot === "object" ? businessSnapshot : {};
  const evidence = [];
  const performanceOverview =
    safeSnapshot?.performance_overview && typeof safeSnapshot.performance_overview === "object"
      ? safeSnapshot.performance_overview
      : {};
  pushEvidenceItem(evidence, "销售额", trimString(performanceOverview?.sales_amount), trimString(safeSnapshot?.analysis_range?.period));
  pushEvidenceItem(evidence, "达成率", trimString(performanceOverview?.amount_achievement), trimString(safeSnapshot?.analysis_range?.period));
  pushEvidenceItem(evidence, "销量", trimString(performanceOverview?.sales_volume), trimString(safeSnapshot?.analysis_range?.period));
  pushEvidenceItem(evidence, "关键变化", trimString(performanceOverview?.latest_key_change), "");
  const keySignals = Array.isArray(safeSnapshot?.key_business_signals) ? safeSnapshot.key_business_signals : [];
  keySignals.slice(0, 2).forEach((signal, index) => {
    pushEvidenceItem(evidence, `业务信号${index + 1}`, trimString(signal), "");
  });
  collectSnapshotRowsEvidence(questionJudgment, safeSnapshot, evidence);
  return {
    source: "snapshot",
    source_period: buildSourcePeriod(outputContext, safeSnapshot, null),
    coverage_code: trimString(outputContext?.time_window_coverage_code) || "unknown",
    evidence,
    boundaries: buildBoundaries({
      routeDecision,
      outputContext,
      toolResult: null,
      requestedProducts,
      requestedHospitals,
    }),
    actions: buildRecommendedActions(questionJudgment, routeDecision, buildSourcePeriod(outputContext, safeSnapshot, null)),
    next_questions: buildNextQuestions(questionJudgment),
  };
}

export function buildRenderedAnswer({
  mode,
  replyText,
  evidenceBundle,
  questionJudgment,
  routeDecision,
  conversationState,
} = {}) {
  const safeMode = normalizeChatMode(mode);
  const safeBundle = evidenceBundle && typeof evidenceBundle === "object" ? evidenceBundle : {};
  const summary = getReplySummary(replyText) || trimString(replyText);
  const evidence = Array.isArray(safeBundle.evidence) ? safeBundle.evidence.slice(0, 8) : [];
  const boundaries = Array.isArray(safeBundle.boundaries) ? safeBundle.boundaries.slice(0, 6) : [];
  const actions = Array.isArray(safeBundle.actions) ? safeBundle.actions.slice(0, 6) : [];
  const nextQuestions = Array.isArray(safeBundle.next_questions) ? safeBundle.next_questions.slice(0, 6) : [];
  const answer = {
    style: resolveAnswerStyle(safeMode),
    summary,
    evidence,
    actions,
    boundaries,
    source_period: trimString(safeBundle.source_period),
    coverage_code: trimString(safeBundle.coverage_code),
    route_code: trimString(routeDecision?.route?.code),
    primary_dimension_code: trimString(questionJudgment?.primary_dimension?.code),
    next_questions: nextQuestions,
    conversation_state: conversationState && typeof conversationState === "object" ? conversationState : null,
    highlights: buildHighlights(summary, evidence, boundaries),
  };
  const structured = shouldDeriveStructuredAnswer(answer, routeDecision) ? buildStructuredAnswer(answer) : null;
  return {
    answer,
    structured,
    responseAction: structured ? CHAT_RESPONSE_ACTIONS.STRUCTURED : CHAT_RESPONSE_ACTIONS.NATURAL,
    format: structured ? "structured" : "text_fallback",
    businessIntent: buildBusinessIntent(safeMode),
    mode: safeMode,
  };
}

export function buildChatSuccessPayload({
  mode,
  replyText,
  evidenceBundle,
  questionJudgment,
  routeDecision,
  model,
  requestId,
  conversationState,
} = {}) {
  const rendered = buildRenderedAnswer({
    mode,
    replyText,
    evidenceBundle,
    questionJudgment,
    routeDecision,
    conversationState,
  });
  return {
    reply: trimString(replyText),
    surfaceReply: trimString(replyText),
    responseAction: rendered.responseAction,
    businessIntent: rendered.businessIntent,
    mode: rendered.mode,
    format: rendered.format,
    structured: rendered.structured,
    answer: rendered.answer,
    model: trimString(model),
    requestId: trimString(requestId),
  };
}
