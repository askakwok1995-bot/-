import {
  TARGET_ALLOCATION_MONTHS,
  createDefaultProductAllocationEntry,
  buildMonthlyTargetMap,
  buildProductAllocationMap,
  getProductAllocationMonths,
  getYearMetricTargets,
  normalizeTargetMetric,
} from "./domain/targets-model.js";

const TARGET_SAVE_DEBOUNCE_MS = 250;
const TARGET_YEAR_RANGE_OFFSET = 2;
const TARGET_QUARTER_TOLERANCE = 0.009;

function renderReportsIfAvailable(deps) {
  if (typeof deps.renderReports === "function") {
    deps.renderReports();
  }
}

function getActiveTargetMetric(state) {
  const metric = normalizeTargetMetric(state?.activeTargetMetric);
  state.activeTargetMetric = metric;
  return metric;
}

function getMetricMeta(metric) {
  const safeMetric = normalizeTargetMetric(metric);
  if (safeMetric === "quantity") {
    return {
      metric: "quantity",
      label: "数量",
      targetLabel: "数量目标",
      allocationLabel: "数量分配",
      unit: "盒",
      detailSuffix: "（盒）",
    };
  }

  return {
    metric: "amount",
    label: "金额",
    targetLabel: "金额目标",
    allocationLabel: "金额分配",
    unit: "元",
    detailSuffix: "（元）",
  };
}

function getMetricButtons(dom) {
  return [
    dom.targetMetricAmountBtn instanceof HTMLButtonElement ? dom.targetMetricAmountBtn : null,
    dom.targetMetricQuantityBtn instanceof HTMLButtonElement ? dom.targetMetricQuantityBtn : null,
  ].filter((item) => item);
}

function ensureMetricTargets(yearData, metric) {
  const safeMetric = normalizeTargetMetric(metric);
  if (!yearData.targets || typeof yearData.targets !== "object") {
    yearData.targets = {};
  }
  yearData.targets[safeMetric] = getYearMetricTargets(yearData, safeMetric);
  return yearData.targets[safeMetric];
}

function ensureEntryMonths(entry, metric) {
  const safeMetric = normalizeTargetMetric(metric);
  const key = safeMetric === "quantity" ? "quantityMonths" : "amountMonths";
  entry[key] = getProductAllocationMonths(entry, safeMetric);
  return entry[key];
}

function buildTargetMetricFormatError(metric) {
  const meta = getMetricMeta(metric);
  return `${meta.targetLabel}必须为非负数字（支持小数），保存时会保留两位小数。`;
}

function buildAllocationFormatError(metric) {
  const meta = getMetricMeta(metric);
  return `${meta.allocationLabel}必须为非负数字（支持小数），保存时会保留两位小数。`;
}

