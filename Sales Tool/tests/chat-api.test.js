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
    env: {
      CHAT_ENABLE_LEGACY_FALLBACK: "1",
    },
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
    env: {
      CHAT_ENABLE_LEGACY_FALLBACK: "1",
    },
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
    env: {
      CHAT_ENABLE_LEGACY_FALLBACK: "1",
    },
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
    env: {
      CHAT_ENABLE_DETERMINISTIC_ROUTE: "1",
    },
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

test("handleChatRequest returns bounded local reply when tool-first fails and legacy fallback is disabled", async () => {
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
    env: {
      CHAT_ENABLE_DETERMINISTIC_ROUTE: "1",
    },
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
  assert.equal(payload.model, "local-template-tool-only-bounded");
  assert.equal(payload.answer?.route_code, ROUTE_DECISION_CODES.BOUNDED_ANSWER);
  assert.equal(payload.mode, "auto");
  assert.equal(payload.businessIntent, "chat");
  assert.match(payload.reply, /保守结论|继续追问/u);
  assert.equal(legacyAvailabilityCalled, false);
  assert.equal(legacyGeminiCalled, false);
});

test("handleChatRequest only enters legacy emergency fallback when CHAT_ENABLE_LEGACY_FALLBACK=1", async () => {
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
    env: {
      CHAT_ENABLE_LEGACY_FALLBACK: "1",
    },
  };

  let legacyAvailabilityCalled = false;
  let legacyGeminiCalled = false;
  const response = await handleChatRequest(context, "req-tool-first-legacy-emergency", {
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
  assert.equal(legacyAvailabilityCalled, true);
  assert.equal(legacyGeminiCalled, true);
});

test("handleChatRequest returns time boundary reply when requested real-world window is not fully covered", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "近三个月整体趋势如何",
        business_snapshot: {
          analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
        },
      }),
    }),
    env: {},
  };

  let directToolCalled = false;
  let autoToolCalled = false;
  let legacyAvailabilityCalled = false;
  const response = await handleChatRequest(context, "req-time-boundary", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    parseTimeIntent: () => ({
      requested_time_window: {
        kind: "relative",
        label: "近三个月",
        start_month: "2025-12",
        end_month: "2026-02",
        period: "2025-12~2026-02",
        anchor_mode: "none",
      },
      comparison_time_window: {
        kind: "none",
        label: "",
        start_month: "",
        end_month: "",
        period: "",
        anchor_mode: "none",
      },
      time_compare_mode: "none",
    }),
    buildTimeWindowCoverage: () => ({
      code: "partial",
      available_start_month: "2025-01",
      available_end_month: "2025-12",
      available_period: "2025-01~2025-12",
    }),
    runDirectToolChat: async () => {
      directToolCalled = true;
      return { ok: false };
    },
    runToolFirstChat: async () => {
      autoToolCalled = true;
      return { ok: false };
    },
    buildDataAvailability: () => {
      legacyAvailabilityCalled = true;
      return {};
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.model, "local-template-time-boundary");
  assert.equal(directToolCalled, false);
  assert.equal(autoToolCalled, false);
  assert.equal(legacyAvailabilityCalled, false);
  assert.match(payload.reply, /2025-12~2026-02/u);
  assert.match(payload.reply, /2025-01~2025-12/u);
});

