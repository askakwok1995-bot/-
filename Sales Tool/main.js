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
  buildYmFromParts,
  getDefaultReportRange,
  getReportRangeControlYears,
  parseReportYmParts,
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
import { createDemoWorkspaceSnapshot } from "./demo-workspace.js";
import { applyWorkspaceReadOnlyState, bindWorkspaceReadOnlyGuards } from "./workspace-ui.js";

window.__SALES_TOOL_MODULE_BOOTED__ = false;
window.__SALES_TOOL_MODULE_BOOT_ERROR__ = false;
const HERO_CARD_NAVIGATION_HASHES = new Set(["#report-analysis-card", "#sales-entry-card", "#records-list-card"]);

function getAuthContext() {
  return getSupabaseAuthContext({ getSupabaseClient, getCurrentAuthUser });
}

function getHeroCardNavigationTarget(hash) {
  const normalizedHash = typeof hash === "string" ? hash.trim() : "";
  if (!HERO_CARD_NAVIGATION_HASHES.has(normalizedHash)) {
    return null;
  }

  const target = document.querySelector(normalizedHash);
  return target instanceof HTMLDetailsElement ? target : null;
}

function openHeroCardNavigationTarget(hash, { shouldScroll = false } = {}) {
  const target = getHeroCardNavigationTarget(hash);
  if (!(target instanceof HTMLDetailsElement)) {
    return false;
  }

  if (!target.open) {
    target.open = true;
  }

  if (shouldScroll) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return true;
}

function bindHeroCardNavigation() {
  if (document.body?.dataset.heroCardNavigationBound === "true") {
    return;
  }

  const primaryLinks = Array.from(document.querySelectorAll(".hero-actions .hero-link-btn[href^='#']"));
  primaryLinks.forEach((link) => {
    if (!(link instanceof HTMLAnchorElement)) return;

    link.addEventListener("click", (event) => {
      const targetHash = String(link.getAttribute("href") || "").trim();
      const handled = openHeroCardNavigationTarget(targetHash, { shouldScroll: true });
      if (!handled) return;

      event.preventDefault();
      if (window.location.hash !== targetHash) {
        window.history.pushState(null, "", targetHash);
      }
    });
  });

  const syncFromHash = () => {
    openHeroCardNavigationTarget(window.location.hash, { shouldScroll: true });
  };

  window.addEventListener("hashchange", syncFromHash);
  if (window.location.hash) {
    requestAnimationFrame(syncFromHash);
  }

  document.body.dataset.heroCardNavigationBound = "true";
}

