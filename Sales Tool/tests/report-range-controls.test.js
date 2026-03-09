import assert from "node:assert/strict";
import test from "node:test";

import {
  buildYmFromParts,
  getReportRangeControlYears,
  normalizeReportRange,
  parseReportYmParts,
} from "../reports.js";

class FakeHtmlInputElement {
  constructor(value = "") {
    this.value = value;
  }
}

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
