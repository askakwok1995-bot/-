import assert from "node:assert/strict";
import test from "node:test";

import { handleChatRequest } from "../functions/api/chat.js";
import { CHAT_ERROR_CODES, DATA_AVAILABILITY_CODES, QUESTION_JUDGMENT_CODES, ROUTE_DECISION_CODES } from "../functions/chat/shared.js";

test("handleChatRequest returns structured JSON error and requestId when pre-gemini stage throws", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "你好",
      }),
    }),
    env: {},
  };

  const originalConsoleError = console.error;
  const errorLogs = [];
  console.error = (...args) => {
    errorLogs.push(args.map((item) => String(item)).join(" "));
  };

  try {
    const response = await handleChatRequest(context, "req-test-1", {
      verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
      buildQuestionJudgment: () => {
        throw new Error("forced-judgment-failure");
      },
    });

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("x-request-id"), "req-test-1");

    const payload = await response.json();
    assert.equal(payload?.error?.code, CHAT_ERROR_CODES.INTERNAL_ERROR);
    assert.equal(payload?.error?.message, "聊天服务暂时不可用，请稍后重试。");
    assert.equal(payload?.requestId, "req-test-1");
    assert.ok(errorLogs.some((entry) => entry.includes("[chat.error]")));
    assert.ok(errorLogs.some((entry) => entry.includes("\"stage\":\"judgment\"")));
    assert.ok(errorLogs.some((entry) => entry.includes("forced-judgment-failure")));
  } finally {
    console.error = originalConsoleError;
  }
});

test("handleChatRequest refuse path does not call Gemini", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "今天天气怎么样",
      }),
    }),
    env: {},
  };

  let geminiCalled = false;
  const response = await handleChatRequest(context, "req-test-refuse", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    buildQuestionJudgment: () => ({
      primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.OTHER, label: "其他/未归类" },
      granularity: { code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY, label: "摘要级" },
      relevance: { code: QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT, label: "明显无关" },
    }),
    callGemini: async () => {
      geminiCalled = true;
      return { ok: true, reply: "should-not-be-used", model: "stub-model" };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.model, "local-template-refuse");
  assert.equal(geminiCalled, false);
  assert.match(payload.reply, /你可以问|整体业绩|产品表现|医院表现/u);
});

test("handleChatRequest collapses need_more_data into bounded_answer after single enhancement", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "请详细分析这个情况",
        business_snapshot: {},
      }),
    }),
    env: {},
  };

  let routeCallCount = 0;
  let dataAvailabilityCallCount = 0;
  let observedRouteCode = "";
  const boundedAvailability = {
    has_business_data: { code: DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE, label: "有" },
    dimension_availability: { code: DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL, label: "部分具备" },
    answer_depth: { code: DATA_AVAILABILITY_CODES.answer_depth.OVERALL, label: "总体判断" },
    gap_hint_needed: { code: DATA_AVAILABILITY_CODES.gap_hint_needed.YES, label: "是" },
    detail_request_mode: "generic",
    hospital_monthly_support: "none",
    product_hospital_support: "none",
    hospital_named_support: "none",
    product_full_support: "none",
    product_named_support: "none",
    product_named_match_mode: "none",
    requested_product_count_value: 0,
    product_hospital_hospital_count_value: 0,
  };

  const response = await handleChatRequest(context, "req-test-bounded", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    buildQuestionJudgment: () => ({
      primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL, label: "整体" },
      granularity: { code: QUESTION_JUDGMENT_CODES.granularity.DETAIL, label: "明细级" },
      relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
    }),
    buildDataAvailability: () => {
      dataAvailabilityCallCount += 1;
      return boundedAvailability;
    },
    buildRouteDecision: () => {
      routeCallCount += 1;
      return {
        route: { code: ROUTE_DECISION_CODES.NEED_MORE_DATA, label: "进入后续补强" },
        reason_codes: ["detail_requested_but_insufficient"],
      };
    },
    buildOnDemandSnapshotEnhancement: async ({ businessSnapshot }) => ({
      effectiveSnapshot: businessSnapshot,
      retrievalState: {
        triggered: true,
        target_dimension: "overall",
        success: false,
        window_capped: false,
        degraded_to_bounded: false,
      },
    }),
    callGemini: async (_message, _snapshot, outputContext) => {
      observedRouteCode = outputContext.route_code;
      return {
        ok: true,
        reply: "当前可以先给出方向性判断。",
        model: "stub-model",
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(routeCallCount, 2);
  assert.equal(dataAvailabilityCallCount, 2);
  assert.equal(observedRouteCode, ROUTE_DECISION_CODES.BOUNDED_ANSWER);
  assert.equal(payload.model, "stub-model");
});

