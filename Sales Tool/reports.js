import { buildReportSnapshot as buildReportSnapshotCore } from "./domain/report-snapshot.js";

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOSPITAL_TOP_LIMIT = 20;
const PRODUCT_CHART_TOP_LIMIT = 10;
const HOSPITAL_CHART_TOP_LIMIT = 10;
const CHART_RENDERER = "canvas";
const CHART_EMPTY_TEXT = "暂无可视化数据";
const CHART_CANVAS_BG = "rgba(0,0,0,0)";
const CHART_COMPACT_TIGHT_MAX = 5;
const CHART_COMPACT_MEDIUM_MAX = 8;
const CHART_COMPACT_MIN_VIEWPORT = 1024;
export const DEFAULT_REPORT_AMOUNT_UNIT_ID = "yuan";
export const DEFAULT_REPORT_CHART_DATA_LABEL_MODE = "compact";
const REPORT_CHART_DATA_LABEL_MODES = [
  { id: "none", label: "无" },
  { id: "compact", label: "简洁" },
  { id: "emphasis", label: "强调" },
];
const REPORT_AMOUNT_UNITS = [
  { id: "yuan", label: "元", divisor: 1 },
  { id: "thousand", label: "千元", divisor: 1000 },
  { id: "ten-thousand", label: "万元", divisor: 10000 },
  { id: "hundred-thousand", label: "十万元", divisor: 100000 },
  { id: "million", label: "百万元", divisor: 1000000 },
];
const CHART_KEYS = {
  monthlyTrend: "monthly-trend",
  quarterlyTrend: "quarterly-trend",
  productPerformance: "product-performance",
  productMonthlyTrend: "product-monthly-trend",
  productTop: "product-top",
  hospitalTop: "hospital-top",
  hospitalShare: "hospital-share",
  hospitalTrend: "hospital-trend",
};
const CHART_COMPACT_SIZE_BY_KEY = {
  [CHART_KEYS.monthlyTrend]: "wide",
  [CHART_KEYS.quarterlyTrend]: "wide",
  [CHART_KEYS.productPerformance]: "half",
  [CHART_KEYS.productMonthlyTrend]: "wide",
  [CHART_KEYS.productTop]: "pie",
  [CHART_KEYS.hospitalTop]: "half",
  [CHART_KEYS.hospitalShare]: "pie",
  [CHART_KEYS.hospitalTrend]: "wide",
};
const TARGET_CHART_KEYS = Object.freeze([
  CHART_KEYS.monthlyTrend,
  CHART_KEYS.quarterlyTrend,
  CHART_KEYS.productPerformance,
  CHART_KEYS.productMonthlyTrend,
  CHART_KEYS.productTop,
  CHART_KEYS.hospitalTop,
  CHART_KEYS.hospitalShare,
  CHART_KEYS.hospitalTrend,
]);
const DEFAULT_REPORT_TARGET_CHART_METRIC = "amount";
export const DEFAULT_REPORT_CHART_PALETTE_ID = "classic";
export const REPORT_CHART_PALETTES = [
  {
    id: "classic",
    label: "经典蓝绿",
    canvasBg: "#ffffff",
    axisTextColor: "#4b5563",
    axisLineColor: "#94a3b8",
    splitLineColor: "#e2e8f0",
    legendTextColor: "#334155",
    tooltipBg: "#ffffff",
    tooltipBorder: "#cbd5e1",
    tooltipTextColor: "#1f2937",
    series: {
      trend4: ["#2268b5", "#7baaf2", "#2f9e44", "#f59f00"],
      productMonthlyLines: [
        "#2268b5",
        "#2f9e44",
        "#7baaf2",
        "#f59f00",
        "#7c3aed",
        "#ec4899",
        "#14b8a6",
        "#f43f5e",
        "#84cc16",
        "#0ea5e9",
      ],
      productPie: ["#2268b5", "#2f9e44", "#7baaf2", "#f59f00", "#7c3aed", "#ec4899", "#14b8a6", "#f43f5e", "#84cc16", "#0ea5e9"],
      hospitalSharePie: ["#2268b5", "#2f9e44", "#7baaf2", "#f59f00", "#7c3aed", "#ec4899", "#14b8a6", "#f43f5e", "#84cc16", "#0ea5e9"],
      hospitalTopBar: ["#355e8f"],
      hospitalTrend2: ["#355e8f", "#f59f00"],
    },
  },
  {
    id: "ocean",
    label: "深海蓝",
    canvasBg: "#f8fbff",
    axisTextColor: "#3d4f63",
    axisLineColor: "#8aa3bf",
    splitLineColor: "#d9e6f3",
    legendTextColor: "#1f3f5b",
    tooltipBg: "#f8fbff",
    tooltipBorder: "#b7cbe0",
    tooltipTextColor: "#17324a",
    series: {
      trend4: ["#0f4c81", "#4f86c6", "#1f7a8c", "#f4a259"],
      productMonthlyLines: ["#0f4c81", "#1f7a8c", "#4f86c6", "#f4a259", "#2a9d8f", "#457b9d", "#006d77", "#83c5be", "#ff7f50", "#264653"],
      productPie: ["#0f4c81", "#4f86c6", "#1f7a8c", "#f4a259", "#2a9d8f", "#457b9d", "#006d77", "#83c5be", "#ff7f50", "#264653"],
      hospitalSharePie: ["#0f4c81", "#4f86c6", "#1f7a8c", "#f4a259", "#2a9d8f", "#457b9d", "#006d77", "#83c5be", "#ff7f50", "#264653"],
      hospitalTopBar: ["#0f4c81"],
      hospitalTrend2: ["#0f4c81", "#f4a259"],
    },
  },
  {
    id: "mint",
    label: "薄荷清新",
    canvasBg: "#f7fffb",
    axisTextColor: "#40585a",
    axisLineColor: "#8fb8b2",
    splitLineColor: "#d9efe9",
    legendTextColor: "#21514b",
    tooltipBg: "#f7fffb",
    tooltipBorder: "#b7ddd4",
    tooltipTextColor: "#173f3a",
    series: {
      trend4: ["#0f766e", "#5eead4", "#2e7d32", "#f59e0b"],
      productMonthlyLines: ["#0f766e", "#2e7d32", "#5eead4", "#f59e0b", "#0891b2", "#10b981", "#84cc16", "#14b8a6", "#f97316", "#0ea5e9"],
      productPie: ["#0f766e", "#5eead4", "#2e7d32", "#f59e0b", "#0891b2", "#10b981", "#84cc16", "#14b8a6", "#f97316", "#0ea5e9"],
      hospitalSharePie: ["#0f766e", "#5eead4", "#2e7d32", "#f59e0b", "#0891b2", "#10b981", "#84cc16", "#14b8a6", "#f97316", "#0ea5e9"],
      hospitalTopBar: ["#0f766e"],
      hospitalTrend2: ["#0f766e", "#f59e0b"],
    },
  },
  {
    id: "sunset",
    label: "日落暖调",
    canvasBg: "#fffaf6",
    axisTextColor: "#5d4b45",
    axisLineColor: "#c1a79a",
    splitLineColor: "#f0e0d5",
    legendTextColor: "#6b3f2e",
    tooltipBg: "#fffaf6",
    tooltipBorder: "#e3c9b9",
    tooltipTextColor: "#4a2d21",
    series: {
      trend4: ["#c2410c", "#fb923c", "#b45309", "#7c3aed"],
      productMonthlyLines: ["#c2410c", "#b45309", "#fb923c", "#7c3aed", "#ef4444", "#d97706", "#e11d48", "#f97316", "#a16207", "#9333ea"],
      productPie: ["#c2410c", "#fb923c", "#b45309", "#7c3aed", "#ef4444", "#d97706", "#e11d48", "#f97316", "#a16207", "#9333ea"],
      hospitalSharePie: ["#c2410c", "#fb923c", "#b45309", "#7c3aed", "#ef4444", "#d97706", "#e11d48", "#f97316", "#a16207", "#9333ea"],
      hospitalTopBar: ["#c2410c"],
      hospitalTrend2: ["#c2410c", "#7c3aed"],
    },
  },
  {
    id: "lavender",
    label: "薰衣草",
    canvasBg: "#faf9ff",
    axisTextColor: "#524d6b",
    axisLineColor: "#b6afd3",
    splitLineColor: "#e8e2f6",
    legendTextColor: "#4c3f74",
    tooltipBg: "#faf9ff",
    tooltipBorder: "#d3c9ec",
    tooltipTextColor: "#362b57",
    series: {
      trend4: ["#6d28d9", "#a78bfa", "#8b5cf6", "#f59e0b"],
      productMonthlyLines: ["#6d28d9", "#8b5cf6", "#a78bfa", "#f59e0b", "#ec4899", "#4f46e5", "#7c3aed", "#d946ef", "#f97316", "#0ea5e9"],
      productPie: ["#6d28d9", "#a78bfa", "#8b5cf6", "#f59e0b", "#ec4899", "#4f46e5", "#7c3aed", "#d946ef", "#f97316", "#0ea5e9"],
      hospitalSharePie: ["#6d28d9", "#a78bfa", "#8b5cf6", "#f59e0b", "#ec4899", "#4f46e5", "#7c3aed", "#d946ef", "#f97316", "#0ea5e9"],
      hospitalTopBar: ["#6d28d9"],
      hospitalTrend2: ["#6d28d9", "#f59e0b"],
    },
  },
  {
    id: "graphite",
    label: "石墨灰",
    canvasBg: "#f8f9fb",
    axisTextColor: "#4b5563",
    axisLineColor: "#9ca3af",
    splitLineColor: "#e5e7eb",
    legendTextColor: "#374151",
    tooltipBg: "#f8f9fb",
    tooltipBorder: "#d1d5db",
    tooltipTextColor: "#1f2937",
    series: {
      trend4: ["#374151", "#6b7280", "#2563eb", "#f59e0b"],
      productMonthlyLines: ["#374151", "#2563eb", "#6b7280", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#0ea5e9", "#84cc16", "#f97316"],
      productPie: ["#374151", "#6b7280", "#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#0ea5e9", "#84cc16", "#f97316"],
      hospitalSharePie: ["#374151", "#6b7280", "#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#0ea5e9", "#84cc16", "#f97316"],
      hospitalTopBar: ["#374151"],
      hospitalTrend2: ["#374151", "#f59e0b"],
    },
  },
  {
    id: "forest",
    label: "森林绿",
    canvasBg: "#f6fff8",
    axisTextColor: "#415148",
    axisLineColor: "#99b29f",
    splitLineColor: "#dceadf",
    legendTextColor: "#2b4d39",
    tooltipBg: "#f6fff8",
    tooltipBorder: "#bdd5c4",
    tooltipTextColor: "#1f3a2a",
    series: {
      trend4: ["#1b5e20", "#4caf50", "#2e7d32", "#f59f00"],
      productMonthlyLines: ["#1b5e20", "#2e7d32", "#4caf50", "#f59f00", "#0f766e", "#65a30d", "#15803d", "#22c55e", "#d97706", "#0ea5e9"],
      productPie: ["#1b5e20", "#4caf50", "#2e7d32", "#f59f00", "#0f766e", "#65a30d", "#15803d", "#22c55e", "#d97706", "#0ea5e9"],
      hospitalSharePie: ["#1b5e20", "#4caf50", "#2e7d32", "#f59f00", "#0f766e", "#65a30d", "#15803d", "#22c55e", "#d97706", "#0ea5e9"],
      hospitalTopBar: ["#1b5e20"],
      hospitalTrend2: ["#1b5e20", "#f59f00"],
    },
  },
  {
    id: "coral",
    label: "珊瑚橙",
    canvasBg: "#fff9f8",
    axisTextColor: "#5f4a46",
    axisLineColor: "#c5a7a0",
    splitLineColor: "#f1dfdc",
    legendTextColor: "#6d3f36",
    tooltipBg: "#fff9f8",
    tooltipBorder: "#e4c4be",
    tooltipTextColor: "#4a2b24",
    series: {
      trend4: ["#e76f51", "#f4a261", "#2a9d8f", "#7c3aed"],
      productMonthlyLines: ["#e76f51", "#2a9d8f", "#f4a261", "#7c3aed", "#ef4444", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#6366f1"],
      productPie: ["#e76f51", "#f4a261", "#2a9d8f", "#7c3aed", "#ef4444", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#6366f1"],
      hospitalSharePie: ["#e76f51", "#f4a261", "#2a9d8f", "#7c3aed", "#ef4444", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#6366f1"],
      hospitalTopBar: ["#e76f51"],
      hospitalTrend2: ["#e76f51", "#7c3aed"],
    },
  },
  {
    id: "amber",
    label: "琥珀金",
    canvasBg: "#fffdf7",
    axisTextColor: "#5c5441",
    axisLineColor: "#c2b79b",
    splitLineColor: "#efe7d2",
    legendTextColor: "#6a5b2a",
    tooltipBg: "#fffdf7",
    tooltipBorder: "#dfd2ad",
    tooltipTextColor: "#473d1e",
    series: {
      trend4: ["#b45309", "#f59e0b", "#7c2d12", "#2563eb"],
      productMonthlyLines: ["#b45309", "#f59e0b", "#7c2d12", "#2563eb", "#92400e", "#d97706", "#1d4ed8", "#f97316", "#84cc16", "#14b8a6"],
      productPie: ["#b45309", "#f59e0b", "#7c2d12", "#2563eb", "#92400e", "#d97706", "#1d4ed8", "#f97316", "#84cc16", "#14b8a6"],
      hospitalSharePie: ["#b45309", "#f59e0b", "#7c2d12", "#2563eb", "#92400e", "#d97706", "#1d4ed8", "#f97316", "#84cc16", "#14b8a6"],
      hospitalTopBar: ["#b45309"],
      hospitalTrend2: ["#b45309", "#2563eb"],
    },
  },
  {
    id: "mono",
    label: "黑白灰",
    canvasBg: "#fcfcfd",
    axisTextColor: "#4b5563",
    axisLineColor: "#9ca3af",
    splitLineColor: "#e5e7eb",
    legendTextColor: "#374151",
    tooltipBg: "#ffffff",
    tooltipBorder: "#d1d5db",
    tooltipTextColor: "#111827",
    series: {
      trend4: ["#111827", "#374151", "#6b7280", "#9ca3af"],
      productMonthlyLines: ["#111827", "#1f2937", "#374151", "#4b5563", "#6b7280", "#9ca3af", "#111827", "#374151", "#6b7280", "#9ca3af"],
      productPie: ["#111827", "#1f2937", "#374151", "#4b5563", "#6b7280", "#9ca3af", "#111827", "#374151", "#6b7280", "#9ca3af"],
      hospitalSharePie: ["#111827", "#1f2937", "#374151", "#4b5563", "#6b7280", "#9ca3af", "#111827", "#374151", "#6b7280", "#9ca3af"],
      hospitalTopBar: ["#1f2937"],
      hospitalTrend2: ["#1f2937", "#6b7280"],
    },
  },
];

const reportChartInstances = new Map();
let isChartEventsBound = false;
let isChartResizeBound = false;
let latestChartRange = null;
let latestChartPointCounts = null;

function normalizeReportTargetChartMetric(raw) {
  return String(raw || "").trim().toLowerCase() === "quantity" ? "quantity" : "amount";
}

function ensureReportTargetChartMetricsState(state) {
  if (!state || typeof state !== "object") {
    return {};
  }
  if (!state.reportTargetChartMetrics || typeof state.reportTargetChartMetrics !== "object") {
    state.reportTargetChartMetrics = {};
  }
  TARGET_CHART_KEYS.forEach((chartKey) => {
    state.reportTargetChartMetrics[chartKey] = normalizeReportTargetChartMetric(
      state.reportTargetChartMetrics[chartKey] || DEFAULT_REPORT_TARGET_CHART_METRIC,
    );
  });
  return state.reportTargetChartMetrics;
}

function getReportTargetChartMetric(state, chartKey) {
  const metrics = ensureReportTargetChartMetricsState(state);
  const safeChartKey = String(chartKey || "").trim();
  if (!TARGET_CHART_KEYS.includes(safeChartKey)) {
    return DEFAULT_REPORT_TARGET_CHART_METRIC;
  }
  return metrics[safeChartKey] || DEFAULT_REPORT_TARGET_CHART_METRIC;
}

function setReportTargetChartMetric(state, chartKey, metric) {
  const metrics = ensureReportTargetChartMetricsState(state);
  const safeChartKey = String(chartKey || "").trim();
  if (!TARGET_CHART_KEYS.includes(safeChartKey)) {
    return;
  }
  metrics[safeChartKey] = normalizeReportTargetChartMetric(metric);
}

function getReportTargetChartMetricButtons(chartKey) {
  if (typeof document === "undefined") {
    return [];
  }
  return Array.from(
    document.querySelectorAll(`[data-report-chart-metric-btn="true"][data-chart-key="${String(chartKey || "").trim()}"]`),
  );
}

function renderReportTargetChartMetricButtons(state) {
  TARGET_CHART_KEYS.forEach((chartKey) => {
    const activeMetric = getReportTargetChartMetric(state, chartKey);
    getReportTargetChartMetricButtons(chartKey).forEach((button) => {
      const buttonMetric = normalizeReportTargetChartMetric(button.getAttribute("data-chart-metric"));
      const isActive = buttonMetric === activeMetric;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  });
}

function bindReportTargetChartMetricButtons(state, dom, deps) {
  TARGET_CHART_KEYS.forEach((chartKey) => {
    getReportTargetChartMetricButtons(chartKey).forEach((button) => {
      if (button.dataset.metricBound === "true") {
        return;
      }
      button.dataset.metricBound = "true";
      button.addEventListener("click", () => {
        const nextMetric = normalizeReportTargetChartMetric(button.getAttribute("data-chart-metric"));
        if (getReportTargetChartMetric(state, chartKey) === nextMetric) {
          return;
        }
        setReportTargetChartMetric(state, chartKey, nextMetric);
        renderReportTargetChartMetricButtons(state);
        renderReportSection(state, dom, deps);
      });
    });
  });
}

function normalizeReportChartPaletteId(raw) {
  const value = String(raw || "").trim();
  if (REPORT_CHART_PALETTES.some((palette) => palette.id === value)) {
    return value;
  }
  return DEFAULT_REPORT_CHART_PALETTE_ID;
}

function getReportChartPaletteById(id) {
  const normalizedId = normalizeReportChartPaletteId(id);
  return REPORT_CHART_PALETTES.find((palette) => palette.id === normalizedId) || REPORT_CHART_PALETTES[0];
}

function getActiveReportChartPalette(state) {
  const paletteId = normalizeReportChartPaletteId(state.reportChartPaletteId);
  state.reportChartPaletteId = paletteId;
  return getReportChartPaletteById(paletteId);
}

function renderReportChartPaletteSelect(state, dom) {
  if (!(dom.reportChartPaletteSelect instanceof HTMLSelectElement)) return;

  const paletteId = normalizeReportChartPaletteId(state.reportChartPaletteId);
  state.reportChartPaletteId = paletteId;

  const expectedOptions = REPORT_CHART_PALETTES.length;
  if (dom.reportChartPaletteSelect.options.length !== expectedOptions) {
    dom.reportChartPaletteSelect.innerHTML = REPORT_CHART_PALETTES.map(
      (palette) => `<option value="${palette.id}">${palette.label}</option>`,
    ).join("");
  }

  dom.reportChartPaletteSelect.value = paletteId;
}

function normalizeReportChartDataLabelMode(raw) {
  const value = String(raw || "").trim();
  if (REPORT_CHART_DATA_LABEL_MODES.some((mode) => mode.id === value)) {
    return value;
  }
  return DEFAULT_REPORT_CHART_DATA_LABEL_MODE;
}

function renderReportChartDataLabelModeSelect(state, dom) {
  if (!(dom.reportChartDataLabelModeSelect instanceof HTMLSelectElement)) return;
  const mode = normalizeReportChartDataLabelMode(state.reportChartDataLabelMode);
  state.reportChartDataLabelMode = mode;

  if (dom.reportChartDataLabelModeSelect.options.length !== REPORT_CHART_DATA_LABEL_MODES.length) {
    dom.reportChartDataLabelModeSelect.innerHTML = REPORT_CHART_DATA_LABEL_MODES.map(
      (item) => `<option value="${item.id}">${item.label}</option>`,
    ).join("");
  }

  dom.reportChartDataLabelModeSelect.value = mode;
}

function normalizeReportAmountUnitId(raw) {
  const value = String(raw || "").trim();
  if (REPORT_AMOUNT_UNITS.some((unit) => unit.id === value)) return value;
  return DEFAULT_REPORT_AMOUNT_UNIT_ID;
}

function getReportAmountUnitById(id) {
  const normalizedId = normalizeReportAmountUnitId(id);
  return REPORT_AMOUNT_UNITS.find((unit) => unit.id === normalizedId) || REPORT_AMOUNT_UNITS[0];
}

function getActiveReportAmountUnit(state) {
  const unitId = normalizeReportAmountUnitId(state.reportAmountUnitId);
  state.reportAmountUnitId = unitId;
  return getReportAmountUnitById(unitId);
}

function renderReportAmountUnitSelect(state, dom) {
  if (!(dom.reportAmountUnitSelect instanceof HTMLSelectElement)) return;

  const unitId = normalizeReportAmountUnitId(state.reportAmountUnitId);
  state.reportAmountUnitId = unitId;

  if (dom.reportAmountUnitSelect.options.length !== REPORT_AMOUNT_UNITS.length) {
    dom.reportAmountUnitSelect.innerHTML = REPORT_AMOUNT_UNITS.map(
      (unit) => `<option value="${unit.id}">${unit.label}</option>`,
    ).join("");
  }

  dom.reportAmountUnitSelect.value = unitId;
}

function scaleAmount(value, unit) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const divisor = Number(unit && unit.divisor);
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  return num / divisor;
}

function formatScaledMoney(value, deps, unit) {
  const scaled = scaleAmount(value, unit);
  if (!Number.isFinite(scaled)) return "--";
  return deps.formatMoney(deps.roundMoney(scaled));
}

function formatMoneyDisplay(value, deps) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return deps.formatMoney(deps.roundMoney(num));
}

function buildChartDataLabelStyle(palette, labelMode, position = "top") {
  const isEmphasis = labelMode === "emphasis";
  return {
    show: true,
    position,
    fontSize: isEmphasis ? 11 : 10,
    fontWeight: isEmphasis ? 600 : 500,
    color: "#ffffff",
    textBorderColor: isEmphasis ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.85)",
    textBorderWidth: isEmphasis ? 1 : 2,
    backgroundColor: isEmphasis ? "rgba(0,0,0,0.38)" : "transparent",
    borderRadius: isEmphasis ? 4 : 0,
    padding: isEmphasis ? [2, 4] : 0,
  };
}

function buildChartDataLabelLayout(labelMode) {
  if (labelMode === "none") return undefined;
  return {
    hideOverlap: false,
  };
}

function formatPercentForLabel(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${num.toFixed(2)}%`;
}

function formatMoneyForLabel(value, deps) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return formatMoneyDisplay(num, deps);
}

function formatPercentLabelValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return formatPercentForLabel(num);
}

function buildThemedTooltipBase(palette) {
  return {
    backgroundColor: palette.tooltipBg,
    borderColor: palette.tooltipBorder,
    textStyle: {
      color: palette.tooltipTextColor,
    },
  };
}

function getChartCanvasBackground() {
  return CHART_CANVAS_BG;
}

function buildAxisLineTheme(palette) {
  return {
    lineStyle: {
      color: palette.axisLineColor,
    },
  };
}

function buildSplitLineTheme(palette) {
  return {
    lineStyle: {
      color: palette.splitLineColor,
    },
  };
}

export function getDefaultReportRange() {
  return {
    startYm: "",
    endYm: "",
  };
}

export function buildYmFromParts(yearValue, monthValue) {
  const year = String(yearValue || "").trim();
  const month = String(monthValue || "").trim();
  if (!/^\d{4}$/.test(year)) return "";
  if (!/^\d{1,2}$/.test(month)) return "";
  return normalizeYm(`${year}-${month.padStart(2, "0")}`);
}

export function parseReportYmParts(ym) {
  const normalized = normalizeYm(ym);
  if (!normalized) {
    return { year: "", month: "" };
  }
  const matched = normalized.match(MONTH_RE);
  if (!matched) {
    return { year: "", month: "" };
  }
  return {
    year: matched[1],
    month: matched[2],
  };
}

export function getReportRangeControlYears(startYm, endYm, options = {}) {
  const now = new Date();
  const currentYear =
    Number.isInteger(options.currentYear) && options.currentYear > 0 ? options.currentYear : now.getFullYear();
  const paddingPastYears = Number.isInteger(options.paddingPastYears) ? Math.max(options.paddingPastYears, 0) : 5;
  const paddingFutureYears =
    Number.isInteger(options.paddingFutureYears) ? Math.max(options.paddingFutureYears, 0) : 1;
  const selectedYears = [parseYm(startYm)?.year, parseYm(endYm)?.year].filter(Number.isInteger);
  const minYear = Math.min(currentYear - paddingPastYears, ...selectedYears);
  const maxYear = Math.max(currentYear + paddingFutureYears, ...selectedYears);
  const years = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    years.push(String(year));
  }
  return years;
}

export function normalizeReportRange(state, dom, deps) {
  const defaults = getDefaultReportRange();

  const startInput = dom.reportStartMonthInput instanceof HTMLInputElement ? dom.reportStartMonthInput : null;
  const endInput = dom.reportEndMonthInput instanceof HTMLInputElement ? dom.reportEndMonthInput : null;

  let startYm = normalizeYm(state.reportStartYm) || normalizeYm(startInput ? startInput.value : "") || defaults.startYm;
  let endYm = normalizeYm(state.reportEndYm) || normalizeYm(endInput ? endInput.value : "") || defaults.endYm;

  if (!startYm || !endYm) {
    state.reportStartYm = startYm;
    state.reportEndYm = endYm;
    state.reportRangeError = "请选择起始月和结束月";

    if (startInput) startInput.value = startYm;
    if (endInput) endInput.value = endYm;

    return {
      startYm,
      endYm,
      error: state.reportRangeError,
    };
  }

  if (compareYm(startYm, endYm) > 0) {
    state.reportStartYm = startYm;
    state.reportEndYm = endYm;
    state.reportRangeError = "起始月不能晚于结束月";

    if (startInput) startInput.value = startYm;
    if (endInput) endInput.value = endYm;

    return {
      startYm,
      endYm,
      error: state.reportRangeError,
    };
  }

  state.reportRangeError = "";
  state.reportStartYm = startYm;
  state.reportEndYm = endYm;

  if (startInput) startInput.value = startYm;
  if (endInput) endInput.value = endYm;
  // 仅在起止月双端有效且顺序合法时持久化，避免单端输入覆盖历史有效区间。
  if (typeof deps.saveReportRange === "function") {
    deps.saveReportRange({ startYm, endYm });
  }

  return {
    startYm,
    endYm,
    error: "",
  };
}

export function buildReportSnapshot(state, deps, range) {
  return buildReportSnapshotCore(state, deps, range);
}

export function renderReportSection(state, dom, deps) {
  const emitSummary = (summary) => {
    if (typeof deps.onReportSummaryChange === "function") {
      deps.onReportSummaryChange(summary);
    }
    return summary;
  };

  if (!(dom.reportHintEl instanceof HTMLElement)) return emitSummary({ snapshot: null, range: null, reason: "missing-dom" });
  if (!(dom.reportMonthBody instanceof HTMLElement)) return emitSummary({ snapshot: null, range: null, reason: "missing-dom" });
  if (!(dom.reportQuarterBody instanceof HTMLElement)) return emitSummary({ snapshot: null, range: null, reason: "missing-dom" });
  if (!(dom.reportProductBody instanceof HTMLElement)) return emitSummary({ snapshot: null, range: null, reason: "missing-dom" });
  if (!(dom.reportHospitalBody instanceof HTMLElement)) return emitSummary({ snapshot: null, range: null, reason: "missing-dom" });
  if (!(dom.reportEmptyEl instanceof HTMLElement)) return emitSummary({ snapshot: null, range: null, reason: "missing-dom" });
  renderReportChartPaletteSelect(state, dom);
  renderReportChartDataLabelModeSelect(state, dom);
  renderReportAmountUnitSelect(state, dom);
  renderReportTargetChartMetricButtons(state);
  const activeAmountUnit = getActiveReportAmountUnit(state);

  try {
    const range = normalizeReportRange(state, dom, deps);

    if (range.error) {
      dom.reportHintEl.textContent = range.error;
      dom.reportHintEl.classList.add("report-hint-error");

      dom.reportEmptyEl.hidden = false;
      dom.reportEmptyEl.textContent = "暂无可分析数据";
      renderEmptyRows(dom);
      setChartsUnavailableState(dom, range.error || CHART_EMPTY_TEXT);
      return emitSummary({ snapshot: null, range, reason: "invalid-range" });
    }

    const snapshot = buildReportSnapshot(state, deps, range);
    if (!snapshot.hasRangeRecords) {
      dom.reportHintEl.textContent = `报表由销售记录自动生成，当前范围暂无销售数据。金额单位：${activeAmountUnit.label}。`;
      dom.reportHintEl.classList.remove("report-hint-error");

      dom.reportEmptyEl.hidden = false;
      dom.reportEmptyEl.textContent = "暂无可分析数据";
      renderEmptyRows(dom);
      setChartsUnavailableState(dom, CHART_EMPTY_TEXT);
      return emitSummary({ snapshot, range, reason: "no-records" });
    }

    dom.reportEmptyEl.hidden = true;
    dom.reportHintEl.classList.remove("report-hint-error");

    if (snapshot.hasTargetGap) {
      const gapLabel = buildTargetGapLabel(snapshot);
      dom.reportHintEl.textContent = `所涉年份存在未生效指标，月/季度达成率按缺省展示；产品指标按分配展示（${gapLabel || "请补录指标"}）。金额单位：${activeAmountUnit.label}。`;
    } else {
      dom.reportHintEl.textContent = `报表由销售记录自动生成，金额单位：${activeAmountUnit.label}。`;
    }

    dom.reportMonthBody.innerHTML = snapshot.monthRows
      .map(
        (row) => `
      <tr>
        <td>${deps.escapeHtml(formatMonthLabel(row.ym))}</td>
        <td>${deps.escapeHtml(formatMoneyCell(row.targetAmount, deps, activeAmountUnit))}</td>
        <td>${deps.escapeHtml(formatMoneyCell(row.amount, deps, activeAmountUnit))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountAchievement))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountYoy))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountMom))}</td>
        <td>${deps.escapeHtml(formatQuantityCell(row.targetQuantity, deps))}</td>
        <td>${deps.escapeHtml(formatQuantityCell(row.quantity, deps))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityAchievement))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityYoy))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityMom))}</td>
      </tr>
    `,
      )
      .join("");

    dom.reportQuarterBody.innerHTML = snapshot.quarterRows.length
      ? snapshot.quarterRows
          .map(
            (row) => `
      <tr>
        <td>${deps.escapeHtml(row.label)}</td>
        <td>${deps.escapeHtml(formatMoneyCell(row.targetAmount, deps, activeAmountUnit))}</td>
        <td>${deps.escapeHtml(formatMoneyCell(row.amount, deps, activeAmountUnit))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountAchievement))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountYoy))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountQoq))}</td>
        <td>${deps.escapeHtml(formatQuantityCell(row.targetQuantity, deps))}</td>
        <td>${deps.escapeHtml(formatQuantityCell(row.quantity, deps))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityAchievement))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityYoy))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityQoq))}</td>
      </tr>
    `,
          )
          .join("")
      : `
      <tr>
        <td colspan="11" class="empty">当前范围不包含完整季度</td>
      </tr>
    `;

    dom.reportProductBody.innerHTML = snapshot.productRows.length
      ? snapshot.productRows
          .map(
            (row) => `
      <tr>
        <td>${deps.escapeHtml(row.productName)}</td>
        <td>${deps.escapeHtml(formatMoneyCell(row.amount, deps, activeAmountUnit))}</td>
        <td>${deps.escapeHtml(formatMoneyCell(row.targetAmount, deps, activeAmountUnit))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountAchievement))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountShare))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountYoy))}</td>
        <td>${deps.escapeHtml(formatQuantityCell(row.quantity, deps))}</td>
        <td>${deps.escapeHtml(formatQuantityCell(row.targetQuantity, deps))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityAchievement))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityShare))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityYoy))}</td>
      </tr>
    `,
          )
          .join("")
      : `
      <tr>
        <td colspan="11" class="empty">当前范围无产品销售数据</td>
      </tr>
    `;

    dom.reportHospitalBody.innerHTML = snapshot.hospitalRows.length
      ? snapshot.hospitalRows
          .map(
            (row) => `
      <tr>
        <td>${deps.escapeHtml(row.hospitalName)}</td>
        <td>${deps.escapeHtml(formatMoneyCell(row.amount, deps, activeAmountUnit))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountShare))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.amountYoy))}</td>
        <td>${deps.escapeHtml(formatQuantityCell(row.quantity, deps))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityShare))}</td>
        <td>${deps.escapeHtml(formatPercentCell(row.quantityYoy))}</td>
      </tr>
    `,
          )
          .join("")
      : `
      <tr>
        <td colspan="7" class="empty">当前范围无医院销售数据</td>
      </tr>
    `;

    renderReportCharts(state, dom, deps, snapshot, range, activeAmountUnit);
    return emitSummary({ snapshot, range, reason: "" });
  } catch (error) {
    console.error("[Sales Tool] 报表渲染失败，已降级为空态。", error);
    dom.reportHintEl.textContent = "报表计算异常，请刷新页面后重试。";
    dom.reportHintEl.classList.add("report-hint-error");
    dom.reportEmptyEl.hidden = false;
    dom.reportEmptyEl.textContent = "暂无可分析数据";
    renderEmptyRows(dom);
    setChartsUnavailableState(dom, "图表计算异常，请刷新页面后重试。");
    return emitSummary({
      snapshot: null,
      range: {
        startYm: String(state.reportStartYm || "").trim(),
        endYm: String(state.reportEndYm || "").trim(),
        error: "",
      },
      reason: "render-error",
    });
  }
}

export function bindReportEvents(state, dom, deps) {
  bindReportTableExportEvents(state, dom, deps);
  bindChartExportEvents(state, dom, deps);
  renderReportChartPaletteSelect(state, dom);
  renderReportChartDataLabelModeSelect(state, dom);
  renderReportAmountUnitSelect(state, dom);
  renderReportTargetChartMetricButtons(state);
  bindReportTargetChartMetricButtons(state, dom, deps);

  if (dom.reportChartPaletteSelect instanceof HTMLSelectElement) {
    dom.reportChartPaletteSelect.addEventListener("change", () => {
      const nextPaletteId = normalizeReportChartPaletteId(dom.reportChartPaletteSelect.value);
      state.reportChartPaletteId = nextPaletteId;
      if (typeof deps.saveReportChartPalette === "function") {
        deps.saveReportChartPalette(nextPaletteId);
      }
      renderReportSection(state, dom, deps);
    });
  }

  if (dom.reportAmountUnitSelect instanceof HTMLSelectElement) {
    dom.reportAmountUnitSelect.addEventListener("change", () => {
      const nextUnitId = normalizeReportAmountUnitId(dom.reportAmountUnitSelect.value);
      state.reportAmountUnitId = nextUnitId;
      if (typeof deps.saveReportAmountUnit === "function") {
        deps.saveReportAmountUnit(nextUnitId);
      }
      renderReportSection(state, dom, deps);
    });
  }

  if (dom.reportChartDataLabelModeSelect instanceof HTMLSelectElement) {
    dom.reportChartDataLabelModeSelect.addEventListener("change", () => {
      const mode = normalizeReportChartDataLabelMode(dom.reportChartDataLabelModeSelect.value);
      state.reportChartDataLabelMode = mode;
      if (typeof deps.saveReportChartDataLabelMode === "function") {
        deps.saveReportChartDataLabelMode(mode);
      }
      renderReportSection(state, dom, deps);
    });
  }

  if (dom.hospitalTrendSelect instanceof HTMLSelectElement) {
    dom.hospitalTrendSelect.addEventListener("change", () => {
      state.activeHospitalChartKey = String(dom.hospitalTrendSelect.value || "").trim();
      renderReportSection(state, dom, deps);
    });
  }

  if (dom.reportStartMonthInput instanceof HTMLInputElement) {
    const rerender = () => {
      state.reportStartYm = String(dom.reportStartMonthInput.value || "").trim();
      renderReportSection(state, dom, deps);
    };

    dom.reportStartMonthInput.addEventListener("input", rerender);
    dom.reportStartMonthInput.addEventListener("change", rerender);
  }

  if (
    dom.reportStartYearSelect instanceof HTMLSelectElement &&
    dom.reportStartMonthSelect instanceof HTMLSelectElement &&
    dom.reportStartMonthInput instanceof HTMLInputElement
  ) {
    const rerender = () => {
      const nextYm = buildYmFromParts(dom.reportStartYearSelect.value, dom.reportStartMonthSelect.value);
      dom.reportStartMonthInput.value = nextYm;
      state.reportStartYm = nextYm;
      renderReportSection(state, dom, deps);
    };

    dom.reportStartYearSelect.addEventListener("change", rerender);
    dom.reportStartMonthSelect.addEventListener("change", rerender);
  }

  if (dom.reportEndMonthInput instanceof HTMLInputElement) {
    const rerender = () => {
      state.reportEndYm = String(dom.reportEndMonthInput.value || "").trim();
      renderReportSection(state, dom, deps);
    };

    dom.reportEndMonthInput.addEventListener("input", rerender);
    dom.reportEndMonthInput.addEventListener("change", rerender);
  }

  if (
    dom.reportEndYearSelect instanceof HTMLSelectElement &&
    dom.reportEndMonthSelect instanceof HTMLSelectElement &&
    dom.reportEndMonthInput instanceof HTMLInputElement
  ) {
    const rerender = () => {
      const nextYm = buildYmFromParts(dom.reportEndYearSelect.value, dom.reportEndMonthSelect.value);
      dom.reportEndMonthInput.value = nextYm;
      state.reportEndYm = nextYm;
      renderReportSection(state, dom, deps);
    };

    dom.reportEndYearSelect.addEventListener("change", rerender);
    dom.reportEndMonthSelect.addEventListener("change", rerender);
  }

  if (dom.reportChartsDetails instanceof HTMLDetailsElement) {
    dom.reportChartsDetails.addEventListener("toggle", () => {
      if (dom.reportChartsDetails.open) {
        setTimeout(() => {
          resizeReportCharts();
        }, 0);
      }
    });
  }
}

function bindReportTableExportEvents(state, dom, deps) {
  if (!(dom.exportReportTablesBtn instanceof HTMLButtonElement)) return;

  dom.exportReportTablesBtn.addEventListener("click", () => {
    downloadReportTablesXlsx(state, dom, deps);
  });
}

function downloadReportTablesXlsx(state, dom, deps) {
  if (!isXlsxReadyForReportExport()) {
    showReportExportHint(dom, "导出组件未加载，请刷新后重试。", true);
    return;
  }

  const range = normalizeReportRange(state, dom, deps);
  if (range.error) {
    showReportExportHint(dom, `${range.error}。`, true);
    return;
  }

  try {
    const snapshot = buildReportSnapshot(state, deps, range);
    if (!snapshot.hasRangeRecords) {
      showReportExportHint(dom, "当前范围暂无可导出数据。", true);
      return;
    }

    const workbook = XLSX.utils.book_new();
    const activeAmountUnit = getActiveReportAmountUnit(state);
    const sheets = buildReportExportSheets(snapshot, deps, activeAmountUnit);

    for (const sheet of sheets) {
      const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
    }

    const safeStart = sanitizeFilePart(range.startYm || "start");
    const safeEnd = sanitizeFilePart(range.endYm || "end");
    const fileName = `sales-analysis-${safeStart}_to_${safeEnd}.xlsx`;

    XLSX.writeFile(workbook, fileName);
    showReportExportHint(dom, `导出成功：${fileName}`, false);
  } catch (error) {
    console.error("[Sales Tool] 销售分析导出失败。", error);
    showReportExportHint(dom, "导出失败，请稍后重试。", true);
  }
}

function buildReportExportSheets(snapshot, deps, activeAmountUnit = getReportAmountUnitById(DEFAULT_REPORT_AMOUNT_UNIT_ID)) {
  const moneyHeader = (text) => `${text}（${activeAmountUnit.label}）`;

  const monthRows = [
    ["月份", moneyHeader("指标金额"), moneyHeader("实际金额"), "金额达成率", "金额同比", "金额环比", "指标数量", "实际数量", "数量达成率", "数量同比", "数量环比"],
    ...snapshot.monthRows.map((row) => [
      formatMonthLabel(row.ym),
      toExportCell(row.targetAmount, "money", deps, activeAmountUnit),
      toExportCell(row.amount, "money", deps, activeAmountUnit),
      toExportCell(row.amountAchievement, "percent", deps),
      toExportCell(row.amountYoy, "percent", deps),
      toExportCell(row.amountMom, "percent", deps),
      toExportCell(row.targetQuantity, "quantity", deps),
      toExportCell(row.quantity, "quantity", deps),
      toExportCell(row.quantityAchievement, "percent", deps),
      toExportCell(row.quantityYoy, "percent", deps),
      toExportCell(row.quantityMom, "percent", deps),
    ]),
  ];

  const quarterRows = [
    ["季度", moneyHeader("指标金额"), moneyHeader("实际金额"), "金额达成率", "金额同比", "金额环比", "指标数量", "实际数量", "数量达成率", "数量同比", "数量环比"],
    ...snapshot.quarterRows.map((row) => [
      row.label,
      toExportCell(row.targetAmount, "money", deps, activeAmountUnit),
      toExportCell(row.amount, "money", deps, activeAmountUnit),
      toExportCell(row.amountAchievement, "percent", deps),
      toExportCell(row.amountYoy, "percent", deps),
      toExportCell(row.amountQoq, "percent", deps),
      toExportCell(row.targetQuantity, "quantity", deps),
      toExportCell(row.quantity, "quantity", deps),
      toExportCell(row.quantityAchievement, "percent", deps),
      toExportCell(row.quantityYoy, "percent", deps),
      toExportCell(row.quantityQoq, "percent", deps),
    ]),
  ];

  const productRows = [
    ["产品/规格", moneyHeader("实际金额"), moneyHeader("指标金额"), "金额达成率", "金额占比", "金额同比", "实际数量", "指标数量", "数量达成率", "数量占比", "数量同比"],
    ...snapshot.productRows.map((row) => [
      toExportCell(row.productName, "text", deps),
      toExportCell(row.amount, "money", deps, activeAmountUnit),
      toExportCell(row.targetAmount, "money", deps, activeAmountUnit),
      toExportCell(row.amountAchievement, "percent", deps),
      toExportCell(row.amountShare, "percent", deps),
      toExportCell(row.amountYoy, "percent", deps),
      toExportCell(row.quantity, "quantity", deps),
      toExportCell(row.targetQuantity, "quantity", deps),
      toExportCell(row.quantityAchievement, "percent", deps),
      toExportCell(row.quantityShare, "percent", deps),
      toExportCell(row.quantityYoy, "percent", deps),
    ]),
  ];

  const hospitalRows = [
    ["医院", moneyHeader("销售金额"), "金额占比", "金额同比", "采购数量", "数量占比", "数量同比"],
    ...snapshot.hospitalRows.map((row) => [
      toExportCell(row.hospitalName, "text", deps),
      toExportCell(row.amount, "money", deps, activeAmountUnit),
      toExportCell(row.amountShare, "percent", deps),
      toExportCell(row.amountYoy, "percent", deps),
      toExportCell(row.quantity, "quantity", deps),
      toExportCell(row.quantityShare, "percent", deps),
      toExportCell(row.quantityYoy, "percent", deps),
    ]),
  ];

  return [
    { name: "总览-按月", rows: monthRows },
    { name: "总览-按季度", rows: quarterRows },
    { name: "产品分析", rows: productRows },
    { name: "医院分析", rows: hospitalRows },
  ];
}

function toExportCell(value, type, deps, amountUnit = null) {
  if (type === "text") {
    const text = String(value || "").trim();
    return text || "--";
  }

  if (type === "percent") {
    return formatPercentCell(value);
  }

  if (type === "money" || type === "quantity") {
    if (!Number.isFinite(value)) return "--";
    if (type === "money") {
      return formatScaledMoney(value, deps, amountUnit || getReportAmountUnitById(DEFAULT_REPORT_AMOUNT_UNIT_ID));
    }
    return deps.formatMoney(deps.roundMoney(Number(value)));
  }

  return value ?? "--";
}

function showReportExportHint(dom, message, isError) {
  if (!(dom.reportHintEl instanceof HTMLElement)) return;

  dom.reportHintEl.textContent = String(message || "").trim();
  dom.reportHintEl.classList.toggle("report-hint-error", Boolean(isError));
}

function isXlsxReadyForReportExport() {
  return typeof XLSX !== "undefined" && XLSX && XLSX.utils && typeof XLSX.utils.book_new === "function";
}

function isExcelJsReadyForChartExport() {
  return typeof ExcelJS !== "undefined" && ExcelJS && typeof ExcelJS.Workbook === "function";
}

function renderReportCharts(state, dom, deps, snapshot, range, amountUnit) {
  latestChartRange = {
    startYm: range.startYm,
    endYm: range.endYm,
  };
  const palette = {
    ...getActiveReportChartPalette(state),
    canvasBg: getChartCanvasBackground(),
  };
  const activeAmountUnit = amountUnit || getActiveReportAmountUnit(state);
  const labelMode = normalizeReportChartDataLabelMode(state.reportChartDataLabelMode);
  state.reportChartDataLabelMode = labelMode;
  renderReportTargetChartMetricButtons(state);

  if (!isEchartsReady()) {
    setChartsUnavailableState(dom, "图表组件未加载，仅显示数据表。");
    return;
  }

  if (!snapshot || !snapshot.hasRangeRecords) {
    setChartsUnavailableState(dom, CHART_EMPTY_TEXT);
    return;
  }

  try {
    renderHospitalTrendSelect(
      state,
      dom,
      snapshot,
      deps,
      activeAmountUnit,
      getReportTargetChartMetric(state, CHART_KEYS.hospitalTrend),
    );
    const pointCounts = buildChartPointCounts(snapshot, state);
    latestChartPointCounts = pointCounts;
    applyChartCompactLayout(dom, pointCounts);

    const monthlyTrendChart = ensureChartInstance(CHART_KEYS.monthlyTrend, dom.chartMonthlyTrendEl);
    const quarterlyTrendChart = ensureChartInstance(CHART_KEYS.quarterlyTrend, dom.chartQuarterlyTrendEl);
    const productPerformanceChart = ensureChartInstance(CHART_KEYS.productPerformance, dom.chartProductPerformanceEl);
    const productMonthlyTrendChart = ensureChartInstance(CHART_KEYS.productMonthlyTrend, dom.chartProductMonthlyTrendEl);
    const productTopChart = ensureChartInstance(CHART_KEYS.productTop, dom.chartProductTopEl);
    const hospitalTopChart = ensureChartInstance(CHART_KEYS.hospitalTop, dom.chartHospitalTopEl);
    const hospitalShareChart = ensureChartInstance(CHART_KEYS.hospitalShare, dom.chartHospitalShareEl);
    const hospitalTrendChart = ensureChartInstance(CHART_KEYS.hospitalTrend, dom.chartHospitalTrendEl);

    updateMonthlyTrendChart(
      monthlyTrendChart,
      snapshot,
      deps,
      palette,
      activeAmountUnit,
      labelMode,
      getReportTargetChartMetric(state, CHART_KEYS.monthlyTrend),
    );
    updateQuarterlyTrendChart(
      quarterlyTrendChart,
      snapshot,
      deps,
      palette,
      activeAmountUnit,
      labelMode,
      getReportTargetChartMetric(state, CHART_KEYS.quarterlyTrend),
    );
    updateProductPerformanceChart(
      productPerformanceChart,
      snapshot,
      deps,
      palette,
      activeAmountUnit,
      labelMode,
      getReportTargetChartMetric(state, CHART_KEYS.productPerformance),
    );
    updateProductMonthlyTrendChart(
      productMonthlyTrendChart,
      snapshot,
      deps,
      palette,
      activeAmountUnit,
      labelMode,
      getReportTargetChartMetric(state, CHART_KEYS.productMonthlyTrend),
    );
    updateProductTopChart(
      productTopChart,
      snapshot,
      deps,
      palette,
      activeAmountUnit,
      labelMode,
      getReportTargetChartMetric(state, CHART_KEYS.productTop),
    );
    updateHospitalTopChart(
      hospitalTopChart,
      snapshot,
      deps,
      palette,
      activeAmountUnit,
      labelMode,
      getReportTargetChartMetric(state, CHART_KEYS.hospitalTop),
    );
    updateHospitalShareChart(
      hospitalShareChart,
      snapshot,
      deps,
      palette,
      activeAmountUnit,
      labelMode,
      getReportTargetChartMetric(state, CHART_KEYS.hospitalShare),
    );
    updateHospitalTrendChart(
      hospitalTrendChart,
      snapshot,
      state,
      deps,
      palette,
      activeAmountUnit,
      labelMode,
      getReportTargetChartMetric(state, CHART_KEYS.hospitalTrend),
    );

    setChartButtonsDisabled(dom, false);

    if (dom.reportChartsHintEl instanceof HTMLElement) {
      if (snapshot.hasTargetGap) {
        const gapLabel = buildTargetGapLabel(snapshot);
        dom.reportChartsHintEl.textContent = `部分年份指标未生效，月/季度目标图按缺省值展示；产品分配指标图按可用数据展示（${gapLabel || "请补录指标"}）。金额单位：${activeAmountUnit.label}。`;
      } else {
        dom.reportChartsHintEl.textContent = `图表口径与销售分析表一致，金额单位：${activeAmountUnit.label}。`;
      }
      dom.reportChartsHintEl.classList.remove("report-hint-error");
    }

    resizeReportCharts();
  } catch (error) {
    console.error("[Sales Tool] 图表渲染失败，已降级为空态。", error);
    setChartsUnavailableState(dom, "图表渲染异常，请刷新页面后重试。");
  }
}

function isEchartsReady() {
  return typeof window !== "undefined" && window.echarts && typeof window.echarts.init === "function";
}

function buildChartPointCounts(snapshot, state) {
  const productTopMetric = getReportTargetChartMetric(state, CHART_KEYS.productTop);
  const productMonthlyMetric = getReportTargetChartMetric(state, CHART_KEYS.productMonthlyTrend);
  const hospitalTopMetric = getReportTargetChartMetric(state, CHART_KEYS.hospitalTop);
  const hospitalShareMetric = getReportTargetChartMetric(state, CHART_KEYS.hospitalShare);
  const hospitalTrendMetric = getReportTargetChartMetric(state, CHART_KEYS.hospitalTrend);
  const productTopRows = filterChartRowsByMetricValue(getSortedProductChartRows(snapshot, productTopMetric, PRODUCT_CHART_TOP_LIMIT), productTopMetric);
  const productMonthlyRows = filterChartRowsByMetricValue(
    getSortedProductChartRows(snapshot, productMonthlyMetric, PRODUCT_CHART_TOP_LIMIT),
    productMonthlyMetric,
  );
  const hospitalTopRows = filterChartRowsByMetricValue(
    getSortedHospitalChartRows(snapshot, hospitalTopMetric, HOSPITAL_CHART_TOP_LIMIT),
    hospitalTopMetric,
  );
  const hospitalShareRows = filterChartRowsByMetricValue(
    getSortedHospitalChartRows(snapshot, hospitalShareMetric, HOSPITAL_CHART_TOP_LIMIT),
    hospitalShareMetric,
  );
  const hospitalTrendRows = getHospitalTrendCandidateRows(snapshot, hospitalTrendMetric);

  return {
    [CHART_KEYS.monthlyTrend]: Array.isArray(snapshot.monthRows) ? snapshot.monthRows.length : 0,
    [CHART_KEYS.quarterlyTrend]: Array.isArray(snapshot.quarterRows) ? snapshot.quarterRows.length : 0,
    [CHART_KEYS.productPerformance]: getSortedProductChartRows(snapshot, getReportTargetChartMetric(state, CHART_KEYS.productPerformance), PRODUCT_CHART_TOP_LIMIT).length,
    [CHART_KEYS.productMonthlyTrend]: productMonthlyRows.length ? (Array.isArray(snapshot.monthRows) ? snapshot.monthRows.length : 0) : 0,
    [CHART_KEYS.productTop]: productTopRows.length,
    [CHART_KEYS.hospitalTop]: hospitalTopRows.length,
    [CHART_KEYS.hospitalShare]: hospitalShareRows.length,
    [CHART_KEYS.hospitalTrend]: (Array.isArray(snapshot.monthRows) ? snapshot.monthRows.length : 0) && hospitalTrendRows.length ? snapshot.monthRows.length : 0,
  };
}

function resolveCompactLevel(pointCount) {
  const count = Number(pointCount);
  if (!Number.isFinite(count) || count <= 0) return "full";
  if (count <= CHART_COMPACT_TIGHT_MAX) return "tight";
  if (count <= CHART_COMPACT_MEDIUM_MAX) return "medium";
  return "full";
}

function computeCompactWidthPercent(chartSize, compactLevel) {
  if (compactLevel === "full") return 100;
  if (chartSize === "pie") return compactLevel === "tight" ? 92 : 98;
  if (chartSize === "wide") return compactLevel === "tight" ? 62 : 82;
  return compactLevel === "tight" ? 74 : 88;
}

function getChartLayoutTargets(dom) {
  return [
    { key: CHART_KEYS.monthlyTrend, element: dom.chartMonthlyTrendEl },
    { key: CHART_KEYS.quarterlyTrend, element: dom.chartQuarterlyTrendEl },
    { key: CHART_KEYS.productPerformance, element: dom.chartProductPerformanceEl },
    { key: CHART_KEYS.productMonthlyTrend, element: dom.chartProductMonthlyTrendEl },
    { key: CHART_KEYS.productTop, element: dom.chartProductTopEl },
    { key: CHART_KEYS.hospitalTop, element: dom.chartHospitalTopEl },
    { key: CHART_KEYS.hospitalShare, element: dom.chartHospitalShareEl },
    { key: CHART_KEYS.hospitalTrend, element: dom.chartHospitalTrendEl },
  ].filter((item) => item.element instanceof HTMLElement);
}

function applyChartCompactLayout(dom, pointCounts) {
  if (typeof window !== "undefined" && window.innerWidth < CHART_COMPACT_MIN_VIEWPORT) {
    resetChartCompactLayout(dom);
    return;
  }

  const targets = getChartLayoutTargets(dom);
  for (const target of targets) {
    const sizeType = CHART_COMPACT_SIZE_BY_KEY[target.key];
    const chartSize = sizeType === "half" || sizeType === "pie" ? sizeType : "wide";
    const compactLevel = resolveCompactLevel(pointCounts ? pointCounts[target.key] : 0);
    const widthPercent = computeCompactWidthPercent(chartSize, compactLevel);

    if (widthPercent >= 100) {
      target.element.classList.remove("report-chart-canvas-compact");
      target.element.style.removeProperty("width");
      target.element.style.removeProperty("max-width");
      continue;
    }

    target.element.classList.add("report-chart-canvas-compact");
    target.element.style.width = `${widthPercent}%`;
    target.element.style.maxWidth = `${widthPercent}%`;
  }
}

function resetChartCompactLayout(dom) {
  const targets = getChartLayoutTargets(dom);
  for (const target of targets) {
    target.element.classList.remove("report-chart-canvas-compact");
    target.element.style.removeProperty("width");
    target.element.style.removeProperty("max-width");
  }
}

function reapplyLatestChartCompactLayout(dom) {
  if (!latestChartPointCounts || typeof latestChartPointCounts !== "object") {
    resetChartCompactLayout(dom);
    return;
  }
  applyChartCompactLayout(dom, latestChartPointCounts);
}

function getChartHostElements(dom) {
  return getChartLayoutTargets(dom).map((item) => item.element);
}

function setChartsUnavailableState(dom, message) {
  latestChartPointCounts = null;
  resetChartCompactLayout(dom);
  const text = String(message || CHART_EMPTY_TEXT).trim() || CHART_EMPTY_TEXT;
  const isError = text.includes("异常") || text.includes("失败") || text.includes("不能");

  if (dom.reportChartsHintEl instanceof HTMLElement) {
    dom.reportChartsHintEl.textContent = text;
    dom.reportChartsHintEl.classList.toggle("report-hint-error", isError);
  }

  setHospitalTrendSelectUnavailable(dom, "暂无可选医院");
  setChartButtonsDisabled(dom, true);

  const chartHosts = getChartHostElements(dom);
  if (chartHosts.length === 0) return;

  if (!isEchartsReady()) {
    for (const host of chartHosts) {
      host.classList.add("report-chart-canvas-empty");
      host.textContent = text;
    }
    return;
  }

  for (const host of chartHosts) {
    const chartKey = host.id.replace("chart-", "");
    const chartInstance = ensureChartInstance(chartKey, host);
    renderEmptyChart(chartInstance, text);
  }
}

function resolveActiveHospitalChartKey(state, snapshot, metric = DEFAULT_REPORT_TARGET_CHART_METRIC) {
  const rows = getHospitalTrendCandidateRows(snapshot, metric);
  if (!rows.length) {
    state.activeHospitalChartKey = "";
    return "";
  }

  const activeKey = String(state.activeHospitalChartKey || "").trim();
  if (activeKey && rows.some((row) => row.hospitalKey === activeKey)) {
    return activeKey;
  }

  const fallbackKey = String(rows[0].hospitalKey || "").trim();
  state.activeHospitalChartKey = fallbackKey;
  return fallbackKey;
}

function renderHospitalTrendSelect(state, dom, snapshot, deps, amountUnit, metric = DEFAULT_REPORT_TARGET_CHART_METRIC) {
  if (!(dom.hospitalTrendSelect instanceof HTMLSelectElement)) return;

  const safeMetric = normalizeReportTargetChartMetric(metric);
  const rows = getHospitalTrendCandidateRows(snapshot, safeMetric);
  if (!rows.length) {
    setHospitalTrendSelectUnavailable(dom, "暂无可选医院");
    return;
  }

  const selectedKey = resolveActiveHospitalChartKey(state, snapshot, safeMetric);
  dom.hospitalTrendSelect.disabled = false;
  dom.hospitalTrendSelect.innerHTML = rows
    .map((row) => {
      const optionValue = safeMetric === "quantity" ? `${formatQuantityDisplay(row.quantity, deps)}盒` : formatScaledMoney(row.amount, deps, amountUnit);
      const optionLabel = `${row.hospitalName}（${optionValue}）`;
      return `<option value="${deps.escapeHtml(row.hospitalKey)}">${deps.escapeHtml(optionLabel)}</option>`;
    })
    .join("");

  dom.hospitalTrendSelect.value = selectedKey;
}

function setHospitalTrendSelectUnavailable(dom, placeholderText) {
  if (!(dom.hospitalTrendSelect instanceof HTMLSelectElement)) return;

  const text = String(placeholderText || "暂无可选医院").trim() || "暂无可选医院";
  dom.hospitalTrendSelect.disabled = true;
  dom.hospitalTrendSelect.innerHTML = `<option value="">${text}</option>`;
  dom.hospitalTrendSelect.value = "";
}

function clearChartFallbackText(element) {
  if (!(element instanceof HTMLElement)) return;
  if (!element.classList.contains("report-chart-canvas-empty")) return;

  element.classList.remove("report-chart-canvas-empty");
  element.textContent = "";
}

function ensureChartInstance(key, element) {
  if (!(element instanceof HTMLElement)) return null;
  if (!isEchartsReady()) return null;

  clearChartFallbackText(element);

  const existing = reportChartInstances.get(key);
  if (existing) {
    const disposed = typeof existing.isDisposed === "function" ? existing.isDisposed() : false;
    if (!disposed && typeof existing.getDom === "function" && existing.getDom() === element) {
      return existing;
    }
    if (!disposed && typeof existing.dispose === "function") {
      existing.dispose();
    }
  }

  const instance = window.echarts.init(element, null, { renderer: CHART_RENDERER });
  reportChartInstances.set(key, instance);
  return instance;
}

function renderEmptyChart(instance, message) {
  if (!instance || typeof instance.setOption !== "function") return;

  instance.setOption(
    {
      animation: false,
      backgroundColor: getChartCanvasBackground(),
      grid: { left: 20, right: 20, top: 20, bottom: 20 },
      xAxis: { type: "value", show: false },
      yAxis: { type: "category", show: false, data: [] },
      series: [],
      graphic: [
        {
          type: "text",
          left: "center",
          top: "middle",
          style: {
            text: message || CHART_EMPTY_TEXT,
            fill: "#6b7280",
            fontSize: 13,
          },
        },
      ],
    },
    true,
  );
}

function updateMonthlyTrendChart(instance, snapshot, deps, palette, amountUnit, labelMode, metric) {
  if (!instance) return;
  const labelEnabled = labelMode !== "none";

  const labels = snapshot.monthRows.map((row) => formatMonthLabel(row.ym));
  if (!labels.length) {
    renderEmptyChart(instance, CHART_EMPTY_TEXT);
    return;
  }
  const chartMetric = buildTargetChartMetricPayload(snapshot.monthRows, metric, deps, amountUnit, {
    amountActualSeriesName: "达成金额",
    quantityActualSeriesName: "达成数量",
    amountGrowthSeriesName: "金额同比增长率",
    quantityGrowthSeriesName: "数量同比增长率",
  });
  const series = [
    {
      name: chartMetric.actualSeriesName,
      type: "bar",
      barMaxWidth: 22,
      yAxisIndex: 0,
      data: chartMetric.actualData,
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => chartMetric.formatLabelValue(params.value),
          }
        : { show: false },
    },
  ];
  if (chartMetric.hasTargetSeries) {
    series.push({
      name: chartMetric.targetSeriesName,
      type: "bar",
      barMaxWidth: 22,
      yAxisIndex: 0,
      data: chartMetric.targetData,
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => chartMetric.formatLabelValue(params.value),
          }
        : { show: false },
    });
    series.push({
      name: chartMetric.achievementSeriesName,
      type: "line",
      smooth: true,
      connectNulls: false,
      yAxisIndex: 1,
      data: chartMetric.achievementData,
      lineStyle: {
        width: 2,
      },
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => formatPercentLabelValue(params.value),
          }
        : { show: false },
      labelLayout: buildChartDataLabelLayout(labelMode),
    });
  }
  series.push({
    name: chartMetric.growthSeriesName,
    type: "line",
    smooth: true,
    connectNulls: false,
    yAxisIndex: 1,
    data: chartMetric.growthData,
    lineStyle: {
      type: "dashed",
      width: 2,
    },
    label: labelEnabled
      ? {
          ...buildChartDataLabelStyle(palette, labelMode, "top"),
          formatter: (params) => formatPercentLabelValue(params.value),
        }
      : { show: false },
    labelLayout: buildChartDataLabelLayout(labelMode),
  });

  instance.setOption(
    {
      animationDuration: 300,
      backgroundColor: palette.canvasBg,
      color: palette.series.trend4,
      tooltip: {
        trigger: "axis",
        ...buildThemedTooltipBase(palette),
        formatter: (params) => {
          const lines = params.map((item) => {
            const value = Number(item.value);
            if (!Number.isFinite(value)) {
              return `${item.marker}${item.seriesName}：--`;
            }

            const isPercent = item.seriesName === chartMetric.achievementSeriesName || item.seriesName === chartMetric.growthSeriesName;
            if (isPercent) {
              return `${item.marker}${item.seriesName}：${value.toFixed(2)}%`;
            }

            return `${item.marker}${item.seriesName}：${chartMetric.formatValue(value)}`;
          });
          const title = params.length ? String(params[0].axisValueLabel || params[0].axisValue || "") : "";
          return [title, ...lines].join("<br/>");
        },
      },
      legend: {
        top: 0,
        textStyle: {
          color: palette.legendTextColor,
        },
      },
      grid: {
        left: 56,
        right: 60,
        top: 44,
        bottom: 36,
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: {
          color: palette.axisTextColor,
        },
        axisLine: buildAxisLineTheme(palette),
      },
      yAxis: [
        {
          type: "value",
          name: chartMetric.valueAxisName,
          nameTextStyle: {
            color: palette.axisTextColor,
          },
          axisLabel: {
            color: palette.axisTextColor,
            formatter: (value) => chartMetric.formatAxisValue(value),
          },
          axisLine: buildAxisLineTheme(palette),
          splitLine: buildSplitLineTheme(palette),
        },
        {
          type: "value",
          name: "比率（%）",
          min: chartMetric.negativeFloor,
          max: chartMetric.positiveCeil,
          nameTextStyle: {
            color: palette.axisTextColor,
          },
          axisLabel: {
            color: palette.axisTextColor,
            formatter: (value) => `${Number(value).toFixed(2)}%`,
          },
          axisLine: buildAxisLineTheme(palette),
          splitLine: buildSplitLineTheme(palette),
        },
      ],
      series,
    },
    true,
  );
}

function updateQuarterlyTrendChart(instance, snapshot, deps, palette, amountUnit, labelMode, metric) {
  if (!instance) return;
  const labelEnabled = labelMode !== "none";

  const labels = snapshot.quarterRows.map((row) => String(row.label || "").trim());
  if (!labels.length) {
    renderEmptyChart(instance, CHART_EMPTY_TEXT);
    return;
  }
  const chartMetric = buildTargetChartMetricPayload(snapshot.quarterRows, metric, deps, amountUnit, {
    amountActualSeriesName: "达成金额",
    quantityActualSeriesName: "达成数量",
    amountGrowthSeriesName: "金额同比增长率",
    quantityGrowthSeriesName: "数量同比增长率",
  });
  const series = [
    {
      name: chartMetric.actualSeriesName,
      type: "bar",
      barMaxWidth: 22,
      yAxisIndex: 0,
      data: chartMetric.actualData,
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => chartMetric.formatLabelValue(params.value),
          }
        : { show: false },
    },
  ];
  if (chartMetric.hasTargetSeries) {
    series.push({
      name: chartMetric.targetSeriesName,
      type: "bar",
      barMaxWidth: 22,
      yAxisIndex: 0,
      data: chartMetric.targetData,
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => chartMetric.formatLabelValue(params.value),
          }
        : { show: false },
    });
    series.push({
      name: chartMetric.achievementSeriesName,
      type: "line",
      smooth: true,
      connectNulls: false,
      yAxisIndex: 1,
      data: chartMetric.achievementData,
      lineStyle: {
        width: 2,
      },
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => formatPercentLabelValue(params.value),
          }
        : { show: false },
      labelLayout: buildChartDataLabelLayout(labelMode),
    });
  }
  series.push({
    name: chartMetric.growthSeriesName,
    type: "line",
    smooth: true,
    connectNulls: false,
    yAxisIndex: 1,
    data: chartMetric.growthData,
    lineStyle: {
      type: "dashed",
      width: 2,
    },
    label: labelEnabled
      ? {
          ...buildChartDataLabelStyle(palette, labelMode, "top"),
          formatter: (params) => formatPercentLabelValue(params.value),
        }
      : { show: false },
    labelLayout: buildChartDataLabelLayout(labelMode),
  });

  instance.setOption(
    {
      animationDuration: 300,
      backgroundColor: palette.canvasBg,
      color: palette.series.trend4,
      tooltip: {
        trigger: "axis",
        ...buildThemedTooltipBase(palette),
        formatter: (params) => {
          const lines = params.map((item) => {
            const value = Number(item.value);
            if (!Number.isFinite(value)) {
              return `${item.marker}${item.seriesName}：--`;
            }

            const isPercent = item.seriesName === chartMetric.achievementSeriesName || item.seriesName === chartMetric.growthSeriesName;
            if (isPercent) {
              return `${item.marker}${item.seriesName}：${value.toFixed(2)}%`;
            }

            return `${item.marker}${item.seriesName}：${chartMetric.formatValue(value)}`;
          });
          const title = params.length ? String(params[0].axisValueLabel || params[0].axisValue || "") : "";
          return [title, ...lines].join("<br/>");
        },
      },
      legend: {
        top: 0,
        textStyle: {
          color: palette.legendTextColor,
        },
      },
      grid: {
        left: 56,
        right: 60,
        top: 44,
        bottom: 36,
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: {
          color: palette.axisTextColor,
        },
        axisLine: buildAxisLineTheme(palette),
      },
      yAxis: [
        {
          type: "value",
          name: chartMetric.valueAxisName,
          nameTextStyle: {
            color: palette.axisTextColor,
          },
          axisLabel: {
            color: palette.axisTextColor,
            formatter: (value) => chartMetric.formatAxisValue(value),
          },
          axisLine: buildAxisLineTheme(palette),
          splitLine: buildSplitLineTheme(palette),
        },
        {
          type: "value",
          name: "比率（%）",
          min: chartMetric.negativeFloor,
          max: chartMetric.positiveCeil,
          nameTextStyle: {
            color: palette.axisTextColor,
          },
          axisLabel: {
            color: palette.axisTextColor,
            formatter: (value) => `${Number(value).toFixed(2)}%`,
          },
          axisLine: buildAxisLineTheme(palette),
          splitLine: buildSplitLineTheme(palette),
        },
      ],
      series,
    },
    true,
  );
}

function updateProductPerformanceChart(instance, snapshot, deps, palette, amountUnit, labelMode, metric) {
  if (!instance) return;
  const labelEnabled = labelMode !== "none";

  const rows = snapshot.productRows.slice(0, PRODUCT_CHART_TOP_LIMIT);
  if (!rows.length) {
    renderEmptyChart(instance, "当前范围无产品销售数据");
    return;
  }

  const labels = rows.map((row) => row.productName);
  const chartMetric = buildTargetChartMetricPayload(rows, metric, deps, amountUnit, {
    amountActualSeriesName: "实际金额",
    quantityActualSeriesName: "实际数量",
    amountGrowthSeriesName: "金额同比增长率",
    quantityGrowthSeriesName: "数量同比增长率",
  });
  const series = [
    {
      name: chartMetric.actualSeriesName,
      type: "bar",
      barMaxWidth: 20,
      yAxisIndex: 0,
      data: chartMetric.actualData,
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => chartMetric.formatLabelValue(params.value),
          }
        : { show: false },
    },
  ];
  if (chartMetric.hasTargetSeries) {
    series.push({
      name: chartMetric.targetSeriesName,
      type: "bar",
      barMaxWidth: 20,
      yAxisIndex: 0,
      data: chartMetric.targetData,
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => chartMetric.formatLabelValue(params.value),
          }
        : { show: false },
    });
    series.push({
      name: chartMetric.achievementSeriesName,
      type: "line",
      smooth: true,
      connectNulls: false,
      yAxisIndex: 1,
      data: chartMetric.achievementData,
      lineStyle: {
        width: 2,
      },
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => formatPercentLabelValue(params.value),
          }
        : { show: false },
      labelLayout: buildChartDataLabelLayout(labelMode),
    });
  }
  series.push({
    name: chartMetric.growthSeriesName,
    type: "line",
    smooth: true,
    connectNulls: false,
    yAxisIndex: 1,
    data: chartMetric.growthData,
    lineStyle: {
      type: "dashed",
      width: 2,
    },
    label: labelEnabled
      ? {
          ...buildChartDataLabelStyle(palette, labelMode, "top"),
          formatter: (params) => formatPercentLabelValue(params.value),
        }
      : { show: false },
    labelLayout: buildChartDataLabelLayout(labelMode),
  });

  instance.setOption(
    {
      animationDuration: 300,
      backgroundColor: palette.canvasBg,
      color: palette.series.trend4,
      tooltip: {
        trigger: "axis",
        ...buildThemedTooltipBase(palette),
        formatter: (params) => {
          const lines = params.map((item) => {
            const value = Number(item.value);
            if (!Number.isFinite(value)) {
              return `${item.marker}${item.seriesName}：--`;
            }

            const isPercent = item.seriesName === chartMetric.achievementSeriesName || item.seriesName === chartMetric.growthSeriesName;
            if (isPercent) {
              return `${item.marker}${item.seriesName}：${value.toFixed(2)}%`;
            }
            return `${item.marker}${item.seriesName}：${chartMetric.formatValue(value)}`;
          });

          const title = params.length ? String(params[0].axisValueLabel || params[0].axisValue || "") : "";
          return [title, ...lines].join("<br/>");
        },
      },
      legend: {
        type: "scroll",
        top: 0,
        textStyle: {
          color: palette.legendTextColor,
        },
      },
      grid: {
        left: 56,
        right: 60,
        top: 52,
        bottom: 52,
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: {
          color: palette.axisTextColor,
          interval: 0,
          rotate: labels.length > 5 ? 20 : 0,
        },
        axisLine: buildAxisLineTheme(palette),
      },
      yAxis: [
        {
          type: "value",
          name: chartMetric.valueAxisName,
          nameTextStyle: {
            color: palette.axisTextColor,
          },
          axisLabel: {
            color: palette.axisTextColor,
            formatter: (value) => chartMetric.formatAxisValue(value),
          },
          axisLine: buildAxisLineTheme(palette),
          splitLine: buildSplitLineTheme(palette),
        },
        {
          type: "value",
          name: "比率（%）",
          min: chartMetric.negativeFloor,
          max: chartMetric.positiveCeil,
          nameTextStyle: {
            color: palette.axisTextColor,
          },
          axisLabel: {
            color: palette.axisTextColor,
            formatter: (value) => `${Number(value).toFixed(2)}%`,
          },
          axisLine: buildAxisLineTheme(palette),
          splitLine: buildSplitLineTheme(palette),
        },
      ],
      series,
    },
    true,
  );
}

function updateProductMonthlyTrendChart(instance, snapshot, deps, palette, amountUnit, labelMode, metric) {
  if (!instance) return;
  const labelEnabled = labelMode !== "none";
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "产品金额趋势",
    quantitySeriesName: "产品数量趋势",
  });

  const labels = snapshot.monthRows.map((row) => formatMonthLabel(row.ym));
  const monthKeys = snapshot.monthRows.map((row) => row.ym);
  const topRows = filterChartRowsByMetricValue(
    getSortedProductChartRows(snapshot, chartMetric.metric, PRODUCT_CHART_TOP_LIMIT),
    chartMetric.metric,
  );

  if (!labels.length || !topRows.length) {
    renderEmptyChart(instance, "当前范围无产品销售数据");
    return;
  }

  const productMonthlySeries = snapshot.productMonthlySeries && typeof snapshot.productMonthlySeries === "object"
    ? snapshot.productMonthlySeries
    : {};

  const series = topRows.map((row) => {
    const safeProductKey = String(row.productKey || "").trim();
    const monthlySeriesEntry = safeProductKey ? productMonthlySeries[safeProductKey] : null;
    const monthlyMap =
      monthlySeriesEntry && typeof monthlySeriesEntry === "object" ? monthlySeriesEntry[chartMetric.metric] : null;
    const data = monthKeys.map((ym) => {
      if (!monthlyMap || typeof monthlyMap !== "object") return 0;
      const value = Number(monthlyMap[ym]);
      if (!Number.isFinite(value)) return 0;
      return chartMetric.scaleValue(value) ?? 0;
    });

    return {
      name: row.productName,
      type: "line",
      smooth: true,
      showSymbol: labelEnabled,
      symbolSize: labelEnabled ? 4 : 0,
      connectNulls: false,
      data,
      label: labelEnabled
        ? {
            ...buildChartDataLabelStyle(palette, labelMode, "top"),
            formatter: (params) => chartMetric.formatLabelValue(params.value),
          }
        : { show: false },
      labelLayout: buildChartDataLabelLayout(labelMode),
    };
  });

  instance.setOption(
    {
      animationDuration: 300,
      backgroundColor: palette.canvasBg,
      color: palette.series.productMonthlyLines,
      tooltip: {
        trigger: "axis",
        ...buildThemedTooltipBase(palette),
        formatter: (params) => {
          const title = params.length ? String(params[0].axisValueLabel || params[0].axisValue || "") : "";
          const lines = params.map((item) => {
            const value = Number(item.value);
            if (!Number.isFinite(value)) {
              return `${item.marker}${item.seriesName}：--`;
            }
            return `${item.marker}${item.seriesName}：${chartMetric.formatValue(value)}`;
          });
          return [title, ...lines].join("<br/>");
        },
      },
      legend: {
        type: "scroll",
        top: 0,
        textStyle: {
          color: palette.legendTextColor,
        },
      },
      grid: {
        left: 56,
        right: 24,
        top: 52,
        bottom: 36,
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: {
          color: palette.axisTextColor,
        },
        axisLine: buildAxisLineTheme(palette),
      },
      yAxis: {
        type: "value",
        name: chartMetric.valueAxisName,
        nameTextStyle: {
          color: palette.axisTextColor,
        },
        axisLabel: {
          color: palette.axisTextColor,
          formatter: (value) => chartMetric.formatAxisValue(value),
        },
        axisLine: buildAxisLineTheme(palette),
        splitLine: buildSplitLineTheme(palette),
      },
      series,
    },
    true,
  );
}

function updateProductTopChart(instance, snapshot, deps, palette, amountUnit, labelMode, metric) {
  if (!instance) return;
  const isNameOnlyMode = labelMode === "none";
  const labelEnabled = labelMode !== "none";
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "产品金额占比",
    quantitySeriesName: "产品数量占比",
    amountShareSeriesName: "金额占比",
    quantityShareSeriesName: "数量占比",
  });

  const metricKey = chartMetric.metric === "quantity" ? "quantity" : "amount";
  const rows = filterChartRowsByMetricValue(
    getSortedProductChartRows(snapshot, chartMetric.metric, PRODUCT_CHART_TOP_LIMIT),
    chartMetric.metric,
  );
  if (!rows.length) {
    renderEmptyChart(instance, "当前范围无可展示占比数据");
    return;
  }

  instance.setOption(
    {
      animationDuration: 300,
      backgroundColor: palette.canvasBg,
      color: palette.series.productPie,
      tooltip: {
        trigger: "item",
        ...buildThemedTooltipBase(palette),
        formatter: (params) => {
          const value = Number(params.value);
          const percent = Number.isFinite(params.percent) ? `${params.percent.toFixed(2)}%` : "--";
          return `${params.name}<br/>${chartMetric.metricLabel}：${chartMetric.formatValue(value)}<br/>占比：${percent}`;
        },
      },
      legend: {
        type: "scroll",
        bottom: 0,
        textStyle: {
          color: palette.legendTextColor,
        },
      },
      series: [
        {
          name: chartMetric.seriesName,
          type: "pie",
          radius: ["48%", "72%"],
          center: ["50%", "46%"],
          label: isNameOnlyMode
            ? {
                show: true,
                position: "outside",
                color: palette.axisTextColor,
                formatter: (params) => params.name,
              }
            : labelEnabled
            ? {
                ...buildChartDataLabelStyle(palette, labelMode, "outside"),
                formatter: (params) => {
                  const percent = Number.isFinite(params.percent) ? `${params.percent.toFixed(2)}%` : "--";
                  if (labelMode === "compact") {
                    return `${params.name}\n${percent}`;
                  }
                  const valueText = chartMetric.formatLabelValue(params.value);
                  return `${params.name}\n${percent}｜${valueText || "--"}`;
                },
              }
            : { show: false },
          labelLine: {
            show: labelEnabled || isNameOnlyMode,
          },
          data: rows.map((row) => ({
            name: row.productName,
            value: chartMetric.scaleValue(row[metricKey]),
          })),
        },
      ],
    },
    true,
  );
}

function updateHospitalTopChart(instance, snapshot, deps, palette, amountUnit, labelMode, metric) {
  if (!instance) return;
  const labelEnabled = labelMode !== "none";
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "销售金额",
    quantitySeriesName: "销售数量",
  });

  const metricKey = chartMetric.metric === "quantity" ? "quantity" : "amount";
  const rows = filterChartRowsByMetricValue(
    getSortedHospitalChartRows(snapshot, chartMetric.metric, HOSPITAL_CHART_TOP_LIMIT),
    chartMetric.metric,
  );
  if (!rows.length) {
    renderEmptyChart(instance, "当前范围无医院销售数据");
    return;
  }

  const labels = rows.map((row) => row.hospitalName);
  const values = rows.map((row) => {
    const scaled = chartMetric.scaleValue(row[metricKey]);
    return Number.isFinite(scaled) ? scaled : 0;
  });

  instance.setOption(
    {
      animationDuration: 300,
      backgroundColor: palette.canvasBg,
      color: palette.series.hospitalTopBar,
      tooltip: {
        trigger: "axis",
        ...buildThemedTooltipBase(palette),
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => (Number.isFinite(value) ? chartMetric.formatValue(value) : "--"),
      },
      grid: {
        left: 140,
        right: 24,
        top: 20,
        bottom: 20,
      },
      xAxis: {
        type: "value",
        name: chartMetric.valueAxisName,
        axisLabel: {
          color: palette.axisTextColor,
          formatter: (value) => chartMetric.formatAxisValue(value),
        },
        nameTextStyle: {
          color: palette.axisTextColor,
        },
        axisLine: buildAxisLineTheme(palette),
        splitLine: buildSplitLineTheme(palette),
      },
      yAxis: {
        type: "category",
        data: labels,
        inverse: true,
        axisLabel: {
          color: palette.axisTextColor,
        },
        axisLine: buildAxisLineTheme(palette),
      },
      series: [
        {
          name: chartMetric.seriesName,
          type: "bar",
          barMaxWidth: 22,
          data: values,
          label: labelEnabled
            ? {
                ...buildChartDataLabelStyle(palette, labelMode, "right"),
                formatter: (params) => chartMetric.formatLabelValue(params.value),
              }
            : { show: false },
        },
      ],
    },
    true,
  );
}

function updateHospitalShareChart(instance, snapshot, deps, palette, amountUnit, labelMode, metric) {
  if (!instance) return;
  const isNameOnlyMode = labelMode === "none";
  const labelEnabled = labelMode !== "none";
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "医院金额占比",
    quantitySeriesName: "医院数量占比",
    amountShareSeriesName: "金额占比",
    quantityShareSeriesName: "数量占比",
  });

  const metricKey = chartMetric.metric === "quantity" ? "quantity" : "amount";
  const topRows = getSortedHospitalChartRows(snapshot, chartMetric.metric, HOSPITAL_CHART_TOP_LIMIT);
  if (!topRows.length) {
    renderEmptyChart(instance, "当前范围无医院销售数据");
    return;
  }

  const rows = filterChartRowsByMetricValue(topRows, chartMetric.metric);

  if (!rows.length) {
    renderEmptyChart(instance, "当前范围无可展示占比数据");
    return;
  }

  const pieColors =
    palette && palette.series && Array.isArray(palette.series.hospitalSharePie) && palette.series.hospitalSharePie.length
      ? palette.series.hospitalSharePie
      : palette && palette.series && Array.isArray(palette.series.productPie)
        ? palette.series.productPie
        : undefined;

  instance.setOption(
    {
      animationDuration: 300,
      backgroundColor: palette.canvasBg,
      color: pieColors,
      tooltip: {
        trigger: "item",
        ...buildThemedTooltipBase(palette),
        formatter: (params) => {
          const value = Number(params.value);
          const percent = Number.isFinite(params.percent) ? `${params.percent.toFixed(2)}%` : "--";
          return `${params.name}<br/>${chartMetric.metricLabel}：${chartMetric.formatValue(value)}<br/>占比：${percent}`;
        },
      },
      legend: {
        type: "scroll",
        bottom: 0,
        textStyle: {
          color: palette.legendTextColor,
        },
      },
      series: [
        {
          name: chartMetric.seriesName,
          type: "pie",
          radius: ["48%", "72%"],
          center: ["50%", "46%"],
          label: isNameOnlyMode
            ? {
                show: true,
                position: "outside",
                color: palette.axisTextColor,
                formatter: (params) => params.name,
              }
            : labelEnabled
            ? {
                ...buildChartDataLabelStyle(palette, labelMode, "outside"),
                formatter: (params) => {
                  const percent = Number.isFinite(params.percent) ? `${params.percent.toFixed(2)}%` : "--";
                  if (labelMode === "compact") {
                    return `${params.name}\n${percent}`;
                  }
                  const valueText = chartMetric.formatLabelValue(params.value);
                  return `${params.name}\n${percent}｜${valueText || "--"}`;
                },
              }
            : { show: false },
          labelLine: {
            show: labelEnabled || isNameOnlyMode,
          },
          data: rows.map((row) => ({
            name: row.hospitalName,
            value: chartMetric.scaleValue(row[metricKey]),
          })),
        },
      ],
    },
    true,
  );
}

function updateHospitalTrendChart(instance, snapshot, state, deps, palette, amountUnit, labelMode, metric) {
  if (!instance) return;
  const labelEnabled = labelMode !== "none";
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "销售金额",
    quantitySeriesName: "销售数量",
    amountGrowthSeriesName: "金额同比增长率",
    quantityGrowthSeriesName: "数量同比增长率",
  });

  const rows = getHospitalTrendCandidateRows(snapshot, chartMetric.metric);
  const labels = snapshot.monthRows.map((row) => formatMonthLabel(row.ym));
  const monthKeys = snapshot.monthRows.map((row) => row.ym);
  if (!rows.length || !labels.length) {
    renderEmptyChart(instance, "当前范围无医院销售数据");
    return;
  }

  const activeHospitalKey = resolveActiveHospitalChartKey(state, snapshot, chartMetric.metric);
  if (!activeHospitalKey) {
    renderEmptyChart(instance, "当前范围无医院销售数据");
    return;
  }

  const selectedRow = rows.find((row) => row.hospitalKey === activeHospitalKey) || rows[0];
  const monthlySeriesEntry =
    snapshot.hospitalMonthlySeries && typeof snapshot.hospitalMonthlySeries === "object"
      ? snapshot.hospitalMonthlySeries[activeHospitalKey]
      : null;
  const monthlySeriesMap =
    monthlySeriesEntry && typeof monthlySeriesEntry === "object" ? monthlySeriesEntry[chartMetric.metric] : null;

  const metricData = monthKeys.map((ym) => {
    if (!monthlySeriesMap || typeof monthlySeriesMap !== "object") return 0;
    const value = Number(monthlySeriesMap[ym]);
    if (!Number.isFinite(value)) return 0;
    const scaled = chartMetric.scaleValue(value);
    return Number.isFinite(scaled) ? scaled : 0;
  });

  const metricYoyData = monthKeys.map((ym) => {
    if (!monthlySeriesMap || typeof monthlySeriesMap !== "object") return null;
    const current = Number(monthlySeriesMap[ym]);
    const baseline = Number(monthlySeriesMap[addYearsToYm(ym, -1)]);
    const ratio = calcGrowth(current, baseline);
    return Number.isFinite(ratio) ? Number((ratio * 100).toFixed(2)) : null;
  });

  const percentCandidates = metricYoyData.filter((value) => Number.isFinite(value));
  const maxPercentValue = percentCandidates.length ? Math.max(...percentCandidates, 0) : 0;
  const minPercentValue = percentCandidates.length ? Math.min(...percentCandidates, 0) : 0;
  const positiveCeil = Math.max(120, Math.ceil(maxPercentValue / 10) * 10);
  const negativeFloor = Math.min(0, Math.floor(minPercentValue / 10) * 10);

  instance.setOption(
    {
      animationDuration: 300,
      backgroundColor: palette.canvasBg,
      color: palette.series.hospitalTrend2,
      tooltip: {
        trigger: "axis",
        ...buildThemedTooltipBase(palette),
        formatter: (params) => {
          const title = params.length ? String(params[0].axisValueLabel || params[0].axisValue || "") : "";
          const lines = params.map((item) => {
            const value = Number(item.value);
            if (!Number.isFinite(value)) {
              return `${item.marker}${item.seriesName}：--`;
            }

            if (item.seriesName === chartMetric.growthSeriesName) {
              return `${item.marker}${item.seriesName}：${value.toFixed(2)}%`;
            }

            return `${item.marker}${item.seriesName}：${chartMetric.formatValue(value)}`;
          });
          return [title, ...lines].join("<br/>");
        },
      },
      legend: {
        top: 0,
        textStyle: {
          color: palette.legendTextColor,
        },
      },
      grid: {
        left: 56,
        right: 60,
        top: 48,
        bottom: 36,
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: {
          color: palette.axisTextColor,
        },
        axisLine: buildAxisLineTheme(palette),
      },
      yAxis: [
        {
          type: "value",
          name: chartMetric.valueAxisName,
          nameTextStyle: {
            color: palette.axisTextColor,
          },
          axisLabel: {
            color: palette.axisTextColor,
            formatter: (value) => chartMetric.formatAxisValue(value),
          },
          axisLine: buildAxisLineTheme(palette),
          splitLine: buildSplitLineTheme(palette),
        },
        {
          type: "value",
          name: "比率（%）",
          min: negativeFloor,
          max: positiveCeil,
          nameTextStyle: {
            color: palette.axisTextColor,
          },
          axisLabel: {
            color: palette.axisTextColor,
            formatter: (value) => `${Number(value).toFixed(2)}%`,
          },
          axisLine: buildAxisLineTheme(palette),
          splitLine: buildSplitLineTheme(palette),
        },
      ],
      series: [
        {
          name: chartMetric.seriesName,
          type: "bar",
          barMaxWidth: 24,
          yAxisIndex: 0,
          data: metricData,
          label: labelEnabled
            ? {
                ...buildChartDataLabelStyle(palette, labelMode, "top"),
                formatter: (params) => chartMetric.formatLabelValue(params.value),
              }
            : { show: false },
        },
        {
          name: chartMetric.growthSeriesName,
          type: "line",
          smooth: true,
          connectNulls: false,
          yAxisIndex: 1,
          data: metricYoyData,
          lineStyle: {
            width: 2,
          },
          label: labelEnabled
            ? {
                ...buildChartDataLabelStyle(palette, labelMode, "top"),
                formatter: (params) => formatPercentLabelValue(params.value),
              }
            : { show: false },
          labelLayout: buildChartDataLabelLayout(labelMode),
        },
      ],
      title: {
        text: selectedRow ? `${selectedRow.hospitalName}` : "",
        left: "center",
        top: 22,
        textStyle: {
          fontSize: 12,
          fontWeight: 500,
          color: palette.legendTextColor,
        },
      },
    },
    true,
  );
}

function bindChartExportEvents(state, dom, deps) {
  if (!isChartEventsBound) {
    bindChartExportButton(state, dom, deps, dom.exportChartMonthlyTrendBtn, CHART_KEYS.monthlyTrend, "monthly-trend");
    bindChartExportButton(state, dom, deps, dom.exportChartQuarterlyTrendBtn, CHART_KEYS.quarterlyTrend, "quarterly-trend");
    bindChartExportButton(
      state,
      dom,
      deps,
      dom.exportChartProductPerformanceBtn,
      CHART_KEYS.productPerformance,
      "product-performance",
    );
    bindChartExportButton(
      state,
      dom,
      deps,
      dom.exportChartProductMonthlyTrendBtn,
      CHART_KEYS.productMonthlyTrend,
      "product-monthly-trend",
    );
    bindChartExportButton(state, dom, deps, dom.exportChartProductTopBtn, CHART_KEYS.productTop, "product-top");
    bindChartExportButton(state, dom, deps, dom.exportChartHospitalTopBtn, CHART_KEYS.hospitalTop, "hospital-top");
    bindChartExportButton(state, dom, deps, dom.exportChartHospitalShareBtn, CHART_KEYS.hospitalShare, "hospital-share");
    bindChartExportButton(state, dom, deps, dom.exportChartHospitalTrendBtn, CHART_KEYS.hospitalTrend, "hospital-trend");

    bindChartXlsxExportButton(
      state,
      dom,
      deps,
      dom.exportChartMonthlyTrendXlsxBtn,
      CHART_KEYS.monthlyTrend,
      "monthly-trend",
    );
    bindChartXlsxExportButton(
      state,
      dom,
      deps,
      dom.exportChartQuarterlyTrendXlsxBtn,
      CHART_KEYS.quarterlyTrend,
      "quarterly-trend",
    );
    bindChartXlsxExportButton(
      state,
      dom,
      deps,
      dom.exportChartProductPerformanceXlsxBtn,
      CHART_KEYS.productPerformance,
      "product-performance",
    );
    bindChartXlsxExportButton(
      state,
      dom,
      deps,
      dom.exportChartProductMonthlyTrendXlsxBtn,
      CHART_KEYS.productMonthlyTrend,
      "product-monthly-trend",
    );
    bindChartXlsxExportButton(state, dom, deps, dom.exportChartProductTopXlsxBtn, CHART_KEYS.productTop, "product-top");
    bindChartXlsxExportButton(state, dom, deps, dom.exportChartHospitalTopXlsxBtn, CHART_KEYS.hospitalTop, "hospital-top");
    bindChartXlsxExportButton(
      state,
      dom,
      deps,
      dom.exportChartHospitalShareXlsxBtn,
      CHART_KEYS.hospitalShare,
      "hospital-share",
    );
    bindChartXlsxExportButton(
      state,
      dom,
      deps,
      dom.exportChartHospitalTrendXlsxBtn,
      CHART_KEYS.hospitalTrend,
      "hospital-trend",
    );
    isChartEventsBound = true;
  }

  if (!isChartResizeBound) {
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        reapplyLatestChartCompactLayout(dom);
        resizeReportCharts();
      }, 120);
    });
    window.addEventListener("beforeunload", () => {
      disposeReportCharts();
    });
    isChartResizeBound = true;
  }
}

function bindChartExportButton(state, dom, deps, button, chartKey, fileKey) {
  if (!(button instanceof HTMLButtonElement)) return;

  button.addEventListener("click", () => {
    exportChartAsPng(state, dom, deps, chartKey, fileKey);
  });
}

function bindChartXlsxExportButton(state, dom, deps, button, chartKey, fileKey) {
  if (!(button instanceof HTMLButtonElement)) return;

  button.addEventListener("click", async () => {
    await exportChartAsXlsx(state, dom, deps, chartKey, fileKey);
  });
}

function exportChartAsPng(state, dom, deps, chartKey, fileKey) {
  const chart = reportChartInstances.get(chartKey);
  if (!chart || typeof chart.getDataURL !== "function") {
    if (dom.reportChartsHintEl instanceof HTMLElement) {
      dom.reportChartsHintEl.textContent = "当前图表暂无可导出内容。";
      dom.reportChartsHintEl.classList.add("report-hint-error");
    }
    return;
  }

  const fileName = buildChartExportFileName(state, fileKey);

  try {
    if (typeof chart.resize === "function") {
      chart.resize();
    }

    const dataUrl = chart.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: getChartCanvasBackground(),
    });
    triggerChartDownload(dataUrl, fileName);
    if (dom.reportChartsHintEl instanceof HTMLElement) {
      dom.reportChartsHintEl.classList.remove("report-hint-error");
    }
  } catch (error) {
    console.error("[Sales Tool] 导出 PNG 失败。", { chartKey, error });
    if (dom.reportChartsHintEl instanceof HTMLElement) {
      dom.reportChartsHintEl.textContent = "导出失败，请稍后重试。";
      dom.reportChartsHintEl.classList.add("report-hint-error");
    }
  }
}

async function exportChartAsXlsx(state, dom, deps, chartKey, fileKey) {
  if (!isExcelJsReadyForChartExport()) {
    if (dom.reportChartsHintEl instanceof HTMLElement) {
      dom.reportChartsHintEl.textContent = "Excel 导出组件未加载，请刷新后重试。";
      dom.reportChartsHintEl.classList.add("report-hint-error");
    }
    return;
  }

  const range = normalizeReportRange(state, dom, deps);
  if (range.error) {
    if (dom.reportChartsHintEl instanceof HTMLElement) {
      dom.reportChartsHintEl.textContent = range.error;
      dom.reportChartsHintEl.classList.add("report-hint-error");
    }
    return;
  }

  try {
    const snapshot = buildReportSnapshot(state, deps, range);
    if (!snapshot.hasRangeRecords) {
      if (dom.reportChartsHintEl instanceof HTMLElement) {
        dom.reportChartsHintEl.textContent = "当前图表暂无可导出数据。";
        dom.reportChartsHintEl.classList.add("report-hint-error");
      }
      return;
    }

    const activeAmountUnit = getActiveReportAmountUnit(state);
    const legendSelectedMap = getChartLegendSelectedMap(chartKey);
    const payload = buildChartXlsxExportPayload(snapshot, chartKey, deps, state, activeAmountUnit, legendSelectedMap);
    if (!payload || !Array.isArray(payload.headers) || payload.headers.length === 0 || !Array.isArray(payload.rows) || payload.rows.length === 0) {
      if (dom.reportChartsHintEl instanceof HTMLElement) {
        dom.reportChartsHintEl.textContent = "当前图表暂无可导出数据。";
        dom.reportChartsHintEl.classList.add("report-hint-error");
      }
      return;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Sales Tool";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("图表数据");
    writeChartDataWorksheet(worksheet, payload, range, activeAmountUnit);

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = buildChartDataExportFileName(range, fileKey);
    triggerBinaryDownload(buffer, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    if (dom.reportChartsHintEl instanceof HTMLElement) {
      dom.reportChartsHintEl.textContent = `导出成功：${fileName}`;
      dom.reportChartsHintEl.classList.remove("report-hint-error");
    }
  } catch (error) {
    console.error("[Sales Tool] 导出 XLSX 失败。", { chartKey, error });
    if (dom.reportChartsHintEl instanceof HTMLElement) {
      dom.reportChartsHintEl.textContent = "导出失败，请稍后重试。";
      dom.reportChartsHintEl.classList.add("report-hint-error");
    }
  }
}

function getChartLegendSelectedMap(chartKey) {
  const chart = reportChartInstances.get(chartKey);
  if (!chart || typeof chart.getOption !== "function") return null;

  const option = chart.getOption ? chart.getOption() : null;
  if (!option || !option.legend) return null;

  const legends = Array.isArray(option.legend) ? option.legend : [option.legend];
  const selectedMap = {};
  let hasSelected = false;

  for (const legend of legends) {
    if (!legend || typeof legend.selected !== "object" || legend.selected === null) continue;
    Object.assign(selectedMap, legend.selected);
    hasSelected = true;
  }

  return hasSelected ? selectedMap : null;
}

function isSeriesVisible(seriesName, selectedMap) {
  const safeName = String(seriesName || "").trim();
  if (!safeName) return false;
  if (!selectedMap || typeof selectedMap !== "object") return true;
  if (!Object.prototype.hasOwnProperty.call(selectedMap, safeName)) return true;
  return selectedMap[safeName] !== false;
}

function buildChartXlsxExportPayload(snapshot, chartKey, deps, state, amountUnit, selectedMap) {
  switch (chartKey) {
    case CHART_KEYS.monthlyTrend:
      return buildMonthlyTrendRows(snapshot, deps, amountUnit, selectedMap, getReportTargetChartMetric(state, CHART_KEYS.monthlyTrend));
    case CHART_KEYS.quarterlyTrend:
      return buildQuarterlyTrendRows(snapshot, deps, amountUnit, selectedMap, getReportTargetChartMetric(state, CHART_KEYS.quarterlyTrend));
    case CHART_KEYS.productPerformance:
      return buildProductPerformanceRows(snapshot, deps, amountUnit, selectedMap, getReportTargetChartMetric(state, CHART_KEYS.productPerformance));
    case CHART_KEYS.productMonthlyTrend:
      return buildProductMonthlyTrendRows(
        snapshot,
        deps,
        amountUnit,
        selectedMap,
        getReportTargetChartMetric(state, CHART_KEYS.productMonthlyTrend),
      );
    case CHART_KEYS.productTop:
      return buildProductTopPieRows(snapshot, deps, amountUnit, selectedMap, getReportTargetChartMetric(state, CHART_KEYS.productTop));
    case CHART_KEYS.hospitalTop:
      return buildHospitalTopRows(snapshot, deps, amountUnit, selectedMap, getReportTargetChartMetric(state, CHART_KEYS.hospitalTop));
    case CHART_KEYS.hospitalShare:
      return buildHospitalSharePieRows(
        snapshot,
        deps,
        amountUnit,
        selectedMap,
        getReportTargetChartMetric(state, CHART_KEYS.hospitalShare),
      );
    case CHART_KEYS.hospitalTrend:
      return buildHospitalTrendRows(
        snapshot,
        deps,
        state,
        amountUnit,
        selectedMap,
        getReportTargetChartMetric(state, CHART_KEYS.hospitalTrend),
      );
    default:
      return null;
  }
}

function buildMonthlyTrendRows(snapshot, deps, amountUnit, selectedMap, metric) {
  const chartMetric = buildTargetChartMetricPayload(snapshot.monthRows, metric, deps, amountUnit, {
    amountActualSeriesName: "达成金额",
    quantityActualSeriesName: "达成数量",
    amountGrowthSeriesName: "金额同比增长率",
    quantityGrowthSeriesName: "数量同比增长率",
  });
  const defs = [
    {
      name: chartMetric.actualSeriesName,
      kind: chartMetric.valueKind,
      getter: (_row, index) => chartMetric.actualData[index],
    },
  ];
  if (chartMetric.hasTargetSeries) {
    defs.push({
      name: chartMetric.targetSeriesName,
      kind: chartMetric.valueKind,
      getter: (_row, index) => chartMetric.targetData[index],
    });
    defs.push({
      name: chartMetric.achievementSeriesName,
      kind: "percent",
      getter: (_row, index) =>
        Number.isFinite(chartMetric.achievementData[index]) ? normalizeRatioValue(chartMetric.achievementData[index] / 100) : null,
    });
  }
  defs.push({
    name: chartMetric.growthSeriesName,
    kind: "percent",
    getter: (_row, index) => (Number.isFinite(chartMetric.growthData[index]) ? normalizeRatioValue(chartMetric.growthData[index] / 100) : null),
  });
  const visibleDefs = defs.filter((item) => isSeriesVisible(item.name, selectedMap));
  if (!visibleDefs.length) return null;

  return {
    title: "月度趋势",
    metricLabel: chartMetric.metricLabel,
    valueUnitLabel: chartMetric.unitLabel,
    visibleSeries: visibleDefs.map((item) => item.name),
    headers: [{ label: "月份", kind: "text" }].concat(
      visibleDefs.map((item) => ({
        label: item.kind === "money" ? `${item.name}（${amountUnit.label}）` : item.kind === "quantity" ? `${item.name}（盒）` : item.name,
        kind: item.kind,
      })),
    ),
    rows: snapshot.monthRows.map((row, index) => [formatMonthLabel(row.ym)].concat(visibleDefs.map((item) => item.getter(row, index)))),
  };
}

function buildQuarterlyTrendRows(snapshot, deps, amountUnit, selectedMap, metric) {
  const chartMetric = buildTargetChartMetricPayload(snapshot.quarterRows, metric, deps, amountUnit, {
    amountActualSeriesName: "达成金额",
    quantityActualSeriesName: "达成数量",
    amountGrowthSeriesName: "金额同比增长率",
    quantityGrowthSeriesName: "数量同比增长率",
  });
  const defs = [
    {
      name: chartMetric.actualSeriesName,
      kind: chartMetric.valueKind,
      getter: (_row, index) => chartMetric.actualData[index],
    },
  ];
  if (chartMetric.hasTargetSeries) {
    defs.push({
      name: chartMetric.targetSeriesName,
      kind: chartMetric.valueKind,
      getter: (_row, index) => chartMetric.targetData[index],
    });
    defs.push({
      name: chartMetric.achievementSeriesName,
      kind: "percent",
      getter: (_row, index) =>
        Number.isFinite(chartMetric.achievementData[index]) ? normalizeRatioValue(chartMetric.achievementData[index] / 100) : null,
    });
  }
  defs.push({
    name: chartMetric.growthSeriesName,
    kind: "percent",
    getter: (_row, index) => (Number.isFinite(chartMetric.growthData[index]) ? normalizeRatioValue(chartMetric.growthData[index] / 100) : null),
  });
  const visibleDefs = defs.filter((item) => isSeriesVisible(item.name, selectedMap));
  if (!visibleDefs.length) return null;

  return {
    title: "季度趋势",
    metricLabel: chartMetric.metricLabel,
    valueUnitLabel: chartMetric.unitLabel,
    visibleSeries: visibleDefs.map((item) => item.name),
    headers: [{ label: "季度", kind: "text" }].concat(
      visibleDefs.map((item) => ({
        label: item.kind === "money" ? `${item.name}（${amountUnit.label}）` : item.kind === "quantity" ? `${item.name}（盒）` : item.name,
        kind: item.kind,
      })),
    ),
    rows: snapshot.quarterRows.map((row, index) => [String(row.label || "").trim()].concat(visibleDefs.map((item) => item.getter(row, index)))),
  };
}

function buildProductPerformanceRows(snapshot, deps, amountUnit, selectedMap, metric) {
  const topRows = snapshot.productRows.slice(0, PRODUCT_CHART_TOP_LIMIT);
  if (!topRows.length) return null;

  const chartMetric = buildTargetChartMetricPayload(topRows, metric, deps, amountUnit, {
    amountActualSeriesName: "实际金额",
    quantityActualSeriesName: "实际数量",
    amountGrowthSeriesName: "金额同比增长率",
    quantityGrowthSeriesName: "数量同比增长率",
  });
  const defs = [
    {
      name: chartMetric.actualSeriesName,
      kind: chartMetric.valueKind,
      getter: (_row, index) => chartMetric.actualData[index],
    },
  ];
  if (chartMetric.hasTargetSeries) {
    defs.push({
      name: chartMetric.targetSeriesName,
      kind: chartMetric.valueKind,
      getter: (_row, index) => chartMetric.targetData[index],
    });
    defs.push({
      name: chartMetric.achievementSeriesName,
      kind: "percent",
      getter: (_row, index) =>
        Number.isFinite(chartMetric.achievementData[index]) ? normalizeRatioValue(chartMetric.achievementData[index] / 100) : null,
    });
  }
  defs.push({
    name: chartMetric.growthSeriesName,
    kind: "percent",
    getter: (_row, index) => (Number.isFinite(chartMetric.growthData[index]) ? normalizeRatioValue(chartMetric.growthData[index] / 100) : null),
  });
  const visibleDefs = defs.filter((item) => isSeriesVisible(item.name, selectedMap));
  if (!visibleDefs.length) return null;

  return {
    title: "产品达成与增长（Top10）",
    metricLabel: chartMetric.metricLabel,
    valueUnitLabel: chartMetric.unitLabel,
    visibleSeries: visibleDefs.map((item) => item.name),
    headers: [{ label: "产品/规格", kind: "text" }].concat(
      visibleDefs.map((item) => ({
        label: item.kind === "money" ? `${item.name}（${amountUnit.label}）` : item.kind === "quantity" ? `${item.name}（盒）` : item.name,
        kind: item.kind,
      })),
    ),
    rows: topRows.map((row, index) => [row.productName].concat(visibleDefs.map((item) => item.getter(row, index)))),
  };
}

function buildProductMonthlyTrendRows(snapshot, deps, amountUnit, selectedMap, metric) {
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "产品金额趋势",
    quantitySeriesName: "产品数量趋势",
  });
  const topRows = filterChartRowsByMetricValue(
    getSortedProductChartRows(snapshot, chartMetric.metric, PRODUCT_CHART_TOP_LIMIT),
    chartMetric.metric,
  );
  const monthKeys = snapshot.monthRows.map((row) => row.ym);
  if (!topRows.length || !monthKeys.length) return null;

  const seriesMap = snapshot.productMonthlySeries && typeof snapshot.productMonthlySeries === "object" ? snapshot.productMonthlySeries : {};
  const visibleRows = topRows.filter((row) => isSeriesVisible(row.productName, selectedMap));
  if (!visibleRows.length) return null;

  return {
    title: "产品月度变化趋势（Top10）",
    metricLabel: chartMetric.metricLabel,
    valueUnitLabel: chartMetric.unitLabel,
    visibleSeries: visibleRows.map((row) => row.productName),
    headers: [{ label: "月份", kind: "text" }].concat(
      visibleRows.map((row) => ({
        label: `${row.productName}（${chartMetric.unitLabel}）`,
        kind: chartMetric.valueKind,
      })),
    ),
    rows: monthKeys.map((ym) => {
      const rowValues = [formatMonthLabel(ym)];
      for (const row of visibleRows) {
        const monthlySeriesEntry = seriesMap[row.productKey];
        const monthlyMap =
          monthlySeriesEntry && typeof monthlySeriesEntry === "object" ? monthlySeriesEntry[chartMetric.metric] : null;
        const rawValue = monthlyMap && typeof monthlyMap === "object" ? Number(monthlyMap[ym]) : 0;
        rowValues.push(chartMetric.scaleValue(rawValue) ?? 0);
      }
      return rowValues;
    }),
  };
}

function buildProductTopPieRows(snapshot, deps, amountUnit, selectedMap, metric) {
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "产品金额占比",
    quantitySeriesName: "产品数量占比",
  });
  const metricKey = chartMetric.metric === "quantity" ? "quantity" : "amount";
  const topRows = filterChartRowsByMetricValue(
    getSortedProductChartRows(snapshot, chartMetric.metric, PRODUCT_CHART_TOP_LIMIT),
    chartMetric.metric,
  );
  const visibleRows = topRows.filter((row) => isSeriesVisible(row.productName, selectedMap));
  if (!visibleRows.length) return null;

  const totalMetric = visibleRows.reduce((sum, row) => {
    const metricValue = Number(row?.[metricKey]);
    return sum + (Number.isFinite(metricValue) ? metricValue : 0);
  }, 0);

  return {
    title: `产品 Top10 ${chartMetric.metricLabel}占比`,
    metricLabel: chartMetric.metricLabel,
    valueUnitLabel: chartMetric.unitLabel,
    visibleSeries: visibleRows.map((row) => row.productName),
    headers: [
      { label: "产品/规格", kind: "text" },
      { label: `销售${chartMetric.metricLabel}（${chartMetric.unitLabel}）`, kind: chartMetric.valueKind },
      { label: "占比", kind: "percent" },
    ],
    rows: visibleRows.map((row) => {
      const metricValue = Number(row?.[metricKey]);
      const value = chartMetric.scaleValue(metricValue);
      const ratio = totalMetric > 0 ? normalizeRatioValue(metricValue / totalMetric) : null;
      return [row.productName, value, ratio];
    }),
  };
}

function buildHospitalTopRows(snapshot, deps, amountUnit, selectedMap, metric) {
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "销售金额",
    quantitySeriesName: "销售数量",
  });
  if (!isSeriesVisible(chartMetric.seriesName, selectedMap)) return null;

  const metricKey = chartMetric.metric === "quantity" ? "quantity" : "amount";
  const rows = filterChartRowsByMetricValue(
    getSortedHospitalChartRows(snapshot, chartMetric.metric, HOSPITAL_CHART_TOP_LIMIT),
    chartMetric.metric,
  );
  if (!rows.length) return null;

  return {
    title: `医院 Top10 销售${chartMetric.metricLabel}`,
    metricLabel: chartMetric.metricLabel,
    valueUnitLabel: chartMetric.unitLabel,
    visibleSeries: [chartMetric.seriesName],
    headers: [
      { label: "医院", kind: "text" },
      { label: `销售${chartMetric.metricLabel}（${chartMetric.unitLabel}）`, kind: chartMetric.valueKind },
    ],
    rows: rows.map((row) => [row.hospitalName, chartMetric.scaleValue(row[metricKey])]),
  };
}

function buildHospitalSharePieRows(snapshot, deps, amountUnit, selectedMap, metric) {
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "医院金额占比",
    quantitySeriesName: "医院数量占比",
  });
  const metricKey = chartMetric.metric === "quantity" ? "quantity" : "amount";
  const topRows = filterChartRowsByMetricValue(
    getSortedHospitalChartRows(snapshot, chartMetric.metric, HOSPITAL_CHART_TOP_LIMIT),
    chartMetric.metric,
  );
  const visibleRows = topRows.filter((row) => isSeriesVisible(row.hospitalName, selectedMap));
  if (!visibleRows.length) return null;

  const totalMetric = visibleRows.reduce((sum, row) => {
    const metricValue = Number(row?.[metricKey]);
    return sum + (Number.isFinite(metricValue) ? metricValue : 0);
  }, 0);

  return {
    title: `TOP10医院销售${chartMetric.metricLabel}占比`,
    metricLabel: chartMetric.metricLabel,
    valueUnitLabel: chartMetric.unitLabel,
    visibleSeries: visibleRows.map((row) => row.hospitalName),
    headers: [
      { label: "医院", kind: "text" },
      { label: `销售${chartMetric.metricLabel}（${chartMetric.unitLabel}）`, kind: chartMetric.valueKind },
      { label: "占比", kind: "percent" },
    ],
    rows: visibleRows.map((row) => {
      const metricValue = Number(row?.[metricKey]);
      const value = chartMetric.scaleValue(metricValue);
      const ratio = totalMetric > 0 ? normalizeRatioValue(metricValue / totalMetric) : null;
      return [row.hospitalName, value, ratio];
    }),
  };
}

function buildHospitalTrendRows(snapshot, deps, state, amountUnit, selectedMap, metric) {
  const chartMetric = buildSimpleChartMetricPayload(metric, deps, amountUnit, {
    amountSeriesName: "销售金额",
    quantitySeriesName: "销售数量",
    amountGrowthSeriesName: "金额同比增长率",
    quantityGrowthSeriesName: "数量同比增长率",
  });
  const rows = getHospitalTrendCandidateRows(snapshot, chartMetric.metric);
  const monthKeys = snapshot.monthRows.map((row) => row.ym);
  if (!rows.length || !monthKeys.length) return null;

  const activeHospitalKey = resolveActiveHospitalChartKey(state, snapshot, chartMetric.metric);
  if (!activeHospitalKey) return null;

  const selectedHospital = rows.find((row) => row.hospitalKey === activeHospitalKey) || rows[0];
  const seriesEntry =
    snapshot.hospitalMonthlySeries && typeof snapshot.hospitalMonthlySeries === "object"
      ? snapshot.hospitalMonthlySeries[activeHospitalKey]
      : null;
  const seriesMap = seriesEntry && typeof seriesEntry === "object" ? seriesEntry[chartMetric.metric] : null;
  if (!seriesMap || typeof seriesMap !== "object") return null;

  const defs = [
    {
      name: chartMetric.seriesName,
      kind: chartMetric.valueKind,
      getter: (ym) => {
        const value = Number(seriesMap[ym]);
        return chartMetric.scaleValue(Number.isFinite(value) ? value : 0);
      },
    },
    {
      name: chartMetric.growthSeriesName,
      kind: "percent",
      getter: (ym) => {
        const current = Number(seriesMap[ym]);
        const baseline = Number(seriesMap[addYearsToYm(ym, -1)]);
        return normalizeRatioValue(calcGrowth(current, baseline));
      },
    },
  ];

  const visibleDefs = defs.filter((item) => isSeriesVisible(item.name, selectedMap));
  if (!visibleDefs.length) return null;

  return {
    title: "医院月度趋势与增长率（Top10可选）",
    metricLabel: chartMetric.metricLabel,
    valueUnitLabel: chartMetric.unitLabel,
    visibleSeries: visibleDefs.map((item) => item.name),
    metaEntries: [["选中医院", selectedHospital.hospitalName]],
    headers: [{ label: "月份", kind: "text" }].concat(
      visibleDefs.map((item) => ({
        label: item.kind === "money" ? `${item.name}（${amountUnit.label}）` : item.kind === "quantity" ? `${item.name}（盒）` : item.name,
        kind: item.kind,
      })),
    ),
    rows: monthKeys.map((ym) => [formatMonthLabel(ym)].concat(visibleDefs.map((item) => item.getter(ym)))),
  };
}

function normalizeRatioValue(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function scaleAndRoundAmount(value, deps, amountUnit) {
  const scaled = scaleAmount(value, amountUnit);
  if (!Number.isFinite(scaled)) return null;
  return deps.roundMoney(scaled);
}

function writeChartDataWorksheet(worksheet, payload, range, amountUnit) {
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!headers.length || !rows.length) return;

  const columnCount = Math.max(headers.length, 2);
  const title = `${payload.title}（原始数据）`;
  worksheet.getCell(1, 1).value = title;
  if (columnCount > 1) {
    worksheet.mergeCells(1, 1, 1, columnCount);
  }

  const visibleSeriesText = Array.isArray(payload.visibleSeries) && payload.visibleSeries.length ? payload.visibleSeries.join("、") : "全部";
  const metricLabel = String(payload.metricLabel || "金额").trim() || "金额";
  const valueUnitLabel = String(payload.valueUnitLabel || amountUnit.label).trim() || amountUnit.label;
  const metadataRows = [
    ["图表名称", payload.title],
    ["导出范围", `${range.startYm} ~ ${range.endYm}`],
    ["当前口径", metricLabel],
    ["数值单位", valueUnitLabel],
    ["可见系列", visibleSeriesText],
    ["导出时间", new Date().toLocaleString("zh-CN", { hour12: false })],
  ].concat(Array.isArray(payload.metaEntries) ? payload.metaEntries : []);

  let rowIndex = 3;
  for (const [label, value] of metadataRows) {
    worksheet.getCell(rowIndex, 1).value = label;
    worksheet.getCell(rowIndex, 2).value = value;
    rowIndex += 1;
  }

  rowIndex += 1;
  const headerRowIndex = rowIndex;
  worksheet.getRow(headerRowIndex).values = headers.map((item) => item.label);

  let dataRowIndex = headerRowIndex + 1;
  for (const row of rows) {
    worksheet.getRow(dataRowIndex).values = row;
    dataRowIndex += 1;
  }

  applyChartWorksheetStyles(worksheet, headers, headerRowIndex, dataRowIndex - 1);
}

function applyChartWorksheetStyles(worksheet, headers, headerRowIndex, dataRowEndIndex) {
  const titleCell = worksheet.getCell(1, 1);
  titleCell.font = { bold: true, size: 14, color: { argb: "FF1D4F6A" } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  worksheet.getRow(1).height = 24;

  for (let rowIndex = 3; rowIndex < headerRowIndex - 1; rowIndex += 1) {
    const keyCell = worksheet.getCell(rowIndex, 1);
    const valueCell = worksheet.getCell(rowIndex, 2);
    keyCell.font = { bold: true, color: { argb: "FF2D5E7C" } };
    valueCell.font = { color: { argb: "FF334155" } };
  }

  const headerRow = worksheet.getRow(headerRowIndex);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2F607E" },
    };
    cell.border = buildChartWorksheetBorder("FFB8D4E7");
  });

  for (let rowIndex = headerRowIndex + 1; rowIndex <= dataRowEndIndex; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const isEven = (rowIndex - headerRowIndex) % 2 === 0;
    row.height = 20;

    row.eachCell((cell, colNumber) => {
      const kind = headers[colNumber - 1] ? headers[colNumber - 1].kind : "text";
      cell.border = buildChartWorksheetBorder("FFD7E6F0");
      if (isEven) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF6FBFF" },
        };
      }

      if (kind === "money" || kind === "quantity") {
        if (Number.isFinite(cell.value)) {
          cell.numFmt = "#,##0.00";
        }
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else if (kind === "percent") {
        if (Number.isFinite(cell.value)) {
          cell.numFmt = "0.00%";
        }
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
    });
  }

  const widths = headers.map((header) => estimateTextWidth(header.label));
  for (let rowIndex = headerRowIndex + 1; rowIndex <= dataRowEndIndex; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    for (let col = 1; col <= headers.length; col += 1) {
      const value = row.getCell(col).value;
      const width = estimateCellWidth(value, headers[col - 1].kind);
      widths[col - 1] = Math.max(widths[col - 1], width);
    }
  }

  for (let col = 1; col <= headers.length; col += 1) {
    worksheet.getColumn(col).width = clampNumber(widths[col - 1] + 2, 12, 36);
  }

  worksheet.views = [
    {
      state: "frozen",
      ySplit: headerRowIndex,
      xSplit: 1,
      topLeftCell: `B${headerRowIndex + 1}`,
    },
  ];
}

function buildChartWorksheetBorder(colorArgb) {
  return {
    top: { style: "thin", color: { argb: colorArgb } },
    left: { style: "thin", color: { argb: colorArgb } },
    bottom: { style: "thin", color: { argb: colorArgb } },
    right: { style: "thin", color: { argb: colorArgb } },
  };
}

function estimateCellWidth(value, kind) {
  if (value === null || value === undefined || value === "") return 4;
  if (kind === "percent" && Number.isFinite(value)) {
    return estimateTextWidth(`${(Number(value) * 100).toFixed(2)}%`);
  }
  if ((kind === "money" || kind === "quantity") && Number.isFinite(value)) {
    return estimateTextWidth(Number(value).toFixed(2));
  }
  return estimateTextWidth(String(value));
}

function estimateTextWidth(text) {
  return String(text || "").length;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function triggerBinaryDownload(buffer, fileName, mimeType) {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildChartDataExportFileName(range, fileKey) {
  const safeStart = sanitizeFilePart(range.startYm || "start");
  const safeEnd = sanitizeFilePart(range.endYm || "end");
  return `sales-chart-data-${fileKey}-${safeStart}_to_${safeEnd}.xlsx`;
}

function buildChartExportFileName(state, fileKey) {
  const range = latestChartRange || {
    startYm: String(state.reportStartYm || "start"),
    endYm: String(state.reportEndYm || "end"),
  };
  const safeStart = sanitizeFilePart(range.startYm || "start");
  const safeEnd = sanitizeFilePart(range.endYm || "end");
  return `sales-chart-${fileKey}-${safeStart}_to_${safeEnd}.png`;
}

function triggerChartDownload(dataUrl, fileName) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function sanitizeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^0-9A-Za-z_-]/g, "-")
    .replace(/-+/g, "-");
}

function setChartButtonsDisabled(dom, disabled) {
  const buttons = [
    dom.exportChartMonthlyTrendBtn,
    dom.exportChartMonthlyTrendXlsxBtn,
    dom.exportChartQuarterlyTrendBtn,
    dom.exportChartQuarterlyTrendXlsxBtn,
    dom.exportChartProductPerformanceBtn,
    dom.exportChartProductPerformanceXlsxBtn,
    dom.exportChartProductMonthlyTrendBtn,
    dom.exportChartProductMonthlyTrendXlsxBtn,
    dom.exportChartProductTopBtn,
    dom.exportChartProductTopXlsxBtn,
    dom.exportChartHospitalTopBtn,
    dom.exportChartHospitalTopXlsxBtn,
    dom.exportChartHospitalShareBtn,
    dom.exportChartHospitalShareXlsxBtn,
    dom.exportChartHospitalTrendBtn,
    dom.exportChartHospitalTrendXlsxBtn,
  ];

  for (const button of buttons) {
    if (button instanceof HTMLButtonElement) {
      button.disabled = disabled;
    }
  }
}

function resizeReportCharts() {
  for (const chart of reportChartInstances.values()) {
    if (!chart) continue;
    const disposed = typeof chart.isDisposed === "function" ? chart.isDisposed() : false;
    if (disposed) continue;
    if (typeof chart.resize === "function") {
      chart.resize();
    }
  }
}

function disposeReportCharts() {
  for (const chart of reportChartInstances.values()) {
    if (!chart) continue;
    const disposed = typeof chart.isDisposed === "function" ? chart.isDisposed() : false;
    if (!disposed && typeof chart.dispose === "function") {
      chart.dispose();
    }
  }
  reportChartInstances.clear();
}

function normalizeYm(raw) {
  const value = String(raw || "").trim();
  const matched = value.match(MONTH_RE);
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

  const matched = normalized.match(MONTH_RE);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  return {
    year,
    month,
    index: year * 12 + (month - 1),
  };
}

function compareYm(left, right) {
  const leftParsed = parseYm(left);
  const rightParsed = parseYm(right);
  if (!leftParsed || !rightParsed) return 0;

  return leftParsed.index - rightParsed.index;
}

function addMonthsToYm(ym, offset) {
  const parsed = parseYm(ym);
  if (!parsed || !Number.isInteger(offset)) return "";

  const totalMonthIndex = parsed.year * 12 + (parsed.month - 1) + offset;
  const nextYear = Math.floor(totalMonthIndex / 12);
  const nextMonth = (totalMonthIndex % 12 + 12) % 12;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
}

function addYearsToYm(ym, offsetYears) {
  const parsed = parseYm(ym);
  if (!parsed || !Number.isInteger(offsetYears)) return "";

  return `${parsed.year + offsetYears}-${String(parsed.month).padStart(2, "0")}`;
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

function parseRecordDate(rawDate, deps) {
  const value = String(rawDate || "").trim();
  const matched = value.match(DATE_RE);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!deps.isValidDateParts(year, month, day)) return null;

  return { year, month, day };
}

function buildProductKey(record, deps) {
  const productId = String(record.productId || "").trim();
  if (productId) return `id:${productId}`;

  return `name:${deps.normalizeText(record.productName)}`;
}

function parseProductIdFromKey(productKey) {
  const key = String(productKey || "").trim();
  if (!key.startsWith("id:")) return "";

  return String(key.slice(3) || "").trim();
}

function createEmptyMetric() {
  return {
    amount: 0,
    quantity: 0,
    count: 0,
  };
}

function addValue(map, key, amount, quantity) {
  const previous = map.get(key) || createEmptyMetric();
  previous.amount += amount;
  previous.quantity += quantity;
  previous.count += 1;
  map.set(key, previous);
}

function addNestedValue(outerMap, outerKey, innerKey, amount, quantity) {
  let innerMap = outerMap.get(outerKey);
  if (!innerMap) {
    innerMap = new Map();
    outerMap.set(outerKey, innerMap);
  }

  addValue(innerMap, innerKey, amount, quantity);
}

function readValue(map, key, deps) {
  const value = map instanceof Map ? map.get(key) : null;
  if (!value) return createEmptyMetric();

  return {
    amount: deps.roundMoney(value.amount),
    quantity: deps.roundMoney(value.quantity),
    count: value.count,
  };
}

function sumMonths(map, months, deps) {
  let amount = 0;
  let quantity = 0;
  let count = 0;

  const iterable = months instanceof Set ? months.values() : months;
  for (const month of iterable) {
    const value = readValue(map, month, deps);
    amount += value.amount;
    quantity += value.quantity;
    count += value.count;
  }

  return {
    amount: deps.roundMoney(amount),
    quantity: deps.roundMoney(quantity),
    count,
  };
}

function buildCompleteQuarters(monthKeys, monthSet) {
  if (!monthKeys.length) return [];

  const first = parseYm(monthKeys[0]);
  const last = parseYm(monthKeys[monthKeys.length - 1]);
  if (!first || !last) return [];

  const result = [];
  for (let year = first.year; year <= last.year; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const months = buildQuarterMonths(year, quarter);
      const isComplete = months.every((monthKey) => monthSet.has(monthKey));
      if (!isComplete) continue;

      const previousQuarter = quarter === 1 ? 4 : quarter - 1;
      const previousYear = quarter === 1 ? year - 1 : year;

      result.push({
        year,
        quarter,
        months,
        prevYear: previousYear,
        prevQuarter: previousQuarter,
      });
    }
  }

  return result;
}

function buildQuarterMonths(year, quarter) {
  const startMonth = (quarter - 1) * 3 + 1;
  return [0, 1, 2].map((offset) => `${year}-${String(startMonth + offset).padStart(2, "0")}`);
}

function calcRate(numerator, denominator) {
  const a = Number(numerator);
  const b = Number(denominator);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;

  return roundRatio(a / b);
}

function calcGrowth(current, baseline) {
  const currentNum = Number(current);
  const baselineNum = Number(baseline);
  if (!Number.isFinite(currentNum) || !Number.isFinite(baselineNum) || baselineNum === 0) return null;

  return roundRatio((currentNum - baselineNum) / Math.abs(baselineNum));
}

function roundRatio(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function formatMonthLabel(ym) {
  const parsed = parseYm(ym);
  if (!parsed) return ym;

  return `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;
}

