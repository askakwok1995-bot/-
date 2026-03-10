import { createDefaultTargetYear, createDefaultTargetsPayload, roundMoney } from "./storage.js";

const DEMO_PRODUCTS = Object.freeze([
  { id: "demo-product-1", productName: "瑞舒伐他汀 10mg*28片", unitPrice: 168 },
  { id: "demo-product-2", productName: "恩格列净 10mg*30片", unitPrice: 236 },
  { id: "demo-product-3", productName: "阿奇霉素 0.25g*6片", unitPrice: 92 },
  { id: "demo-product-4", productName: "注射用头孢唑肟 1.0g", unitPrice: 148 },
]);

const DEMO_HOSPITALS = Object.freeze([
  "上海瑞金医院",
  "上海中山医院",
  "苏州大学附属第一医院",
  "杭州邵逸夫医院",
  "宁波市第一医院",
  "无锡市人民医院",
]);

const DEMO_DELIVERIES = Object.freeze(["国控", "上药", "华润", "九州通"]);

const MONTH_DAY_SERIES = Object.freeze([5, 9, 12, 18, 21, 26]);

const RANGE_BLUEPRINTS = Object.freeze([
  {
    monthIndex: 0,
    items: [
      { productIndex: 0, hospitalIndex: 0, quantity: 26, deliveryIndex: 0 },
      { productIndex: 1, hospitalIndex: 1, quantity: 18, deliveryIndex: 1 },
      { productIndex: 2, hospitalIndex: 2, quantity: 24, deliveryIndex: 2 },
      { productIndex: 3, hospitalIndex: 3, quantity: 16, deliveryIndex: 3 },
      { productIndex: 0, hospitalIndex: 4, quantity: 14, deliveryIndex: 0 },
      { productIndex: 1, hospitalIndex: 5, quantity: 11, deliveryIndex: 2 },
    ],
  },
  {
    monthIndex: 1,
    items: [
      { productIndex: 0, hospitalIndex: 1, quantity: 31, deliveryIndex: 1 },
      { productIndex: 1, hospitalIndex: 0, quantity: 21, deliveryIndex: 0 },
      { productIndex: 2, hospitalIndex: 3, quantity: 27, deliveryIndex: 3 },
      { productIndex: 3, hospitalIndex: 2, quantity: 19, deliveryIndex: 2 },
      { productIndex: 0, hospitalIndex: 5, quantity: 16, deliveryIndex: 0 },
      { productIndex: 2, hospitalIndex: 4, quantity: 12, deliveryIndex: 1 },
    ],
  },
  {
    monthIndex: 2,
    items: [
      { productIndex: 0, hospitalIndex: 2, quantity: 34, deliveryIndex: 0 },
      { productIndex: 1, hospitalIndex: 3, quantity: 23, deliveryIndex: 3 },
      { productIndex: 2, hospitalIndex: 1, quantity: 29, deliveryIndex: 1 },
      { productIndex: 3, hospitalIndex: 4, quantity: 21, deliveryIndex: 2 },
      { productIndex: 1, hospitalIndex: 5, quantity: 17, deliveryIndex: 0 },
      { productIndex: 0, hospitalIndex: 0, quantity: 15, deliveryIndex: 1 },
    ],
  },
]);

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

  RANGE_BLUEPRINTS.forEach((monthConfig) => {
    const month = months[monthConfig.monthIndex];
    if (!Number.isInteger(month)) {
      return;
    }

    monthConfig.items.forEach((item, itemIndex) => {
      const product = products[item.productIndex];
      if (!product) {
        return;
      }

      const quantity = Math.max(1, Math.round(item.quantity * quantityScale));
      records.push({
        id: `${idPrefix}-${monthConfig.monthIndex}-${itemIndex}`,
        date: buildIsoDate(year, month, MONTH_DAY_SERIES[itemIndex] || 8),
        productId: product.id,
        productName: product.productName,
        unitPriceSnapshot: product.unitPrice,
        hospital: DEMO_HOSPITALS[item.hospitalIndex] || DEMO_HOSPITALS[0],
        quantity,
        amount: roundMoney(quantity * product.unitPrice),
        delivery: DEMO_DELIVERIES[item.deliveryIndex] || DEMO_DELIVERIES[0],
      });
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
      productName: "替格瑞洛 90mg*14片",
      unitPrice: "198",
    },
    banner: {
      title: "当前展示的是模拟经营数据",
      description: "未登录时可完整浏览报表、录入、指标和列表示例；登录后即可改成你自己的真实数据。",
    },
  };
}
