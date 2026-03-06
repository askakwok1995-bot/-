import {
  normalizeTextForLookup,
  normalizeProductNameForMatch,
  normalizeProductFamilyKey,
  normalizeHospitalNameForMatch,
  normalizeHospitalAliasKey,
} from "../../domain/entity-matchers.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const SUPABASE_AUTH_USER_PATH = "/auth/v1/user";
export const MAX_MESSAGE_LENGTH = 4000;
export const AUTH_UPSTREAM_TIMEOUT_MS = 12000;
export const GEMINI_UPSTREAM_TIMEOUT_MS = 30000;
export const TOOL_RUNTIME_MAX_CALLS = 3;
export const TOOL_RUNTIME_MAX_ROUNDS = 2;

export const CHAT_ERROR_CODES = Object.freeze({
  UNAUTHORIZED: "UNAUTHORIZED",
  AUTH_CONFIG_MISSING: "AUTH_CONFIG_MISSING",
  AUTH_UPSTREAM_TIMEOUT: "AUTH_UPSTREAM_TIMEOUT",
  AUTH_UPSTREAM_ERROR: "AUTH_UPSTREAM_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  CONFIG_MISSING: "CONFIG_MISSING",
  BAD_REQUEST: "BAD_REQUEST",
  MESSAGE_REQUIRED: "MESSAGE_REQUIRED",
  MESSAGE_TOO_LONG: "MESSAGE_TOO_LONG",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  UPSTREAM_AUTH_ERROR: "UPSTREAM_AUTH_ERROR",
  UPSTREAM_RATE_LIMIT: "UPSTREAM_RATE_LIMIT",
  UPSTREAM_NETWORK_ERROR: "UPSTREAM_NETWORK_ERROR",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  EMPTY_REPLY: "EMPTY_REPLY",
});

export const DEFAULT_ASSISTANT_ROLE = Object.freeze({
  identity: "你是医药销售业务分析助手",
  goal: "基于当前业务数据提供数据洞察，并回答医药销售相关问题，帮助用户识别业绩、产品、医院表现和趋势变化中的关键问题与机会，并给出可执行的下一步动作建议",
  style: "简体中文，自然回答，结论先行，专业清晰，强调数据依据、关键问题与机会判断，以及实际推进价值",
  rules: Object.freeze([
    "不要编造数据",
    "数据不足时明确说明",
    "当前阶段不要输出JSON",
    "可以引用当前输入中已有的业务代号、字段代号、产品代号、医院代号",
    "不要编造不存在的字段、代号或含义",
    "优先回答医药销售相关问题",
    "对明显无关的问题，简洁说明当前职责范围，不展开回答",
  ]),
});

export const ASSISTANT_ROLE_DEFINITION = Object.freeze({
  assistant_role: Object.freeze({
    identity: DEFAULT_ASSISTANT_ROLE.identity,
    goal: DEFAULT_ASSISTANT_ROLE.goal,
    style: DEFAULT_ASSISTANT_ROLE.style,
    rules: DEFAULT_ASSISTANT_ROLE.rules,
  }),
});

export const QUESTION_JUDGMENT_CODES = Object.freeze({
  primary_dimension: Object.freeze({
    OVERALL: "overall",
    PRODUCT: "product",
    HOSPITAL: "hospital",
    TREND: "trend",
    RISK_OPPORTUNITY: "risk_opportunity",
    OTHER: "other",
  }),
  granularity: Object.freeze({
    SUMMARY: "summary",
    DETAIL: "detail",
  }),
  relevance: Object.freeze({
    RELEVANT: "relevant",
    IRRELEVANT: "irrelevant",
  }),
});

export const QUESTION_JUDGMENT_LABELS = Object.freeze({
  primary_dimension: Object.freeze({
    [QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL]: "整体",
    [QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT]: "产品",
    [QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL]: "医院",
    [QUESTION_JUDGMENT_CODES.primary_dimension.TREND]: "趋势",
    [QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY]: "风险/机会",
    [QUESTION_JUDGMENT_CODES.primary_dimension.OTHER]: "其他/未归类",
  }),
  granularity: Object.freeze({
    [QUESTION_JUDGMENT_CODES.granularity.SUMMARY]: "摘要级",
    [QUESTION_JUDGMENT_CODES.granularity.DETAIL]: "明细级",
  }),
  relevance: Object.freeze({
    [QUESTION_JUDGMENT_CODES.relevance.RELEVANT]: "医药销售相关",
    [QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT]: "明显无关",
  }),
});