function updateTargetMetricUi(state, dom) {
  const metric = getActiveTargetMetric(state);
  const meta = getMetricMeta(metric);
  getMetricButtons(dom).forEach((button) => {
    const buttonMetric = normalizeTargetMetric(button.dataset.metric, "amount");
    const isActive = buttonMetric === metric;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if (dom.targetMetricTipEl instanceof HTMLElement) {
    dom.targetMetricTipEl.textContent = `当前口径：${meta.targetLabel}${meta.detailSuffix}`;
  }
  if (dom.targetQuarterHeaderEl instanceof HTMLElement) {
    dom.targetQuarterHeaderEl.textContent = `季度${meta.targetLabel}${meta.detailSuffix}`;
  }
  if (dom.targetMonthSumHeaderEl instanceof HTMLElement) {
    dom.targetMonthSumHeaderEl.textContent = `月度合计${meta.detailSuffix}`;
  }
  if (dom.targetProductAllocTitleEl instanceof HTMLElement) {
    dom.targetProductAllocTitleEl.textContent = `按产品分配${meta.targetLabel}（独立规划）`;
  }
}

export function bindTargetInputEvents(state, dom, deps) {
  if (!(dom.targetYearSelect instanceof HTMLSelectElement)) return;
  if (!(dom.targetInputBody instanceof HTMLElement)) return;

  dom.targetYearSelect.addEventListener("change", () => {
    flushTargetSave(state, deps);
    state.targetInputFormatError = "";
    state.targetProductAllocationFormatError = "";

    const nextYear = Number(dom.targetYearSelect.value);
    if (!Number.isInteger(nextYear)) return;

    state.activeTargetYear = nextYear;
    ensureYearTargets(state, nextYear, deps);
    renderTargetInputSection(state, dom, deps);
    renderReportsIfAvailable(deps);
  });

  getMetricButtons(dom).forEach((button) => {
    button.addEventListener("click", () => {
      const nextMetric = normalizeTargetMetric(button.dataset.metric, "amount");
      if (nextMetric === getActiveTargetMetric(state)) return;

      flushTargetSave(state, deps);
      state.activeTargetMetric = nextMetric;
      state.targetInputFormatError = "";
      state.targetProductAllocationFormatError = "";
      ensureYearTargets(state, state.activeTargetYear, deps);
      renderTargetInputSection(state, dom, deps);
      renderReportsIfAvailable(deps);
    });
  });

  if (dom.targetClearPageBtn instanceof HTMLButtonElement) {
    dom.targetClearPageBtn.addEventListener("click", () => {
      handleClearTargetPageClick(state, dom, deps);
    });
  }

  if (dom.targetProductAllocClearPageBtn instanceof HTMLButtonElement) {
    dom.targetProductAllocClearPageBtn.addEventListener("click", () => {
      handleClearTargetProductAllocationPageClick(state, dom, deps);
    });
  }

  dom.targetInputBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const splitBtn = target.closest('button[data-action="split-quarter"]');
    if (!(splitBtn instanceof HTMLButtonElement)) return;

    const quarterKey = String(splitBtn.dataset.quarter || "").trim();
    if (!quarterKey) return;

    handleQuarterSplitClick(state, dom, deps, quarterKey);
  });

  dom.targetInputBody.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("target-input")) return;
    handleTargetInputChange(state, dom, deps, target, false);
  });

  dom.targetInputBody.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("target-input")) return;
    handleTargetInputChange(state, dom, deps, target, true);
  });

  if (dom.targetProductAllocBody instanceof HTMLElement) {
    dom.targetProductAllocBody.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const removeBtn = target.closest(".target-product-alloc-remove-btn");
      if (!(removeBtn instanceof HTMLButtonElement)) return;

      const productId = String(removeBtn.dataset.productId || "").trim();
      if (!productId) return;
      handleRemoveDeletedProductAllocationRow(state, dom, deps, productId);
    });

    dom.targetProductAllocBody.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("target-product-alloc-input")) return;
      handleProductAllocationInputChange(state, dom, deps, target, false);
    });

    dom.targetProductAllocBody.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("target-product-alloc-input")) return;
      handleProductAllocationInputChange(state, dom, deps, target, true);
    });
  }
}

export function handleTargetInputChange(state, dom, deps, input, shouldRenderAfterSave) {
  const quarterKey = String(input.dataset.quarter || "").trim();
  const field = String(input.dataset.field || "").trim();
  const month = Number(input.dataset.month);
  if (!quarterKey) return;

  const metric = getActiveTargetMetric(state);
  const yearData = ensureYearTargets(state, state.activeTargetYear, deps);
  const metricTargets = ensureMetricTargets(yearData, metric);
  const quarterData = metricTargets.quarters[quarterKey];
  if (!quarterData) return;

  const parsed = parseTargetInputValue(input.value);
  if (!parsed.ok) {
    state.targetInputFormatError = buildTargetMetricFormatError(metric);
    refreshTargetValidationUI(state, dom, deps, yearData);
    renderTargetProductAllocationHint(state, dom, deps, yearData);
    return;
  }

  state.targetInputFormatError = "";
  if (field === "quarter") {
    quarterData.quarterTarget = parsed.value;
  } else if (field === "month" && Number.isInteger(month)) {
    quarterData.months[String(month)] = parsed.value;
  } else {
    return;
  }

  yearData.updatedAt = new Date().toISOString();
  scheduleTargetSave(state, deps);
  refreshTargetValidationUI(state, dom, deps, yearData);
  renderTargetProductAllocationHint(state, dom, deps, yearData);

  if (shouldRenderAfterSave) {
    flushTargetSave(state, deps);
    renderTargetInputSection(state, dom, deps);
  }

  renderReportsIfAvailable(deps);
}

