import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_REPORT_CHART_PALETTE_ID, renderReportSection } from "../reports.js";

class FakeClassList {
  constructor() {
    this.set = new Set();
  }

  add(...names) {
    names.forEach((name) => this.set.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.set.delete(name));
  }

  toggle(name, force) {
    if (force === undefined) {
      if (this.set.has(name)) {
        this.set.delete(name);
        return false;
      }
      this.set.add(name);
      return true;
    }
    if (force) {
      this.set.add(name);
      return true;
    }
    this.set.delete(name);
    return false;
  }

  contains(name) {
    return this.set.has(name);
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.classList = new FakeClassList();
    this.attributes = {};
    this.listeners = {};
    this.style = {
      removeProperty: (name) => {
        delete this.style[name];
      },
    };
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.textContent = "";
    this._innerHTML = "";
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

class FakeHtmlInputElement extends FakeElement {
  constructor(value = "") {
    super();
    this.value = value;
  }
}

class FakeHtmlSelectElement extends FakeElement {
  constructor(value = "") {
    super();
    this.value = value;
    this.options = [];
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.options = Array.from(this._innerHTML.matchAll(/<option\b[^>]*value="([^"]*)"/g)).map((match) => ({
      value: match[1],
    }));
  }
}

class FakeHtmlButtonElement extends FakeElement {}

class FakeChart {
  constructor(element) {
    this.element = element;
    this.option = null;
    this.disposed = false;
  }

  setOption(option) {
    this.option = option;
  }

  getOption() {
    return this.option;
  }

  getDom() {
    return this.element;
  }

  isDisposed() {
    return this.disposed;
  }

  dispose() {
    this.disposed = true;
  }

  resize() {}

  getDataURL() {
    return "data:image/png;base64,fake";
  }
}

function installFakeBrowserEnv() {
  const previousGlobals = {
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    document: globalThis.document,
    window: globalThis.window,
  };

  const charts = new Map();
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = FakeHtmlInputElement;
  globalThis.HTMLSelectElement = FakeHtmlSelectElement;
  globalThis.HTMLButtonElement = FakeHtmlButtonElement;
  globalThis.document = {
    querySelectorAll: () => [],
  };
  globalThis.window = {
    innerWidth: 1400,
    echarts: {
      init(element) {
        const chart = new FakeChart(element);
        charts.set(element.id, chart);
        return chart;
      },
    },
  };

  return {
    charts,
    restore() {
      globalThis.HTMLElement = previousGlobals.HTMLElement;
      globalThis.HTMLInputElement = previousGlobals.HTMLInputElement;
      globalThis.HTMLSelectElement = previousGlobals.HTMLSelectElement;
      globalThis.HTMLButtonElement = previousGlobals.HTMLButtonElement;
      globalThis.document = previousGlobals.document;
      globalThis.window = previousGlobals.window;
    },
  };
}

function createChartElement(id) {
  return new FakeElement(id);
}

