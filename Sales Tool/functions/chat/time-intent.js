import {
  addMonthsToYm,
  formatYm,
  normalizeBusinessSnapshot,
  parseYm,
  trimString,
} from "./shared.js";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

function createEmptyRequestedTimeWindow() {
  return {
    kind: "none",
    label: "",
    start_month: "",
    end_month: "",
    period: "",
    anchor_mode: "none",
  };
}

function createEmptyTimeIntent() {
  return {
    requested_time_window: createEmptyRequestedTimeWindow(),
    comparison_time_window: createEmptyRequestedTimeWindow(),
    time_compare_mode: "none",
  };
}

function createEmptyCoverage() {
  return {
    code: "none",
    available_start_month: "",
    available_end_month: "",
    available_period: "",
  };
}

function compareYm(left, right) {
  const parsedLeft = parseYm(left);
  const parsedRight = parseYm(right);
  if (!parsedLeft || !parsedRight) {
    return 0;
  }
  if (parsedLeft.year !== parsedRight.year) {
    return parsedLeft.year - parsedRight.year;
  }
  return parsedLeft.month - parsedRight.month;
}

function buildPeriod(startMonth, endMonth) {
  const safeStart = trimString(startMonth);
  const safeEnd = trimString(endMonth);
  return safeStart && safeEnd ? `${safeStart}~${safeEnd}` : "";
}

function getCurrentYearMonth(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value || "");
  const month = Number(parts.find((part) => part.type === "month")?.value || "");
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return "";
  }
  return formatYm(year, month);
}

function toIntegerMonthCount(rawValue, fallback) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return fallback;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  const mapping = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return mapping[value] || fallback;
}

function buildRelativeWindow(label, startMonth, endMonth) {
  return {
    kind: "relative",
    label,
    start_month: startMonth,
    end_month: endMonth,
    period: buildPeriod(startMonth, endMonth),
    anchor_mode: "none",
  };
}

function buildAbsoluteWindow(label, startMonth, endMonth, anchorMode = "explicit") {
  return {
    kind: "absolute",
    label,
    start_month: startMonth,
    end_month: endMonth,
    period: buildPeriod(startMonth, endMonth),
    anchor_mode: anchorMode,
  };
}

function buildQuarterWindow(label, year, quarter, anchorMode = "explicit") {
  const startMonth = formatYm(year, (quarter - 1) * 3 + 1);
  const endMonth = formatYm(year, quarter * 3);
  return buildAbsoluteWindow(label, startMonth, endMonth, anchorMode);
}

function buildBareQuarterAmbiguousWindow(label) {
  return {
    kind: "absolute",
    label,
    start_month: "",
    end_month: "",
    period: "",
    anchor_mode: "none",
  };
}

function buildRecentCompleteMonthsWindow(label, monthCount, currentYm) {
  const safeCount = Number.isInteger(monthCount) && monthCount > 0 ? monthCount : 1;
  const lastCompleteMonth = addMonthsToYm(currentYm, -1);
  const startMonth = addMonthsToYm(lastCompleteMonth, -(safeCount - 1));
  return buildRelativeWindow(label, startMonth, lastCompleteMonth);
}

function buildCurrentQuarterWindow(label, currentYm) {
  const parsed = parseYm(currentYm);
  if (!parsed) {
    return createEmptyRequestedTimeWindow();
  }
  const quarterStartMonth = Math.floor((parsed.month - 1) / 3) * 3 + 1;
  return buildRelativeWindow(label, formatYm(parsed.year, quarterStartMonth), currentYm);
}

function buildPreviousQuarterWindow(label, currentYm) {
  const parsed = parseYm(currentYm);
  if (!parsed) {
    return createEmptyRequestedTimeWindow();
  }
  const currentQuarter = Math.floor((parsed.month - 1) / 3) + 1;
  const previousQuarter = currentQuarter === 1 ? 4 : currentQuarter - 1;
  const previousQuarterYear = currentQuarter === 1 ? parsed.year - 1 : parsed.year;
  const startMonth = formatYm(previousQuarterYear, (previousQuarter - 1) * 3 + 1);
  const endMonth = formatYm(previousQuarterYear, (previousQuarter - 1) * 3 + 3);
  return buildRelativeWindow(label, startMonth, endMonth);
}

