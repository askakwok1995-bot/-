import assert from "node:assert/strict";
import test from "node:test";

import { handleChatRequest } from "../functions/api/chat.js";
import { buildChatSuccessPayload } from "../functions/chat/render.js";
import { QUESTION_JUDGMENT_CODES, ROUTE_DECISION_CODES } from "../functions/chat/shared.js";

function buildContext(body) {
  return {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify(body),
    }),
    env: {},
  };
}

test("buildChatSuccessPayload keeps auto mode answer contract stable", () => {
  const evidenceBundle = {
    source_period: "2025-01~2025-12",
    evidence: [{ label: "销售额", value: "12.00万元", insight: "当前分析区间" }],
    actions: [],
    boundaries: ["当前回答基于现有口径给出方向性结论，暂不支持更细颗粒度拆解。"],
    next_questions: [],
  };
  const questionJudgment = {
    primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL, label: "整体" },
  };
  const routeDecision = {
    route: { code: ROUTE_DECISION_CODES.DIRECT_ANSWER, label: "直接回答" },
  };

  const autoPayload = buildChatSuccessPayload({
    mode: "auto",
    replyText: "当前整体表现稳中向上。",
    evidenceBundle,
    questionJudgment,
    routeDecision,
    model: "stub-model",
    requestId: "req-auto",
  });
  const repeatedAutoPayload = buildChatSuccessPayload({
    mode: "auto",
    replyText: "当前整体表现稳中向上。",
    evidenceBundle,
    questionJudgment,
    routeDecision,
    model: "stub-model",
    requestId: "req-auto-2",
  });

  assert.equal(autoPayload.answer.output_shape, "text");
  assert.equal(repeatedAutoPayload.answer.output_shape, "text");
  assert.equal(autoPayload.mode, "auto");
  assert.equal(repeatedAutoPayload.mode, "auto");
  assert.equal(autoPayload.businessIntent, "chat");
  assert.equal(repeatedAutoPayload.businessIntent, "chat");
  assert.equal(autoPayload.answer.style, "natural");
  assert.equal(repeatedAutoPayload.answer.style, "natural");
  assert.equal(autoPayload.answer.source_period, repeatedAutoPayload.answer.source_period);
  assert.deepEqual(autoPayload.answer.evidence, repeatedAutoPayload.answer.evidence);
  assert.equal("structured" in autoPayload, false);
  assert.equal("responseAction" in autoPayload, false);
  assert.equal("headline" in autoPayload.answer, false);
  assert.equal("sections" in autoPayload.answer, false);
  assert.equal("followups" in autoPayload.answer, false);
});

test("handleChatRequest rejects removed chat modes", async () => {
  for (const mode of ["briefing", "diagnosis", "action-plan"]) {
    const context = buildContext({
      message: "这个情况如何",
      mode,
      business_snapshot: {
        analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
      },
    });

    const response = await handleChatRequest(context, `req-answer-invalid-mode-${mode}`, {
      verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    });

    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error?.code, "BAD_REQUEST");
    assert.match(payload.error?.message || "", /mode 仅支持 auto|已移除/u);
  }
});

test("handleChatRequest accepts explicit auto mode", async () => {
  const context = buildContext({
    message: "这个情况如何",
    mode: "auto",
    business_snapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
  });

  const response = await handleChatRequest(context, "req-answer-auto", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    runToolFirstChat: async () => ({
      ok: true,
      reply: "当前整体销售保持增长，建议继续关注核心驱动因素。",
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
      toolResult: {
        coverage: { code: "full", message: "当前分析区间已完整覆盖。" },
        range: { period: "2025-01~2025-12" },
        summary: {
          sales_amount: "12.00万元",
          amount_achievement: "80.00%",
          sales_volume: "300盒",
          key_business_signals: ["最近月销售额上升。"],
        },
        rows: [{ period: "2025-10", sales_amount: "4.00万元" }],
      },
    }),
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.mode, "auto");
  assert.equal(payload.answer?.style, "natural");
  assert.equal(payload.answer?.output_shape, "text");
  assert.equal("structured" in payload, false);
  assert.equal("responseAction" in payload, false);
  assert.match(payload.reply || "", /2025-01~2025-12|增长|驱动/u);
});

test("buildChatSuccessPayload returns text-first answer contract for ordinary analysis questions", () => {
  const evidenceBundle = {
    source_period: "2025-01~2025-02",
    evidence: [
      { label: "销售额", value: "468.81万元", insight: "2月较1月有所回落" },
      { label: "销量", value: "3719盒", insight: "当前分析区间" },
    ],
    actions: [{ title: "继续跟踪重点产品表现", timeline: "下次复盘前", metric: "销售额/贡献占比" }],
    boundaries: ["当前分析区间已完整覆盖。"],
    next_questions: ["按产品拆开看这个时间段的贡献结构。"],
  };
  const questionJudgment = {
    primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL, label: "整体" },
  };
  const routeDecision = {
    route: { code: ROUTE_DECISION_CODES.DIRECT_ANSWER, label: "直接回答" },
  };

  const payload = buildChatSuccessPayload({
    mode: "auto",
    replyText: "2025年1月至2月，销售额呈现下滑趋势，2月份销售表现较1月有所回落。",
    evidenceBundle,
    questionJudgment,
    routeDecision,
    model: "stub-model",
    requestId: "req-month-flow",
  });

  assert.equal(payload.answer.output_shape, "text");
  assert.equal(payload.answer.summary, "2025年1月至2月，销售额呈现下滑趋势，2月份销售表现较1月有所回落。");
  assert.equal(payload.answer.source_period, "2025-01~2025-02");
  assert.equal("structured" in payload, false);
  assert.equal("responseAction" in payload, false);
  assert.ok(Array.isArray(payload.answer.evidence));
  assert.ok(Array.isArray(payload.answer.boundaries));
  assert.ok(Array.isArray(payload.answer.actions));
  assert.equal("headline" in payload.answer, false);
  assert.equal("sections" in payload.answer, false);
  assert.equal("followups" in payload.answer, false);
});