function createReportDom(startYm = "2025-01", endYm = "2025-03") {
  return {
    reportHintEl: new FakeElement(),
    reportMonthBody: new FakeElement(),
    reportQuarterBody: new FakeElement(),
    reportProductBody: new FakeElement(),
    reportHospitalBody: new FakeElement(),
    reportEmptyEl: new FakeElement(),
    reportChartsHintEl: new FakeElement(),
    reportChartPaletteSelect: new FakeHtmlSelectElement(),
    reportChartDataLabelModeSelect: new FakeHtmlSelectElement(),
    reportAmountUnitSelect: new FakeHtmlSelectElement(),
    hospitalTrendSelect: new FakeHtmlSelectElement(),
    reportStartMonthInput: new FakeHtmlInputElement(startYm),
    reportEndMonthInput: new FakeHtmlInputElement(endYm),
    chartMonthlyTrendEl: createChartElement("chart-monthly-trend"),
    chartQuarterlyTrendEl: createChartElement("chart-quarterly-trend"),
    chartProductPerformanceEl: createChartElement("chart-product-performance"),
    chartProductMonthlyTrendEl: createChartElement("chart-product-monthly-trend"),
    chartProductTopEl: createChartElement("chart-product-top"),
    chartHospitalTopEl: createChartElement("chart-hospital-top"),
    chartHospitalShareEl: createChartElement("chart-hospital-share"),
    chartHospitalTrendEl: createChartElement("chart-hospital-trend"),
    exportChartMonthlyTrendBtn: new FakeHtmlButtonElement(),
    exportChartMonthlyTrendXlsxBtn: new FakeHtmlButtonElement(),
    exportChartQuarterlyTrendBtn: new FakeHtmlButtonElement(),
    exportChartQuarterlyTrendXlsxBtn: new FakeHtmlButtonElement(),
    exportChartProductPerformanceBtn: new FakeHtmlButtonElement(),
    exportChartProductPerformanceXlsxBtn: new FakeHtmlButtonElement(),
    exportChartProductMonthlyTrendBtn: new FakeHtmlButtonElement(),
    exportChartProductMonthlyTrendXlsxBtn: new FakeHtmlButtonElement(),
    exportChartProductTopBtn: new FakeHtmlButtonElement(),
    exportChartProductTopXlsxBtn: new FakeHtmlButtonElement(),
    exportChartHospitalTopBtn: new FakeHtmlButtonElement(),
    exportChartHospitalTopXlsxBtn: new FakeHtmlButtonElement(),
    exportChartHospitalShareBtn: new FakeHtmlButtonElement(),
    exportChartHospitalShareXlsxBtn: new FakeHtmlButtonElement(),
    exportChartHospitalTrendBtn: new FakeHtmlButtonElement(),
    exportChartHospitalTrendXlsxBtn: new FakeHtmlButtonElement(),
  };
}

function createDeps() {
  return {
    saveReportRange: () => undefined,
    getEffectiveMonthlyTargetMap: () => null,
    getProductMonthlyAllocationMap: () => null,
    normalizeText: (value) => String(value || "").trim().toLowerCase(),
    roundMoney: (value) => Math.round(Number(value || 0) * 100) / 100,
    formatMoney: (value) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return "--";
      return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, "");
    },
    isValidDateParts: (year, month, day) => {
      if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    },
    escapeHtml: (value) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;"),
  };
}

function createRecords() {
  return [
    { date: "2024-01-08", hospital: "南山医院", productId: "p1", productName: "诺和盈1mg", amount: 80, quantity: 4 },
    { date: "2024-02-10", hospital: "南山医院", productId: "p1", productName: "诺和盈1mg", amount: 90, quantity: 5 },
    { date: "2024-03-15", hospital: "天河医院", productId: "p2", productName: "诺和盈2mg", amount: 70, quantity: 4 },
    { date: "2025-01-08", hospital: "南山医院", productId: "p1", productName: "诺和盈1mg", amount: 120, quantity: 6 },
    { date: "2025-02-10", hospital: "南山医院", productId: "p1", productName: "诺和盈1mg", amount: 150, quantity: 8 },
    { date: "2025-03-10", hospital: "天河医院", productId: "p2", productName: "诺和盈2mg", amount: 210, quantity: 10 },
    { date: "2025-03-15", hospital: "海珠医院", productId: "p3", productName: "德谷门冬", amount: 160, quantity: 7 },
  ];
}

test("renderReportSection 在无数据时降级为空态图表而不抛错", () => {
  const env = installFakeBrowserEnv();
  try {
    const dom = createReportDom();
    const summary = renderReportSection(
      {
        reportStartYm: "2025-01",
        reportEndYm: "2025-03",
        reportChartPaletteId: "classic",
        reportChartDataLabelMode: "compact",
        reportAmountUnitId: "yuan",
        records: [],
      },
      dom,
      createDeps(),
    );

    assert.equal(summary.reason, "no-records");
    assert.equal(dom.reportEmptyEl.hidden, false);
    assert.match(dom.reportEmptyEl.innerHTML, /录入销售记录后，这里会自动生成月度、季度、产品和医院四类分析视图/);
    assert.match(dom.reportMonthBody.innerHTML, /月度总览/);
    assert.match(dom.reportMonthBody.innerHTML, /录入销售记录后，这里会自动生成按月趋势/);
    assert.match(dom.reportQuarterBody.innerHTML, /季度总览/);
    assert.match(dom.reportProductBody.innerHTML, /产品分析/);
    assert.match(dom.reportHospitalBody.innerHTML, /医院分析/);
    assert.equal(dom.reportChartsHintEl.textContent, "暂无可视化数据");
    assert.equal(env.charts.size, 8);
    assert.equal(dom.reportChartPaletteSelect.value, DEFAULT_REPORT_CHART_PALETTE_ID);
  } finally {
    env.restore();
  }
});