function buildCurrentYearWindow(label, currentYm) {
  const parsed = parseYm(currentYm);
  if (!parsed) {
    return createEmptyRequestedTimeWindow();
  }
  return buildRelativeWindow(label, formatYm(parsed.year, 1), currentYm);
}

function buildPreviousYearWindow(label, currentYm) {
  const parsed = parseYm(currentYm);
  if (!parsed) {
    return createEmptyRequestedTimeWindow();
  }
  return buildRelativeWindow(label, formatYm(parsed.year - 1, 1), formatYm(parsed.year - 1, 12));
}

function parseBareQuarterNumber(rawValue) {
  const value = String(rawValue || "").trim().toUpperCase();
  const digitMatch = value.match(/[1-4]/);
  if (digitMatch) {
    return Number(digitMatch[0]);
  }
  const mapping = {
    第一: 1,
    第二: 2,
    第三: 3,
    第四: 4,
    第一季度: 1,
    第二季度: 2,
    第三季度: 3,
    第四季度: 4,
    一季度: 1,
    二季度: 2,
    三季度: 3,
    四季度: 4,
  };
  return mapping[value] || null;
}

function normalizeShortYear(rawValue) {
  const numeric = Number(rawValue);
  if (!Number.isInteger(numeric)) {
    return null;
  }
  if (numeric >= 1000) {
    return numeric;
  }
  if (numeric >= 0 && numeric <= 99) {
    return 2000 + numeric;
  }
  return null;
}

function toQuarterNumber(rawQuarterToken) {
  return parseBareQuarterNumber(trimString(rawQuarterToken).toUpperCase());
}

function resolveAnalysisRangeYearAnchor(rawAnalysisRange) {
  const startMonth = trimString(rawAnalysisRange?.start_month);
  const endMonth = trimString(rawAnalysisRange?.end_month);
  const parsedStart = parseYm(startMonth);
  const parsedEnd = parseYm(endMonth);
  if (!parsedStart || !parsedEnd) {
    return null;
  }
  if (parsedStart.year !== parsedEnd.year) {
    return null;
  }
  if (parsedStart.month !== 1 || parsedEnd.month !== 12) {
    return null;
  }
  return parsedStart.year;
}

function isFullSingleYearAnalysisRange(rawAnalysisRange) {
  return resolveAnalysisRangeYearAnchor(rawAnalysisRange) !== null;
}

function parseQuarterExpression(rawText) {
  const text = trimString(rawText).replace(/\s+/g, "");
  if (!text) {
    return null;
  }

  let matched = text.match(/^(\d{2,4})年(?:Q([1-4])|([1-4])季度|第([一二三四])季度|([一二三四])季度)$/i);
  if (matched) {
    return {
      label: text,
      year: normalizeShortYear(matched[1]),
      quarter: toQuarterNumber(matched[2] || matched[3] || matched[4] || matched[5]),
      explicitYear: true,
    };
  }

  matched = text.match(/^(?:Q([1-4])|([1-4])季度|第([一二三四])季度|([一二三四])季度)$/i);
  if (matched) {
    return {
      label: text,
      year: null,
      quarter: toQuarterNumber(matched[1] || matched[2] || matched[3] || matched[4]),
      explicitYear: false,
    };
  }

  return null;
}

function buildQuarterWindowFromExpression(expression, year, anchorMode = "explicit") {
  if (!expression || !Number.isInteger(year) || !Number.isInteger(expression.quarter)) {
    return createEmptyRequestedTimeWindow();
  }
  const label = expression.explicitYear ? expression.label : `Q${expression.quarter}`;
  return buildQuarterWindow(label, year, expression.quarter, anchorMode);
}

