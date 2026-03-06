import {
  TARGET_QUARTERS,
  loadSalesDraft,
  loadReportRange,
  loadReportChartPalette,
  loadReportChartDataLabelMode,
  loadReportAmountUnit,
  saveSalesDraft,
  saveReportRange,
  saveReportChartPalette,
  saveReportChartDataLabelMode,
  saveReportAmountUnit,
  clearSalesDraft,
  createDefaultTargetsPayload,
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
import { bootstrapAuthGate, getCurrentAuthUser, getSupabaseClient } from "./auth.js";
import { initAiChatUi } from "./ai-chat-ui.js";
import { createAppDeps } from "./app/create-app-deps.js";
import { buildBusinessSnapshotPayload, createChatReplyRequester } from "./app/chat-client.js";
import { attachSmokeWriteTool, runReadOnlyRecordsCountCheck } from "./app/smoke-tools.js";
import { getSupabaseAuthContext, getSupabaseSessionAccessToken } from "./infra/supabase-auth-context.js";
import { createProductsRepository } from "./infra/products-repository.js";
import { createRecordsRepository } from "./infra/records-repository.js";
import { createTargetsRepository } from "./infra/targets-repository.js";

window.__SALES_TOOL_MODULE_BOOTED__ = false;
window.__SALES_TOOL_MODULE_BOOT_ERROR__ = false;

function getAuthContext() {
  return getSupabaseAuthContext({ getSupabaseClient, getCurrentAuthUser });
}

async function initializeApp() {
  const defaultReportRange = getDefaultReportRange();
  const loadedReportRange = loadReportRange(defaultReportRange);
  const initialReportRange =
    loadedReportRange && typeof loadedReportRange === "object"
      ? loadedReportRange
      : defaultReportRange;
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
    exportRecordsExcelBtn: document.getElementById("export-records-excel-btn"),
    importFileInput: document.getElementById("import-file-input"),
    importResultEl: document.getElementById("import-result"),

    recordsBody: document.getElementById("records-body"),
    recordsHead: document.getElementById("records-head"),
    listErrorEl: document.getElementById("list-error"),
    listStatusEl: document.getElementById("list-status"),
    recordFilterStartDateInput: document.getElementById("record-filter-start-date"),
    recordFilterEndDateInput: document.getElementById("record-filter-end-date"),
    recordFilterProductKeywordInput: document.getElementById("record-filter-product-keyword"),
    recordFilterHospitalKeywordInput: document.getElementById("record-filter-hospital-keyword"),
    recordFilterApplyBtn: document.getElementById("record-filter-apply-btn"),
    recordFilterResetBtn: document.getElementById("record-filter-reset-btn"),
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
    products: [],
    records: [],
    recordListItems: [],
    reportRecords: [],
    targets: createDefaultTargetsPayload(),

    editingProductId: "",
    editingRowId: "",
    importResult: null,

    pageSize: DEFAULT_PAGE_SIZE,
    currentPage: 1,
    recordListTotal: 0,
    recordsInitialLoadDone: false,
    recordFilters: {
      startDate: "",
      endDate: "",
      productKeyword: "",
      hospitalKeyword: "",
    },
    isMultiSelectMode: false,
    selectedRecordIds: new Set(),
    sortField: "",
    sortDirection: "",

    activeTargetYear: getCurrentTargetYear(),
    activeTargetAllocationQuarter: `Q${Math.floor(new Date().getMonth() / 3) + 1}`,
    targetSaveTimer: null,
    targetInputFormatError: "",
    targetProductAllocationFormatError: "",
    targetSyncError: "",

    reportStartYm: initialReportRange.startYm,
    reportEndYm: initialReportRange.endYm,
    reportRangeError: "",
    reportChartPaletteId: initialReportChartPaletteId,
    reportChartDataLabelMode: initialReportChartDataLabelMode,
    reportAmountUnitId: initialReportAmountUnitId,
    activeHospitalChartKey: "",
  };

  function hydrateReportRangeInputs(domRef, stateRef) {
    const startInput = domRef.reportStartMonthInput instanceof HTMLInputElement ? domRef.reportStartMonthInput : null;
    const endInput = domRef.reportEndMonthInput instanceof HTMLInputElement ? domRef.reportEndMonthInput : null;
    if (startInput) {
      startInput.value = String(stateRef.reportStartYm || "").trim();
    }
    if (endInput) {
      endInput.value = String(stateRef.reportEndYm || "").trim();
    }
  }

  const productsRepository = createProductsRepository({
    getAuthContext,
    roundMoney,
    normalizeText,
  });
  const recordsRepository = createRecordsRepository({
    getAuthContext,
    getProducts: () => state.products,
    normalizeText,
    roundMoney,
    defaultPageSize: DEFAULT_PAGE_SIZE,
  });
  const targetsRepository = createTargetsRepository({
    getAuthContext,
    createDefaultTargetsPayload,
    normalizeTargetYearData,
  });

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

  function showSalesTip(message, tone = "muted") {
    if (!(dom.salesTipEl instanceof HTMLElement)) {
      return;
    }

    dom.salesTipEl.textContent = message;
    dom.salesTipEl.classList.toggle("hint-success", tone === "success");
  }

  function clearSalesTip() {
    if (!(dom.salesTipEl instanceof HTMLElement)) {
      return;
    }

    dom.salesTipEl.textContent = "";
    dom.salesTipEl.classList.remove("hint-success");
  }

  function showListError(message) {
    clearListStatus();
    dom.listErrorEl.textContent = message;
  }

  function clearListError() {
    dom.listErrorEl.textContent = "";
  }

  function clearListStatus() {
    if (listStatusTimer) {
      clearTimeout(listStatusTimer);
      listStatusTimer = null;
    }

    if (!(dom.listStatusEl instanceof HTMLElement)) {
      return;
    }

    dom.listStatusEl.textContent = "";
    dom.listStatusEl.classList.remove("list-status-syncing", "list-status-success", "list-status-muted");
  }

  function showListStatus(message, tone = "muted") {
    if (!(dom.listStatusEl instanceof HTMLElement)) {
      return;
    }

    clearListStatus();
    dom.listStatusEl.textContent = String(message || "").trim();
    if (!dom.listStatusEl.textContent) {
      return;
    }

    if (tone === "syncing") {
      dom.listStatusEl.classList.add("list-status-syncing");
      return;
    }

    if (tone === "success") {
      dom.listStatusEl.classList.add("list-status-success");
      listStatusTimer = setTimeout(() => {
        clearListStatus();
      }, 3000);
      return;
    }

    dom.listStatusEl.classList.add("list-status-muted");
  }

  const repos = {
    ...productsRepository,
    ...recordsRepository,
    ...targetsRepository,
  };

  const deps = createAppDeps({
    state,
    dom,
    repos,
    ui: {
      validateSalesInput,
      renderProductMaster,
      renderProductSelectOptions,
      updateSalesFormAvailability,
      updateComputedAmount,
      renderRecords,
      renderTargetInputSection,
      renderReportSection,
      getEffectiveMonthlyTargetMap,
      getProductMonthlyAllocationMap,
    },
    shared: {
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
      loadSalesDraft,
      saveSalesDraft,
      saveReportRange,
      saveReportChartPalette,
      saveReportChartDataLabelMode,
      saveReportAmountUnit,
      clearSalesDraft,
    },
    feedback: {
      showProductError,
      clearProductError,
      showSalesError,
      clearSalesError,
      showSalesTip,
      clearSalesTip,
      showListError,
      clearListError,
      showListStatus,
      clearListStatus,
    },
  });

  const requestAiChatReply = createChatReplyRequester({
    getAccessToken: () => getSupabaseSessionAccessToken({ getSupabaseClient }),
    getBusinessSnapshot: () =>
      buildBusinessSnapshotPayload(state, {
        formatMoney,
        isValidDateParts,
        normalizeText,
        roundMoney,
      }),
    fetchImpl: (...args) => fetch(...args),
  });

  const aiChatApi = window.__SALES_TOOL_AI_CHAT__;
  if (aiChatApi && typeof aiChatApi.setSendHandler === "function") {
    aiChatApi.setSendHandler((message, options) => requestAiChatReply(message, options));
  } else {
    console.warn("[Sales Tool] 未检测到 AI Chat UI 桥接对象。");
  }

  if (dom.pageSizeSelect instanceof HTMLSelectElement) {
    dom.pageSizeSelect.value = String(state.pageSize);
  }
  hydrateReportRangeInputs(dom, state);

  try {
    state.products = await productsRepository.fetchProductsFromCloud();
    clearProductError();
  } catch (error) {
    showProductError(`产品加载失败：${error instanceof Error ? error.message : "请稍后重试"}`);
    console.error("[Sales Tool] 云端产品读取失败。", error);
  }

  try {
    state.targets = await targetsRepository.fetchTargetsFromCloud();
    state.targetSyncError = "";
  } catch (error) {
    state.targets = createDefaultTargetsPayload();
    state.targetSyncError = `指标加载失败：${error instanceof Error ? error.message : "请稍后重试"}`;
    console.error("[Sales Tool] 指标加载失败。", error);
  }

  deps.renderProductMaster();
  deps.renderProductSelectOptions();
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
  deps.renderRecords();
}

function showInitError(error) {
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

async function bootstrap() {
  try {
    initAiChatUi({
      placeholderStatus: "聊天服务连接中，请稍后再试。",
    });

    await bootstrapAuthGate({
      appRoot: document.querySelector("main.container"),
    });

    await runReadOnlyRecordsCountCheck({ getAuthContext });
    attachSmokeWriteTool({ getAuthContext });
    await initializeApp();
    window.__SALES_TOOL_MODULE_BOOTED__ = true;
  } catch (error) {
    showInitError(error);
  }
}

void bootstrap();