test("handleChatRequest returns year-ambiguous quarter boundary reply before tool paths", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "Q4季度销售情况如何",
        business_snapshot: {
          analysis_range: { start_month: "2025-04", end_month: "2025-12", period: "2025-04~2025-12" },
        },
      }),
    }),
    env: {},
  };

  let directToolCalled = false;
  let autoToolCalled = false;
  const response = await handleChatRequest(context, "req-quarter-ambiguous", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    parseTimeIntent: () => ({
      requested_time_window: {
        kind: "absolute",
        label: "Q4季度",
        start_month: "",
        end_month: "",
        period: "",
        anchor_mode: "none",
      },
      comparison_time_window: {
        kind: "none",
        label: "",
        start_month: "",
        end_month: "",
        period: "",
        anchor_mode: "none",
      },
      time_compare_mode: "none",
    }),
    runDirectToolChat: async () => {
      directToolCalled = true;
      return { ok: false };
    },
    runToolFirstChat: async () => {
      autoToolCalled = true;
      return { ok: false };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.model, "local-template-time-boundary");
  assert.equal(directToolCalled, false);
  assert.equal(autoToolCalled, false);
  assert.match(payload.reply, /未写年份的季度|无法唯一确定/u);
});

test("handleChatRequest passes requested subwindow snapshot into deterministic tool route when coverage is full", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "华美这家机构近三个月怎么样",
        business_snapshot: {
          analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
        },
      }),
    }),
    env: {
      CHAT_ENABLE_DETERMINISTIC_ROUTE: "1",
    },
  };

  let observedSnapshotPeriod = "";
  const response = await handleChatRequest(context, "req-time-full", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    parseTimeIntent: () => ({
      requested_time_window: {
        kind: "relative",
        label: "近三个月",
        start_month: "2025-10",
        end_month: "2025-12",
        period: "2025-10~2025-12",
        anchor_mode: "none",
      },
      comparison_time_window: {
        kind: "none",
        label: "",
        start_month: "",
        end_month: "",
        period: "",
        anchor_mode: "none",
      },
      time_compare_mode: "none",
    }),
    buildTimeWindowCoverage: () => ({
      code: "full",
      available_start_month: "2025-01",
      available_end_month: "2025-12",
      available_period: "2025-01~2025-12",
    }),
    resolveHospitalNamedRequestContext: () => ({
      hospitalNamedRequested: true,
      requestedHospitals: [{ mention_name: "华美这家机构" }],
    }),
    buildDeterministicToolRoute: () => ({
      matched: true,
      route_type: "hospital_named",
      tool_name: "get_hospital_summary",
      tool_args: { hospital_names: ["华美这家机构"], limit: 10 },
    }),
    runDirectToolChat: async ({ businessSnapshot, requestedTimeWindow }) => {
      observedSnapshotPeriod = businessSnapshot.analysis_range.period;
      assert.equal(requestedTimeWindow.period, "2025-10~2025-12");
      return {
        ok: true,
        reply: "按 2025-10~2025-12 来看，华美这家机构表现稳定。",
        model: "deterministic-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
          boundary_needed: false,
          refuse_mode: false,
        },
        toolRuntimeState: { attempted: true, success: true },
        toolCallTrace: [],
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(observedSnapshotPeriod, "2025-10~2025-12");
  assert.match(payload.reply, /2025-10~2025-12/u);
});

test("handleChatRequest returns compare boundary reply when quarter compare cannot anchor a unique year", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "Q4对比Q3的情况如何",
        business_snapshot: {
          analysis_range: { start_month: "2025-04", end_month: "2025-12", period: "2025-04~2025-12" },
        },
      }),
    }),
    env: {},
  };

  let directToolCalled = false;
  let autoToolCalled = false;
  let legacyAvailabilityCalled = false;
  const response = await handleChatRequest(context, "req-quarter-compare-ambiguous", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    parseTimeIntent: () => ({
      requested_time_window: {
        kind: "absolute",
        label: "Q4",
        start_month: "",
        end_month: "",
        period: "",
        anchor_mode: "none",
      },
      comparison_time_window: {
        kind: "absolute",
        label: "Q3",
        start_month: "",
        end_month: "",
        period: "",
        anchor_mode: "none",
      },
      time_compare_mode: "quarter_compare",
    }),
    runDirectToolChat: async () => {
      directToolCalled = true;
      return { ok: false };
    },
    runToolFirstChat: async () => {
      autoToolCalled = true;
      return { ok: false };
    },
    buildDataAvailability: () => {
      legacyAvailabilityCalled = true;
      return {};
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.model, "local-template-time-boundary");
  assert.equal(directToolCalled, false);
  assert.equal(autoToolCalled, false);
  assert.equal(legacyAvailabilityCalled, false);
  assert.match(payload.reply, /未写年份的季度对比|无法唯一确定/u);
});

