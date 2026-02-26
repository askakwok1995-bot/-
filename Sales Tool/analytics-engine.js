import { buildReportSnapshot } from "./reports.js";

const YM_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const DEFAULT_TOP_N = 5;
const DEFAULT_TREND_MOM_THRESHOLD = 0.2;
const DEFAULT_LOW_ACHIEVEMENT_THRESHOLD = 0.8;
const DEFAULT_HIGH_SHARE_THRESHOLD = 0.1;
const DEFAULT_CONCENTRATION_WARNING_THRESHOLD = 0.5;

const EMPTY_SNAPSHOT = Object.freeze({
  monthRows: [],
  quarterRows: [],
  productRows: [],
  productMonthlySeries: {},
  hospitalTopRows: [],
  hospitalMonthlySeries: {},
  hospitalRows: [],
  hospitalTotalCount: 0,
  hasRangeRecords: false,
  hasTargetGap: false,
  targetGapYears: [],
});

function createEmptySnapshot() {
  return {
    monthRows: [],
    quarterRows: [],
    productRows: [],
    productMonthlySeries: {},
    hospitalTopRows: [],
    hospitalMonthlySeries: {},
    hospitalRows: [],
    hospitalTotalCount: 0,
    hasRangeRecords: false,
    hasTargetGap: false,
    targetGapYears: [],
  };
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function roundRatio(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed + Number.EPSILON) * 10000) / 10000;
}

function calcRate(numerator, denominator) {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  if (n === null || d === null || d === 0) return null;
  return roundRatio(n / d);
}

function calcGrowth(current, baseline) {
  const c = toNumber(current);
  const b = toNumber(baseline);
  if (c === null || b === null || b === 0) return null;
  return roundRatio((c - b) / Math.abs(b));
}

