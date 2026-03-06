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