test("handleChatRequest routes quarter compare deterministically before AUTO tool-first", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "25年Q4对比Q3的情况如何",
        business_snapshot: {
          analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
        },
      }),
    }),
    env: {
      CHAT_ENABLE_DETERMINISTIC_ROUTE: "1",
    },
  };

  let autoToolCalled = false;
  let directToolCalled = false;
  const response = await handleChatRequest(context, "req-quarter-compare-deterministic", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    parseTimeIntent: () => ({
      requested_time_window: {
        kind: "absolute",
        label: "25年Q4",
        start_month: "2025-10",
        end_month: "2025-12",
        period: "2025-10~2025-12",
        anchor_mode: "explicit",
      },
      comparison_time_window: {
        kind: "absolute",
        label: "Q3",
        start_month: "2025-07",
        end_month: "2025-09",
        period: "2025-07~2025-09",
        anchor_mode: "explicit",
      },
      time_compare_mode: "quarter_compare",
    }),
    buildDeterministicToolRoute: () => ({
      matched: true,
      route_type: "overall_period_compare",
      tool_name: "get_period_comparison_summary",
      tool_args: {
        primary_start_month: "2025-10",
        primary_end_month: "2025-12",
        comparison_start_month: "2025-07",
        comparison_end_month: "2025-09",
        dimension: "overall",
      },
    }),
    runDirectToolChat: async ({ requestedTimeWindow, comparisonTimeWindow, timeCompareMode }) => {
      directToolCalled = true;
      assert.equal(requestedTimeWindow.period, "2025-10~2025-12");
      assert.equal(comparisonTimeWindow.period, "2025-07~2025-09");
      assert.equal(timeCompareMode, "quarter_compare");
      return {
        ok: true,
        reply: "按 2025-10~2025-12 对比 2025-07~2025-09 来看，Q4整体表现更强。",
        model: "deterministic-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
          boundary_needed: false,
          refuse_mode: false,
          overall_period_compare_mode: true,
        },
        toolRuntimeState: { attempted: true, success: true },
        toolCallTrace: [],
      };
    },
    runToolFirstChat: async () => {
      autoToolCalled = true;
      return { ok: false };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(directToolCalled, true);
  assert.equal(autoToolCalled, false);
  assert.match(payload.reply, /2025-10~2025-12/u);
  assert.match(payload.reply, /2025-07~2025-09/u);
});