export function handleProductAllocationInputChange(state, dom, deps, input, shouldRenderAfterSave) {
  const productId = String(input.dataset.productId || "").trim();
  const month = Number(input.dataset.month);
  if (!productId || !Number.isInteger(month)) return;

  const metric = getActiveTargetMetric(state);
  const yearData = ensureYearTargets(state, state.activeTargetYear, deps);
  const allocations = getYearProductAllocations(yearData);
  const { entry } = ensureProductAllocationEntry(allocations, productId, "", deps);
  if (!entry) return;

  const parsed = parseTargetInputValue(input.value);
  if (!parsed.ok) {
    state.targetProductAllocationFormatError = buildAllocationFormatError(metric);
    renderTargetProductAllocationHint(state, dom, deps, yearData);
    return;
  }

  const months = ensureEntryMonths(entry, metric);
  months[String(month)] = parsed.value;
  state.targetProductAllocationFormatError = "";
  yearData.updatedAt = new Date().toISOString();

  scheduleTargetSave(state, deps);
  renderTargetProductAllocationHint(state, dom, deps, yearData);

  if (shouldRenderAfterSave) {
    flushTargetSave(state, deps);
    renderTargetInputSection(state, dom, deps);
  }
}

function handleQuarterSplitClick(state, dom, deps, quarterKey) {
  const metric = getActiveTargetMetric(state);
  const yearData = ensureYearTargets(state, state.activeTargetYear, deps);
  const metricTargets = ensureMetricTargets(yearData, metric);
  const quarterData = metricTargets.quarters[quarterKey];
  if (!quarterData) return;

  const quarterMeta = deps.TARGET_QUARTERS.find((quarter) => quarter.key === quarterKey);
  if (!quarterMeta || quarterMeta.months.length !== 3) return;

  const quarterTarget = deps.normalizeTargetNumber(quarterData.quarterTarget);
  const base = deps.roundMoney(quarterTarget / 3);
  const month1 = base;
  const month2 = base;
  const month3 = deps.roundMoney(quarterTarget - month1 - month2);

  quarterData.months[String(quarterMeta.months[0])] = month1;
  quarterData.months[String(quarterMeta.months[1])] = month2;
  quarterData.months[String(quarterMeta.months[2])] = month3;
  state.targetInputFormatError = "";
  yearData.updatedAt = new Date().toISOString();

  flushTargetSave(state, deps);
  renderTargetInputSection(state, dom, deps);
  renderReportsIfAvailable(deps);
}

function handleClearTargetPageClick(state, dom, deps) {
  const metric = getActiveTargetMetric(state);
  const meta = getMetricMeta(metric);
  const yearNum = Number(state.activeTargetYear);
  const safeYear = Number.isInteger(yearNum) ? yearNum : getCurrentTargetYear();
  const confirmed = window.confirm(`确定清空 ${safeYear} 年${meta.targetLabel}本页数据吗？`);
  if (!confirmed) return;

  const yearData = ensureYearTargets(state, safeYear, deps);
  const metricTargets = ensureMetricTargets(yearData, metric);
  for (const quarter of deps.TARGET_QUARTERS) {
    const quarterData = metricTargets.quarters[quarter.key];
    if (!quarterData) continue;
    quarterData.quarterTarget = 0;
    for (const month of quarter.months) {
      quarterData.months[String(month)] = 0;
    }
  }

  state.targetInputFormatError = "";
  yearData.updatedAt = new Date().toISOString();

  flushTargetSave(state, deps);
  renderTargetInputSection(state, dom, deps);
  renderReportsIfAvailable(deps);
}