function splitQuarterCompareOperands(message) {
  const text = trimString(message).replace(/[。！？?!]+$/u, "");
  if (!text) {
    return null;
  }

  const directMatch = text.match(/^\s*(.+?)\s*对比\s*(.+?)\s*(?:的?情况如何|怎么样|如何|情况|表现)?\s*$/u);
  if (directMatch) {
    return {
      left: trimString(directMatch[1]),
      right: trimString(directMatch[2]),
    };
  }

  const comparedMatch = text.match(/^\s*(.+?)\s*和\s*(.+?)\s*相比\s*(?:的?情况如何|怎么样|如何|情况|表现)?\s*$/u);
  if (comparedMatch) {
    return {
      left: trimString(comparedMatch[1]),
      right: trimString(comparedMatch[2]),
    };
  }

  return null;
}

function normalizeQuarterCompareOperand(rawValue) {
  return trimString(rawValue).replace(/(?:的?情况|情况|表现|走势|销售情况)$/u, "");
}

function parseQuarterCompareIntent(message, analysisRange) {
  const operands = splitQuarterCompareOperands(message);
  if (!operands) {
    return null;
  }

  const leftExpression = parseQuarterExpression(normalizeQuarterCompareOperand(operands.left));
  const rightExpression = parseQuarterExpression(normalizeQuarterCompareOperand(operands.right));
  if (!leftExpression || !rightExpression) {
    return null;
  }

  const analysisYear = resolveAnalysisRangeYearAnchor(analysisRange);
  let leftYear = leftExpression.year;
  let rightYear = rightExpression.year;
  let anchorMode = "explicit";

  if (Number.isInteger(leftYear) && !Number.isInteger(rightYear)) {
    rightYear = leftYear;
    anchorMode = "explicit";
  } else if (!Number.isInteger(leftYear) && Number.isInteger(rightYear)) {
    leftYear = rightYear;
    anchorMode = "explicit";
  } else if (!Number.isInteger(leftYear) && !Number.isInteger(rightYear)) {
    if (!Number.isInteger(analysisYear) || !isFullSingleYearAnalysisRange(analysisRange)) {
      return {
        requested_time_window: buildBareQuarterAmbiguousWindow(leftExpression.label || "Q" + leftExpression.quarter),
        comparison_time_window: buildBareQuarterAmbiguousWindow(rightExpression.label || "Q" + rightExpression.quarter),
        time_compare_mode: "quarter_compare",
      };
    }
    leftYear = analysisYear;
    rightYear = analysisYear;
    anchorMode = "analysis_year";
  }

  if (!Number.isInteger(leftYear) || !Number.isInteger(rightYear)) {
    return {
      requested_time_window: buildBareQuarterAmbiguousWindow(leftExpression.label || "Q" + leftExpression.quarter),
      comparison_time_window: buildBareQuarterAmbiguousWindow(rightExpression.label || "Q" + rightExpression.quarter),
      time_compare_mode: "quarter_compare",
    };
  }

  return {
    requested_time_window: buildQuarterWindowFromExpression(leftExpression, leftYear, leftExpression.explicitYear ? "explicit" : anchorMode),
    comparison_time_window: buildQuarterWindowFromExpression(rightExpression, rightYear, rightExpression.explicitYear ? "explicit" : anchorMode),
    time_compare_mode: "quarter_compare",
  };
}