test("handleChatRequest uses deterministic direct-tool route before AUTO tool-first", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "Botox50在哪些医院贡献最多",
        business_snapshot: {
          analysis_range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
        },
      }),
    }),
    env: {
      CHAT_ENABLE_DETERMINISTIC_ROUTE: "1",
    },
  };

  let autoToolCalled = false;
  let directToolCalled = false;
  const response = await handleChatRequest(context, "req-deterministic-tool", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    buildQuestionJudgment: () => ({
      primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL, label: "医院" },
      granularity: { code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY, label: "摘要级" },
      relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
    }),
    resolveProductNamedRequestContext: async () => ({
      productNamedRequested: true,
      requestedProducts: [{ product_name: "Botox50" }],
      productNamedMatchMode: "exact",
    }),
    resolveHospitalNamedRequestContext: () => ({ hospitalNamedRequested: false, requestedHospitals: [] }),
    resolveProductHospitalRequestContext: () => ({ productHospitalRequested: true }),
    buildDeterministicToolRoute: () => ({
      matched: true,
      route_type: "product_hospital",
      tool_name: "get_product_hospital_contribution",
      tool_args: { product_names: ["Botox50"], limit: 10 },
    }),
    runDirectToolChat: async () => {
      directToolCalled = true;
      return {
        ok: true,
        reply: "Botox50 的主要贡献医院包括广东韩妃整形外科医院有限公司、广州华美医疗美容医院有限公司和广东祈福医院有限公司。",
        model: "deterministic-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
          boundary_needed: false,
          refuse_mode: false,
          product_hospital_detail_mode: true,
          product_hospital_support_code: "full",
          product_hospital_zero_result_mode: false,
          tool_route_mode: "deterministic",
          tool_route_type: "product_hospital",
          tool_route_name: "get_product_hospital_contribution",
          tool_result_coverage_code: "full",
          tool_result_row_count_value: 3,
          tool_result_row_names: [
            "广东韩妃整形外科医院有限公司",
            "广州华美医疗美容医院有限公司",
            "广东祈福医院有限公司",
          ],
          tool_result_matched_products: ["Botox50"],
        },
        toolRuntimeState: { attempted: true, success: true },
        toolCallTrace: [],
      };
    },
    runToolFirstChat: async () => {
      autoToolCalled = true;
      return { ok: false, fallbackReason: "should-not-run" };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(directToolCalled, true);
  assert.equal(autoToolCalled, false);
  assert.equal(payload.model, "deterministic-model");
});

test("handleChatRequest defaults to AUTO tool-first even when a deterministic route could match", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "Botox50在哪些医院贡献最多",
        business_snapshot: {
          analysis_range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
        },
      }),
    }),
    env: {},
  };

  let directToolCalled = false;
  let autoToolCalled = false;
  const response = await handleChatRequest(context, "req-tool-first-default", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    buildDeterministicToolRoute: () => ({
      matched: true,
      route_type: "product_hospital",
      tool_name: "get_product_hospital_contribution",
      tool_args: { product_names: ["Botox50"], limit: 10 },
    }),
    runDirectToolChat: async () => {
      directToolCalled = true;
      return { ok: false, fallbackReason: "should-not-run" };
    },
    runToolFirstChat: async () => {
      autoToolCalled = true;
      return {
        ok: true,
        reply: "当前范围内，Botox50 的主要贡献医院集中在广东韩妃整形外科医院有限公司和广州华美医疗美容医院有限公司。",
        model: "tool-first-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
          boundary_needed: false,
          refuse_mode: false,
        },
        toolRuntimeState: { attempted: true, success: true, final_route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER },
        toolCallTrace: [],
        toolResult: {
          coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
          boundaries: [],
          diagnostic_flags: ["view_product_hospital"],
          summary: { sales_amount: "120.00万元", sales_volume: "200盒" },
          rows: [{ hospital_name: "广东韩妃整形外科医院有限公司", sales_amount: "60.00万元" }],
        },
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(directToolCalled, false);
  assert.equal(autoToolCalled, true);
  assert.equal(payload.model, "tool-first-model");
});

