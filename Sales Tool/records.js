const IMPORT_HEADERS = ["日期", "产品/规格", "医院", "采购数量（盒）", "配送"];
const IMPORT_TEMPLATE_VERSION = "v2";
const IMPORT_GUIDE_ROW = [
  `格式：YYYY-MM-DD（模板${IMPORT_TEMPLATE_VERSION}）`,
  "必填，建议与产品配置一致",
  "必填，填写医院全称",
  "必填，非 0 整数（可为负数）",
  "必填，填写配送公司",
];
const IMPORT_DATA_START_ROW = 3;
const IMPORT_DATA_START_INDEX = IMPORT_DATA_START_ROW - 1;
const TEMPLATE_INPUT_AREA_START_ROW = IMPORT_DATA_START_ROW + 1;
const TEMPLATE_INPUT_AREA_ROW_COUNT = 30;
const TEMPLATE_INPUT_AREA_END_ROW = TEMPLATE_INPUT_AREA_START_ROW + TEMPLATE_INPUT_AREA_ROW_COUNT - 1;
const TEMPLATE_SAMPLE_ROW = ["2026-01-01", "阿莫西林 0.25g*24粒", "XX人民医院", 12, "国控"];
const TEMPLATE_COL_CONFIG = [
  { wch: 18, align: "center", numFmt: "yyyy-mm-dd" },
  { wch: 34, align: "left" },
  { wch: 28, align: "left" },
  { wch: 16, align: "center", numFmt: "0" },
  { wch: 20, align: "left" },
];
const TEMPLATE_FILE_NAME = "销售数据导入模板.xlsx";
const IMPORT_DETAIL_PREVIEW_LIMIT = 10;
const IMPORT_BATCH_CHUNK_SIZE = 250;
const PAGE_SIZE_OPTIONS = [20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;
const SORTABLE_RECORD_FIELDS = new Set(["date", "productName", "hospital", "quantity", "amount", "delivery"]);

let state;
let dom;
let deps;

function bindContext(nextState, nextDom, nextDeps) {
  if (nextState) state = nextState;
  if (nextDom) dom = nextDom;
  if (nextDeps) deps = nextDeps;
}

function renderReportsIfAvailable() {
  if (typeof deps.renderReports === "function") {
    deps.renderReports();
  }
}

function clearListStatusSafe() {
  if (typeof deps.clearListStatus === "function") {
    deps.clearListStatus();
  }
}

function showListStatusSafe(message, tone = "muted") {
  if (typeof deps.showListStatus === "function") {
    deps.showListStatus(message, tone);
  }
}

function splitRowsIntoChunks(rows, chunkSize) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const parsedChunkSize = Number(chunkSize);
  const safeChunkSize = Number.isInteger(parsedChunkSize) && parsedChunkSize > 0 ? parsedChunkSize : safeRows.length || 1;
  const chunks = [];

  for (let start = 0; start < safeRows.length; start += safeChunkSize) {
    chunks.push(safeRows.slice(start, start + safeChunkSize));
  }

  return chunks;
}

function createDefaultRecordFilters() {
  return {
    startDate: "",
    endDate: "",
    productKeyword: "",
    hospitalKeyword: "",
  };
}

function normalizeRecordFilters(rawFilters) {
  const source = rawFilters && typeof rawFilters === "object" ? rawFilters : {};
  return {
    startDate: String(source.startDate || "").trim(),
    endDate: String(source.endDate || "").trim(),
    productKeyword: String(source.productKeyword || "").trim(),
    hospitalKeyword: String(source.hospitalKeyword || "").trim(),
  };
}

function readRecordFiltersFromDom() {
  return normalizeRecordFilters({
    startDate: dom.recordFilterStartDateInput instanceof HTMLInputElement ? dom.recordFilterStartDateInput.value : "",
    endDate: dom.recordFilterEndDateInput instanceof HTMLInputElement ? dom.recordFilterEndDateInput.value : "",
    productKeyword:
      dom.recordFilterProductKeywordInput instanceof HTMLInputElement ? dom.recordFilterProductKeywordInput.value : "",
    hospitalKeyword:
      dom.recordFilterHospitalKeywordInput instanceof HTMLInputElement ? dom.recordFilterHospitalKeywordInput.value : "",
  });
}

function applyRecordFiltersToDom(filters) {
  const safeFilters = normalizeRecordFilters(filters);
  if (dom.recordFilterStartDateInput instanceof HTMLInputElement) {
    dom.recordFilterStartDateInput.value = safeFilters.startDate;
  }
  if (dom.recordFilterEndDateInput instanceof HTMLInputElement) {
    dom.recordFilterEndDateInput.value = safeFilters.endDate;
  }
  if (dom.recordFilterProductKeywordInput instanceof HTMLInputElement) {
    dom.recordFilterProductKeywordInput.value = safeFilters.productKeyword;
  }
  if (dom.recordFilterHospitalKeywordInput instanceof HTMLInputElement) {
    dom.recordFilterHospitalKeywordInput.value = safeFilters.hospitalKeyword;
  }
}

function validateRecordFilters(filters) {
  if (!filters.startDate || !filters.endDate) {
    return "";
  }
  if (filters.startDate > filters.endDate) {
    return "开始日期不能晚于结束日期。";
  }
  return "";
}

function createEmptySalesDraft() {
  return {
    date: "",
    productId: "",
    hospital: "",
    quantity: "",
    delivery: "",
  };
}

function readSalesFormDraftFromDom() {
  return {
    date: String(dom.dateInput.value || "").trim(),
    productId: String(dom.productSelect.value || "").trim(),
    hospital: String(dom.hospitalInput.value || "").trim(),
    quantity: String(dom.quantityInput.value || "").trim(),
    delivery: String(dom.deliveryInput.value || "").trim(),
  };
}

function applySalesDraftToDom(draft) {
  const normalizedDraft = {
    ...createEmptySalesDraft(),
    ...(draft && typeof draft === "object" ? draft : {}),
  };

  const hasValidProduct = state.products.some((item) => item.id === normalizedDraft.productId);
  if (!hasValidProduct) {
    normalizedDraft.productId = "";
  }

  dom.dateInput.value = String(normalizedDraft.date || "");
  dom.productSelect.value = String(normalizedDraft.productId || "");
  dom.hospitalInput.value = String(normalizedDraft.hospital || "");
  dom.quantityInput.value = String(normalizedDraft.quantity || "");
  dom.deliveryInput.value = String(normalizedDraft.delivery || "");
  deps.updateComputedAmount();

  if (typeof deps.saveSalesDraft === "function") {
    deps.saveSalesDraft(normalizedDraft);
  }
}

function persistSalesDraftFromDom() {
  if (typeof deps.saveSalesDraft !== "function") return;
  deps.saveSalesDraft(readSalesFormDraftFromDom());
}

function resetSalesFormAndDraft() {
  dom.dateInput.value = "";
  dom.productSelect.value = "";
  dom.hospitalInput.value = "";
  dom.quantityInput.value = "";
  dom.deliveryInput.value = "";
  deps.clearSalesError();
  if (typeof deps.clearSalesTip === "function") {
    deps.clearSalesTip();
  }
  if (typeof deps.clearSalesDraft === "function") {
    deps.clearSalesDraft();
  }
  if (typeof deps.updateSalesFormAvailability === "function") {
    deps.updateSalesFormAvailability();
  }
  deps.updateComputedAmount();
}

function bindSalesDraftEvents() {
  dom.dateInput.addEventListener("change", () => {
    if (typeof deps.clearSalesTip === "function") {
      deps.clearSalesTip();
    }
    persistSalesDraftFromDom();
  });

  dom.hospitalInput.addEventListener("input", () => {
    if (typeof deps.clearSalesTip === "function") {
      deps.clearSalesTip();
    }
    persistSalesDraftFromDom();
  });

  dom.deliveryInput.addEventListener("input", () => {
    if (typeof deps.clearSalesTip === "function") {
      deps.clearSalesTip();
    }
    persistSalesDraftFromDom();
  });

  if (dom.clearSalesDraftBtn instanceof HTMLButtonElement) {
    dom.clearSalesDraftBtn.addEventListener("click", () => {
      resetSalesFormAndDraft();
    });
  }
}

async function refreshRecordListFromCloud(options = {}) {
  if (typeof deps.fetchRecordsPageFromCloud !== "function") {
    return false;
  }

  const resetPage = Boolean(options.resetPage);
  const showStatus = options.showStatus !== false;
  if (resetPage) {
    state.currentPage = 1;
  }

  state.recordFilters = normalizeRecordFilters(state.recordFilters || createDefaultRecordFilters());
  const filterError = validateRecordFilters(state.recordFilters);
  if (filterError) {
    deps.showListError(filterError);
    return false;
  }

  if (showStatus) {
    clearListStatusSafe();
    showListStatusSafe("正在加载记录...", "syncing");
  }

  try {
    const loadCurrentPage = async () =>
      deps.fetchRecordsPageFromCloud({
        page: state.currentPage,
        pageSize: state.pageSize,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
        filters: state.recordFilters,
      });

    let result = await loadCurrentPage();
    let items = Array.isArray(result?.items) ? result.items : [];
    let total = Number(result?.total);
    total = Number.isInteger(total) && total >= 0 ? total : items.length;

    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (total > 0 && state.currentPage > totalPages) {
      state.currentPage = totalPages;
      result = await loadCurrentPage();
      items = Array.isArray(result?.items) ? result.items : [];
      total = Number(result?.total);
      total = Number.isInteger(total) && total >= 0 ? total : items.length;
    }

    state.recordListItems = items;
    state.recordListTotal = total;
    state.editingRowId = "";
    if (state.selectedRecordIds instanceof Set) {
      state.selectedRecordIds.clear();
    }

    renderRecords();
    deps.clearListError();
    if (showStatus) {
      showListStatusSafe(`加载完成，当前第 ${state.currentPage} 页，共 ${state.recordListTotal} 条记录。`, "success");
    }
    return true;
  } catch (error) {
    if (showStatus) {
      clearListStatusSafe();
    }
    deps.showListError("加载失败，请稍后重试。");
    console.error("[Sales Tool] 列表加载失败。", error);
    return false;
  }
}

