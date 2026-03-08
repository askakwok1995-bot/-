import assert from "node:assert/strict";
import test from "node:test";

import { buildReportSnapshot } from "../domain/report-snapshot.js";

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function createDeps(targetMapByYear = {}) {
  return {
    roundMoney,
    normalizeText,
    isValidDateParts,
    getEffectiveMonthlyTargetMap(year) {
      return targetMapByYear[year] || null;
    },
    getProductMonthlyAllocationMap() {
      return null;
    },
  };
}

test("buildReportSnapshot returns range aggregates for current report interval", () => {
  const snapshot = buildReportSnapshot(
    {
      records: [
        { date: "2025-01-02", productId: "p1", productName: "Volux", hospital: "A院", amount: 100, quantity: 2 },
        { date: "2025-01-15", productId: "p1", productName: "Volux", hospital: "A院", amount: 80, quantity: 1 },
        { date: "2025-02-20", productId: "p2", productName: "Botox", hospital: "B院", amount: 120, quantity: 3 },
      ],
    },
    createDeps({
      2025: {
        "2025-01": 200,
        "2025-02": 200,
      },
    }),
    {
      startYm: "2025-01",
      endYm: "2025-02",
    },
  );

  assert.equal(snapshot.rangeRecordCount, 3);
  assert.equal(snapshot.rangeAmountTotal, 300);
  assert.equal(snapshot.rangeTargetAmountTotal, 400);
  assert.equal(snapshot.rangeAmountAchievement, 0.75);
  assert.equal(snapshot.hasRangeRecords, true);
});

test("buildReportSnapshot marks range achievement unavailable when any month target is missing", () => {
  const snapshot = buildReportSnapshot(
    {
      records: [{ date: "2025-01-02", productId: "p1", productName: "Volux", hospital: "A院", amount: 100, quantity: 2 }],
    },
    createDeps({
      2025: {
        "2025-01": 200,
      },
    }),
    {
      startYm: "2025-01",
      endYm: "2025-02",
    },
  );

  assert.equal(snapshot.rangeRecordCount, 1);
  assert.equal(snapshot.rangeAmountTotal, 100);
  assert.equal(snapshot.rangeTargetAmountTotal, null);
  assert.equal(snapshot.rangeAmountAchievement, null);
});