test("handleChatRequest keeps explicit report questions on text-first answer contract", async () => {
  const context = buildContext({
    message: "请给我一份2025年度销售分析报告",
    mode: "auto",
    business_snapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
  });

  const response = await handleChatRequest(context, "req-answer-report", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    runToolFirstChat: async () => ({
      ok: true,
      reply: "2025年度整体销售保持增长，核心驱动主要来自重点产品与年末月份拉动。",
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
      toolResult: {
        coverage: { code: "full", message: "当前分析区间已完整覆盖。" },
        range: { period: "2025-01~2025-12" },
        summary: {
          sales_amount: "12.00万元",
          amount_achievement: "80.00%",
          sales_volume: "300盒",
          key_business_signals: ["最近月销售额上升。"],
        },
        rows: [{ period: "2025-10", sales_amount: "4.00万元" }],
      },
    }),
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.answer?.output_shape, "text");
  assert.equal("structured" in payload, false);
  assert.equal("responseAction" in payload, false);
  assert.match(payload.reply || "", /2025年度整体销售保持增长/u);
});

test("handleChatRequest inherits previous time window from conversation_state on follow-up", async () => {
  const context = buildContext({
    message: "为什么",
    history: [{ role: "user", content: "2025年Q4整体怎么样" }],
    conversation_state: {
      primary_dimension_code: "overall",
      requested_time_window: {
        kind: "absolute",
        label: "2025年Q4",
        start_month: "2025-10",
        end_month: "2025-12",
        period: "2025-10~2025-12",
        anchor_mode: "explicit",
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
      entity_scope: { products: [], hospitals: [] },
      route_code: "direct_answer",
      source_period: "2025-10~2025-12",
    },
    business_snapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
  });
  context.env.CHAT_ENABLE_DETERMINISTIC_ROUTE = "1";

  let observedRequestedWindow = null;
  const response = await handleChatRequest(context, "req-followup-window", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    buildDeterministicToolRoute: () => ({
      matched: true,
      route_type: "overall_time_window",
      tool_name: "get_overall_summary",
      tool_args: {},
    }),
    runDirectToolChat: async ({ requestedTimeWindow }) => {
      observedRequestedWindow = requestedTimeWindow;
      return {
        ok: true,
        reply: "Q4整体保持增长。",
        model: "deterministic-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
          boundary_needed: false,
          refuse_mode: false,
          tool_route_mode: "deterministic",
          tool_route_type: "overall_time_window",
          requested_time_window_period: "2025-10~2025-12",
        },
        toolRuntimeState: {
          attempted: true,
          success: true,
          final_route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
        },
        toolCallTrace: [],
        toolResult: {
          coverage: { code: "full", message: "当前分析区间已完整覆盖。" },
          range: { period: "2025-10~2025-12" },
          summary: {
            sales_amount: "8.00万元",
            sales_volume: "200盒",
          },
          rows: [],
        },
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(observedRequestedWindow?.period, "2025-10~2025-12");
  assert.equal(payload.answer?.conversation_state?.requested_time_window?.period, "2025-10~2025-12");
});

test("handleChatRequest prefers tool evidence over stale business_snapshot facts", async () => {
  const context = buildContext({
    message: "请分析当前表现",
    business_snapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
      performance_overview: {
        sales_amount: "99.00万元",
        amount_achievement: "10.00%",
        latest_key_change: "最近月金额环比 -50.00%",
        sales_volume: "999盒",
      },
    },
  });

  const response = await handleChatRequest(context, "req-authoritative-tool", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    runToolFirstChat: async () => ({
      ok: true,
      reply: "当前整体销售表现稳定。",
      model: "tool-model",
      outputContext: {
        route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
        boundary_needed: false,
        refuse_mode: false,
      },
      toolRuntimeState: {
        attempted: true,
        success: true,
        final_route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
      },
      toolCallTrace: [],
      toolResult: {
        coverage: { code: "full", message: "当前分析区间已完整覆盖。" },
        range: { period: "2025-01~2025-12" },
        summary: {
          sales_amount: "12.00万元",
          amount_achievement: "80.00%",
          sales_volume: "300盒",
        },
        rows: [],
      },
    }),
  });

  const payload = await response.json();
  const evidenceValues = Array.isArray(payload.answer?.evidence)
    ? payload.answer.evidence.map((item) => item.value)
    : [];
  assert.equal(response.status, 200);
  assert.ok(evidenceValues.includes("12.00万元"));
  assert.ok(!evidenceValues.includes("99.00万元"));
});