export const DATA_AVAILABILITY_CODES = Object.freeze({
  has_business_data: Object.freeze({
    AVAILABLE: "available",
    UNAVAILABLE: "unavailable",
  }),
  dimension_availability: Object.freeze({
    AVAILABLE: "available",
    PARTIAL: "partial",
    UNAVAILABLE: "unavailable",
  }),
  answer_depth: Object.freeze({
    OVERALL: "overall",
    FOCUSED: "focused",
    DETAILED: "detailed",
  }),
  gap_hint_needed: Object.freeze({
    YES: "yes",
    NO: "no",
  }),
});

export const DATA_AVAILABILITY_LABELS = Object.freeze({
  has_business_data: Object.freeze({
    [DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE]: "有",
    [DATA_AVAILABILITY_CODES.has_business_data.UNAVAILABLE]: "无",
  }),
  dimension_availability: Object.freeze({
    [DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE]: "具备",
    [DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL]: "部分具备",
    [DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE]: "不具备",
  }),
  answer_depth: Object.freeze({
    [DATA_AVAILABILITY_CODES.answer_depth.OVERALL]: "总体判断",
    [DATA_AVAILABILITY_CODES.answer_depth.FOCUSED]: "重点分析",
    [DATA_AVAILABILITY_CODES.answer_depth.DETAILED]: "细节分析",
  }),
  gap_hint_needed: Object.freeze({
    [DATA_AVAILABILITY_CODES.gap_hint_needed.YES]: "是",
    [DATA_AVAILABILITY_CODES.gap_hint_needed.NO]: "否",
  }),
});

export const ROUTE_DECISION_CODES = Object.freeze({
  DIRECT_ANSWER: "direct_answer",
  BOUNDED_ANSWER: "bounded_answer",
  REFUSE: "refuse",
  NEED_MORE_DATA: "need_more_data",
});

export const ROUTE_DECISION_LABELS = Object.freeze({
  [ROUTE_DECISION_CODES.DIRECT_ANSWER]: "直接回答",
  [ROUTE_DECISION_CODES.BOUNDED_ANSWER]: "带边界回答",
  [ROUTE_DECISION_CODES.REFUSE]: "拒绝/收住",
  [ROUTE_DECISION_CODES.NEED_MORE_DATA]: "进入后续补强",
});

export const ROUTE_REASON_CODES = Object.freeze({
  IRRELEVANT: "irrelevant",
  NO_BUSINESS_DATA: "no_business_data",
  DIMENSION_UNAVAILABLE: "dimension_unavailable",
  DETAIL_REQUESTED_BUT_INSUFFICIENT: "detail_requested_but_insufficient",
  PRODUCT_FULL_SCOPE_INSUFFICIENT: "product_full_scope_insufficient",
  PRODUCT_NAMED_SCOPE_INSUFFICIENT: "product_named_scope_insufficient",
  PRODUCT_HOSPITAL_SCOPE_INSUFFICIENT: "product_hospital_scope_insufficient",
  HOSPITAL_NAMED_SCOPE_INSUFFICIENT: "hospital_named_scope_insufficient",
  DIMENSION_PARTIAL: "dimension_partial",
  GAP_HINT_NEEDED: "gap_hint_needed",
  SUFFICIENT: "sufficient",
});

export const QC_REASON_CODES = Object.freeze({
  EMPTY_OR_TOO_SHORT: "empty_or_too_short",
  CONTAINS_INTERNAL_PROCESS_WORDS: "contains_internal_process_words",
  REFUSE_MISSING_EXAMPLES: "refuse_missing_examples",
  BOUNDED_MISSING_BOUNDARY_SENTENCE: "bounded_missing_boundary_sentence",
  HIGH_DUPLICATION: "high_duplication",
  IRRELEVANT_REFUSE_MISMATCH: "irrelevant_refuse_mismatch",
  TOOL_RESULT_CONTRADICTION: "tool_result_contradiction",
  TOOL_RESULT_UNDERLISTED: "tool_result_underlisted",
  TIME_WINDOW_NOT_EXPLICIT: "time_window_not_explicit",
  TIME_WINDOW_REINTERPRETED: "time_window_reinterpreted",
  COMPARE_WINDOW_NOT_EXPLICIT: "compare_window_not_explicit",
  COMPARE_RESULT_UNDEREXPLAINED: "compare_result_underexplained",
});