test("renderReportSection 在缺少指标且切换到数量口径时仍能完成 8 张图渲染", () => {
  const env = installFakeBrowserEnv();
  try {
    const dom = createReportDom();
    const deps = createDeps();
    const state = {
      reportStartYm: "2025-01",
      reportEndYm: "2025-03",
      reportChartPaletteId: "ocean",
      reportChartDataLabelMode: "emphasis",
      reportAmountUnitId: "yuan",
      activeHospitalChartKey: "",
      records: createRecords(),
    };

    const firstSummary = renderReportSection(state, dom, deps);
    assert.equal(firstSummary.reason, "");
    assert.equal(dom.reportEmptyEl.hidden, true);
    assert.equal(dom.reportEmptyEl.innerHTML, "");

    state.reportTargetChartMetrics = {
      "monthly-trend": "quantity",
      "quarterly-trend": "quantity",
      "product-performance": "quantity",
      "product-monthly-trend": "quantity",
      "product-top": "quantity",
      "hospital-top": "quantity",
      "hospital-share": "quantity",
      "hospital-trend": "quantity",
    };

    const secondSummary = renderReportSection(state, dom, deps);
    assert.equal(secondSummary.reason, "");
    assert.equal(state.reportChartPaletteId, DEFAULT_REPORT_CHART_PALETTE_ID);
    assert.match(dom.reportHintEl.textContent, /未生效指标/);
    assert.equal(dom.hospitalTrendSelect.disabled, false);
    assert.equal(env.charts.size, 8);
    assert.equal(env.charts.get("chart-product-top")?.option?.series?.[0]?.type, "pie");
    assert.equal(env.charts.get("chart-hospital-top")?.option?.series?.[0]?.type, "bar");
    assert.equal(env.charts.get("chart-hospital-trend")?.option?.series?.[0]?.type, "line");
    assert.match(env.charts.get("chart-monthly-trend")?.option?.series?.[0]?.name || "", /数量|指标数量/);
  } finally {
    env.restore();
  }
});

test("renderReportSection 会为坐标轴图保留完整标签空间且仅压缩环形图", () => {
  const env = installFakeBrowserEnv();
  try {
    const dom = createReportDom();
    const deps = createDeps();
    const state = {
      reportStartYm: "2025-01",
      reportEndYm: "2025-03",
      reportChartPaletteId: "harbor",
      reportChartDataLabelMode: "compact",
      reportAmountUnitId: "yuan",
      activeHospitalChartKey: "",
      records: createRecords(),
    };

    const summary = renderReportSection(state, dom, deps);
    assert.equal(summary.reason, "");

    assert.equal(dom.chartMonthlyTrendEl.style.width, undefined);
    assert.equal(dom.chartQuarterlyTrendEl.style.width, undefined);
    assert.equal(dom.chartProductPerformanceEl.style.width, undefined);
    assert.equal(dom.chartHospitalTopEl.style.width, undefined);
    assert.equal(dom.chartProductTopEl.style.width, "92%");
    assert.equal(dom.chartHospitalShareEl.style.width, "92%");

    assert.equal(env.charts.get("chart-monthly-trend")?.option?.grid?.containLabel, true);
    assert.equal(env.charts.get("chart-product-performance")?.option?.grid?.containLabel, true);
    assert.equal(env.charts.get("chart-hospital-top")?.option?.grid?.containLabel, true);
    assert.equal(env.charts.get("chart-hospital-top")?.option?.yAxis?.data?.[0], "南山医院");
    assert.equal(env.charts.get("chart-hospital-top")?.option?.yAxis?.axisLabel?.rich, undefined);
    assert.equal(typeof env.charts.get("chart-hospital-top")?.option?.xAxis?.max, "function");
    assert.equal(env.charts.get("chart-hospital-top")?.option?.series?.[0]?.data?.[0]?.label?.position, "insideRight");
    assert.equal(env.charts.get("chart-hospital-top")?.option?.series?.[0]?.data?.[0]?.label?.color, "#103247");
    assert.equal(env.charts.get("chart-hospital-top")?.option?.series?.[0]?.data?.[0]?.label?.textBorderWidth, 0);
  } finally {
    env.restore();
  }
});

