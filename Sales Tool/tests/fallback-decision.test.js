import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyBusinessSnapshot, DATA_AVAILABILITY_CODES, QUESTION_JUDGMENT_CODES } from "../functions/chat/shared.js";
import {
  resolveHospitalMonthlySupportCode,
  resolveHospitalNamedSupportCode,
  resolveProductFullSupportCode,
  resolveProductHospitalSupportCode,
  resolveProductNamedSupportCode,
} from "../functions/chat/availability-support.js";
import { buildDataAvailability } from "../functions/chat/availability-core.js";
import { buildRouteDecision, forceBoundedRouteDecision } from "../functions/chat/routing.js";
import { collectNeedMoreDataReasons } from "../functions/chat/routing-rules.js";
import { handleChatRequest } from "../functions/api/chat.js";

function createQuestionJudgment(primaryDimension, granularity = QUESTION_JUDGMENT_CODES.granularity.SUMMARY) {
  return {
    primary_dimension: { code: primaryDimension, label: primaryDimension },
    granularity: { code: granularity, label: granularity },
    relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
  };
}

test("availability-support resolves five support modes with stable codes", () => {
  const snapshot = createEmptyBusinessSnapshot();
  snapshot.performance_overview.product_catalog_count_value = 3;
  snapshot.performance_overview.product_snapshot_count_value = 1;
  snapshot.performance_overview.product_coverage_code = "partial";
  snapshot.performance_overview.product_hospital_support_code = "full";
  snapshot.product_performance = [{ product_name: "诺和盈1mg", product_code: "p1" }];
  snapshot.hospital_performance = [
    {
      hospital_name: "广州华美医疗美容医院有限公司",
      monthly_coverage_code: "full",
      monthly_points: [{ period: "2025-01", sales_amount_value: 1 }],
    },
  ];

  assert.equal(resolveProductFullSupportCode(snapshot), "partial");
  assert.equal(
    resolveProductNamedSupportCode(snapshot, [{ product_id: "p1", product_name: "诺和盈1mg", lookup_key: "诺和盈1mg" }]),
    "full",
  );
  assert.equal(resolveProductHospitalSupportCode(snapshot), "full");
  assert.equal(
    resolveHospitalNamedSupportCode(snapshot, [{ mention_name: "华美", mention_key: "华美", mention_alias_key: "华美" }]),
    "full",
  );
  assert.equal(resolveHospitalMonthlySupportCode(snapshot), "full");
});

test("product_hospital route matrix ignores product_named insufficiency when hospital support is full", () => {
  const questionJudgment = createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL);
  const dataAvailability = {
    has_business_data: { code: DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE },
    dimension_availability: { code: DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE },
    answer_depth: { code: DATA_AVAILABILITY_CODES.answer_depth.FOCUSED },
    gap_hint_needed: { code: DATA_AVAILABILITY_CODES.gap_hint_needed.NO },
    product_hospital_support: "full",
    product_named_support: "none",
    hospital_named_support: "none",
  };

  const routeDecision = buildRouteDecision(questionJudgment, dataAvailability, {
    productHospitalRequested: true,
    productNamedRequested: true,
  });

  assert.equal(routeDecision.route.code, "direct_answer");
});

test("routing keeps product_full partial coverage in need_more_data", () => {
  const questionJudgment = createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT);
  const dataAvailability = {
    has_business_data: { code: DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE },
    dimension_availability: { code: DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL },
    answer_depth: { code: DATA_AVAILABILITY_CODES.answer_depth.FOCUSED },
    gap_hint_needed: { code: DATA_AVAILABILITY_CODES.gap_hint_needed.NO },
    product_full_support: "partial",
    product_named_support: "none",
    product_hospital_support: "none",
    hospital_named_support: "none",
  };

  const reasons = collectNeedMoreDataReasons(questionJudgment, dataAvailability, {
    productFullRequested: true,
  });
  const routeDecision = buildRouteDecision(questionJudgment, dataAvailability, {
    productFullRequested: true,
  });

  assert.ok(reasons.includes("product_full_scope_insufficient"));
  assert.equal(routeDecision.route.code, "need_more_data");
});

test("forceBoundedRouteDecision keeps single-step need_more_data collapse", () => {
  const routeDecision = forceBoundedRouteDecision({
    dimension_availability: { code: DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL },
    gap_hint_needed: { code: DATA_AVAILABILITY_CODES.gap_hint_needed.YES },
  });

  assert.equal(routeDecision.route.code, "bounded_answer");
  assert.deepEqual(routeDecision.reason_codes, ["dimension_partial", "gap_hint_needed"]);
});

test("product_hospital zero-result remains answerable instead of missing data", () => {
  const snapshot = createEmptyBusinessSnapshot();
  snapshot.performance_overview.product_hospital_support_code = "full";
  snapshot.performance_overview.product_hospital_hospital_count_value = 0;
  snapshot.key_business_signals = ["该产品在当前范围内未产生医院销量贡献。"];

  const dataAvailability = buildDataAvailability(
    snapshot,
    createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL),
    {
      productHospitalRequested: true,
      productNamedRequested: true,
      requestedProducts: [{ product_id: "p1", product_name: "Botox50", lookup_key: "botox50" }],
      productNamedMatchMode: "exact",
    },
  );

  assert.equal(dataAvailability.product_hospital_support, "full");
  assert.equal(dataAvailability.dimension_availability.code, "available");
  assert.equal(dataAvailability.gap_hint_needed.code, "no");
});

test("handleChatRequest skips tool-first and goes legacy fallback when analysis_range is invalid", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "这个月整体怎么样",
        business_snapshot: {
          analysis_range: { start_month: "", end_month: "", period: "--" },
        },
      }),
    }),
    env: {},
  };

  let toolCalled = false;
  let directToolCalled = false;
  let legacyGeminiCalled = false;
  const response = await handleChatRequest(context, "req-invalid-range-fallback", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    buildDeterministicToolRoute: () => ({
      matched: true,
      route_type: "product_full",
      tool_name: "get_product_summary",
      tool_args: { include_all_products: true, limit: 50 },
    }),
    runDirectToolChat: async () => {
      directToolCalled = true;
      return { ok: false, fallbackReason: "should-not-run" };
    },
    runToolFirstChat: async () => {
      toolCalled = true;
      return { ok: false, fallbackReason: "should-not-run" };
    },
    buildQuestionJudgment: () => createQuestionJudgment(QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL),
    buildDataAvailability: () => ({
      has_business_data: { code: DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE },
      dimension_availability: { code: DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE },
      answer_depth: { code: DATA_AVAILABILITY_CODES.answer_depth.FOCUSED },
      gap_hint_needed: { code: DATA_AVAILABILITY_CODES.gap_hint_needed.NO },
      detail_request_mode: "generic",
      hospital_monthly_support: "none",
      product_hospital_support: "none",
      hospital_named_support: "none",
      product_full_support: "none",
      product_named_support: "none",
      product_named_match_mode: "none",
      requested_product_count_value: 0,
      product_hospital_hospital_count_value: 0,
    }),
    buildRouteDecision: () => ({
      route: { code: "direct_answer", label: "直接回答" },
      reason_codes: ["sufficient"],
    }),
    callGemini: async () => {
      legacyGeminiCalled = true;
      return {
        ok: true,
        reply: "当前整体销售表现稳定。",
        model: "legacy-model",
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(directToolCalled, false);
  assert.equal(toolCalled, false);
  assert.equal(legacyGeminiCalled, true);
  assert.equal(payload.model, "legacy-model");
});
