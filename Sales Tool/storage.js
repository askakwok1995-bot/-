import {
  TARGETS_VERSION as TARGETS_VERSION_VALUE,
  TARGET_METRIC_TYPE as TARGET_METRIC_TYPE_VALUE,
  createDefaultTargetYear as createDefaultTargetYearValue,
  createDefaultTargetsPayload as createDefaultTargetsPayloadValue,
  normalizeTargetNumber as normalizeTargetNumberValue,
  normalizeTargetYearData as normalizeTargetYearDataValue,
  normalizeTargetsPayload as normalizeTargetsPayloadValue,
} from "./domain/targets-model.js";

export const RECORDS_STORAGE_KEY = "sales_records_v1";
export const PRODUCT_MASTER_STORAGE_KEY = "sales_product_master_v1";
export const TARGETS_STORAGE_KEY = "sales_targets_v1";
export const SALES_DRAFT_STORAGE_KEY = "sales_form_draft_v1";
export const REPORT_RANGE_STORAGE_KEY = "sales_report_range_v1";
export const REPORT_CHART_PALETTE_STORAGE_KEY = "sales_report_chart_palette_v1";
export const REPORT_CHART_DATA_LABEL_STORAGE_KEY = "sales_report_chart_data_label_v1";
export const REPORT_AMOUNT_UNIT_STORAGE_KEY = "sales_report_amount_unit_v1";
export const TARGETS_VERSION = TARGETS_VERSION_VALUE;
export const TARGET_METRIC_TYPE = TARGET_METRIC_TYPE_VALUE;
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

// Deprecated: 不再用于主流程，保留仅用于兼容旧代码路径。
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

export function buildScopedRecordsStorageKey(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return "";
  return `${RECORDS_STORAGE_KEY}:${normalizedUserId}`;
}

// Deprecated: 不再用于主流程，保留仅用于兼容旧代码路径。
export function loadRecordsByUser(userId) {
  const scopedKey = buildScopedRecordsStorageKey(userId);
  if (!scopedKey) return [];

  const raw = localStorage.getItem(scopedKey);
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

// Deprecated: 不再用于主流程，保留仅用于兼容旧代码路径。
export function saveRecords(state) {
  localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(state.records));
}

// Deprecated: 不再用于主流程，保留仅用于兼容旧代码路径。
export function saveRecordsByUser(userId, state) {
  const scopedKey = buildScopedRecordsStorageKey(userId);
  if (!scopedKey) return;
  localStorage.setItem(scopedKey, JSON.stringify(state.records));
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
  const fallback = normalizeReportRangeFallback(defaultRange);
  const raw = localStorage.getItem(REPORT_RANGE_STORAGE_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeReportRangePayload(parsed, fallback);
    return normalized || fallback;
  } catch (_error) {
    return fallback;
  }
}

export function saveReportRange(range) {
  const normalized = normalizeReportRangePayload(range, null);
  if (!normalized) return;
  localStorage.setItem(REPORT_RANGE_STORAGE_KEY, JSON.stringify(normalized));
}

export function loadReportChartPalette(defaultPaletteId) {
  const fallback = String(defaultPaletteId || "").trim() || "harbor";
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

export function loadReportChartDataLabelMode(defaultMode) {
  const fallback = normalizeReportChartDataLabelModePayload(defaultMode);
  const raw = localStorage.getItem(REPORT_CHART_DATA_LABEL_STORAGE_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      return normalizeReportChartDataLabelModePayload(parsed);
    }
    if (typeof parsed === "boolean") {
      return parsed ? "compact" : "none";
    }
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.mode === "string") {
        return normalizeReportChartDataLabelModePayload(parsed.mode);
      }
      if (typeof parsed.enabled === "boolean") {
        return parsed.enabled ? "compact" : "none";
      }
    }
    return fallback;
  } catch (_error) {
    return fallback;
  }
}

export function saveReportChartDataLabelMode(mode) {
  const normalized = normalizeReportChartDataLabelModePayload(mode);
  localStorage.setItem(REPORT_CHART_DATA_LABEL_STORAGE_KEY, JSON.stringify(normalized));
}

export function loadReportAmountUnit(defaultUnitId) {
  const fallback = String(defaultUnitId || "").trim() || "yuan";
  const raw = localStorage.getItem(REPORT_AMOUNT_UNIT_STORAGE_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    const value = typeof parsed === "string" ? parsed : parsed && parsed.unitId;
    const normalized = String(value || "").trim();
    return normalized || fallback;
  } catch (_error) {
    return fallback;
  }
}

export function saveReportAmountUnit(unitId) {
  const normalized = String(unitId || "").trim();
  if (!normalized) return;
  localStorage.setItem(REPORT_AMOUNT_UNIT_STORAGE_KEY, JSON.stringify(normalized));
}

// Deprecated: 不再用于主流程，保留仅用于兼容旧代码路径。
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

// Deprecated: 不再用于主流程，保留仅用于兼容旧代码路径。
export function saveTargets(state) {
  localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(state.targets));
}

export function createDefaultTargetsPayload() {
  return createDefaultTargetsPayloadValue();
}

export function normalizeTargetsPayload(payload) {
  return normalizeTargetsPayloadValue(payload);
}

export function normalizeTargetYearData(year, yearData) {
  return normalizeTargetYearDataValue(year, yearData);
}

export function createDefaultTargetYear(year) {
  return createDefaultTargetYearValue(year);
}

export function normalizeTargetNumber(value) {
  return normalizeTargetNumberValue(value);
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

const EMPTY_REPORT_RANGE_PAYLOAD = Object.freeze({
  startYm: "",
  endYm: "",
});

function normalizeReportRangeFallback(fallback) {
  if (!fallback || typeof fallback !== "object") {
    return { ...EMPTY_REPORT_RANGE_PAYLOAD };
  }
  const startYm = normalizeYmText(fallback.startYm);
  const endYm = normalizeYmText(fallback.endYm);
  if (!startYm || !endYm || startYm > endYm) {
    return { ...EMPTY_REPORT_RANGE_PAYLOAD };
  }
  return { startYm, endYm };
}

function normalizeReportRangePayload(payload, fallback = EMPTY_REPORT_RANGE_PAYLOAD) {
  const safeFallback = fallback === null ? null : normalizeReportRangeFallback(fallback);
  if (!payload || typeof payload !== "object") {
    return safeFallback;
  }

  const startYm = normalizeYmText(payload.startYm ?? payload.startMonth ?? payload.start);
  const endYm = normalizeYmText(payload.endYm ?? payload.endMonth ?? payload.end);
  if (!startYm || !endYm) {
    return safeFallback;
  }

  if (startYm > endYm) {
    return safeFallback;
  }

  return { startYm, endYm };
}

function normalizeYmText(value) {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
}

function normalizeReportChartDataLabelModePayload(raw) {
  const value = String(raw || "").trim();
  if (value === "none" || value === "compact" || value === "emphasis") {
    return value;
  }
  return "none";
}