function handleClearTargetProductAllocationPageClick(state, dom, deps) {
  const metric = getActiveTargetMetric(state);
  const meta = getMetricMeta(metric);
  const yearNum = Number(state.activeTargetYear);
  const safeYear = Number.isInteger(yearNum) ? yearNum : getCurrentTargetYear();
  const confirmed = window.confirm(`确定清空 ${safeYear} 年${meta.allocationLabel}本页数据吗？`);
  if (!confirmed) return;

  const yearData = ensureYearTargets(state, safeYear, deps);
  const allocations = getYearProductAllocations(yearData);
  for (const [productId, entry] of Object.entries(allocations)) {
    const productName = String((entry && entry.productName) || "").trim();
    const result = ensureProductAllocationEntry(allocations, productId, productName, deps);
    if (!result.entry) continue;
    const months = ensureEntryMonths(result.entry, metric);
    for (const month of TARGET_ALLOCATION_MONTHS) {
      months[String(month)] = 0;
    }
  }

  state.targetProductAllocationFormatError = "";
  yearData.updatedAt = new Date().toISOString();

  flushTargetSave(state, deps);
  renderTargetInputSection(state, dom, deps);
  renderReportsIfAvailable(deps);
}

function handleRemoveDeletedProductAllocationRow(state, dom, deps, productId) {
  const safeProductId = String(productId || "").trim();
  if (!safeProductId) return;

  const isActiveProduct = state.products.some((item) => item.id === safeProductId);
  if (isActiveProduct) return;

  const yearData = ensureYearTargets(state, state.activeTargetYear, deps);
  const allocations = getYearProductAllocations(yearData);
  const targetEntry = allocations[safeProductId];
  if (!targetEntry || typeof targetEntry !== "object") return;

  const productName = String(targetEntry.productName || "").trim() || "该产品";
  const confirmed = window.confirm(`确定移除“${productName}”的分配数据吗？此操作不可撤销。`);
  if (!confirmed) return;

  delete allocations[safeProductId];
  state.targetProductAllocationFormatError = "";
  yearData.updatedAt = new Date().toISOString();

  flushTargetSave(state, deps);
  renderTargetInputSection(state, dom, deps);
  renderReportsIfAvailable(deps);
}

export function scheduleTargetSave(state, deps) {
  if (state.targetSaveTimer) {
    clearTimeout(state.targetSaveTimer);
  }

  state.targetSaveTimer = setTimeout(() => {
    state.targetSaveTimer = null;
    deps.saveTargets(state);
  }, TARGET_SAVE_DEBOUNCE_MS);
}

export function flushTargetSave(state, deps) {
  if (state.targetSaveTimer) {
    clearTimeout(state.targetSaveTimer);
    state.targetSaveTimer = null;
  }

  deps.saveTargets(state);
}