async function refreshReportRecordsFromCloud() {
  if (typeof deps.fetchAllRecordsFromCloud !== "function") {
    state.records = [];
    state.reportRecords = [];
    renderReportsIfAvailable();
    return false;
  }

  try {
    const cloudRecords = await deps.fetchAllRecordsFromCloud();
    state.reportRecords = Array.isArray(cloudRecords) ? cloudRecords : [];
    state.records = state.reportRecords;
    renderReportsIfAvailable();
    return true;
  } catch (error) {
    state.records = [];
    state.reportRecords = [];
    renderReportsIfAvailable();
    console.error("[Sales Tool] 报表记录同步失败。", error);
    return false;
  }
}

async function refreshRecordListAndReports(options = {}) {
  const markInitialLoadDone = Boolean(options.markInitialLoadDone);
  try {
    const listOk = await refreshRecordListFromCloud(options);
    const reportOk = await refreshReportRecordsFromCloud();
    return { listOk, reportOk };
  } finally {
    if (markInitialLoadDone) {
      state.recordsInitialLoadDone = true;
    }
  }
}

function setDeleteToolbarButtonsDisabled(disabled) {
  if (dom.deleteSelectedBtn instanceof HTMLButtonElement) {
    dom.deleteSelectedBtn.disabled = disabled;
  }
  if (dom.clearAllRecordsBtn instanceof HTMLButtonElement) {
    dom.clearAllRecordsBtn.disabled = disabled;
  }
}

function setImportControlsDisabled(disabled) {
  if (dom.importExcelBtn instanceof HTMLButtonElement) {
    dom.importExcelBtn.disabled = disabled;
  }
  if (dom.importFileInput instanceof HTMLInputElement) {
    dom.importFileInput.disabled = disabled;
  }
  if (dom.downloadTemplateBtn instanceof HTMLButtonElement) {
    dom.downloadTemplateBtn.disabled = disabled;
  }
}

export function bindRecordEvents(nextState, nextDom, nextDeps) {
  bindContext(nextState, nextDom, nextDeps);
  if (!Array.isArray(state.recordListItems)) {
    state.recordListItems = [];
  }
  state.recordFilters = normalizeRecordFilters(state.recordFilters || createDefaultRecordFilters());
  state.recordListTotal = Number.isInteger(Number(state.recordListTotal)) && Number(state.recordListTotal) >= 0
    ? Number(state.recordListTotal)
    : 0;
  if (typeof state.recordsInitialLoadDone !== "boolean") {
    state.recordsInitialLoadDone = false;
  }
  applyRecordFiltersToDom(state.recordFilters);
  if (typeof deps.loadSalesDraft === "function") {
    applySalesDraftToDom(deps.loadSalesDraft());
  }
  bindSalesDraftEvents();
  void refreshRecordListAndReports({ resetPage: true, showStatus: true, markInitialLoadDone: true });

  if (dom.recordFilterApplyBtn instanceof HTMLButtonElement) {
    dom.recordFilterApplyBtn.addEventListener("click", () => {
      state.recordFilters = readRecordFiltersFromDom();
      state.selectedRecordIds.clear();
      void refreshRecordListFromCloud({ resetPage: true, showStatus: true });
    });
  }

  if (dom.recordFilterResetBtn instanceof HTMLButtonElement) {
    dom.recordFilterResetBtn.addEventListener("click", () => {
      state.recordFilters = createDefaultRecordFilters();
      applyRecordFiltersToDom(state.recordFilters);
      state.selectedRecordIds.clear();
      void refreshRecordListFromCloud({ resetPage: true, showStatus: true });
    });
  }

  const triggerFilterApplyByEnter = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    state.recordFilters = readRecordFiltersFromDom();
    state.selectedRecordIds.clear();
    void refreshRecordListFromCloud({ resetPage: true, showStatus: true });
  };

  if (dom.recordFilterStartDateInput instanceof HTMLInputElement) {
    dom.recordFilterStartDateInput.addEventListener("keydown", triggerFilterApplyByEnter);
  }
  if (dom.recordFilterEndDateInput instanceof HTMLInputElement) {
    dom.recordFilterEndDateInput.addEventListener("keydown", triggerFilterApplyByEnter);
  }
  if (dom.recordFilterProductKeywordInput instanceof HTMLInputElement) {
    dom.recordFilterProductKeywordInput.addEventListener("keydown", triggerFilterApplyByEnter);
  }
  if (dom.recordFilterHospitalKeywordInput instanceof HTMLInputElement) {
    dom.recordFilterHospitalKeywordInput.addEventListener("keydown", triggerFilterApplyByEnter);
  }

  dom.salesForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    deps.clearSalesError();
    if (typeof deps.clearSalesTip === "function") {
      deps.clearSalesTip();
    }

    const data = {
      date: String(dom.dateInput.value || "").trim(),
      productId: String(dom.productSelect.value || "").trim(),
      hospital: String(dom.hospitalInput.value || "").trim(),
      quantity: String(dom.quantityInput.value || "").trim(),
      delivery: String(dom.deliveryInput.value || "").trim(),
    };

    const selectedProduct = state.products.find((item) => item.id === data.productId);
    const validationError = deps.validateSalesInput(data, selectedProduct);
    if (validationError) {
      deps.showSalesError(validationError);
      return;
    }

    const quantityNum = Number(data.quantity);
    const amount = deps.roundMoney(selectedProduct.unitPrice * quantityNum);
    const submitButton = dom.salesSubmitBtn instanceof HTMLButtonElement ? dom.salesSubmitBtn : null;
    const originalSubmitText = submitButton ? submitButton.textContent : "";
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "提交中...";
    }

    clearListStatusSafe();
    showListStatusSafe("正在保存...", "syncing");

    try {
      if (typeof deps.insertRecordToCloud === "function") {
        const inserted = await deps.insertRecordToCloud({
          date: data.date,
          hospital: data.hospital,
          productName: selectedProduct.productName,
          quantity: quantityNum,
          amount,
          delivery: data.delivery,
        });

        if (!inserted?.id) {
          throw new Error("云端写入成功，但未返回记录 ID。");
        }
      }

      const { listOk, reportOk } = await refreshRecordListAndReports({ resetPage: true, showStatus: false });
      deps.updateComputedAmount();
      persistSalesDraftFromDom();
      deps.clearListError();
      if (typeof deps.showSalesTip === "function") {
        deps.showSalesTip("记录新增成功。", "success");
      }
      if (listOk && reportOk) {
        showListStatusSafe("保存成功。", "success");
      } else if (!listOk) {
        deps.showListError("保存成功，但列表刷新失败，请稍后重试。");
      } else {
        showListStatusSafe("保存成功，报表稍后更新。", "muted");
      }
    } catch (error) {
      deps.showSalesError(`保存失败：${error instanceof Error ? error.message : "请稍后重试"}`);
      deps.showListError("保存失败，数据未更新，请重试。");
    } finally {
      if (submitButton) {
        submitButton.textContent = originalSubmitText || "新增记录";
      }
      if (typeof deps.updateSalesFormAvailability === "function") {
        deps.updateSalesFormAvailability();
      }
    }
  });

dom.downloadTemplateBtn.addEventListener("click", async () => {
  deps.clearListError();

  try {
    if (isExcelJsReady()) {
      await downloadTemplateWithExcelJs();
      return;
    }
    if (!isXlsxReady()) return;

    const worksheet = XLSX.utils.aoa_to_sheet([IMPORT_HEADERS, IMPORT_GUIDE_ROW, TEMPLATE_SAMPLE_ROW]);
    decorateImportTemplateSheet(worksheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "销售数据");
    XLSX.writeFile(workbook, TEMPLATE_FILE_NAME);
  } catch (_error) {
    deps.showListError("模板生成失败，请稍后重试。");
  }
});

dom.importExcelBtn.addEventListener("click", () => {
  deps.clearListError();
  if (!isXlsxReady()) return;
  dom.importFileInput.click();
});