test("handleChatRequest routes full-covered Q4 overall question to deterministic overall_time_window before AUTO", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "Q4季度销售情况如何",
        business_snapshot: {
          analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
        },
      }),
    }),
    env: {
      CHAT_ENABLE_DETERMINISTIC_ROUTE: "1",
    },
  };

  let directToolCalled = false;
  let autoToolCalled = false;
  const response = await handleChatRequest(context, "req-overall-time-route", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    buildQuestionJudgment: () => ({
      primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL, label: "整体" },
      granularity: { code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY, label: "摘要级" },
      relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
    }),
    resolveProductNamedRequestContext: async () => ({
      productNamedRequested: false,
      requestedProducts: [],
      productNamedMatchMode: "none",
    }),
    resolveHospitalNamedRequestContext: () => ({ hospitalNamedRequested: false, requestedHospitals: [] }),
    resolveProductHospitalRequestContext: () => ({ productHospitalRequested: false }),
    runDirectToolChat: async () => {
      directToolCalled = true;
      return {
        ok: true,
        reply: "按当前数据年份口径，这里将 Q4季度 解释为 2025年Q4（2025-10~2025-12）。整体销售在该时间区间内已有明确结果，销售额为 300.00万元。",
        model: "deterministic-overall-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
          boundary_needed: false,
          refuse_mode: false,
          tool_route_mode: "deterministic",
          tool_route_type: "overall_time_window",
          tool_route_name: "get_overall_summary",
          tool_result_coverage_code: "full",
          requested_time_window_kind: "absolute",
          requested_time_window_label: "Q4季度",
          requested_time_window_start_month: "2025-10",
          requested_time_window_end_month: "2025-12",
          requested_time_window_period: "2025-10~2025-12",
          requested_time_window_anchor_mode: "analysis_year",
        },
        toolRuntimeState: { attempted: true, success: true },
        toolCallTrace: [],
      };
    },
    runToolFirstChat: async () => {
      autoToolCalled = true;
      return { ok: false, fallbackReason: "should-not-run" };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(directToolCalled, true);
  assert.equal(autoToolCalled, false);
  assert.equal(payload.model, "deterministic-overall-model");
  assert.match(payload.reply, /2025年Q4|2025-10~2025-12/u);
});

test("handleChatRequest uses local deterministic fallback reply when Gemini direct generation times out", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "Botox50在哪些医院贡献最多",
        business_snapshot: {
          analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
        },
      }),
    }),
    env: {
      CHAT_ENABLE_DETERMINISTIC_ROUTE: "1",
    },
  };

  const response = await handleChatRequest(context, "req-direct-local-fallback", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    buildQuestionJudgment: () => ({
      primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL, label: "医院" },
      granularity: { code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY, label: "摘要级" },
      relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
    }),
    resolveProductNamedRequestContext: async () => ({
      productNamedRequested: true,
      requestedProducts: [{ product_name: "Botox50" }],
      productNamedMatchMode: "exact",
    }),
    resolveHospitalNamedRequestContext: () => ({ hospitalNamedRequested: false, requestedHospitals: [] }),
    resolveProductHospitalRequestContext: () => ({ productHospitalRequested: true }),
    buildDeterministicToolRoute: () => ({
      matched: true,
      route_type: "product_hospital",
      tool_name: "get_product_hospital_contribution",
      tool_args: { product_names: ["Botox50"], limit: 10 },
    }),
    runDirectToolChat: async () => ({
      ok: true,
      reply: [
        "本轮分析时间区间为 2025-10~2025-12。",
        "Botox50的主要贡献医院集中在广东韩妃整形外科医院有限公司、广州华美医疗美容医院有限公司、广东祈福医院有限公司。",
        "1. 广东韩妃整形外科医院有限公司：销售额 189.76万元，占比 17.50%。",
        "2. 广州华美医疗美容医院有限公司：销售额 149.39万元，占比 13.78%。",
        "3. 广东祈福医院有限公司：销售额 112.64万元，占比 10.39%。",
        "建议优先复盘广东韩妃整形外科医院有限公司的贡献驱动，并对比其他重点医院的持续性。",
      ].join("\n"),
      model: "local-template-tool-fallback",
      outputContext: {
        route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
        boundary_needed: false,
        refuse_mode: false,
        product_hospital_detail_mode: true,
        product_hospital_support_code: "full",
        product_hospital_zero_result_mode: false,
        tool_route_mode: "deterministic",
        tool_route_type: "product_hospital",
        tool_route_name: "get_product_hospital_contribution",
        tool_result_coverage_code: "full",
        tool_result_row_count_value: 3,
        tool_result_row_names: [
          "广东韩妃整形外科医院有限公司",
          "广州华美医疗美容医院有限公司",
          "广东祈福医院有限公司",
        ],
        tool_result_matched_products: ["Botox50"],
        requested_time_window_kind: "absolute",
        requested_time_window_label: "Q4季度",
        requested_time_window_start_month: "2025-10",
        requested_time_window_end_month: "2025-12",
        requested_time_window_period: "2025-10~2025-12",
        requested_time_window_anchor_mode: "analysis_year",
        local_response_mode: "tool_result_fallback",
      },
      toolRuntimeState: { attempted: true, success: true },
      toolCallTrace: [],
    }),
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.model, "local-template-tool-fallback");
  assert.match(payload.reply, /2025-10~2025-12/u);
  assert.match(payload.reply, /广东韩妃整形外科医院有限公司/u);
  assert.doesNotMatch(payload.reply, /high demand|超时|暂时无法完成/u);
});

