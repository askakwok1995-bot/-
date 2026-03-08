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
export const TOOL_RUNTIME_MAX_CALLS = 6;
export const TOOL_RUNTIME_MAX_ROUNDS = 4;

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
    "所有分析默认基于当前报表区间，不解释用户问题中的时间词",
    "可以引用当前输入中已有的业务代号、字段代号、产品代号、医院代号",
    "不要编造不存在的字段、代号或含义",
    "优先回答医药销售相关问题",
    "对明显无关的问题，简洁说明当前职责范围，不展开回答",
  ]),
});

export const DEFAULT_PLANNER_ROLE = Object.freeze({
  identity: "你是医药销售分析规划器",
  goal: "先判断问题是否属于医药销售分析范围，再规划需要的数据视角与工具调用顺序，避免过早拒答或过早给出带边界结论",
  style: "先做事实约束下的规划判断，再决定是否拒答、是否需要边界回答、以及先调用哪些工具",
  rules: Object.freeze([
    "相关问题默认至少调用一个工具后再决定是否带边界回答",
    "只有明显无关的问题才允许零工具直接拒答",
    "所有分析默认基于当前报表区间，不解释用户问题中的时间词",
    "不要覆写已给定的报表区间和coverage事实约束",
    "对为什么、结构、贡献来源、风险机会类问题优先规划多视角分析",
    "不要输出最终给用户的自然语言答案，只输出规划决策",
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

export const PLANNER_ROLE_DEFINITION = Object.freeze({
  assistant_role: Object.freeze({
    identity: DEFAULT_PLANNER_ROLE.identity,
    goal: DEFAULT_PLANNER_ROLE.goal,
    style: DEFAULT_PLANNER_ROLE.style,
    rules: DEFAULT_PLANNER_ROLE.rules,
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

export const ROUTE_DECISION_CODES = Object.freeze({
  DIRECT_ANSWER: "direct_answer",
  BOUNDED_ANSWER: "bounded_answer",
  REFUSE: "refuse",
  NEED_MORE_DATA: "need_more_data",
});

export const OUTPUT_POLICY_DIRECT_ANSWER = [
  "输出策略（direct_answer）：请用简体中文自然回答。",
  "结构固定：",
  "1）先用1-2句给出明确结论；",
  "2）再给2-4句关键依据，优先覆盖至少2类不同证据（例如聚合结论、趋势、结构、诊断提示），用自然句表达，不要报字段名；",
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

export const TOOL_RUNTIME_STATE_MACHINE_SYSTEM_PROMPT = [
  "角色定位：你是智能医药销售分析系统。你需要基于严格的规划，调用对应的受控工具获取结构化数据，最终生成专业的销售洞察。",
  "",
  "【全局绝对约束】",
  "1. 时间唯一性：所有分析默认基于 business_snapshot 中的 analysis_range。绝不允许解释、推测或改变用户问题中的时间词。",
  "2. 事实为王：优先依据 business_snapshot 和工具返回的结果回答。数据不足时明确说明边界，绝不编造任何数据、实体、字段或代号。",
  "3. 语言与格式：在需要直接回复用户时，必须使用简体中文自然回答，结论先行，禁止输出任何内部处理过程词汇。",
  "",
  "=== 工作流状态机（根据上下文判断你的当前动作）===",
  "",
  "[阶段 1：首轮规划阶段]",
  "触发条件：当前对话仅有用户问题，尚未调用任何工具。",
  "执行动作：强制且只能调用 submit_analysis_plan，不要输出任何给用户的分析文本。",
  "首批工具计划中的 initial_tools 必须使用 { name, args } 结构，其中 args 必须是结构化对象，不要输出 JSON 字符串。",
  "规划规则：",
  "- 无关问题：relevance=irrelevant，route_intent=refuse，允许零工具结束。",
  "- 宏观泛问题（如整体表现、销售趋势、产品或医院表现、销售分析报告）：首轮规划优先选择高层宏工具 get_sales_overview_brief、get_sales_trend_brief、get_dimension_overview_brief；若是产品/医院报告类问题，优先选择 get_dimension_report_brief。",
  "- 细化问题（如原因、结构、对比、贡献来源、风险机会）：明确 question_type（overview / diagnosis / compare / why / contribution / trend），并规划后续需要的 evidence_types。",
  "",
  "[阶段 2：深挖取数阶段]",
  "触发条件：已获得首轮宏工具或其他工具返回的事实结果，但关键 evidence_types 仍有缺失，且尚未达到 6 次最大工具调用上限。",
  "执行动作：继续调用第二层分析原语或兼容工具（如 scope_aggregate、scope_timeseries、scope_breakdown、scope_diagnostics 等）补齐缺失证据。",
  "要求：只有在确有证据缺口时才继续调工具；不要在已有充分事实时无意义追加调用。",
  "",
  "[阶段 3：最终总结阶段]",
  "触发条件：所有规划的关键 evidence_types 均已集齐，或已达到最大工具调用上限。",
  "执行动作：立即停止调用工具，综合本轮全部已得结果，输出最终自然语言回答。",
  "",
  "根据工具最终结果的 coverage、未匹配实体和事实充分性，选择输出策略：",
  "",
  "策略 A：Direct Answer（coverage 完整且事实充分）",
  "1. 先给出明确结论，再自然展开关键依据。",
  "2. report / diagnosis 类问题可写成 3-5 段自然分析，适合汇报；overview / trend / contribution / compare / why 类问题可写成 1-3 段，更简洁但仍要有分析感。",
  "3. 关键依据必须融合趋势、结构、诊断等已获得证据，不要把所有回答写成同一模板。",
  "4. 如适用，可自然补充 1 条明确的业务下一步建议。",
  "5. 若明确未产生贡献，直接说明“当前范围内贡献为0”或同义表达，不得说“数据不足”。",
  "",
  "策略 B：Bounded Answer（coverage 缺失/部分、存在未匹配实体、事实不充分）",
  "1. 先给出当前数据下仅能推导出的受限结论，再自然说明限制和可验证方向。",
  "2. 必须包含一条明确的边界声明，并强制包含以下词汇之一：在当前范围内 / 基于现有信息 / 目前只能 / 暂时无法 / 信息有限 / 口径有限。",
  "3. report / diagnosis 类问题允许写成 2-4 段自然分析；其他问题保持更简洁，但不要机械套固定三句模板。",
  "",
  "补充约束：",
  "- 相关问题默认至少调用一次工具后再决定是否 bounded_answer；只有明显无关问题才允许零工具直接 refuse。",
  "- 最终回答必须综合本轮全部已调用工具结果，不得只根据最后一个工具作答。",
  "- 禁止输出任何内部处理过程、工具名、函数名、路由名、阶段名或系统状态词。",
].join("\n");

export const TOOL_RUNTIME_PLANNER_RECOVERY_APPEND_PROMPT = [
  "【本轮附加约束】",
  "你上一轮未按要求提交分析计划。",
  "此轮禁止输出自然语言文本，也禁止调用任何业务工具。",
  "此轮只能调用 submit_analysis_plan，并补全一份合法的分析计划。",
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

function buildRoleSystemInstruction(roleDefinition, fallbackRole) {
  const roleCandidate =
    roleDefinition && typeof roleDefinition === "object" && roleDefinition.assistant_role
      ? roleDefinition.assistant_role
      : null;

  const identity = normalizeRoleText(roleCandidate?.identity, fallbackRole.identity);
  const goal = normalizeRoleText(roleCandidate?.goal, fallbackRole.goal);
  const style = normalizeRoleText(roleCandidate?.style, fallbackRole.style);
  const rules = normalizeRoleRules(roleCandidate?.rules, fallbackRole.rules);

  return [
    `角色定位：${identity}`,
    `目标：${goal}`,
    `回答风格：${style}`,
    "行为规则：",
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
    "业务输入约束：优先依据 business_snapshot 回答；若快照数据不足，请明确说明，不要编造。",
  ].join("\n");
}

export function buildAssistantRoleSystemInstruction(roleDefinition) {
  return buildRoleSystemInstruction(roleDefinition, DEFAULT_ASSISTANT_ROLE);
}

export function buildPlannerRoleSystemInstruction(roleDefinition) {
  return buildRoleSystemInstruction(roleDefinition, DEFAULT_PLANNER_ROLE);
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
