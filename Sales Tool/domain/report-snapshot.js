const HOSPITAL_TOP_LIMIT = 20;
const HOSPITAL_CHART_TOP_LIMIT = 10;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeYm(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const matched = text.match(MONTH_RE);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return "";
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseYm(ym) {
  const matched = normalizeYm(ym).match(MONTH_RE);
  if (!matched) return null;
  return { year: Number(matched[1]), month: Number(matched[2]) };
}

function compareYm(left, right) {
  const parsedLeft = parseYm(left);
  const parsedRight = parseYm(right);
  if (!parsedLeft || !parsedRight) return 0;
  if (parsedLeft.year !== parsedRight.year) return parsedLeft.year - parsedRight.year;
  return parsedLeft.month - parsedRight.month;
}

function addMonthsToYm(ym, deltaMonths) {
  const parsed = parseYm(ym);
  const delta = Number(deltaMonths);
  if (!parsed || !Number.isInteger(delta)) return "";
  const nextMonthIndex = parsed.year * 12 + (parsed.month - 1) + delta;
  const year = Math.floor(nextMonthIndex / 12);
  const month = (nextMonthIndex % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function addYearsToYm(ym, offsetYears) {
  const parsed = parseYm(ym);
  if (!parsed || !Number.isInteger(offsetYears)) return "";
  return `${parsed.year + offsetYears}-${String(parsed.month).padStart(2, "0")}`;
}

function listYmRange(startYm, endYm) {
  const safeStart = normalizeYm(startYm);
  const safeEnd = normalizeYm(endYm);
  if (!safeStart || !safeEnd || compareYm(safeStart, safeEnd) > 0) return [];
  const months = [];
  let current = safeStart;
  while (current && compareYm(current, safeEnd) <= 0) {
    months.push(current);
    const parsed = parseYm(current);
    const nextMonth = parsed.month === 12 ? 1 : parsed.month + 1;
    const nextYear = parsed.month === 12 ? parsed.year + 1 : parsed.year;
    current = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
  }
  return months;
}

function parseRecordDate(rawDate, deps) {
  const text = String(rawDate || "").trim();
  if (!text) return null;
  const matched = text.match(DATE_RE);
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
  return `name:${deps.normalizeText(record.productName) || "未命名产品"}`;
}

function parseProductIdFromKey(productKey) {
  const text = String(productKey || "").trim();
  return text.startsWith("id:") ? text.slice(3) : "";
}

function addValue(map, key, amount, quantity) {
  const current = map.get(key) || { amount: 0, quantity: 0, count: 0 };
  current.amount += amount;
  current.quantity += quantity;
  current.count += 1;
  map.set(key, current);
}

function addNestedValue(outerMap, outerKey, innerKey, amount, quantity) {
  const innerMap = outerMap.get(outerKey) || new Map();
  addValue(innerMap, innerKey, amount, quantity);
  outerMap.set(outerKey, innerMap);
}

function readValue(map, key, deps) {
  const value = map.get(key) || { amount: 0, quantity: 0, count: 0 };
  return {
    amount: deps.roundMoney(value.amount || 0),
    quantity: deps.roundMoney(value.quantity || 0),
    count: Number(value.count || 0),
  };
}

function sumMonths(map, months, deps) {
  let amount = 0;
  let quantity = 0;
  let count = 0;
  for (const month of months) {
    const value = map.get(month) || { amount: 0, quantity: 0, count: 0 };
    amount += Number(value.amount || 0);
    quantity += Number(value.quantity || 0);
    count += Number(value.count || 0);
  }
  return {
    amount: deps.roundMoney(amount),
    quantity: deps.roundMoney(quantity),
    count,
  };
}

function buildQuarterMonths(year, quarter) {
  const startMonth = (quarter - 1) * 3 + 1;
  return [0, 1, 2].map((offset) => `${year}-${String(startMonth + offset).padStart(2, "0")}`);
}

function buildCompleteQuarters(monthKeys, monthSet) {
  const quarters = [];
  const seen = new Set();
  for (const ym of monthKeys) {
    const parsed = parseYm(ym);
    if (!parsed) continue;
    const quarter = Math.floor((parsed.month - 1) / 3) + 1;
    const quarterKey = `${parsed.year}-Q${quarter}`;
    if (seen.has(quarterKey)) continue;
    const months = buildQuarterMonths(parsed.year, quarter);
    if (months.every((month) => monthSet.has(month))) {
      const prevQuarter = quarter === 1 ? 4 : quarter - 1;
      const prevYear = quarter === 1 ? parsed.year - 1 : parsed.year;
      quarters.push({
        year: parsed.year,
        quarter,
        months,
        prevYear,
        prevQuarter,
      });
      seen.add(quarterKey);
    }
  }
  return quarters;
}

function calcRate(numerator, denominator) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return null;
  return Number((top / bottom).toFixed(6));
}

function calcGrowth(current, baseline) {
  const currentValue = Number(current);
  const baselineValue = Number(baseline);
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue) || baselineValue === 0) return null;
  return Number(((currentValue - baselineValue) / Math.abs(baselineValue)).toFixed(6));
}

