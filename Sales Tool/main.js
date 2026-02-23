import {
  TARGET_QUARTERS,
  loadProducts,
  loadRecords,
  loadTargets,
  loadSalesDraft,
  loadReportRange,
  loadReportChartPalette,
  loadReportChartDataLabelMode,
  loadReportAmountUnit,
  saveProducts,
  saveRecords,
  saveTargets,
  saveSalesDraft,
  saveReportRange,
  saveReportChartPalette,
  saveReportChartDataLabelMode,
  saveReportAmountUnit,
  clearSalesDraft,
  createDefaultTargetYear,
  normalizeTargetYearData,
  normalizeTargetNumber,
  buildId,
  normalizeText,
  roundMoney,
  formatMoney,
  formatDate,
  isValidDateParts,
  escapeHtml,
} from "./storage.js";
import {
  bindProductEvents,
  renderProductMaster,
  renderProductSelectOptions,
  updateSalesFormAvailability,
  updateComputedAmount,
  validateSalesInput,
} from "./products.js";
import { DEFAULT_PAGE_SIZE, bindRecordEvents, renderRecords, clearImportResult } from "./records.js";
import {
  bindTargetInputEvents,
  ensureYearTargets,
  renderTargetInputSection,
  getCurrentTargetYear,
  getEffectiveMonthlyTargetMap,
  getProductMonthlyAllocationMap,
} from "./targets.js";
import {
  DEFAULT_REPORT_AMOUNT_UNIT_ID,
  DEFAULT_REPORT_CHART_DATA_LABEL_MODE,
  DEFAULT_REPORT_CHART_PALETTE_ID,
  bindReportEvents,
  getDefaultReportRange,
  renderReportSection,
} from "./reports.js";

window.__SALES_TOOL_MODULE_BOOTED__ = false;
window.__SALES_TOOL_MODULE_BOOT_ERROR__ = false;

