import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHospitalNamedCandidates,
  normalizeProductFamilyKey,
  resolveHospitalNamedMatches,
} from "../domain/entity-matchers.js";
import { createEmptyBusinessSnapshot, QUESTION_JUDGMENT_CODES } from "../functions/chat/shared.js";
import {
  buildEffectiveQuestionJudgment,
  buildQuestionJudgment,
  isFullProductRequest,
  isHospitalMonthlyDetailRequest,
} from "../functions/chat/judgment.js";
import { buildDataAvailability } from "../functions/chat/availability.js";
import { buildRouteDecision } from "../functions/chat/routing.js";
import {
  matchNamedProductsFromCatalog,
  resolveHospitalNamedRequestContext,
} from "../functions/chat/retrieval.js";

function createMonthlyPoints(months) {
  return months.map((month, index) => ({
    period: month,
    sales_amount: `${index + 1}.00万元`,
    sales_amount_value: index + 1,
    sales_volume: `${index + 2}盒`,
    sales_volume_value: index + 2,
    amount_mom: "+10.00%",
    amount_mom_ratio: 0.1,
  }));
}

test("product family key collapses规格后缀", () => {
  assert.equal(normalizeProductFamilyKey("Botox50"), "botox");
  assert.equal(normalizeProductFamilyKey("Botox100"), "botox");
  assert.equal(normalizeProductFamilyKey("诺和盈1mg"), "诺和盈");
});

test("named product matching keeps exact priority over family fallback", () => {
  const catalog = [
    { product_id: "p1", product_name: "Botox50", lookup_key: "botox50" },
    { product_id: "p2", product_name: "Botox100", lookup_key: "botox100" },
  ];

  const exactResult = matchNamedProductsFromCatalog("Botox50在哪些医院贡献最多", catalog);
  assert.equal(exactResult.matchMode, "exact");
  assert.equal(exactResult.requestedProducts.length, 1);
  assert.equal(exactResult.requestedProducts[0].product_name, "Botox50");

  const familyResult = matchNamedProductsFromCatalog("botox主要是哪些医院贡献的销量", catalog);
  assert.equal(familyResult.matchMode, "family");
  assert.equal(familyResult.requestedProducts.length, 2);
});

test("effective question judgment gives product_hospital precedence over product_named", () => {
  const questionJudgment = buildQuestionJudgment("诺和盈1mg在哪些医院贡献最多");
  const effectiveQuestionJudgment = buildEffectiveQuestionJudgment(questionJudgment, {
    productFullRequested: false,
    productHospitalRequested: true,
    productNamedRequested: true,
    hospitalNamedRequested: false,
  });

  assert.equal(questionJudgment.primary_dimension.code, QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL);
  assert.equal(effectiveQuestionJudgment.primary_dimension.code, QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL);
});

test("product_hospital full support stays direct even when product_named support is none", () => {
  const snapshot = createEmptyBusinessSnapshot();
  snapshot.performance_overview.product_hospital_support_code = "full";
  snapshot.performance_overview.product_hospital_hospital_count_value = 3;
  snapshot.hospital_performance = [
    { hospital_name: "医院A", sales_amount: "10.00万元" },
    { hospital_name: "医院B", sales_amount: "8.00万元" },
    { hospital_name: "医院C", sales_amount: "6.00万元" },
  ];

  const questionJudgment = buildQuestionJudgment("诺和盈1mg在哪些医院贡献最多");
  const dataAvailability = buildDataAvailability(snapshot, questionJudgment, {
    productHospitalRequested: true,
    productNamedRequested: true,
    requestedProducts: [{ product_id: "p1", product_name: "诺和盈1mg", lookup_key: "诺和盈1mg" }],
    productNamedMatchMode: "exact",
  });
  const routeDecision = buildRouteDecision(questionJudgment, dataAvailability, {
    productHospitalRequested: true,
    productNamedRequested: true,
  });

  assert.equal(dataAvailability.detail_request_mode, "product_hospital");
  assert.equal(dataAvailability.product_hospital_support, "full");
  assert.equal(dataAvailability.product_named_support, "none");
  assert.equal(routeDecision.route.code, "direct_answer");
});

test("product named request without snapshot support enters need_more_data", () => {
  const snapshot = createEmptyBusinessSnapshot();
  const questionJudgment = buildEffectiveQuestionJudgment(buildQuestionJudgment("诺和盈1mg怎么样"), {
    productNamedRequested: true,
  });
  const dataAvailability = buildDataAvailability(snapshot, questionJudgment, {
    productNamedRequested: true,
    requestedProducts: [{ product_id: "p1", product_name: "诺和盈1mg", lookup_key: "诺和盈1mg" }],
    productNamedMatchMode: "exact",
  });
  const routeDecision = buildRouteDecision(questionJudgment, dataAvailability, {
    productNamedRequested: true,
  });

  assert.equal(dataAvailability.detail_request_mode, "product_named");
  assert.equal(routeDecision.route.code, "need_more_data");
  assert.ok(routeDecision.reason_codes.includes("product_named_scope_insufficient"));
});