export function buildReportSnapshot(state, deps, range) {
  const monthKeys = listYmRange(range.startYm, range.endYm);
  const monthSet = new Set(monthKeys);

  const monthlyTotals = new Map();
  const productMonthlyTotals = new Map();
  const productNames = new Map();
  const hospitalMonthlyTotals = new Map();
  const hospitalNames = new Map();

  for (const record of state.records) {
    const parsed = parseRecordDate(record.date, deps);
    if (!parsed) continue;

    const ym = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;
    const amount = Number(record.amount);
    const quantity = Number(record.quantity);
    if (!Number.isFinite(amount) || !Number.isFinite(quantity)) continue;

    addValue(monthlyTotals, ym, amount, quantity);

    const productName = String(record.productName || "").trim() || "未命名产品";
    const productKey = buildProductKey(record, deps);
    if (!productNames.has(productKey)) {
      productNames.set(productKey, productName);
    }
    addNestedValue(productMonthlyTotals, productKey, ym, amount, quantity);

    const hospitalName = String(record.hospital || "").trim() || "未命名医院";
    const hospitalKey = deps.normalizeText(record.hospital) || "未命名医院";
    if (!hospitalNames.has(hospitalKey)) {
      hospitalNames.set(hospitalKey, hospitalName);
    }
    addNestedValue(hospitalMonthlyTotals, hospitalKey, ym, amount, quantity);
  }

  const targetCache = new Map();
  const productTargetCache = new Map();
  const targetUnavailableYears = new Set();

  const getMonthTarget = (ym) => {
    const parsedYm = parseYm(ym);
    if (!parsedYm) return null;

    if (!targetCache.has(parsedYm.year)) {
      const yearTargetMap = typeof deps.getEffectiveMonthlyTargetMap === "function" ? deps.getEffectiveMonthlyTargetMap(parsedYm.year) : null;
      targetCache.set(parsedYm.year, yearTargetMap);
      if (!yearTargetMap) {
        targetUnavailableYears.add(parsedYm.year);
      }
    }

    const monthMap = targetCache.get(parsedYm.year);
    if (!monthMap) return null;

    const targetValue = Number(monthMap[ym]);
    if (!Number.isFinite(targetValue)) return null;

    return deps.roundMoney(targetValue);
  };

  const getProductMonthAllocation = (ym, productId) => {
    const safeProductId = String(productId || "").trim();
    if (!safeProductId) return null;

    const parsedYm = parseYm(ym);
    if (!parsedYm) return 0;

    if (!productTargetCache.has(parsedYm.year)) {
      const yearAllocationMap =
        typeof deps.getProductMonthlyAllocationMap === "function" ? deps.getProductMonthlyAllocationMap(parsedYm.year) : null;
      productTargetCache.set(parsedYm.year, yearAllocationMap);
    }

    const monthMap = productTargetCache.get(parsedYm.year);
    if (!monthMap || typeof monthMap !== "object") return 0;

    const monthProductMap = monthMap[ym];
    if (!monthProductMap || typeof monthProductMap !== "object") return 0;

    const value = Number(monthProductMap[safeProductId]);
    if (!Number.isFinite(value)) return 0;
    return deps.roundMoney(value);
  };

  const monthRows = monthKeys.map((ym) => {
    const actual = readValue(monthlyTotals, ym, deps);
    const targetAmount = getMonthTarget(ym);

    const yoyYm = addYearsToYm(ym, -1);
    const prevYm = addMonthsToYm(ym, -1);

    const yoy = readValue(monthlyTotals, yoyYm, deps);
    const prev = readValue(monthlyTotals, prevYm, deps);

    return {
      ym,
      targetAmount,
      amount: actual.amount,
      quantity: actual.quantity,
      amountAchievement: calcRate(actual.amount, targetAmount),
      amountYoy: calcGrowth(actual.amount, yoy.amount),
      amountMom: calcGrowth(actual.amount, prev.amount),
      quantityYoy: calcGrowth(actual.quantity, yoy.quantity),
      quantityMom: calcGrowth(actual.quantity, prev.quantity),
    };
  });

  const completeQuarters = buildCompleteQuarters(monthKeys, monthSet);
  const quarterRows = completeQuarters.map((quarter) => {
    const actual = sumMonths(monthlyTotals, quarter.months, deps);

    const targetMonthValues = quarter.months.map((ym) => getMonthTarget(ym));
    const targetAmount = targetMonthValues.some((value) => value === null)
      ? null
      : deps.roundMoney(targetMonthValues.reduce((sum, value) => sum + Number(value), 0));

    const yoyQuarterMonths = quarter.months.map((ym) => addYearsToYm(ym, -1));
    const prevQuarterMonths = buildQuarterMonths(quarter.prevYear, quarter.prevQuarter);

    const yoy = sumMonths(monthlyTotals, yoyQuarterMonths, deps);
    const prev = sumMonths(monthlyTotals, prevQuarterMonths, deps);

    return {
      label: `${quarter.year} Q${quarter.quarter}`,
      targetAmount,
      amount: actual.amount,
      quantity: actual.quantity,
      amountAchievement: calcRate(actual.amount, targetAmount),
      amountYoy: calcGrowth(actual.amount, yoy.amount),
      amountQoq: calcGrowth(actual.amount, prev.amount),
      quantityYoy: calcGrowth(actual.quantity, yoy.quantity),
      quantityQoq: calcGrowth(actual.quantity, prev.quantity),
    };
  });

  const prevYearMonthSet = new Set(monthKeys.map((ym) => addYearsToYm(ym, -1)));
  const productRows = [];
  const hospitalRows = [];

  let rangeAmountTotal = 0;
  let rangeQuantityTotal = 0;
  let rangeRecordCount = 0;
  let hasRangeRecords = false;
  let rangeTargetAmountTotal = 0;
  let hasMissingRangeTarget = false;

  for (const ym of monthKeys) {
    const current = readValue(monthlyTotals, ym, deps);
    if (current.count > 0) {
      hasRangeRecords = true;
      rangeRecordCount += current.count;
    }
    rangeAmountTotal += current.amount;
    rangeQuantityTotal += current.quantity;

    const monthTarget = getMonthTarget(ym);
    if (monthTarget === null) {
      hasMissingRangeTarget = true;
      continue;
    }
    rangeTargetAmountTotal += Number(monthTarget);
  }

  rangeAmountTotal = deps.roundMoney(rangeAmountTotal);
  rangeQuantityTotal = deps.roundMoney(rangeQuantityTotal);
  rangeTargetAmountTotal = hasMissingRangeTarget ? null : deps.roundMoney(rangeTargetAmountTotal);
  const rangeAmountAchievement = calcRate(rangeAmountTotal, rangeTargetAmountTotal);

  for (const [productKey, byMonthMap] of productMonthlyTotals.entries()) {
    const current = sumMonths(byMonthMap, monthKeys, deps);
    if (current.count === 0) continue;

    const previous = sumMonths(byMonthMap, prevYearMonthSet, deps);
    const productId = parseProductIdFromKey(productKey);

    let targetAmount = null;
    if (productId) {
      let targetSum = 0;
      for (const ym of monthKeys) {
        targetSum += Number(getProductMonthAllocation(ym, productId) || 0);
      }
      targetAmount = deps.roundMoney(targetSum);
    }

    productRows.push({
      productKey,
      productName: productNames.get(productKey) || "未命名产品",
      amount: current.amount,
      targetAmount,
      amountAchievement: calcRate(current.amount, targetAmount),
      quantity: current.quantity,
      amountShare: calcRate(current.amount, rangeAmountTotal),
      quantityShare: calcRate(current.quantity, rangeQuantityTotal),
      amountYoy: calcGrowth(current.amount, previous.amount),
      quantityYoy: calcGrowth(current.quantity, previous.quantity),
    });
  }

  productRows.sort((a, b) => b.amount - a.amount);

  for (const [hospitalKey, byMonthMap] of hospitalMonthlyTotals.entries()) {
    const current = sumMonths(byMonthMap, monthKeys, deps);
    if (current.count === 0) continue;

    const previous = sumMonths(byMonthMap, prevYearMonthSet, deps);
    hospitalRows.push({
      hospitalKey,
      hospitalName: hospitalNames.get(hospitalKey) || "未命名医院",
      amount: current.amount,
      quantity: current.quantity,
      amountShare: calcRate(current.amount, rangeAmountTotal),
      quantityShare: calcRate(current.quantity, rangeQuantityTotal),
      amountYoy: calcGrowth(current.amount, previous.amount),
      quantityYoy: calcGrowth(current.quantity, previous.quantity),
    });
  }

  hospitalRows.sort((a, b) => {
    if (a.amount !== b.amount) return b.amount - a.amount;
    if (a.quantity !== b.quantity) return b.quantity - a.quantity;
    return a.hospitalName.localeCompare(b.hospitalName, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  });

  const productMonthlySeries = {};
  for (const row of productRows) {
    const safeProductKey = String(row.productKey || "").trim();
    if (!safeProductKey) continue;

    const byMonthMap = productMonthlyTotals.get(safeProductKey);
    if (!(byMonthMap instanceof Map)) continue;

    const series = {};
    for (const ym of monthKeys) {
      const monthMetric = readValue(byMonthMap, ym, deps);
      series[ym] = monthMetric.amount;
    }
    productMonthlySeries[safeProductKey] = series;
  }

  const hospitalTopRows = hospitalRows.slice(0, HOSPITAL_CHART_TOP_LIMIT);
  const hospitalMonthlySeries = {};
  for (const row of hospitalTopRows) {
    const safeHospitalKey = String(row.hospitalKey || "").trim();
    if (!safeHospitalKey) continue;

    const byMonthMap = hospitalMonthlyTotals.get(safeHospitalKey);
    if (!(byMonthMap instanceof Map)) continue;

    const series = {};
    for (const ym of monthKeys) {
      const currentMetric = readValue(byMonthMap, ym, deps);
      series[ym] = currentMetric.amount;

      const yoyYm = addYearsToYm(ym, -1);
      if (yoyYm && !(yoyYm in series)) {
        const yoyMetric = readValue(byMonthMap, yoyYm, deps);
        series[yoyYm] = yoyMetric.amount;
      }
    }

    hospitalMonthlySeries[safeHospitalKey] = series;
  }

  return {
    monthRows,
    quarterRows,
    productRows,
    productMonthlySeries,
    hospitalTopRows,
    hospitalMonthlySeries,
    hospitalRows: hospitalRows.slice(0, HOSPITAL_TOP_LIMIT),
    hospitalTotalCount: hospitalRows.length,
    rangeRecordCount,
    rangeAmountTotal,
    rangeTargetAmountTotal,
    rangeAmountAchievement,
    hasRangeRecords,
    hasTargetGap: targetUnavailableYears.size > 0,
    targetGapYears: Array.from(targetUnavailableYears).sort((a, b) => a - b),
  };
}