export function renderTargetInputSection(state, dom, deps) {
  if (!(dom.targetYearSelect instanceof HTMLSelectElement)) return;
  if (!(dom.targetInputBody instanceof HTMLElement)) return;

  const metric = getActiveTargetMetric(state);
  const meta = getMetricMeta(metric);
  const yearOptions = getTargetYearOptions();
  if (!yearOptions.includes(state.activeTargetYear)) {
    state.activeTargetYear = getCurrentTargetYear();
  }

  dom.targetYearSelect.innerHTML = yearOptions
    .map((year) => `<option value="${deps.escapeHtml(String(year))}">${deps.escapeHtml(String(year))}年</option>`)
    .join("");
  dom.targetYearSelect.value = String(state.activeTargetYear);
  updateTargetMetricUi(state, dom);

  const yearData = ensureYearTargets(state, state.activeTargetYear, deps);
  const metricTargets = ensureMetricTargets(yearData, metric);
  const validation = validateYearTargets(yearData, deps, metric);

  dom.targetInputBody.innerHTML = deps.TARGET_QUARTERS.map((quarter) => {
    const detail = validation.quarterStates[quarter.key];
    const quarterData = metricTargets.quarters[quarter.key];
    const rowClass = detail && !detail.isMatched ? "target-row-invalid" : "";
    const monthCells = quarter.months
      .map((month) => {
        const monthValue = deps.normalizeTargetNumber(quarterData.months[String(month)]);
        return `
          <td>
            <div class="target-month-label">${deps.escapeHtml(String(month))}月</div>
            <input
              class="target-input"
              type="number"
              min="0"
              step="0.01"
              data-quarter="${deps.escapeHtml(quarter.key)}"
              data-field="month"
              data-month="${deps.escapeHtml(String(month))}"
              value="${deps.escapeHtml(deps.formatMoney(monthValue))}"
            />
          </td>
        `;
      })
      .join("");

    return `
      <tr data-quarter="${deps.escapeHtml(quarter.key)}" class="${rowClass}">
        <td class="target-quarter-cell">${deps.escapeHtml(quarter.label)}</td>
        <td>
          <div class="target-quarter-input-group">
            <input
              class="target-input"
              type="number"
              min="0"
              step="0.01"
              data-quarter="${deps.escapeHtml(quarter.key)}"
              data-field="quarter"
              value="${deps.escapeHtml(deps.formatMoney(deps.normalizeTargetNumber(quarterData.quarterTarget)))}"
            />
            <button
              type="button"
              class="target-split-btn"
              data-action="split-quarter"
              data-quarter="${deps.escapeHtml(quarter.key)}"
            >
              均分到月度
            </button>
          </div>
        </td>
        ${monthCells}
        <td class="target-month-sum" data-role="month-sum" data-quarter="${deps.escapeHtml(quarter.key)}">
          ${deps.escapeHtml(deps.formatMoney(detail.monthSum))}
        </td>
        <td class="target-quarter-check" data-role="quarter-check" data-quarter="${deps.escapeHtml(quarter.key)}">
          ${detail.isMatched ? "已生效" : "未生效"}
        </td>
      </tr>
    `;
  }).join("");

  if (dom.targetClearPageBtn instanceof HTMLButtonElement) {
    dom.targetClearPageBtn.textContent = `清空${meta.label}目标`;
  }

  renderTargetStatus(state, dom, validation, metric);
  renderTargetError(state, dom, validation);
  renderTargetProductAllocationSection(state, dom, deps, yearData);
}

export function refreshTargetValidationUI(state, dom, deps, yearData) {
  if (!(dom.targetInputBody instanceof HTMLElement)) return;

  const metric = getActiveTargetMetric(state);
  const validation = validateYearTargets(yearData, deps, metric);
  for (const quarter of deps.TARGET_QUARTERS) {
    const detail = validation.quarterStates[quarter.key];
    const row = dom.targetInputBody.querySelector(`tr[data-quarter="${quarter.key}"]`);
    if (!(row instanceof HTMLTableRowElement) || !detail) continue;

    row.classList.toggle("target-row-invalid", !detail.isMatched);
    const sumEl = row.querySelector('[data-role="month-sum"]');
    if (sumEl instanceof HTMLElement) {
      sumEl.textContent = deps.formatMoney(detail.monthSum);
    }

    const checkEl = row.querySelector('[data-role="quarter-check"]');
    if (checkEl instanceof HTMLElement) {
      checkEl.textContent = detail.isMatched ? "已生效" : "未生效";
    }
  }

  renderTargetStatus(state, dom, validation, metric);
  renderTargetError(state, dom, validation);
}

export function renderTargetStatus(state, dom, validation, metric = "amount") {
  if (!(dom.targetStatusEl instanceof HTMLElement)) return;

  const meta = getMetricMeta(metric);
  if (validation.isEffective) {
    dom.targetStatusEl.textContent = `${state.activeTargetYear} 年${meta.targetLabel}状态：已生效`;
    dom.targetStatusEl.classList.remove("target-status-invalid");
    return;
  }

  dom.targetStatusEl.textContent = `${state.activeTargetYear} 年${meta.targetLabel}状态：未生效（${validation.errors.length} 个季度待修正）`;
  dom.targetStatusEl.classList.add("target-status-invalid");
}

export function renderTargetError(state, dom, validation) {
  if (!(dom.targetErrorEl instanceof HTMLElement)) return;

  const messages = [];
  if (state.targetSyncError) {
    messages.push(state.targetSyncError);
  }
  if (state.targetInputFormatError) {
    messages.push(state.targetInputFormatError);
  }
  for (const error of validation.errors) {
    messages.push(error.message);
  }

  dom.targetErrorEl.textContent = messages.join("；");
}