function parseAbsoluteTimeWindow(message, analysisRange) {
  const text = trimString(message);
  if (!text) {
    return createEmptyRequestedTimeWindow();
  }

  let matched = text.match(/(\d{4})-(\d{2})/);
  if (matched) {
    const startMonth = formatYm(Number(matched[1]), Number(matched[2]));
    return buildAbsoluteWindow(matched[0], startMonth, startMonth);
  }

  matched = text.match(/(\d{4})年\s*(\d{1,2})月/);
  if (matched) {
    const startMonth = formatYm(Number(matched[1]), Number(matched[2]));
    return buildAbsoluteWindow(`${matched[1]}年${matched[2]}月`, startMonth, startMonth);
  }

  matched = text.match(/(\d{4})年\s*[Qq]\s*([1-4])/);
  if (matched) {
    const year = Number(matched[1]);
    const quarter = Number(matched[2]);
    const startMonth = formatYm(year, (quarter - 1) * 3 + 1);
    const endMonth = formatYm(year, quarter * 3);
    return buildAbsoluteWindow(`${year}年Q${quarter}`, startMonth, endMonth);
  }

  matched = text.match(/(\d{4})年\s*([1-4])季度/);
  if (matched) {
    const year = Number(matched[1]);
    const quarter = Number(matched[2]);
    const startMonth = formatYm(year, (quarter - 1) * 3 + 1);
    const endMonth = formatYm(year, quarter * 3);
    return buildAbsoluteWindow(`${year}年${quarter}季度`, startMonth, endMonth);
  }

  matched = text.match(/(\d{4})年\s*第?\s*([一二三四])季度/);
  if (matched) {
    const year = Number(matched[1]);
    const quarter = parseBareQuarterNumber(`第${matched[2]}`);
    const startMonth = formatYm(year, (quarter - 1) * 3 + 1);
    const endMonth = formatYm(year, quarter * 3);
    return buildAbsoluteWindow(`${year}年Q${quarter}`, startMonth, endMonth);
  }

  matched = text.match(/(?:^|[^\dA-Za-z])((?:Q\s*[1-4]\s*季度)|(?:Q\s*[1-4])|(?:[1-4]季度)|(?:第[一二三四]季度)|(?:[一二三四]季度))(?:$|[^\dA-Za-z])/i);
  if (matched) {
    const rawLabel = trimString(matched[1]);
    const quarter = parseBareQuarterNumber(rawLabel);
    const label = rawLabel.replace(/\s+/g, "");
    const analysisYear = resolveAnalysisRangeYearAnchor(analysisRange);
    if (!quarter) {
      return createEmptyRequestedTimeWindow();
    }
    if (!analysisYear) {
      return buildBareQuarterAmbiguousWindow(label || `Q${quarter}`);
    }
    const startMonth = formatYm(analysisYear, (quarter - 1) * 3 + 1);
    const endMonth = formatYm(analysisYear, quarter * 3);
    return buildAbsoluteWindow(label || `Q${quarter}`, startMonth, endMonth, "analysis_year");
  }

  return createEmptyRequestedTimeWindow();
}

function parseRelativeTimeWindow(message, currentYm) {
  const text = trimString(message);
  if (!text || !currentYm) {
    return createEmptyRequestedTimeWindow();
  }

  if (text.includes("本月")) {
    return buildRelativeWindow("本月", currentYm, currentYm);
  }
  if (text.includes("上月")) {
    const lastMonth = addMonthsToYm(currentYm, -1);
    return buildRelativeWindow("上月", lastMonth, lastMonth);
  }

  let matched = text.match(/(?:近|最近)\s*([一二两三四五六七八九十\d]+)\s*个?月/);
  if (matched) {
    return buildRecentCompleteMonthsWindow(`近${matched[1]}个月`, toIntegerMonthCount(matched[1], 3), currentYm);
  }

  matched = text.match(/前\s*([一二两三四五六七八九十\d]+)\s*个?月/);
  if (matched) {
    return buildRecentCompleteMonthsWindow(`前${matched[1]}个月`, toIntegerMonthCount(matched[1], 2), currentYm);
  }

  if (text.includes("今年")) {
    return buildCurrentYearWindow("今年", currentYm);
  }
  if (text.includes("去年")) {
    return buildPreviousYearWindow("去年", currentYm);
  }
  if (text.includes("本季度")) {
    return buildCurrentQuarterWindow("本季度", currentYm);
  }
  if (text.includes("上季度")) {
    return buildPreviousQuarterWindow("上季度", currentYm);
  }

  return createEmptyRequestedTimeWindow();
}

export function parseRequestedTimeWindow(message, options = {}) {
  const intent = parseTimeIntent(message, options);
  return intent.requested_time_window;
}

