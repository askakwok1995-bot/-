const QUARTER_MONTHS = Object.freeze({
  Q1: Object.freeze([1, 2, 3]),
  Q2: Object.freeze([4, 5, 6]),
  Q3: Object.freeze([7, 8, 9]),
  Q4: Object.freeze([10, 11, 12]),
});

export const TARGETS_VERSION = 2;
export const TARGET_METRIC_TYPE = "dual";
export const TARGET_METRICS = Object.freeze(["amount", "quantity"]);
export const TARGET_ALLOCATION_MONTHS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

function roundTargetNumber(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isValidIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function normalizeTargetMetric(value, fallback = "amount") {
  const text = String(value || "").trim().toLowerCase();
  if (TARGET_METRICS.includes(text)) {
    return text;
  }
  return TARGET_METRICS.includes(fallback) ? fallback : "amount";
}

export function normalizeTargetNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return roundTargetNumber(num);
}

function createQuarterMonths(months) {
  const output = {};
  for (const month of months) {
    output[String(month)] = 0;
  }
  return output;
}

function createDefaultMetricTargets(metric = "amount") {
  const safeMetric = normalizeTargetMetric(metric);
  const quarters = {};
  for (const [quarterKey, months] of Object.entries(QUARTER_MONTHS)) {
    quarters[quarterKey] = {
      quarterTarget: 0,
      months: createQuarterMonths(months),
    };
  }
  return {
    metric: safeMetric,
    quarters,
  };
}

function createAllocationMonths() {
  const output = {};
  for (const month of TARGET_ALLOCATION_MONTHS) {
    output[String(month)] = 0;
  }
  return output;
}

export function createDefaultProductAllocationEntry(productId, productName) {
  return {
    productId: String(productId || "").trim(),
    productName: String(productName || "").trim(),
    amountMonths: createAllocationMonths(),
    quantityMonths: createAllocationMonths(),
  };
}

export function createDefaultTargetYear(year) {
  return {
    year: Number(year) || new Date().getFullYear(),
    targets: {
      amount: createDefaultMetricTargets("amount"),
      quantity: createDefaultMetricTargets("quantity"),
    },
    productAllocations: {},
    updatedAt: new Date().toISOString(),
  };
}

export function createDefaultTargetsPayload() {
  return {
    version: TARGETS_VERSION,
    metricType: TARGET_METRIC_TYPE,
    years: {},
  };
}

function normalizeQuarterTargets(sourceQuarter = {}, fallbackMonths = []) {
  const normalized = {
    quarterTarget: normalizeTargetNumber(sourceQuarter?.quarterTarget),
    months: createQuarterMonths(fallbackMonths),
  };
  const sourceMonths = sourceQuarter?.months && typeof sourceQuarter.months === "object" ? sourceQuarter.months : {};
  for (const month of fallbackMonths) {
    normalized.months[String(month)] = normalizeTargetNumber(sourceMonths[String(month)]);
  }
  return normalized;
}

function normalizeMetricTargets(sourceMetric = {}, fallbackMetric = "amount") {
  const normalized = createDefaultMetricTargets(fallbackMetric);
  const sourceQuarters = sourceMetric?.quarters && typeof sourceMetric.quarters === "object" ? sourceMetric.quarters : {};
  for (const [quarterKey, months] of Object.entries(QUARTER_MONTHS)) {
    normalized.quarters[quarterKey] = normalizeQuarterTargets(sourceQuarters[quarterKey], months);
  }
  return normalized;
}

function normalizeProductAllocationEntry(productId, sourceEntry = {}) {
  const safeProductId = String(productId || "").trim();
  if (!safeProductId) return null;

  const normalized = createDefaultProductAllocationEntry(safeProductId, sourceEntry?.productName || "");
  const sourceAmountMonths =
    sourceEntry?.amountMonths && typeof sourceEntry.amountMonths === "object"
      ? sourceEntry.amountMonths
      : sourceEntry?.months && typeof sourceEntry.months === "object"
        ? sourceEntry.months
        : {};
  const sourceQuantityMonths =
    sourceEntry?.quantityMonths && typeof sourceEntry.quantityMonths === "object" ? sourceEntry.quantityMonths : {};

  normalized.productName = String(sourceEntry?.productName || "").trim();
  for (const month of TARGET_ALLOCATION_MONTHS) {
    const monthKey = String(month);
    normalized.amountMonths[monthKey] = normalizeTargetNumber(sourceAmountMonths[monthKey]);
    normalized.quantityMonths[monthKey] = normalizeTargetNumber(sourceQuantityMonths[monthKey]);
  }

  return normalized;
}

