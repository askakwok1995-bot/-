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
import {
  buildAnalysisContext,
  getKpiOverview,
  getTrendInsights,
  getProductInsights,
  getHospitalInsights,
  getRiskAlerts,
  buildBriefingOutline,
} from "./analytics-engine.js";
import { bootstrapAuthGate, getCurrentAuthUser, getSupabaseClient } from "./auth.js";
import { initAiChatUi } from "./ai-chat-ui.js";

window.__SALES_TOOL_MODULE_BOOTED__ = false;
window.__SALES_TOOL_MODULE_BOOT_ERROR__ = false;

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
  let listStatusTimer = null;

  function mapCloudProductToLocal(row) {
    if (!row || typeof row !== "object") {
      return null;
    }

    const id = String(row.id || "").trim();
    const productName = String(row.product_name || "").trim();
    const unitPrice = roundMoney(Number(row.unit_price));

    if (!id || !productName || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return null;
    }

    return {
      id,
      productName,
      unitPrice,
    };
  }

  function mapCloudRecordToLocal(row) {
    if (!row || typeof row !== "object") {
      return null;
    }

    const id = String(row.id || "").trim();
    const date = String(row.record_date || "").trim();
    const hospital = String(row.hospital_name || "").trim();
    const productName = String(row.product_name || "").trim();
    const quantity = Number(row.purchase_quantity_boxes);
    const amount = Number(row.assessed_amount);
    const channel = String(row.channel || "").trim();
    const delivery = channel || "未填写";

    if (!id || !date || !hospital || !productName) {
      return null;
    }

    if (!Number.isInteger(quantity) || quantity === 0) {
      return null;
    }

    if (!Number.isFinite(amount)) {
      return null;
    }

    const matchedProduct = state.products.find((item) => normalizeText(item.productName) === normalizeText(productName));

    return {
      id,
      date,
      productId: matchedProduct ? matchedProduct.id : "",
      productName,
      unitPriceSnapshot: matchedProduct ? roundMoney(matchedProduct.unitPrice) : null,
      hospital,
      quantity,
      amount: roundMoney(amount),
      delivery,
    };
  }

  async function fetchProductsFromCloud() {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    if (!client || !user?.id) {
      return [];
    }

    const { data, error } = await client
      .from("products")
      .select("id,product_name,unit_price,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return Array.isArray(data) ? data.map((item) => mapCloudProductToLocal(item)).filter((item) => item !== null) : [];
  }

  async function insertProductToCloud(payload) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法写入产品。");
    }

    const product = {
      id: String(payload?.id || "").trim(),
      productName: String(payload?.productName || "").trim(),
      unitPrice: roundMoney(Number(payload?.unitPrice)),
    };

    if (!product.id || !product.productName || !Number.isFinite(product.unitPrice) || product.unitPrice < 0) {
      throw new Error("产品数据格式不正确。");
    }

    const { data, error } = await client
      .from("products")
      .insert({
        id: product.id,
        user_id: user.id,
        product_name: product.productName,
        unit_price: product.unitPrice,
      })
      .select("id,product_name,unit_price,created_at")
      .single();

    if (error) {
      throw error;
    }

    const mapped = mapCloudProductToLocal(data);
    if (!mapped) {
      throw new Error("产品写入成功，但返回数据格式异常。");
    }

    return mapped;
  }

  async function updateProductInCloud(productId, payload) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    const normalizedId = String(productId || "").trim();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法更新产品。");
    }
    if (!normalizedId) {
      throw new Error("产品 ID 不能为空。");
    }

    const nextProductName = String(payload?.productName || "").trim();
    const nextUnitPrice = roundMoney(Number(payload?.unitPrice));
    if (!nextProductName || !Number.isFinite(nextUnitPrice) || nextUnitPrice < 0) {
      throw new Error("产品更新参数不正确。");
    }

    const { data, error } = await client
      .from("products")
      .update({
        product_name: nextProductName,
        unit_price: nextUnitPrice,
      })
      .eq("user_id", user.id)
      .eq("id", normalizedId)
      .select("id,product_name,unit_price,created_at");

    if (error) {
      throw error;
    }

    const updatedCount = Array.isArray(data) ? data.length : 0;
    return { updatedCount };
  }

  async function deleteProductFromCloud(productId) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    const normalizedId = String(productId || "").trim();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法删除产品。");
    }
    if (!normalizedId) {
      return { deletedCount: 0 };
    }

    const { data, error } = await client
      .from("products")
      .delete()
      .eq("user_id", user.id)
      .eq("id", normalizedId)
      .select("id");

    if (error) {
      throw error;
    }

    const deletedCount = Array.isArray(data) ? data.length : 0;
    return { deletedCount };
  }

  async function repriceRecordsByProductName(oldProductName, newUnitPrice) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法同步历史记录金额。");
    }

    const normalizedName = normalizeText(oldProductName);
    const safeUnitPrice = roundMoney(Number(newUnitPrice));
    if (!normalizedName || !Number.isFinite(safeUnitPrice) || safeUnitPrice < 0) {
      return { updatedCount: 0 };
    }

    const { data, error } = await client
      .from("sales_records")
      .select("id,product_name,purchase_quantity_boxes")
      .eq("user_id", user.id);

    if (error) {
      throw error;
    }

    const targetRows = Array.isArray(data)
      ? data.filter((row) => normalizeText(row?.product_name) === normalizedName)
      : [];

    if (targetRows.length === 0) {
      return { updatedCount: 0 };
    }

    const updateResults = await Promise.all(
      targetRows.map(async (row) => {
        const quantity = Number(row?.purchase_quantity_boxes);
        if (!Number.isInteger(quantity) || quantity === 0) {
          return null;
        }

        const amount = roundMoney(safeUnitPrice * quantity);
        const { data: updatedData, error: updateError } = await client
          .from("sales_records")
          .update({ assessed_amount: amount })
          .eq("user_id", user.id)
          .eq("id", String(row.id || "").trim())
          .select("id");

        if (updateError) {
          throw updateError;
        }

        return Array.isArray(updatedData) ? updatedData.length : 0;
      }),
    );

    const updatedCount = updateResults.reduce((sum, count) => sum + (Number(count) || 0), 0);
    return { updatedCount };
  }

  async function persistProductsSnapshotToCloud(productsSnapshot) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法同步产品。");
    }

    const uniqueProducts = new Map();
    for (const item of Array.isArray(productsSnapshot) ? productsSnapshot : []) {
      const id = String(item?.id || "").trim();
      const productName = String(item?.productName || "").trim();
      const unitPrice = roundMoney(Number(item?.unitPrice));
      if (!id || !productName || !Number.isFinite(unitPrice) || unitPrice < 0) {
        continue;
      }
      if (!uniqueProducts.has(id)) {
        uniqueProducts.set(id, { id, productName, unitPrice });
      }
    }

    const payload = Array.from(uniqueProducts.values()).map((product) => ({
      id: product.id,
      user_id: user.id,
      product_name: product.productName,
      unit_price: product.unitPrice,
    }));

    if (payload.length > 0) {
      const { error: upsertError } = await client.from("products").upsert(payload, { onConflict: "id" });
      if (upsertError) {
        throw upsertError;
      }
    }
  }

  async function checkProductUsageInCloud(productName) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    const safeProductName = String(productName || "").trim();
    if (!client || !user?.id || !safeProductName) {
      return false;
    }

    const { count, error } = await client
      .from("sales_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("product_name", safeProductName);
    if (error) {
      throw error;
    }
    return Number(count) > 0;
  }

  const RECORD_SORT_FIELD_COLUMN_MAP = {
    date: "record_date",
    productName: "product_name",
    hospital: "hospital_name",
    quantity: "purchase_quantity_boxes",
    amount: "assessed_amount",
    delivery: "channel",
  };

  async function fetchRecordsPageFromCloud(query = {}) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    if (!client || !user?.id) {
      return { items: [], total: 0 };
    }

    const safePage = Number.isInteger(Number(query.page)) && Number(query.page) > 0 ? Number(query.page) : 1;
    const safePageSize =
      Number.isInteger(Number(query.pageSize)) && Number(query.pageSize) > 0 ? Number(query.pageSize) : DEFAULT_PAGE_SIZE;
    const safeSortField = String(query.sortField || "").trim();
    const safeSortDirection = String(query.sortDirection || "").trim() === "asc" ? "asc" : "desc";
    const filters = query && typeof query === "object" && query.filters && typeof query.filters === "object" ? query.filters : {};

    let request = client
      .from("sales_records")
      .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,created_at", {
        count: "exact",
      })
      .eq("user_id", user.id);

    const startDate = String(filters.startDate || "").trim();
    const endDate = String(filters.endDate || "").trim();
    const productKeyword = String(filters.productKeyword || "").trim();
    const hospitalKeyword = String(filters.hospitalKeyword || "").trim();

    if (startDate) {
      request = request.gte("record_date", startDate);
    }
    if (endDate) {
      request = request.lte("record_date", endDate);
    }
    if (productKeyword) {
      request = request.ilike("product_name", `%${productKeyword}%`);
    }
    if (hospitalKeyword) {
      request = request.ilike("hospital_name", `%${hospitalKeyword}%`);
    }

    const orderColumn = RECORD_SORT_FIELD_COLUMN_MAP[safeSortField];
    if (orderColumn) {
      request = request.order(orderColumn, { ascending: safeSortDirection === "asc" });
      request = request.order("created_at", { ascending: false });
    } else {
      request = request.order("record_date", { ascending: false });
      request = request.order("created_at", { ascending: false });
    }

    const from = (safePage - 1) * safePageSize;
    const to = from + safePageSize - 1;
    request = request.range(from, to);

    const { data, error, count } = await request;

    if (error) {
      throw error;
    }

    const items = Array.isArray(data) ? data.map((item) => mapCloudRecordToLocal(item)).filter((item) => item !== null) : [];
    const total = Number.isInteger(Number(count)) && Number(count) >= 0 ? Number(count) : items.length;

    return { items, total };
  }

  async function fetchAllRecordsFromCloud() {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    if (!client || !user?.id) {
      return [];
    }

    const { data, error } = await client
      .from("sales_records")
      .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,created_at")
      .eq("user_id", user.id)
      .order("record_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return Array.isArray(data) ? data.map((item) => mapCloudRecordToLocal(item)).filter((item) => item !== null) : [];
  }

  async function fetchRecordsFromCloud() {
    return fetchAllRecordsFromCloud();
  }

  async function insertRecordToCloud(payload) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法写入云端。");
    }

    const { data, error } = await client
      .from("sales_records")
      .insert({
        user_id: user.id,
        record_date: payload.date,
        hospital_name: payload.hospital,
        product_name: payload.productName,
        purchase_quantity_boxes: payload.quantity,
        assessed_amount: payload.amount,
        actual_amount: null,
        channel: payload.delivery || null,
        remark: null,
      })
      .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,created_at")
      .single();

    if (error) {
      throw error;
    }

    const mapped = mapCloudRecordToLocal(data);
    if (!mapped) {
      throw new Error("云端写入成功，但返回数据格式异常。");
    }

    return mapped;
  }

  async function insertRecordsBatchToCloud(payloads) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法批量写入云端。");
    }

    const sourceRows = Array.isArray(payloads) ? payloads : [];
    if (sourceRows.length === 0) {
      return { insertedCount: 0 };
    }

    const rows = sourceRows.map((payload) => ({
      user_id: user.id,
      record_date: payload.date,
      hospital_name: payload.hospital,
      product_name: payload.productName,
      purchase_quantity_boxes: payload.quantity,
      assessed_amount: payload.amount,
      actual_amount: null,
      channel: payload.delivery || null,
      remark: null,
    }));

    const { error } = await client.from("sales_records").insert(rows);
    if (error) {
      throw error;
    }

    return { insertedCount: rows.length };
  }

  async function deleteRecordFromCloud(recordId) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    const normalizedId = String(recordId || "").trim();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法删除云端记录。");
    }
    if (!normalizedId) {
      return { deletedIds: [] };
    }

    const { data, error } = await client
      .from("sales_records")
      .delete()
      .eq("user_id", user.id)
      .eq("id", normalizedId)
      .select("id");

    if (error) {
      throw error;
    }

    const deletedIds = Array.isArray(data) ? data.map((item) => String(item?.id || "").trim()).filter((id) => id) : [];
    return { deletedIds };
  }

  async function deleteRecordsFromCloud(recordIds) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法批量删除云端记录。");
    }

    const normalizedIds = Array.from(
      new Set((Array.isArray(recordIds) ? recordIds : []).map((id) => String(id || "").trim()).filter((id) => id)),
    );

    if (normalizedIds.length === 0) {
      return { deletedIds: [] };
    }

    const { data, error } = await client
      .from("sales_records")
      .delete()
      .eq("user_id", user.id)
      .in("id", normalizedIds)
      .select("id");

    if (error) {
      throw error;
    }

    const deletedIds = Array.isArray(data) ? data.map((item) => String(item?.id || "").trim()).filter((id) => id) : [];
    return { deletedIds };
  }

  async function deleteAllRecordsFromCloud() {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法清空云端记录。");
    }

    const { error } = await client.from("sales_records").delete().eq("user_id", user.id);
    if (error) {
      throw error;
    }
  }

  async function updateRecordInCloud(recordId, payload) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();
    const normalizedId = String(recordId || "").trim();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法更新云端记录。");
    }
    if (!normalizedId) {
      return { updatedCount: 0 };
    }

    const { data, error } = await client
      .from("sales_records")
      .update({
        record_date: payload.date,
        hospital_name: payload.hospital,
        product_name: payload.productName,
        purchase_quantity_boxes: payload.quantity,
        assessed_amount: payload.amount,
        channel: payload.delivery || null,
      })
      .eq("user_id", user.id)
      .eq("id", normalizedId)
      .select("id");

    if (error) {
      throw error;
    }

    const updatedCount = Array.isArray(data) ? data.length : 0;
    return { updatedCount };
  }

  async function fetchTargetsFromCloud() {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();

    if (!client || !user?.id) {
      return createDefaultTargetsPayload();
    }

    const { data, error } = await client
      .from("sales_targets")
      .select("target_year,version,metric_type,year_data,updated_at")
      .eq("user_id", user.id)
      .order("target_year", { ascending: false });

    if (error) {
      throw error;
    }

    const payload = createDefaultTargetsPayload();
    if (!Array.isArray(data)) {
      return payload;
    }

    for (const row of data) {
      const year = Number(row?.target_year);
      if (!Number.isInteger(year)) {
        continue;
      }

      const normalizedYearData = normalizeTargetYearData(
        year,
        row?.year_data && typeof row.year_data === "object" ? row.year_data : {},
      );
      if (typeof row?.updated_at === "string" && !Number.isNaN(Date.parse(row.updated_at))) {
        normalizedYearData.updatedAt = row.updated_at;
      }

      payload.years[String(year)] = normalizedYearData;

      const rowVersion = Number(row?.version);
      if (Number.isInteger(rowVersion) && rowVersion > 0) {
        payload.version = rowVersion;
      }

      const rowMetricType = String(row?.metric_type || "").trim();
      if (rowMetricType) {
        payload.metricType = rowMetricType;
      }
    }

    return payload;
  }

  async function persistTargetsToCloud(targetState) {
    const client = getSupabaseClient();
    const user = getCurrentAuthUser();

    if (!client || !user?.id) {
      throw new Error("未检测到登录用户，无法保存指标。");
    }

    const sourceTargets =
      targetState?.targets && typeof targetState.targets === "object"
        ? targetState.targets
        : createDefaultTargetsPayload();

    const sourceYears = sourceTargets.years && typeof sourceTargets.years === "object" ? sourceTargets.years : {};
    const rawVersion = Number(sourceTargets.version);
    const safeVersion = Number.isInteger(rawVersion) && rawVersion > 0 ? rawVersion : 1;
    const safeMetricType = String(sourceTargets.metricType || "").trim() || "amount";

    const rows = [];
    for (const [yearKey, yearData] of Object.entries(sourceYears)) {
      const year = Number(yearKey);
      if (!Number.isInteger(year)) {
        continue;
      }

      rows.push({
        user_id: user.id,
        target_year: year,
        version: safeVersion,
        metric_type: safeMetricType,
        year_data: normalizeTargetYearData(year, yearData),
      });
    }

    if (rows.length === 0) {
      return;
    }

    const { error } = await client.from("sales_targets").upsert(rows, { onConflict: "user_id,target_year" });
    if (error) {
      throw error;
    }
  }

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

    saveProducts: async (targetState = state) => {
      await persistProductsSnapshotToCloud(targetState.products);
    },
    saveRecords: () => {},
    saveTargets: (targetState = state) => {
      void persistTargetsToCloud(targetState)
        .then(() => {
          if (!state.targetSyncError) {
            return;
          }
          state.targetSyncError = "";
          if (typeof deps.renderTargets === "function") {
            deps.renderTargets();
          }
        })
        .catch((error) => {
          const message = error instanceof Error && error.message ? error.message : "请稍后重试";
          const nextError = `指标保存失败：${message}`;
          if (state.targetSyncError !== nextError) {
            state.targetSyncError = nextError;
            if (typeof deps.renderTargets === "function") {
              deps.renderTargets();
            }
          }
          console.error("[Sales Tool] 指标保存失败。", error);
        });
    },
    loadSalesDraft,
    saveSalesDraft,
    saveReportRange,
    saveReportChartPalette,
    saveReportChartDataLabelMode,
    saveReportAmountUnit,
    clearSalesDraft,
    fetchProductsFromCloud,
    insertProductToCloud,
    updateProductInCloud,
    deleteProductFromCloud,
    checkProductUsageInCloud,
    repriceRecordsByProductName,
    fetchRecordsPageFromCloud,
    fetchAllRecordsFromCloud,
    fetchRecordsFromCloud,
    insertRecordToCloud,
    insertRecordsBatchToCloud,
    deleteRecordFromCloud,
    deleteRecordsFromCloud,
    deleteAllRecordsFromCloud,
    updateRecordInCloud,
    getEffectiveMonthlyTargetMap: (year) => getEffectiveMonthlyTargetMap(state, year, deps),
    getProductMonthlyAllocationMap: (year) => getProductMonthlyAllocationMap(state, year, deps),

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
  };

  deps.validateSalesInput = (data, selectedProduct) => validateSalesInput(state, data, selectedProduct);
  deps.renderProductMaster = () => renderProductMaster(state, dom, deps);
  deps.renderProductSelectOptions = () => renderProductSelectOptions(state, dom, deps);
  deps.updateSalesFormAvailability = () => updateSalesFormAvailability(state, dom);
  deps.updateComputedAmount = () => updateComputedAmount(state, dom, deps);
  deps.renderRecords = () => renderRecords(state, dom, deps);
  deps.renderTargets = () => renderTargetInputSection(state, dom, deps);
  deps.renderReports = () => {
    const originalRecords = state.records;
    state.records = Array.isArray(state.reportRecords) ? state.reportRecords : [];
    try {
      renderReportSection(state, dom, deps);
    } finally {
      state.records = originalRecords;
    }
  };

  function buildAnalyticsContext(rangeOverride) {
    return buildAnalysisContext({
      state,
      deps,
      rangeOverride,
    });
  }

  window.__SALES_TOOL_ANALYTICS__ = {
    buildContext: (rangeOverride) => buildAnalyticsContext(rangeOverride),
    kpi: (rangeOverride) => getKpiOverview(buildAnalyticsContext(rangeOverride)),
    trends: (rangeOverride) => getTrendInsights(buildAnalyticsContext(rangeOverride)),
    products: (rangeOverride, options) => getProductInsights(buildAnalyticsContext(rangeOverride), options),
    hospitals: (rangeOverride, options) => getHospitalInsights(buildAnalyticsContext(rangeOverride), options),
    risks: (rangeOverride, options) => getRiskAlerts(buildAnalyticsContext(rangeOverride), options),
    outline: (rangeOverride) => buildBriefingOutline(buildAnalyticsContext(rangeOverride)),
  };

  function buildAiChatContextPayload(rangeOverride) {
    const analysisContext = buildAnalyticsContext(rangeOverride);
    return {
      analysis: {
        ok: analysisContext.ok,
        range: analysisContext.range,
        generatedAt: analysisContext.generatedAt,
        metricPriority: analysisContext.metricPriority,
        meta: analysisContext.meta,
      },
      kpi: getKpiOverview(analysisContext),
      trend: getTrendInsights(analysisContext),
      product: getProductInsights(analysisContext, { topN: 5 }),
      hospital: getHospitalInsights(analysisContext, { topN: 5 }),
      risk: getRiskAlerts(analysisContext),
      outline: buildBriefingOutline(analysisContext),
    };
  }

  async function parseJsonSafe(response) {
    try {
      return await response.json();
    } catch (_error) {
      return null;
    }
  }

  const CHAT_MODES = Object.freeze({
    BRIEFING: "briefing",
    DIAGNOSIS: "diagnosis",
    ACTION_PLAN: "action-plan",
  });

  function isValidChatMode(mode) {
    return mode === CHAT_MODES.BRIEFING || mode === CHAT_MODES.DIAGNOSIS || mode === CHAT_MODES.ACTION_PLAN;
  }

  function sanitizeChatMode(mode) {
    const candidate = String(mode || "").trim();
    return isValidChatMode(candidate) ? candidate : CHAT_MODES.BRIEFING;
  }

  const CHAT_API_ERROR_MESSAGE_MAP = Object.freeze({
    UNAUTHORIZED: "登录状态已失效，请重新登录后再试。",
    AUTH_CONFIG_MISSING: "服务端缺少 Supabase 校验配置（SUPABASE_URL/SUPABASE_ANON_KEY）。",
    AUTH_UPSTREAM_TIMEOUT: "服务端登录态校验超时，请稍后重试。",
    AUTH_UPSTREAM_ERROR: "服务端登录态校验失败，请稍后重试。",
    CONFIG_MISSING: "服务端未配置 GEMINI_API_KEY，请在 Cloudflare Pages Secrets 中补充。",
    BAD_REQUEST: "请求格式不正确，请稍后重试。",
    MESSAGE_REQUIRED: "消息不能为空。",
    MESSAGE_TOO_LONG: "消息过长，请精简后再试。",
    UPSTREAM_TIMEOUT: "Gemini 请求超时，请稍后重试。",
    UPSTREAM_NETWORK_ERROR: "Gemini 网络请求失败，请稍后重试。",
    UPSTREAM_ERROR: "Gemini 服务返回异常，请稍后重试。",
    EMPTY_REPLY: "Gemini 返回为空，请稍后重试。",
  });

  function extractChatRequestId(response, payload) {
    const headerRequestId = String(response?.headers?.get("x-request-id") || "").trim();
    if (headerRequestId) {
      return headerRequestId;
    }
    return String(payload?.requestId || "").trim();
  }

  function appendRequestId(message, requestId) {
    const safeMessage = String(message || "").trim() || "聊天请求失败，请稍后重试。";
    const safeRequestId = String(requestId || "").trim();
    if (!safeRequestId) {
      return safeMessage;
    }
    return `${safeMessage}（请求号: ${safeRequestId}）`;
  }

  function normalizeChatApiError(response, payload) {
    const status = response?.status;
    const code = String(payload?.error?.code || "").trim();
    const upstreamMessage = String(payload?.error?.message || "").trim();

    if (code) {
      const mappedMessage = CHAT_API_ERROR_MESSAGE_MAP[code];
      if (mappedMessage) {
        if (code === "UNAUTHORIZED" && upstreamMessage) {
          return upstreamMessage;
        }
        return mappedMessage;
      }
    }

    if (status === 404) {
      return "未找到 /api/chat。请确认已部署 Cloudflare Pages Functions。";
    }
    if (upstreamMessage) {
      return upstreamMessage;
    }
    if (Number.isFinite(status)) {
      return `聊天请求失败（HTTP ${status}）。`;
    }
    return "聊天请求失败，请稍后重试。";
  }

  async function getChatAuthToken() {
    const client = getSupabaseClient();
    if (!client) {
      return "";
    }

    try {
      const { data, error } = await client.auth.getSession();
      if (error) {
        throw error;
      }
      return String(data?.session?.access_token || "").trim();
    } catch (error) {
      console.warn("[Sales Tool] 读取聊天鉴权令牌失败。", error);
      return "";
    }
  }

  async function requestAiChatReply(message, options = {}) {
    const safeMessage = String(message || "").trim();
    if (!safeMessage) {
      throw new Error("消息不能为空。");
    }
    const safeMode = sanitizeChatMode(options && typeof options === "object" ? options.mode : "");

    const accessToken = await getChatAuthToken();
    if (!accessToken) {
      throw new Error("登录状态已失效，请重新登录后再试。");
    }

    let response;
    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: safeMessage,
          context: buildAiChatContextPayload(),
          mode: safeMode,
        }),
      });
    } catch (error) {
      throw new Error(
        `无法连接 /api/chat：${error instanceof Error && error.message ? error.message : "请稍后重试"}`,
      );
    }

    const payload = await parseJsonSafe(response);
    const requestId = extractChatRequestId(response, payload);
    if (!response.ok) {
      throw new Error(appendRequestId(normalizeChatApiError(response, payload), requestId));
    }

    const reply = String(payload?.reply || "").trim();
    const structured = payload?.structured && typeof payload.structured === "object" ? payload.structured : null;
    const responseMode = sanitizeChatMode(payload?.mode || safeMode);
    const format = payload?.format === "structured" ? "structured" : "text_fallback";
    const fallbackReply = reply || String(structured?.summary || "").trim();
    if (!fallbackReply && !structured) {
      throw new Error(appendRequestId("服务端未返回有效回复。", requestId));
    }

    if (requestId) {
      console.info("[Sales Tool] /api/chat 调用成功。", { requestId, mode: responseMode, format });
    }
    return {
      reply: fallbackReply,
      structured,
      mode: responseMode,
      format,
      model: String(payload?.model || "").trim(),
      requestId,
    };
  }

  const aiChatApi = window.__SALES_TOOL_AI_CHAT__;
  if (aiChatApi && typeof aiChatApi.setSendHandler === "function") {
    aiChatApi.setSendHandler((message, options) => requestAiChatReply(message, options));
  } else {
    console.warn("[Sales Tool] 未检测到 AI Chat UI 桥接对象，聊天发送处理器未挂载。");
  }

  if (dom.pageSizeSelect instanceof HTMLSelectElement) {
    dom.pageSizeSelect.value = String(state.pageSize);
  }

  try {
    state.products = await fetchProductsFromCloud();
    clearProductError();
  } catch (error) {
    showProductError(`产品加载失败：${error instanceof Error ? error.message : "请稍后重试"}`);
    console.error("[Sales Tool] 云端产品读取失败。", error);
  }

  try {
    state.targets = await fetchTargetsFromCloud();
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

function getAuthContext() {
  const client = getSupabaseClient();
  const user = getCurrentAuthUser();

  if (!client || !user?.id) {
    return null;
  }

  return { client, user };
}

async function runReadOnlyRecordsCountCheck() {
  const context = getAuthContext();
  if (!context) {
    console.error("[Sales Tool] Supabase 只读验证失败：未获取到登录用户或 client。");
    return;
  }

  try {
    const { client, user } = context;
    const { count, error } = await client
      .from("sales_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (error) {
      console.error("[Sales Tool] Supabase 只读验证失败：", error);
      return;
    }

    console.info(`[Sales Tool] Supabase 只读验证成功，当前用户记录数：${count ?? 0}`);
  } catch (error) {
    console.error("[Sales Tool] Supabase 只读验证异常：", error);
  }
}

function attachSmokeWriteTool() {
  window.__SALES_TOOL_SUPABASE_SMOKE_WRITE__ = async (options = {}) => {
    const context = getAuthContext();
    if (!context) {
      console.error("[Sales Tool] Supabase 写入 smoke 失败：未获取到登录用户或 client。");
      return null;
    }

    const safeOptions = options && typeof options === "object" ? options : {};
    const cleanup = safeOptions.cleanup !== false;
    const now = new Date();
    const testDate = now.toISOString().slice(0, 10);
    const testHospital = `SMOKE_${now.getTime()}`;

    try {
      const { client, user } = context;
      const { data: inserted, error: insertError } = await client
        .from("sales_records")
        .insert({
          user_id: user.id,
          record_date: testDate,
          hospital_name: testHospital,
          product_name: "SMOKE_PRODUCT",
          purchase_quantity_boxes: 1,
          assessed_amount: 1,
          actual_amount: null,
          channel: "SMOKE",
          remark: "SMOKE_TEST",
        })
        .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,remark,created_at")
        .single();

      if (insertError) {
        console.error("[Sales Tool] Supabase 写入 smoke 失败（insert）：", insertError);
        return null;
      }

      const { data: readBack, error: readError } = await client
        .from("sales_records")
        .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,remark,created_at")
        .eq("id", inserted.id)
        .single();

      if (readError) {
        console.error("[Sales Tool] Supabase 写入 smoke 失败（read back）：", readError);
        return null;
      }

      console.info("[Sales Tool] Supabase 写入 smoke 成功（插入并回读）：", readBack);

      if (cleanup) {
        const { error: deleteError } = await client.from("sales_records").delete().eq("id", inserted.id);
        if (deleteError) {
          console.error("[Sales Tool] Supabase 写入 smoke 清理失败：", deleteError);
        } else {
          console.info("[Sales Tool] Supabase 写入 smoke 清理完成。");
        }
      }

      return readBack;
    } catch (error) {
      console.error("[Sales Tool] Supabase 写入 smoke 异常：", error);
      return null;
    }
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
    initAiChatUi();

    await bootstrapAuthGate({
      appRoot: document.querySelector("main.container"),
    });

    await runReadOnlyRecordsCountCheck();
    attachSmokeWriteTool();
    await initializeApp();
    window.__SALES_TOOL_MODULE_BOOTED__ = true;
  } catch (error) {
    showInitError(error);
  }
}

void bootstrap();
