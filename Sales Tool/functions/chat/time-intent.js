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
  };
}

function buildAbsoluteWindow(label, startMonth, endMonth) {
  return {
    kind: "absolute",
    label,
    start_month: startMonth,
    end_month: endMonth,
    period: buildPeriod(startMonth, endMonth),
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

function parseAbsoluteTimeWindow(message) {
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
  const now = options.now instanceof Date ? options.now : new Date();
  const timeZone = trimString(options.timeZone) || DEFAULT_TIMEZONE;
  const absoluteWindow = parseAbsoluteTimeWindow(message);
  if (absoluteWindow.kind !== "none") {
    return absoluteWindow;
  }
  const currentYm = getCurrentYearMonth(now, timeZone);
  return parseRelativeTimeWindow(message, currentYm);
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
    time_window_coverage_code: trimString(coverage?.code) || "none",
    available_time_window_start_month: trimString(coverage?.available_start_month),
    available_time_window_end_month: trimString(coverage?.available_end_month),
    available_time_window_period: trimString(coverage?.available_period),
  };
}

export function buildTimeWindowBoundaryReply({ requestedTimeWindow, coverage }) {
  const label = trimString(requestedTimeWindow?.label) || "该时间范围";
  const requestedPeriod = trimString(requestedTimeWindow?.period);
  const availablePeriod = trimString(coverage?.available_period);
  if (!requestedPeriod || !availablePeriod) {
    return "当前时间范围无法与现有分析区间对齐，我先不直接改写时间口径来回答。若你希望，我可以按当前报表范围内的时间来分析。";
  }
  return [
    `按真实时间口径，“${label}”指 ${requestedPeriod}。`,
    `当前可用分析区间为 ${availablePeriod}，当前区间无法完整覆盖你的时间请求，因此我先不直接把它改写为当前报表尾部时间来回答。`,
    "若你希望，我可以按当前报表范围内的时间来分析。",
  ].join("\n");
}

export function buildTimeWindowBoundaryReplyFromOutputContext(outputContext) {
  return buildTimeWindowBoundaryReply({
    requestedTimeWindow: {
      label: trimString(outputContext?.requested_time_window_label),
      period: trimString(outputContext?.requested_time_window_period),
    },
    coverage: {
      available_period: trimString(outputContext?.available_time_window_period),
    },
  });
}