export function parseTimeIntent(message, options = {}) {
  const compareIntent = parseQuarterCompareIntent(message, options.analysisRange);
  if (compareIntent) {
    return compareIntent;
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const timeZone = trimString(options.timeZone) || DEFAULT_TIMEZONE;
  const absoluteWindow = parseAbsoluteTimeWindow(message, options.analysisRange);
  if (absoluteWindow.kind !== "none") {
    return {
      requested_time_window: absoluteWindow,
      comparison_time_window: createEmptyRequestedTimeWindow(),
      time_compare_mode: "none",
    };
  }
  const currentYm = getCurrentYearMonth(now, timeZone);
  return {
    requested_time_window: parseRelativeTimeWindow(message, currentYm),
    comparison_time_window: createEmptyRequestedTimeWindow(),
    time_compare_mode: "none",
  };
}

export function buildTimeWindowCoverage(requestedTimeWindow, businessSnapshot) {
  const snapshot = normalizeBusinessSnapshot(businessSnapshot);
  const startMonth = trimString(snapshot?.analysis_range?.start_month);
  const endMonth = trimString(snapshot?.analysis_range?.end_month);
  const availablePeriod = buildPeriod(startMonth, endMonth);
  const requestedStart = trimString(requestedTimeWindow?.start_month);
  const requestedEnd = trimString(requestedTimeWindow?.end_month);
  if (!requestedStart || !requestedEnd || trimString(requestedTimeWindow?.kind) === "none") {
    return {
      ...createEmptyCoverage(),
      available_start_month: startMonth,
      available_end_month: endMonth,
      available_period: availablePeriod,
    };
  }

  const hasValidAvailable = Boolean(parseYm(startMonth) && parseYm(endMonth));
  if (!hasValidAvailable) {
    return {
      code: "none",
      available_start_month: startMonth,
      available_end_month: endMonth,
      available_period: availablePeriod,
    };
  }

  const full =
    compareYm(requestedStart, startMonth) >= 0 &&
    compareYm(requestedEnd, endMonth) <= 0;
  if (full) {
    return {
      code: "full",
      available_start_month: startMonth,
      available_end_month: endMonth,
      available_period: availablePeriod,
    };
  }

  const overlapExists =
    compareYm(requestedEnd, startMonth) >= 0 &&
    compareYm(requestedStart, endMonth) <= 0;
  return {
    code: overlapExists ? "partial" : "none",
    available_start_month: startMonth,
    available_end_month: endMonth,
    available_period: availablePeriod,
  };
}

export function applyRequestedTimeWindowToSnapshot(snapshot, requestedTimeWindow) {
  const normalizedSnapshot = normalizeBusinessSnapshot(snapshot);
  if (trimString(requestedTimeWindow?.kind) === "none") {
    return normalizedSnapshot;
  }
  const startMonth = trimString(requestedTimeWindow?.start_month);
  const endMonth = trimString(requestedTimeWindow?.end_month);
  if (!startMonth || !endMonth) {
    return normalizedSnapshot;
  }
  return normalizeBusinessSnapshot({
    ...normalizedSnapshot,
    analysis_range: {
      start_month: startMonth,
      end_month: endMonth,
      period: buildPeriod(startMonth, endMonth),
    },
    performance_overview: {},
    key_business_signals: [],
    product_performance: [],
    hospital_performance: [],
    recent_trends: [],
    risk_alerts: [],
    opportunity_hints: [],
  });
}

export function buildTimeWindowOutputContextFields(requestedTimeWindow, coverage) {
  return {
    requested_time_window_kind: trimString(requestedTimeWindow?.kind) || "none",
    requested_time_window_label: trimString(requestedTimeWindow?.label),
    requested_time_window_start_month: trimString(requestedTimeWindow?.start_month),
    requested_time_window_end_month: trimString(requestedTimeWindow?.end_month),
    requested_time_window_period: trimString(requestedTimeWindow?.period),
    requested_time_window_anchor_mode: trimString(requestedTimeWindow?.anchor_mode) || "none",
    time_window_coverage_code: trimString(coverage?.code) || "none",
    available_time_window_start_month: trimString(coverage?.available_start_month),
    available_time_window_end_month: trimString(coverage?.available_end_month),
    available_time_window_period: trimString(coverage?.available_period),
  };
}

export function buildComparisonTimeWindowOutputContextFields(comparisonTimeWindow, coverage, timeCompareMode = "none") {
  return {
    comparison_time_window_kind: trimString(comparisonTimeWindow?.kind) || "none",
    comparison_time_window_label: trimString(comparisonTimeWindow?.label),
    comparison_time_window_start_month: trimString(comparisonTimeWindow?.start_month),
    comparison_time_window_end_month: trimString(comparisonTimeWindow?.end_month),
    comparison_time_window_period: trimString(comparisonTimeWindow?.period),
    comparison_time_window_anchor_mode: trimString(comparisonTimeWindow?.anchor_mode) || "none",
    comparison_time_window_coverage_code: trimString(coverage?.code) || "none",
    comparison_available_time_window_start_month: trimString(coverage?.available_start_month),
    comparison_available_time_window_end_month: trimString(coverage?.available_end_month),
    comparison_available_time_window_period: trimString(coverage?.available_period),
    time_compare_mode: trimString(timeCompareMode) || "none",
  };
}

function listAvailableSuggestionWindow(requestedTimeWindow, coverage) {
  const availableStart = trimString(coverage?.available_start_month);
  const availableEnd = trimString(coverage?.available_end_month);
  const requestedStart = trimString(requestedTimeWindow?.start_month);
  const requestedEnd = trimString(requestedTimeWindow?.end_month);
  if (!availableStart || !availableEnd) {
    return "";
  }
  if (!requestedStart || !requestedEnd) {
    return buildPeriod(availableStart, availableEnd);
  }
  const parsedStart = parseYm(requestedStart);
  const parsedEnd = parseYm(requestedEnd);
  const parsedAvailableStart = parseYm(availableStart);
  const parsedAvailableEnd = parseYm(availableEnd);
  if (!parsedStart || !parsedEnd || !parsedAvailableStart || !parsedAvailableEnd) {
    return buildPeriod(availableStart, availableEnd);
  }
  const span = Math.max(1, (parsedEnd.year - parsedStart.year) * 12 + (parsedEnd.month - parsedStart.month) + 1);
  const availableSpan = Math.max(1, (parsedAvailableEnd.year - parsedAvailableStart.year) * 12 + (parsedAvailableEnd.month - parsedAvailableStart.month) + 1);
  const safeSpan = Math.min(span, availableSpan);
  const suggestedStart = addMonthsToYm(availableEnd, -(safeSpan - 1));
  return buildPeriod(suggestedStart, availableEnd);
}

export function buildTimeWindowBoundaryReply({ requestedTimeWindow, coverage }) {
  const label = trimString(requestedTimeWindow?.label) || "该时间范围";
  const requestedPeriod = trimString(requestedTimeWindow?.period);
  const availablePeriod = trimString(coverage?.available_period);
  const requestedKind = trimString(requestedTimeWindow?.kind);
  const anchorMode = trimString(requestedTimeWindow?.anchor_mode);
  if (requestedKind !== "none" && !requestedPeriod && anchorMode === "none") {
    return [
      `你提到的是未写年份的季度（${label}）。`,
      `当前可用分析区间为 ${availablePeriod || "当前报表区间"}，暂时无法唯一确定这个季度所属年份，因此我先不替你自动选年份。`,
      "若你希望，我可以按当前报表所在年份的对应季度来分析。",
    ].join("\n");
  }
  if (!requestedPeriod || !availablePeriod) {
    return "当前时间范围无法与现有分析区间对齐，我先不直接改写时间口径来回答。若你希望，我可以按当前报表范围内的时间来分析。";
  }
  const suggestedPeriod = listAvailableSuggestionWindow(requestedTimeWindow, coverage);
  const suggestionLine = suggestedPeriod
    ? `如果你希望，我可以按当前报表范围内最近可用时间来分析，例如按 ${suggestedPeriod} 来看。`
    : "如果你希望，我可以按当前报表范围内最近可用时间来分析。";
  return [
    `按真实时间口径，“${label}”指 ${requestedPeriod}。`,
    `当前可用分析区间为 ${availablePeriod}，当前区间无法完整覆盖你的时间请求，因此我先不直接把它改写为当前报表尾部时间来回答。`,
    suggestionLine,
  ].join("\n");
}

export function buildTimeCompareBoundaryReply({
  requestedTimeWindow,
  comparisonTimeWindow,
  primaryCoverage,
  comparisonCoverage,
  timeCompareMode,
}) {
  const requestedLabel = trimString(requestedTimeWindow?.label) || "主窗口";
  const comparisonLabel = trimString(comparisonTimeWindow?.label) || "对比窗口";
  const requestedPeriod = trimString(requestedTimeWindow?.period);
  const comparisonPeriod = trimString(comparisonTimeWindow?.period);
  const availablePeriod = trimString(primaryCoverage?.available_period) || trimString(comparisonCoverage?.available_period);
  const anchorMode =
    trimString(requestedTimeWindow?.anchor_mode) === "none" || trimString(comparisonTimeWindow?.anchor_mode) === "none"
      ? "none"
      : trimString(requestedTimeWindow?.anchor_mode) || trimString(comparisonTimeWindow?.anchor_mode);

  if (trimString(timeCompareMode) === "quarter_compare" && anchorMode === "none") {
    return [
      `你提到的是未写年份的季度对比（${requestedLabel} 对 ${comparisonLabel}）。`,
      `当前可用分析区间为 ${availablePeriod || "当前报表区间"}，暂时无法唯一确定这两个季度所属年份，因此我先不替你自动选年份。`,
      "若你希望，我可以按当前报表所在年份的 Q4 和 Q3 来分析。",
    ].join("\n");
  }

  return [
    `本轮对比请求的时间区间分别为 ${requestedPeriod || requestedLabel} 和 ${comparisonPeriod || comparisonLabel}。`,
    `当前可用分析区间为 ${availablePeriod || "当前报表区间"}，两段时间未被完整覆盖，因此我先不自动改写成报表尾部可比窗口来回答。`,
    "如果你希望，我可以按当前报表范围内可完整覆盖的时间窗口重新做对比分析。",
  ].join("\n");
}

export function buildTimeWindowBoundaryReplyFromOutputContext(outputContext) {
  const timeCompareMode = trimString(outputContext?.time_compare_mode);
  if (timeCompareMode !== "none") {
    return buildTimeCompareBoundaryReply({
      requestedTimeWindow: {
        label: trimString(outputContext?.requested_time_window_label),
        period: trimString(outputContext?.requested_time_window_period),
        anchor_mode: trimString(outputContext?.requested_time_window_anchor_mode),
      },
      comparisonTimeWindow: {
        label: trimString(outputContext?.comparison_time_window_label),
        period: trimString(outputContext?.comparison_time_window_period),
        anchor_mode: trimString(outputContext?.comparison_time_window_anchor_mode),
      },
      primaryCoverage: {
        available_period: trimString(outputContext?.available_time_window_period),
      },
      comparisonCoverage: {
        available_period: trimString(outputContext?.comparison_available_time_window_period),
      },
      timeCompareMode,
    });
  }
  return buildTimeWindowBoundaryReply({
    requestedTimeWindow: {
      kind: trimString(outputContext?.requested_time_window_kind),
      label: trimString(outputContext?.requested_time_window_label),
      period: trimString(outputContext?.requested_time_window_period),
      anchor_mode: trimString(outputContext?.requested_time_window_anchor_mode),
      start_month: trimString(outputContext?.requested_time_window_start_month),
      end_month: trimString(outputContext?.requested_time_window_end_month),
    },
    coverage: {
      code: trimString(outputContext?.time_window_coverage_code),
      available_period: trimString(outputContext?.available_time_window_period),
      available_start_month: trimString(outputContext?.available_time_window_start_month),
      available_end_month: trimString(outputContext?.available_time_window_end_month),
    },
  });
}
