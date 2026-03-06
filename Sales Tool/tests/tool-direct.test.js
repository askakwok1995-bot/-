import assert from "node:assert/strict";
import test from "node:test";

import { runDirectToolChat } from "../functions/chat/tool-direct.js";

test("runDirectToolChat falls back to local deterministic reply when Gemini upstream times out", async () => {
  const result = await runDirectToolChat(
    {
      message: "Botox50在哪些医院贡献最多",
      businessSnapshot: {
        analysis_range: {
          start_month: "2025-10",
          end_month: "2025-12",
          period: "2025-10~2025-12",
        },
      },
      requestedTimeWindow: {
        kind: "absolute",
        label: "Q4季度",
        start_month: "2025-10",
        end_month: "2025-12",
        period: "2025-10~2025-12",
        anchor_mode: "analysis_year",
      },
      questionJudgment: {
        primary_dimension: { code: "hospital" },
        granularity: { code: "summary" },
      },
      authToken: "token",
      env: {},
      requestId: "req-tool-direct-timeout",
      deterministicToolRoute: {
        matched: true,
        route_type: "product_hospital",
        tool_name: "get_product_hospital_contribution",
        tool_args: { product_names: ["Botox50"], limit: 10 },
      },
    },
    {
      createToolRuntimeContext: () => ({
        getWindowInfo: async () => ({
          valid: true,
          effective_start_month: "2025-10",
          effective_end_month: "2025-12",
        }),
      }),
      executeToolByName: async () => ({
        result: {
          range: {
            start_month: "2025-10",
            end_month: "2025-12",
            period: "2025-10~2025-12",
          },
          matched_entities: {
            products: ["Botox50"],
            hospitals: [
              "广东韩妃整形外科医院有限公司",
              "广州华美医疗美容医院有限公司",
              "广东祈福医院有限公司",
            ],
          },
          unmatched_entities: { products: [], hospitals: [] },
          coverage: { code: "full", message: "" },
          summary: {},
          rows: [
            { hospital_name: "广东韩妃整形外科医院有限公司", sales_amount: "189.76万元", sales_share: "17.50%", amount_mom: "+45.50%" },
            { hospital_name: "广州华美医疗美容医院有限公司", sales_amount: "149.39万元", sales_share: "13.78%" },
            { hospital_name: "广东祈福医院有限公司", sales_amount: "112.64万元", sales_share: "10.39%" },
          ],
        },
        meta: {
          coverage_code: "full",
          detail_request_mode: "product_hospital",
          matched_products: ["Botox50"],
          product_hospital_zero_result: "no",
        },
      }),
      callGeminiWithToolResult: async () => ({
        ok: false,
        code: "UPSTREAM_TIMEOUT",
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.model, "local-template-tool-fallback");
  assert.equal(result.outputContext.local_response_mode, "tool_result_fallback");
  assert.match(result.reply, /2025年Q4|2025-10~2025-12/u);
  assert.match(result.reply, /广东韩妃整形外科医院有限公司/u);
});

test("runDirectToolChat uses local deterministic fallback for overall time-window replies", async () => {
  const result = await runDirectToolChat(
    {
      message: "Q4季度销售情况如何",
      businessSnapshot: {
        analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
      },
      requestedTimeWindow: {
        kind: "absolute",
        label: "Q4季度",
        start_month: "2025-10",
        end_month: "2025-12",
        period: "2025-10~2025-12",
        anchor_mode: "analysis_year",
      },
      questionJudgment: {
        primary_dimension: { code: "overall", label: "整体" },
        granularity: { code: "summary", label: "摘要级" },
      },
      authToken: "token",
      env: {},
      requestId: "req-overall-time-fallback",
      deterministicToolRoute: {
        matched: true,
        route_type: "overall_time_window",
        tool_name: "get_overall_summary",
        tool_args: {},
      },
    },
    {
      createToolRuntimeContext: () => ({
        getWindowInfo: async () => ({
          valid: true,
          effective_start_month: "2025-10",
          effective_end_month: "2025-12",
        }),
      }),
      executeToolByName: async () => ({
        result: {
          coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
          matched_entities: { products: [], hospitals: [] },
          unmatched_entities: { products: [], hospitals: [] },
          summary: {
            sales_amount: "300.00万元",
            sales_amount_value: 3000000,
            sales_volume: "120盒",
            sales_volume_value: 120,
            latest_key_change: "最近月金额环比 +12.00%",
          },
          rows: [
            { period: "2025-10", sales_amount: "90.00万元", sales_amount_value: 900000, amount_mom: "+5.00%", amount_mom_ratio: 0.05 },
            { period: "2025-11", sales_amount: "95.00万元", sales_amount_value: 950000, amount_mom: "+5.56%", amount_mom_ratio: 0.0556 },
            { period: "2025-12", sales_amount: "115.00万元", sales_amount_value: 1150000, amount_mom: "+21.05%", amount_mom_ratio: 0.2105 },
          ],
        },
        meta: {
          detail_request_mode: "generic",
          coverage_code: "full",
        },
      }),
      callGeminiWithToolResult: async () => ({
        ok: false,
        code: "UPSTREAM_ERROR",
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.model, "local-template-tool-fallback");
  assert.equal(result.outputContext.local_response_mode, "tool_result_fallback");
  assert.equal(result.outputContext.tool_route_type, "overall_time_window");
  assert.match(result.reply, /2025年Q4|2025-10~2025-12/u);
  assert.match(result.reply, /300.00万元/u);
  assert.match(result.reply, /2025-10/u);
});