async function initializeApp(initialUser = null) {
  const defaultRecordFilters = () => ({
    startDate: "",
    endDate: "",
    productKeyword: "",
    hospitalKeyword: "",
  });

  const defaultReportRange = getDefaultReportRange();
  const initialReportChartPaletteId = loadReportChartPalette(DEFAULT_REPORT_CHART_PALETTE_ID);
  const initialReportChartDataLabelMode = loadReportChartDataLabelMode(DEFAULT_REPORT_CHART_DATA_LABEL_MODE);
  const initialReportAmountUnitId = loadReportAmountUnit(DEFAULT_REPORT_AMOUNT_UNIT_ID);

  function getLiveWorkspacePreferences() {
    const loadedReportRange = loadReportRange(defaultReportRange);
    const safeReportRange =
      loadedReportRange && typeof loadedReportRange === "object"
        ? loadedReportRange
        : defaultReportRange;

    return {
      reportRange: safeReportRange,
      reportChartPaletteId: loadReportChartPalette(DEFAULT_REPORT_CHART_PALETTE_ID),
      reportChartDataLabelMode: loadReportChartDataLabelMode(DEFAULT_REPORT_CHART_DATA_LABEL_MODE),
      reportAmountUnitId: loadReportAmountUnit(DEFAULT_REPORT_AMOUNT_UNIT_ID),
    };
  }

  const initialLivePreferences = getLiveWorkspacePreferences();

  const dom = {
    workspaceGrid: document.querySelector(".workspace-grid"),
    workspaceModeBannerEl: document.getElementById("workspace-mode-banner"),
    workspaceModeBannerTitleEl: document.getElementById("workspace-mode-banner-title"),
    workspaceModeBannerDescEl: document.getElementById("workspace-mode-banner-desc"),

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
    targetMetricAmountBtn: document.getElementById("target-metric-amount-btn"),
    targetMetricQuantityBtn: document.getElementById("target-metric-quantity-btn"),
    targetMetricTipEl: document.getElementById("target-metric-tip"),
    targetStatusEl: document.getElementById("target-status"),
    targetErrorEl: document.getElementById("target-error"),
    targetClearPageBtn: document.getElementById("target-clear-page-btn"),
    targetQuarterHeaderEl: document.getElementById("target-quarter-header"),
    targetMonthSumHeaderEl: document.getElementById("target-month-sum-header"),
    targetInputBody: document.getElementById("target-input-body"),
    targetProductAllocTitleEl: document.getElementById("target-product-alloc-title"),
    targetProductAllocClearPageBtn: document.getElementById("target-product-alloc-clear-page-btn"),
    targetProductAllocSummaryEl: document.getElementById("target-product-alloc-summary"),
    targetProductAllocHintEl: document.getElementById("target-product-alloc-hint"),
    targetProductAllocBody: document.getElementById("target-product-alloc-body"),

    reportStartMonthInput: document.getElementById("report-start-month"),
    reportStartYearSelect: document.getElementById("report-start-year-select"),
    reportStartMonthSelect: document.getElementById("report-start-month-select"),
    reportEndMonthInput: document.getElementById("report-end-month"),
    reportEndYearSelect: document.getElementById("report-end-year-select"),
    reportEndMonthSelect: document.getElementById("report-end-month-select"),
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
    heroRecordsCountEl: document.getElementById("hero-records-count"),
    heroReportRangeEl: document.getElementById("hero-report-range"),
    heroAchievementValueEl: document.getElementById("hero-achievement-value"),
    heroAchievementCaptionEl: document.getElementById("hero-achievement-caption"),
    heroAchievementProgressEl: document.getElementById("hero-achievement-progress"),
    heroAchievementProgressFillEl: document.getElementById("hero-achievement-progress-fill"),
    heroStatusLineEl: document.getElementById("hero-status-line"),
  };

  dom.workspaceDetails = [
    document.getElementById("report-analysis-card"),
    document.getElementById("report-visual-board"),
    document.getElementById("sales-entry-card"),
    document.getElementById("product-config-card"),
    document.getElementById("target-entry-card"),
    document.getElementById("records-list-card"),
  ].filter((item) => item instanceof HTMLDetailsElement);
  dom.workspaceControls =
    dom.workspaceGrid instanceof HTMLElement
      ? Array.from(dom.workspaceGrid.querySelectorAll("input, select, button, textarea"))
      : [];
  dom.workspaceInteractiveControls = [
    dom.reportChartPaletteSelect,
    dom.reportChartDataLabelModeSelect,
    dom.hospitalTrendSelect,
    ...(typeof document !== "undefined"
      ? Array.from(document.querySelectorAll('[data-report-chart-metric-btn="true"]'))
      : []),
  ].filter((item, index, list) => item instanceof HTMLElement && list.indexOf(item) === index);
  dom.workspaceLockedControls = dom.workspaceControls.filter((control) => !dom.workspaceInteractiveControls.includes(control));

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
    deferInitialCloudLoad: true,
    recordFilters: defaultRecordFilters(),
    isMultiSelectMode: false,
    selectedRecordIds: new Set(),
    sortField: "",
    sortDirection: "",

    activeTargetYear: getCurrentTargetYear(),
    activeTargetMetric: "amount",
    targetSaveTimer: null,
    targetInputFormatError: "",
    targetProductAllocationFormatError: "",
    targetSyncError: "",

    reportStartYm: initialLivePreferences.reportRange.startYm,
    reportEndYm: initialLivePreferences.reportRange.endYm,
    reportRangeError: "",
    reportChartPaletteId: initialReportChartPaletteId,
    reportChartDataLabelMode: initialReportChartDataLabelMode,
    reportAmountUnitId: initialReportAmountUnitId,
    reportTargetChartMetrics: {
      "monthly-trend": "amount",
      "quarterly-trend": "amount",
      "product-performance": "amount",
    },
    activeHospitalChartKey: "",
    isDemoMode: false,
    isWorkspaceReadOnly: false,
    workspaceBanner: null,
  };

  let listStatusTimer = null;
  let currentReportSummary = null;
  let workspaceLoadToken = 0;

  function populateSelectOptions(selectEl, options, placeholder) {
    if (!(selectEl instanceof HTMLSelectElement)) {
      return;
    }

    const currentValue = String(selectEl.value || "").trim();
    const nextOptions = [`<option value="">${escapeHtml(placeholder)}</option>`]
      .concat(options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`))
      .join("");
    selectEl.innerHTML = nextOptions;
    selectEl.value = options.includes(currentValue) ? currentValue : "";
  }

  function renderReportRangeSelectOptions(domRef, stateRef) {
    const years = getReportRangeControlYears(stateRef.reportStartYm, stateRef.reportEndYm);
    const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

    populateSelectOptions(domRef.reportStartYearSelect, years, "年份");
    populateSelectOptions(domRef.reportEndYearSelect, years, "年份");
    populateSelectOptions(domRef.reportStartMonthSelect, months, "月份");
    populateSelectOptions(domRef.reportEndMonthSelect, months, "月份");
  }

  function hydrateReportRangeInputs(domRef, stateRef) {
    const startInput = domRef.reportStartMonthInput instanceof HTMLInputElement ? domRef.reportStartMonthInput : null;
    const endInput = domRef.reportEndMonthInput instanceof HTMLInputElement ? domRef.reportEndMonthInput : null;
    const startParts = parseReportYmParts(stateRef.reportStartYm);
    const endParts = parseReportYmParts(stateRef.reportEndYm);

    renderReportRangeSelectOptions(domRef, stateRef);

    if (startInput) {
      startInput.value = String(stateRef.reportStartYm || "").trim();
    }
    if (endInput) {
      endInput.value = String(stateRef.reportEndYm || "").trim();
    }
    if (domRef.reportStartYearSelect instanceof HTMLSelectElement) {
      domRef.reportStartYearSelect.value = startParts.year;
    }
    if (domRef.reportStartMonthSelect instanceof HTMLSelectElement) {
      domRef.reportStartMonthSelect.value = startParts.month;
    }
    if (domRef.reportEndYearSelect instanceof HTMLSelectElement) {
      domRef.reportEndYearSelect.value = endParts.year;
    }
    if (domRef.reportEndMonthSelect instanceof HTMLSelectElement) {
      domRef.reportEndMonthSelect.value = endParts.month;
    }
  }

  function formatHeroAchievementValue(value) {
    if (!Number.isFinite(value)) return "--";
    const percent = Number((value * 100).toFixed(1));
    return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
  }

  function resolveHeroAchievementMeta(snapshot) {
    const amountAchievementRatio = Number.isFinite(snapshot?.rangeAmountAchievement) ? snapshot.rangeAmountAchievement : null;
    if (amountAchievementRatio !== null) {
      return {
        ratio: amountAchievementRatio,
        metric: "amount",
        metricLabel: "金额",
      };
    }

    const quantityAchievementRatio = Number.isFinite(snapshot?.rangeQuantityAchievement) ? snapshot.rangeQuantityAchievement : null;
    if (quantityAchievementRatio !== null) {
      return {
        ratio: quantityAchievementRatio,
        metric: "quantity",
        metricLabel: "数量",
      };
    }

    return {
      ratio: null,
      metric: "none",
      metricLabel: "",
    };
  }

  function updateHeroOverview(reportSummary = currentReportSummary) {
    const reportRange =
      state.reportStartYm && state.reportEndYm ? `${state.reportStartYm} - ${state.reportEndYm}` : "未设置分析区间";
    const snapshot = reportSummary && typeof reportSummary === "object" ? reportSummary.snapshot : null;
    const reason = reportSummary && typeof reportSummary === "object" ? String(reportSummary.reason || "") : "";
    const recordsCount = Number.isFinite(snapshot?.rangeRecordCount) ? snapshot.rangeRecordCount : 0;
    const achievementMeta = resolveHeroAchievementMeta(snapshot);
    const achievementRatio = achievementMeta.ratio;
    const isOverTarget = Number.isFinite(achievementRatio) && achievementRatio > 1;
    const progressPercent = Number.isFinite(achievementRatio) ? Math.max(0, Math.min(achievementRatio * 100, 100)) : 0;

    if (dom.heroRecordsCountEl instanceof HTMLElement) {
      dom.heroRecordsCountEl.textContent = String(recordsCount);
    }

    if (dom.heroReportRangeEl instanceof HTMLElement) {
      dom.heroReportRangeEl.textContent = reportRange;
    }

    if (dom.heroAchievementValueEl instanceof HTMLElement) {
      dom.heroAchievementValueEl.textContent = formatHeroAchievementValue(achievementRatio);
    }

    if (dom.heroAchievementCaptionEl instanceof HTMLElement) {
      if (!state.reportStartYm || !state.reportEndYm || reason === "invalid-range") {
        dom.heroAchievementCaptionEl.textContent = "设置有效的报表区间后，这里会显示当前区间达成率";
      } else if (reason === "no-records") {
        dom.heroAchievementCaptionEl.textContent = state.isDemoMode
          ? "演示区间已预置模拟记录，登录后会切换成你的真实达成率"
          : "当前区间暂无销售记录，达成率将在录入后自动计算";
      } else if (!Number.isFinite(achievementRatio)) {
        dom.heroAchievementCaptionEl.textContent = "当前区间缺少有效金额/数量指标，暂无法计算达成率";
      } else {
        dom.heroAchievementCaptionEl.textContent = `按当前报表区间的销售${achievementMeta.metricLabel} / 指标${achievementMeta.metricLabel}计算`;
      }
    }

    if (dom.heroAchievementProgressEl instanceof HTMLElement) {
      dom.heroAchievementProgressEl.classList.toggle("is-empty", !Number.isFinite(achievementRatio));
      dom.heroAchievementProgressEl.classList.toggle("is-over-target", isOverTarget);
    }

    if (dom.heroAchievementProgressFillEl instanceof HTMLElement) {
      dom.heroAchievementProgressFillEl.style.width = `${progressPercent}%`;
    }

    if (dom.heroStatusLineEl instanceof HTMLElement) {
      if (!state.reportStartYm || !state.reportEndYm) {
        dom.heroStatusLineEl.textContent = "先设置报表区间，这里会同步显示当前区间的记录数和达成进度。";
        return;
      }

      if (reason === "invalid-range") {
        dom.heroStatusLineEl.textContent = "当前分析区间无效，请重新选择开始和结束月份。";
        return;
      }

      if (reason === "no-records") {
        dom.heroStatusLineEl.textContent = state.isDemoMode
          ? "当前为演示模式，登录后可在录入区写入并查看你自己的经营数据。"
          : "当前区间暂无销售记录，可先到录入区补录后再看达成进度。";
        return;
      }

      if (!Number.isFinite(achievementRatio)) {
        dom.heroStatusLineEl.textContent = `当前区间已同步 ${recordsCount} 条记录，但缺少有效金额/数量指标，暂不显示达成率。`;
        return;
      }

      if (Number.isFinite(achievementRatio) && isOverTarget) {
        dom.heroStatusLineEl.textContent = `当前区间已同步 ${recordsCount} 条记录，${achievementMeta.metricLabel}达成率 ${formatHeroAchievementValue(achievementRatio)}，进度条按 100% 封顶显示。`;
        return;
      }

      if (Number.isFinite(achievementRatio)) {
        dom.heroStatusLineEl.textContent = `当前区间已同步 ${recordsCount} 条记录，当前${achievementMeta.metricLabel}达成 ${formatHeroAchievementValue(achievementRatio)}。`;
        return;
      }

      dom.heroStatusLineEl.textContent = "当前区间已有记录，达成率将在有效指标生效后显示。";
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
  deps.onReportSummaryChange = (summary) => {
    currentReportSummary = summary && typeof summary === "object" ? summary : null;
    updateHeroOverview(currentReportSummary);
  };

  const originalRenderProductMaster = deps.renderProductMaster;
  deps.renderProductMaster = () => {
    originalRenderProductMaster();
    updateHeroOverview();
  };

  const originalRenderRecords = deps.renderRecords;
  deps.renderRecords = () => {
    originalRenderRecords();
    updateHeroOverview();
  };

  const originalRenderTargets = deps.renderTargets;
  deps.renderTargets = () => {
    originalRenderTargets();
    updateHeroOverview();
  };

  const originalRenderReports = deps.renderReports;
  deps.renderReports = () => {
    originalRenderReports();
    updateHeroOverview();
  };

  const requestAiChatReply = createChatReplyRequester({
    getAccessToken: () => getSupabaseSessionAccessToken({ getSupabaseClient }),
    getBusinessSnapshot: () =>
      buildBusinessSnapshotPayload(state, {
        formatMoney,
        isValidDateParts,
        normalizeText,
        roundMoney,
        getEffectiveMonthlyTargetMap: (year, metric) => deps.getEffectiveMonthlyTargetMap(year, metric),
        getProductMonthlyAllocationMap: (year, metric) => deps.getProductMonthlyAllocationMap(year, metric),
      }),
    fetchImpl: (...args) => fetch(...args),
  });

  const aiChatApi = window.__SALES_TOOL_AI_CHAT__;
  if (aiChatApi && typeof aiChatApi.setSendHandler === "function") {
    aiChatApi.setSendHandler((message, options) => requestAiChatReply(message, options));
  } else {
    console.warn("[Sales Tool] 未检测到 AI Chat UI 桥接对象。");
  }

  function resetWorkspaceEphemeralState() {
    if (state.targetSaveTimer) {
      clearTimeout(state.targetSaveTimer);
      state.targetSaveTimer = null;
    }

    state.editingProductId = "";
    state.editingRowId = "";
    state.importResult = null;
    state.currentPage = 1;
    state.pageSize = DEFAULT_PAGE_SIZE;
    state.recordListTotal = 0;
    state.recordsInitialLoadDone = false;
    state.recordFilters = defaultRecordFilters();
    state.isMultiSelectMode = false;
    state.selectedRecordIds.clear();
    state.sortField = "";
    state.sortDirection = "";
    state.targetInputFormatError = "";
    state.targetProductAllocationFormatError = "";
    state.targetSyncError = "";
    state.reportRangeError = "";
    state.activeHospitalChartKey = "";
    currentReportSummary = null;

    clearProductError();
    clearSalesError();
    clearSalesTip();
    clearListError();
    clearListStatus();
    clearImportResult(state, dom, deps);

    if (dom.recordFilterStartDateInput instanceof HTMLInputElement) {
      dom.recordFilterStartDateInput.value = "";
    }
    if (dom.recordFilterEndDateInput instanceof HTMLInputElement) {
      dom.recordFilterEndDateInput.value = "";
    }
    if (dom.recordFilterProductKeywordInput instanceof HTMLInputElement) {
      dom.recordFilterProductKeywordInput.value = "";
    }
    if (dom.recordFilterHospitalKeywordInput instanceof HTMLInputElement) {
      dom.recordFilterHospitalKeywordInput.value = "";
    }
    if (dom.pageSizeSelect instanceof HTMLSelectElement) {
      dom.pageSizeSelect.value = String(state.pageSize);
    }
  }

  function applyLiveWorkspacePreferences() {
    const preferences = getLiveWorkspacePreferences();
    state.reportStartYm = preferences.reportRange.startYm;
    state.reportEndYm = preferences.reportRange.endYm;
    state.reportChartPaletteId = preferences.reportChartPaletteId;
    state.reportChartDataLabelMode = preferences.reportChartDataLabelMode;
    state.reportAmountUnitId = preferences.reportAmountUnitId;
  }

  function applySalesDraftToDom(draft) {
    const safeDraft = draft && typeof draft === "object" ? draft : {};
    if (dom.dateInput instanceof HTMLInputElement) {
      dom.dateInput.value = String(safeDraft.date || "");
    }
    if (dom.productSelect instanceof HTMLSelectElement) {
      dom.productSelect.value = String(safeDraft.productId || "");
    }
    if (dom.hospitalInput instanceof HTMLInputElement) {
      dom.hospitalInput.value = String(safeDraft.hospital || "");
    }
    if (dom.quantityInput instanceof HTMLInputElement) {
      dom.quantityInput.value = String(safeDraft.quantity || "");
    }
    if (dom.deliveryInput instanceof HTMLInputElement) {
      dom.deliveryInput.value = String(safeDraft.delivery || "");
    }
    deps.updateComputedAmount();
  }

  function applyProductDraftToDom(draft) {
    const safeDraft = draft && typeof draft === "object" ? draft : {};
    if (dom.productNameInput instanceof HTMLInputElement) {
      dom.productNameInput.value = String(safeDraft.productName || "");
    }
    if (dom.unitPriceInput instanceof HTMLInputElement) {
      dom.unitPriceInput.value = String(safeDraft.unitPrice || "");
    }
  }

  function renderWorkspace({ salesDraft = null, productDraft = null } = {}) {
    if (dom.pageSizeSelect instanceof HTMLSelectElement) {
      dom.pageSizeSelect.value = String(state.pageSize);
    }

    hydrateReportRangeInputs(dom, state);
    deps.renderProductMaster();
    deps.renderProductSelectOptions();
    deps.updateSalesFormAvailability();
    applySalesDraftToDom(salesDraft);
    applyProductDraftToDom(productDraft);
    clearImportResult(state, dom, deps);
    ensureYearTargets(state, state.activeTargetYear, deps);
    deps.renderTargets();
    deps.renderReports();
    deps.renderRecords();
    updateHeroOverview();
  }

  async function fetchLiveRecordPage() {
    let result = await recordsRepository.fetchRecordsPageFromCloud({
      page: state.currentPage,
      pageSize: state.pageSize,
      sortField: state.sortField,
      sortDirection: state.sortDirection,
      filters: state.recordFilters,
    });

    let items = Array.isArray(result?.items) ? result.items : [];
    let total = Number(result?.total);
    total = Number.isInteger(total) && total >= 0 ? total : items.length;

    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (total > 0 && state.currentPage > totalPages) {
      state.currentPage = totalPages;
      result = await recordsRepository.fetchRecordsPageFromCloud({
        page: state.currentPage,
        pageSize: state.pageSize,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
        filters: state.recordFilters,
      });
      items = Array.isArray(result?.items) ? result.items : [];
      total = Number(result?.total);
      total = Number.isInteger(total) && total >= 0 ? total : items.length;
    }

    return { items, total };
  }

  function applyWorkspaceSnapshot(snapshot, { isDemoMode, isWorkspaceReadOnly }) {
    resetWorkspaceEphemeralState();

    state.products = Array.isArray(snapshot?.products) ? snapshot.products.map((item) => ({ ...item })) : [];
    state.targets = snapshot?.targets && typeof snapshot.targets === "object" ? snapshot.targets : createDefaultTargetsPayload();
    state.records = Array.isArray(snapshot?.records) ? snapshot.records.map((item) => ({ ...item })) : [];
    state.reportRecords = Array.isArray(snapshot?.reportRecords)
      ? snapshot.reportRecords.map((item) => ({ ...item }))
      : state.records.map((item) => ({ ...item }));
    state.recordListItems = Array.isArray(snapshot?.recordListItems)
      ? snapshot.recordListItems.map((item) => ({ ...item }))
      : state.records.map((item) => ({ ...item }));
    state.recordListTotal = Number.isInteger(Number(snapshot?.recordListTotal))
      ? Number(snapshot.recordListTotal)
      : state.recordListItems.length;
    state.recordsInitialLoadDone = !isDemoMode;
    state.activeTargetYear = Number.isInteger(Number(snapshot?.activeTargetYear))
      ? Number(snapshot.activeTargetYear)
      : getCurrentTargetYear();
    state.activeTargetMetric = String(snapshot?.activeTargetMetric || "amount").trim() === "quantity" ? "quantity" : "amount";
    state.workspaceBanner = snapshot?.banner && typeof snapshot.banner === "object" ? snapshot.banner : null;
    state.isDemoMode = isDemoMode;
    state.isWorkspaceReadOnly = isWorkspaceReadOnly;

    if (snapshot?.reportRange && typeof snapshot.reportRange === "object") {
      state.reportStartYm = String(snapshot.reportRange.startYm || "").trim();
      state.reportEndYm = String(snapshot.reportRange.endYm || "").trim();
    }

    if (!isWorkspaceReadOnly) {
      applyWorkspaceReadOnlyState(dom, state);
    }

    renderWorkspace({
      salesDraft: snapshot?.salesDraft || (isDemoMode ? null : loadSalesDraft()),
      productDraft: snapshot?.productDraft || null,
    });

    if (isWorkspaceReadOnly) {
      applyWorkspaceReadOnlyState(dom, state);
    }
  }

  async function loadDemoWorkspace() {
    workspaceLoadToken += 1;
    const demoSnapshot = createDemoWorkspaceSnapshot(new Date());
    state.deferInitialCloudLoad = true;
    applyWorkspaceSnapshot(demoSnapshot, {
      isDemoMode: true,
      isWorkspaceReadOnly: true,
    });
    showSalesTip("当前为演示工作台，登录后才能新增或修改数据。");
  }

  async function loadLiveWorkspace({ showStatus = true } = {}) {
    const currentToken = workspaceLoadToken + 1;
    workspaceLoadToken = currentToken;
    state.deferInitialCloudLoad = true;

    resetWorkspaceEphemeralState();
    applyLiveWorkspacePreferences();
    state.isDemoMode = false;
    state.isWorkspaceReadOnly = false;
    state.workspaceBanner = null;
    applyWorkspaceReadOnlyState(dom, state);

    if (showStatus) {
      showListStatus("正在同步云端数据...", "syncing");
    }

    let nextProducts = [];
    let nextTargets = createDefaultTargetsPayload();
    let nextRecordPage = { items: [], total: 0 };
    let nextReportRecords = [];
    let productLoadError = "";
    let targetLoadError = "";
    let hasListFailure = false;
    let hasReportFailure = false;

    try {
      nextProducts = await productsRepository.fetchProductsFromCloud();
      clearProductError();
    } catch (error) {
      productLoadError = `产品加载失败：${error instanceof Error ? error.message : "请稍后重试"}`;
      console.error("[Sales Tool] 云端产品读取失败。", error);
    }

    try {
      nextTargets = await targetsRepository.fetchTargetsFromCloud();
      state.targetSyncError = "";
    } catch (error) {
      nextTargets = createDefaultTargetsPayload();
      targetLoadError = `指标加载失败：${error instanceof Error ? error.message : "请稍后重试"}`;
      console.error("[Sales Tool] 指标加载失败。", error);
    }

    state.products = nextProducts;

    try {
      nextRecordPage = await fetchLiveRecordPage();
      clearListError();
    } catch (error) {
      hasListFailure = true;
      showListError("列表加载失败，请稍后重试。");
      console.error("[Sales Tool] 列表加载失败。", error);
    }

    try {
      const cloudRecords = await recordsRepository.fetchAllRecordsFromCloud();
      nextReportRecords = Array.isArray(cloudRecords) ? cloudRecords : [];
    } catch (error) {
      hasReportFailure = true;
      nextReportRecords = [];
      console.error("[Sales Tool] 报表记录同步失败。", error);
    }

    if (currentToken !== workspaceLoadToken) {
      return;
    }

    applyWorkspaceSnapshot(
      {
        products: nextProducts,
        targets: nextTargets,
        records: nextReportRecords,
        reportRecords: nextReportRecords,
        recordListItems: nextRecordPage.items,
        recordListTotal: nextRecordPage.total,
        activeTargetYear: state.activeTargetYear,
        activeTargetMetric: state.activeTargetMetric,
        reportRange: {
          startYm: state.reportStartYm,
          endYm: state.reportEndYm,
        },
      },
      {
        isDemoMode: false,
        isWorkspaceReadOnly: false,
      },
    );

    state.recordsInitialLoadDone = true;
    state.targetSyncError = targetLoadError;
    if (targetLoadError) {
      deps.renderTargets();
    }
    if (productLoadError) {
      showProductError(productLoadError);
    }

    if (showStatus) {
      if (!hasListFailure && !hasReportFailure) {
        showListStatus(`同步完成，当前共 ${state.recordListTotal} 条记录。`, "success");
      } else if (hasListFailure) {
        showListError("列表加载失败，请稍后重试。");
      } else {
        showListStatus("列表已同步，报表稍后可重试刷新。", "muted");
      }
    }
  }

  if (dom.pageSizeSelect instanceof HTMLSelectElement) {
    dom.pageSizeSelect.value = String(state.pageSize);
  }
  hydrateReportRangeInputs(dom, state);
  updateHeroOverview();
  bindHeroCardNavigation();
  bindWorkspaceReadOnlyGuards(dom.workspaceDetails, () => state.isWorkspaceReadOnly);

  const syncHeroOverviewFromReportControls = () => {
    updateHeroOverview();
  };

  if (dom.reportStartMonthInput instanceof HTMLInputElement) {
    dom.reportStartMonthInput.addEventListener("input", syncHeroOverviewFromReportControls);
    dom.reportStartMonthInput.addEventListener("change", syncHeroOverviewFromReportControls);
  }

  const syncReportRangeFromStartSelects = () => {
    if (!(dom.reportStartMonthInput instanceof HTMLInputElement)) {
      return;
    }
    dom.reportStartMonthInput.value = buildYmFromParts(
      dom.reportStartYearSelect instanceof HTMLSelectElement ? dom.reportStartYearSelect.value : "",
      dom.reportStartMonthSelect instanceof HTMLSelectElement ? dom.reportStartMonthSelect.value : "",
    );
    syncHeroOverviewFromReportControls();
  };

  if (dom.reportStartYearSelect instanceof HTMLSelectElement) {
    dom.reportStartYearSelect.addEventListener("change", syncReportRangeFromStartSelects);
  }

  if (dom.reportStartMonthSelect instanceof HTMLSelectElement) {
    dom.reportStartMonthSelect.addEventListener("change", syncReportRangeFromStartSelects);
  }

  if (dom.reportEndMonthInput instanceof HTMLInputElement) {
    dom.reportEndMonthInput.addEventListener("input", syncHeroOverviewFromReportControls);
    dom.reportEndMonthInput.addEventListener("change", syncHeroOverviewFromReportControls);
  }

  const syncReportRangeFromEndSelects = () => {
    if (!(dom.reportEndMonthInput instanceof HTMLInputElement)) {
      return;
    }
    dom.reportEndMonthInput.value = buildYmFromParts(
      dom.reportEndYearSelect instanceof HTMLSelectElement ? dom.reportEndYearSelect.value : "",
      dom.reportEndMonthSelect instanceof HTMLSelectElement ? dom.reportEndMonthSelect.value : "",
    );
    syncHeroOverviewFromReportControls();
  };

  if (dom.reportEndYearSelect instanceof HTMLSelectElement) {
    dom.reportEndYearSelect.addEventListener("change", syncReportRangeFromEndSelects);
  }

  if (dom.reportEndMonthSelect instanceof HTMLSelectElement) {
    dom.reportEndMonthSelect.addEventListener("change", syncReportRangeFromEndSelects);
  }

  bindTargetInputEvents(state, dom, deps);
  bindReportEvents(state, dom, deps);
  bindProductEvents(state, dom, deps);
  bindRecordEvents(state, dom, deps);

  if (initialUser?.id) {
    await loadLiveWorkspace({ showStatus: true });
  } else {
    await loadDemoWorkspace();
  }

  return {
    async handleSignedIn() {
      await loadLiveWorkspace({ showStatus: true });
    },
    async handleSignedOut() {
      await loadDemoWorkspace();
    },
  };
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
    bindHeroCardNavigation();

    let appRuntime = null;
    const initialUser = await bootstrapAuthGate({
      appRoot: document.querySelector(".workspace-grid"),
      callbacks: {
        onSignedIn(user) {
          if (!appRuntime) {
            return;
          }
          void runReadOnlyRecordsCountCheck({ getAuthContext });
          void appRuntime.handleSignedIn(user);
        },
        onSignedOut() {
          if (!appRuntime) {
            return;
          }
          void appRuntime.handleSignedOut();
        },
      },
    });

    attachSmokeWriteTool({ getAuthContext });
    appRuntime = await initializeApp(initialUser);
    if (initialUser?.id) {
      await runReadOnlyRecordsCountCheck({ getAuthContext });
    }
    window.__SALES_TOOL_MODULE_BOOTED__ = true;
  } catch (error) {
    showInitError(error);
  }
}

void bootstrap();
