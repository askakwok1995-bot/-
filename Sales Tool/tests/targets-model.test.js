import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMonthlyTargetMap,
  buildProductAllocationMap,
  normalizeTargetYearData,
} from "../domain/targets-model.js";

test("normalizeTargetYearData migrates legacy amount-only data to dual metric model", () => {
  const normalized = normalizeTargetYearData(2026, {
    quarters: {
      Q1: {
        quarterTarget: 300,
        months: {
          1: 100,
          2: 100,
          3: 100,
        },
      },
    },
    productAllocations: {
      p1: {
        productName: "诺和盈1mg",
        months: {
          1: 50,
          2: 25,
        },
      },
    },
  });

  const amountMap = buildMonthlyTargetMap(2026, normalized, "amount");
  const quantityMap = buildMonthlyTargetMap(2026, normalized, "quantity");
  const amountAllocationMap = buildProductAllocationMap(2026, normalized, "amount");
  const quantityAllocationMap = buildProductAllocationMap(2026, normalized, "quantity");

  assert.equal(amountMap["2026-01"], 100);
  assert.equal(amountMap["2026-02"], 100);
  assert.equal(quantityMap["2026-01"], 0);
  assert.equal(quantityMap["2026-02"], 0);
  assert.equal(amountAllocationMap["2026-01"].p1, 50);
  assert.equal(amountAllocationMap["2026-02"].p1, 25);
  assert.equal(quantityAllocationMap["2026-01"].p1, 0);
  assert.equal(quantityAllocationMap["2026-02"].p1, 0);
});