test("product full request with partial coverage enters need_more_data", () => {
  const snapshot = createEmptyBusinessSnapshot();
  snapshot.performance_overview.product_catalog_count_value = 5;
  snapshot.performance_overview.product_snapshot_count_value = 2;
  snapshot.performance_overview.product_coverage_code = "partial";
  snapshot.product_performance = [
    { product_name: "产品A", sales_amount: "10.00万元", sales_amount_value: 10 },
    { product_name: "产品B", sales_amount: "6.00万元", sales_amount_value: 6 },
  ];

  const questionJudgment = buildEffectiveQuestionJudgment(buildQuestionJudgment("分析所有产品表现"), {
    productFullRequested: true,
  });
  const dataAvailability = buildDataAvailability(snapshot, questionJudgment, {
    productFullRequested: true,
  });
  const routeDecision = buildRouteDecision(questionJudgment, dataAvailability, {
    productFullRequested: true,
  });

  assert.equal(isFullProductRequest("分析所有产品表现", questionJudgment), true);
  assert.equal(dataAvailability.detail_request_mode, "product_full");
  assert.equal(dataAvailability.product_full_support, "partial");
  assert.equal(routeDecision.route.code, "need_more_data");
  assert.ok(routeDecision.reason_codes.includes("product_full_scope_insufficient"));
});

test("hospital monthly detail request reaches detailed answer depth when monthly points are sufficient", () => {
  const snapshot = createEmptyBusinessSnapshot();
  snapshot.hospital_performance = [
    {
      hospital_name: "医院A",
      sales_amount: "20.00万元",
      sales_amount_value: 20,
      sales_share_ratio: 0.4,
      monthly_coverage_code: "full",
      monthly_coverage_ratio: 1,
      monthly_points: createMonthlyPoints(["2025-01", "2025-02", "2025-03", "2025-04"]),
    },
    {
      hospital_name: "医院B",
      sales_amount: "12.00万元",
      sales_amount_value: 12,
      sales_share_ratio: 0.24,
      monthly_coverage_code: "partial",
      monthly_coverage_ratio: 0.5,
      monthly_points: createMonthlyPoints(["2025-02", "2025-03", "2025-04"]),
    },
  ];

  const questionJudgment = buildQuestionJudgment("哪家医院最重要，按近一年逐月说明");
  const dataAvailability = buildDataAvailability(snapshot, questionJudgment, {
    hospitalMonthlyDetailRequested: true,
  });
  const routeDecision = buildRouteDecision(questionJudgment, dataAvailability, {});

  assert.equal(isHospitalMonthlyDetailRequest("哪家医院最重要，按近一年逐月说明", questionJudgment), true);
  assert.equal(dataAvailability.detail_request_mode, "hospital_monthly");
  assert.equal(dataAvailability.hospital_monthly_support, "full");
  assert.equal(dataAvailability.answer_depth.code, "detailed");
  assert.equal(routeDecision.route.code, "direct_answer");
});

test("hospital named request context no longer throws when message uses hospital-like wording", () => {
  const questionJudgment = buildQuestionJudgment("华美这家机构近三个月怎么样");
  const result = resolveHospitalNamedRequestContext({
    message: "华美这家机构近三个月怎么样",
    questionJudgment,
    productFullRequested: false,
    productNamedRequested: false,
  });

  assert.equal(result.hospitalNamedRequested, true);
  assert.ok(Array.isArray(result.requestedHospitals));
  assert.ok(result.requestedHospitals.length >= 1);
});

test("hospital named request context can use hospital trigger keywords even when primary dimension is not hospital", () => {
  const result = resolveHospitalNamedRequestContext({
    message: "华美机构最近如何",
    questionJudgment: {
      relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT },
      primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL },
    },
    productFullRequested: false,
    productNamedRequested: false,
  });

  assert.equal(result.hospitalNamedRequested, true);
  assert.ok(Array.isArray(result.requestedHospitals));
  assert.ok(result.requestedHospitals.length >= 1);
});

test("hospital named support uses conservative unique alias matching", () => {
  const requestedHospitals = [{ mention_name: "华美机构", mention_key: "华美机构", mention_alias_key: "华美" }];
  const candidates = buildHospitalNamedCandidates([
    { hospital_name: "广州华美医疗美容医院有限公司" },
    { hospital_name: "广东韩妃整形外科医院有限公司" },
  ]);
  const matches = resolveHospitalNamedMatches(requestedHospitals, candidates);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "广州华美医疗美容医院有限公司");
});

test("product_hospital zero-result is treated as answerable result instead of missing data", () => {
  const snapshot = createEmptyBusinessSnapshot();
  snapshot.performance_overview.product_hospital_support_code = "full";
  snapshot.performance_overview.product_hospital_target_count_value = 1;
  snapshot.performance_overview.product_hospital_hospital_count_value = 0;
  snapshot.key_business_signals = ["Botox50在当前范围内未产生医院销量贡献。"]; 

  const questionJudgment = buildEffectiveQuestionJudgment(buildQuestionJudgment("Botox50在哪些医院贡献最多"), {
    productHospitalRequested: true,
    productNamedRequested: true,
  });
  const dataAvailability = buildDataAvailability(snapshot, questionJudgment, {
    productHospitalRequested: true,
    productNamedRequested: true,
    requestedProducts: [{ product_id: "p1", product_name: "Botox50", lookup_key: "botox50" }],
    productNamedMatchMode: "exact",
  });
  const routeDecision = buildRouteDecision(questionJudgment, dataAvailability, {
    productHospitalRequested: true,
    productNamedRequested: true,
  });

  assert.equal(dataAvailability.product_hospital_support, "full");
  assert.equal(dataAvailability.dimension_availability.code, "available");
  assert.equal(routeDecision.route.code, "direct_answer");
});
