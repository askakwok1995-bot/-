import assert from "node:assert/strict";
import test from "node:test";

import { createDemoWorkspaceSnapshot } from "../demo-workspace.js";
import { renderReportSection } from "../reports.js";

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
    return false;
  }

  dispose() {}

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
    innerWidth: 1440,
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

function createReportDom(startYm, endYm) {
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

test("createDemoWorkspaceSnapshot 生成可用于演示工作台的完整数据", () => {
  const snapshot = createDemoWorkspaceSnapshot(new Date("2026-03-10T12:00:00Z"));

  assert.equal(snapshot.mode, "demo");
  assert.equal(snapshot.products.length >= 6, true);
  assert.equal(snapshot.records.length >= 72, true);
  assert.equal(snapshot.recordListItems.length, snapshot.recordListTotal);
  assert.equal(snapshot.reportRange.startYm, "2026-01");
  assert.equal(snapshot.reportRange.endYm, "2026-03");
  assert.deepEqual(Object.keys(snapshot.targets.years).sort(), ["2025", "2026"]);
  assert.equal(snapshot.salesDraft.productId, snapshot.products[0].id);
  assert.equal(snapshot.products.every((item) => String(item.productName || "").startsWith("匿名产品 ")), true);
  assert.equal(snapshot.records.every((item) => String(item.hospital || "").startsWith("示例医院 ")), true);
  assert.match(snapshot.productDraft.productName, /^匿名产品 /);
});

test("createDemoWorkspaceSnapshot 的数据可直接渲染为非空报表和图表", () => {
  const env = installFakeBrowserEnv();

  try {
    const snapshot = createDemoWorkspaceSnapshot(new Date("2026-03-10T12:00:00Z"));
    const dom = createReportDom(snapshot.reportRange.startYm, snapshot.reportRange.endYm);
    const state = {
      reportStartYm: snapshot.reportRange.startYm,
      reportEndYm: snapshot.reportRange.endYm,
      reportRangeError: "",
      reportChartPaletteId: "harbor",
      reportChartDataLabelMode: "compact",
      reportAmountUnitId: "yuan",
      reportTargetChartMetrics: {},
      records: snapshot.records,
      reportRecords: snapshot.reportRecords,
      products: snapshot.products,
      targets: snapshot.targets,
      activeHospitalChartKey: "",
    };

    const deps = {
      ...createDeps(),
      getEffectiveMonthlyTargetMap(year, metric = "amount") {
        const yearData = snapshot.targets.years[String(year)];
        if (!yearData) return null;
        const output = {};
        const targetGroups = metric === "quantity" ? yearData.targets.quantity.quarters : yearData.targets.amount.quarters;
        Object.values(targetGroups).forEach((quarter) => {
          Object.entries(quarter.months).forEach(([month, value]) => {
            output[`${year}-${String(month).padStart(2, "0")}`] = value;
          });
        });
        return output;
      },
      getProductMonthlyAllocationMap(year, metric = "amount") {
        const yearData = snapshot.targets.years[String(year)];
        if (!yearData) return null;
        const output = {};
        Object.entries(yearData.productAllocations).forEach(([productId, allocation]) => {
          const monthMap = metric === "quantity" ? allocation.quantityMonths : allocation.amountMonths;
          Object.entries(monthMap).forEach(([month, value]) => {
            const ym = `${year}-${String(month).padStart(2, "0")}`;
            if (!output[ym]) {
              output[ym] = {};
            }
            output[ym][productId] = value;
          });
        });
        return output;
      },
    };

    const summary = renderReportSection(state, dom, deps);

    assert.equal(summary.reason, "");
    assert.equal(dom.reportEmptyEl.hidden, true);
    assert.match(dom.reportMonthBody.innerHTML, /2026-01/);
    assert.match(dom.reportProductBody.innerHTML, /匿名产品 A/);
    assert.match(dom.reportHospitalBody.innerHTML, /示例医院 0/);
    assert.equal(env.charts.size >= 8, true);
    assert.equal(dom.reportChartsHintEl.classList.contains("report-hint-error"), false);
  } finally {
    env.restore();
  }
});
