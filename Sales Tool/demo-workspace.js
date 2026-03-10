import { createDefaultTargetYear, createDefaultTargetsPayload, roundMoney } from "./storage.js";

const DEMO_PRODUCTS = Object.freeze([
  { id: "demo-product-1", productName: "匿名产品 A", unitPrice: 168 },
  { id: "demo-product-2", productName: "匿名产品 B", unitPrice: 236 },
  { id: "demo-product-3", productName: "匿名产品 C", unitPrice: 92 },
  { id: "demo-product-4", productName: "匿名产品 D", unitPrice: 148 },
  { id: "demo-product-5", productName: "匿名产品 E", unitPrice: 214 },
  { id: "demo-product-6", productName: "匿名产品 F", unitPrice: 126 },
]);

const DEMO_HOSPITALS = Object.freeze([
  "示例医院 01",
  "示例医院 02",
  "示例医院 03",
  "示例医院 04",
  "示例医院 05",
  "示例医院 06",
  "示例医院 07",
  "示例医院 08",
  "示例医院 09",
  "示例医院 10",
  "示例医院 11",
  "示例医院 12",
]);

const DEMO_DELIVERIES = Object.freeze(["国控", "上药", "华润", "九州通"]);

const MONTH_DAY_SERIES = Object.freeze([3, 5, 8, 10, 13, 15, 18, 20, 23, 25, 27, 29]);

const AMOUNT_QUARTER_TARGETS = Object.freeze([138000, 149000, 161000, 173000]);
const QUANTITY_QUARTER_TARGETS = Object.freeze([810, 875, 940, 995]);
const QUARTER_MONTH_SPLIT = Object.freeze([0.29, 0.33, 0.38]);
const PRODUCT_ALLOCATION_SPLIT = Object.freeze([0.34, 0.27, 0.23, 0.16]);

function padMonth(month) {
  return String(month).padStart(2, "0");
}

function buildIsoDate(year, month, day) {
  return `${year}-${padMonth(month)}-${String(day).padStart(2, "0")}`;
}

function getQuarterRange(date = new Date()) {
  const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const currentYear = safeDate.getFullYear();
  const currentMonth = safeDate.getMonth() + 1;
  let quarter = Math.floor(currentMonth / 3);
  let year = currentYear;

  if (quarter === 0) {
    quarter = 4;
    year -= 1;
  }

  const startMonth = (quarter - 1) * 3 + 1;
  const months = [startMonth, startMonth + 1, startMonth + 2];

  return {
    year,
    quarter,
    months,
    startYm: `${year}-${padMonth(startMonth)}`,
    endYm: `${year}-${padMonth(startMonth + 2)}`,
  };
}

function buildQuarterRecords({ year, months, products, quantityScale = 1, idPrefix }) {
  const records = [];

  months.forEach((month, monthIndex) => {
    if (!Number.isInteger(month)) {
      return;
    }

    products.forEach((product, productIndex) => {
      for (let visitIndex = 0; visitIndex < 2; visitIndex += 1) {
        const recordIndex = productIndex * 2 + visitIndex;
        const hospitalIndex = (monthIndex * 4 + productIndex * 2 + visitIndex) % DEMO_HOSPITALS.length;
        const quantitySeed = 8 + monthIndex * 3 + productIndex * 4 + visitIndex * 2;
        const seasonalBoost = monthIndex === 2 ? 3 : monthIndex === 1 ? 1 : 0;
        const quantity = Math.max(1, Math.round((quantitySeed + seasonalBoost) * quantityScale));

        records.push({
          id: `${idPrefix}-${monthIndex}-${productIndex}-${visitIndex}`,
          date: buildIsoDate(year, month, MONTH_DAY_SERIES[recordIndex] || 8),
          productId: product.id,
          productName: product.productName,
          unitPriceSnapshot: product.unitPrice,
          hospital: DEMO_HOSPITALS[hospitalIndex] || DEMO_HOSPITALS[0],
          quantity,
          amount: roundMoney(quantity * product.unitPrice),
          delivery: DEMO_DELIVERIES[(productIndex + monthIndex + visitIndex) % DEMO_DELIVERIES.length],
        });
      }
    });
  });

  return records;
}

