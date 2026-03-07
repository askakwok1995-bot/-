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

  assert.equal(autoPayload.responseAction, "structured_answer");
  assert.equal(repeatedAutoPayload.responseAction, "structured_answer");
  assert.equal(autoPayload.mode, "auto");
  assert.equal(repeatedAutoPayload.mode, "auto");
  assert.equal(autoPayload.businessIntent, "chat");
  assert.equal(repeatedAutoPayload.businessIntent, "chat");
  assert.equal(autoPayload.answer.style, "natural");
  assert.equal(repeatedAutoPayload.answer.style, "natural");
  assert.equal(autoPayload.answer.source_period, repeatedAutoPayload.answer.source_period);
  assert.deepEqual(autoPayload.answer.evidence, repeatedAutoPayload.answer.evidence);
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
  assert.equal(payload.responseAction, "structured_answer");
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
