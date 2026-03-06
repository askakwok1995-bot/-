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