try {
const defaultReportRange = getDefaultReportRange();
const initialReportRange = loadReportRange(defaultReportRange) || defaultReportRange;
const initialReportChartPaletteId = loadReportChartPalette(DEFAULT_REPORT_CHART_PALETTE_ID);
const initialReportChartDataLabelMode = loadReportChartDataLabelMode(DEFAULT_REPORT_CHART_DATA_LABEL_MODE);
const initialReportAmountUnitId = loadReportAmountUnit(DEFAULT_REPORT_AMOUNT_UNIT_ID);

const dom = {
  productForm: document.getElementById("product-form"),
  productNameInput: document.getElementById("product-name"),
  unitPriceInput: document.getElementById("unit-price"),
  productErrorEl: document.getElementById("product-error"),
  productMasterBody: document.getElementById("product-master-body"),

  salesForm: document.getElementById("sales-form"),
  productSelect: document.getElementById("product-id"),
  quantityInput: document.getElementById("quantity"),
  amountInput: document.getElementById("amount"),
  hospitalInput: document.getElementById("hospital"),
  deliveryInput: document.getElementById("delivery"),
  dateInput: document.getElementById("date"),
  salesSubmitBtn: document.getElementById("sales-submit-btn"),
  clearSalesDraftBtn: document.getElementById("clear-sales-draft-btn"),
  salesTipEl: document.getElementById("sales-tip"),
  salesErrorEl: document.getElementById("form-error"),

  downloadTemplateBtn: document.getElementById("download-template-btn"),
  importExcelBtn: document.getElementById("import-excel-btn"),
  importFileInput: document.getElementById("import-file-input"),
  importResultEl: document.getElementById("import-result"),

  recordsBody: document.getElementById("records-body"),
  recordsHead: document.getElementById("records-head"),
  listErrorEl: document.getElementById("list-error"),
  pageSizeSelect: document.getElementById("page-size-select"),
  multiSelectToggleBtn: document.getElementById("multi-select-toggle-btn"),
  selectCurrentPageBtn: document.getElementById("select-current-page-btn"),
  deleteSelectedBtn: document.getElementById("delete-selected-btn"),
  clearAllRecordsBtn: document.getElementById("clear-all-records-btn"),
  prevPageBtn: document.getElementById("prev-page-btn"),
  nextPageBtn: document.getElementById("next-page-btn"),
  pageInfoEl: document.getElementById("page-info"),

  targetYearSelect: document.getElementById("target-year-select"),
  targetStatusEl: document.getElementById("target-status"),
  targetErrorEl: document.getElementById("target-error"),
  targetClearPageBtn: document.getElementById("target-clear-page-btn"),
  targetInputBody: document.getElementById("target-input-body"),
  targetProductAllocQuarterSelect: document.getElementById("target-product-alloc-quarter"),
  targetProductAllocClearPageBtn: document.getElementById("target-product-alloc-clear-page-btn"),
  targetProductAllocMonthCol1: document.getElementById("target-product-alloc-month-col-1"),
  targetProductAllocMonthCol2: document.getElementById("target-product-alloc-month-col-2"),
  targetProductAllocMonthCol3: document.getElementById("target-product-alloc-month-col-3"),
  targetProductAllocSummaryEl: document.getElementById("target-product-alloc-summary"),
  targetProductAllocHintEl: document.getElementById("target-product-alloc-hint"),
  targetProductAllocBody: document.getElementById("target-product-alloc-body"),

  reportStartMonthInput: document.getElementById("report-start-month"),
  reportEndMonthInput: document.getElementById("report-end-month"),
  reportAmountUnitSelect: document.getElementById("report-amount-unit-select"),
  exportReportTablesBtn: document.getElementById("export-report-tables-btn"),
  reportHintEl: document.getElementById("report-hint"),
  reportMonthBody: document.getElementById("report-month-body"),
  reportQuarterBody: document.getElementById("report-quarter-body"),
  reportProductBody: document.getElementById("report-product-body"),
  reportHospitalBody: document.getElementById("report-hospital-body"),
  reportEmptyEl: document.getElementById("report-empty"),
  reportChartsDetails: document.getElementById("report-visual-board"),
  reportChartsHintEl: document.getElementById("report-charts-hint"),
  reportChartPaletteSelect: document.getElementById("report-chart-palette-select"),
  reportChartDataLabelModeSelect: document.getElementById("report-chart-data-label-mode-select"),
  chartMonthlyTrendEl: document.getElementById("chart-monthly-trend"),
  chartQuarterlyTrendEl: document.getElementById("chart-quarterly-trend"),
  chartProductPerformanceEl: document.getElementById("chart-product-performance"),
  chartProductMonthlyTrendEl: document.getElementById("chart-product-monthly-trend"),
  chartProductTopEl: document.getElementById("chart-product-top"),
  chartHospitalTopEl: document.getElementById("chart-hospital-top"),
  chartHospitalShareEl: document.getElementById("chart-hospital-share"),
  hospitalTrendSelect: document.getElementById("chart-hospital-trend-select"),
  chartHospitalTrendEl: document.getElementById("chart-hospital-trend"),
  exportChartMonthlyTrendBtn: document.getElementById("export-chart-monthly-trend-btn"),
  exportChartMonthlyTrendXlsxBtn: document.getElementById("export-chart-monthly-trend-xlsx-btn"),
  exportChartQuarterlyTrendBtn: document.getElementById("export-chart-quarterly-trend-btn"),
  exportChartQuarterlyTrendXlsxBtn: document.getElementById("export-chart-quarterly-trend-xlsx-btn"),
  exportChartProductPerformanceBtn: document.getElementById("export-chart-product-performance-btn"),
  exportChartProductPerformanceXlsxBtn: document.getElementById("export-chart-product-performance-xlsx-btn"),
  exportChartProductMonthlyTrendBtn: document.getElementById("export-chart-product-monthly-trend-btn"),
  exportChartProductMonthlyTrendXlsxBtn: document.getElementById("export-chart-product-monthly-trend-xlsx-btn"),
  exportChartProductTopBtn: document.getElementById("export-chart-product-top-btn"),
  exportChartProductTopXlsxBtn: document.getElementById("export-chart-product-top-xlsx-btn"),
  exportChartHospitalTopBtn: document.getElementById("export-chart-hospital-top-btn"),
  exportChartHospitalTopXlsxBtn: document.getElementById("export-chart-hospital-top-xlsx-btn"),
  exportChartHospitalShareBtn: document.getElementById("export-chart-hospital-share-btn"),
  exportChartHospitalShareXlsxBtn: document.getElementById("export-chart-hospital-share-xlsx-btn"),
  exportChartHospitalTrendBtn: document.getElementById("export-chart-hospital-trend-btn"),
  exportChartHospitalTrendXlsxBtn: document.getElementById("export-chart-hospital-trend-xlsx-btn"),
};

const state = {
  products: loadProducts(),
  records: loadRecords(),
  targets: loadTargets(),

  editingProductId: "",
  editingRowId: "",
  importResult: null,

  pageSize: DEFAULT_PAGE_SIZE,
  currentPage: 1,
  isMultiSelectMode: false,
  selectedRecordIds: new Set(),
  sortField: "",
  sortDirection: "",

  activeTargetYear: getCurrentTargetYear(),
  activeTargetAllocationQuarter: `Q${Math.floor(new Date().getMonth() / 3) + 1}`,
  targetSaveTimer: null,
  targetInputFormatError: "",
  targetProductAllocationFormatError: "",

  reportStartYm: initialReportRange.startYm,
  reportEndYm: initialReportRange.endYm,
  reportRangeError: "",
  reportChartPaletteId: initialReportChartPaletteId,
  reportChartDataLabelMode: initialReportChartDataLabelMode,
  reportAmountUnitId: initialReportAmountUnitId,
  activeHospitalChartKey: "",
};

function showProductError(message) {
  dom.productErrorEl.textContent = message;
}

function clearProductError() {
  dom.productErrorEl.textContent = "";
}

function showSalesError(message) {
  dom.salesErrorEl.textContent = message;
}

function clearSalesError() {
  dom.salesErrorEl.textContent = "";
}

function showListError(message) {
  dom.listErrorEl.textContent = message;
}

function clearListError() {
  dom.listErrorEl.textContent = "";
}

const deps = {
  TARGET_QUARTERS,
  createDefaultTargetYear,
  normalizeTargetYearData,
  normalizeTargetNumber,

  buildId,
  normalizeText,
  roundMoney,
  formatMoney,
  formatDate,
  isValidDateParts,
  escapeHtml,

  saveProducts: (targetState = state) => saveProducts(targetState),
  saveRecords: (targetState = state) => saveRecords(targetState),
  saveTargets: (targetState = state) => saveTargets(targetState),
  loadSalesDraft,
  saveSalesDraft,
  saveReportRange,
  saveReportChartPalette,
  saveReportChartDataLabelMode,
  saveReportAmountUnit,
  clearSalesDraft,
  getEffectiveMonthlyTargetMap: (year) => getEffectiveMonthlyTargetMap(state, year, deps),
  getProductMonthlyAllocationMap: (year) => getProductMonthlyAllocationMap(state, year, deps),

  showProductError,
  clearProductError,
  showSalesError,
  clearSalesError,
  showListError,
  clearListError,
};

deps.validateSalesInput = (data, selectedProduct) => validateSalesInput(state, data, selectedProduct);
deps.renderProductMaster = () => renderProductMaster(state, dom, deps);
deps.renderProductSelectOptions = () => renderProductSelectOptions(state, dom, deps);
deps.updateSalesFormAvailability = () => updateSalesFormAvailability(state, dom);
deps.updateComputedAmount = () => updateComputedAmount(state, dom, deps);
deps.renderRecords = () => renderRecords(state, dom, deps);
deps.renderTargets = () => renderTargetInputSection(state, dom, deps);
deps.renderReports = () => renderReportSection(state, dom, deps);

if (dom.pageSizeSelect instanceof HTMLSelectElement) {
  dom.pageSizeSelect.value = String(state.pageSize);
}

deps.renderProductMaster();
deps.renderProductSelectOptions();
deps.renderRecords();
deps.updateSalesFormAvailability();
deps.updateComputedAmount();
clearImportResult(state, dom, deps);
ensureYearTargets(state, state.activeTargetYear, deps);
renderTargetInputSection(state, dom, deps);
renderReportSection(state, dom, deps);
bindTargetInputEvents(state, dom, deps);
bindReportEvents(state, dom, deps);
bindProductEvents(state, dom, deps);
bindRecordEvents(state, dom, deps);
window.__SALES_TOOL_MODULE_BOOTED__ = true;
} catch (error) {
  window.__SALES_TOOL_MODULE_BOOT_ERROR__ = true;
  console.error("[Sales Tool] 模块入口初始化失败，请检查控制台错误信息。", error);

  if (!document.getElementById("sales-tool-init-error")) {
    const errorEl = document.createElement("div");
    errorEl.id = "sales-tool-init-error";
    errorEl.className = "error";
    errorEl.setAttribute("role", "alert");
    errorEl.textContent = "页面初始化失败，请刷新后重试；若仍失败请打开控制台查看错误。";
    const mountTarget = document.querySelector("main.container") || document.body;
    mountTarget.prepend(errorEl);
  }
}