test("renderReportSection 在只读演示态仍禁用图表导出按钮", () => {
  const env = installFakeBrowserEnv();
  try {
    const dom = createReportDom();
    const deps = createDeps();
    const state = {
      reportStartYm: "2025-01",
      reportEndYm: "2025-03",
      reportChartPaletteId: "harbor",
      reportChartDataLabelMode: "compact",
      reportAmountUnitId: "yuan",
      activeHospitalChartKey: "",
      isWorkspaceReadOnly: true,
      records: createRecords(),
    };

    const summary = renderReportSection(state, dom, deps);
    assert.equal(summary.reason, "");
    assert.equal(dom.exportChartMonthlyTrendBtn.disabled, true);
    assert.equal(dom.exportChartHospitalTopBtn.disabled, true);
    assert.equal(dom.exportChartHospitalTrendXlsxBtn.disabled, true);
  } finally {
    env.restore();
  }
});

test("renderReportSection 不会在环形图中心摘要里塞入完整医院或产品名称", () => {
  const env = installFakeBrowserEnv();
  try {
    const dom = createReportDom();
    const deps = createDeps();
    const state = {
      reportStartYm: "2025-01",
      reportEndYm: "2025-03",
      reportChartPaletteId: "harbor",
      reportChartDataLabelMode: "compact",
      reportAmountUnitId: "yuan",
      activeHospitalChartKey: "",
      records: createRecords(),
    };

    const summary = renderReportSection(state, dom, deps);
    assert.equal(summary.reason, "");

    const productDetail = env.charts.get("chart-product-top")?.option?.graphic?.[2]?.style?.text || "";
    const hospitalDetail = env.charts.get("chart-hospital-share")?.option?.graphic?.[2]?.style?.text || "";

    assert.match(productDetail, /^TOP1 占比 · /);
    assert.match(hospitalDetail, /^TOP1 占比 · /);
    assert.doesNotMatch(productDetail, /诺和盈|德谷门冬/);
    assert.doesNotMatch(hospitalDetail, /南山医院|天河医院|海珠医院/);
  } finally {
    env.restore();
  }
});

test("renderReportSection 会为医院趋势图分离标题与图例并收敛顶部标签", () => {
  const env = installFakeBrowserEnv();
  try {
    const dom = createReportDom();
    const deps = createDeps();
    const state = {
      reportStartYm: "2025-01",
      reportEndYm: "2025-03",
      reportChartPaletteId: "harbor",
      reportChartDataLabelMode: "compact",
      reportAmountUnitId: "yuan",
      activeHospitalChartKey: "",
      records: createRecords(),
    };

    const summary = renderReportSection(state, dom, deps);
    assert.equal(summary.reason, "");

    const hospitalTrendOption = env.charts.get("chart-hospital-trend")?.option;
    assert.equal(hospitalTrendOption?.title?.left, "center");
    assert.equal(hospitalTrendOption?.title?.textAlign, "center");
    assert.equal(hospitalTrendOption?.legend?.right, 24);
    assert.equal(hospitalTrendOption?.legend?.top, 14);
    assert.equal(hospitalTrendOption?.grid?.top, 112);
    assert.equal(hospitalTrendOption?.series?.[0]?.label?.formatter({ value: 120, dataIndex: 0 }), "");
    assert.notEqual(hospitalTrendOption?.series?.[0]?.label?.formatter({ value: 150, dataIndex: 1 }), "");
    assert.equal(hospitalTrendOption?.series?.[1]?.label?.formatter({ value: 50, dataIndex: 0 }), "");
    assert.notEqual(hospitalTrendOption?.series?.[1]?.label?.formatter({ value: 66.67, dataIndex: 1 }), "");
  } finally {
    env.restore();
  }
});
