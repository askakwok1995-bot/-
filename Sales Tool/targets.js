const TARGET_SAVE_DEBOUNCE_MS = 250;
const TARGET_YEAR_RANGE_OFFSET = 2;
const TARGET_QUARTER_TOLERANCE = 0.009;
const TARGET_PRODUCT_ALLOCATION_TOLERANCE = 0.009;
const TARGET_ALLOCATION_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function renderReportsIfAvailable(deps) {
  if (typeof deps.renderReports === "function") {
    deps.renderReports();
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
    ensureYearTargets(state, state.activeTargetYear, deps);
    renderTargetInputSection(state, dom, deps);
    renderReportsIfAvailable(deps);
  });

  if (dom.targetProductAllocQuarterSelect instanceof HTMLSelectElement) {
    dom.targetProductAllocQuarterSelect.addEventListener("change", () => {
      const nextQuarter = normalizeTargetAllocationQuarter(dom.targetProductAllocQuarterSelect.value, deps);
      state.activeTargetAllocationQuarter = nextQuarter;
      state.targetProductAllocationFormatError = "";

      ensureYearTargets(state, state.activeTargetYear, deps);
      renderTargetInputSection(state, dom, deps);
    });
  }

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

  const yearData = ensureYearTargets(state, state.activeTargetYear, deps);
  const quarterData = yearData.quarters[quarterKey];
  if (!quarterData) return;

  const parsed = parseTargetInputValue(input.value);
  if (!parsed.ok) {
    state.targetInputFormatError = "指标必须为非负数字（支持小数），保存时会保留两位小数。";
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
  if (!productId) return;

  const activeQuarter = normalizeTargetAllocationQuarter(state.activeTargetAllocationQuarter, deps);
  const quarterMonths = getQuarterMonthsByKey(activeQuarter, deps);
  const month = normalizeTargetAllocationMonth(input.dataset.month || quarterMonths[0]);
  const monthKey = String(month);
  state.activeTargetAllocationQuarter = activeQuarter;

  const yearData = ensureYearTargets(state, state.activeTargetYear, deps);
  const allocations = getYearProductAllocations(yearData);
  const { entry } = ensureProductAllocationEntry(allocations, productId, "", deps);
  if (!entry) return;

  const parsed = parseTargetInputValue(input.value);
  if (!parsed.ok) {
    state.targetProductAllocationFormatError = "分配金额必须为非负数字（支持小数），保存时会保留两位小数。";
    renderTargetProductAllocationHint(state, dom, deps, yearData);
    return;
  }

  state.targetProductAllocationFormatError = "";
  entry.months[monthKey] = parsed.value;
  yearData.updatedAt = new Date().toISOString();

  scheduleTargetSave(state, deps);
  renderTargetProductAllocationHint(state, dom, deps, yearData);

  if (shouldRenderAfterSave) {
    flushTargetSave(state, deps);
    renderTargetInputSection(state, dom, deps);
  }
}

function handleQuarterSplitClick(state, dom, deps, quarterKey) {
  const yearData = ensureYearTargets(state, state.activeTargetYear, deps);
  const quarterData = yearData.quarters[quarterKey];
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

  yearData.updatedAt = new Date().toISOString();
  state.targetInputFormatError = "";

  flushTargetSave(state, deps);
  renderTargetInputSection(state, dom, deps);
  renderReportsIfAvailable(deps);
}

