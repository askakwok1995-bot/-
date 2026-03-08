import assert from "node:assert/strict";
import test from "node:test";

import { createToolRuntimeContext, executeToolByName } from "../functions/chat/tool-executors.js";
import { TOOL_NAMES } from "../functions/chat/tool-registry.js";

function createRuntimeContext() {
  const records = [
    { ym: "2025-01", amount: 100000, quantity: 100, product_name: "Botox50", hospital_name: "华山医院" },
    { ym: "2025-02", amount: 130000, quantity: 110, product_name: "Botox50", hospital_name: "华山医院" },
    { ym: "2025-01", amount: 80000, quantity: 90, product_name: "Juvederm", hospital_name: "瑞金医院" },
    { ym: "2025-02", amount: 70000, quantity: 85, product_name: "Juvederm", hospital_name: "瑞金医院" },
  ];
  const catalog = [
    { product_id: "p1", product_name: "Botox50", lookup_key: "botox50" },
    { product_id: "p2", product_name: "Juvederm", lookup_key: "juvederm" },
  ];
  return createToolRuntimeContext(
    {
      businessSnapshot: {
        analysis_range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
      },
      authToken: "token",
      env: {},
    },
    {
      fetchSalesRecordsByWindow: async () => records,
      fetchProductsCatalog: async () => catalog,
    },
  );
}

test("scope_aggregate returns unified envelope with aggregate evidence", async () => {
  const runtimeContext = createRuntimeContext();
  const result = await executeToolByName(TOOL_NAMES.SCOPE_AGGREGATE, { dimension: "overall" }, runtimeContext);

  assert.equal(result.result.coverage.code, "full");
  assert.ok(Array.isArray(result.result.rows));
  assert.ok(Array.isArray(result.result.boundaries));
  assert.ok(Array.isArray(result.result.diagnostic_flags));
  assert.deepEqual(result.meta.evidence_types, ["aggregate"]);
});

test("scope_timeseries returns unified envelope with timeseries evidence", async () => {
  const runtimeContext = createRuntimeContext();
  const result = await executeToolByName(
    TOOL_NAMES.SCOPE_TIMESERIES,
    { dimension: "product", granularity: "monthly" },
    runtimeContext,
  );

  assert.equal(result.result.coverage.code, "full");
  assert.ok(result.result.rows.length > 0);
  assert.deepEqual(result.meta.evidence_types, ["timeseries"]);
});

test("scope_breakdown returns unified envelope with breakdown evidence", async () => {
  const runtimeContext = createRuntimeContext();
  const result = await executeToolByName(
    TOOL_NAMES.SCOPE_BREAKDOWN,
    { scope_dimension: "overall", breakdown_dimension: "product", include_share: true, limit: 5 },
    runtimeContext,
  );

  assert.equal(result.result.coverage.code, "full");
  assert.ok(result.result.rows.length > 0);
  assert.deepEqual(result.meta.evidence_types, ["breakdown", "ranking"]);
});

test("scope_diagnostics returns unified envelope with diagnostics evidence", async () => {
  const runtimeContext = createRuntimeContext();
  const result = await executeToolByName(
    TOOL_NAMES.SCOPE_DIAGNOSTICS,
    { dimension: "overall", include_anomaly: true, include_risk: true, limit: 3 },
    runtimeContext,
  );

  assert.ok(["full", "partial"].includes(result.result.coverage.code));
  assert.ok(Array.isArray(result.result.rows));
  assert.deepEqual(result.meta.evidence_types, ["diagnostics"]);
});

test("get_sales_overview_brief returns macro overview envelope", async () => {
  const runtimeContext = createRuntimeContext();
  const result = await executeToolByName(TOOL_NAMES.GET_SALES_OVERVIEW_BRIEF, { limit: 4 }, runtimeContext);

  assert.equal(result.result.coverage.code, "full");
  assert.ok(Array.isArray(result.result.rows));
  assert.ok(result.result.rows.some((row) => String(row.row_label || "").startsWith("趋势:")));
  assert.ok(Array.isArray(result.result.summary.top_products));
  assert.ok(Array.isArray(result.result.summary.top_hospitals));
  assert.deepEqual(result.meta.evidence_types, ["aggregate", "timeseries", "breakdown", "diagnostics"]);
  assert.equal(result.meta.analysis_view, "sales_overview_brief");
});

test("get_sales_trend_brief returns macro trend envelope", async () => {
  const runtimeContext = createRuntimeContext();
  const result = await executeToolByName(TOOL_NAMES.GET_SALES_TREND_BRIEF, { limit: 4 }, runtimeContext);

  assert.equal(result.result.coverage.code, "full");
  assert.ok(Array.isArray(result.result.rows));
  assert.ok(result.result.rows.some((row) => String(row.row_label || "").startsWith("趋势:")));
  assert.ok("anomaly_count" in (result.result.summary || {}));
  assert.deepEqual(result.meta.evidence_types, ["aggregate", "timeseries", "breakdown", "diagnostics"]);
  assert.equal(result.meta.analysis_view, "sales_trend_brief");
});

test("get_dimension_overview_brief returns macro dimension envelope", async () => {
  const runtimeContext = createRuntimeContext();
  const result = await executeToolByName(
    TOOL_NAMES.GET_DIMENSION_OVERVIEW_BRIEF,
    { dimension: "hospital", limit: 4 },
    runtimeContext,
  );

  assert.equal(result.result.coverage.code, "full");
  assert.ok(Array.isArray(result.result.rows));
  assert.ok(result.result.rows.some((row) => String(row.row_label || "").startsWith("医院:")));
  assert.equal(result.result.summary.overview_dimension, "hospital");
  assert.deepEqual(result.meta.evidence_types, ["aggregate", "breakdown", "ranking"]);
  assert.equal(result.meta.analysis_view, "hospital_overview_brief");
});

test("get_dimension_report_brief returns macro dimension report envelope", async () => {
  const runtimeContext = createRuntimeContext();
  const result = await executeToolByName(
    TOOL_NAMES.GET_DIMENSION_REPORT_BRIEF,
    { dimension: "product", limit: 4 },
    runtimeContext,
  );

  assert.equal(result.result.coverage.code, "full");
  assert.ok(Array.isArray(result.result.rows));
  assert.ok(result.result.rows.some((row) => String(row.row_label || "").startsWith("趋势:")));
  assert.equal(result.result.summary.overview_dimension, "product");
  assert.ok(Array.isArray(result.result.summary.top_entities));
  assert.ok(Array.isArray(result.result.summary.bottom_entities));
  assert.ok(Array.isArray(result.result.summary.trend_signals));
  assert.ok(Array.isArray(result.result.summary.risk_alerts));
  assert.ok(Array.isArray(result.result.summary.opportunity_hints));
  assert.ok("concentration_hint" in (result.result.summary || {}));
  assert.deepEqual(result.meta.evidence_types, ["aggregate", "timeseries", "breakdown", "ranking", "diagnostics"]);
  assert.equal(result.meta.analysis_view, "product_report_brief");
});