function normalizeYm(raw) {
  const value = String(raw || "").trim();
  const matched = value.match(YM_RE);
  if (!matched) return "";

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return "";
  if (year < 1900 || year > 9999) return "";
  if (month < 1 || month > 12) return "";

  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseYm(ym) {
  const normalized = normalizeYm(ym);
  if (!normalized) return null;

  const matched = normalized.match(YM_RE);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  return {
    year,
    month,
    index: year * 12 + (month - 1),
  };
}

function listYmRange(startYm, endYm) {
  const start = parseYm(startYm);
  const end = parseYm(endYm);
  if (!start || !end || start.index > end.index) return [];

  const result = [];
  for (let index = start.index; index <= end.index; index += 1) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    result.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return result;
}

function addMonthsToYm(ym, offset) {
  const parsed = parseYm(ym);
  if (!parsed || !Number.isInteger(offset)) return "";

  const index = parsed.index + offset;
  const year = Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function addYearsToYm(ym, offsetYears) {
  const parsed = parseYm(ym);
  if (!parsed || !Number.isInteger(offsetYears)) return "";

  return `${parsed.year + offsetYears}-${String(parsed.month).padStart(2, "0")}`;
}

function parseRecordMonthKey(rawDate, deps) {
  const value = String(rawDate || "").trim();
  const matched = value.match(DATE_RE);
  if (!matched) return "";

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const isValidDate = typeof deps.isValidDateParts === "function" ? deps.isValidDateParts(year, month, day) : true;
  if (!isValidDate) return "";

  return `${year}-${String(month).padStart(2, "0")}`;
}

function buildAmountMapByMonth(records, deps) {
  const monthAmountMap = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const ym = parseRecordMonthKey(record?.date, deps);
    if (!ym) continue;

    const amount = toNumber(record?.amount);
    if (amount === null) continue;

    const previous = monthAmountMap.get(ym) || 0;
    monthAmountMap.set(ym, roundMoney(previous + amount));
  }
  return monthAmountMap;
}

function sumAmountsByMonths(monthAmountMap, months) {
  let total = 0;
  for (const ym of Array.isArray(months) ? months : []) {
    const amount = monthAmountMap.get(ym) || 0;
    total += amount;
  }
  return roundMoney(total);
}

function resolveRange(state, rangeOverride) {
  const baseStart = normalizeYm(state?.reportStartYm);
  const baseEnd = normalizeYm(state?.reportEndYm);
  const rangeSource = rangeOverride && typeof rangeOverride === "object" ? rangeOverride : {};

  const startYm = normalizeYm(rangeSource.startYm || baseStart);
  const endYm = normalizeYm(rangeSource.endYm || baseEnd);

  if (!startYm || !endYm) {
    return {
      range: { startYm, endYm },
      error: "分析区间格式不正确，应为 YYYY-MM。",
    };
  }
  if (startYm > endYm) {
    return {
      range: { startYm, endYm },
      error: "分析开始月份不能晚于结束月份。",
    };
  }

  return {
    range: { startYm, endYm },
    error: "",
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return createEmptySnapshot();
  }

  return {
    monthRows: Array.isArray(snapshot.monthRows) ? snapshot.monthRows : [],
    quarterRows: Array.isArray(snapshot.quarterRows) ? snapshot.quarterRows : [],
    productRows: Array.isArray(snapshot.productRows) ? snapshot.productRows : [],
    productMonthlySeries:
      snapshot.productMonthlySeries && typeof snapshot.productMonthlySeries === "object" ? snapshot.productMonthlySeries : {},
    hospitalTopRows: Array.isArray(snapshot.hospitalTopRows) ? snapshot.hospitalTopRows : [],
    hospitalMonthlySeries:
      snapshot.hospitalMonthlySeries && typeof snapshot.hospitalMonthlySeries === "object" ? snapshot.hospitalMonthlySeries : {},
    hospitalRows: Array.isArray(snapshot.hospitalRows) ? snapshot.hospitalRows : [],
    hospitalTotalCount: Number.isInteger(Number(snapshot.hospitalTotalCount)) ? Number(snapshot.hospitalTotalCount) : 0,
    hasRangeRecords: Boolean(snapshot.hasRangeRecords),
    hasTargetGap: Boolean(snapshot.hasTargetGap),
    targetGapYears: Array.isArray(snapshot.targetGapYears)
      ? snapshot.targetGapYears.filter((year) => Number.isInteger(Number(year))).map((year) => Number(year))
      : [],
  };
}

function pickSourceRecords(state) {
  if (Array.isArray(state?.reportRecords)) {
    return state.reportRecords;
  }
  return Array.isArray(state?.records) ? state.records : [];
}

function buildContextError(code, message, range = { startYm: "", endYm: "" }) {
  return {
    ok: false,
    error: { code, message: String(message || "").trim() || "分析上下文构建失败。" },
    range,
    generatedAt: new Date().toISOString(),
    metricPriority: "amount",
    snapshot: EMPTY_SNAPSHOT,
    meta: {
      hasData: false,
      hasTargetGap: false,
      targetGapYears: [],
      source: "reportRecords",
    },
    aggregates: {
      rangeMonths: [],
      totalAmount: 0,
      totalAmountPrevYear: 0,
      lastMonth: { ym: "", amount: 0 },
      previousMonth: { ym: "", amount: 0 },
    },
  };
}

function formatPercent(value) {
  const parsed = toNumber(value);
  if (parsed === null) return "--";
  return `${(parsed * 100).toFixed(2)}%`;
}

function formatMoney(value) {
  const parsed = toNumber(value);
  if (parsed === null) return "--";
  return roundMoney(parsed);
}

function createInsight({ id, level, title, summary, evidence, suggestion }) {
  const safeEvidence = Array.isArray(evidence)
    ? evidence
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const label = String(entry.label || "").trim();
          const value = entry.value;
          if (!label) return null;
          if (typeof value !== "string" && typeof value !== "number") return null;
          return { label, value };
        })
        .filter((entry) => entry !== null)
    : [];

  return {
    id: String(id || "").trim() || `insight-${Date.now()}`,
    level: level === "warning" || level === "opportunity" ? level : "info",
    title: String(title || "").trim() || "分析项",
    summary: String(summary || "").trim(),
    evidence: safeEvidence,
    suggestion: String(suggestion || "").trim(),
  };
}

function normalizeTopN(value, fallback = DEFAULT_TOP_N) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function computeTopShare(rows, totalAmount, topN) {
  const safeTotalAmount = toNumber(totalAmount);
  if (safeTotalAmount === null || safeTotalAmount <= 0) return null;

  const topRows = Array.isArray(rows) ? rows.slice(0, normalizeTopN(topN, 3)) : [];
  const sum = topRows.reduce((acc, row) => {
    const amount = toNumber(row?.amount);
    return acc + (amount === null ? 0 : amount);
  }, 0);

  return roundRatio(sum / safeTotalAmount);
}

function ensureContext(context) {
  if (!context || typeof context !== "object") {
    return buildContextError("CONTEXT_REQUIRED", "请先调用 buildAnalysisContext 获取分析上下文。");
  }
  return context;
}

function buildTopNamesText(rows, nameKey, metricKey, formatter, limit = 3) {
  const safeRows = Array.isArray(rows) ? rows.slice(0, limit) : [];
  if (safeRows.length === 0) return "无";

  return safeRows
    .map((row) => {
      const name = String(row?.[nameKey] || "").trim() || "未命名";
      const metric = formatter(row?.[metricKey]);
      return `${name}（${metric}）`;
    })
    .join("；");
}

