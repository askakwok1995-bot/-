import assert from "node:assert/strict";
import test from "node:test";

import { applyQualityControl } from "../functions/chat/output.js";

function createRouteDecision(routeCode) {
  return {
    route: { code: routeCode, label: routeCode },
    reason_codes: [],
  };
}

test("QC patches deterministic product_hospital contradiction when tool rows exist", () => {
  const outputContext = {
    route_code: "direct_answer",
    product_hospital_detail_mode: true,
    tool_route_mode: "deterministic",
    tool_result_coverage_code: "full",
    tool_result_row_count_value: 3,
    tool_result_row_names: ["广东韩妃整形外科医院有限公司", "广州华美医疗美容医院有限公司", "广东祈福医院有限公司"],
    tool_result_matched_products: ["Botox50"],
    product_hospital_zero_result_mode: false,
  };

  const result = applyQualityControl(
    "当前业务快照未提供各产品在具体医院的细分销售数据，数据不足。",
    outputContext,
    createRouteDecision("direct_answer"),
  );

  assert.equal(result.qcState.applied, true);
  assert.match(result.finalReplyText, /Botox50/u);
  assert.doesNotMatch(result.finalReplyText, /数据不足|未提供细分/u);
});

test("QC patches deterministic product_hospital zero-result into explicit zero contribution", () => {
  const outputContext = {
    route_code: "direct_answer",
    product_hospital_detail_mode: true,
    tool_route_mode: "deterministic",
    tool_result_coverage_code: "full",
    tool_result_row_count_value: 0,
    tool_result_row_names: [],
    tool_result_matched_products: ["Botox50"],
    product_hospital_zero_result_mode: true,
  };

  const result = applyQualityControl(
    "当前没有细分数据，暂时无法判断。",
    outputContext,
    createRouteDecision("direct_answer"),
  );

  assert.match(result.finalReplyText, /贡献为0|未产生医院销量贡献/u);
  assert.doesNotMatch(result.finalReplyText, /数据不足|无法判断/u);
});

test("QC underlisted patch appends multiple hospitals when deterministic tool has top3 rows", () => {
  const outputContext = {
    route_code: "direct_answer",
    product_hospital_detail_mode: true,
    tool_route_mode: "deterministic",
    tool_result_coverage_code: "full",
    tool_result_row_count_value: 3,
    tool_result_row_names: ["广东韩妃整形外科医院有限公司", "广州华美医疗美容医院有限公司", "广东祈福医院有限公司"],
    tool_result_matched_products: ["Botox50"],
    product_hospital_zero_result_mode: false,
  };

  const result = applyQualityControl(
    "Botox50主要由广东韩妃整形外科医院有限公司贡献。",
    outputContext,
    createRouteDecision("direct_answer"),
  );

  assert.match(result.finalReplyText, /广东韩妃整形外科医院有限公司/u);
  assert.match(result.finalReplyText, /广州华美医疗美容医院有限公司/u);
});

test("QC appends explicit absolute period when time intent is present but reply omits it", () => {
  const outputContext = {
    route_code: "direct_answer",
    requested_time_window_kind: "relative",
    requested_time_window_label: "近三个月",
    requested_time_window_period: "2025-10~2025-12",
    time_compare_mode: "none",
    time_window_coverage_code: "full",
    available_time_window_period: "2025-01~2025-12",
  };

  const result = applyQualityControl(
    "整体趋势延续向上，核心医院贡献保持稳定。",
    outputContext,
    createRouteDecision("direct_answer"),
  );

  assert.match(result.finalReplyText, /2025-10~2025-12/u);
});

test("QC falls back to boundary reply when relative time is silently reinterpreted to available range", () => {
  const outputContext = {
    route_code: "bounded_answer",
    requested_time_window_kind: "relative",
    requested_time_window_label: "近三个月",
    requested_time_window_period: "2025-12~2026-02",
    time_window_coverage_code: "partial",
    available_time_window_period: "2025-01~2025-12",
  };

  const result = applyQualityControl(
    "按 2025-01~2025-12 来看，这家机构整体表现较强。",
    outputContext,
    createRouteDecision("bounded_answer"),
  );

  assert.equal(result.qcState.action, "safe_fallback");
  assert.match(result.finalReplyText, /2025-12~2026-02/u);
  assert.match(result.finalReplyText, /2025-01~2025-12/u);
});

test("QC appends explicit comparison windows when compare reply omits absolute periods", () => {
  const outputContext = {
    route_code: "direct_answer",
    overall_period_compare_mode: true,
    time_compare_mode: "quarter_compare",
    requested_time_window_label: "Q4",
    requested_time_window_period: "2025-10~2025-12",
    requested_time_window_anchor_mode: "analysis_year",
    comparison_time_window_label: "Q3",
    comparison_time_window_period: "2025-07~2025-09",
    comparison_time_window_anchor_mode: "analysis_year",
    tool_route_mode: "deterministic",
    tool_result_primary_period: "2025-10~2025-12",
    tool_result_comparison_period: "2025-07~2025-09",
    tool_result_sales_amount_change_ratio: 0.3636,
    tool_result_sales_volume_change_ratio: 0.3157,
  };

  const result = applyQualityControl(
    "Q4整体销售表现强于Q3，销售额和销量都有提升。",
    outputContext,
    createRouteDecision("direct_answer"),
  );

  assert.match(result.finalReplyText, /2025-10~2025-12/u);
  assert.match(result.finalReplyText, /2025-07~2025-09/u);
});

test("QC patches compare reply when only Q4 is mentioned but Q3 comparison exists", () => {
  const outputContext = {
    route_code: "direct_answer",
    overall_period_compare_mode: true,
    time_compare_mode: "quarter_compare",
    requested_time_window_label: "Q4",
    requested_time_window_period: "2025-10~2025-12",
    requested_time_window_start_month: "2025-10",
    requested_time_window_anchor_mode: "analysis_year",
    comparison_time_window_label: "Q3",
    comparison_time_window_period: "2025-07~2025-09",
    comparison_time_window_start_month: "2025-07",
    comparison_time_window_anchor_mode: "analysis_year",
    tool_route_mode: "deterministic",
    tool_result_primary_period: "2025-10~2025-12",
    tool_result_comparison_period: "2025-07~2025-09",
    tool_result_sales_amount_change_ratio: 0.3636,
    tool_result_sales_volume_change_ratio: 0.3157,
    tool_result_sales_amount_change: "+36.36%",
    tool_result_sales_volume_change: "+31.57%",
  };

  const result = applyQualityControl(
    "在2025-10~2025-12（Q4）期间，整体销售额达到709.22万元，表现明显走强。",
    outputContext,
    createRouteDecision("direct_answer"),
  );

  assert.equal(result.qcState.applied, true);
  assert.match(result.finalReplyText, /2025-07~2025-09/u);
  assert.match(result.finalReplyText, /Q3/u);
  assert.match(result.finalReplyText, /36.36%|31.57%/u);
});
