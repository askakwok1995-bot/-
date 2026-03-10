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

function resolveMetricYearMap(targetMapByYear, year, metric) {
  const yearMap = targetMapByYear[year] || null;
  if (!yearMap) return null;
  if (yearMap.amount || yearMap.quantity) {
    return yearMap[metric] || null;
  }
  return metric === "amount" ? yearMap : null;
}

function createDeps(targetMapByYear = {}, productAllocationMapByYear = {}) {
  return {
    roundMoney,
    normalizeText,
    isValidDateParts,
    getEffectiveMonthlyTargetMap(year, metric = "amount") {
      return resolveMetricYearMap(targetMapByYear, year, metric);
    },
    getProductMonthlyAllocationMap(year, metric = "amount") {
      return resolveMetricYearMap(productAllocationMapByYear, year, metric);
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

test("buildReportSnapshot computes dual metric achievements and product quantity targets", () => {
  const snapshot = buildReportSnapshot(
    {
      records: [
        { date: "2025-01-02", productId: "p1", productName: "Volux", hospital: "A院", amount: 100, quantity: 2 },
        { date: "2025-02-15", productId: "p1", productName: "Volux", hospital: "A院", amount: 160, quantity: 4 },
        { date: "2025-02-20", productId: "p2", productName: "Botox", hospital: "B院", amount: 120, quantity: 3 },
      ],
    },
    createDeps(
      {
        2025: {
          amount: {
            "2025-01": 200,
            "2025-02": 200,
          },
          quantity: {
            "2025-01": 5,
            "2025-02": 10,
          },
        },
      },
      {
        2025: {
          amount: {
            "2025-01": { p1: 120, p2: 0 },
            "2025-02": { p1: 180, p2: 150 },
          },
          quantity: {
            "2025-01": { p1: 3, p2: 0 },
            "2025-02": { p1: 5, p2: 4 },
          },
        },
      },
    ),
    {
      startYm: "2025-01",
      endYm: "2025-02",
    },
  );

  assert.equal(snapshot.rangeTargetAmountTotal, 400);
  assert.equal(snapshot.rangeAmountAchievement, 0.95);
  assert.equal(snapshot.rangeTargetQuantityTotal, 15);
  assert.equal(snapshot.rangeQuantityAchievement, 0.6);
  assert.equal(snapshot.monthRows[0].targetQuantity, 5);
  assert.equal(snapshot.monthRows[1].targetQuantity, 10);

  const volux = snapshot.productRows.find((row) => row.productKey === "id:p1");
  assert.equal(volux?.targetAmount, 300);
  assert.equal(volux?.amountAchievement, 0.866667);
  assert.equal(volux?.targetQuantity, 8);
  assert.equal(volux?.quantityAchievement, 0.75);
});
