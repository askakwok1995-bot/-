import assert from "node:assert/strict";
import test from "node:test";

import {
  bindReportEvents,
  buildYmFromParts,
  DEFAULT_REPORT_CHART_PALETTE_ID,
  getReportRangeControlYears,
  normalizeReportRange,
  parseReportYmParts,
  REPORT_CHART_PALETTES,
} from "../reports.js";

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
  constructor() {
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
class FakeHtmlDetailsElement extends FakeElement {}

test("buildYmFromParts 组装合法年月", () => {
  assert.equal(buildYmFromParts("2025", "3"), "2025-03");
  assert.equal(buildYmFromParts("2025", "12"), "2025-12");
  assert.equal(buildYmFromParts("", "12"), "");
  assert.equal(buildYmFromParts("2025", "13"), "");
});

test("parseReportYmParts 可拆出年和月", () => {
  assert.deepEqual(parseReportYmParts("2025-03"), { year: "2025", month: "03" });
  assert.deepEqual(parseReportYmParts("invalid"), { year: "", month: "" });
});

test("getReportRangeControlYears 包含当前年和已选年份", () => {
  assert.deepEqual(getReportRangeControlYears("2022-01", "2027-12", { currentYear: 2025 }), [
    "2020",
    "2021",
    "2022",
    "2023",
    "2024",
    "2025",
    "2026",
    "2027",
  ]);
});

test("normalizeReportRange 保持现有起止区间校验", () => {
  globalThis.HTMLInputElement = FakeHtmlInputElement;

  const state = {
    reportStartYm: "2025-12",
    reportEndYm: "2025-01",
    reportRangeError: "",
  };
  const dom = {
    reportStartMonthInput: new FakeHtmlInputElement("2025-12"),
    reportEndMonthInput: new FakeHtmlInputElement("2025-01"),
  };

  const result = normalizeReportRange(state, dom, {});
  assert.equal(result.error, "起始月不能晚于结束月");
  assert.equal(state.reportRangeError, "起始月不能晚于结束月");
});

test("bindReportEvents 会回退旧图表主题并渲染精简后的主题列表", () => {
  const previousGlobals = {
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    HTMLDetailsElement: globalThis.HTMLDetailsElement,
    document: globalThis.document,
    window: globalThis.window,
  };

  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = FakeHtmlInputElement;
  globalThis.HTMLSelectElement = FakeHtmlSelectElement;
  globalThis.HTMLButtonElement = FakeHtmlButtonElement;
  globalThis.HTMLDetailsElement = FakeHtmlDetailsElement;
  globalThis.document = {
    querySelectorAll: () => [],
  };
  globalThis.window = {
    addEventListener: () => undefined,
  };

  try {
    const state = {
      reportChartPaletteId: "classic",
      reportChartDataLabelMode: "compact",
      reportAmountUnitId: "yuan",
      reportTargetChartMetrics: {},
    };
    const dom = {
      reportChartPaletteSelect: new FakeHtmlSelectElement(),
      reportChartDataLabelModeSelect: new FakeHtmlSelectElement(),
      reportAmountUnitSelect: new FakeHtmlSelectElement(),
      reportStartMonthInput: null,
      reportEndMonthInput: null,
      reportStartYearSelect: null,
      reportStartMonthSelect: null,
      reportEndYearSelect: null,
      reportEndMonthSelect: null,
      hospitalTrendSelect: null,
      reportChartsDetails: null,
      exportReportTablesBtn: null,
    };

    bindReportEvents(state, dom, {});

    assert.equal(state.reportChartPaletteId, DEFAULT_REPORT_CHART_PALETTE_ID);
    assert.equal(dom.reportChartPaletteSelect.value, DEFAULT_REPORT_CHART_PALETTE_ID);
    assert.deepEqual(
      dom.reportChartPaletteSelect.options.map((option) => option.value),
      REPORT_CHART_PALETTES.map((palette) => palette.id),
    );
  } finally {
    globalThis.HTMLElement = previousGlobals.HTMLElement;
    globalThis.HTMLInputElement = previousGlobals.HTMLInputElement;
    globalThis.HTMLSelectElement = previousGlobals.HTMLSelectElement;
    globalThis.HTMLButtonElement = previousGlobals.HTMLButtonElement;
    globalThis.HTMLDetailsElement = previousGlobals.HTMLDetailsElement;
    globalThis.document = previousGlobals.document;
    globalThis.window = previousGlobals.window;
  }
});
