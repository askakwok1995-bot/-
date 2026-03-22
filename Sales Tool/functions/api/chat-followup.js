import { CHAT_ERROR_CODES, QUESTION_JUDGMENT_CODES, trimString } from "../chat/shared.js";
import { normalizeConversationState } from "../chat/conversation-state.js";
import { buildChatSuccessPayload } from "../chat/render.js";

const TERM_EXPLAIN_CUE_RE = /(什么意思|是什么|指什么|怎么理解)/u;
const EXPLICIT_TERM_RE = /([A-Za-z0-9\u4e00-\u9fa5]{1,16}(?:覆盖率|占比|集中度|贡献|趋势))/u;
const REFERENTIAL_ENTITY_CUE_RE = /(这两家|这几个|这两个|它们|这些)/u;

function normalizeStringArray(value, maxItems = 6) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => trimString(item))
        .filter((item) => item),
    ),
  ).slice(0, maxItems);
}

function extractNamedEntitiesFromRows(rows, key) {
  return normalizeStringArray(
    (Array.isArray(rows) ? rows : []).map((row) => {
      if (!row || typeof row !== "object") {
        return "";
      }
      return trimString(row[key]);
    }),
  );
}

function extractEntityScopeFromToolResult(toolResult) {
  const safeToolResult = toolResult && typeof toolResult === "object" ? toolResult : {};
  const matchedEntities =
    safeToolResult.matched_entities && typeof safeToolResult.matched_entities === "object"
      ? safeToolResult.matched_entities
      : {};
  const rows = Array.isArray(safeToolResult.rows) ? safeToolResult.rows : [];
  const matchedProducts = normalizeStringArray(matchedEntities.products);
  const matchedHospitals = normalizeStringArray(matchedEntities.hospitals);
  return {
    products: matchedProducts.length > 0 ? matchedProducts : extractNamedEntitiesFromRows(rows, "product_name"),
    hospitals: matchedHospitals.length > 0 ? matchedHospitals : extractNamedEntitiesFromRows(rows, "hospital_name"),
  };
}

function getLatestAssistantHistoryText(historyWindow) {
  if (!Array.isArray(historyWindow) || historyWindow.length === 0) {
    return "";
  }
  for (let index = historyWindow.length - 1; index >= 0; index -= 1) {
    const item = historyWindow[index];
    if (trimString(item?.role) === "assistant") {
      return trimString(item?.content);
    }
  }
  return "";
}

function extractExplainTargetTerm(message, assistantText) {
  const safeMessage = trimString(message);
  const safeAssistantText = trimString(assistantText);
  if (!safeMessage || !safeAssistantText || !TERM_EXPLAIN_CUE_RE.test(safeMessage)) {
    return "";
  }
  const explicitMatched = safeMessage.match(EXPLICIT_TERM_RE);
  const explicitTerm = trimString(explicitMatched?.[1]);
  if (explicitTerm && safeAssistantText.includes(explicitTerm)) {
    return explicitTerm;
  }
  return "";
}

function inferExplainContextLabel(assistantText) {
  const safeText = trimString(assistantText);
  if (!safeText) {
    return "对象";
  }
  if (safeText.includes("医院")) {
    return "医院";
  }
  if (safeText.includes("产品")) {
    return "产品";
  }
  return "对象";
}

function buildExplainDefinition(term, contextLabel, sourcePeriod) {
  const safeTerm = trimString(term);
  const safeContextLabel = trimString(contextLabel) || "对象";
  const safeSourcePeriod = trimString(sourcePeriod);
  if (!safeTerm) {
    return "";
  }
  if (safeTerm.includes("月度") && safeTerm.endsWith("覆盖率")) {
    return `“${safeTerm}”通常指在${safeSourcePeriod || "当前报表区间"}内，某个${safeContextLabel}实际形成销售记录的月份数，占该区间总月份数的比例，用来判断业务覆盖是否连续。`;
  }
  if (safeTerm.endsWith("覆盖率")) {
    return `“${safeTerm}”通常指在${safeSourcePeriod || "当前报表区间"}内，实际发生销售记录的${safeContextLabel}范围，占目标${safeContextLabel}池或应覆盖范围的比例，用来判断业务覆盖完整度。`;
  }
  if (safeTerm.endsWith("占比")) {
    return `“${safeTerm}”通常指某个${safeContextLabel}或某类贡献，在整体销售额、销量或目标结构中的占比，用来判断贡献份额大小。`;
  }
  if (safeTerm.endsWith("集中度")) {
    return `“${safeTerm}”通常指销售贡献是否集中在少数${safeContextLabel}上，用来判断结构是否过于依赖头部对象。`;
  }
  if (safeTerm.endsWith("贡献")) {
    return `“${safeTerm}”通常指某个${safeContextLabel}对整体销售额、销量或增长结果的贡献程度，用来判断它对整体表现的支撑作用。`;
  }
  if (safeTerm.endsWith("趋势")) {
    return `“${safeTerm}”通常指该${safeContextLabel}在${safeSourcePeriod || "当前报表区间"}内随月份变化的方向和节奏，用来判断是在上升、回落还是波动。`;
  }
  return `“${safeTerm}”指的是当前业务分析里被单独拿出来观察的一个指标或概念，用来帮助判断${safeContextLabel}表现。`;
}

