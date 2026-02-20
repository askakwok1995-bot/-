export const RECORDS_STORAGE_KEY = "sales_records_v1";
export const PRODUCT_MASTER_STORAGE_KEY = "sales_product_master_v1";
export const TARGETS_STORAGE_KEY = "sales_targets_v1";
export const SALES_DRAFT_STORAGE_KEY = "sales_form_draft_v1";
export const REPORT_RANGE_STORAGE_KEY = "sales_report_range_v1";
export const REPORT_CHART_PALETTE_STORAGE_KEY = "sales_report_chart_palette_v1";
export const TARGETS_VERSION = 1;
export const TARGET_METRIC_TYPE = "amount";
export const TARGET_QUARTERS = [
  { key: "Q1", label: "Q1（1-3月）", months: [1, 2, 3] },
  { key: "Q2", label: "Q2（4-6月）", months: [4, 5, 6] },
  { key: "Q3", label: "Q3（7-9月）", months: [7, 8, 9] },
  { key: "Q4", label: "Q4（10-12月）", months: [10, 11, 12] },
];

export function loadProducts() {
  const raw = localStorage.getItem(PRODUCT_MASTER_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => normalizeProduct(item))
      .filter((item) => item !== null);
  } catch (_error) {
    return [];
  }
}

export function loadRecords() {
  const raw = localStorage.getItem(RECORDS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => normalizeRecord(item))
      .filter((item) => item !== null);
  } catch (_error) {
    return [];
  }
}

export function saveProducts(state) {
  localStorage.setItem(PRODUCT_MASTER_STORAGE_KEY, JSON.stringify(state.products));
}

export function saveRecords(state) {
  localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(state.records));
}

export function loadSalesDraft() {
  const raw = localStorage.getItem(SALES_DRAFT_STORAGE_KEY);
  if (!raw) return normalizeSalesDraft({});

  try {
    const parsed = JSON.parse(raw);
    return normalizeSalesDraft(parsed);
  } catch (_error) {
    return normalizeSalesDraft({});
  }
}

export function saveSalesDraft(draft) {
  const normalized = normalizeSalesDraft(draft);
  normalized.updatedAt = new Date().toISOString();
  localStorage.setItem(SALES_DRAFT_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearSalesDraft() {
  localStorage.removeItem(SALES_DRAFT_STORAGE_KEY);
}

export function loadReportRange(defaultRange) {
  const fallback = normalizeReportRangePayload(defaultRange);
  const raw = localStorage.getItem(REPORT_RANGE_STORAGE_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    return normalizeReportRangePayload(parsed, fallback);
  } catch (_error) {
    return fallback;
  }
}

export function saveReportRange(range) {
  const normalized = normalizeReportRangePayload(range);
  if (!normalized) return;
  localStorage.setItem(REPORT_RANGE_STORAGE_KEY, JSON.stringify(normalized));
}

export function loadReportChartPalette(defaultPaletteId) {
  const fallback = String(defaultPaletteId || "").trim() || "classic";
  const raw = localStorage.getItem(REPORT_CHART_PALETTE_STORAGE_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    const value = typeof parsed === "string" ? parsed : parsed && parsed.paletteId;
    const normalized = String(value || "").trim();
    return normalized || fallback;
  } catch (_error) {
    return fallback;
  }
}

export function saveReportChartPalette(paletteId) {
  const normalized = String(paletteId || "").trim();
  if (!normalized) return;
  localStorage.setItem(REPORT_CHART_PALETTE_STORAGE_KEY, JSON.stringify(normalized));
}

export function loadTargets() {
  const raw = localStorage.getItem(TARGETS_STORAGE_KEY);
  if (!raw) return createDefaultTargetsPayload();

  try {
    const parsed = JSON.parse(raw);
    return normalizeTargetsPayload(parsed);
  } catch (_error) {
    return createDefaultTargetsPayload();
  }
}

export function saveTargets(state) {
  localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(state.targets));
}

export function createDefaultTargetsPayload() {
  return {
    version: TARGETS_VERSION,
    metricType: TARGET_METRIC_TYPE,
    years: {},
  };
}

export function normalizeTargetsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return createDefaultTargetsPayload();
  }

  const normalized = createDefaultTargetsPayload();
  const sourceYears = payload.years;
  if (!sourceYears || typeof sourceYears !== "object") {
    return normalized;
  }

  for (const [yearKey, yearData] of Object.entries(sourceYears)) {
    const year = Number(yearKey);
    if (!Number.isInteger(year)) continue;
    normalized.years[String(year)] = normalizeTargetYearData(year, yearData);
  }

  return normalized;
}