dom.importFileInput.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  deps.clearListError();
  clearListStatusSafe();
  showListStatusSafe("正在解析导入文件...", "syncing");

  if (!isXlsxReady()) {
    dom.importFileInput.value = "";
    return;
  }

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    const failure = createImportFailure("仅支持 .xlsx 文件导入。", 0, {});
    setImportResult(failure);
    deps.showListError("仅支持 .xlsx 文件导入。");
    dom.importFileInput.value = "";
    return;
  }

  setImportControlsDisabled(true);
  state.editingRowId = "";
  renderRecords();

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {
      type: "array",
      raw: true,
      cellDates: false,
    });

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      const failure = createImportFailure("Excel 中未找到工作表。", 0, {});
      setImportResult(failure);
      deps.showListError("Excel 中未找到工作表。");
      return;
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      const failure = createImportFailure("Excel 中没有可导入的数据。", 0, {});
      setImportResult(failure);
      deps.showListError("Excel 中没有可导入的数据。");
      return;
    }

    if (!isValidImportHeader(rawRows[0]) || !isValidImportGuideRow(rawRows[1])) {
      const failure = createImportFailure("模板版本不匹配，请点击“下载导入模板”获取最新版本后重试。", 2, {
        列头: rawRows[0],
        填写指引: rawRows[1],
        模板版本: IMPORT_TEMPLATE_VERSION,
      });
      setImportResult(failure);
      deps.showListError("模板版本不匹配，请点击“下载导入模板”获取最新版本后重试。");
      return;
    }

    const dataRows = rawRows
      .slice(IMPORT_DATA_START_INDEX)
      .map((row, index) => ({
        rowNumber: index + IMPORT_DATA_START_ROW,
        cells: IMPORT_HEADERS.map((_, cellIndex) => (Array.isArray(row) ? row[cellIndex] : "")),
      }))
      .filter((item) => !isImportRowEmpty(item.cells));

    if (dataRows.length === 0) {
      const failure = createImportFailure("Excel 中没有可导入的数据行。", 0, {});
      setImportResult(failure);
      deps.showListError("Excel 中没有可导入的数据行。");
      return;
    }

    const processResult = processImportRows(dataRows);
    const { nextProducts, preparedRows, summary } = processResult;

    const hasBatchInsert = typeof deps.insertRecordsBatchToCloud === "function";
    const hasSingleInsert = typeof deps.insertRecordToCloud === "function";
    if (!hasBatchInsert && !hasSingleInsert) {
      throw new Error("云端导入接口未就绪，请刷新页面后重试。");
    }

    showListStatusSafe("正在导入数据，数据较多时耗时会更长，请耐心等待。", "syncing");
    let successRows = 0;
    const importChunks = splitRowsIntoChunks(preparedRows, IMPORT_BATCH_CHUNK_SIZE);
    for (let chunkIndex = 0; chunkIndex < importChunks.length; chunkIndex += 1) {
      const chunk = importChunks[chunkIndex];
      const chunkLabel = `正在导入：第 ${chunkIndex + 1}/${importChunks.length} 批（${chunk.length} 行）...`;
      showListStatusSafe(chunkLabel, "syncing");

      let chunkInserted = false;
      if (hasBatchInsert) {
        try {
          const batchPayloads = chunk.map((row) => row.payload);
          const batchResult = await deps.insertRecordsBatchToCloud(batchPayloads);
          const insertedCount = Number(batchResult?.insertedCount);
          if (!Number.isInteger(insertedCount) || insertedCount !== chunk.length) {
            throw new Error(
              `批量写入返回数量异常（${Number.isFinite(insertedCount) ? insertedCount : "unknown"}/${chunk.length}）`,
            );
          }

          successRows += insertedCount;
          chunkInserted = true;
        } catch (batchError) {
          if (!hasSingleInsert) {
            const reason = batchError instanceof Error && batchError.message ? batchError.message : "请稍后重试";
            for (const row of chunk) {
              summary.errors.push(buildImportError(row.rowNumber, `批量保存失败：${reason}`, row.rawRow));
            }
            continue;
          }
        }
      }

      if (chunkInserted) {
        continue;
      }

      for (const row of chunk) {
        try {
          await deps.insertRecordToCloud(row.payload);
          successRows += 1;
        } catch (error) {
          summary.errors.push(
            buildImportError(
              row.rowNumber,
              `保存失败：${error instanceof Error ? error.message : "请稍后重试"}`,
              row.rawRow,
            ),
          );
        }
      }
    }

    summary.successRows = successRows;
    summary.failedRows = summary.errors.length;
    summary.duplicateDetectedRows = summary.duplicates.length;
    setImportResult(summary);

    if (summary.successRows > 0) {
      const previousProducts = state.products.map((item) => ({ ...item }));
      const hasAutoCreatedProducts = summary.autoCreatedProducts > 0;
      let productSyncIssue = "";

      if (hasAutoCreatedProducts) {
        if (typeof deps.saveProducts !== "function") {
          productSyncIssue = "导入记录已保存，但自动新增产品同步接口未就绪";
        } else {
          try {
            await deps.saveProducts({ products: nextProducts });
            state.products = nextProducts;
          } catch (error) {
            const reason = error instanceof Error && error.message ? error.message : "请稍后重试";
            productSyncIssue = `导入记录已保存，但自动新增产品同步失败：${reason}`;
          }
        }

        if (productSyncIssue) {
          let hasRecovered = false;
          if (typeof deps.fetchProductsFromCloud === "function") {
            try {
              const cloudProducts = await deps.fetchProductsFromCloud();
              if (Array.isArray(cloudProducts)) {
                state.products = cloudProducts;
                hasRecovered = true;
              }
            } catch (error) {
              const reason = error instanceof Error && error.message ? error.message : "请稍后重试";
              productSyncIssue = `${productSyncIssue}；云端产品回拉失败：${reason}`;
            }
          }

          if (!hasRecovered) {
            state.products = previousProducts;
          }
        }
      } else {
        state.products = nextProducts;
      }

      deps.renderProductMaster();
      deps.renderProductSelectOptions();
      deps.updateSalesFormAvailability();
      deps.updateComputedAmount();
      const { listOk, reportOk } = await refreshRecordListAndReports({ resetPage: true, showStatus: false });

      deps.clearListError();
      if (!listOk) {
        const extra = productSyncIssue ? `；${productSyncIssue}` : "";
        deps.showListError(`导入已提交，但列表刷新失败，请稍后重试${extra}。`);
      } else if (productSyncIssue) {
        deps.showListError(`${productSyncIssue}。`);
        if (!reportOk) {
          showListStatusSafe("导入已提交，报表稍后更新。", "muted");
        } else {
          showListStatusSafe("导入完成，但产品主数据存在同步异常。", "muted");
        }
      } else if (!reportOk) {
        showListStatusSafe("导入已提交，报表稍后更新。", "muted");
      } else if (summary.failedRows > 0) {
        showListStatusSafe(`导入部分成功：成功 ${summary.successRows}，失败 ${summary.failedRows}。`, "muted");
      } else {
        showListStatusSafe("导入完成，数据已全部加载。", "success");
      }
    } else {
      deps.showListError("导入失败，数据未更新，请根据失败明细修正后重试。");
    }
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "文件解析失败，请确认文件格式和内容。";
    const failure = createImportFailure(reason, 0, {});
    setImportResult(failure);
    deps.showListError(reason);
  } finally {
    setImportControlsDisabled(false);
    dom.importFileInput.value = "";
  }
});

dom.importResultEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const clickable = target.closest("[data-jump-target]");
  if (!(clickable instanceof HTMLElement)) return;
  if (clickable.classList.contains("import-stat-disabled")) return;

  const targetId = clickable.dataset.jumpTarget;
  if (!targetId) return;

  const detailSection = dom.importResultEl.querySelector(`#${targetId}`);
  if (!(detailSection instanceof HTMLElement)) return;

  detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
});

dom.pageSizeSelect.addEventListener("change", () => {
  const nextPageSize = Number(dom.pageSizeSelect.value);
  if (!PAGE_SIZE_OPTIONS.includes(nextPageSize)) {
    dom.pageSizeSelect.value = String(state.pageSize);
    return;
  }

  state.pageSize = nextPageSize;
  state.currentPage = 1;
  state.selectedRecordIds.clear();
  void refreshRecordListFromCloud({ resetPage: true, showStatus: false });
});

dom.multiSelectToggleBtn.addEventListener("click", () => {
  toggleMultiSelectMode();
});

dom.selectCurrentPageBtn.addEventListener("click", () => {
  const pageRecords = getPagedRecords();
  const shouldSelectAll = !isAllCurrentPageSelected(pageRecords);
  toggleSelectCurrentPage(shouldSelectAll);
});

dom.deleteSelectedBtn.addEventListener("click", () => {
  handleBatchDelete();
});

dom.clearAllRecordsBtn.addEventListener("click", () => {
  handleClearAllRecords();
});

dom.prevPageBtn.addEventListener("click", () => {
  if (state.currentPage <= 1) return;
  state.currentPage -= 1;
  state.selectedRecordIds.clear();
  void refreshRecordListFromCloud({ showStatus: false });
});

dom.nextPageBtn.addEventListener("click", () => {
  const totalPages = getTotalPages();
  if (state.currentPage >= totalPages) return;
  state.currentPage += 1;
  state.selectedRecordIds.clear();
  void refreshRecordListFromCloud({ showStatus: false });
});

dom.recordsHead.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.id !== "head-select-checkbox") return;

  toggleSelectCurrentPage(target.checked);
});