function renderTargetProductAllocationSection(state, dom, deps, yearData) {
  if (!(dom.targetProductAllocBody instanceof HTMLElement)) return;

  const metric = getActiveTargetMetric(state);
  const meta = getMetricMeta(metric);
  const rows = getProductAllocationRows(state, yearData, metric, deps);

  if (dom.targetProductAllocClearPageBtn instanceof HTMLButtonElement) {
    dom.targetProductAllocClearPageBtn.textContent = `清空${meta.allocationLabel}`;
  }

  if (rows.length === 0) {
    dom.targetProductAllocBody.innerHTML = `
      <tr>
        <td colspan="15" class="empty">暂无产品配置</td>
      </tr>
    `;
  } else {
    dom.targetProductAllocBody.innerHTML = rows
      .map((row) => {
        const statusText = row.isDeleted ? "已删除" : "正常";
        const statusClass = row.isDeleted ? "target-product-alloc-status-deleted" : "";
        const actionCell = row.isDeleted
          ? `
            <button
              class="danger-btn target-product-alloc-remove-btn"
              type="button"
              data-product-id="${deps.escapeHtml(row.productId)}"
            >
              移除分配
            </button>
          `
          : "-";
        const monthCells = TARGET_ALLOCATION_MONTHS.map((month) => {
          const monthKey = String(month);
          return `
            <td>
              <input
                class="target-input target-product-alloc-input"
                type="number"
                min="0"
                step="0.01"
                data-product-id="${deps.escapeHtml(row.productId)}"
                data-month="${deps.escapeHtml(monthKey)}"
                value="${deps.escapeHtml(deps.formatMoney(row.valuesByMonth[monthKey]))}"
              />
            </td>
          `;
        }).join("");

        return `
          <tr>
            <td class="target-product-alloc-name">${deps.escapeHtml(row.productName || "未命名产品")}</td>
            ${monthCells}
            <td class="target-product-alloc-status ${statusClass}">${statusText}</td>
            <td class="target-product-alloc-action">${actionCell}</td>
          </tr>
        `;
      })
      .join("");
  }

  renderTargetProductAllocationHint(state, dom, deps, yearData);
}

function renderTargetProductAllocationHint(state, dom, deps, yearData) {
  if (!(dom.targetProductAllocSummaryEl instanceof HTMLElement)) return;
  if (!(dom.targetProductAllocHintEl instanceof HTMLElement)) return;

  const metric = getActiveTargetMetric(state);
  const meta = getMetricMeta(metric);
  const allocations = getYearProductAllocations(yearData);
  const monthlyTotals = {};
  let totalAllocated = 0;

  for (const month of TARGET_ALLOCATION_MONTHS) {
    const monthKey = String(month);
    let monthTotal = 0;
    for (const entry of Object.values(allocations)) {
      if (!entry || typeof entry !== "object") continue;
      const months = getProductAllocationMonths(entry, metric);
      monthTotal += deps.normalizeTargetNumber(months[monthKey]);
    }
    monthlyTotals[monthKey] = deps.roundMoney(monthTotal);
    totalAllocated += monthTotal;
  }

  totalAllocated = deps.roundMoney(totalAllocated);
  dom.targetProductAllocSummaryEl.textContent = `当前口径：${meta.label}；年度分配合计：${deps.formatMoney(totalAllocated)}${meta.unit}`;

  dom.targetProductAllocHintEl.classList.remove(
    "target-product-alloc-hint-ok",
    "target-product-alloc-hint-warn",
    "target-product-alloc-hint-error",
  );

  if (state.targetProductAllocationFormatError) {
    dom.targetProductAllocHintEl.textContent = state.targetProductAllocationFormatError;
    dom.targetProductAllocHintEl.classList.add("target-product-alloc-hint-error");
    return;
  }

  const monthlySummary = TARGET_ALLOCATION_MONTHS
    .map((month) => `${month}月${deps.formatMoney(monthlyTotals[String(month)])}`)
    .join("；");
  dom.targetProductAllocHintEl.textContent = `当前口径分配独立保存，不参与目标生效校验。月汇总：${monthlySummary}`;
}