function detectTailTrend(monthRows) {
  if (!Array.isArray(monthRows) || monthRows.length < 2) {
    return null;
  }

  let direction = "";
  let streakCount = 0;
  for (let index = monthRows.length - 1; index >= 0; index -= 1) {
    const row = monthRows[index];
    const mom = toNumber(row?.amountMom);
    if (mom === null || mom === 0) {
      break;
    }

    const nextDirection = mom > 0 ? "up" : "down";
    if (!direction) {
      direction = nextDirection;
    }
    if (direction !== nextDirection) {
      break;
    }
    streakCount += 1;
  }

  if (!direction || streakCount < 2) {
    return null;
  }

  return {
    direction,
    streakCount,
    latestRow: monthRows[monthRows.length - 1],
  };
}

export function buildAnalysisContext({ state, deps, rangeOverride } = {}) {
  const safeState = state && typeof state === "object" ? state : {};
  const safeDeps = deps && typeof deps === "object" ? deps : {};
  const sourceRecords = pickSourceRecords(safeState);
  const resolvedRange = resolveRange(safeState, rangeOverride);

  if (resolvedRange.error) {
    return buildContextError("INVALID_RANGE", resolvedRange.error, resolvedRange.range);
  }

  const range = resolvedRange.range;
  const rangeMonths = listYmRange(range.startYm, range.endYm);
  const prevYearMonths = rangeMonths.map((ym) => addYearsToYm(ym, -1)).filter((ym) => ym);
  const lastMonthYm = range.endYm;
  const previousMonthYm = addMonthsToYm(lastMonthYm, -1);
  const amountMapByMonth = buildAmountMapByMonth(sourceRecords, safeDeps);

  let snapshot;
  try {
    snapshot = buildReportSnapshot(
      {
        ...safeState,
        records: sourceRecords,
      },
      safeDeps,
      range,
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "报表快照计算失败。";
    return buildContextError("SNAPSHOT_BUILD_FAILED", message, range);
  }

  const normalizedSnapshot = normalizeSnapshot(snapshot);
  return {
    ok: true,
    error: null,
    range,
    generatedAt: new Date().toISOString(),
    metricPriority: "amount",
    snapshot: normalizedSnapshot,
    meta: {
      hasData: Boolean(normalizedSnapshot.hasRangeRecords),
      hasTargetGap: Boolean(normalizedSnapshot.hasTargetGap),
      targetGapYears: normalizedSnapshot.targetGapYears.slice().sort((a, b) => a - b),
      source: "reportRecords",
    },
    aggregates: {
      rangeMonths,
      totalAmount: sumAmountsByMonths(amountMapByMonth, rangeMonths),
      totalAmountPrevYear: sumAmountsByMonths(amountMapByMonth, prevYearMonths),
      lastMonth: {
        ym: lastMonthYm,
        amount: lastMonthYm ? sumAmountsByMonths(amountMapByMonth, [lastMonthYm]) : 0,
      },
      previousMonth: {
        ym: previousMonthYm,
        amount: previousMonthYm ? sumAmountsByMonths(amountMapByMonth, [previousMonthYm]) : 0,
      },
    },
  };
}

export function getKpiOverview(context) {
  const ctx = ensureContext(context);
  if (!ctx.ok) {
    return {
      ok: false,
      error: ctx.error,
      range: ctx.range,
      metrics: null,
      items: [],
    };
  }

  const monthRows = Array.isArray(ctx.snapshot.monthRows) ? ctx.snapshot.monthRows : [];
  const targetValues = monthRows.map((row) => toNumber(row?.targetAmount));
  const hasCompleteTarget = monthRows.length > 0 && targetValues.every((value) => value !== null);
  const totalTargetAmount = hasCompleteTarget
    ? roundMoney(targetValues.reduce((sum, value) => sum + Number(value), 0))
    : null;

  const totalAmount = formatMoney(ctx.aggregates.totalAmount);
  const amountYoy = calcGrowth(ctx.aggregates.totalAmount, ctx.aggregates.totalAmountPrevYear);
  const amountMom = calcGrowth(ctx.aggregates.lastMonth.amount, ctx.aggregates.previousMonth.amount);
  const amountAchievement = calcRate(totalAmount, totalTargetAmount);
  const top3ProductShare = computeTopShare(ctx.snapshot.productRows, totalAmount, 3);
  const top3HospitalShare = computeTopShare(ctx.snapshot.hospitalRows, totalAmount, 3);

  const insight = createInsight({
    id: "kpi-overview",
    level: "info",
    title: "核心指标总览",
    summary: `区间销售额 ${totalAmount}，区间同比 ${formatPercent(amountYoy)}，最近月环比 ${formatPercent(amountMom)}。`,
    evidence: [
      { label: "区间销售额", value: totalAmount },
      { label: "区间目标额", value: totalTargetAmount === null ? "--" : totalTargetAmount },
      { label: "达成率", value: formatPercent(amountAchievement) },
      { label: "Top3产品金额占比", value: formatPercent(top3ProductShare) },
      { label: "Top3医院金额占比", value: formatPercent(top3HospitalShare) },
    ],
    suggestion: "后续优先将高贡献对象与同比下滑对象做交叉分析，定位可执行抓手。",
  });

  return {
    ok: true,
    error: null,
    range: ctx.range,
    metrics: {
      totalAmount,
      totalTargetAmount,
      amountAchievement,
      amountYoy,
      amountMom,
      top3ProductShare,
      top3HospitalShare,
      lastMonthYm: ctx.aggregates.lastMonth.ym,
      previousMonthYm: ctx.aggregates.previousMonth.ym,
    },
    items: [insight],
  };
}

export function getTrendInsights(context) {
  const ctx = ensureContext(context);
  if (!ctx.ok) {
    return {
      ok: false,
      error: ctx.error,
      range: ctx.range,
      threshold: DEFAULT_TREND_MOM_THRESHOLD,
      items: [],
    };
  }

  const monthRows = Array.isArray(ctx.snapshot.monthRows) ? ctx.snapshot.monthRows : [];
  const threshold = DEFAULT_TREND_MOM_THRESHOLD;
  const items = [];

  const tailTrend = detectTailTrend(monthRows);
  if (tailTrend) {
    const isRise = tailTrend.direction === "up";
    items.push(
      createInsight({
        id: "trend-tail-streak",
        level: isRise ? "opportunity" : "warning",
        title: isRise ? "月度金额连续回升" : "月度金额连续下滑",
        summary: `最近已连续 ${tailTrend.streakCount} 个月出现金额环比${isRise ? "增长" : "下滑"}。`,
        evidence: [
          { label: "连续月份", value: tailTrend.streakCount },
          { label: "最新月份", value: String(tailTrend.latestRow?.ym || "") },
          { label: "最新金额环比", value: formatPercent(tailTrend.latestRow?.amountMom) },
        ],
        suggestion: isRise ? "延续当前增长策略并复盘可复制动作。" : "优先排查下滑链路（产品、医院、渠道）并制定止跌动作。",
      }),
    );
  }

  const volatileRows = monthRows
    .filter((row) => {
      const mom = toNumber(row?.amountMom);
      return mom !== null && Math.abs(mom) >= threshold;
    })
    .sort((left, right) => Math.abs(Number(right.amountMom)) - Math.abs(Number(left.amountMom)))
    .slice(0, DEFAULT_TOP_N);

  if (volatileRows.length > 0) {
    items.push(
      createInsight({
        id: "trend-volatility",
        level: "warning",
        title: "金额波动月份预警",
        summary: `发现 ${volatileRows.length} 个月金额环比波动超过 ${(threshold * 100).toFixed(0)}%。`,
        evidence: [
          { label: "波动阈值", value: formatPercent(threshold) },
          { label: "波动月份数", value: volatileRows.length },
          { label: "最高波动月", value: `${volatileRows[0].ym}（${formatPercent(volatileRows[0].amountMom)}）` },
        ],
        suggestion: "对高波动月份拆解到产品和医院维度，判断是结构变化还是执行问题。",
      }),
    );
  }

  if (items.length === 0) {
    items.push(
      createInsight({
        id: "trend-stable",
        level: "info",
        title: "月度趋势较平稳",
        summary: "当前范围内未识别到连续明显下滑或大幅波动月。",
        evidence: [{ label: "月份数", value: monthRows.length }],
        suggestion: "可将精力放在提升高贡献对象达成率与扩量潜力。",
      }),
    );
  }

  return {
    ok: true,
    error: null,
    range: ctx.range,
    threshold,
    items,
  };
}

export function getProductInsights(context, options = {}) {
  const ctx = ensureContext(context);
  if (!ctx.ok) {
    return {
      ok: false,
      error: ctx.error,
      range: ctx.range,
      params: {},
      items: [],
      topGrowth: [],
      topDecline: [],
      lowAchievementHighShare: [],
    };
  }

  const topN = normalizeTopN(options.topN, DEFAULT_TOP_N);
  const lowAchievementThreshold = toNumber(options.lowAchievementThreshold) ?? DEFAULT_LOW_ACHIEVEMENT_THRESHOLD;
  const highShareThreshold = toNumber(options.highShareThreshold) ?? DEFAULT_HIGH_SHARE_THRESHOLD;
  const rows = Array.isArray(ctx.snapshot.productRows) ? ctx.snapshot.productRows : [];

  const topGrowth = rows
    .filter((row) => {
      const yoy = toNumber(row?.amountYoy);
      return yoy !== null && yoy > 0;
    })
    .sort((a, b) => Number(b.amountYoy) - Number(a.amountYoy))
    .slice(0, topN);

  const topDecline = rows
    .filter((row) => {
      const yoy = toNumber(row?.amountYoy);
      return yoy !== null && yoy < 0;
    })
    .sort((a, b) => Number(a.amountYoy) - Number(b.amountYoy))
    .slice(0, topN);

  const lowAchievementHighShare = rows
    .filter((row) => {
      const achievement = toNumber(row?.amountAchievement);
      const share = toNumber(row?.amountShare);
      return achievement !== null && share !== null && achievement < lowAchievementThreshold && share >= highShareThreshold;
    })
    .sort((a, b) => Number(b.amountShare) - Number(a.amountShare))
    .slice(0, topN);

  const items = [];
  if (topGrowth.length > 0) {
    items.push(
      createInsight({
        id: "product-top-growth",
        level: "opportunity",
        title: "产品同比增长机会",
        summary: `识别到 ${topGrowth.length} 个同比增长产品。`,
        evidence: [
          { label: "Top增长产品", value: buildTopNamesText(topGrowth, "productName", "amountYoy", formatPercent, 3) },
          { label: "首位增长率", value: formatPercent(topGrowth[0].amountYoy) },
        ],
        suggestion: "总结首位增长产品打法，并在同客群产品中复制执行。",
      }),
    );
  }

  if (topDecline.length > 0) {
    items.push(
      createInsight({
        id: "product-top-decline",
        level: "warning",
        title: "产品同比下滑预警",
        summary: `识别到 ${topDecline.length} 个同比下滑产品。`,
        evidence: [
          { label: "Top下滑产品", value: buildTopNamesText(topDecline, "productName", "amountYoy", formatPercent, 3) },
          { label: "最大下滑率", value: formatPercent(topDecline[0].amountYoy) },
        ],
        suggestion: "优先定位下滑产品的医院分布与配送执行情况，制定止跌动作。",
      }),
    );
  }

  if (lowAchievementHighShare.length > 0) {
    items.push(
      createInsight({
        id: "product-low-achievement-high-share",
        level: "warning",
        title: "高贡献低达成产品",
        summary: `识别到 ${lowAchievementHighShare.length} 个高贡献但达成不足产品。`,
        evidence: [
          { label: "判定阈值", value: `达成率<${formatPercent(lowAchievementThreshold)} 且占比>=${formatPercent(highShareThreshold)}` },
          {
            label: "重点产品",
            value: buildTopNamesText(
              lowAchievementHighShare,
              "productName",
              "amountAchievement",
              (value) => `达成${formatPercent(value)}`,
              3,
            ),
          },
        ],
        suggestion: "将资源优先投向该组产品，先补达成缺口再做新增扩张。",
      }),
    );
  }

  if (items.length === 0) {
    items.push(
      createInsight({
        id: "product-stable",
        level: "info",
        title: "产品结构暂无显著异常",
        summary: "当前范围内未识别到强烈的产品增长/下滑或高贡献低达成对象。",
        evidence: [{ label: "产品样本数", value: rows.length }],
        suggestion: "保持当前执行节奏，按月跟踪产品贡献变动。",
      }),
    );
  }

  return {
    ok: true,
    error: null,
    range: ctx.range,
    params: {
      topN,
      lowAchievementThreshold,
      highShareThreshold,
    },
    items,
    topGrowth,
    topDecline,
    lowAchievementHighShare,
  };
}

export function getHospitalInsights(context, options = {}) {
  const ctx = ensureContext(context);
  if (!ctx.ok) {
    return {
      ok: false,
      error: ctx.error,
      range: ctx.range,
      params: {},
      items: [],
      topGrowth: [],
      topDecline: [],
      highContributionDecline: [],
    };
  }

  const topN = normalizeTopN(options.topN, DEFAULT_TOP_N);
  const highShareThreshold = toNumber(options.highShareThreshold) ?? DEFAULT_HIGH_SHARE_THRESHOLD;
  const rows = Array.isArray(ctx.snapshot.hospitalRows) ? ctx.snapshot.hospitalRows : [];

  const topGrowth = rows
    .filter((row) => {
      const yoy = toNumber(row?.amountYoy);
      return yoy !== null && yoy > 0;
    })
    .sort((a, b) => Number(b.amountYoy) - Number(a.amountYoy))
    .slice(0, topN);

  const topDecline = rows
    .filter((row) => {
      const yoy = toNumber(row?.amountYoy);
      return yoy !== null && yoy < 0;
    })
    .sort((a, b) => Number(a.amountYoy) - Number(b.amountYoy))
    .slice(0, topN);

  const highContributionDecline = rows
    .filter((row) => {
      const share = toNumber(row?.amountShare);
      const yoy = toNumber(row?.amountYoy);
      return share !== null && yoy !== null && share >= highShareThreshold && yoy < 0;
    })
    .sort((a, b) => Number(b.amountShare) - Number(a.amountShare))
    .slice(0, topN);

  const items = [];
  if (topGrowth.length > 0) {
    items.push(
      createInsight({
        id: "hospital-top-growth",
        level: "opportunity",
        title: "医院同比增长机会",
        summary: `识别到 ${topGrowth.length} 家同比增长医院。`,
        evidence: [
          { label: "Top增长医院", value: buildTopNamesText(topGrowth, "hospitalName", "amountYoy", formatPercent, 3) },
          { label: "首位增长率", value: formatPercent(topGrowth[0].amountYoy) },
        ],
        suggestion: "复盘增长医院的配送与动销动作，在同层级医院复制。",
      }),
    );
  }

  if (topDecline.length > 0) {
    items.push(
      createInsight({
        id: "hospital-top-decline",
        level: "warning",
        title: "医院同比下滑预警",
        summary: `识别到 ${topDecline.length} 家同比下滑医院。`,
        evidence: [
          { label: "Top下滑医院", value: buildTopNamesText(topDecline, "hospitalName", "amountYoy", formatPercent, 3) },
          { label: "最大下滑率", value: formatPercent(topDecline[0].amountYoy) },
        ],
        suggestion: "优先核查重点下滑医院的产品结构与配送履约情况。",
      }),
    );
  }

  if (highContributionDecline.length > 0) {
    items.push(
      createInsight({
        id: "hospital-high-share-decline",
        level: "warning",
        title: "高贡献医院下滑风险",
        summary: `识别到 ${highContributionDecline.length} 家高贡献且同比下滑医院。`,
        evidence: [
          { label: "判定阈值", value: `金额占比>=${formatPercent(highShareThreshold)} 且同比<0` },
          {
            label: "重点医院",
            value: buildTopNamesText(
              highContributionDecline,
              "hospitalName",
              "amountShare",
              (value) => `占比${formatPercent(value)}`,
              3,
            ),
          },
        ],
        suggestion: "将重点医院纳入周跟踪清单，按医院逐一制定回升动作。",
      }),
    );
  }

  if (items.length === 0) {
    items.push(
      createInsight({
        id: "hospital-stable",
        level: "info",
        title: "医院结构暂无显著异常",
        summary: "当前范围内未识别到强烈医院增长/下滑风险。",
        evidence: [{ label: "医院样本数", value: rows.length }],
        suggestion: "继续跟踪Top医院金额占比，避免结构过度集中。",
      }),
    );
  }

  return {
    ok: true,
    error: null,
    range: ctx.range,
    params: {
      topN,
      highShareThreshold,
    },
    items,
    topGrowth,
    topDecline,
    highContributionDecline,
  };
}

export function getRiskAlerts(context, options = {}) {
  const ctx = ensureContext(context);
  const concentrationWarningThreshold =
    toNumber(options.concentrationWarningThreshold) ?? DEFAULT_CONCENTRATION_WARNING_THRESHOLD;

  if (!ctx.ok) {
    return {
      ok: false,
      error: ctx.error,
      range: ctx.range,
      items: [
        createInsight({
          id: "risk-invalid-context",
          level: "warning",
          title: "分析上下文异常",
          summary: ctx.error?.message || "分析上下文不可用。",
          evidence: [{ label: "错误码", value: String(ctx.error?.code || "UNKNOWN") }],
          suggestion: "先确认报表区间与数据加载状态，再重试分析。",
        }),
      ],
    };
  }

  const items = [];
  if (!ctx.meta.hasData) {
    items.push(
      createInsight({
        id: "risk-no-data",
        level: "warning",
        title: "数据不足",
        summary: "当前分析范围没有可用销售数据。",
        evidence: [{ label: "分析区间", value: `${ctx.range.startYm} ~ ${ctx.range.endYm}` }],
        suggestion: "调整报表时间范围或先补齐销售记录后再分析。",
      }),
    );
  }

  if (ctx.meta.hasTargetGap) {
    items.push(
      createInsight({
        id: "risk-target-gap",
        level: "warning",
        title: "指标缺口提醒",
        summary: "存在未生效目标年份，达成率口径可能不完整。",
        evidence: [{ label: "缺口年份", value: ctx.meta.targetGapYears.join("、") || "未知" }],
        suggestion: "先补齐对应年份季度/月度目标，再进行达成分析与汇报。",
      }),
    );
  }

  const topProductShare = computeTopShare(ctx.snapshot.productRows, ctx.aggregates.totalAmount, 1);
  const topHospitalShare = computeTopShare(ctx.snapshot.hospitalRows, ctx.aggregates.totalAmount, 1);
  if (
    (toNumber(topProductShare) !== null && Number(topProductShare) >= concentrationWarningThreshold) ||
    (toNumber(topHospitalShare) !== null && Number(topHospitalShare) >= concentrationWarningThreshold)
  ) {
    items.push(
      createInsight({
        id: "risk-concentration",
        level: "warning",
        title: "结构集中度偏高",
        summary: "销售贡献过度集中在单一对象，存在波动放大风险。",
        evidence: [
          { label: "Top1产品占比", value: formatPercent(topProductShare) },
          { label: "Top1医院占比", value: formatPercent(topHospitalShare) },
          { label: "预警阈值", value: formatPercent(concentrationWarningThreshold) },
        ],
        suggestion: "在维持核心对象的同时，补充第二梯队对象，降低结构性风险。",
      }),
    );
  }

  if (items.length === 0) {
    items.push(
      createInsight({
        id: "risk-none",
        level: "info",
        title: "未发现高优先级风险",
        summary: "当前范围内未触发数据不足、目标缺口或结构集中预警。",
        evidence: [{ label: "分析区间", value: `${ctx.range.startYm} ~ ${ctx.range.endYm}` }],
        suggestion: "继续保持月度监控节奏，重点跟踪异常波动月。",
      }),
    );
  }

  return {
    ok: true,
    error: null,
    range: ctx.range,
    items,
  };
}

function createBriefPoint(summary, evidence, suggestion) {
  const safeEvidence = Array.isArray(evidence) ? evidence.filter((item) => item && item.label && item.value !== undefined) : [];
  return {
    summary: String(summary || "").trim(),
    evidence: safeEvidence,
    suggestion: String(suggestion || "").trim(),
  };
}

export function buildBriefingOutline(context) {
  const ctx = ensureContext(context);
  const kpi = getKpiOverview(ctx);
  const trend = getTrendInsights(ctx);
  const product = getProductInsights(ctx, { topN: 3 });
  const hospital = getHospitalInsights(ctx, { topN: 3 });
  const risk = getRiskAlerts(ctx);

  if (!ctx.ok) {
    return {
      ok: false,
      error: ctx.error,
      title: "销售分析汇报草稿",
      range: ctx.range,
      generatedAt: new Date().toISOString(),
      sections: [
        {
          key: "overall",
          title: "总体结论",
          points: [
            createBriefPoint(
              ctx.error?.message || "分析上下文异常。",
              [{ label: "错误码", value: String(ctx.error?.code || "UNKNOWN") }],
              "先修复区间或数据问题，再生成汇报内容。",
            ),
          ],
        },
      ],
      source: "deterministic-analytics-v1",
    };
  }

  const overallPoints = [];
  if (!ctx.meta.hasData || !kpi.ok || !kpi.metrics) {
    overallPoints.push(
      createBriefPoint(
        "当前分析范围暂无可用销售数据，无法形成有效业务结论。",
        [{ label: "分析区间", value: `${ctx.range.startYm} ~ ${ctx.range.endYm}` }],
        "建议先补齐记录或扩展时间范围后再汇报。",
      ),
    );
  } else {
    const totalAmount = kpi.metrics.totalAmount;
    const amountYoy = kpi.metrics.amountYoy;
    const amountAchievement = kpi.metrics.amountAchievement;
    const targetText = kpi.metrics.totalTargetAmount === null ? "目标口径未完整生效" : `达成率 ${formatPercent(amountAchievement)}`;

    overallPoints.push(
      createBriefPoint(
        `${ctx.range.startYm}~${ctx.range.endYm} 区间销售额 ${totalAmount}，区间同比 ${formatPercent(amountYoy)}，${targetText}。`,
        [
          { label: "区间销售额", value: totalAmount },
          { label: "区间同比", value: formatPercent(amountYoy) },
          { label: "达成率", value: formatPercent(amountAchievement) },
        ],
        "汇报时先讲结果，再拆解结构贡献与风险对象。",
      ),
    );
  }

  const highlightPoints = [];
  const firstProductGrowth = product.topGrowth[0];
  if (firstProductGrowth) {
    highlightPoints.push(
      createBriefPoint(
        `产品亮点：${firstProductGrowth.productName} 同比增长明显。`,
        [
          { label: "产品", value: firstProductGrowth.productName },
          { label: "金额同比", value: formatPercent(firstProductGrowth.amountYoy) },
          { label: "金额占比", value: formatPercent(firstProductGrowth.amountShare) },
        ],
        "将该产品的医院覆盖与执行动作沉淀为可复制模板。",
      ),
    );
  }

  const firstHospitalGrowth = hospital.topGrowth[0];
  if (firstHospitalGrowth) {
    highlightPoints.push(
      createBriefPoint(
        `医院亮点：${firstHospitalGrowth.hospitalName} 保持同比增长。`,
        [
          { label: "医院", value: firstHospitalGrowth.hospitalName },
          { label: "金额同比", value: formatPercent(firstHospitalGrowth.amountYoy) },
          { label: "金额占比", value: formatPercent(firstHospitalGrowth.amountShare) },
        ],
        "将该院增长经验复制到同层级医院。",
      ),
    );
  }

  if (highlightPoints.length === 0) {
    highlightPoints.push(
      createBriefPoint(
        "当前范围内亮点不突出，建议以稳态经营和结构优化作为主要叙事。",
        [{ label: "趋势结论", value: trend.items[0]?.title || "暂无显著增长亮点" }],
        "将重点放在提升高贡献对象达成率和降低波动。",
      ),
    );
  }

  const riskPoints = [];
  for (const item of risk.items) {
    riskPoints.push(
      createBriefPoint(
        item.summary,
        item.evidence.slice(0, 3),
        item.suggestion || "建议加入周跟踪看板并持续监控。",
      ),
    );
  }

  const nextActionPoints = [];
  const lowAchievementProduct = product.lowAchievementHighShare[0];
  if (lowAchievementProduct) {
    nextActionPoints.push(
      createBriefPoint(
        `优先动作1：聚焦产品 ${lowAchievementProduct.productName} 的达成补缺。`,
        [
          { label: "达成率", value: formatPercent(lowAchievementProduct.amountAchievement) },
          { label: "金额占比", value: formatPercent(lowAchievementProduct.amountShare) },
        ],
        "按医院拆解缺口，明确周度执行目标和负责人。",
      ),
    );
  }

  const declineHospital = hospital.highContributionDecline[0] || hospital.topDecline[0];
  if (declineHospital) {
    nextActionPoints.push(
      createBriefPoint(
        `优先动作2：修复医院 ${declineHospital.hospitalName} 的下滑趋势。`,
        [
          { label: "金额同比", value: formatPercent(declineHospital.amountYoy) },
          { label: "金额占比", value: formatPercent(declineHospital.amountShare) },
        ],
        "联动配送与客户维护动作，设定两周回升观察点。",
      ),
    );
  }

  if (ctx.meta.hasTargetGap) {
    nextActionPoints.push(
      createBriefPoint(
        "优先动作3：补齐目标缺口年份，统一达成率口径。",
        [{ label: "缺口年份", value: ctx.meta.targetGapYears.join("、") || "未知" }],
        "本周先补齐目标，再输出对管理层的达成复盘版本。",
      ),
    );
  }

  if (nextActionPoints.length === 0) {
    nextActionPoints.push(
      createBriefPoint(
        "下周动作：维持当前增长策略并持续监控异常波动月。",
        [{ label: "区间", value: `${ctx.range.startYm} ~ ${ctx.range.endYm}` }],
        "每周复盘一次产品与医院Top变化，及时调整资源分配。",
      ),
    );
  }

  return {
    ok: true,
    error: null,
    title: `${ctx.range.startYm} ~ ${ctx.range.endYm} 销售分析汇报草稿`,
    range: ctx.range,
    generatedAt: new Date().toISOString(),
    sections: [
      { key: "overall", title: "总体结论", points: overallPoints },
      { key: "highlights", title: "亮点", points: highlightPoints },
      { key: "risks", title: "风险", points: riskPoints },
      { key: "next-actions", title: "下周动作", points: nextActionPoints },
    ],
    source: "deterministic-analytics-v1",
  };
}