function formatMoneyCell(value, deps, amountUnit = getReportAmountUnitById(DEFAULT_REPORT_AMOUNT_UNIT_ID)) {
  return formatScaledMoney(value, deps, amountUnit);
}

function formatQuantityCell(value, deps) {
  if (!Number.isFinite(value)) return "--";
  return deps.formatMoney(deps.roundMoney(value));
}

function formatPercentCell(value) {
  if (!Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(2)}%`;
}

function formatQuantityDisplay(value, deps) {
  if (!Number.isFinite(value)) return "--";
  return deps.formatMoney(deps.roundMoney(Number(value)));
}

function formatQuantityLabelValue(value, deps) {
  if (!Number.isFinite(value)) return "--";
  return formatQuantityDisplay(value, deps);
}

function compareChartMetricRows(left, right, metric, nameKey) {
  const safeMetric = normalizeReportTargetChartMetric(metric);
  const primaryKey = safeMetric === "quantity" ? "quantity" : "amount";
  const secondaryKey = safeMetric === "quantity" ? "amount" : "quantity";
  const leftPrimary = Number(left?.[primaryKey]);
  const rightPrimary = Number(right?.[primaryKey]);
  if (Number.isFinite(leftPrimary) || Number.isFinite(rightPrimary)) {
    const safeLeftPrimary = Number.isFinite(leftPrimary) ? leftPrimary : Number.NEGATIVE_INFINITY;
    const safeRightPrimary = Number.isFinite(rightPrimary) ? rightPrimary : Number.NEGATIVE_INFINITY;
    if (safeLeftPrimary !== safeRightPrimary) {
      return safeRightPrimary - safeLeftPrimary;
    }
  }

  const leftSecondary = Number(left?.[secondaryKey]);
  const rightSecondary = Number(right?.[secondaryKey]);
  if (Number.isFinite(leftSecondary) || Number.isFinite(rightSecondary)) {
    const safeLeftSecondary = Number.isFinite(leftSecondary) ? leftSecondary : Number.NEGATIVE_INFINITY;
    const safeRightSecondary = Number.isFinite(rightSecondary) ? rightSecondary : Number.NEGATIVE_INFINITY;
    if (safeLeftSecondary !== safeRightSecondary) {
      return safeRightSecondary - safeLeftSecondary;
    }
  }

  const safeNameKey = String(nameKey || "productName");
  return String(left?.[safeNameKey] || "").localeCompare(String(right?.[safeNameKey] || ""), "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function getSortedProductChartRows(snapshot, metric, limit = PRODUCT_CHART_TOP_LIMIT) {
  const rows = Array.isArray(snapshot?.productRows) ? snapshot.productRows.slice() : [];
  rows.sort((left, right) => compareChartMetricRows(left, right, metric, "productName"));
  return Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows;
}

function getSortedHospitalChartRows(snapshot, metric, limit = HOSPITAL_CHART_TOP_LIMIT) {
  const sourceRows = Array.isArray(snapshot?.hospitalChartRows) ? snapshot.hospitalChartRows : Array.isArray(snapshot?.hospitalRows) ? snapshot.hospitalRows : [];
  const rows = sourceRows.slice();
  rows.sort((left, right) => compareChartMetricRows(left, right, metric, "hospitalName"));
  return Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows;
}

function filterChartRowsByMetricValue(rows, metric) {
  const safeMetric = normalizeReportTargetChartMetric(metric);
  const metricKey = safeMetric === "quantity" ? "quantity" : "amount";
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const metricValue = Number(row?.[metricKey]);
    return Number.isFinite(metricValue) && metricValue > 0;
  });
}

function getHospitalTrendCandidateRows(snapshot, metric) {
  return filterChartRowsByMetricValue(getSortedHospitalChartRows(snapshot, metric, HOSPITAL_CHART_TOP_LIMIT), metric);
}

function buildSimpleChartMetricPayload(metric, deps, amountUnit, options = {}) {
  const safeMetric = normalizeReportTargetChartMetric(metric);
  return {
    metric: safeMetric,
    metricLabel: safeMetric === "quantity" ? "数量" : "金额",
    valueKind: safeMetric === "quantity" ? "quantity" : "money",
    unitLabel: safeMetric === "quantity" ? "盒" : amountUnit.label,
    seriesName: safeMetric === "quantity" ? String(options.quantitySeriesName || "销售数量") : String(options.amountSeriesName || "销售金额"),
    shareSeriesName: safeMetric === "quantity" ? String(options.quantityShareSeriesName || "数量占比") : String(options.amountShareSeriesName || "金额占比"),
    growthSeriesName:
      safeMetric === "quantity"
        ? String(options.quantityGrowthSeriesName || "数量同比增长率")
        : String(options.amountGrowthSeriesName || "金额同比增长率"),
    valueAxisName: safeMetric === "quantity" ? "数量（盒）" : `金额（${amountUnit.label}）`,
    scaleValue(rawValue) {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) return null;
      if (safeMetric === "quantity") {
        return deps.roundMoney(value);
      }
      const scaled = scaleAmount(value, amountUnit);
      return Number.isFinite(scaled) ? scaled : null;
    },
    formatValue(value) {
      return safeMetric === "quantity" ? `${formatQuantityDisplay(value, deps)}盒` : formatMoneyDisplay(value, deps);
    },
    formatAxisValue(value) {
      return safeMetric === "quantity" ? formatQuantityDisplay(value, deps) : formatMoneyDisplay(value, deps);
    },
    formatLabelValue(value) {
      return safeMetric === "quantity" ? formatQuantityLabelValue(value, deps) : formatMoneyForLabel(value, deps);
    },
  };
}

function buildTargetGapLabel(snapshot) {
  const parts = [];
  const amountYears = Array.isArray(snapshot?.amountTargetGapYears) ? snapshot.amountTargetGapYears : [];
  const quantityYears = Array.isArray(snapshot?.quantityTargetGapYears) ? snapshot.quantityTargetGapYears : [];
  if (amountYears.length > 0) {
    parts.push(`金额指标：${amountYears.join("、")}年`);
  }
  if (quantityYears.length > 0) {
    parts.push(`数量指标：${quantityYears.join("、")}年`);
  }
  return parts.join("；");
}

function buildTargetChartMetricPayload(rows, metric, deps, amountUnit, options = {}) {
  const safeMetric = normalizeReportTargetChartMetric(metric);
  const amountActualKey = String(options.amountActualKey || "amount");
  const quantityActualKey = String(options.quantityActualKey || "quantity");
  const amountTargetKey = String(options.amountTargetKey || "targetAmount");
  const quantityTargetKey = String(options.quantityTargetKey || "targetQuantity");
  const amountAchievementKey = String(options.amountAchievementKey || "amountAchievement");
  const quantityAchievementKey = String(options.quantityAchievementKey || "quantityAchievement");
  const amountGrowthKey = String(options.amountGrowthKey || "amountYoy");
  const quantityGrowthKey = String(options.quantityGrowthKey || "quantityYoy");

  const actualSeriesName =
    safeMetric === "quantity" ? String(options.quantityActualSeriesName || "实际数量") : String(options.amountActualSeriesName || "实际金额");
  const targetSeriesName = safeMetric === "quantity" ? "指标数量" : "指标金额";
  const achievementSeriesName = safeMetric === "quantity" ? "数量达成率" : "金额达成率";
  const growthSeriesName =
    safeMetric === "quantity" ? String(options.quantityGrowthSeriesName || "数量同比增长率") : String(options.amountGrowthSeriesName || "金额同比增长率");

  const actualData = rows.map((row) => {
    const rawValue = Number(row?.[safeMetric === "quantity" ? quantityActualKey : amountActualKey]);
    if (!Number.isFinite(rawValue)) return 0;
    if (safeMetric === "quantity") {
      return deps.roundMoney(rawValue);
    }
    const scaled = scaleAmount(rawValue, amountUnit);
    return Number.isFinite(scaled) ? scaled : 0;
  });

  const targetData = rows.map((row) => {
    const rawValue = Number(row?.[safeMetric === "quantity" ? quantityTargetKey : amountTargetKey]);
    if (!Number.isFinite(rawValue)) return null;
    if (safeMetric === "quantity") {
      return deps.roundMoney(rawValue);
    }
    const scaled = scaleAmount(rawValue, amountUnit);
    return Number.isFinite(scaled) ? scaled : null;
  });

  const achievementData = rows.map((row) => {
    const rawValue = Number(row?.[safeMetric === "quantity" ? quantityAchievementKey : amountAchievementKey]);
    return Number.isFinite(rawValue) ? Number((rawValue * 100).toFixed(2)) : null;
  });

  const growthData = rows.map((row) => {
    const rawValue = Number(row?.[safeMetric === "quantity" ? quantityGrowthKey : amountGrowthKey]);
    return Number.isFinite(rawValue) ? Number((rawValue * 100).toFixed(2)) : null;
  });

  const hasTargetSeries = targetData.some((value) => Number.isFinite(value) && value > 0);
  const percentCandidates = growthData
    .concat(hasTargetSeries ? achievementData : [])
    .filter((value) => Number.isFinite(value));
  const maxPercentValue = percentCandidates.length ? Math.max(...percentCandidates, 0) : 0;
  const minPercentValue = percentCandidates.length ? Math.min(...percentCandidates, 0) : 0;

  return {
    metric: safeMetric,
    metricLabel: safeMetric === "quantity" ? "数量" : "金额",
    valueKind: safeMetric === "quantity" ? "quantity" : "money",
    unitLabel: safeMetric === "quantity" ? "盒" : amountUnit.label,
    valueAxisName: safeMetric === "quantity" ? "数量（盒）" : `金额（${amountUnit.label}）`,
    actualSeriesName,
    targetSeriesName,
    achievementSeriesName,
    growthSeriesName,
    actualData,
    targetData,
    achievementData,
    growthData,
    hasTargetSeries,
    positiveCeil: Math.max(120, Math.ceil(maxPercentValue / 10) * 10),
    negativeFloor: Math.min(0, Math.floor(minPercentValue / 10) * 10),
    formatValue(value) {
      return safeMetric === "quantity" ? `${formatQuantityDisplay(value, deps)}盒` : formatMoneyDisplay(value, deps);
    },
    formatAxisValue(value) {
      return safeMetric === "quantity" ? formatQuantityDisplay(value, deps) : formatMoneyDisplay(value, deps);
    },
    formatLabelValue(value) {
      return safeMetric === "quantity" ? formatQuantityLabelValue(value, deps) : formatMoneyForLabel(value, deps);
    },
  };
}

function renderEmptyRows(dom) {
  dom.reportMonthBody.innerHTML = `
    <tr>
      <td colspan="11" class="empty">暂无可分析数据</td>
    </tr>
  `;

  dom.reportQuarterBody.innerHTML = `
    <tr>
      <td colspan="11" class="empty">暂无可分析数据</td>
    </tr>
  `;

  dom.reportProductBody.innerHTML = `
    <tr>
      <td colspan="11" class="empty">暂无可分析数据</td>
    </tr>
  `;

  dom.reportHospitalBody.innerHTML = `
    <tr>
      <td colspan="7" class="empty">暂无可分析数据</td>
    </tr>
  `;
}