export function parseTargetInputValue(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return { ok: true, value: 0 };
  }

  if (!/^\d*\.?\d*$/.test(raw) || raw === ".") {
    return { ok: false, value: 0 };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, value: 0 };
  }

  return { ok: true, value: Math.round((value + Number.EPSILON) * 100) / 100 };
}

export function validateYearTargets(yearData, deps, metric = "amount") {
  const meta = getMetricMeta(metric);
  const metricTargets = getYearMetricTargets(yearData, metric);
  const errors = [];
  const quarterStates = {};

  for (const quarter of deps.TARGET_QUARTERS) {
    const quarterData = metricTargets.quarters[quarter.key];
    const quarterTarget = deps.normalizeTargetNumber(quarterData.quarterTarget);
    const monthSum = deps.roundMoney(
      quarter.months.reduce((sum, month) => sum + deps.normalizeTargetNumber(quarterData.months[String(month)]), 0),
    );
    const diff = deps.roundMoney(monthSum - quarterTarget);
    const isMatched = Math.abs(diff) <= TARGET_QUARTER_TOLERANCE;

    quarterStates[quarter.key] = {
      quarterTarget,
      monthSum,
      diff,
      isMatched,
    };

    if (!isMatched) {
      errors.push({
        quarterKey: quarter.key,
        quarterTarget,
        monthSum,
        message: `${quarter.key} ${meta.targetLabel}(${deps.formatMoney(quarterTarget)})与月度合计(${deps.formatMoney(monthSum)})不一致。`,
      });
    }
  }

  return {
    isEffective: errors.length === 0,
    errors,
    quarterStates,
  };
}

export function ensureYearTargets(state, year, deps) {
  const yearNum = Number(year);
  const safeYear = Number.isInteger(yearNum) ? yearNum : getCurrentTargetYear();
  const yearKey = String(safeYear);

  if (!state.targets.years[yearKey]) {
    const created = deps.createDefaultTargetYear(safeYear);
    state.targets.years[yearKey] = created;
    const hasAllocationChanges = syncProductAllocationsWithProducts(state, created, deps);
    if (hasAllocationChanges) {
      created.updatedAt = new Date().toISOString();
    }
    deps.saveTargets(state);
    return created;
  }

  const normalized = deps.normalizeTargetYearData(safeYear, state.targets.years[yearKey]);
  state.targets.years[yearKey] = normalized;
  const hasAllocationChanges = syncProductAllocationsWithProducts(state, normalized, deps);
  if (hasAllocationChanges) {
    normalized.updatedAt = new Date().toISOString();
    deps.saveTargets(state);
  }
  return normalized;
}

export function getTargetYearOptions() {
  const currentYear = getCurrentTargetYear();
  const years = [];
  for (let year = currentYear - TARGET_YEAR_RANGE_OFFSET; year <= currentYear + TARGET_YEAR_RANGE_OFFSET; year += 1) {
    years.push(year);
  }
  return years;
}

export function getCurrentTargetYear() {
  return new Date().getFullYear();
}

export function getEffectiveMonthlyTargetMap(state, year, deps, metric = "amount") {
  const yearNum = Number(year);
  if (!Number.isInteger(yearNum)) return null;

  const yearData = state.targets.years[String(yearNum)];
  if (!yearData) return null;

  const validation = validateYearTargets(yearData, deps, metric);
  if (!validation.isEffective) return null;

  return buildMonthlyTargetMap(yearNum, yearData, metric);
}

export function getProductMonthlyAllocationMap(state, year, _deps, metric = "amount") {
  const yearNum = Number(year);
  if (!Number.isInteger(yearNum)) return null;

  const yearData = state.targets.years[String(yearNum)];
  if (!yearData || typeof yearData !== "object") return null;

  return buildProductAllocationMap(yearNum, yearData, metric);
}