function buildExplainImportance(term, contextLabel, sourcePeriod) {
  const safeTerm = trimString(term);
  const safeContextLabel = trimString(contextLabel) || "对象";
  const safeSourcePeriod = trimString(sourcePeriod);
  if (!safeTerm) {
    return "";
  }
  if (safeTerm.includes("月度") && safeTerm.endsWith("覆盖率")) {
    return `在你刚才那段${safeContextLabel}分析里，它主要用于判断${safeContextLabel}在${safeSourcePeriod || "当前报表区间"}内的月度业务是否连续；覆盖率偏低，通常说明部分月份没有形成稳定销售或合作存在断档。`;
  }
  if (safeTerm.endsWith("覆盖率")) {
    return `在当前业务分析里，它的作用是帮助判断${safeContextLabel}覆盖是否充分；如果覆盖率偏低，通常意味着还有未被稳定触达或未持续形成销售的部分。`;
  }
  if (safeTerm.endsWith("占比")) {
    return `在当前分析里，它能帮助你快速判断哪个${safeContextLabel}是真正的主要贡献来源，以及结构是否过度集中。`;
  }
  if (safeTerm.endsWith("集中度")) {
    return `在当前分析里，它主要用来判断结构风险；集中度越高，往往意味着对少数头部${safeContextLabel}的依赖越强。`;
  }
  if (safeTerm.endsWith("贡献")) {
    return `在当前分析里，它主要用来解释为什么某些${safeContextLabel}会被单独点名，因为这些对象对整体结果的拉动更明显。`;
  }
  if (safeTerm.endsWith("趋势")) {
    return `在当前分析里，它主要帮助判断这个${safeContextLabel}的变化方向是否健康，以及增长或回落是不是持续性的。`;
  }
  return "在当前分析里，它主要是帮助你理解刚才回答中提到的关键业务概念。";
}

export function buildConversationStatePayload(incomingConversationState, questionJudgment, toolResult) {
  const baseState = normalizeConversationState(incomingConversationState);
  const nextEntityScope = extractEntityScopeFromToolResult(toolResult);
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  const shouldPreferHospitals = primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL;
  const shouldPreferProducts = primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  return {
    ...baseState,
    primary_dimension_code: primaryDimensionCode || trimString(baseState.primary_dimension_code),
    entity_scope: {
      products:
        shouldPreferHospitals && nextEntityScope.hospitals.length > 0
          ? baseState.entity_scope.products
          : nextEntityScope.products.length > 0
            ? nextEntityScope.products
            : baseState.entity_scope.products,
      hospitals:
        shouldPreferProducts && nextEntityScope.products.length > 0
          ? baseState.entity_scope.hospitals
          : nextEntityScope.hospitals.length > 0
            ? nextEntityScope.hospitals
            : baseState.entity_scope.hospitals,
    },
    source_period: trimString(toolResult?.range?.period) || trimString(baseState.source_period),
  };
}

export function syncConversationStateWithSnapshot(conversationState, businessSnapshot) {
  const baseState = normalizeConversationState(conversationState);
  const snapshotPeriod = trimString(businessSnapshot?.analysis_range?.period);
  if (!snapshotPeriod) {
    return baseState;
  }
  return {
    ...baseState,
    source_period: snapshotPeriod,
  };
}

export function buildEntityScopeFollowupContext(message, conversationState) {
  const safeMessage = trimString(message);
  if (!safeMessage || safeMessage.length > 40 || !REFERENTIAL_ENTITY_CUE_RE.test(safeMessage)) {
    return null;
  }
  const safeState = normalizeConversationState(conversationState);
  const hospitals = normalizeStringArray(safeState.entity_scope?.hospitals);
  const products = normalizeStringArray(safeState.entity_scope?.products);
  if (hospitals.length === 0 && products.length === 0) {
    return null;
  }
  const primaryDimensionCode = trimString(safeState.primary_dimension_code);
  let primaryEntityType = "";
  if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL && hospitals.length > 0) {
    primaryEntityType = "hospital";
  } else if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT && products.length > 0) {
    primaryEntityType = "product";
  } else if (hospitals.length > 0 && products.length === 0) {
    primaryEntityType = "hospital";
  } else if (products.length > 0 && hospitals.length === 0) {
    primaryEntityType = "product";
  } else if (hospitals.length > 0) {
    primaryEntityType = "hospital";
  } else {
    primaryEntityType = "product";
  }
  return {
    kind: "entity_scope_followup",
    primary_entity_type: primaryEntityType,
    hospitals,
    products,
  };
}

export function buildTermExplainPayload({
  message,
  historyWindow,
  businessSnapshot,
  conversationState,
  requestId,
} = {}) {
  const safeMessage = trimString(message);
  if (!safeMessage || safeMessage.length > 40 || !TERM_EXPLAIN_CUE_RE.test(safeMessage)) {
    return null;
  }
  const latestAssistantText = getLatestAssistantHistoryText(historyWindow);
  const targetTerm = extractExplainTargetTerm(safeMessage, latestAssistantText);
  if (!targetTerm) {
    return null;
  }
  const sourcePeriod =
    trimString(businessSnapshot?.analysis_range?.period) || trimString(conversationState?.source_period);
  const contextLabel = inferExplainContextLabel(latestAssistantText);
  const replyText = [
    buildExplainDefinition(targetTerm, contextLabel, sourcePeriod),
    buildExplainImportance(targetTerm, contextLabel, sourcePeriod),
  ]
    .map((item) => trimString(item))
    .filter((item) => item)
    .join("\n\n");
  if (!replyText) {
    return null;
  }
  return buildChatSuccessPayload({
    replyText,
    evidenceBundle: {
      source_period: sourcePeriod,
      question_type: "overview",
      evidence_types: [],
      missing_evidence_types: [],
      analysis_confidence: "high",
      evidence: [],
      actions: [],
    },
    model: "term_explainer",
    requestId,
    conversationState: normalizeConversationState(conversationState),
  });
}