export function normalizeTargetYearData(year, yearData) {
  const normalized = createDefaultTargetYear(year);
  if (!yearData || typeof yearData !== "object") {
    return normalized;
  }

  const sourceQuarters = yearData.quarters;
  if (sourceQuarters && typeof sourceQuarters === "object") {
    for (const quarter of TARGET_QUARTERS) {
      const sourceQuarter = sourceQuarters[quarter.key];
      if (!sourceQuarter || typeof sourceQuarter !== "object") continue;

      normalized.quarters[quarter.key].quarterTarget = normalizeTargetNumber(sourceQuarter.quarterTarget);
      const sourceMonths = sourceQuarter.months;
      if (!sourceMonths || typeof sourceMonths !== "object") continue;

      for (const month of quarter.months) {
        normalized.quarters[quarter.key].months[String(month)] = normalizeTargetNumber(sourceMonths[String(month)]);
      }
    }
  }

  const sourceAllocations = yearData.productAllocations;
  if (sourceAllocations && typeof sourceAllocations === "object") {
    for (const [productId, sourceEntry] of Object.entries(sourceAllocations)) {
      const normalizedEntry = normalizeProductAllocationEntry(productId, sourceEntry);
      if (!normalizedEntry) continue;
      normalized.productAllocations[normalizedEntry.productId] = normalizedEntry;
    }
  }

  if (typeof yearData.updatedAt === "string" && !Number.isNaN(Date.parse(yearData.updatedAt))) {
    normalized.updatedAt = yearData.updatedAt;
  }

  return normalized;
}

export function createDefaultTargetYear(year) {
  const quarters = {};
  for (const quarter of TARGET_QUARTERS) {
    const months = {};
    for (const month of quarter.months) {
      months[String(month)] = 0;
    }
    quarters[quarter.key] = {
      quarterTarget: 0,
      months,
    };
  }

  return {
    year,
    quarters,
    productAllocations: {},
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProductAllocationEntry(productId, sourceEntry) {
  const safeProductId = String(productId || "").trim();
  if (!safeProductId) return null;
  if (!sourceEntry || typeof sourceEntry !== "object") {
    return createDefaultProductAllocationEntry(safeProductId, "");
  }

  const months = {};
  const sourceMonths = sourceEntry.months && typeof sourceEntry.months === "object" ? sourceEntry.months : {};
  for (let month = 1; month <= 12; month += 1) {
    months[String(month)] = normalizeTargetNumber(sourceMonths[String(month)]);
  }

  return {
    productId: safeProductId,
    productName: String(sourceEntry.productName || "").trim(),
    months,
  };
}

function createDefaultProductAllocationEntry(productId, productName) {
  const months = {};
  for (let month = 1; month <= 12; month += 1) {
    months[String(month)] = 0;
  }

  return {
    productId,
    productName: String(productName || "").trim(),
    months,
  };
}

export function normalizeTargetNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return roundMoney(num);
}

export function normalizeProduct(item) {
  if (!item || typeof item !== "object") return null;

  const id = String(item.id || "").trim();
  const productName = String(item.productName || "").trim();
  const unitPrice = Number(item.unitPrice);

  if (!id || !productName || !Number.isFinite(unitPrice) || unitPrice < 0) return null;

  return {
    id,
    productName,
    unitPrice: roundMoney(unitPrice),
  };
}

export function normalizeRecord(item) {
  if (!item || typeof item !== "object") return null;

  const id = String(item.id || "").trim();
  const date = String(item.date || "").trim();
  const hospital = String(item.hospital || "").trim();
  const delivery = String(item.delivery || "").trim();

  const quantity = Number(item.quantity);
  const amount = Number(item.amount);

  const legacyProductName = String(item.product || "").trim();
  const productName = String(item.productName || legacyProductName).trim();
  const productId = String(item.productId || "").trim();
  const unitPriceSnapshot = Number(item.unitPriceSnapshot);

  if (!id || !date || !productName || !hospital || !delivery) return null;
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity === 0) return null;
  if (!Number.isFinite(amount)) return null;

  return {
    id,
    date,
    productId,
    productName,
    unitPriceSnapshot: Number.isFinite(unitPriceSnapshot) ? roundMoney(unitPriceSnapshot) : null,
    hospital,
    quantity,
    amount: roundMoney(amount),
    delivery,
  };
}

export function normalizeSalesDraft(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      date: "",
      productId: "",
      hospital: "",
      quantity: "",
      delivery: "",
      updatedAt: "",
    };
  }

  const updatedAtRaw = String(payload.updatedAt || "").trim();
  const updatedAt =
    updatedAtRaw && !Number.isNaN(Date.parse(updatedAtRaw))
      ? updatedAtRaw
      : "";

  return {
    date: String(payload.date || "").trim(),
    productId: String(payload.productId || "").trim(),
    hospital: String(payload.hospital || "").trim(),
    quantity: String(payload.quantity || "").trim(),
    delivery: String(payload.delivery || "").trim(),
    updatedAt,
  };
}

export function buildId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeText(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value) {
  if (!Number.isFinite(value)) return "-";
  return String(roundMoney(value));
}

export function formatDate(year, month, day) {
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeReportRangePayload(payload, fallback = null) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const startYm = normalizeYmText(payload.startYm);
  const endYm = normalizeYmText(payload.endYm);
  if (!startYm || !endYm) {
    return fallback;
  }

  if (startYm > endYm) {
    return fallback;
  }

  return { startYm, endYm };
}

function normalizeYmText(value) {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
}
