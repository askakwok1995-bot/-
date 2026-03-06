import assert from "node:assert/strict";
import test from "node:test";

import { executeToolByName } from "../functions/chat/tool-executors.js";

test("get_period_comparison_summary aggregates records that only expose ym", async () => {
  const result = await executeToolByName(
    "get_period_comparison_summary",
    {
      primary_start_month: "2025-10",
      primary_end_month: "2025-12",
      comparison_start_month: "2025-07",
      comparison_end_month: "2025-09",
      dimension: "overall",
    },
    {
      getWindowInfo: async () => ({
        valid: true,
        effective_start_month: "2025-01",
        effective_end_month: "2025-12",
        month_keys: [
          "2025-07",
          "2025-08",
          "2025-09",
          "2025-10",
          "2025-11",
          "2025-12",
        ],
      }),
      getRecords: async () => [
        { ym: "2025-07", amount: 1000000, quantity: 100, product_name: "A", hospital_name: "H1" },
        { ym: "2025-08", amount: 1200000, quantity: 120, product_name: "A", hospital_name: "H1" },
        { ym: "2025-09", amount: 1300000, quantity: 130, product_name: "B", hospital_name: "H2" },
        { ym: "2025-10", amount: 2000000, quantity: 200, product_name: "A", hospital_name: "H1" },
        { ym: "2025-11", amount: 2100000, quantity: 210, product_name: "B", hospital_name: "H2" },
        { ym: "2025-12", amount: 2200000, quantity: 220, product_name: "C", hospital_name: "H3" },
      ],
    },
  );

  assert.equal(result.result.range.period, "2025-10~2025-12");
  assert.equal(result.result.comparison_range.period, "2025-07~2025-09");
  assert.equal(result.result.summary.primary.sales_amount_value, 6300000);
  assert.equal(result.result.summary.comparison.sales_amount_value, 3500000);
  assert.equal(result.result.summary.primary.sales_volume_value, 630);
  assert.equal(result.result.summary.comparison.sales_volume_value, 350);
  assert.match(result.result.summary.delta.sales_amount_change, /^\+/u);
});