function normalizeLegacyQuarters(sourceQuarters = {}) {
  return normalizeMetricTargets({ quarters: sourceQuarters }, "amount");
}

export function normalizeTargetYearData(year, sourceYearData) {
  const normalized = createDefaultTargetYear(year);
  if (!sourceYearData || typeof sourceYearData !== "object") {
    return normalized;
  }

  const hasDualTargets = sourceYearData.targets && typeof sourceYearData.targets === "object";
  if (hasDualTargets) {
    normalized.targets.amount = normalizeMetricTargets(sourceYearData.targets.amount, "amount");
    normalized.targets.quantity = normalizeMetricTargets(sourceYearData.targets.quantity, "quantity");
  } else if (sourceYearData.quarters && typeof sourceYearData.quarters === "object") {
    normalized.targets.amount = normalizeLegacyQuarters(sourceYearData.quarters);
  }

  const sourceAllocations =
    sourceYearData.productAllocations && typeof sourceYearData.productAllocations === "object"
      ? sourceYearData.productAllocations
      : {};
  for (const [productId, sourceEntry] of Object.entries(sourceAllocations)) {
    const entry = normalizeProductAllocationEntry(productId, sourceEntry);
    if (!entry) continue;
    normalized.productAllocations[entry.productId] = entry;
  }

  if (isValidIsoDate(sourceYearData.updatedAt)) {
    normalized.updatedAt = sourceYearData.updatedAt;
  }

  return normalized;
}

export function normalizeTargetsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return createDefaultTargetsPayload();
  }

  const normalized = createDefaultTargetsPayload();
  const sourceYears = payload.years && typeof payload.years === "object" ? payload.years : {};
  for (const [yearKey, sourceYearData] of Object.entries(sourceYears)) {
    const year = Number(yearKey);
    if (!Number.isInteger(year)) continue;
    normalized.years[String(year)] = normalizeTargetYearData(year, sourceYearData);
  }
  return normalized;
}

export function getTargetQuarterMonths(quarterKey) {
  const safeKey = String(quarterKey || "").trim().toUpperCase();
  return Array.isArray(QUARTER_MONTHS[safeKey]) ? QUARTER_MONTHS[safeKey].slice() : QUARTER_MONTHS.Q1.slice();
}

export function getYearMetricTargets(yearData, metric) {
  const safeMetric = normalizeTargetMetric(metric);
  const sourceTargets = yearData?.targets && typeof yearData.targets === "object" ? yearData.targets : {};
  const sourceMetricTargets = sourceTargets[safeMetric];
  return normalizeMetricTargets(sourceMetricTargets, safeMetric);
}

export function getProductAllocationMonths(entry, metric) {
  const safeMetric = normalizeTargetMetric(metric);
  if (!entry || typeof entry !== "object") {
    return createAllocationMonths();
  }
  const key = safeMetric === "quantity" ? "quantityMonths" : "amountMonths";
  const sourceMonths = entry[key] && typeof entry[key] === "object" ? entry[key] : {};
  const normalized = createAllocationMonths();
  for (const month of TARGET_ALLOCATION_MONTHS) {
    normalized[String(month)] = normalizeTargetNumber(sourceMonths[String(month)]);
  }
  return normalized;
}

export function buildMonthlyTargetMap(year, yearData, metric) {
  const safeYear = Number(year);
  if (!Number.isInteger(safeYear)) return null;

  const metricTargets = getYearMetricTargets(yearData, metric);
  const monthMap = {};
  for (const [quarterKey, quarterData] of Object.entries(metricTargets.quarters)) {
    const months = getTargetQuarterMonths(quarterKey);
    for (const month of months) {
      const ym = `${safeYear}-${String(month).padStart(2, "0")}`;
      monthMap[ym] = normalizeTargetNumber(quarterData.months[String(month)]);
    }
  }
  return monthMap;
}

export function buildProductAllocationMap(year, yearData, metric) {
  const safeYear = Number(year);
  if (!Number.isInteger(safeYear)) return null;

  const allocations = yearData?.productAllocations && typeof yearData.productAllocations === "object" ? yearData.productAllocations : {};
  const output = {};
  for (const month of TARGET_ALLOCATION_MONTHS) {
    const monthKey = String(month);
    const ym = `${safeYear}-${monthKey.padStart(2, "0")}`;
    const byProduct = {};
    for (const [productId, entry] of Object.entries(allocations)) {
      const months = getProductAllocationMonths(entry, metric);
      byProduct[productId] = normalizeTargetNumber(months[monthKey]);
    }
    output[ym] = byProduct;
  }
  return output;
}
