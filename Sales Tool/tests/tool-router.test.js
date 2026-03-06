import assert from "node:assert/strict";
import test from "node:test";

import { QUESTION_JUDGMENT_CODES } from "../functions/chat/shared.js";
import { buildDeterministicToolRoute } from "../functions/chat/tool-router.js";

function createQuestionJudgment(primaryDimension, granularity = QUESTION_JUDGMENT_CODES.granularity.SUMMARY) {
  return {
    primary_dimension: { code: primaryDimension, label: primaryDimension },
    granularity: { code: granularity, label: granularity },
    relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
  };
}

test("tool-router routes Botox50 hospital contribution to deterministic product_hospital", () => {
  const route = buildDeterministicToolRoute({
    questionJudgment: createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL),
    productFullRequested: false,
    hospitalMonthlyDetailRequested: false,
    productNamedContext: {
      productNamedRequested: true,
      requestedProducts: [{ product_name: "Botox50" }],
    },
    hospitalNamedContext: { hospitalNamedRequested: false, requestedHospitals: [] },
    productHospitalContext: { productHospitalRequested: true },
  });

  assert.equal(route.matched, true);
  assert.equal(route.route_type, "product_hospital");
  assert.equal(route.tool_name, "get_product_hospital_contribution");
  assert.deepEqual(route.tool_args.product_names, ["Botox50"]);
});

test("tool-router keeps hospital_monthly above product_full and hospital_named", () => {
  const route = buildDeterministicToolRoute({
    questionJudgment: createQuestionJudgment(
      QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
      QUESTION_JUDGMENT_CODES.granularity.DETAIL,
    ),
    productFullRequested: true,
    hospitalMonthlyDetailRequested: true,
    productNamedContext: { productNamedRequested: false, requestedProducts: [] },
    hospitalNamedContext: {
      hospitalNamedRequested: true,
      requestedHospitals: [{ mention_name: "华美" }],
    },
    productHospitalContext: { productHospitalRequested: false },
  });

  assert.equal(route.matched, true);
  assert.equal(route.route_type, "hospital_monthly");
  assert.equal(route.tool_name, "get_hospital_summary");
  assert.equal(route.tool_args.include_monthly, true);
});

test("tool-router routes product_full and hospital_named deterministically", () => {
  const productFullRoute = buildDeterministicToolRoute({
    questionJudgment: createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT),
    productFullRequested: true,
    hospitalMonthlyDetailRequested: false,
    productNamedContext: { productNamedRequested: false, requestedProducts: [] },
    hospitalNamedContext: { hospitalNamedRequested: false, requestedHospitals: [] },
    productHospitalContext: { productHospitalRequested: false },
  });
  assert.equal(productFullRoute.route_type, "product_full");
  assert.equal(productFullRoute.tool_name, "get_product_summary");
  assert.equal(productFullRoute.tool_args.include_all_products, true);

  const hospitalNamedRoute = buildDeterministicToolRoute({
    questionJudgment: createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL),
    productFullRequested: false,
    hospitalMonthlyDetailRequested: false,
    productNamedContext: { productNamedRequested: false, requestedProducts: [] },
    hospitalNamedContext: {
      hospitalNamedRequested: true,
      requestedHospitals: [{ mention_name: "华美这家机构" }],
    },
    productHospitalContext: { productHospitalRequested: false },
  });
  assert.equal(hospitalNamedRoute.route_type, "hospital_named");
  assert.equal(hospitalNamedRoute.tool_name, "get_hospital_summary");
  assert.deepEqual(hospitalNamedRoute.tool_args.hospital_names, ["华美这家机构"]);
});

test("tool-router routes overall time-window questions deterministically after higher-priority routes", () => {
  const overallCompareRoute = buildDeterministicToolRoute({
    questionJudgment: createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL),
    requestedTimeWindow: {
      kind: "absolute",
      label: "Q4",
      start_month: "2025-10",
      end_month: "2025-12",
      period: "2025-10~2025-12",
    },
    comparisonTimeWindow: {
      kind: "absolute",
      label: "Q3",
      start_month: "2025-07",
      end_month: "2025-09",
      period: "2025-07~2025-09",
    },
    timeCompareMode: "quarter_compare",
    primaryWindowCoverageCode: "full",
    comparisonWindowCoverageCode: "full",
    productFullRequested: false,
    hospitalMonthlyDetailRequested: false,
    productNamedContext: { productNamedRequested: false, requestedProducts: [] },
    hospitalNamedContext: { hospitalNamedRequested: false, requestedHospitals: [] },
    productHospitalContext: { productHospitalRequested: false },
  });
  assert.equal(overallCompareRoute.route_type, "overall_period_compare");
  assert.equal(overallCompareRoute.tool_name, "get_period_comparison_summary");
  assert.deepEqual(overallCompareRoute.tool_args, {
    primary_start_month: "2025-10",
    primary_end_month: "2025-12",
    comparison_start_month: "2025-07",
    comparison_end_month: "2025-09",
    dimension: "overall",
  });

  const overallQuarterRoute = buildDeterministicToolRoute({
    questionJudgment: createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL),
    requestedTimeWindow: {
      kind: "absolute",
      label: "Q4季度",
      start_month: "2025-10",
      end_month: "2025-12",
      period: "2025-10~2025-12",
    },
    productFullRequested: false,
    hospitalMonthlyDetailRequested: false,
    productNamedContext: { productNamedRequested: false, requestedProducts: [] },
    hospitalNamedContext: { hospitalNamedRequested: false, requestedHospitals: [] },
    productHospitalContext: { productHospitalRequested: false },
  });
  assert.equal(overallQuarterRoute.route_type, "overall_time_window");
  assert.equal(overallQuarterRoute.tool_name, "get_overall_summary");

  const overallTrendRoute = buildDeterministicToolRoute({
    questionJudgment: createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.TREND),
    requestedTimeWindow: {
      kind: "relative",
      label: "近三个月",
      start_month: "2025-10",
      end_month: "2025-12",
      period: "2025-10~2025-12",
    },
    productFullRequested: false,
    hospitalMonthlyDetailRequested: false,
    productNamedContext: { productNamedRequested: false, requestedProducts: [] },
    hospitalNamedContext: { hospitalNamedRequested: false, requestedHospitals: [] },
    productHospitalContext: { productHospitalRequested: false },
  });
  assert.equal(overallTrendRoute.route_type, "overall_time_window");
  assert.equal(overallTrendRoute.tool_name, "get_trend_summary");
  assert.deepEqual(overallTrendRoute.tool_args, {
    dimension: "overall",
    granularity: "monthly",
  });
});