export const QC_ACTIONS = Object.freeze({
  PASS_THROUGH: "pass_through",
  MINIMAL_PATCH: "minimal_patch",
  SAFE_FALLBACK: "safe_fallback",
});

export const QC_MIN_EFFECTIVE_CHARS = 20;
export const QC_HIGH_DUP_SENTENCE_MIN = 4;
export const QC_HIGH_DUP_UNIQUE_RATIO_MAX = 0.6;
export const QC_ROUTE_MISMATCH_SHORT_MAX_CHARS = 80;
export const QC_NON_SEVERE_FALLBACK_MIN = 2;

export const INTERNAL_PROCESS_WORDS = Object.freeze([
  "路由",
  "补强",
  "内部判定",
  "系统判断",
  "调取",
  "重判",
  "追踪",
  "need_more_data",
  "bounded_answer",
  "routedecision",
  "dataavailability",
  "sessionstate",
  "business_snapshot",
  "retrievalstate",
  "outputcontext",
  "phase2trace",
]);

export const QC_STRONG_REFUSE_WORDS = Object.freeze(["超出职责", "无法回答", "不在范围", "不属于我的职责", "不在我当前"]);
export const QC_BUSINESS_EVIDENCE_WORDS = Object.freeze(["金额", "盒数", "%", "top", "达成率", "环比", "同比"]);
export const QC_BOUNDARY_HINT_WORDS = Object.freeze([
  "在当前范围内",
  "基于现有信息",
  "目前只能",
  "暂时无法",
  "信息有限",
  "口径有限",
]);
export const QC_REFUSE_EXAMPLES_TEXT = [
  "你可以问：",
  "- 本月整体业绩和达成率的核心变化是什么？",
  "- 当前哪个产品最值得优先推进，原因是什么？",
  "- 近三个月医院表现有哪些关键波动，对应风险和机会在哪里？",
].join("\n");
export const QC_BOUNDED_BOUNDARY_TEXT = "在当前范围内，基于现有信息，以上结论可用于方向判断；暂时无法支持更细颗粒度拆解。";

export const OUTPUT_POLICY_DIRECT_ANSWER = [
  "输出策略（direct_answer）：请用简体中文自然回答。",
  "结构固定：",
  "1）先用1-2句给出明确结论；",
  "2）再给1-2条依据（优先引用当前business_snapshot的业务信号/数据点，用自然句表达，不要报字段名）；",
  "3）如适用，再补1条下一步动作建议（可选）。",
  "禁止：提及任何内部过程或系统判断（如“路由/补强/重判/trace/need_more_data/bounded_answer/phase”等），也不要描述系统怎么做的过程。",
].join("\n");

export const OUTPUT_POLICY_BOUNDED_ANSWER = [
  "输出策略（bounded_answer）：请用简体中文自然回答。",
  "结构固定：",
  "1）先用1-2句给出当前可得的结论；",
  "2）再用1句说明边界（业务口吻，例如“在当前口径/当前时间范围/当前可见数据下…”），说明结论的适用范围或不确定点；",
  "3）最后给1-2条继续深入方向/下一步关注点（只说业务上下一步怎么看/怎么验证，不要求用户手动补数据，不提调取/补强/导入/系统处理）。",
  "边界句必须命中至少1个边界提示词：在当前范围内 / 基于现有信息 / 目前只能 / 暂时无法 / 信息有限 / 口径有限（任选其一）。",
  "禁止：任何内部过程词、系统状态描述、让用户“去补数据/去导入/去调取”的指令。",
].join("\n");

export const OUTPUT_POLICY_REFUSE = [
  "输出策略（refuse）：请简洁说明该问题不属于医药销售分析助手的职责范围（1句即可），然后给2-3个用户可问的示例问题（用项目符号列出）。",
  "示例覆盖方向中的任意2-3类：整体业绩、产品表现、医院表现、趋势波动、风险/机会。",
  "禁止：展开回答原问题；不要说教；不要出现内部过程词。",
].join("\n");