test("handleChatRequest returns tool-first answer without entering legacy fallback", async () => {
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
          analysis_range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
        },
      }),
    }),
    env: {},
  };

  let legacyAvailabilityCalled = false;
  let legacyGeminiCalled = false;
  const response = await handleChatRequest(context, "req-tool-first-success", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    runToolFirstChat: async () => ({
      ok: true,
      reply: "当前整体销售保持增长，达成率稳定，近两个月的销售趋势延续向上，建议继续关注核心驱动因素。",
      model: "tool-model",
      outputContext: {
        route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
        boundary_needed: false,
        refuse_mode: false,
      },
      toolRuntimeState: {
        attempted: true,
        used_tools: ["get_overall_summary"],
        tool_call_count: 1,
        rounds: 1,
        final_route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
        success: true,
        fallback_reason: "",
      },
      toolCallTrace: [],
    }),
    buildDataAvailability: () => {
      legacyAvailabilityCalled = true;
      return {};
    },
    callGemini: async () => {
      legacyGeminiCalled = true;
      return { ok: true, reply: "legacy", model: "legacy-model" };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.model, "tool-model");
  assert.equal(
    payload.reply,
    "当前整体销售保持增长，达成率稳定，近两个月的销售趋势延续向上，建议继续关注核心驱动因素。",
  );
  assert.equal(legacyAvailabilityCalled, false);
  assert.equal(legacyGeminiCalled, false);
});

test("handleChatRequest falls back to legacy phase2 when tool-first fails", async () => {
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
          analysis_range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
        },
      }),
    }),
    env: {},
  };

  let legacyAvailabilityCalled = false;
  let legacyGeminiCalled = false;
  const response = await handleChatRequest(context, "req-tool-first-fallback", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    runToolFirstChat: async () => ({
      ok: false,
      fallbackReason: "tool_execution_failed",
      toolRuntimeState: {
        attempted: true,
        used_tools: ["get_overall_summary"],
        tool_call_count: 1,
        rounds: 1,
        final_route_code: "",
        success: false,
        fallback_reason: "tool_execution_failed",
      },
      toolCallTrace: [],
    }),
    buildQuestionJudgment: () => ({
      primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL, label: "整体" },
      granularity: { code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY, label: "摘要级" },
      relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
    }),
    buildDataAvailability: () => {
      legacyAvailabilityCalled = true;
      return {
        has_business_data: { code: DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE, label: "有" },
        dimension_availability: { code: DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE, label: "具备" },
        answer_depth: { code: DATA_AVAILABILITY_CODES.answer_depth.FOCUSED, label: "重点分析" },
        gap_hint_needed: { code: DATA_AVAILABILITY_CODES.gap_hint_needed.NO, label: "否" },
        detail_request_mode: "generic",
        hospital_monthly_support: "none",
        product_hospital_support: "none",
        hospital_named_support: "none",
        product_full_support: "none",
        product_named_support: "none",
        product_named_match_mode: "none",
        requested_product_count_value: 0,
      };
    },
    buildRouteDecision: () => ({
      route: { code: ROUTE_DECISION_CODES.DIRECT_ANSWER, label: "直接回答" },
      reason_codes: ["sufficient"],
    }),
    callGemini: async () => {
      legacyGeminiCalled = true;
      return {
        ok: true,
        reply: "当前整体销售表现稳定，现有业务信号显示核心产品和医院贡献仍然集中，建议继续跟踪重点对象的变化。",
        model: "legacy-model",
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.model, "legacy-model");
  assert.equal(
    payload.reply,
    "当前整体销售表现稳定，现有业务信号显示核心产品和医院贡献仍然集中，建议继续跟踪重点对象的变化。",
  );
  assert.equal(legacyAvailabilityCalled, true);
  assert.equal(legacyGeminiCalled, true);
});