dom.recordsHead.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target instanceof HTMLInputElement) return;

  const sortable = target.closest("[data-sort-field]");
  if (!(sortable instanceof HTMLElement)) return;

  const field = String(sortable.dataset.sortField || "").trim();
  if (!SORTABLE_RECORD_FIELDS.has(field)) return;

  toggleSort(field);
  state.selectedRecordIds.clear();
  void refreshRecordListFromCloud({ resetPage: true, showStatus: false });
});

dom.productSelect.addEventListener("change", () => {
  deps.clearSalesError();
  if (typeof deps.clearSalesTip === "function") {
    deps.clearSalesTip();
  }
  deps.updateComputedAmount();
  persistSalesDraftFromDom();
});

dom.quantityInput.addEventListener("input", () => {
  deps.clearSalesError();
  if (typeof deps.clearSalesTip === "function") {
    deps.clearSalesTip();
  }
  deps.updateComputedAmount();
  persistSalesDraftFromDom();
});

dom.recordsBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const id = target.dataset.id;
  if (!id) return;

  if (target.classList.contains("delete-record-btn")) {
    const deleteBtn = target instanceof HTMLButtonElement ? target : null;
    let shouldRestoreToolbar = true;

    if (deleteBtn) {
      deleteBtn.disabled = true;
    }
    setDeleteToolbarButtonsDisabled(true);
    clearListStatusSafe();
    showListStatusSafe("正在删除记录...", "syncing");

    try {
      if (typeof deps.deleteRecordFromCloud === "function") {
        const result = await deps.deleteRecordFromCloud(id);
        const deletedIds = Array.isArray(result?.deletedIds) ? result.deletedIds : [];
        if (!deletedIds.includes(id)) {
          await refreshRecordListFromCloud({ showStatus: false });
          await refreshReportRecordsFromCloud();
          deps.showListError("未找到该记录，列表已刷新同步。");
          return;
        }
      }

      const { listOk, reportOk } = await refreshRecordListAndReports({ showStatus: false });
      if (!listOk) {
        deps.showListError("删除成功，但列表刷新失败，请稍后重试。");
        return;
      }
      deps.clearListError();
      if (reportOk) {
        showListStatusSafe("记录已删除。", "success");
      } else {
        showListStatusSafe("记录已删除，报表稍后更新。", "muted");
      }
      shouldRestoreToolbar = false;
    } catch (error) {
      deps.showListError("删除失败，记录未变更。请重试。");
    } finally {
      if (deleteBtn instanceof HTMLButtonElement && document.body.contains(deleteBtn)) {
        deleteBtn.disabled = false;
      }
      if (shouldRestoreToolbar) {
        setDeleteToolbarButtonsDisabled(false);
      }
    }
    return;
  }

  if (target.classList.contains("edit-record-btn")) {
    state.editingRowId = id;
    deps.clearListError();
    renderRecords();
    return;
  }

  if (target.classList.contains("cancel-record-btn")) {
    state.editingRowId = "";
    deps.clearListError();
    renderRecords();
    return;
  }

  if (target.classList.contains("save-record-btn")) {
    await saveInlineEdit(id, target);
  }
});

dom.recordsBody.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("row-edit-quantity") && !target.classList.contains("row-edit-product")) return;

  const row = target.closest("tr");
  if (!(row instanceof HTMLTableRowElement)) return;
  deps.clearListError();
  updateInlineAmount(row);
});

dom.recordsBody.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.classList.contains("record-select-checkbox")) {
    const id = target.dataset.id;
    if (!id) return;
    toggleSelectOne(id);
    return;
  }
  if (!target.classList.contains("row-edit-quantity") && !target.classList.contains("row-edit-product")) return;

  const row = target.closest("tr");
  if (!(row instanceof HTMLTableRowElement)) return;
  deps.clearListError();
  updateInlineAmount(row);
});

dom.recordsBody.addEventListener("keydown", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;

  const row = target.closest('tr[data-editing="true"]');
  if (!(row instanceof HTMLTableRowElement)) return;

  if (event.key === "Enter") {
    event.preventDefault();
    const saveBtn = row.querySelector(".save-record-btn");
    if (!(saveBtn instanceof HTMLElement)) return;

    const id = saveBtn.dataset.id;
    if (!id) return;

    await saveInlineEdit(id, saveBtn);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    state.editingRowId = "";
    deps.clearListError();
    renderRecords();
  }
});

}

