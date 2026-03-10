import assert from "node:assert/strict";
import test from "node:test";

import { createToolRuntimeContext, executeToolByName } from "../functions/chat/tool-executors.js";
import { TOOL_NAMES } from "../functions/chat/tool-registry.js";

function createTargetsBundle() {
  const monthTargets = {
    amount: { "2025-01": 200000, "2025-02": 200000 },
    quantity: { "2025-01": 200, "2025-02": 200 },
  };
  const productTargets = {
    amount: {
      p1: { "2025-01": 120000, "2025-02": 130000 },
      p2: { "2025-01": 80000, "2025-02": 70000 },
    },
    quantity: {
      p1: { "2025-01": 100, "2025-02": 110 },
      p2: { "2025-01": 90, "2025-02": 90 },
    },
  };

  return {
    getMonthTarget(ym, metric = "amount") {
      const safeMetric = metric === "quantity" ? "quantity" : "amount";
      return monthTargets[safeMetric][ym] ?? null;
    },
    getRangeTargetTotal(monthKeys, metric = "amount") {
      const safeMetric = metric === "quantity" ? "quantity" : "amount";
      return (Array.isArray(monthKeys) ? monthKeys : []).reduce((sum, ym) => sum + (monthTargets[safeMetric][ym] ?? 0), 0);
    },
    getProductTargetTotal(productId, monthKeys, metric = "amount") {
      const safeMetric = metric === "quantity" ? "quantity" : "amount";
      const productMap = productTargets[safeMetric][productId] || {};
      return (Array.isArray(monthKeys) ? monthKeys : []).reduce((sum, ym) => sum + (productMap[ym] ?? 0), 0);
    },
  };
}

function createRuntimeContext(extraDeps = {}) {
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
      ...extraDeps,
    },
  );
}

function createWideRuntimeContext() {
  const records = [];
  const catalog = [];
  for (let index = 1; index <= 6; index += 1) {
    records.push(
      {
        ym: "2025-01",
        amount: 100000 - index * 5000,
        quantity: 100 - index * 5,
        product_name: `Product${index}`,
        hospital_name: `Hospital${index}`,
      },
      {
        ym: "2025-02",
        amount: 120000 - index * 4000,
        quantity: 110 - index * 4,
        product_name: `Product${index}`,
        hospital_name: `Hospital${index}`,
      },
    );
    catalog.push({ product_id: `p${index}`, product_name: `Product${index}`, lookup_key: `product${index}` });
  }
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

test("get_hospital_summary rows expose sales volume fields", async () => {
  const runtimeContext = createRuntimeContext();
  const result = await executeToolByName(TOOL_NAMES.GET_HOSPITAL_SUMMARY, { limit: 5 }, runtimeContext);

  assert.equal(result.result.coverage.code, "full");
  assert.ok(result.result.rows.length > 0);
  assert.ok("sales_volume" in result.result.rows[0]);
  assert.ok("sales_volume_value" in result.result.rows[0]);
});

test("get_product_summary exposes amount and quantity achievements when targets are available", async () => {
  const runtimeContext = createRuntimeContext({
    fetchSalesTargetsByYears: async () => createTargetsBundle(),
  });
  const result = await executeToolByName(
    TOOL_NAMES.GET_PRODUCT_SUMMARY,
    { include_all_products: true, limit: 5 },
    runtimeContext,
  );

  assert.equal(result.result.summary.amount_target, "40.00万元");
  assert.equal(result.result.summary.amount_achievement, "95.00%");
  assert.equal(result.result.summary.quantity_target, "390盒");
  assert.equal(result.result.summary.quantity_achievement, "99.00%");
  assert.equal(result.result.summary.preferred_achievement_metric, "amount");
  assert.equal(result.result.rows[0].amount_target, "25.00万元");
  assert.equal(result.result.rows[0].quantity_target, "210盒");
});

test("get_sales_overview_brief no longer hard-caps top entities at three", async () => {
  const runtimeContext = createWideRuntimeContext();
  const result = await executeToolByName(TOOL_NAMES.GET_SALES_OVERVIEW_BRIEF, { limit: 6 }, runtimeContext);

  assert.equal(result.result.coverage.code, "full");
  assert.ok(result.result.summary.top_products.length > 3);
  assert.ok(result.result.summary.top_hospitals.length > 3);
});

test("get_dimension_report_brief returns more than three ranked entities when limit is higher", async () => {
  const runtimeContext = createWideRuntimeContext();
  const result = await executeToolByName(
    TOOL_NAMES.GET_DIMENSION_REPORT_BRIEF,
    { dimension: "product", limit: 6 },
    runtimeContext,
  );

  assert.equal(result.result.coverage.code, "full");
  assert.ok(result.result.summary.top_entities.length > 3);
  assert.ok(result.result.summary.bottom_entities.length > 3);
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
