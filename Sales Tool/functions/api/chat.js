const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const SUPABASE_AUTH_USER_PATH = "/auth/v1/user";
const MAX_MESSAGE_LENGTH = 4000;
const AUTH_UPSTREAM_TIMEOUT_MS = 12000;
const GEMINI_UPSTREAM_TIMEOUT_MS = 30000;

const CHAT_ERROR_CODES = Object.freeze({
  UNAUTHORIZED: "UNAUTHORIZED",
  AUTH_CONFIG_MISSING: "AUTH_CONFIG_MISSING",
  AUTH_UPSTREAM_TIMEOUT: "AUTH_UPSTREAM_TIMEOUT",
  AUTH_UPSTREAM_ERROR: "AUTH_UPSTREAM_ERROR",
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

const DEFAULT_ASSISTANT_ROLE = Object.freeze({
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

const ASSISTANT_ROLE_DEFINITION = Object.freeze({
  assistant_role: Object.freeze({
    identity: DEFAULT_ASSISTANT_ROLE.identity,
    goal: DEFAULT_ASSISTANT_ROLE.goal,
    style: DEFAULT_ASSISTANT_ROLE.style,
    rules: DEFAULT_ASSISTANT_ROLE.rules,
  }),
});

const QUESTION_JUDGMENT_CODES = Object.freeze({
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

const QUESTION_JUDGMENT_LABELS = Object.freeze({
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

const DATA_AVAILABILITY_CODES = Object.freeze({
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

const DATA_AVAILABILITY_LABELS = Object.freeze({
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

const ROUTE_DECISION_CODES = Object.freeze({
  DIRECT_ANSWER: "direct_answer",
  BOUNDED_ANSWER: "bounded_answer",
  REFUSE: "refuse",
  NEED_MORE_DATA: "need_more_data",
});

const ROUTE_DECISION_LABELS = Object.freeze({
  [ROUTE_DECISION_CODES.DIRECT_ANSWER]: "直接回答",
  [ROUTE_DECISION_CODES.BOUNDED_ANSWER]: "带边界回答",
  [ROUTE_DECISION_CODES.REFUSE]: "拒绝/收住",
  [ROUTE_DECISION_CODES.NEED_MORE_DATA]: "进入后续补强",
});

const ROUTE_REASON_CODES = Object.freeze({
  IRRELEVANT: "irrelevant",
  NO_BUSINESS_DATA: "no_business_data",
  DIMENSION_UNAVAILABLE: "dimension_unavailable",
  DETAIL_REQUESTED_BUT_INSUFFICIENT: "detail_requested_but_insufficient",
  DIMENSION_PARTIAL: "dimension_partial",
  GAP_HINT_NEEDED: "gap_hint_needed",
  SUFFICIENT: "sufficient",
});

const ON_DEMAND_MAX_WINDOW_MONTHS = 24;
const SUPABASE_DATA_UPSTREAM_TIMEOUT_MS = 15000;
const SUPABASE_DATA_PAGE_SIZE = 1000;
const SUPABASE_DATA_MAX_PAGES = 20;
const YM_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const SESSION_HISTORY_WINDOW_ROUNDS = 6;
const SESSION_HISTORY_WINDOW_MAX_ITEMS = SESSION_HISTORY_WINDOW_ROUNDS * 2;

const SESSION_FOLLOWUP_CUES = Object.freeze([
  "刚才",
  "上面",
  "接着",
  "继续",
  "展开",
  "在这个基础上",
  "针对这个",
  "那么",
  "那针对这个",
]);

const SESSION_SHORT_FOLLOWUP_CUES = Object.freeze([
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

const SESSION_SCOPE_OVERRIDE_CUES = Object.freeze([
  "换成",
  "改成",
  "改为",
  "只看",
  "仅看",
  "限定",
  "聚焦",
  "重新看",
  "改看",
]);

const SESSION_HARD_TOPIC_SHIFT_CUES = Object.freeze([
  "换个话题",
  "另外一个问题",
  "先不说这个",
  "不聊这个",
  "换个问题",
  "说点别的",
  "题外话",
]);

const SESSION_SCOPE_OVERRIDE_PATTERNS = Object.freeze([
  /(?:按|按照).{0,8}(?:看|分析|统计)/i,
  /(?:看|按|按照).{0,8}(?:\d{4}-\d{2}|q[1-4]|[一二三四]季度|本月|上月|本季度|上季度|今年|去年|近\d+个?月)/i,
]);

const SESSION_EXPLICIT_DIMENSION_KEYWORDS = Object.freeze({
  product: Object.freeze(["产品", "品种", "单品", "规格", "产品结构", "重点产品"]),
  hospital: Object.freeze(["医院", "终端", "医院结构", "医院贡献", "长尾医院"]),
  trend: Object.freeze(["趋势", "走势", "波动", "环比", "同比", "逐月", "每月", "近三个月", "哪个月"]),
  overall: Object.freeze(["整体", "总体", "全局", "汇总", "总览", "整体表现", "总体表现"]),
  risk_opportunity: Object.freeze([
    "最大风险",
    "最大机会",
    "关键问题",
    "突破口",
    "最值得关注",
    "最需要关注",
  ]),
});

const SESSION_HISTORY_ROLE_SET = new Set(["user", "assistant"]);

const QUESTION_KEYWORDS = Object.freeze({
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
  detail: Object.freeze([
    "具体",
    "分别",
    "明细",
    "细项",
    "逐项",
    "各月",
    "每月",
    "top",
    "排名",
    "列出来",
    "详细",
    "拆解",
    "清单",
    "具体数值",
    "分别是多少",
    "逐月",
  ]),
  primary_dimension: Object.freeze({
    product: Object.freeze(["产品", "品种", "单品", "规格", "产品贡献", "重点产品", "产品结构"]),
    hospital: Object.freeze(["医院", "终端", "医院结构", "医院贡献", "长尾医院"]),
    trend: Object.freeze(["趋势", "走势", "波动", "增长", "下滑", "变化", "环比", "同比", "最近", "近三个月", "哪个月"]),
    risk_opportunity: Object.freeze(["风险", "机会", "突破口", "抓手", "优先", "推进", "下一步", "怎么推进", "最值得"]),
    overall: Object.freeze(["整体", "总体", "全局", "业绩", "销售", "情况", "表现", "分析", "汇总"]),
  }),
});

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQuestionText(message) {
  return trimString(message)
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function containsAnyKeyword(text, keywords) {
  if (!text || !Array.isArray(keywords) || keywords.length === 0) {
    return false;
  }
  return keywords.some((keyword) => text.includes(keyword));
}

function judgeRelevance(text) {
  if (containsAnyKeyword(text, QUESTION_KEYWORDS.irrelevant)) {
    return QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT;
  }
  return QUESTION_JUDGMENT_CODES.relevance.RELEVANT;
}

function judgeGranularity(text) {
  if (containsAnyKeyword(text, QUESTION_KEYWORDS.detail)) {
    return QUESTION_JUDGMENT_CODES.granularity.DETAIL;
  }
  return QUESTION_JUDGMENT_CODES.granularity.SUMMARY;
}

function judgePrimaryDimension(text, relevanceCode) {
  if (relevanceCode === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.OTHER;
  }
  if (!text) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.OTHER;
  }

  const candidates = [
    QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
    QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
    QUESTION_JUDGMENT_CODES.primary_dimension.TREND,
    QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY,
    QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
  ];

  for (const code of candidates) {
    const keywords = QUESTION_KEYWORDS.primary_dimension[code];
    if (containsAnyKeyword(text, keywords)) {
      return code;
    }
  }
  return QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
}

function buildQuestionJudgment(message) {
  const text = normalizeQuestionText(message);
  const relevanceCode = judgeRelevance(text);
  const granularityCode = judgeGranularity(text);
  const primaryDimensionCode = judgePrimaryDimension(text, relevanceCode);

  return {
    primary_dimension: {
      code: primaryDimensionCode,
      label: QUESTION_JUDGMENT_LABELS.primary_dimension[primaryDimensionCode],
    },
    granularity: {
      code: granularityCode,
      label: QUESTION_JUDGMENT_LABELS.granularity[granularityCode],
    },
    relevance: {
      code: relevanceCode,
      label: QUESTION_JUDGMENT_LABELS.relevance[relevanceCode],
    },
  };
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

function buildAssistantRoleSystemInstruction(roleDefinition) {
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

function getEnvString(env, key) {
  if (!env || typeof env !== "object") {
    return "";
  }
  return trimString(env[key]);
}

function jsonResponse(payload, status = 200, requestId = "") {
  const safeRequestId = trimString(requestId);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (safeRequestId) {
    headers["x-request-id"] = safeRequestId;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

function errorResponse(code, message, status, requestId, details = null) {
  const payload = {
    error: {
      code,
      message,
    },
    requestId,
  };
  if (details && typeof details === "object") {
    payload.error.details = details;
  }
  return jsonResponse(payload, status, requestId);
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
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

function extractBearerToken(request) {
  const raw = trimString(request?.headers?.get("authorization"));
  if (!raw) return "";
  const matched = raw.match(/^Bearer\s+(.+)$/i);
  return matched ? trimString(matched[1]) : "";
}

async function verifySupabaseAccessToken(request, env) {
  const token = extractBearerToken(request);
  if (!token) {
    return {
      ok: false,
      code: CHAT_ERROR_CODES.UNAUTHORIZED,
      message: "登录状态已失效，请重新登录后再试。",
      status: 401,
    };
  }

  const supabaseUrl = getEnvString(env, "SUPABASE_URL");
  const supabaseAnonKey = getEnvString(env, "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      code: CHAT_ERROR_CODES.AUTH_CONFIG_MISSING,
      message: "服务端缺少 Supabase 校验配置（SUPABASE_URL/SUPABASE_ANON_KEY）。",
      status: 500,
    };
  }

  const userUrl = `${supabaseUrl.replace(/\/+$/, "")}${SUPABASE_AUTH_USER_PATH}`;

  try {
    const response = await fetchWithTimeout(
      userUrl,
      {
        method: "GET",
        headers: {
          apikey: supabaseAnonKey,
          authorization: `Bearer ${token}`,
        },
      },
      AUTH_UPSTREAM_TIMEOUT_MS,
    );

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UNAUTHORIZED,
        message: "登录状态已失效，请重新登录后再试。",
        status: 401,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: CHAT_ERROR_CODES.AUTH_UPSTREAM_ERROR,
        message: `服务端登录态校验失败（HTTP ${response.status}）。`,
        status: 502,
      };
    }

    return {
      ok: true,
      token,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        code: CHAT_ERROR_CODES.AUTH_UPSTREAM_TIMEOUT,
        message: "服务端登录态校验超时，请稍后重试。",
        status: 504,
      };
    }
    return {
      ok: false,
      code: CHAT_ERROR_CODES.AUTH_UPSTREAM_ERROR,
      message: `服务端登录态校验失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      status: 502,
    };
  }
}

function sanitizeModelName(value) {
  const candidate = trimString(value);
  return candidate || DEFAULT_GEMINI_MODEL;
}

function createEmptyBusinessSnapshot() {
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

function normalizeSnapshotObject(value) {
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
    output[safeKey] = String(rawValue);
  }
  return output;
}

function normalizeSnapshotStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => trimString(item))
    .filter((item) => item);
}

function normalizeSnapshotObjectArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeSnapshotObject(item))
    .filter((item) => Object.keys(item).length > 0);
}

function normalizeBusinessSnapshot(input) {
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

function normalizeNumericValue(value) {
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

function roundToTwo(value) {
  const numeric = normalizeNumericValue(value);
  if (numeric === null) return null;
  return Number(numeric.toFixed(2));
}

function formatNumberText(value) {
  const numeric = normalizeNumericValue(value);
  if (numeric === null) {
    return "--";
  }
  const rounded = Number(numeric.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function formatAmountWanText(value) {
  const numeric = normalizeNumericValue(value);
  if (numeric === null) return "--";
  return `${(numeric / 10000).toFixed(2)}万元`;
}

function formatPercentText(ratio) {
  const numeric = normalizeNumericValue(ratio);
  if (numeric === null) return "--";
  return `${(numeric * 100).toFixed(2)}%`;
}

function formatDeltaPercentText(ratio) {
  const numeric = normalizeNumericValue(ratio);
  if (numeric === null) return "--";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${(numeric * 100).toFixed(2)}%`;
}

function formatQuantityBoxText(value) {
  const numeric = normalizeNumericValue(value);
  if (numeric === null) return "--";
  return `${formatNumberText(numeric)}盒`;
}

function parseYm(ym) {
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

function isValidYm(ym) {
  return Boolean(parseYm(ym));
}

function formatYm(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function addMonthsToYm(ym, deltaMonths) {
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

function listYmRange(startYm, endYm) {
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

function extractYmFromDate(value) {
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

function calcGrowthRatio(currentValue, baseValue) {
  const current = normalizeNumericValue(currentValue);
  const base = normalizeNumericValue(baseValue);
  if (current === null || base === null || base === 0) {
    return null;
  }
  return Number(((current - base) / Math.abs(base)).toFixed(6));
}

function normalizeTextForLookup(value) {
  return trimString(value)
    .toLocaleLowerCase()
    .replace(/\s+/g, "");
}

function createInitialRetrievalState() {
  return {
    triggered: false,
    target_dimension: "",
    success: false,
    window_capped: false,
    degraded_to_bounded: false,
  };
}

function resolveTargetDimensionForEnhancement(primaryDimensionCode) {
  const code = trimString(primaryDimensionCode);
  if (code && code !== QUESTION_JUDGMENT_CODES.primary_dimension.OTHER) {
    return code;
  }
  return QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
}

function resolveRetrievalWindowFromSnapshot(snapshot) {
  const startMonth = trimString(snapshot?.analysis_range?.start_month);
  const endMonth = trimString(snapshot?.analysis_range?.end_month);
  if (!isValidYm(startMonth) || !isValidYm(endMonth) || startMonth > endMonth) {
    return {
      valid: false,
      month_keys: [],
      effective_start_month: "",
      effective_end_month: "",
      window_capped: false,
    };
  }

  const monthKeys = listYmRange(startMonth, endMonth);
  if (monthKeys.length === 0) {
    return {
      valid: false,
      month_keys: [],
      effective_start_month: "",
      effective_end_month: "",
      window_capped: false,
    };
  }

  const clippedKeys =
    monthKeys.length > ON_DEMAND_MAX_WINDOW_MONTHS ? monthKeys.slice(-ON_DEMAND_MAX_WINDOW_MONTHS) : monthKeys;

  return {
    valid: true,
    month_keys: clippedKeys,
    effective_start_month: clippedKeys[0],
    effective_end_month: clippedKeys[clippedKeys.length - 1],
    window_capped: clippedKeys.length !== monthKeys.length,
  };
}

async function fetchSupabaseRestRows(pathWithQuery, token, env) {
  const supabaseUrl = getEnvString(env, "SUPABASE_URL");
  const supabaseAnonKey = getEnvString(env, "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("SUPABASE_CONFIG_MISSING");
  }
  const safeToken = trimString(token);
  if (!safeToken) {
    throw new Error("SUPABASE_TOKEN_MISSING");
  }

  const url = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${pathWithQuery}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${safeToken}`,
      },
    },
    SUPABASE_DATA_UPSTREAM_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`SUPABASE_REST_ERROR_${response.status}`);
  }
  const payload = await parseJsonSafe(response);
  return Array.isArray(payload) ? payload : [];
}

function mapFetchedSalesRecord(row, monthSet) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const ym = extractYmFromDate(row.record_date);
  if (!ym || !monthSet.has(ym)) {
    return null;
  }

  const amount = normalizeNumericValue(row.assessed_amount);
  const quantity = normalizeNumericValue(row.purchase_quantity_boxes);
  if (amount === null || quantity === null) {
    return null;
  }

  return {
    ym,
    amount: roundToTwo(amount) || 0,
    quantity: roundToTwo(quantity) || 0,
    product_name: trimString(row.product_name) || "未命名产品",
    hospital_name: trimString(row.hospital_name) || "未命名医院",
  };
}

async function fetchSalesRecordsByWindow(windowInfo, token, env) {
  const monthSet = new Set(windowInfo.month_keys);
  const startDate = `${windowInfo.effective_start_month}-01`;
  const endDate = `${windowInfo.effective_end_month}-31`;
  const rows = [];

  for (let pageIndex = 0; pageIndex < SUPABASE_DATA_MAX_PAGES; pageIndex += 1) {
    const offset = pageIndex * SUPABASE_DATA_PAGE_SIZE;
    const query = [
      "select=record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount",
      `record_date=gte.${encodeURIComponent(startDate)}`,
      `record_date=lte.${encodeURIComponent(endDate)}`,
      "order=record_date.asc",
      `limit=${SUPABASE_DATA_PAGE_SIZE}`,
      `offset=${offset}`,
    ].join("&");

    const pageRows = await fetchSupabaseRestRows(`sales_records?${query}`, token, env);
    for (const row of pageRows) {
      const mapped = mapFetchedSalesRecord(row, monthSet);
      if (mapped) {
        rows.push(mapped);
      }
    }

    if (pageRows.length < SUPABASE_DATA_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function fetchProductsNameMap(token, env) {
  const rows = await fetchSupabaseRestRows("products?select=id,product_name", token, env);
  const map = new Map();
  rows.forEach((row) => {
    const productId = trimString(row?.id);
    const productName = trimString(row?.product_name);
    const key = normalizeTextForLookup(productName);
    if (!productId || !key || map.has(key)) {
      return;
    }
    map.set(key, productId);
  });
  return map;
}

function resolveControlledRowLimit(existingRows, granularityCode, availableCount) {
  if (!Number.isInteger(availableCount) || availableCount <= 0) {
    return 0;
  }
  const baseSize = Array.isArray(existingRows) ? existingRows.length : 0;
  const growth = granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL ? 4 : 2;
  const floor = granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL ? 5 : 3;
  const target = Math.max(floor, baseSize + growth);
  return Math.min(availableCount, target);
}

function resolveControlledTrendLimit(existingRows, granularityCode, availableCount) {
  if (!Number.isInteger(availableCount) || availableCount <= 0) {
    return 0;
  }
  const baseSize = Array.isArray(existingRows) ? existingRows.length : 0;
  const growth = granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL ? 6 : 3;
  const floor = granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL ? 8 : 4;
  const target = Math.max(floor, baseSize + growth);
  return Math.min(availableCount, target);
}

function buildAggregatedMetrics(records, monthKeys) {
  const monthSet = new Set(monthKeys);
  const monthTotals = new Map();
  const productMap = new Map();
  const hospitalMap = new Map();

  monthKeys.forEach((ym) => {
    monthTotals.set(ym, { amount: 0, quantity: 0 });
  });

  let totalAmount = 0;
  let totalQuantity = 0;

  records.forEach((record) => {
    if (!record || !monthSet.has(record.ym)) {
      return;
    }

    const amount = normalizeNumericValue(record.amount) || 0;
    const quantity = normalizeNumericValue(record.quantity) || 0;
    totalAmount += amount;
    totalQuantity += quantity;

    const monthMetric = monthTotals.get(record.ym) || { amount: 0, quantity: 0 };
    monthMetric.amount += amount;
    monthMetric.quantity += quantity;
    monthTotals.set(record.ym, monthMetric);

    const productKey = trimString(record.product_name) || "未命名产品";
    const productMetric = productMap.get(productKey) || { name: productKey, amount: 0, quantity: 0, monthly: new Map() };
    productMetric.amount += amount;
    productMetric.quantity += quantity;
    const productMonthMetric = productMetric.monthly.get(record.ym) || { amount: 0, quantity: 0 };
    productMonthMetric.amount += amount;
    productMonthMetric.quantity += quantity;
    productMetric.monthly.set(record.ym, productMonthMetric);
    productMap.set(productKey, productMetric);

    const hospitalKey = trimString(record.hospital_name) || "未命名医院";
    const hospitalMetric = hospitalMap.get(hospitalKey) || { name: hospitalKey, amount: 0, quantity: 0, monthly: new Map() };
    hospitalMetric.amount += amount;
    hospitalMetric.quantity += quantity;
    const hospitalMonthMetric = hospitalMetric.monthly.get(record.ym) || { amount: 0, quantity: 0 };
    hospitalMonthMetric.amount += amount;
    hospitalMonthMetric.quantity += quantity;
    hospitalMetric.monthly.set(record.ym, hospitalMonthMetric);
    hospitalMap.set(hospitalKey, hospitalMetric);
  });

  const monthlyRows = monthKeys.map((ym) => {
    const monthMetric = monthTotals.get(ym) || { amount: 0, quantity: 0 };
    const prevYm = addMonthsToYm(ym, -1);
    const yoyYm = addMonthsToYm(ym, -12);
    const prevMetric = monthTotals.get(prevYm) || null;
    const yoyMetric = monthTotals.get(yoyYm) || null;
    return {
      ym,
      amount: roundToTwo(monthMetric.amount) || 0,
      quantity: roundToTwo(monthMetric.quantity) || 0,
      amount_mom_ratio: prevMetric ? calcGrowthRatio(monthMetric.amount, prevMetric.amount) : null,
      amount_yoy_ratio: yoyMetric ? calcGrowthRatio(monthMetric.amount, yoyMetric.amount) : null,
    };
  });

  const toRankedRows = (sourceMap) => {
    const rows = Array.from(sourceMap.values()).map((row) => {
      const amount = roundToTwo(row.amount) || 0;
      const quantity = roundToTwo(row.quantity) || 0;
      const amountShare = totalAmount > 0 ? amount / totalAmount : null;
      const quantityShare = totalQuantity > 0 ? quantity / totalQuantity : null;
      return {
        ...row,
        amount,
        quantity,
        amount_share_ratio: amountShare,
        quantity_share_ratio: quantityShare,
      };
    });
    rows.sort((left, right) => right.amount - left.amount);
    return rows;
  };

  return {
    total_amount: roundToTwo(totalAmount) || 0,
    total_quantity: roundToTwo(totalQuantity) || 0,
    monthly_rows: monthlyRows,
    product_rows: toRankedRows(productMap),
    hospital_rows: toRankedRows(hospitalMap),
  };
}

function buildPerformanceOverviewFromMetrics(metrics) {
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const latestRow = monthlyRows.length > 0 ? monthlyRows[monthlyRows.length - 1] : null;

  let latestKeyChange = "--";
  let latestKeyChangeRatio = null;
  let latestKeyChangeCode = "unknown";
  if (latestRow && normalizeNumericValue(latestRow.amount_mom_ratio) !== null) {
    latestKeyChangeRatio = normalizeNumericValue(latestRow.amount_mom_ratio);
    latestKeyChangeCode = "amount_mom";
    latestKeyChange = `最近月金额环比 ${formatDeltaPercentText(latestKeyChangeRatio)}`;
  } else if (latestRow && normalizeNumericValue(latestRow.amount_yoy_ratio) !== null) {
    latestKeyChangeRatio = normalizeNumericValue(latestRow.amount_yoy_ratio);
    latestKeyChangeCode = "amount_yoy";
    latestKeyChange = `最近月金额同比 ${formatDeltaPercentText(latestKeyChangeRatio)}`;
  }

  return {
    sales_amount: formatAmountWanText(metrics?.total_amount),
    sales_amount_value: normalizeNumericValue(metrics?.total_amount),
    amount_achievement: "--",
    amount_achievement_ratio: null,
    latest_key_change: latestKeyChange,
    latest_key_change_ratio: latestKeyChangeRatio,
    latest_key_change_code: latestKeyChangeCode,
    sales_volume: formatQuantityBoxText(metrics?.total_quantity),
    sales_volume_value: normalizeNumericValue(metrics?.total_quantity),
  };
}

function buildRecentTrendsFromMetrics(metrics, limit) {
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : monthlyRows.length;
  return monthlyRows.slice(-safeLimit).map((row) => ({
    period: trimString(row?.ym),
    sales_amount: formatAmountWanText(row?.amount),
    sales_amount_value: normalizeNumericValue(row?.amount),
    amount_mom: formatDeltaPercentText(row?.amount_mom_ratio),
    amount_mom_ratio: normalizeNumericValue(row?.amount_mom_ratio),
    sales_volume: formatQuantityBoxText(row?.quantity),
    sales_volume_value: normalizeNumericValue(row?.quantity),
  }));
}

function buildKeyBusinessSignals(metrics, options = {}) {
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const productRows = Array.isArray(metrics?.product_rows) ? metrics.product_rows : [];
  const hospitalRows = Array.isArray(metrics?.hospital_rows) ? metrics.hospital_rows : [];
  const target = trimString(options.targetDimension);

  const signals = [];
  const latestRow = monthlyRows.length > 0 ? monthlyRows[monthlyRows.length - 1] : null;
  if (latestRow && normalizeNumericValue(latestRow.amount_mom_ratio) !== null) {
    const ratio = normalizeNumericValue(latestRow.amount_mom_ratio);
    const trendText = ratio > 0 ? "上升" : ratio < 0 ? "下降" : "持平";
    signals.push(`最近月（${latestRow.ym}）销售额较上月${trendText}，变动${formatDeltaPercentText(ratio)}。`);
  } else if (latestRow && normalizeNumericValue(latestRow.amount_yoy_ratio) !== null) {
    const ratio = normalizeNumericValue(latestRow.amount_yoy_ratio);
    const trendText = ratio > 0 ? "上升" : ratio < 0 ? "下降" : "持平";
    signals.push(`最近月（${latestRow.ym}）销售额同比${trendText}，变动${formatDeltaPercentText(ratio)}。`);
  }

  if (target === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    const topHospital = hospitalRows[0];
    if (topHospital) {
      signals.push(
        `Top1医院${topHospital.name}贡献销售额${formatAmountWanText(topHospital.amount)}，占比${formatPercentText(topHospital.amount_share_ratio)}。`,
      );
    }
  } else {
    const topProduct = productRows[0];
    if (topProduct) {
      signals.push(
        `Top1产品${topProduct.name}贡献销售额${formatAmountWanText(topProduct.amount)}，占比${formatPercentText(topProduct.amount_share_ratio)}。`,
      );
    }
  }

  return signals.slice(0, 2);
}

function calcEntityRatioByYm(monthlyMap, currentYm, deltaMonths) {
  if (!(monthlyMap instanceof Map)) {
    return null;
  }
  const current = monthlyMap.get(currentYm);
  const baseYm = addMonthsToYm(currentYm, deltaMonths);
  const base = monthlyMap.get(baseYm);
  if (!current || !base) {
    return null;
  }
  return calcGrowthRatio(current.amount, base.amount);
}

function buildProductPerformanceRows(metrics, limit, productNameMap) {
  const rows = Array.isArray(metrics?.product_rows) ? metrics.product_rows : [];
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const latestYm = trimString(monthlyRows[monthlyRows.length - 1]?.ym);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : rows.length;

  return rows.slice(0, safeLimit).map((row) => {
    const yoyRatio = latestYm ? calcEntityRatioByYm(row.monthly, latestYm, -12) : null;
    const momRatio = latestYm ? calcEntityRatioByYm(row.monthly, latestYm, -1) : null;
    let changeMetric = "变化值";
    let changeMetricCode = "unknown";
    let changeValue = "--";
    let changeValueRatio = null;

    if (normalizeNumericValue(yoyRatio) !== null) {
      changeMetric = "金额同比";
      changeMetricCode = "amount_yoy";
      changeValue = formatDeltaPercentText(yoyRatio);
      changeValueRatio = normalizeNumericValue(yoyRatio);
    } else if (normalizeNumericValue(momRatio) !== null) {
      changeMetric = "金额环比";
      changeMetricCode = "amount_mom";
      changeValue = formatDeltaPercentText(momRatio);
      changeValueRatio = normalizeNumericValue(momRatio);
    }

    const lookupKey = normalizeTextForLookup(row.name);
    const productCode = lookupKey && productNameMap instanceof Map ? trimString(productNameMap.get(lookupKey)) : "";

    return {
      product_name: row.name,
      product_code: productCode,
      sales_amount: formatAmountWanText(row.amount),
      sales_amount_value: normalizeNumericValue(row.amount),
      sales_share: formatPercentText(row.amount_share_ratio),
      sales_share_ratio: normalizeNumericValue(row.amount_share_ratio),
      change_metric: changeMetric,
      change_metric_code: changeMetricCode,
      change_value: changeValue,
      change_value_ratio: changeValueRatio,
    };
  });
}

function buildHospitalPerformanceRows(metrics, limit) {
  const rows = Array.isArray(metrics?.hospital_rows) ? metrics.hospital_rows : [];
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const latestYm = trimString(monthlyRows[monthlyRows.length - 1]?.ym);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : rows.length;

  return rows.slice(0, safeLimit).map((row) => {
    const yoyRatio = latestYm ? calcEntityRatioByYm(row.monthly, latestYm, -12) : null;
    const momRatio = latestYm ? calcEntityRatioByYm(row.monthly, latestYm, -1) : null;
    let changeMetric = "变化值";
    let changeMetricCode = "unknown";
    let changeValue = "--";
    let changeValueRatio = null;
    if (normalizeNumericValue(yoyRatio) !== null) {
      changeMetric = "金额同比";
      changeMetricCode = "amount_yoy";
      changeValue = formatDeltaPercentText(yoyRatio);
      changeValueRatio = normalizeNumericValue(yoyRatio);
    } else if (normalizeNumericValue(momRatio) !== null) {
      changeMetric = "金额环比";
      changeMetricCode = "amount_mom";
      changeValue = formatDeltaPercentText(momRatio);
      changeValueRatio = normalizeNumericValue(momRatio);
    }

    return {
      hospital_name: row.name,
      hospital_code: "",
      sales_amount: formatAmountWanText(row.amount),
      sales_amount_value: normalizeNumericValue(row.amount),
      sales_share: formatPercentText(row.amount_share_ratio),
      sales_share_ratio: normalizeNumericValue(row.amount_share_ratio),
      change_metric: changeMetric,
      change_metric_code: changeMetricCode,
      change_value: changeValue,
      change_value_ratio: changeValueRatio,
    };
  });
}

function buildRiskOpportunityHints(metrics) {
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const productRows = Array.isArray(metrics?.product_rows) ? metrics.product_rows : [];
  const hospitalRows = Array.isArray(metrics?.hospital_rows) ? metrics.hospital_rows : [];

  const riskAlerts = [];
  const opportunityHints = [];

  const latestRow = monthlyRows.length > 0 ? monthlyRows[monthlyRows.length - 1] : null;
  if (latestRow && normalizeNumericValue(latestRow.amount_mom_ratio) !== null) {
    const momRatio = normalizeNumericValue(latestRow.amount_mom_ratio);
    if (momRatio < 0) {
      riskAlerts.push(`最近月（${latestRow.ym}）销售额环比下滑${formatDeltaPercentText(momRatio)}，需关注短期波动风险。`);
    } else if (momRatio > 0) {
      opportunityHints.push(`最近月（${latestRow.ym}）销售额环比增长${formatDeltaPercentText(momRatio)}，可延续当前有效动作。`);
    }
  }

  const topProduct = productRows[0];
  if (topProduct && normalizeNumericValue(topProduct.amount_share_ratio) !== null) {
    const share = normalizeNumericValue(topProduct.amount_share_ratio);
    if (share >= 0.6) {
      riskAlerts.push(`Top1产品占比${formatPercentText(share)}，结构集中度偏高，需防止单品波动风险。`);
    } else if (share <= 0.4) {
      opportunityHints.push(`Top1产品占比${formatPercentText(share)}，结构相对均衡，可挖掘协同增长机会。`);
    }
  }

  if (hospitalRows.length > 6) {
    opportunityHints.push("医院覆盖层级较丰富，可梳理长尾医院分层推进节奏。");
  }

  return {
    risk_alerts: riskAlerts.slice(0, 2),
    opportunity_hints: opportunityHints.slice(0, 2),
  };
}

async function buildDimensionEnhancementPayload(params) {
  const targetDimension = trimString(params?.targetDimension);
  const granularityCode = trimString(params?.granularityCode);
  const metrics = params?.metrics && typeof params.metrics === "object" ? params.metrics : {};
  const sourceSnapshot = params?.sourceSnapshot && typeof params.sourceSnapshot === "object" ? params.sourceSnapshot : {};
  const authToken = trimString(params?.authToken);
  const env = params?.env;

  const monthlyRows = Array.isArray(metrics.monthly_rows) ? metrics.monthly_rows : [];
  const productRows = Array.isArray(metrics.product_rows) ? metrics.product_rows : [];
  const hospitalRows = Array.isArray(metrics.hospital_rows) ? metrics.hospital_rows : [];
  const baseTrends = Array.isArray(sourceSnapshot?.recent_trends) ? sourceSnapshot.recent_trends : [];
  const baseProducts = Array.isArray(sourceSnapshot?.product_performance) ? sourceSnapshot.product_performance : [];
  const baseHospitals = Array.isArray(sourceSnapshot?.hospital_performance) ? sourceSnapshot.hospital_performance : [];

  const trendLimit = resolveControlledTrendLimit(baseTrends, granularityCode, monthlyRows.length);
  const productLimit = resolveControlledRowLimit(baseProducts, granularityCode, productRows.length);
  const hospitalLimit = resolveControlledRowLimit(baseHospitals, granularityCode, hospitalRows.length);

  const payload = {
    performance_overview: buildPerformanceOverviewFromMetrics(metrics),
    key_business_signals: buildKeyBusinessSignals(metrics, { targetDimension }),
    recent_trends: buildRecentTrendsFromMetrics(metrics, trendLimit),
    product_performance: [],
    hospital_performance: [],
    risk_alerts: [],
    opportunity_hints: [],
  };

  if (targetDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    let productNameMap = new Map();
    if (authToken && env) {
      try {
        productNameMap = await fetchProductsNameMap(authToken, env);
      } catch (_error) {
        productNameMap = new Map();
      }
    }
    payload.product_performance = buildProductPerformanceRows(metrics, productLimit, productNameMap);
  }

  if (targetDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    payload.hospital_performance = buildHospitalPerformanceRows(metrics, hospitalLimit);
  }

  if (targetDimension === QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY) {
    const riskHints = buildRiskOpportunityHints(metrics);
    payload.risk_alerts = riskHints.risk_alerts;
    payload.opportunity_hints = riskHints.opportunity_hints;
  }

  return payload;
}

function mergeSnapshotByTargetDimension(baseSnapshot, enhancementPayload, targetDimension) {
  const merged = normalizeBusinessSnapshot(baseSnapshot);
  const enhancement = enhancementPayload && typeof enhancementPayload === "object" ? enhancementPayload : {};

  const applyOverallLikeFields = () => {
    if (enhancement.performance_overview && Object.keys(enhancement.performance_overview).length > 0) {
      merged.performance_overview = normalizeSnapshotObject(enhancement.performance_overview);
    }
    if (Array.isArray(enhancement.key_business_signals)) {
      merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
    }
    if (Array.isArray(enhancement.recent_trends)) {
      merged.recent_trends = normalizeSnapshotObjectArray(enhancement.recent_trends);
    }
  };

  switch (targetDimension) {
    case QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT:
      if (Array.isArray(enhancement.product_performance)) {
        merged.product_performance = normalizeSnapshotObjectArray(enhancement.product_performance);
      }
      if (Array.isArray(enhancement.key_business_signals)) {
        merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
      }
      if (Array.isArray(enhancement.recent_trends)) {
        merged.recent_trends = normalizeSnapshotObjectArray(enhancement.recent_trends);
      }
      break;
    case QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL:
      if (Array.isArray(enhancement.hospital_performance)) {
        merged.hospital_performance = normalizeSnapshotObjectArray(enhancement.hospital_performance);
      }
      if (Array.isArray(enhancement.key_business_signals)) {
        merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
      }
      break;
    case QUESTION_JUDGMENT_CODES.primary_dimension.TREND:
      if (Array.isArray(enhancement.recent_trends)) {
        merged.recent_trends = normalizeSnapshotObjectArray(enhancement.recent_trends);
      }
      if (Array.isArray(enhancement.key_business_signals)) {
        merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
      }
      break;
    case QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY:
      if (Array.isArray(enhancement.risk_alerts)) {
        merged.risk_alerts = normalizeSnapshotStringArray(enhancement.risk_alerts);
      }
      if (Array.isArray(enhancement.opportunity_hints)) {
        merged.opportunity_hints = normalizeSnapshotStringArray(enhancement.opportunity_hints);
      }
      if (Array.isArray(enhancement.key_business_signals)) {
        merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
      }
      break;
    case QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL:
    default:
      applyOverallLikeFields();
      break;
  }

  return merged;
}

async function buildOnDemandSnapshotEnhancement(params) {
  const routeCode = trimString(params?.routeDecision?.route?.code);
  const sourceSnapshot = normalizeBusinessSnapshot(params?.businessSnapshot);
  const retrievalState = createInitialRetrievalState();

  if (routeCode !== ROUTE_DECISION_CODES.NEED_MORE_DATA) {
    return {
      effectiveSnapshot: sourceSnapshot,
      retrievalState,
    };
  }

  retrievalState.triggered = true;
  const targetDimension = resolveTargetDimensionForEnhancement(params?.questionJudgment?.primary_dimension?.code);
  retrievalState.target_dimension = targetDimension;

  const windowInfo = resolveRetrievalWindowFromSnapshot(sourceSnapshot);
  retrievalState.window_capped = Boolean(windowInfo.window_capped);
  if (!windowInfo.valid) {
    return {
      effectiveSnapshot: sourceSnapshot,
      retrievalState,
    };
  }

  let records = [];
  try {
    records = await fetchSalesRecordsByWindow(windowInfo, params?.authToken, params?.env);
  } catch (_error) {
    return {
      effectiveSnapshot: sourceSnapshot,
      retrievalState,
    };
  }

  if (records.length === 0) {
    return {
      effectiveSnapshot: sourceSnapshot,
      retrievalState,
    };
  }

  const metrics = buildAggregatedMetrics(records, windowInfo.month_keys);
  const enhancementPayload = await buildDimensionEnhancementPayload({
    targetDimension,
    granularityCode: trimString(params?.questionJudgment?.granularity?.code),
    metrics,
    sourceSnapshot,
    authToken: params?.authToken,
    env: params?.env,
  });
  const merged = mergeSnapshotByTargetDimension(sourceSnapshot, enhancementPayload, targetDimension);
  retrievalState.success = true;

  return {
    effectiveSnapshot: merged,
    retrievalState,
  };
}

function normalizeSessionHistoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const role = trimString(item.role).toLocaleLowerCase();
  if (!SESSION_HISTORY_ROLE_SET.has(role)) {
    return null;
  }
  const content = trimString(item.content);
  if (!content) {
    return null;
  }
  return { role, content };
}

function normalizeSessionHistoryWindow(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  const sanitized = history.map((item) => normalizeSessionHistoryItem(item)).filter((item) => item !== null);
  if (sanitized.length <= SESSION_HISTORY_WINDOW_MAX_ITEMS) {
    return sanitized;
  }
  return sanitized.slice(sanitized.length - SESSION_HISTORY_WINDOW_MAX_ITEMS);
}

function getPreviousUserMessage(historyWindow, currentMessage = "") {
  const currentText = trimString(currentMessage);
  if (!Array.isArray(historyWindow) || historyWindow.length === 0) {
    return "";
  }
  for (let index = historyWindow.length - 1; index >= 0; index -= 1) {
    const item = historyWindow[index];
    if (!item || item.role !== "user") {
      continue;
    }
    const content = trimString(item.content);
    if (!content) {
      continue;
    }
    if (currentText && content === currentText) {
      continue;
    }
    return content;
  }
  return "";
}

function containsAnyPattern(text, patterns) {
  if (!text || !Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => pattern instanceof RegExp && pattern.test(text));
}

function hasShortFollowupSignal(messageText) {
  const text = trimString(messageText);
  if (!text) {
    return false;
  }
  if (containsAnyKeyword(text, SESSION_SHORT_FOLLOWUP_CUES)) {
    return true;
  }
  return /^(为什么|具体呢?|哪个|怎么做|怎么推进|继续|展开|那呢|然后呢|还有呢)[\s？?。！!]*$/i.test(text);
}

function hasFollowupSignal(messageText) {
  const text = trimString(messageText);
  if (!text) {
    return false;
  }
  return containsAnyKeyword(text, SESSION_FOLLOWUP_CUES) || hasShortFollowupSignal(text);
}

function hasScopeOverrideSignal(messageText) {
  const text = trimString(messageText);
  if (!text) {
    return false;
  }
  return containsAnyKeyword(text, SESSION_SCOPE_OVERRIDE_CUES) || containsAnyPattern(text, SESSION_SCOPE_OVERRIDE_PATTERNS);
}

function hasHardTopicShiftSignal(messageText) {
  return containsAnyKeyword(trimString(messageText), SESSION_HARD_TOPIC_SHIFT_CUES);
}

function resolveExplicitDimensionCode(messageText) {
  const text = trimString(messageText);
  if (!text) {
    return "";
  }
  if (containsAnyKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.product)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  }
  if (containsAnyKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.hospital)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL;
  }
  if (containsAnyKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.trend)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.TREND;
  }
  if (containsAnyKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.risk_opportunity)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY;
  }
  if (containsAnyKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.overall)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  }
  return "";
}

function hasExplicitDimensionSignal(messageText) {
  return Boolean(resolveExplicitDimensionCode(messageText));
}

function detectTopicShift(messageText, questionJudgment, previousQuestionJudgment, scopeOverrideDetected) {
  const relevanceCode = trimString(questionJudgment?.relevance?.code);
  if (relevanceCode === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT) {
    return true;
  }
  if (hasHardTopicShiftSignal(messageText)) {
    return true;
  }
  if (!previousQuestionJudgment || typeof previousQuestionJudgment !== "object") {
    return false;
  }

  const currentDimension = trimString(questionJudgment?.primary_dimension?.code);
  const previousDimension = trimString(previousQuestionJudgment?.primary_dimension?.code);
  if (!currentDimension || !previousDimension || currentDimension === previousDimension) {
    return false;
  }

  const explicitDimension = resolveExplicitDimensionCode(messageText);
  if (!explicitDimension) {
    return false;
  }

  if (scopeOverrideDetected && explicitDimension === previousDimension) {
    return false;
  }
  return explicitDimension !== previousDimension;
}

function judgeIsFollowup(messageText, previousUserText, scopeOverrideDetected) {
  const previousText = trimString(previousUserText);
  if (!previousText) {
    return false;
  }
  if (hasFollowupSignal(messageText)) {
    return true;
  }
  return Boolean(scopeOverrideDetected);
}

function judgeInheritPrimaryDimension(
  messageText,
  isFollowup,
  topicShiftDetected,
  currentQuestionJudgment,
  previousQuestionJudgment,
) {
  if (!isFollowup || topicShiftDetected) {
    return false;
  }
  const currentDimension = trimString(currentQuestionJudgment?.primary_dimension?.code);
  const previousDimension = trimString(previousQuestionJudgment?.primary_dimension?.code);
  if (currentDimension && previousDimension && currentDimension === previousDimension) {
    return true;
  }
  if (hasShortFollowupSignal(messageText) && !hasExplicitDimensionSignal(messageText)) {
    return true;
  }
  return false;
}

function judgeInheritScope(messageText, isFollowup, topicShiftDetected, scopeOverrideDetected) {
  if (!isFollowup || topicShiftDetected) {
    return false;
  }
  if (scopeOverrideDetected) {
    return false;
  }
  return true;
}

function buildSessionState(message, historyWindow, questionJudgment) {
  const messageText = normalizeQuestionText(message);
  const previousUserText = getPreviousUserMessage(historyWindow, message);
  const previousQuestionJudgment = previousUserText ? buildQuestionJudgment(previousUserText) : null;
  const scopeOverrideDetected = hasScopeOverrideSignal(messageText);
  const topicShiftDetected = detectTopicShift(
    messageText,
    questionJudgment,
    previousQuestionJudgment,
    scopeOverrideDetected,
  );
  const isFollowup = judgeIsFollowup(messageText, previousUserText, scopeOverrideDetected);

  let inheritPrimaryDimension = judgeInheritPrimaryDimension(
    messageText,
    isFollowup,
    topicShiftDetected,
    questionJudgment,
    previousQuestionJudgment,
  );
  let inheritScope = judgeInheritScope(messageText, isFollowup, topicShiftDetected, scopeOverrideDetected);

  if (topicShiftDetected) {
    inheritPrimaryDimension = false;
    inheritScope = false;
  }
  if (!isFollowup) {
    inheritPrimaryDimension = false;
    inheritScope = false;
  }

  return {
    is_followup: isFollowup,
    inherit_primary_dimension: inheritPrimaryDimension,
    inherit_scope: inheritScope,
    topic_shift_detected: topicShiftDetected,
  };
}

function toDataAvailabilityItem(groupKey, code) {
  const labels = DATA_AVAILABILITY_LABELS[groupKey] || {};
  return {
    code,
    label: labels[code] || "",
  };
}

function isMissingDisplayValue(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const lowered = trimString(value).toLocaleLowerCase();
  return lowered === "" || lowered === "--" || lowered === "unknown";
}

function isEffectiveScalar(value, key = "") {
  if (value === null || value === undefined) {
    return false;
  }
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
    if (String(key || "").endsWith("_code") && trimString(value).toLocaleLowerCase() === "unknown") {
      return false;
    }
    return true;
  }
  return false;
}

function hasEffectiveArrayContent(value) {
  if (!Array.isArray(value) || value.length === 0) {
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

function hasEffectiveObjectContent(value) {
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

function hasEffectiveSnapshotField(snapshot, fieldName) {
  const value = snapshot?.[fieldName];
  if (Array.isArray(value)) {
    return hasEffectiveArrayContent(value);
  }
  if (value && typeof value === "object") {
    return hasEffectiveObjectContent(value);
  }
  return isEffectiveScalar(value, fieldName);
}

function hasEffectiveBusinessContent(snapshot) {
  const businessFields = [
    "performance_overview",
    "key_business_signals",
    "product_performance",
    "hospital_performance",
    "recent_trends",
    "risk_alerts",
    "opportunity_hints",
  ];
  return businessFields.some((fieldName) => hasEffectiveSnapshotField(snapshot, fieldName));
}

function judgeBusinessDataAvailability(snapshot) {
  const hasBusinessData = hasEffectiveBusinessContent(snapshot);
  const code = hasBusinessData
    ? DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE
    : DATA_AVAILABILITY_CODES.has_business_data.UNAVAILABLE;
  return toDataAvailabilityItem("has_business_data", code);
}

function judgeDimensionAvailability(snapshot, questionJudgment, hasBusinessDataCode) {
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);

  const hasPerformanceOverview = hasEffectiveSnapshotField(snapshot, "performance_overview");
  const hasKeyBusinessSignals = hasEffectiveSnapshotField(snapshot, "key_business_signals");
  const hasProductPerformance = hasEffectiveSnapshotField(snapshot, "product_performance");
  const hasHospitalPerformance = hasEffectiveSnapshotField(snapshot, "hospital_performance");
  const hasRecentTrends = hasEffectiveSnapshotField(snapshot, "recent_trends");
  const hasRiskAlerts = hasEffectiveSnapshotField(snapshot, "risk_alerts");
  const hasOpportunityHints = hasEffectiveSnapshotField(snapshot, "opportunity_hints");

  let code = DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
  switch (primaryDimensionCode) {
    case QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL: {
      if (hasPerformanceOverview && (hasKeyBusinessSignals || hasRecentTrends)) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
      } else if (hasPerformanceOverview || hasKeyBusinessSignals || hasRecentTrends) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
      }
      break;
    }
    case QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT: {
      if (hasProductPerformance) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
      } else if (hasKeyBusinessSignals || hasRecentTrends) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
      }
      break;
    }
    case QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL: {
      code = hasHospitalPerformance
        ? DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE
        : DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
      break;
    }
    case QUESTION_JUDGMENT_CODES.primary_dimension.TREND: {
      if (hasRecentTrends) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
      } else if (hasPerformanceOverview || hasKeyBusinessSignals) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
      }
      break;
    }
    case QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY: {
      if (hasRiskAlerts || hasOpportunityHints) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
      } else if (hasKeyBusinessSignals) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
      }
      break;
    }
    default: {
      code =
        hasBusinessDataCode === DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE
          ? DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL
          : DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
    }
  }

  return toDataAvailabilityItem("dimension_availability", code);
}

function getGranularityCode(questionJudgment) {
  const code = trimString(questionJudgment?.granularity?.code);
  if (code === QUESTION_JUDGMENT_CODES.granularity.DETAIL) {
    return QUESTION_JUDGMENT_CODES.granularity.DETAIL;
  }
  return QUESTION_JUDGMENT_CODES.granularity.SUMMARY;
}

function countObjectRowsWithAnyEffectiveKeys(rows, keys) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }
  return rows.filter((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return false;
    }
    return keys.some((key) => isEffectiveScalar(row[key], key));
  }).length;
}

function hasDetailedSupport(snapshot, primaryDimensionCode) {
  if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    const rows = Array.isArray(snapshot?.product_performance) ? snapshot.product_performance : [];
    if (rows.length < 2) return false;
    return countObjectRowsWithAnyEffectiveKeys(rows, ["sales_amount_value", "sales_share_ratio", "change_value_ratio"]) >= 2;
  }

  if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.TREND) {
    const rows = Array.isArray(snapshot?.recent_trends) ? snapshot.recent_trends : [];
    if (rows.length < 3) return false;
    const amountSupportCount = countObjectRowsWithAnyEffectiveKeys(rows, ["sales_amount_value"]);
    const momSupportCount = countObjectRowsWithAnyEffectiveKeys(rows, ["amount_mom_ratio"]);
    return amountSupportCount >= 2 && momSupportCount >= 1;
  }

  if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    const rows = Array.isArray(snapshot?.hospital_performance) ? snapshot.hospital_performance : [];
    if (rows.length < 2) return false;
    return (
      countObjectRowsWithAnyEffectiveKeys(rows, [
        "sales_amount_value",
        "sales_share_ratio",
        "change_value_ratio",
        "amount_yoy_ratio",
      ]) >= 2
    );
  }

  return false;
}

function judgeAnswerDepth(questionJudgment, dimensionAvailabilityCode, snapshot) {
  const granularityCode = getGranularityCode(questionJudgment);
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);

  let code = DATA_AVAILABILITY_CODES.answer_depth.OVERALL;
  if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE) {
    code = DATA_AVAILABILITY_CODES.answer_depth.OVERALL;
  } else if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL) {
    code =
      granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL
        ? DATA_AVAILABILITY_CODES.answer_depth.OVERALL
        : DATA_AVAILABILITY_CODES.answer_depth.FOCUSED;
  } else if (granularityCode === QUESTION_JUDGMENT_CODES.granularity.SUMMARY) {
    code = DATA_AVAILABILITY_CODES.answer_depth.FOCUSED;
  } else {
    code = hasDetailedSupport(snapshot, primaryDimensionCode)
      ? DATA_AVAILABILITY_CODES.answer_depth.DETAILED
      : DATA_AVAILABILITY_CODES.answer_depth.FOCUSED;
  }

  return toDataAvailabilityItem("answer_depth", code);
}

function getAnswerDepthRank(code) {
  switch (code) {
    case DATA_AVAILABILITY_CODES.answer_depth.DETAILED:
      return 3;
    case DATA_AVAILABILITY_CODES.answer_depth.FOCUSED:
      return 2;
    default:
      return 1;
  }
}

function getRequiredDepthCode(questionJudgment) {
  const granularityCode = getGranularityCode(questionJudgment);
  return granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL
    ? DATA_AVAILABILITY_CODES.answer_depth.DETAILED
    : DATA_AVAILABILITY_CODES.answer_depth.FOCUSED;
}

function judgeGapHintNeeded(questionJudgment, hasBusinessDataCode, dimensionAvailabilityCode, answerDepthCode) {
  const requiredDepthCode = getRequiredDepthCode(questionJudgment);

  const needHint =
    hasBusinessDataCode === DATA_AVAILABILITY_CODES.has_business_data.UNAVAILABLE ||
    dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE ||
    (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL &&
      getGranularityCode(questionJudgment) === QUESTION_JUDGMENT_CODES.granularity.DETAIL) ||
    getAnswerDepthRank(requiredDepthCode) > getAnswerDepthRank(answerDepthCode);

  const code = needHint ? DATA_AVAILABILITY_CODES.gap_hint_needed.YES : DATA_AVAILABILITY_CODES.gap_hint_needed.NO;
  return toDataAvailabilityItem("gap_hint_needed", code);
}

function buildDataAvailability(snapshot, questionJudgment) {
  const hasBusinessData = judgeBusinessDataAvailability(snapshot);
  const dimensionAvailability = judgeDimensionAvailability(snapshot, questionJudgment, hasBusinessData.code);
  const answerDepth = judgeAnswerDepth(questionJudgment, dimensionAvailability.code, snapshot);
  const gapHintNeeded = judgeGapHintNeeded(
    questionJudgment,
    hasBusinessData.code,
    dimensionAvailability.code,
    answerDepth.code,
  );

  return {
    has_business_data: hasBusinessData,
    dimension_availability: dimensionAvailability,
    answer_depth: answerDepth,
    gap_hint_needed: gapHintNeeded,
  };
}

function toRouteItem(code) {
  return {
    code,
    label: ROUTE_DECISION_LABELS[code] || "",
  };
}

function pushReasonCode(reasonCodes, code) {
  if (!Array.isArray(reasonCodes) || !code) {
    return;
  }
  if (!reasonCodes.includes(code)) {
    reasonCodes.push(code);
  }
}

function buildRouteDecision(questionJudgment, dataAvailability, sessionState) {
  const relevanceCode = trimString(questionJudgment?.relevance?.code);
  const granularityCode = trimString(questionJudgment?.granularity?.code);
  const hasBusinessDataCode = trimString(dataAvailability?.has_business_data?.code);
  const dimensionAvailabilityCode = trimString(dataAvailability?.dimension_availability?.code);
  const answerDepthCode = trimString(dataAvailability?.answer_depth?.code);
  const gapHintNeededCode = trimString(dataAvailability?.gap_hint_needed?.code);

  if (relevanceCode === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT) {
    return {
      route: toRouteItem(ROUTE_DECISION_CODES.REFUSE),
      reason_codes: [ROUTE_REASON_CODES.IRRELEVANT],
    };
  }

  const needMoreDataReasons = [];
  if (hasBusinessDataCode === DATA_AVAILABILITY_CODES.has_business_data.UNAVAILABLE) {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.NO_BUSINESS_DATA);
  }
  if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE) {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.DIMENSION_UNAVAILABLE);
  }
  const isDetailRequestedButInsufficient =
    granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL &&
    answerDepthCode !== DATA_AVAILABILITY_CODES.answer_depth.DETAILED &&
    gapHintNeededCode === DATA_AVAILABILITY_CODES.gap_hint_needed.YES;
  if (isDetailRequestedButInsufficient) {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.DETAIL_REQUESTED_BUT_INSUFFICIENT);
  }
  if (needMoreDataReasons.length > 0) {
    return {
      route: toRouteItem(ROUTE_DECISION_CODES.NEED_MORE_DATA),
      reason_codes: needMoreDataReasons,
    };
  }

  const boundedAnswerReasons = [];
  if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL) {
    pushReasonCode(boundedAnswerReasons, ROUTE_REASON_CODES.DIMENSION_PARTIAL);
  }
  if (gapHintNeededCode === DATA_AVAILABILITY_CODES.gap_hint_needed.YES) {
    pushReasonCode(boundedAnswerReasons, ROUTE_REASON_CODES.GAP_HINT_NEEDED);
  }
  if (boundedAnswerReasons.length > 0) {
    return {
      route: toRouteItem(ROUTE_DECISION_CODES.BOUNDED_ANSWER),
      reason_codes: boundedAnswerReasons,
    };
  }

  return {
    route: toRouteItem(ROUTE_DECISION_CODES.DIRECT_ANSWER),
    reason_codes: [ROUTE_REASON_CODES.SUFFICIENT],
  };
}

function forceBoundedRouteDecision(dataAvailability) {
  const reasons = [];
  if (trimString(dataAvailability?.dimension_availability?.code) === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL) {
    pushReasonCode(reasons, ROUTE_REASON_CODES.DIMENSION_PARTIAL);
  }
  if (trimString(dataAvailability?.gap_hint_needed?.code) === DATA_AVAILABILITY_CODES.gap_hint_needed.YES) {
    pushReasonCode(reasons, ROUTE_REASON_CODES.GAP_HINT_NEEDED);
  }
  if (reasons.length === 0) {
    pushReasonCode(reasons, ROUTE_REASON_CODES.GAP_HINT_NEEDED);
  }
  return {
    route: toRouteItem(ROUTE_DECISION_CODES.BOUNDED_ANSWER),
    reason_codes: reasons,
  };
}

function buildOutputContext(finalRouteDecision, finalQuestionJudgment, finalDataAvailability) {
  const routeCode = trimString(finalRouteDecision?.route?.code);
  const primaryDimensionCode = trimString(finalQuestionJudgment?.primary_dimension?.code);
  const granularityCode = trimString(finalQuestionJudgment?.granularity?.code);
  return {
    route_code: routeCode,
    primary_dimension_code: primaryDimensionCode,
    granularity_code: granularityCode,
    boundary_needed: routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER,
    refuse_mode: routeCode === ROUTE_DECISION_CODES.REFUSE,
    dimension_availability_code: trimString(finalDataAvailability?.dimension_availability?.code),
    answer_depth_code: trimString(finalDataAvailability?.answer_depth?.code),
  };
}

function shouldLogPhase2Trace(env) {
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
  };
}

function buildPhase2Trace({
  requestId,
  questionJudgment,
  dataAvailability,
  sessionState,
  routeDecision,
  retrievalState,
  outputContext,
  forcedBounded,
}) {
  return {
    requestId: trimString(requestId),
    questionJudgment: toQuestionJudgmentTrace(questionJudgment),
    dataAvailability: toDataAvailabilityTrace(dataAvailability),
    sessionState: toSessionStateTrace(sessionState),
    routeDecision: toRouteDecisionTrace(routeDecision),
    retrievalState: toRetrievalStateTrace(retrievalState),
    outputContext: toOutputContextTrace(outputContext),
    forced_bounded: Boolean(forcedBounded),
  };
}

function logPhase2Trace(tracePayload, env) {
  if (!shouldLogPhase2Trace(env)) {
    return;
  }
  try {
    console.log("[chat.phase2.trace]", JSON.stringify(tracePayload));
  } catch (_error) {
    // no-op: trace logging should never affect primary request flow.
  }
}

function buildOutputInstructionText(outputContext) {
  const routeCode = trimString(outputContext?.route_code);
  if (routeCode === ROUTE_DECISION_CODES.DIRECT_ANSWER) {
    return [
      "输出层约束（direct_answer）：",
      "1) 按“结论 -> 依据/分析 -> 建议（如适用）”组织回答。",
      "2) 至少给出1~2个业务依据点。",
      "3) 不要提及系统流程、内部路由、补强过程、数据调取过程。",
      "4) 不要使用“需要补数据/系统判断”等边界话术。",
    ].join("\n");
  }

  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER) {
    return [
      "输出层约束（bounded_answer）：",
      "1) 必须先给当前可得结论，再说明边界，再给可继续深入方向。",
      "2) 不要要求用户手动补数据。",
      "3) 不要提及内部流程（例如补强、路由、系统状态）。",
      "4) 使用业务化表达，不写系统提示或报错语气。",
    ].join("\n");
  }

  if (routeCode === ROUTE_DECISION_CODES.REFUSE) {
    return [
      "输出层约束（refuse）：",
      "1) 用简洁语气收住，并引导回医药销售业务分析范围。",
      "2) 给2~3个可问示例，不展开原问题。",
    ].join("\n");
  }

  return "";
}

function buildRefuseReplyTemplate(_outputContext) {
  return [
    "这个问题不在我当前的医药销售业务分析职责范围内。",
    "你可以这样问我：1) 本月整体业绩和达成情况如何？2) 当前应优先推进哪个产品？3) 哪些医院是近期重点机会？",
  ].join("\n");
}

function hasBoundaryHintSentence(text) {
  if (!text) return false;
  const lowered = text.toLocaleLowerCase();
  const keywords = ["边界", "当前可用", "当前信息", "现阶段", "进一步", "继续深入", "可再按", "可继续"];
  return keywords.some((keyword) => lowered.includes(keyword));
}

function hasRefuseExamples(text) {
  if (!text) return false;
  const lowered = text.toLocaleLowerCase();
  return lowered.includes("你可以这样问") || lowered.includes("例如") || /1\).+2\)/.test(text);
}

function normalizeOutputReply(reply, outputContext) {
  const routeCode = trimString(outputContext?.route_code);
  let normalized = trimString(reply)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  if (routeCode === ROUTE_DECISION_CODES.REFUSE && !hasRefuseExamples(normalized)) {
    normalized = [
      normalized || "这个问题不在我当前的医药销售业务分析职责范围内。",
      "你可以这样问我：1) 本月整体业绩和达成情况如何？2) 当前应优先推进哪个产品？3) 哪些医院是近期重点机会？",
    ]
      .filter((item) => item)
      .join("\n");
  }

  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER && !hasBoundaryHintSentence(normalized)) {
    const boundaryFallback = "基于当前可用业务信息，以上结论可用于方向判断，若继续深入可再按产品、医院或时间层级细拆。";
    normalized = [normalized, boundaryFallback].filter((item) => item).join("\n\n");
  }

  return normalized || "当前可用信息不足，建议换个业务问题再试。";
}

function buildGeminiPayload(message, businessSnapshot, outputContext) {
  const systemInstructionText = buildAssistantRoleSystemInstruction(ASSISTANT_ROLE_DEFINITION);
  const outputInstructionText = buildOutputInstructionText(outputContext);
  const mergedSystemInstructionText = outputInstructionText
    ? `${systemInstructionText}\n\n${outputInstructionText}`
    : systemInstructionText;
  const normalizedSnapshot = normalizeBusinessSnapshot(businessSnapshot);
  const userPromptText = [
    "以下是当前业务快照（business_snapshot），请将其作为本轮回答的事实依据。",
    "如果快照中的数据不足，请明确说明“数据不足”，不要编造。",
    "",
    "business_snapshot:",
    JSON.stringify(normalizedSnapshot, null, 2),
    "",
    `用户问题：${message}`,
  ].join("\n");
  return {
    systemInstruction: {
      parts: [
        {
          text: mergedSystemInstructionText,
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPromptText }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  };
}

function extractGeminiReply(payload) {
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

async function callGemini(message, businessSnapshot, outputContext, env) {
  const apiKey = getEnvString(env, "GEMINI_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      code: CHAT_ERROR_CODES.CONFIG_MISSING,
      message: "服务端未配置 GEMINI_API_KEY。",
      status: 500,
    };
  }

  const model = sanitizeModelName(getEnvString(env, "GEMINI_MODEL"));
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(buildGeminiPayload(message, businessSnapshot, outputContext)),
      },
      GEMINI_UPSTREAM_TIMEOUT_MS,
    );

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          code: CHAT_ERROR_CODES.UPSTREAM_AUTH_ERROR,
          message: "Gemini Key 无效或无权限，请检查服务端密钥配置。",
          status: 502,
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          code: CHAT_ERROR_CODES.UPSTREAM_RATE_LIMIT,
          message: "Gemini 请求过于频繁或配额受限，请稍后重试。",
          status: 429,
        };
      }
      const upstreamMessage = trimString(payload?.error?.message);
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UPSTREAM_ERROR,
        message: upstreamMessage || `Gemini 服务异常（HTTP ${response.status}）。`,
        status: response.status >= 500 ? 502 : 400,
      };
    }

    const reply = extractGeminiReply(payload);
    if (!reply) {
      return {
        ok: false,
        code: CHAT_ERROR_CODES.EMPTY_REPLY,
        message: "Gemini 返回为空，请稍后重试。",
        status: 502,
      };
    }

    return {
      ok: true,
      reply,
      model,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
        message: "Gemini 请求超时，请稍后重试。",
        status: 504,
      };
    }
    return {
      ok: false,
      code: CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
      message: `Gemini 网络请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      status: 502,
    };
  }
}

export async function onRequestPost(context) {
  const requestId = crypto.randomUUID();
  const authResult = await verifySupabaseAccessToken(context.request, context.env);
  if (!authResult.ok) {
    return errorResponse(authResult.code, authResult.message, authResult.status, requestId);
  }

  let body;
  try {
    body = await context.request.json();
  } catch (_error) {
    return errorResponse(CHAT_ERROR_CODES.BAD_REQUEST, "请求体必须是合法 JSON。", 400, requestId);
  }

  const message = trimString(body?.message);
  if (!message) {
    return errorResponse(CHAT_ERROR_CODES.MESSAGE_REQUIRED, "message 不能为空。", 400, requestId);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(
      CHAT_ERROR_CODES.MESSAGE_TOO_LONG,
      `message 过长，最多 ${MAX_MESSAGE_LENGTH} 个字符。`,
      400,
      requestId,
    );
  }

  // Phase 2.1: 问题判定层，仅在当前请求作用域内保留，供后续层接入复用。
  const questionJudgment = buildQuestionJudgment(message);
  const normalizedBusinessSnapshot = normalizeBusinessSnapshot(body?.business_snapshot);
  // Phase 2.3: 会话状态层，仅在当前请求作用域内保留，供后续层接入复用。
  const historyWindow = normalizeSessionHistoryWindow(body?.history);
  const sessionState = buildSessionState(message, historyWindow, questionJudgment);
  // Phase 2.2: 数据可用性层，仅在当前请求作用域内保留，供后续层接入复用。
  let dataAvailability = buildDataAvailability(normalizedBusinessSnapshot, questionJudgment);
  // Phase 2.4: 路由层，仅在当前请求作用域内保留，供后续层接入复用。
  let routeDecision = buildRouteDecision(questionJudgment, dataAvailability, sessionState);
  // Phase 2.5: 按需调取层，仅在当前请求作用域内保留，供后续层接入复用。
  let effectiveBusinessSnapshot = normalizedBusinessSnapshot;
  let retrievalState = createInitialRetrievalState();
  if (routeDecision.route.code === ROUTE_DECISION_CODES.NEED_MORE_DATA) {
    const enhancementResult = await buildOnDemandSnapshotEnhancement({
      questionJudgment,
      dataAvailability,
      routeDecision,
      sessionState,
      businessSnapshot: effectiveBusinessSnapshot,
      authToken: authResult.token,
      env: context.env,
    });
    effectiveBusinessSnapshot = normalizeBusinessSnapshot(enhancementResult.effectiveSnapshot);
    retrievalState = enhancementResult.retrievalState;

    dataAvailability = buildDataAvailability(effectiveBusinessSnapshot, questionJudgment);
    routeDecision = buildRouteDecision(questionJudgment, dataAvailability, sessionState);

    if (routeDecision.route.code === ROUTE_DECISION_CODES.NEED_MORE_DATA) {
      routeDecision = forceBoundedRouteDecision(dataAvailability);
      retrievalState.degraded_to_bounded = true;
    }
  }

  // Phase 2.7: 最终路由防御性不变量，确保 need_more_data 不成为用户可见输出类型。
  let forcedBounded = false;
  if (routeDecision.route.code === ROUTE_DECISION_CODES.NEED_MORE_DATA) {
    routeDecision = forceBoundedRouteDecision(dataAvailability);
    retrievalState.degraded_to_bounded = true;
    forcedBounded = true;
  }

  // Phase 2.6: 输出层，仅消费 Phase 2.5 后的最终内部结果，不重做数据判断与补强决策。
  const outputContext = buildOutputContext(routeDecision, questionJudgment, dataAvailability);
  const phase2Trace = buildPhase2Trace({
    requestId,
    questionJudgment,
    dataAvailability,
    sessionState,
    routeDecision,
    retrievalState,
    outputContext,
    forcedBounded,
  });
  logPhase2Trace(phase2Trace, context.env);

  let finalReply = "";
  let responseModel = "local-template-refuse";
  if (outputContext.refuse_mode) {
    finalReply = buildRefuseReplyTemplate(outputContext);
  } else {
    const geminiResult = await callGemini(message, effectiveBusinessSnapshot, outputContext, context.env);
    if (!geminiResult.ok) {
      return errorResponse(geminiResult.code, geminiResult.message, geminiResult.status, requestId);
    }
    responseModel = geminiResult.model;
    finalReply = geminiResult.reply;
  }
  finalReply = normalizeOutputReply(finalReply, outputContext);

  return jsonResponse(
    {
      reply: finalReply,
      surfaceReply: finalReply,
      responseAction: "natural_answer",
      businessIntent: "chat",
      model: responseModel,
      requestId,
    },
    200,
    requestId,
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS",
    },
  });
}
