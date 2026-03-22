import {
  ASSISTANT_ROLE_DEFINITION,
  CHAT_ERROR_CODES,
  buildAssistantRoleSystemInstruction,
  trimString,
} from "../chat/shared.js";
import { normalizeConversationState } from "../chat/conversation-state.js";
import { extractGeminiReply, requestGeminiGenerateContent } from "../chat/output.js";
import { syncConversationStateWithSnapshot } from "./chat-followup.js";

const DEMO_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const DEMO_RATE_LIMIT_MAX_REQUESTS = 6;
const demoRateLimitBuckets = new Map();

function mapHistoryRoleToGeminiRole(role) {
  return trimString(role) === "assistant" ? "model" : "user";
}

function cleanupDemoRateLimitBuckets(nowMs = Date.now()) {
  for (const [key, bucket] of demoRateLimitBuckets.entries()) {
    if (!bucket || !Number.isFinite(bucket.resetAtMs) || bucket.resetAtMs <= nowMs) {
      demoRateLimitBuckets.delete(key);
    }
  }
}

function resolveDemoRateLimitFingerprint(request) {
  const cfIp = trimString(request?.headers?.get("cf-connecting-ip"));
  if (cfIp) {
    return `ip:${cfIp}`;
  }

  const forwardedFor = trimString(request?.headers?.get("x-forwarded-for"));
  if (forwardedFor) {
    const firstForwardedIp = trimString(forwardedFor.split(",")[0]);
    if (firstForwardedIp) {
      return `xff:${firstForwardedIp}`;
    }
  }

  const userAgent = trimString(request?.headers?.get("user-agent"));
  if (userAgent) {
    return `ua:${userAgent}`;
  }

  return "anonymous";
}

export function consumeDemoRateLimit(request) {
  const nowMs = Date.now();
  cleanupDemoRateLimitBuckets(nowMs);
  const key = resolveDemoRateLimitFingerprint(request);
  const existingBucket = demoRateLimitBuckets.get(key);
  const bucket =
    existingBucket && Number.isFinite(existingBucket.resetAtMs) && existingBucket.resetAtMs > nowMs
      ? existingBucket
      : {
          count: 0,
          resetAtMs: nowMs + DEMO_RATE_LIMIT_WINDOW_MS,
        };

  if (bucket.count >= DEMO_RATE_LIMIT_MAX_REQUESTS) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000)),
    };
  }

  bucket.count += 1;
  demoRateLimitBuckets.set(key, bucket);
  return {
    ok: true,
    remaining: Math.max(0, DEMO_RATE_LIMIT_MAX_REQUESTS - bucket.count),
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000)),
  };
}

function pushEvidenceItem(bucket, label, value, insight = "") {
  const safeLabel = trimString(label);
  const safeValue = trimString(value);
  if (!safeLabel || !safeValue) {
    return;
  }

  const safeInsight = trimString(insight);
  const duplicated = bucket.some((item) => item.label === safeLabel && item.value === safeValue);
  if (duplicated) {
    return;
  }

  bucket.push({
    label: safeLabel,
    value: safeValue,
    insight: safeInsight,
  });
}

function buildSnapshotRowValue(row) {
  const safeRow = row && typeof row === "object" ? row : {};
  return (
    trimString(safeRow.sales_amount) ||
    trimString(safeRow.amount_target) ||
    trimString(safeRow.sales_volume) ||
    trimString(safeRow.quantity_target) ||
    trimString(safeRow.change_value)
  );
}

function buildSnapshotRowInsight(row) {
  const safeRow = row && typeof row === "object" ? row : {};
  const changeMetric = trimString(safeRow.change_metric);
  const changeValue = trimString(safeRow.change_value);
  if (changeMetric && changeValue) {
    return `${changeMetric}${changeValue}`;
  }
  return trimString(safeRow.amount_achievement) || trimString(safeRow.sales_share) || trimString(safeRow.period);
}

function inferDemoQuestionType(message) {
  const safeMessage = trimString(message);
  if (!safeMessage) {
    return "overview";
  }
  if (/(报告|汇报|总结|复盘)/u.test(safeMessage)) {
    return "report";
  }
  if (/(趋势|环比|同比|变化|波动)/u.test(safeMessage)) {
    return "trend";
  }
  if (/(风险|机会|异常|原因|为什么|诊断)/u.test(safeMessage)) {
    return "diagnosis";
  }
  return "overview";
}