test("handleChatRequest returns bounded local reply when deterministic direct-tool fails and legacy fallback is disabled", async () => {
  const context = {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        message: "Botox50在哪些医院贡献最多",
        business_snapshot: {
          analysis_range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
        },
      }),
    }),
    env: {
      CHAT_ENABLE_DETERMINISTIC_ROUTE: "1",
    },
  };

  let autoToolCalled = false;
  let legacyGeminiCalled = false;
  const response = await handleChatRequest(context, "req-deterministic-fallback", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    buildQuestionJudgment: () => ({
      primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL, label: "医院" },
      granularity: { code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY, label: "摘要级" },
      relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
    }),
    resolveProductNamedRequestContext: async () => ({
      productNamedRequested: true,
      requestedProducts: [{ product_name: "Botox50" }],
      productNamedMatchMode: "exact",
    }),
    resolveHospitalNamedRequestContext: () => ({ hospitalNamedRequested: false, requestedHospitals: [] }),
    resolveProductHospitalRequestContext: () => ({ productHospitalRequested: true }),
    buildDeterministicToolRoute: () => ({
      matched: true,
      route_type: "product_hospital",
      tool_name: "get_product_hospital_contribution",
      tool_args: { product_names: ["Botox50"], limit: 10 },
    }),
    runDirectToolChat: async () => ({
      ok: false,
      fallbackReason: "deterministic_tool_execution_failed",
      toolRuntimeState: { attempted: true, success: false },
      toolCallTrace: [],
    }),
    runToolFirstChat: async () => {
      autoToolCalled = true;
      return { ok: false, fallbackReason: "should-not-run" };
    },
    buildDataAvailability: () => ({
      has_business_data: { code: DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE, label: "有" },
      dimension_availability: { code: DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE, label: "具备" },
      answer_depth: { code: DATA_AVAILABILITY_CODES.answer_depth.FOCUSED, label: "重点分析" },
      gap_hint_needed: { code: DATA_AVAILABILITY_CODES.gap_hint_needed.NO, label: "否" },
      detail_request_mode: "product_hospital",
      hospital_monthly_support: "none",
      product_hospital_support: "full",
      hospital_named_support: "none",
      product_full_support: "none",
      product_named_support: "full",
      product_named_match_mode: "exact",
      requested_product_count_value: 1,
      product_hospital_hospital_count_value: 3,
      product_hospital_zero_result: "no",
    }),
    buildRouteDecision: () => ({
      route: { code: ROUTE_DECISION_CODES.DIRECT_ANSWER, label: "直接回答" },
      reason_codes: ["sufficient"],
    }),
    callGemini: async () => {
      legacyGeminiCalled = true;
      return {
        ok: true,
        reply: "当前可见范围内，Botox50 的主要贡献医院包括广东韩妃整形外科医院有限公司和广州华美医疗美容医院有限公司。",
        model: "legacy-model",
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(autoToolCalled, false);
  assert.equal(legacyGeminiCalled, false);
  assert.equal(payload.model, "local-template-tool-only-bounded");
  assert.equal(payload.answer?.route_code, ROUTE_DECISION_CODES.BOUNDED_ANSWER);
  assert.match(payload.reply, /Botox50|继续追问|保守结论/u);
});