function handleClearTargetPageClick(state, dom, deps) {
  const yearNum = Number(state.activeTargetYear);
  const safeYear = Number.isInteger(yearNum) ? yearNum : getCurrentTargetYear();
  const confirmed = window.confirm(`确定清空 ${safeYear} 年指标录入本页数据吗？`);
  if (!confirmed) return;

  const yearData = ensureYearTargets(state, safeYear, deps);
  for (const quarter of deps.TARGET_QUARTERS) {
    const quarterData = yearData.quarters[quarter.key];
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
  const yearNum = Number(state.activeTargetYear);
  const safeYear = Number.isInteger(yearNum) ? yearNum : getCurrentTargetYear();
  const quarterKey = normalizeTargetAllocationQuarter(state.activeTargetAllocationQuarter, deps);
  const confirmed = window.confirm(`确定清空 ${safeYear} 年 ${quarterKey} 产品分配本页数据吗？`);
  if (!confirmed) return;

  const yearData = ensureYearTargets(state, safeYear, deps);
  const quarterMonths = getQuarterMonthsByKey(quarterKey, deps);
  const allocations = getYearProductAllocations(yearData);

  for (const [productId, entry] of Object.entries(allocations)) {
    const productName = String((entry && entry.productName) || "").trim();
    const result = ensureProductAllocationEntry(allocations, productId, productName, deps);
    if (!result.entry) continue;

    for (const month of quarterMonths) {
      result.entry.months[String(month)] = 0;
    }
  }

  state.activeTargetAllocationQuarter = quarterKey;
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

  const yearOptions = getTargetYearOptions();
  if (!yearOptions.includes(state.activeTargetYear)) {
    state.activeTargetYear = getCurrentTargetYear();
  }

  dom.targetYearSelect.innerHTML = yearOptions
    .map((year) => `<option value="${deps.escapeHtml(String(year))}">${deps.escapeHtml(String(year))}年</option>`)
    .join("");
  dom.targetYearSelect.value = String(state.activeTargetYear);

  const yearData = ensureYearTargets(state, state.activeTargetYear, deps);
  const validation = validateYearTargets(yearData, deps);

  dom.targetInputBody.innerHTML = deps.TARGET_QUARTERS.map((quarter) => {
    const detail = validation.quarterStates[quarter.key];
    const quarterData = yearData.quarters[quarter.key];
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

  renderTargetStatus(state, dom, validation);
  renderTargetError(state, dom, validation);
  renderTargetProductAllocationSection(state, dom, deps, yearData);
}

export function refreshTargetValidationUI(state, dom, deps, yearData) {
  if (!(dom.targetInputBody instanceof HTMLElement)) return;

  const validation = validateYearTargets(yearData, deps);
  for (const quarter of deps.TARGET_QUARTERS) {
    const detail = validation.quarterStates[quarter.key];
    const row = dom.targetInputBody.querySelector(`tr[data-quarter="${quarter.key}"]`);
    if (row instanceof HTMLTableRowElement) {
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
  }

  renderTargetStatus(state, dom, validation);
  renderTargetError(state, dom, validation);
}

export function renderTargetStatus(state, dom, validation) {
  if (!(dom.targetStatusEl instanceof HTMLElement)) return;

  if (validation.isEffective) {
    dom.targetStatusEl.textContent = `${state.activeTargetYear} 年指标状态：已生效`;
    dom.targetStatusEl.classList.remove("target-status-invalid");
    return;
  }

  dom.targetStatusEl.textContent = `${state.activeTargetYear} 年指标状态：未生效（${validation.errors.length} 个季度待修正）`;
  dom.targetStatusEl.classList.add("target-status-invalid");
}

export function renderTargetError(state, dom, validation) {
  if (!(dom.targetErrorEl instanceof HTMLElement)) return;

  const messages = [];
  if (state.targetInputFormatError) {
    messages.push(state.targetInputFormatError);
  }

  for (const error of validation.errors) {
    messages.push(error.message);
  }

  dom.targetErrorEl.textContent = messages.join("；");
}

function renderTargetProductAllocationSection(state, dom, deps, yearData) {
  if (!(dom.targetProductAllocQuarterSelect instanceof HTMLSelectElement)) return;
  if (!(dom.targetProductAllocBody instanceof HTMLElement)) return;

  const quarterKey = normalizeTargetAllocationQuarter(state.activeTargetAllocationQuarter, deps);
  state.activeTargetAllocationQuarter = quarterKey;
  const quarterMonths = getQuarterMonthsByKey(quarterKey, deps);

  dom.targetProductAllocQuarterSelect.innerHTML = deps.TARGET_QUARTERS.map(
    (quarter) => `<option value="${deps.escapeHtml(quarter.key)}">${deps.escapeHtml(quarter.label)}</option>`,
  ).join("");
  dom.targetProductAllocQuarterSelect.value = quarterKey;

  if (dom.targetProductAllocMonthCol1 instanceof HTMLElement) {
    dom.targetProductAllocMonthCol1.textContent = `分配金额（${quarterMonths[0]}月）`;
  }
  if (dom.targetProductAllocMonthCol2 instanceof HTMLElement) {
    dom.targetProductAllocMonthCol2.textContent = `分配金额（${quarterMonths[1]}月）`;
  }
  if (dom.targetProductAllocMonthCol3 instanceof HTMLElement) {
    dom.targetProductAllocMonthCol3.textContent = `分配金额（${quarterMonths[2]}月）`;
  }

  const rows = getProductAllocationRowsForQuarter(state, yearData, quarterMonths, deps);
  if (rows.length === 0) {
    dom.targetProductAllocBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty">暂无产品配置</td>
      </tr>
    `;
  } else {
    dom.targetProductAllocBody.innerHTML = rows
      .map((row) => {
        const statusText = row.isDeleted ? "已删除" : "正常";
        const statusClass = row.isDeleted ? "target-product-alloc-status-deleted" : "";
        const monthCells = quarterMonths
          .map((month) => {
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
          })
          .join("");

        return `
          <tr>
            <td class="target-product-alloc-name">${deps.escapeHtml(row.productName || "未命名产品")}</td>
            ${monthCells}
            <td class="target-product-alloc-status ${statusClass}">${statusText}</td>
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

  const quarterKey = normalizeTargetAllocationQuarter(state.activeTargetAllocationQuarter, deps);
  state.activeTargetAllocationQuarter = quarterKey;

  const quarterTarget = getQuarterTargetValue(yearData, quarterKey, deps);
  const quarterAllocated = getQuarterAllocatedValue(yearData, quarterKey, deps);
  const quarterDiff = deps.roundMoney(quarterAllocated - quarterTarget);
  const quarterAbsDiff = deps.roundMoney(Math.abs(quarterDiff));
  const quarterMatched = quarterAbsDiff <= TARGET_PRODUCT_ALLOCATION_TOLERANCE;
  const monthStats = buildQuarterMonthAllocationStats(yearData, quarterKey, deps);

  dom.targetProductAllocSummaryEl.textContent = `${quarterKey}目标：${deps.formatMoney(quarterTarget)}；已分配：${deps.formatMoney(
    quarterAllocated,
  )}；差额：${deps.formatMoney(quarterDiff)}`;

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

  const monthWarnings = [];
  const monthErrors = [];
  for (const stat of monthStats) {
    if (stat.isMatched) continue;
    if (stat.diff < 0) {
      monthWarnings.push(`${stat.month}月尚未分配 ${deps.formatMoney(stat.absDiff)}`);
    } else {
      monthErrors.push(`${stat.month}月超分配 ${deps.formatMoney(stat.absDiff)}`);
    }
  }

  if (monthWarnings.length === 0 && monthErrors.length === 0 && quarterMatched) {
    dom.targetProductAllocHintEl.textContent = "该季度3个月均已对齐，季度合计已对齐。";
    dom.targetProductAllocHintEl.classList.add("target-product-alloc-hint-ok");
    return;
  }

  const messages = [];
  messages.push(...monthWarnings);
  messages.push(...monthErrors);

  if (!quarterMatched) {
    if (quarterDiff < 0) {
      messages.push(`季度合计尚未分配 ${deps.formatMoney(quarterAbsDiff)}`);
    } else {
      messages.push(`季度合计超分配 ${deps.formatMoney(quarterAbsDiff)}`);
    }
  }

  dom.targetProductAllocHintEl.textContent = messages.join("；");
  const hasError = monthErrors.length > 0 || quarterDiff > TARGET_PRODUCT_ALLOCATION_TOLERANCE;
  dom.targetProductAllocHintEl.classList.add(hasError ? "target-product-alloc-hint-error" : "target-product-alloc-hint-warn");
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

export function validateYearTargets(yearData, deps) {
  const errors = [];
  const quarterStates = {};

  for (const quarter of deps.TARGET_QUARTERS) {
    const quarterData = yearData.quarters[quarter.key];
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
        message: `${quarter.key} 季度目标(${deps.formatMoney(quarterTarget)})与月度合计(${deps.formatMoney(monthSum)})不一致。`,
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
  for (
    let year = currentYear - TARGET_YEAR_RANGE_OFFSET;
    year <= currentYear + TARGET_YEAR_RANGE_OFFSET;
    year += 1
  ) {
    years.push(year);
  }
  return years;
}

export function getCurrentTargetYear() {
  return new Date().getFullYear();
}

export function getEffectiveMonthlyTargetMap(state, year, deps) {
  const yearNum = Number(year);
  if (!Number.isInteger(yearNum)) return null;

  const yearData = state.targets.years[String(yearNum)];
  if (!yearData) return null;

  const validation = validateYearTargets(yearData, deps);
  if (!validation.isEffective) return null;

  const monthMap = {};
  for (const quarter of deps.TARGET_QUARTERS) {
    const quarterData = yearData.quarters[quarter.key];
    for (const month of quarter.months) {
      const monthKey = `${yearNum}-${String(month).padStart(2, "0")}`;
      monthMap[monthKey] = deps.normalizeTargetNumber(quarterData.months[String(month)]);
    }
  }

  return monthMap;
}

export function getProductMonthlyAllocationMap(state, year, deps) {
  const yearNum = Number(year);
  if (!Number.isInteger(yearNum)) return null;

  const yearData = state.targets.years[String(yearNum)];
  if (!yearData || typeof yearData !== "object") return null;

  const allocations = getYearProductAllocations(yearData);
  const result = {};
  for (const month of TARGET_ALLOCATION_MONTHS) {
    const monthKey = String(month);
    const ym = `${yearNum}-${String(month).padStart(2, "0")}`;
    const byProduct = {};

    for (const [productId, entry] of Object.entries(allocations)) {
      if (!entry || typeof entry !== "object") continue;
      byProduct[productId] = deps.normalizeTargetNumber(entry.months ? entry.months[monthKey] : 0);
    }

    result[ym] = byProduct;
  }

  return result;
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
    const entry = ensureProductAllocationEntry(allocations, product.id, product.productName, deps);
    if (entry.changed) changed = true;
  }

  for (const [productId, entry] of Object.entries(allocations)) {
    if (!entry || typeof entry !== "object") {
      allocations[productId] = createDefaultProductAllocationEntry(productId, "");
      changed = true;
      continue;
    }

    const normalizedEntry = ensureProductAllocationEntry(allocations, productId, String(entry.productName || "").trim(), deps);
    if (normalizedEntry.changed) changed = true;
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

  if (!entry.months || typeof entry.months !== "object") {
    entry.months = createDefaultProductAllocationMonths();
    changed = true;
  }

  for (const month of TARGET_ALLOCATION_MONTHS) {
    const monthKey = String(month);
    const normalized = deps.normalizeTargetNumber(entry.months[monthKey]);
    if (entry.months[monthKey] !== normalized) {
      entry.months[monthKey] = normalized;
      changed = true;
    }
  }

  return { changed, entry };
}

function createDefaultProductAllocationEntry(productId, productName) {
  return {
    productId: String(productId || "").trim(),
    productName: String(productName || "").trim(),
    months: createDefaultProductAllocationMonths(),
  };
}

function createDefaultProductAllocationMonths() {
  const months = {};
  for (const month of TARGET_ALLOCATION_MONTHS) {
    months[String(month)] = 0;
  }
  return months;
}

function getProductAllocationRowsForQuarter(state, yearData, quarterMonths, deps) {
  const allocations = getYearProductAllocations(yearData);
  const activeIds = new Set(state.products.map((item) => item.id));

  const activeRows = state.products.map((product) => {
    const entry = allocations[product.id] && typeof allocations[product.id] === "object" ? allocations[product.id] : null;
    const months = entry && entry.months && typeof entry.months === "object" ? entry.months : {};
    const valuesByMonth = {};
    for (const month of quarterMonths) {
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
      const valuesByMonth = {};
      for (const month of quarterMonths) {
        const monthKey = String(month);
        valuesByMonth[monthKey] = deps.normalizeTargetNumber(entry && entry.months ? entry.months[monthKey] : 0);
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

function getQuarterTargetValue(yearData, quarterKey, deps) {
  const quarterMonths = getQuarterMonthsByKey(quarterKey, deps);
  const quarterData = yearData.quarters[quarterKey];
  if (!quarterData) return 0;

  let sum = 0;
  for (const month of quarterMonths) {
    sum += deps.normalizeTargetNumber(quarterData.months[String(month)]);
  }
  return deps.roundMoney(sum);
}

function getQuarterAllocatedValue(yearData, quarterKey, deps) {
  const quarterMonths = getQuarterMonthsByKey(quarterKey, deps);
  const allocations = getYearProductAllocations(yearData);
  let sum = 0;
  for (const entry of Object.values(allocations)) {
    if (!entry || typeof entry !== "object") continue;
    const months = entry.months && typeof entry.months === "object" ? entry.months : {};
    for (const month of quarterMonths) {
      sum += deps.normalizeTargetNumber(months[String(month)]);
    }
  }
  return deps.roundMoney(sum);
}

function buildQuarterMonthAllocationStats(yearData, quarterKey, deps) {
  const quarterMonths = getQuarterMonthsByKey(quarterKey, deps);
  const allocations = getYearProductAllocations(yearData);
  const quarterData = yearData.quarters[quarterKey];
  if (!quarterData) return [];

  const stats = [];
  for (const month of quarterMonths) {
    const monthKey = String(month);
    const target = deps.normalizeTargetNumber(quarterData.months[monthKey]);
    let allocated = 0;
    for (const entry of Object.values(allocations)) {
      if (!entry || typeof entry !== "object") continue;
      const months = entry.months && typeof entry.months === "object" ? entry.months : {};
      allocated += deps.normalizeTargetNumber(months[monthKey]);
    }
    allocated = deps.roundMoney(allocated);
    const diff = deps.roundMoney(allocated - target);
    const absDiff = deps.roundMoney(Math.abs(diff));
    stats.push({
      month,
      target,
      allocated,
      diff,
      absDiff,
      isMatched: absDiff <= TARGET_PRODUCT_ALLOCATION_TOLERANCE,
    });
  }

  return stats;
}

function normalizeTargetAllocationMonth(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 12) {
    return 1;
  }
  return value;
}

function normalizeTargetAllocationQuarter(raw, deps) {
  const key = String(raw || "").trim().toUpperCase();
  if (deps.TARGET_QUARTERS.some((quarter) => quarter.key === key)) {
    return key;
  }
  return getCurrentTargetAllocationQuarter();
}

function getCurrentTargetAllocationQuarter() {
  return `Q${Math.floor(new Date().getMonth() / 3) + 1}`;
}

function getQuarterMonthsByKey(quarterKey, deps) {
  const found = deps.TARGET_QUARTERS.find((quarter) => quarter.key === quarterKey);
  if (found && Array.isArray(found.months) && found.months.length === 3) {
    return found.months;
  }
  const fallback = deps.TARGET_QUARTERS[0];
  return fallback && Array.isArray(fallback.months) ? fallback.months : [1, 2, 3];
}