export const ON_DEMAND_MAX_WINDOW_MONTHS = 24;
export const ON_DEMAND_PRODUCT_FULL_SAFE_CAP = 50;
export const ON_DEMAND_PRODUCT_NAMED_SAFE_CAP = 10;
export const ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP = 10;
export const SUPABASE_DATA_UPSTREAM_TIMEOUT_MS = 15000;
export const SUPABASE_DATA_PAGE_SIZE = 1000;
export const SUPABASE_DATA_MAX_PAGES = 20;
export const YM_RE = /^(\d{4})-(\d{2})$/;
export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const SESSION_HISTORY_WINDOW_ROUNDS = 6;
export const SESSION_HISTORY_WINDOW_MAX_ITEMS = SESSION_HISTORY_WINDOW_ROUNDS * 2;
export const SESSION_FOLLOWUP_CUES = Object.freeze(["刚才", "上面", "接着", "继续", "展开", "在这个基础上", "针对这个", "那么", "那针对这个"]);
export const SESSION_SHORT_FOLLOWUP_CUES = Object.freeze([
  "为什么",
  "具体呢",
  "具体点",
  "具体一点",
  "哪个",
  "哪一个",
  "那呢",
  "怎么做",
  "怎么推进",
  "继续",
  "展开",
  "然后呢",
  "还有呢",
  "详细点",
  "细说",
]);
export const SESSION_SHORT_FOLLOWUP_PATTERNS = Object.freeze([/^那(?:医院|产品|趋势|风险|机会)(?:呢)?[\s，,。！？!?；;：:、]*$/i]);
export const SESSION_SCOPE_OVERRIDE_CUES = Object.freeze(["换成", "改成", "改为", "只看", "仅看", "限定", "聚焦", "重新看", "改看"]);
export const SESSION_HARD_TOPIC_SHIFT_CUES = Object.freeze(["换个话题", "另外一个问题", "先不说这个", "不聊这个", "换个问题", "说点别的", "题外话"]);
export const SESSION_SCOPE_OVERRIDE_PATTERNS = Object.freeze([
  /(?:按|按照).{0,8}(?:看|分析|统计)/i,
  /(?:看|按|按照).{0,8}(?:\d{4}-\d{2}|q[1-4]|[一二三四]季度|本月|上月|本季度|上季度|今年|去年|近\d+个?月)/i,
]);
export const SESSION_EXPLICIT_DIMENSION_KEYWORDS = Object.freeze({
  product: Object.freeze(["产品", "品种", "单品", "规格", "产品结构", "重点产品", "药品", "药", "药物", "用药", "品规", "剂型"]),
  hospital: Object.freeze(["医院", "终端", "医院结构", "医院贡献", "长尾医院", "门诊", "机构", "诊所"]),
  trend: Object.freeze(["趋势", "走势", "波动", "环比", "同比", "逐月", "每月", "近三个月", "哪个月"]),
  overall: Object.freeze(["整体", "总体", "全局", "汇总", "总览", "整体表现", "总体表现"]),
  risk_opportunity: Object.freeze(["最大风险", "最大机会", "关键问题", "突破口", "最值得关注", "最需要关注"]),
});
export const HOSPITAL_MONTHLY_DETAIL_KEYWORDS = Object.freeze(["每月", "每个月", "逐月", "月度", "近一年", "一年内", "12个月", "十二个月", "全年"]);
export const PRODUCT_HOSPITAL_SCOPE_KEYWORDS = Object.freeze([
  "医院",
  "门诊",
  "机构",
  "诊所",
  "终端",
  "客户",
  "哪些医院",
  "哪家医院",
  "医院贡献",
  "医院销量",
  "在哪些医院",
  "在哪家医院",
]);
export const FULL_PRODUCT_REQUEST_KEYWORDS = Object.freeze([
  "所有产品",
  "全部产品",
  "全产品",
  "完整产品清单",
  "把产品都列出来",
  "全部产品列出来",
  "所有产品列出来",
  "所有产品表现",
  "所有药品",
  "全部药品",
  "所有药",
  "全部药",
  "全药品清单",
]);
export const PRODUCT_SINGLE_DRUG_CO_OCCURRENCE_KEYWORDS = Object.freeze(["哪个", "哪些", "这个", "那个", "表现", "贡献", "销量", "销售", "分析", "对比", "推进", "重点"]);
export const HOSPITAL_NAMED_TRIGGER_KEYWORDS = Object.freeze(["医院", "门诊", "机构", "诊所", "终端"]);
export const HOSPITAL_NAMED_GENERIC_MENTION_KEYWORDS = Object.freeze([
  "医院",
  "门诊",
  "诊所",
  "机构",
  "哪家医院",
  "哪个医院",
  "哪些医院",
  "哪家门诊",
  "哪个门诊",
  "哪家机构",
  "哪个机构",
  "重点医院",
  "医院表现",
  "医院数据",
  "医院情况",
]);
export const HOSPITAL_ENTITY_SUFFIX_RE = /(医院|门诊|诊所|机构)$/;
export const HOSPITAL_ALIAS_STRIP_RE = /(有限责任公司|有限公司|医疗美容|医疗|美容|门诊部|门诊|诊所|医院|机构|中心|集团|股份|连锁)/g;
export const HOSPITAL_MENTION_CAPTURE_RE = /([\u4e00-\u9fa5A-Za-z0-9]{2,40}(?:医院|门诊|诊所|机构))/g;
export const SESSION_HISTORY_ROLE_SET = new Set(["user", "assistant"]);
export const QUESTION_KEYWORDS = Object.freeze({
  irrelevant: Object.freeze([
    "天气",
    "星座",
    "八卦",
    "娱乐",
    "明星",
    "菜谱",
    "做饭",
    "电影推荐",
    "旅游攻略",
    "写代码",
    "编程",
    "bug",
    "前端",
    "后端",
    "泛生活",
    "闲聊",
  ]),
  detail: Object.freeze(["具体", "分别", "明细", "细项", "逐项", "各月", "每月", "top", "排名", "列出来", "详细", "拆解", "清单", "具体数值", "分别是多少", "逐月"]),
  primary_dimension: Object.freeze({
    product: Object.freeze(["产品", "品种", "单品", "规格", "产品贡献", "重点产品", "产品结构", "药品", "药", "药物", "用药", "品规", "剂型"]),
    hospital: Object.freeze(["医院", "终端", "医院结构", "医院贡献", "长尾医院", "门诊", "机构", "诊所"]),
    trend: Object.freeze(["趋势", "走势", "波动", "增长", "下滑", "变化", "环比", "同比", "最近", "近三个月", "哪个月"]),
    risk_opportunity: Object.freeze(["风险", "机会", "突破口", "抓手", "优先", "推进", "下一步", "怎么推进", "最值得"]),
    overall: Object.freeze(["整体", "总体", "全局", "业绩", "销售", "情况", "表现", "分析", "汇总"]),
  }),
});