function syncProductAllocationsWithProducts(state, yearData, deps) {
  const allocations = getYearProductAllocations(yearData);
  let changed = false;

  for (const rawKey of Object.keys(allocations)) {
    const entry = allocations[rawKey];
    const safeProductId = String((entry && entry.productId) || rawKey || "").trim();
    if (!safeProductId) {
      delete allocations[rawKey];
      changed = true;
      continue;
    }

    if (safeProductId !== rawKey) {
      if (!allocations[safeProductId]) {
        allocations[safeProductId] = entry;
      }
      delete allocations[rawKey];
      changed = true;
    }
  }

  for (const product of state.products) {
    const result = ensureProductAllocationEntry(allocations, product.id, product.productName, deps);
    if (result.changed) changed = true;
  }

  for (const [productId, entry] of Object.entries(allocations)) {
    if (!entry || typeof entry !== "object") {
      allocations[productId] = createDefaultProductAllocationEntry(productId, "");
      changed = true;
      continue;
    }
    const result = ensureProductAllocationEntry(allocations, productId, String(entry.productName || "").trim(), deps);
    if (result.changed) changed = true;
  }

  return changed;
}

function getYearProductAllocations(yearData) {
  if (!yearData.productAllocations || typeof yearData.productAllocations !== "object") {
    yearData.productAllocations = {};
  }
  return yearData.productAllocations;
}

function ensureProductAllocationEntry(allocations, productId, productName, deps) {
  const safeProductId = String(productId || "").trim();
  if (!safeProductId) return { changed: false, entry: null };

  let changed = false;
  let entry = allocations[safeProductId];
  if (!entry || typeof entry !== "object") {
    entry = createDefaultProductAllocationEntry(safeProductId, productName);
    allocations[safeProductId] = entry;
    changed = true;
  }

  if (entry.productId !== safeProductId) {
    entry.productId = safeProductId;
    changed = true;
  }

  const safeProductName = String(productName || "").trim();
  if (safeProductName && entry.productName !== safeProductName) {
    entry.productName = safeProductName;
    changed = true;
  }
  if (!safeProductName && typeof entry.productName !== "string") {
    entry.productName = "";
    changed = true;
  }

  for (const metric of ["amount", "quantity"]) {
    const key = metric === "quantity" ? "quantityMonths" : "amountMonths";
    const normalizedMonths = getProductAllocationMonths(entry, metric);
    if (!entry[key] || typeof entry[key] !== "object") {
      entry[key] = normalizedMonths;
      changed = true;
      continue;
    }
    for (const month of TARGET_ALLOCATION_MONTHS) {
      const monthKey = String(month);
      const normalizedValue = deps.normalizeTargetNumber(normalizedMonths[monthKey]);
      if (entry[key][monthKey] !== normalizedValue) {
        entry[key][monthKey] = normalizedValue;
        changed = true;
      }
    }
  }

  return { changed, entry };
}

function getProductAllocationRows(state, yearData, metric, deps) {
  const allocations = getYearProductAllocations(yearData);
  const activeIds = new Set(state.products.map((item) => item.id));

  const activeRows = state.products.map((product) => {
    const entry = allocations[product.id] && typeof allocations[product.id] === "object" ? allocations[product.id] : null;
    const months = getProductAllocationMonths(entry, metric);
    const valuesByMonth = {};
    for (const month of TARGET_ALLOCATION_MONTHS) {
      const monthKey = String(month);
      valuesByMonth[monthKey] = deps.normalizeTargetNumber(months[monthKey]);
    }

    return {
      productId: product.id,
      productName: product.productName,
      isDeleted: false,
      valuesByMonth,
    };
  });

  const deletedRows = Object.entries(allocations)
    .filter(([productId]) => !activeIds.has(productId))
    .map(([productId, entry]) => {
      const months = getProductAllocationMonths(entry, metric);
      const valuesByMonth = {};
      for (const month of TARGET_ALLOCATION_MONTHS) {
        const monthKey = String(month);
        valuesByMonth[monthKey] = deps.normalizeTargetNumber(months[monthKey]);
      }
      return {
        productId,
        productName: String((entry && entry.productName) || "").trim() || "未命名产品",
        isDeleted: true,
        valuesByMonth,
      };
    })
    .sort((left, right) =>
      left.productName.localeCompare(right.productName, "zh-Hans-CN", {
        numeric: true,
        sensitivity: "base",
      }),
    );

  return activeRows.concat(deletedRows);
}
