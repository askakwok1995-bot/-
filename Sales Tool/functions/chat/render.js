import { trimString } from "./shared.js";

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
  return trimString(sentenceMatched?.[1] || firstLine);
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
  const directText = trimString(row?.text);
  if (directText) {
    return directText;
  }
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
  return trimString(row?.change_value);
}

function buildRowInsightText(row) {
  const changeMetric = trimString(row?.change_metric);
  const changeValue = trimString(row?.change_value);
  if (changeMetric && changeValue) {
    return `${changeMetric}${changeValue}`;
  }
  return trimString(row?.period || row?.ym);
}

function collectToolSummaryEvidence(toolResult, bucket) {
  const summary = toolResult?.summary && typeof toolResult.summary === "object" ? toolResult.summary : {};
  const primarySummary = summary?.primary && typeof summary.primary === "object" ? summary.primary : null;
  const comparisonSummary = summary?.comparison && typeof summary.comparison === "object" ? summary.comparison : null;
  const deltaSummary = summary?.delta && typeof summary.delta === "object" ? summary.delta : null;

  if (primarySummary || comparisonSummary) {
    pushEvidenceItem(bucket, "主窗口销售额", trimString(primarySummary?.sales_amount), trimString(toolResult?.range?.period));
    pushEvidenceItem(bucket, "主窗口销量", trimString(primarySummary?.sales_volume), trimString(toolResult?.range?.period));
    pushEvidenceItem(bucket, "对比窗口销售额", trimString(comparisonSummary?.sales_amount), trimString(toolResult?.comparison_range?.period));
    pushEvidenceItem(bucket, "对比窗口销量", trimString(comparisonSummary?.sales_volume), trimString(toolResult?.comparison_range?.period));
    pushEvidenceItem(bucket, "销售额变化", trimString(deltaSummary?.sales_amount_change));
    pushEvidenceItem(bucket, "销量变化", trimString(deltaSummary?.sales_volume_change));
    return;
  }

  pushEvidenceItem(bucket, "销售额", trimString(summary?.sales_amount), trimString(toolResult?.range?.period));
  pushEvidenceItem(bucket, "金额达成率", trimString(summary?.amount_achievement), trimString(toolResult?.range?.period));
  pushEvidenceItem(bucket, "数量达成率", trimString(summary?.quantity_achievement), trimString(toolResult?.range?.period));
  pushEvidenceItem(bucket, "销量", trimString(summary?.sales_volume), trimString(toolResult?.range?.period));

  const keySignals = Array.isArray(summary?.key_business_signals) ? summary.key_business_signals : [];
  keySignals.slice(0, 2).forEach((signal, index) => {
    pushEvidenceItem(bucket, `业务信号${index + 1}`, trimString(signal));
  });
}

function collectToolRowsEvidence(toolResult, bucket) {
  const rows = Array.isArray(toolResult?.rows) ? toolResult.rows : [];
  rows.slice(0, 3).forEach((row, index) => {
    const label =
      trimString(row?.row_label) ||
      trimString(row?.hospital_name) ||
      trimString(row?.product_name) ||
      trimString(row?.period) ||
      trimString(row?.ym) ||
      `条目${index + 1}`;
    pushEvidenceItem(bucket, label, buildRowValueText(row), buildRowInsightText(row));
  });
}

function buildRecommendedActions(questionType, sourcePeriod) {
  if (questionType === "diagnosis" || questionType === "why") {
    return [
      {
        title: "继续拆分主要下滑驱动并确认是否为阶段性波动",
        timeline: sourcePeriod ? `${sourcePeriod} 后续复盘` : "下一轮复盘",
        metric: "关键驱动项变化",
      },
    ];
  }
  if (questionType === "contribution") {
    return [
      {
        title: "聚焦主要贡献来源并核对集中度变化",
        timeline: sourcePeriod ? `${sourcePeriod} 后续跟进` : "下一轮复盘",
        metric: "贡献额/贡献占比",
      },
    ];
  }
  return [
    {
      title: "围绕重点对象继续下钻，确认趋势是否可延续",
      timeline: sourcePeriod ? `${sourcePeriod} 后续跟进` : "下一轮复盘",
      metric: "销售额/销量",
    },
  ];
}

export function buildEvidenceBundleFromToolResult({
  toolResult,
  plannerState = null,
  toolRuntimeState = null,
} = {}) {
  const evidence = [];
  const safeToolResult = toolResult && typeof toolResult === "object" ? toolResult : {};
  collectToolSummaryEvidence(safeToolResult, evidence);
  collectToolRowsEvidence(safeToolResult, evidence);
  const questionType = trimString(plannerState?.question_type) || "overview";
  const sourcePeriod =
    trimString(safeToolResult?.range?.period) ||
    trimString(safeToolResult?.comparison_range?.period);
  return {
    source_period: sourcePeriod,
    question_type: questionType,
    evidence_types: Array.isArray(toolRuntimeState?.evidence_types_completed)
      ? toolRuntimeState.evidence_types_completed.map((item) => trimString(item)).filter((item) => item)
      : [],
    missing_evidence_types: Array.isArray(plannerState?.missing_evidence_types)
      ? plannerState.missing_evidence_types.map((item) => trimString(item)).filter((item) => item)
      : [],
    analysis_confidence: trimString(plannerState?.analysis_confidence) || "medium",
    evidence,
    actions: buildRecommendedActions(questionType, sourcePeriod),
  };
}

export function buildChatSuccessPayload({
  replyText,
  evidenceBundle,
  model,
  requestId,
  conversationState,
} = {}) {
  const safeBundle = evidenceBundle && typeof evidenceBundle === "object" ? evidenceBundle : {};
  return {
    reply: trimString(replyText),
    answer: {
      summary: getReplySummary(replyText) || trimString(replyText),
      evidence: Array.isArray(safeBundle.evidence) ? safeBundle.evidence.slice(0, 8) : [],
      actions: Array.isArray(safeBundle.actions) ? safeBundle.actions.slice(0, 4) : [],
      source_period: trimString(safeBundle.source_period),
      question_type: trimString(safeBundle.question_type) || "overview",
      evidence_types: Array.isArray(safeBundle.evidence_types)
        ? safeBundle.evidence_types.map((item) => trimString(item)).filter((item) => item)
        : [],
      missing_evidence_types: Array.isArray(safeBundle.missing_evidence_types)
        ? safeBundle.missing_evidence_types.map((item) => trimString(item)).filter((item) => item)
        : [],
      analysis_confidence: trimString(safeBundle.analysis_confidence) || "medium",
      conversation_state: conversationState && typeof conversationState === "object" ? conversationState : null,
    },
    model: trimString(model),
    requestId: trimString(requestId),
  };
}