export function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeQuestionText(message) {
  return trimString(message)
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

export function containsAnyKeyword(text, keywords) {
  if (!text || !Array.isArray(keywords) || keywords.length === 0) {
    return false;
  }
  return keywords.some((keyword) => text.includes(keyword));
}

export function containsProductDimensionKeyword(text, keywords) {
  if (!text || !Array.isArray(keywords) || keywords.length === 0) {
    return false;
  }
  const strongKeywords = keywords.filter((keyword) => trimString(keyword) && trimString(keyword) !== "药");
  if (containsAnyKeyword(text, strongKeywords)) {
    return true;
  }
  if (!text.includes("药")) {
    return false;
  }
  return containsAnyKeyword(text, PRODUCT_SINGLE_DRUG_CO_OCCURRENCE_KEYWORDS);
}

function normalizeRoleText(value, fallback) {
  const text = trimString(value);
  return text || fallback;
}

function normalizeRoleRules(value, fallbackRules) {
  const fallback = Array.isArray(fallbackRules)
    ? fallbackRules.map((item) => trimString(item)).filter((item) => item)
    : [];
  const rules = Array.isArray(value) ? value.map((item) => trimString(item)).filter((item) => item) : [];
  return rules.length > 0 ? rules : fallback;
}

export function buildAssistantRoleSystemInstruction(roleDefinition) {
  const roleCandidate =
    roleDefinition && typeof roleDefinition === "object" && roleDefinition.assistant_role
      ? roleDefinition.assistant_role
      : null;

  const identity = normalizeRoleText(roleCandidate?.identity, DEFAULT_ASSISTANT_ROLE.identity);
  const goal = normalizeRoleText(roleCandidate?.goal, DEFAULT_ASSISTANT_ROLE.goal);
  const style = normalizeRoleText(roleCandidate?.style, DEFAULT_ASSISTANT_ROLE.style);
  const rules = normalizeRoleRules(roleCandidate?.rules, DEFAULT_ASSISTANT_ROLE.rules);

  return [
    `角色定位：${identity}`,
    `目标：${goal}`,
    `回答风格：${style}`,
    "行为规则：",
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
    "业务输入约束：优先依据 business_snapshot 回答；若快照数据不足，请明确说明，不要编造。",
  ].join("\n");
}

export function getEnvString(env, key) {
  if (!env || typeof env !== "object") {
    return "";
  }
  return trimString(env[key]);
}

export async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

export async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timerId);
  }
}