function buildDemoRequiredEvidenceTypes(questionType) {
  if (questionType === "trend") {
    return ["aggregate", "timeseries"];
  }
  if (questionType === "report" || questionType === "diagnosis") {
    return ["aggregate", "timeseries", "breakdown"];
  }
  return ["aggregate"];
}

function inferDemoAnalysisConfidence(evidenceTypes, missingEvidenceTypes) {
  if (!Array.isArray(evidenceTypes) || evidenceTypes.length === 0) {
    return "low";
  }
  if (Array.isArray(missingEvidenceTypes) && missingEvidenceTypes.length > 0) {
    return evidenceTypes.length >= 2 ? "medium" : "low";
  }
  return evidenceTypes.length >= 2 ? "high" : "medium";
}

function buildDemoSnapshotActions(snapshot, sourcePeriod) {
  const safeSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
  const periodText = trimString(sourcePeriod);
  const actions = [];

  (Array.isArray(safeSnapshot.opportunity_hints) ? safeSnapshot.opportunity_hints : []).slice(0, 2).forEach((item) => {
    const title = trimString(item);
    if (!title) {
      return;
    }
    actions.push({
      title,
      timeline: periodText ? `${periodText} 后续跟进` : "下一轮跟进",
      metric: "机会线索",
    });
  });

  (Array.isArray(safeSnapshot.risk_alerts) ? safeSnapshot.risk_alerts : []).slice(0, 1).forEach((item) => {
    const title = trimString(item);
    if (!title) {
      return;
    }
    actions.push({
      title,
      timeline: periodText ? `${periodText} 重点复盘` : "下一轮复盘",
      metric: "风险信号",
    });
  });

  return actions.slice(0, 3);
}

function buildDemoSnapshotEvidenceBundle(snapshot, message) {
  const safeSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
  const overview =
    safeSnapshot.performance_overview && typeof safeSnapshot.performance_overview === "object"
      ? safeSnapshot.performance_overview
      : {};
  const sourcePeriod = trimString(safeSnapshot.analysis_range?.period);
  const questionType = inferDemoQuestionType(message);
  const evidence = [];
  const evidenceTypes = [];

  pushEvidenceItem(evidence, "销售额", trimString(overview.sales_amount), sourcePeriod);
  pushEvidenceItem(evidence, "金额目标", trimString(overview.amount_target), sourcePeriod);
  pushEvidenceItem(evidence, "金额达成率", trimString(overview.amount_achievement), trimString(overview.latest_key_change));
  pushEvidenceItem(evidence, "销量", trimString(overview.sales_volume), sourcePeriod);
  pushEvidenceItem(evidence, "数量达成率", trimString(overview.quantity_achievement), sourcePeriod);
  if (evidence.length > 0) {
    evidenceTypes.push("aggregate");
  }

  (Array.isArray(safeSnapshot.key_business_signals) ? safeSnapshot.key_business_signals : []).slice(0, 2).forEach((item, index) => {
    pushEvidenceItem(evidence, `业务信号${index + 1}`, trimString(item), sourcePeriod);
  });

  const breakdownRows = [
    ...(Array.isArray(safeSnapshot.product_performance) ? safeSnapshot.product_performance : []).slice(0, 2),
    ...(Array.isArray(safeSnapshot.hospital_performance) ? safeSnapshot.hospital_performance : []).slice(0, 2),
  ];
  breakdownRows.forEach((row, index) => {
    const label =
      trimString(row?.product_name) ||
      trimString(row?.hospital_name) ||
      trimString(row?.name) ||
      `对象${index + 1}`;
    pushEvidenceItem(evidence, label, buildSnapshotRowValue(row), buildSnapshotRowInsight(row));
  });
  if (breakdownRows.length > 0) {
    evidenceTypes.push("breakdown");
  }

  const recentTrends = Array.isArray(safeSnapshot.recent_trends) ? safeSnapshot.recent_trends : [];
  recentTrends.slice(-2).forEach((row) => {
    const period = trimString(row?.period);
    pushEvidenceItem(
      evidence,
      period || "最近趋势",
      trimString(row?.sales_amount) || trimString(row?.sales_volume),
      trimString(row?.amount_mom),
    );
  });
  if (recentTrends.length > 0) {
    evidenceTypes.push("timeseries");
  }

  const requiredEvidenceTypes = buildDemoRequiredEvidenceTypes(questionType);
  const missingEvidenceTypes = requiredEvidenceTypes.filter((type) => !evidenceTypes.includes(type));
  return {
    source_period: sourcePeriod,
    question_type: questionType,
    evidence_types: evidenceTypes,
    missing_evidence_types: missingEvidenceTypes,
    analysis_confidence: inferDemoAnalysisConfidence(evidenceTypes, missingEvidenceTypes),
    evidence: evidence.slice(0, 8),
    actions: buildDemoSnapshotActions(safeSnapshot, sourcePeriod),
  };
}