function applyQuarterTargets(yearData, quarterIndex, amountTarget, quantityTarget) {
  const quarterKey = `Q${quarterIndex + 1}`;
  const amountQuarter = yearData.targets.amount.quarters[quarterKey];
  const quantityQuarter = yearData.targets.quantity.quarters[quarterKey];
  if (!amountQuarter || !quantityQuarter) {
    return;
  }

  amountQuarter.quarterTarget = amountTarget;
  quantityQuarter.quarterTarget = quantityTarget;

  const amountMonthValues = QUARTER_MONTH_SPLIT.map((ratio, index) =>
    index === QUARTER_MONTH_SPLIT.length - 1
      ? roundMoney(amountTarget - QUARTER_MONTH_SPLIT.slice(0, index).reduce((sum, item) => sum + roundMoney(amountTarget * item), 0))
      : roundMoney(amountTarget * ratio),
  );
  const quantityMonthValues = QUARTER_MONTH_SPLIT.map((ratio, index) =>
    index === QUARTER_MONTH_SPLIT.length - 1
      ? roundMoney(
          quantityTarget - QUARTER_MONTH_SPLIT.slice(0, index).reduce((sum, item) => sum + roundMoney(quantityTarget * item), 0),
        )
      : roundMoney(quantityTarget * ratio),
  );

  Object.keys(amountQuarter.months).forEach((monthKey, monthIndex) => {
    amountQuarter.months[monthKey] = amountMonthValues[monthIndex] || 0;
  });
  Object.keys(quantityQuarter.months).forEach((monthKey, monthIndex) => {
    quantityQuarter.months[monthKey] = quantityMonthValues[monthIndex] || 0;
  });
}

function fillProductAllocations(yearData, products, yearMultiplier = 1) {
  products.forEach((product, productIndex) => {
    const amountMonths = {};
    const quantityMonths = {};
    const amountBase = roundMoney((8800 + productIndex * 2300) * yearMultiplier);
    const quantityBase = roundMoney((48 + productIndex * 11) * yearMultiplier);

    for (let month = 1; month <= 12; month += 1) {
      const monthFactor = 1 + ((month - 1) % 3) * 0.08;
      amountMonths[String(month)] = roundMoney(amountBase * monthFactor);
      quantityMonths[String(month)] = roundMoney(quantityBase * monthFactor);
    }

    yearData.productAllocations[product.id] = {
      productId: product.id,
      productName: product.productName,
      amountMonths,
      quantityMonths,
    };
  });
}

function buildTargetsPayload(activeYear, products) {
  const payload = createDefaultTargetsPayload();
  const years = [activeYear - 1, activeYear];

  years.forEach((year, yearOffset) => {
    const yearData = createDefaultTargetYear(year);
    const yearMultiplier = yearOffset === 0 ? 0.86 : 1;

    AMOUNT_QUARTER_TARGETS.forEach((amountTarget, quarterIndex) => {
      const quantityTarget = QUANTITY_QUARTER_TARGETS[quarterIndex];
      applyQuarterTargets(
        yearData,
        quarterIndex,
        roundMoney(amountTarget * yearMultiplier),
        roundMoney(quantityTarget * yearMultiplier),
      );
    });

    fillProductAllocations(yearData, products, yearMultiplier);
    payload.years[String(year)] = yearData;
  });

  return payload;
}

function buildSalesDraft(range, products) {
  const primaryProduct = products[0];
  return {
    date: buildIsoDate(range.year, range.months[2], 18),
    productId: primaryProduct?.id || "",
    hospital: DEMO_HOSPITALS[0],
    quantity: "18",
    delivery: DEMO_DELIVERIES[0],
  };
}

export function createDemoWorkspaceSnapshot(date = new Date()) {
  const range = getQuarterRange(date);
  const products = DEMO_PRODUCTS.map((product) => ({ ...product }));
  const currentRangeRecords = buildQuarterRecords({
    year: range.year,
    months: range.months,
    products,
    quantityScale: 1,
    idPrefix: `demo-${range.year}`,
  });
  const comparisonRangeRecords = buildQuarterRecords({
    year: range.year - 1,
    months: range.months,
    products,
    quantityScale: 0.78,
    idPrefix: `demo-${range.year - 1}`,
  });
  const records = currentRangeRecords.concat(comparisonRangeRecords).sort((left, right) =>
    String(right.date || "").localeCompare(String(left.date || ""), "zh-Hans-CN"),
  );
  const targets = buildTargetsPayload(range.year, products);

  return {
    mode: "demo",
    products,
    targets,
    records,
    reportRecords: records.map((record) => ({ ...record })),
    recordListItems: records.map((record) => ({ ...record })),
    recordListTotal: records.length,
    reportRange: {
      startYm: range.startYm,
      endYm: range.endYm,
    },
    activeTargetYear: range.year,
    activeTargetMetric: "amount",
    salesDraft: buildSalesDraft(range, products),
    productDraft: {
      productName: "匿名产品 G",
      unitPrice: "198",
    },
    banner: {
      title: "当前展示的是模拟经营数据",
      description: "未登录时可完整浏览报表、录入、指标和列表示例；登录后即可改成你自己的真实数据。",
    },
  };
}