export function sanitizeModelName(value) {
  const candidate = trimString(value);
  return candidate || DEFAULT_GEMINI_MODEL;
}

export function createEmptyBusinessSnapshot() {
  return {
    analysis_range: {},
    performance_overview: {},
    key_business_signals: [],
    product_performance: [],
    hospital_performance: [],
    recent_trends: [],
    risk_alerts: [],
    opportunity_hints: [],
  };
}

export function normalizeSnapshotObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const output = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const safeKey = trimString(key);
    if (!safeKey) continue;
    if (typeof rawValue === "string") {
      output[safeKey] = trimString(rawValue);
      continue;
    }
    if (typeof rawValue === "number") {
      output[safeKey] = Number.isFinite(rawValue) ? rawValue : null;
      continue;
    }
    if (typeof rawValue === "boolean") {
      output[safeKey] = rawValue;
      continue;
    }
    if (rawValue === null) {
      output[safeKey] = null;
      continue;
    }
    if (rawValue === undefined) {
      output[safeKey] = "";
      continue;
    }
    if (Array.isArray(rawValue)) {
      output[safeKey] = normalizeSnapshotArray(rawValue);
      continue;
    }
    if (rawValue && typeof rawValue === "object") {
      output[safeKey] = normalizeSnapshotObject(rawValue);
      continue;
    }
    output[safeKey] = trimString(String(rawValue));
  }
  return output;
}

export function normalizeSnapshotArray(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  for (const item of value) {
    if (typeof item === "string") {
      const text = trimString(item);
      if (text) output.push(text);
      continue;
    }
    if (typeof item === "number") {
      if (Number.isFinite(item)) output.push(item);
      continue;
    }
    if (typeof item === "boolean") {
      output.push(item);
      continue;
    }
    if (item === null) {
      output.push(null);
      continue;
    }
    if (item === undefined) {
      continue;
    }
    if (Array.isArray(item)) {
      const nested = normalizeSnapshotArray(item);
      if (nested.length > 0) output.push(nested);
      continue;
    }
    if (item && typeof item === "object") {
      const nested = normalizeSnapshotObject(item);
      if (Object.keys(nested).length > 0) output.push(nested);
      continue;
    }
    const text = trimString(String(item));
    if (text) output.push(text);
  }
  return output;
}

export function normalizeSnapshotStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimString(item)).filter((item) => item);
}

export function normalizeSnapshotObjectArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeSnapshotObject(item)).filter((item) => Object.keys(item).length > 0);
}

export function normalizeBusinessSnapshot(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const normalized = createEmptyBusinessSnapshot();
  normalized.analysis_range = normalizeSnapshotObject(source.analysis_range);
  normalized.performance_overview = normalizeSnapshotObject(source.performance_overview);
  normalized.key_business_signals = normalizeSnapshotStringArray(source.key_business_signals);
  normalized.product_performance = normalizeSnapshotObjectArray(source.product_performance);
  normalized.hospital_performance = normalizeSnapshotObjectArray(source.hospital_performance);
  normalized.recent_trends = normalizeSnapshotObjectArray(source.recent_trends);
  normalized.risk_alerts = normalizeSnapshotStringArray(source.risk_alerts);
  normalized.opportunity_hints = normalizeSnapshotStringArray(source.opportunity_hints);
  return normalized;
}