export function renderRecords(nextState, nextDom, nextDeps) {
  bindContext(nextState, nextDom, nextDeps);
  clearInvalidSelections();
  clampCurrentPage();

  const pageRecords = state.recordListItems;
  renderRecordsHead(pageRecords);
  renderListToolsState(pageRecords);
  renderPagination();

  if (state.recordListItems.length === 0 || pageRecords.length === 0) {
    dom.recordsBody.innerHTML = `
      <tr>
        <td colspan="${getRecordsColumnCount()}" class="empty">暂无记录</td>
      </tr>
    `;
    return;
  }

  dom.recordsBody.innerHTML = pageRecords
    .map((record) => {
      if (!state.isMultiSelectMode && record.id === state.editingRowId) {
        return renderEditingRow(record);
      }

      if (state.isMultiSelectMode) {
        const isSelected = state.selectedRecordIds.has(record.id);
        return `
        <tr class="${isSelected ? "selected-row" : ""}">
          <td class="select-col">
            <input class="record-select-checkbox" type="checkbox" data-id="${deps.escapeHtml(record.id)}" ${
              isSelected ? "checked" : ""
            } />
          </td>
          <td>${deps.escapeHtml(record.date)}</td>
          <td>${deps.escapeHtml(record.productName)}</td>
          <td>${deps.escapeHtml(record.hospital)}</td>
          <td>${deps.escapeHtml(String(record.quantity))} 盒</td>
          <td>${deps.escapeHtml(deps.formatMoney(record.amount))}</td>
          <td>${deps.escapeHtml(record.delivery)}</td>
        </tr>
      `;
      }

      return `
      <tr>
        <td>${deps.escapeHtml(record.date)}</td>
        <td>${deps.escapeHtml(record.productName)}</td>
        <td>${deps.escapeHtml(record.hospital)}</td>
        <td>${deps.escapeHtml(String(record.quantity))} 盒</td>
        <td>${deps.escapeHtml(deps.formatMoney(record.amount))}</td>
        <td>${deps.escapeHtml(record.delivery)}</td>
        <td>
          <div class="action-group">
            <button class="edit-btn edit-record-btn" type="button" data-id="${deps.escapeHtml(record.id)}">编辑</button>
            <button class="delete-btn delete-record-btn" type="button" data-id="${deps.escapeHtml(record.id)}">删除</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
}

function renderRecordsHead(pageRecords) {
  if (state.isMultiSelectMode) {
    const allSelected = isAllCurrentPageSelected(pageRecords);
    dom.recordsHead.innerHTML = `
      <tr>
        <th class="select-col">
          <input id="head-select-checkbox" type="checkbox" ${allSelected ? "checked" : ""} ${
            pageRecords.length === 0 ? "disabled" : ""
          } />
        </th>
        ${buildSortableHeadCell("日期", "date")}
        ${buildSortableHeadCell("产品/规格", "productName")}
        ${buildSortableHeadCell("医院", "hospital")}
        ${buildSortableHeadCell("采购数量", "quantity")}
        ${buildSortableHeadCell("考核金额", "amount")}
        ${buildSortableHeadCell("配送", "delivery")}
      </tr>
    `;
    return;
  }

  dom.recordsHead.innerHTML = `
    <tr>
      ${buildSortableHeadCell("日期", "date")}
      ${buildSortableHeadCell("产品/规格", "productName")}
      ${buildSortableHeadCell("医院", "hospital")}
      ${buildSortableHeadCell("采购数量", "quantity")}
      ${buildSortableHeadCell("考核金额", "amount")}
      ${buildSortableHeadCell("配送", "delivery")}
      <th>操作</th>
    </tr>
  `;
}

function buildSortableHeadCell(label, field) {
  const isActive = state.sortField === field;
  const direction = isActive && state.sortDirection ? state.sortDirection : "";
  const indicator = direction === "asc" ? "↑" : direction === "desc" ? "↓" : "";
  const thClass = `sortable-th${isActive ? " sortable-th-active" : ""}`;
  const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";

  return `
    <th class="${thClass}" data-sort-field="${deps.escapeHtml(field)}" aria-sort="${ariaSort}">
      ${deps.escapeHtml(label)}
      <span class="sort-indicator">${deps.escapeHtml(indicator)}</span>
    </th>
  `;
}

function renderListToolsState(pageRecords) {
  if (dom.pageSizeSelect instanceof HTMLSelectElement) {
    dom.pageSizeSelect.value = String(state.pageSize);
  }

  dom.multiSelectToggleBtn.textContent = state.isMultiSelectMode ? "退出多选" : "多选";

  if (!state.isMultiSelectMode) {
    dom.selectCurrentPageBtn.hidden = true;
    dom.deleteSelectedBtn.hidden = true;
    dom.clearAllRecordsBtn.hidden = true;
    return;
  }

  dom.selectCurrentPageBtn.hidden = false;
  dom.deleteSelectedBtn.hidden = false;
  dom.clearAllRecordsBtn.hidden = false;

  const allCurrentPageSelected = isAllCurrentPageSelected(pageRecords);
  dom.selectCurrentPageBtn.textContent = allCurrentPageSelected ? "取消全选当前页" : "全选当前页";
  dom.selectCurrentPageBtn.disabled = pageRecords.length === 0;

  const selectedCount = state.selectedRecordIds.size;
  dom.deleteSelectedBtn.textContent = `删除已选(${selectedCount})`;
  dom.deleteSelectedBtn.disabled = selectedCount === 0;
  dom.clearAllRecordsBtn.disabled = state.recordListTotal === 0;
}

function renderPagination() {
  const hasRecords = state.recordListTotal > 0;
  const totalPages = getTotalPages();

  dom.pageInfoEl.textContent = hasRecords ? `第 ${state.currentPage} / ${totalPages} 页` : "第 1 / 1 页";
  dom.prevPageBtn.disabled = !hasRecords || state.currentPage <= 1;
  dom.nextPageBtn.disabled = !hasRecords || state.currentPage >= totalPages;
}

function getTotalPages() {
  const total = Math.ceil(state.recordListTotal / state.pageSize);
  return total > 0 ? total : 1;
}

function clampCurrentPage() {
  const totalPages = getTotalPages();
  if (state.currentPage < 1) {
    state.currentPage = 1;
  } else if (state.currentPage > totalPages) {
    state.currentPage = totalPages;
  }
}

function getPagedRecords() {
  return state.recordListItems;
}

function getSortedRecords() {
  return state.recordListItems;
}

function compareRecordValue(leftRecord, rightRecord, field) {
  if (field === "quantity" || field === "amount") {
    const leftValue = Number(leftRecord[field]);
    const rightValue = Number(rightRecord[field]);
    const safeLeft = Number.isFinite(leftValue) ? leftValue : 0;
    const safeRight = Number.isFinite(rightValue) ? rightValue : 0;
    return safeLeft - safeRight;
  }

  const leftText = String(leftRecord[field] || "").trim();
  const rightText = String(rightRecord[field] || "").trim();
  return leftText.localeCompare(rightText, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function toggleSort(field) {
  if (!SORTABLE_RECORD_FIELDS.has(field)) return;

  if (state.sortField !== field) {
    state.sortField = field;
    state.sortDirection = "asc";
  } else if (state.sortDirection === "asc") {
    state.sortDirection = "desc";
  } else {
    state.sortField = "";
    state.sortDirection = "";
  }

  state.currentPage = 1;
}

function getRecordsColumnCount() {
  return state.isMultiSelectMode ? 7 : 7;
}

function isAllCurrentPageSelected(pageRecords) {
  return pageRecords.length > 0 && pageRecords.every((record) => state.selectedRecordIds.has(record.id));
}

function clearInvalidSelections() {
  const existingIds = new Set(state.recordListItems.map((record) => record.id));
  for (const id of state.selectedRecordIds) {
    if (!existingIds.has(id)) {
      state.selectedRecordIds.delete(id);
    }
  }
}

function toggleMultiSelectMode() {
  const enteringMultiSelect = !state.isMultiSelectMode;
  if (enteringMultiSelect && state.editingRowId) {
    state.editingRowId = "";
  }

  state.isMultiSelectMode = enteringMultiSelect;
  if (!state.isMultiSelectMode) {
    state.selectedRecordIds.clear();
  }

  deps.clearListError();
  renderRecords();
}

function toggleSelectOne(recordId) {
  if (state.selectedRecordIds.has(recordId)) {
    state.selectedRecordIds.delete(recordId);
  } else {
    state.selectedRecordIds.add(recordId);
  }

  renderRecords();
}

function toggleSelectCurrentPage(selectAll) {
  const pageRecords = getPagedRecords();
  for (const record of pageRecords) {
    if (selectAll) {
      state.selectedRecordIds.add(record.id);
    } else {
      state.selectedRecordIds.delete(record.id);
    }
  }

  renderRecords();
}

async function handleBatchDelete() {
  const selectedCount = state.selectedRecordIds.size;
  if (selectedCount === 0) {
    deps.showListError("请先选择记录。");
    return;
  }

  const confirmed = window.confirm(`确定删除已选 ${selectedCount} 条记录？`);
  if (!confirmed) return;

  const selectedIds = Array.from(state.selectedRecordIds);
  let shouldRestoreToolbar = true;
  setDeleteToolbarButtonsDisabled(true);
  clearListStatusSafe();
  showListStatusSafe("正在批量删除记录...", "syncing");

  try {
    let deletedIds = selectedIds;
    if (typeof deps.deleteRecordsFromCloud === "function") {
      const result = await deps.deleteRecordsFromCloud(selectedIds);
      deletedIds = Array.isArray(result?.deletedIds) ? result.deletedIds : [];
    }

    const deletedSet = new Set(deletedIds);
    const successCount = deletedSet.size;
    const failCount = selectedCount - successCount;

    if (successCount === 0) {
      deps.showListError("批量删除失败，记录未变更。请重试。");
      return;
    }

    const { listOk, reportOk } = await refreshRecordListAndReports({ showStatus: false });
    if (!listOk) {
      deps.showListError("批量删除已提交，但列表刷新失败，请稍后重试。");
      return;
    }
    shouldRestoreToolbar = false;

    if (failCount > 0) {
      deps.clearListError();
      if (reportOk) {
        showListStatusSafe(`批量删除部分成功：成功 ${successCount}，失败 ${failCount}。`, "muted");
      } else {
        showListStatusSafe(`批量删除部分成功：成功 ${successCount}，失败 ${failCount}（报表稍后更新）。`, "muted");
      }
    } else {
      deps.clearListError();
      if (reportOk) {
        showListStatusSafe("批量删除完成。", "success");
      } else {
        showListStatusSafe("批量删除完成，报表稍后更新。", "muted");
      }
    }
  } catch (error) {
    deps.showListError("批量删除失败，记录未变更。请重试。");
  } finally {
    if (shouldRestoreToolbar) {
      setDeleteToolbarButtonsDisabled(false);
    }
  }
}

async function handleClearAllRecords() {
  if (state.recordListTotal === 0) {
    deps.showListError("当前没有可清空的记录。");
    return;
  }

  const confirmed = window.confirm(`确定清空全部 ${state.recordListTotal} 条记录？此操作不可撤销。`);
  if (!confirmed) return;

  let shouldRestoreToolbar = true;
  setDeleteToolbarButtonsDisabled(true);
  clearListStatusSafe();
  showListStatusSafe("正在清空记录...", "syncing");

  try {
    if (typeof deps.deleteAllRecordsFromCloud === "function") {
      await deps.deleteAllRecordsFromCloud();
    }

    const { listOk, reportOk } = await refreshRecordListAndReports({ resetPage: true, showStatus: false });
    if (!listOk) {
      deps.showListError("清空已提交，但列表刷新失败，请稍后重试。");
      return;
    }
    deps.clearListError();
    if (reportOk) {
      showListStatusSafe("当前账号记录已清空。", "success");
    } else {
      showListStatusSafe("当前账号记录已清空，报表稍后更新。", "muted");
    }
    shouldRestoreToolbar = false;
  } catch (error) {
    deps.showListError("清空失败，记录未变更。请重试。");
  } finally {
    if (shouldRestoreToolbar) {
      setDeleteToolbarButtonsDisabled(false);
    }
  }
}

function renderEditingRow(record) {
  const selectedProductId = state.products.some((item) => item.id === record.productId) ? record.productId : "";
  const productOptions = buildProductOptions(selectedProductId);
  const currentProduct = state.products.find((item) => item.id === selectedProductId);
  const amountText = currentProduct
    ? deps.formatMoney(deps.roundMoney(currentProduct.unitPrice * record.quantity))
    : "-";

  return `
    <tr data-editing="true">
      <td>
        <input class="row-edit-input" data-field="date" type="date" value="${deps.escapeHtml(record.date)}" />
      </td>
      <td>
        <select class="row-edit-select row-edit-product" data-field="productId">
          ${productOptions}
        </select>
      </td>
      <td>
        <input class="row-edit-input" data-field="hospital" type="text" value="${deps.escapeHtml(record.hospital)}" />
      </td>
      <td>
        <input class="row-edit-input row-edit-quantity" data-field="quantity" type="text" inputmode="decimal" value="${deps.escapeHtml(String(record.quantity))}" />
      </td>
      <td>
        <span class="row-edit-amount">${deps.escapeHtml(amountText)}</span>
      </td>
      <td>
        <input class="row-edit-input" data-field="delivery" type="text" value="${deps.escapeHtml(record.delivery)}" />
      </td>
      <td>
        <div class="action-group">
          <button class="save-btn save-record-btn" type="button" data-id="${deps.escapeHtml(record.id)}">保存</button>
          <button class="cancel-btn cancel-record-btn" type="button" data-id="${deps.escapeHtml(record.id)}">取消</button>
        </div>
      </td>
    </tr>
  `;
}

function buildProductOptions(selectedId) {
  const options = ['<option value="">请选择产品/规格</option>'].concat(
    state.products.map((item) => {
      const selected = item.id === selectedId ? " selected" : "";
      return `<option value="${deps.escapeHtml(item.id)}"${selected}>${deps.escapeHtml(item.productName)}</option>`;
    }),
  );

  return options.join("");
}

async function saveInlineEdit(id, trigger) {
  const row = trigger.closest("tr");
  if (!(row instanceof HTMLTableRowElement)) return;

  const data = {
    date: getRowFieldValue(row, "date"),
    productId: getRowFieldValue(row, "productId"),
    hospital: getRowFieldValue(row, "hospital"),
    quantity: getRowFieldValue(row, "quantity"),
    delivery: getRowFieldValue(row, "delivery"),
  };

  const selectedProduct = state.products.find((item) => item.id === data.productId);
  const validationError = deps.validateSalesInput(data, selectedProduct);
  if (validationError) {
    deps.showListError(validationError);
    return;
  }

  const quantityNum = Number(data.quantity);
  const amount = deps.roundMoney(selectedProduct.unitPrice * quantityNum);

  const saveBtn = row.querySelector(".save-record-btn");
  const cancelBtn = row.querySelector(".cancel-record-btn");
  if (saveBtn instanceof HTMLButtonElement) {
    saveBtn.disabled = true;
  }
  if (cancelBtn instanceof HTMLButtonElement) {
    cancelBtn.disabled = true;
  }

  clearListStatusSafe();
  showListStatusSafe("正在保存修改...", "syncing");

  try {
    if (typeof deps.updateRecordInCloud === "function") {
      const { updatedCount } = await deps.updateRecordInCloud(id, {
        date: data.date,
        hospital: data.hospital,
        productName: selectedProduct.productName,
        quantity: quantityNum,
        amount,
        delivery: data.delivery,
      });

      if (!updatedCount) {
        await refreshRecordListFromCloud({ showStatus: false });
        await refreshReportRecordsFromCloud();
        deps.clearListError();
        showListStatusSafe("记录不存在，已同步最新数据。", "muted");
        return;
      }
    }

    const { listOk, reportOk } = await refreshRecordListAndReports({ showStatus: false });
    if (!listOk) {
      deps.showListError("修改成功，但列表刷新失败，请稍后重试。");
      return;
    }
    deps.clearListError();
    if (reportOk) {
      showListStatusSafe("修改已保存。", "success");
    } else {
      showListStatusSafe("修改已保存，报表稍后更新。", "muted");
    }
  } catch (error) {
    deps.showListError("修改失败，原数据未变更。请重试。");
  } finally {
    if (saveBtn instanceof HTMLButtonElement && document.body.contains(saveBtn)) {
      saveBtn.disabled = false;
    }
    if (cancelBtn instanceof HTMLButtonElement && document.body.contains(cancelBtn)) {
      cancelBtn.disabled = false;
    }
  }
}

function getRowFieldValue(row, fieldName) {
  const field = row.querySelector(`[data-field="${fieldName}"]`);
  if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLSelectElement)) {
    return "";
  }

  return String(field.value || "").trim();
}

function updateInlineAmount(row) {
  const productId = getRowFieldValue(row, "productId");
  const quantityRaw = getRowFieldValue(row, "quantity");
  const amountEl = row.querySelector(".row-edit-amount");

  if (!(amountEl instanceof HTMLElement)) return;

  const selectedProduct = state.products.find((item) => item.id === productId);
  const quantityNum = Number(quantityRaw);

  if (!selectedProduct || !Number.isInteger(quantityNum) || quantityNum === 0) {
    amountEl.textContent = "-";
    return;
  }

  amountEl.textContent = deps.formatMoney(deps.roundMoney(selectedProduct.unitPrice * quantityNum));
}

function processImportRows(dataRows) {
  const nextProducts = state.products.map((item) => ({ ...item }));

  const productNameMap = new Map();
  for (const product of nextProducts) {
    const key = deps.normalizeText(product.productName);
    if (key && !productNameMap.has(key)) {
      productNameMap.set(key, product);
    }
  }

  const duplicateSourceMap = new Map();
  const existingRecords = Array.isArray(state.reportRecords) ? state.reportRecords : state.records;
  existingRecords.forEach((record, index) => {
    const normalizedName = deps.normalizeText(record.productName);
    const duplicateKey = buildDuplicateKey(record.date, normalizedName, record.hospital, record.delivery, record.quantity);
    if (!duplicateSourceMap.has(duplicateKey)) {
      duplicateSourceMap.set(duplicateKey, { type: "existing", recordIndex: index + 1 });
    }
  });

  const summary = {
    totalRows: dataRows.length,
    successRows: 0,
    failedRows: 0,
    duplicateDetectedRows: 0,
    autoCreatedProducts: 0,
    autoCreatedProductNames: [],
    errors: [],
    duplicates: [],
  };
  const preparedRows = [];

  for (const rowInfo of dataRows) {
    const parsed = normalizeImportDataRow(rowInfo.rowNumber, rowInfo.cells);
    if (!parsed.ok) {
      summary.errors.push(parsed.error);
      continue;
    }

    const data = parsed.data;
    const productKey = deps.normalizeText(data.productName);
    let product = productNameMap.get(productKey);

    if (!product) {
      product = {
        id: deps.buildId(),
        productName: data.productName,
        unitPrice: 0,
      };
      nextProducts.unshift(product);
      productNameMap.set(productKey, product);
      summary.autoCreatedProducts += 1;
      summary.autoCreatedProductNames.push(product.productName);
    }

    const duplicateKey = buildDuplicateKey(data.date, productKey, data.hospital, data.delivery, data.quantity);
    const duplicateSource = duplicateSourceMap.get(duplicateKey);
    if (duplicateSource) {
      summary.duplicates.push(
        buildImportError(rowInfo.rowNumber, buildDuplicateReason(duplicateSource), {
          日期: data.date,
          "产品/规格": product.productName,
          医院: data.hospital,
          "采购数量（盒）": data.quantity,
          配送: data.delivery,
        }),
      );
    } else {
      duplicateSourceMap.set(duplicateKey, { type: "import", rowNumber: rowInfo.rowNumber });
    }

    preparedRows.push({
      rowNumber: rowInfo.rowNumber,
      rawRow: {
        日期: rowInfo.cells[0],
        "产品/规格": rowInfo.cells[1],
        医院: rowInfo.cells[2],
        "采购数量（盒）": rowInfo.cells[3],
        配送: rowInfo.cells[4],
      },
      payload: {
        date: data.date,
        hospital: data.hospital,
        productName: product.productName,
        quantity: data.quantity,
        amount: deps.roundMoney(product.unitPrice * data.quantity),
        delivery: data.delivery,
      },
    });
  }

  summary.failedRows = summary.errors.length;
  summary.duplicateDetectedRows = summary.duplicates.length;

  return {
    nextProducts,
    preparedRows,
    summary,
  };
}

function normalizeImportDataRow(rowNumber, cells) {
  const rawRow = {
    日期: cells[0],
    "产品/规格": cells[1],
    医院: cells[2],
    "采购数量（盒）": cells[3],
    配送: cells[4],
  };

  const date = normalizeImportDate(cells[0]);
  if (!date) {
    return {
      ok: false,
      error: buildImportError(rowNumber, "日期格式不正确或为空。", rawRow),
    };
  }

  const productName = String(cells[1] || "").trim();
  if (!productName) {
    return {
      ok: false,
      error: buildImportError(rowNumber, "产品/规格不能为空。", rawRow),
    };
  }

  const hospital = String(cells[2] || "").trim();
  if (!hospital) {
    return {
      ok: false,
      error: buildImportError(rowNumber, "医院不能为空。", rawRow),
    };
  }

  const quantity = normalizeImportQuantity(cells[3]);
  if (quantity === null) {
    return {
      ok: false,
      error: buildImportError(rowNumber, "采购数量必须为非 0 整数（可为负数）。", rawRow),
    };
  }

  const delivery = String(cells[4] || "").trim();
  if (!delivery) {
    return {
      ok: false,
      error: buildImportError(rowNumber, "配送不能为空。", rawRow),
    };
  }

  return {
    ok: true,
    data: {
      date,
      productName,
      hospital,
      quantity,
      delivery,
    },
  };
}

function normalizeImportDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return deps.formatDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return parseExcelSerialToDate(value);
  }

  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^\d+(\.0+)?$/.test(raw)) {
    return parseExcelSerialToDate(Number(raw));
  }

  const directMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (directMatch) {
    const year = Number(directMatch[1]);
    const month = Number(directMatch[2]);
    const day = Number(directMatch[3]);
    if (!deps.isValidDateParts(year, month, day)) return "";
    return deps.formatDate(year, month, day);
  }

  const parsedDate = new Date(raw);
  if (Number.isNaN(parsedDate.getTime())) return "";

  return deps.formatDate(parsedDate.getFullYear(), parsedDate.getMonth() + 1, parsedDate.getDate());
}

function parseExcelSerialToDate(serialValue) {
  if (!Number.isFinite(serialValue) || serialValue <= 0) return "";
  if (typeof XLSX === "undefined" || !XLSX.SSF || typeof XLSX.SSF.parse_date_code !== "function") return "";

  const parsed = XLSX.SSF.parse_date_code(serialValue);
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) return "";
  if (!deps.isValidDateParts(parsed.y, parsed.m, parsed.d)) return "";

  return deps.formatDate(parsed.y, parsed.m, parsed.d);
}

function normalizeImportQuantity(value) {
  let quantityNum;

  if (typeof value === "number") {
    quantityNum = value;
  } else {
    const raw = String(value || "").trim();
    if (!raw) return null;
    quantityNum = Number(raw);
  }

  if (!Number.isFinite(quantityNum)) return null;
  if (!Number.isInteger(quantityNum)) return null;
  if (quantityNum === 0) return null;

  return quantityNum;
}

function isValidImportHeader(headerRow) {
  const normalized = normalizeImportTemplateRow(headerRow);
  if (normalized.length !== IMPORT_HEADERS.length) return false;
  return IMPORT_HEADERS.every((header, index) => normalized[index] === header);
}

function isValidImportGuideRow(guideRow) {
  const normalized = normalizeImportTemplateRow(guideRow);
  if (normalized.length !== IMPORT_GUIDE_ROW.length) return false;
  return IMPORT_GUIDE_ROW.every((guide, index) => normalized[index] === guide);
}

function normalizeImportTemplateRow(row) {
  if (!Array.isArray(row)) return [];

  const normalized = row.map((item) => String(item || "").trim());
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }
  return normalized;
}

function isImportRowEmpty(cells) {
  return cells.every((cell) => String(cell ?? "").trim() === "");
}

function buildDuplicateKey(date, productNameKey, hospital, delivery, quantity) {
  return [
    String(date || "").trim(),
    deps.normalizeText(productNameKey),
    deps.normalizeText(hospital),
    deps.normalizeText(delivery),
    String(quantity || "").trim(),
  ].join("|");
}

function buildDuplicateReason(duplicateSource) {
  if (duplicateSource && duplicateSource.type === "import" && Number.isFinite(duplicateSource.rowNumber)) {
    return `与第 ${duplicateSource.rowNumber} 行重复（已允许导入）。`;
  }

  if (duplicateSource && duplicateSource.type === "existing" && Number.isFinite(duplicateSource.recordIndex)) {
    return `与现有记录第 ${duplicateSource.recordIndex} 条重复（已允许导入）。`;
  }

  return "与现有或本次已导入记录重复（已允许导入）。";
}

function buildImportError(rowNumber, reason, rawRow) {
  return {
    rowNumber,
    reason,
    rawRow,
  };
}

function createImportFailure(reason, rowNumber, rawRow) {
  return {
    totalRows: 0,
    successRows: 0,
    failedRows: 1,
    duplicateDetectedRows: 0,
    autoCreatedProducts: 0,
    autoCreatedProductNames: [],
    errors: [
      {
        rowNumber,
        reason,
        rawRow,
      },
    ],
    duplicates: [],
  };
}

function setImportResult(result) {
  state.importResult = result;
  renderImportResult();
}

export function clearImportResult(nextState, nextDom, nextDeps) {
  bindContext(nextState, nextDom, nextDeps);
  state.importResult = null;
  dom.importResultEl.hidden = true;
  dom.importResultEl.innerHTML = "";
}

function renderImportResult() {
  if (!state.importResult) {
    clearImportResult();
    return;
  }

  dom.importResultEl.hidden = false;

  const hasFailures = state.importResult.failedRows > 0;
  const hasDuplicates = state.importResult.duplicateDetectedRows > 0;
  const hasAutoCreated = state.importResult.autoCreatedProducts > 0;
  const title = hasFailures ? "导入完成（含失败）" : "导入完成";

  const errorsPreview = state.importResult.errors.slice(0, IMPORT_DETAIL_PREVIEW_LIMIT);
  const duplicatesPreview = state.importResult.duplicates.slice(0, IMPORT_DETAIL_PREVIEW_LIMIT);
  const autoCreatedPreview = state.importResult.autoCreatedProductNames.slice(0, IMPORT_DETAIL_PREVIEW_LIMIT);

  const failureSection =
    hasFailures
      ? `
      <div class="import-detail-section" id="import-failures">
        <div class="import-detail-title">失败明细</div>
        <ul class="import-detail-list">
          ${errorsPreview
            .map((item) => {
              const rowText = item.rowNumber > 0 ? `第 ${item.rowNumber} 行` : "文件级错误";
              return `<li>${deps.escapeHtml(rowText)}：${deps.escapeHtml(item.reason)}</li>`;
            })
            .join("")}
          ${
            state.importResult.errors.length > IMPORT_DETAIL_PREVIEW_LIMIT
              ? `<li>其余 ${deps.escapeHtml(
                  String(state.importResult.errors.length - IMPORT_DETAIL_PREVIEW_LIMIT),
                )} 条失败请修正后重试。</li>`
              : ""
          }
        </ul>
      </div>
    `
      : "";

  const duplicateSection =
    hasDuplicates
      ? `
      <div class="import-detail-section" id="import-duplicates">
        <div class="import-detail-title">重复检测明细（已导入）</div>
        <ul class="import-detail-list">
          ${duplicatesPreview
            .map((item) => `<li>第 ${deps.escapeHtml(String(item.rowNumber))} 行：${deps.escapeHtml(item.reason)}</li>`)
            .join("")}
          ${
            state.importResult.duplicates.length > IMPORT_DETAIL_PREVIEW_LIMIT
              ? `<li>其余 ${deps.escapeHtml(
                  String(state.importResult.duplicates.length - IMPORT_DETAIL_PREVIEW_LIMIT),
                )} 条重复已省略展示。</li>`
              : ""
          }
        </ul>
      </div>
    `
      : "";

  const autoCreatedSection =
    hasAutoCreated
      ? `
      <div class="import-detail-section" id="import-auto-created">
        <div class="import-detail-title">自动新增产品明细</div>
        <ul class="import-detail-list">
          ${autoCreatedPreview.map((name) => `<li>${deps.escapeHtml(name)}</li>`).join("")}
          ${
            state.importResult.autoCreatedProductNames.length > IMPORT_DETAIL_PREVIEW_LIMIT
              ? `<li>其余 ${deps.escapeHtml(
                  String(state.importResult.autoCreatedProductNames.length - IMPORT_DETAIL_PREVIEW_LIMIT),
                )} 个产品已省略展示。</li>`
              : ""
          }
        </ul>
      </div>
    `
      : "";

  dom.importResultEl.innerHTML = `
    <div class="import-result-title">${deps.escapeHtml(title)}</div>
    <div class="import-result-stats">
      <span class="import-stat">
        <span class="import-icon">#</span>
        总行数 ${deps.escapeHtml(String(state.importResult.totalRows))}
      </span>
      <span class="import-stat import-stat-success">
        <span class="import-icon icon-check">✓</span>
        成功 ${deps.escapeHtml(String(state.importResult.successRows))}
      </span>
      <button class="import-stat import-stat-error ${
        hasFailures ? "import-stat-clickable" : "import-stat-disabled"
      }" type="button" ${hasFailures ? 'data-jump-target="import-failures"' : "disabled"}>
        <span class="import-icon icon-cross">✕</span>
        失败 ${deps.escapeHtml(String(state.importResult.failedRows))}
      </button>
      <button class="import-stat import-stat-warning ${
        hasDuplicates ? "import-stat-clickable" : "import-stat-disabled"
      }" type="button" ${hasDuplicates ? 'data-jump-target="import-duplicates"' : "disabled"}>
        <span class="import-icon icon-warn">!</span>
        重复 ${deps.escapeHtml(String(state.importResult.duplicateDetectedRows))}
      </button>
      <button class="import-stat import-stat-warning ${
        hasAutoCreated ? "import-stat-clickable" : "import-stat-disabled"
      }" type="button" ${hasAutoCreated ? 'data-jump-target="import-auto-created"' : "disabled"}>
        <span class="import-icon icon-warn">!</span>
        自动新增产品 ${deps.escapeHtml(String(state.importResult.autoCreatedProducts))}
      </button>
    </div>
    ${failureSection}
    ${duplicateSection}
    ${autoCreatedSection}
  `;
}

function isExcelJsReady() {
  return typeof ExcelJS !== "undefined" && ExcelJS && typeof ExcelJS.Workbook === "function";
}

async function downloadTemplateWithExcelJs() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("销售数据", {
    views: [{ state: "frozen", xSplit: 0, ySplit: IMPORT_DATA_START_INDEX }],
  });

  worksheet.columns = TEMPLATE_COL_CONFIG.map((item) => ({ width: item.wch }));
  worksheet.autoFilter = {
    from: "A1",
    to: `${encodeImportCol(IMPORT_HEADERS.length - 1)}1`,
  };

  worksheet.addRow(IMPORT_HEADERS);
  worksheet.addRow(IMPORT_GUIDE_ROW);
  worksheet.addRow(TEMPLATE_SAMPLE_ROW);
  for (let i = 0; i < TEMPLATE_INPUT_AREA_ROW_COUNT; i += 1) {
    worksheet.addRow(["", "", "", "", ""]);
  }

  worksheet.getRow(1).height = 24;
  worksheet.getRow(2).height = 34;
  worksheet.getRow(3).height = 22;
  for (let rowNum = TEMPLATE_INPUT_AREA_START_ROW; rowNum <= TEMPLATE_INPUT_AREA_END_ROW; rowNum += 1) {
    worksheet.getRow(rowNum).height = 21;
  }

  const headerStyle = {
    font: { name: "Microsoft YaHei", bold: true, size: 11, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } },
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: buildExcelJsBorder("FF1F3864", "medium"),
  };
  const guideStyle = {
    font: { name: "Microsoft YaHei", size: 10, color: { argb: "FF7F6000" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } },
    alignment: { horizontal: "left", vertical: "middle", wrapText: true },
    border: buildExcelJsBorder("FFE0C58F", "thin"),
  };
  const sampleStyle = {
    font: { name: "Microsoft YaHei", size: 10, color: { argb: "FF4B5563" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } },
    border: buildExcelJsBorder("FFC9D2E3", "thin"),
  };
  const inputStyle = {
    font: { name: "Microsoft YaHei", size: 11, color: { argb: "FF1F2937" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FBFF" } },
    border: buildExcelJsBorder("FFD8E2F1", "thin"),
  };

  worksheet.getCell("A3").value = new Date(2026, 0, 1);
  worksheet.getCell("B3").value = TEMPLATE_SAMPLE_ROW[1];
  worksheet.getCell("C3").value = TEMPLATE_SAMPLE_ROW[2];
  worksheet.getCell("D3").value = Number(TEMPLATE_SAMPLE_ROW[3]);
  worksheet.getCell("E3").value = TEMPLATE_SAMPLE_ROW[4];

  for (let colIndex = 1; colIndex <= IMPORT_HEADERS.length; colIndex += 1) {
    const colConfig = TEMPLATE_COL_CONFIG[colIndex - 1] || {};
    const align = mapExcelJsHorizontalAlign(colConfig.align);

    const headerCell = worksheet.getRow(1).getCell(colIndex);
    headerCell.style = {
      ...headerStyle,
      alignment: { ...headerStyle.alignment },
      border: { ...headerStyle.border },
      font: { ...headerStyle.font },
      fill: { ...headerStyle.fill },
    };

    const guideCell = worksheet.getRow(2).getCell(colIndex);
    guideCell.style = {
      ...guideStyle,
      alignment: { ...guideStyle.alignment },
      border: { ...guideStyle.border },
      font: { ...guideStyle.font },
      fill: { ...guideStyle.fill },
    };

    const sampleCell = worksheet.getRow(3).getCell(colIndex);
    sampleCell.style = {
      ...sampleStyle,
      alignment: {
        horizontal: align,
        vertical: "middle",
      },
    };
    if (colConfig.numFmt) {
      sampleCell.numFmt = colConfig.numFmt;
    }

    for (let rowNum = TEMPLATE_INPUT_AREA_START_ROW; rowNum <= TEMPLATE_INPUT_AREA_END_ROW; rowNum += 1) {
      const cell = worksheet.getRow(rowNum).getCell(colIndex);
      cell.style = {
        ...inputStyle,
        alignment: {
          horizontal: align,
          vertical: "middle",
        },
      };
      if (colConfig.numFmt) {
        cell.numFmt = colConfig.numFmt;
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  triggerExcelTemplateDownload(buffer, TEMPLATE_FILE_NAME);
}

function buildExcelJsBorder(colorArgb, lineStyle) {
  const border = { style: lineStyle, color: { argb: colorArgb } };
  return {
    top: border,
    right: border,
    bottom: border,
    left: border,
  };
}

function mapExcelJsHorizontalAlign(align) {
  return align === "center" ? "center" : "left";
}

function triggerExcelTemplateDownload(buffer, fileName) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function decorateImportTemplateSheet(worksheet) {
  if (!worksheet || typeof worksheet !== "object") return;

  worksheet["!cols"] = TEMPLATE_COL_CONFIG.map((item) => ({ wch: item.wch }));
  const rowsConfig = Array.from({ length: TEMPLATE_INPUT_AREA_END_ROW }, () => ({ hpt: 21 }));
  rowsConfig[0] = { hpt: 24 };
  rowsConfig[1] = { hpt: 34 };
  rowsConfig[2] = { hpt: 22 };
  worksheet["!rows"] = rowsConfig;
  worksheet["!autofilter"] = { ref: `A1:${encodeImportCol(IMPORT_HEADERS.length - 1)}1` };
  worksheet["!freeze"] = {
    xSplit: 0,
    ySplit: IMPORT_DATA_START_INDEX,
    topLeftCell: `A${IMPORT_DATA_START_ROW}`,
    activePane: "bottomLeft",
    state: "frozen",
  };

  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
    fill: { patternType: "solid", fgColor: { rgb: "2F5597" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: buildTemplateBorder("1F3864", "medium"),
  };
  const guideStyle = {
    font: { color: { rgb: "7F6000" }, sz: 10 },
    fill: { patternType: "solid", fgColor: { rgb: "FFF2CC" } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    border: buildTemplateBorder("E0C58F", "thin"),
  };
  const sampleBaseStyle = {
    font: { color: { rgb: "4B5563" }, sz: 10 },
    fill: { patternType: "solid", fgColor: { rgb: "F5F7FA" } },
    border: buildTemplateBorder("C9D2E3", "thin"),
  };
  const inputAreaBaseStyle = {
    font: { color: { rgb: "1F2937" }, sz: 11 },
    fill: { patternType: "solid", fgColor: { rgb: "F8FBFF" } },
    border: buildTemplateBorder("D8E2F1", "thin"),
  };

  for (let colIndex = 0; colIndex < IMPORT_HEADERS.length; colIndex += 1) {
    const colRef = encodeImportCol(colIndex);
    const headerCell = worksheet[`${colRef}1`];
    const guideCell = worksheet[`${colRef}2`];
    const sampleCell = worksheet[`${colRef}${IMPORT_DATA_START_ROW}`];
    const colConfig = TEMPLATE_COL_CONFIG[colIndex] || {};

    if (headerCell) headerCell.s = headerStyle;
    if (guideCell) guideCell.s = guideStyle;

    if (sampleCell) {
      sampleCell.s = {
        ...sampleBaseStyle,
        alignment: {
          horizontal: colConfig.align || "left",
          vertical: "center",
        },
      };
      if (colConfig.numFmt) {
        sampleCell.z = colConfig.numFmt;
      }
    }
  }

  for (let rowNumber = TEMPLATE_INPUT_AREA_START_ROW; rowNumber <= TEMPLATE_INPUT_AREA_END_ROW; rowNumber += 1) {
    for (let colIndex = 0; colIndex < IMPORT_HEADERS.length; colIndex += 1) {
      const colRef = encodeImportCol(colIndex);
      const cellAddress = `${colRef}${rowNumber}`;
      const colConfig = TEMPLATE_COL_CONFIG[colIndex] || {};
      let cell = worksheet[cellAddress];
      if (!cell) {
        cell = { t: "s", v: "" };
        worksheet[cellAddress] = cell;
      }

      cell.s = {
        ...inputAreaBaseStyle,
        alignment: {
          horizontal: colConfig.align || "left",
          vertical: "center",
        },
      };
      if (colConfig.numFmt) {
        cell.z = colConfig.numFmt;
      }
    }
  }

  const sampleDateCellAddress = `A${IMPORT_DATA_START_ROW}`;
  const sampleDateCell = worksheet[sampleDateCellAddress];
  const dateSerial = convertTemplateDateTextToExcelSerial(TEMPLATE_SAMPLE_ROW[0]);
  if (sampleDateCell && dateSerial !== null) {
    sampleDateCell.t = "n";
    sampleDateCell.v = dateSerial;
    sampleDateCell.z = TEMPLATE_COL_CONFIG[0].numFmt;
  }

  const sampleQuantityCellAddress = `D${IMPORT_DATA_START_ROW}`;
  const sampleQuantityCell = worksheet[sampleQuantityCellAddress];
  if (sampleQuantityCell && Number.isFinite(Number(sampleQuantityCell.v))) {
    sampleQuantityCell.t = "n";
    sampleQuantityCell.v = Number(sampleQuantityCell.v);
    sampleQuantityCell.z = TEMPLATE_COL_CONFIG[3].numFmt;
  }
}

function buildTemplateBorder(colorHex, lineStyle = "thin") {
  const border = { style: lineStyle, color: { rgb: colorHex } };
  return {
    top: border,
    right: border,
    bottom: border,
    left: border,
  };
}

function encodeImportCol(index) {
  if (typeof XLSX !== "undefined" && XLSX.utils && typeof XLSX.utils.encode_col === "function") {
    return XLSX.utils.encode_col(index);
  }
  return String.fromCharCode(65 + index);
}

function convertTemplateDateTextToExcelSerial(dateText) {
  const text = String(dateText || "").trim();
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!deps.isValidDateParts(year, month, day)) return null;

  const excelEpochUtc = Date.UTC(1899, 11, 30);
  const targetUtc = Date.UTC(year, month - 1, day);
  return (targetUtc - excelEpochUtc) / 86400000;
}

function isXlsxReady() {
  if (typeof XLSX !== "undefined") return true;
  deps.showListError("Excel 组件未加载，请刷新页面后重试。");
  return false;
}