function buildDemoSnapshotSeedPrompt(message, businessSnapshot, conversationState) {
  const promptSections = [
    "当前工作台模式：demo（模拟数据）。",
    "你只能依据下面的 business_snapshot 和对话上下文作答，不要声称访问了数据库、Supabase、真实账号或更多后台数据。",
    "不要在每条回答前重复提醒这是演示模式；只在信息边界相关时自然说明即可。",
  ];

  const sourcePeriod = trimString(businessSnapshot?.analysis_range?.period);
  if (sourcePeriod) {
    promptSections.push(`当前分析区间：${sourcePeriod}。`);
  }

  const safeConversationState = normalizeConversationState(conversationState);
  const hasConversationState =
    trimString(safeConversationState.primary_dimension_code) ||
    trimString(safeConversationState.source_period) ||
    safeConversationState.entity_scope.products.length > 0 ||
    safeConversationState.entity_scope.hospitals.length > 0;
  if (hasConversationState) {
    promptSections.push(`当前会话状态：${JSON.stringify(safeConversationState, null, 2)}`);
  }

  promptSections.push(`demo_business_snapshot:\n${JSON.stringify(businessSnapshot, null, 2)}`);
  promptSections.push(`用户问题：${trimString(message)}`);
  return promptSections.join("\n\n");
}

function buildDemoSnapshotContents(historyWindow, message, businessSnapshot, conversationState) {
  const contents = [];
  (Array.isArray(historyWindow) ? historyWindow : []).forEach((item) => {
    const content = trimString(item?.content);
    if (!content) {
      return;
    }
    contents.push({
      role: mapHistoryRoleToGeminiRole(item?.role),
      parts: [{ text: content }],
    });
  });
  contents.push({
    role: "user",
    parts: [{ text: buildDemoSnapshotSeedPrompt(message, businessSnapshot, conversationState) }],
  });
  return contents;
}

export async function requestDemoSnapshotChat({
  message,
  historyWindow,
  businessSnapshot,
  conversationState,
  env,
  requestId,
  deps = {},
} = {}) {
  const requestGeminiGenerateContentImpl = deps.requestGeminiGenerateContent || requestGeminiGenerateContent;
  const extractGeminiReplyImpl = deps.extractGeminiReply || extractGeminiReply;
  const systemInstruction = [
    buildAssistantRoleSystemInstruction(ASSISTANT_ROLE_DEFINITION),
    "补充约束：",
    "1. 当前处于演示工作台，所有数据都是模拟数据，绝不能推断或暗示任何真实账号、真实客户、真实产品或真实医院信息。",
    "2. 只能依据 business_snapshot 和最近对话历史作答；如果快照没有提供足够信息，要明确说明边界。",
    "3. 回答仍使用简体中文自然表达，结论先行，不输出 JSON。",
    "4. 不执行任何数据写入、删除、导出或登录态相关操作；如被要求执行，仅说明当前只能做演示分析。",
  ].join("\n");

  const geminiResponse = await requestGeminiGenerateContentImpl(
    {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: buildDemoSnapshotContents(historyWindow, message, businessSnapshot, conversationState),
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 1400,
      },
    },
    env,
    requestId,
    "demo",
  );

  if (!geminiResponse?.ok) {
    return geminiResponse;
  }

  const replyText = trimString(extractGeminiReplyImpl(geminiResponse.payload));
  if (!replyText) {
    return {
      ok: false,
      code: CHAT_ERROR_CODES.EMPTY_REPLY,
      message: "模型未返回有效回复，请稍后重试。",
      status: 502,
      model: trimString(geminiResponse.model),
    };
  }

  return {
    ok: true,
    replyText,
    model: trimString(geminiResponse.model),
    evidenceBundle: buildDemoSnapshotEvidenceBundle(businessSnapshot, message),
    conversationState: syncConversationStateWithSnapshot(conversationState, businessSnapshot),
  };
}