export function normalizeNumericValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const text = trimString(value).replace(/,/g, "");
    if (!text) {
      return null;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function roundToTwo(value) {
  const numeric = normalizeNumericValue(value);
  if (numeric === null) return null;
  return Number(numeric.toFixed(2));
}

export function formatNumberText(value) {
  const numeric = normalizeNumericValue(value);
  if (numeric === null) return "--";
  const rounded = Number(numeric.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function formatAmountWanText(value) {
  const numeric = normalizeNumericValue(value);
  if (numeric === null) return "--";
  return `${(numeric / 10000).toFixed(2)}万元`;
}

export function formatPercentText(ratio) {
  const numeric = normalizeNumericValue(ratio);
  if (numeric === null) return "--";
  return `${(numeric * 100).toFixed(2)}%`;
}

export function formatDeltaPercentText(ratio) {
  const numeric = normalizeNumericValue(ratio);
  if (numeric === null) return "--";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${(numeric * 100).toFixed(2)}%`;
}

export function formatQuantityBoxText(value) {
  const numeric = normalizeNumericValue(value);
  if (numeric === null) return "--";
  return `${formatNumberText(numeric)}盒`;
}

export function parseYm(ym) {
  const matched = trimString(ym).match(YM_RE);
  if (!matched) {
    return null;
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

export function isValidYm(ym) {
  return Boolean(parseYm(ym));
}

export function formatYm(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function addMonthsToYm(ym, deltaMonths) {
  const parsed = parseYm(ym);
  const delta = Number(deltaMonths);
  if (!parsed || !Number.isInteger(delta)) {
    return "";
  }

  const nextMonthIndex = parsed.year * 12 + (parsed.month - 1) + delta;
  const year = Math.floor(nextMonthIndex / 12);
  const month = (nextMonthIndex % 12) + 1;
  return formatYm(year, month);
}

export function listYmRange(startYm, endYm) {
  const start = parseYm(startYm);
  const end = parseYm(endYm);
  if (!start || !end) {
    return [];
  }
  if (start.year > end.year || (start.year === end.year && start.month > end.month)) {
    return [];
  }

  const monthKeys = [];
  let cursor = formatYm(start.year, start.month);
  const last = formatYm(end.year, end.month);
  let guard = 0;
  while (cursor && cursor <= last && guard < 600) {
    monthKeys.push(cursor);
    cursor = addMonthsToYm(cursor, 1);
    guard += 1;
  }
  return monthKeys;
}

export function extractYmFromDate(value) {
  const text = trimString(value);
  if (!text) return "";
  if (isValidYm(text)) return text;

  const matched = text.match(DATE_RE);
  if (!matched) return "";

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return "";
  }
  return formatYm(year, month);
}

export function calcGrowthRatio(currentValue, baseValue) {
  const current = normalizeNumericValue(currentValue);
  const base = normalizeNumericValue(baseValue);
  if (current === null || base === null || base === 0) {
    return null;
  }
  return Number(((current - base) / Math.abs(base)).toFixed(6));
}

export function isMissingDisplayValue(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const text = trimString(value).toLocaleLowerCase();
  return text === "" || text === "--" || text === "unknown";
}

export function isEffectiveScalar(value, key = "") {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value === "string") {
    if (isMissingDisplayValue(value)) {
      return false;
    }
    if (trimString(key).endsWith("_code") && trimString(value).toLocaleLowerCase() === "unknown") {
      return false;
    }
    return true;
  }
  return false;
}

export function hasEffectiveArrayContent(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((item) => {
    if (Array.isArray(item)) {
      return hasEffectiveArrayContent(item);
    }
    if (item && typeof item === "object") {
      return hasEffectiveObjectContent(item);
    }
    return isEffectiveScalar(item);
  });
}

export function hasEffectiveObjectContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).some(([key, item]) => {
    if (Array.isArray(item)) {
      return hasEffectiveArrayContent(item);
    }
    if (item && typeof item === "object") {
      return hasEffectiveObjectContent(item);
    }
    return isEffectiveScalar(item, key);
  });
}

export {
  normalizeTextForLookup,
  normalizeProductNameForMatch,
  normalizeProductFamilyKey,
  normalizeHospitalNameForMatch,
  normalizeHospitalAliasKey,
};
