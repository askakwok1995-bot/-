import assert from "node:assert/strict";
import test from "node:test";

import { handleChatRequest } from "../functions/api/chat.js";
import { CHAT_ERROR_CODES, QUESTION_JUDGMENT_CODES, ROUTE_DECISION_CODES } from "../functions/chat/shared.js";

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

test("handleChatRequest returns structured JSON error and requestId when normalization stage throws", async () => {
  const context = buildContext({
    message: "你好",
  });

  const originalConsoleError = console.error;
  const errorLogs = [];
  console.error = (...args) => {
    errorLogs.push(args.map((item) => String(item)).join(" "));
  };

  try {
    const response = await handleChatRequest(context, "req-test-error", {
      verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
      normalizeBusinessSnapshot: () => {
        throw new Error("forced-normalize-failure");
      },
    });

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("x-request-id"), "req-test-error");
    const payload = await response.json();
    assert.equal(payload.error?.code, CHAT_ERROR_CODES.INTERNAL_ERROR);
    assert.equal(payload.requestId, "req-test-error");
    assert.ok(errorLogs.some((entry) => entry.includes("\"stage\":\"normalize\"")));
  } finally {
    console.error = originalConsoleError;
  }
});

test("handleChatRequest rejects removed chat modes", async () => {
  for (const mode of ["briefing", "diagnosis", "action-plan"]) {
    const response = await handleChatRequest(
      buildContext({
        message: "这个情况如何",
        mode,
      }),
      `req-invalid-mode-${mode}`,
      {
        verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
      },
    );
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error?.code, CHAT_ERROR_CODES.BAD_REQUEST);
  }
});

test("handleChatRequest returns tool-first success with minimal payload", async () => {
  const context = buildContext({
    message: "这个月整体怎么样",
    history: [{ role: "user", content: "上个月表现如何" }],
    conversation_state: {
      primary_dimension_code: "overall",
      requested_time_window: {
        kind: "absolute",
        label: "Q1",
        start_month: "2025-01",
        end_month: "2025-03",
        period: "2025-01~2025-03",
        anchor_mode: "explicit",
      },
      comparison_time_window: { kind: "none", label: "", start_month: "", end_month: "", period: "", anchor_mode: "none" },
      time_compare_mode: "none",
      entity_scope: { products: [], hospitals: [] },
      source_period: "2025-01~2025-03",
    },
    business_snapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
  });

  const response = await handleChatRequest(context, "req-tool-success", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    parseTimeIntent: () => ({
      requested_time_window: {
        kind: "absolute",
        label: "1月到2月",
        start_month: "2025-01",
        end_month: "2025-02",
        period: "2025-01~2025-02",
        anchor_mode: "explicit",
      },
    }),
    runToolFirstChat: async ({ requestedTimeWindow, businessSnapshot }) => {
      assert.equal(requestedTimeWindow?.period, "2025-01~2025-02");
      assert.equal(businessSnapshot?.analysis_range?.period, "2025-01~2025-02");
      return {
        ok: true,
        reply: "2025年1月至2月整体销售保持增长，近期趋势延续向上。",
        model: "tool-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
        },
        plannerState: {
          relevance: QUESTION_JUDGMENT_CODES.relevance.RELEVANT,
          route_intent: ROUTE_DECISION_CODES.DIRECT_ANSWER,
          question_type: "overview",
          required_evidence: ["aggregate", "timeseries"],
          requested_views: ["scope_aggregate", "scope_timeseries"],
          missing_evidence_types: [],
          analysis_confidence: "high",
        },
        questionJudgment: {
          primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL, label: "整体" },
          granularity: { code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY, label: "摘要级" },
          relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
        },
        toolRuntimeState: {
          evidence_types_completed: ["aggregate", "timeseries"],
        },
        toolResult: {
          range: { period: "2025-01~2025-02" },
          coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
          summary: {
            sales_amount: "468.81万元",
            sales_volume: "3719盒",
            key_business_signals: ["最近月销售额上升。"],
          },
          rows: [{ period: "2025-02", sales_amount: "202.52万元", sales_volume: "1527盒" }],
        },
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.reply, "2025年1月至2月整体销售保持增长，近期趋势延续向上。");
  assert.equal(payload.model, "tool-model");
  assert.equal(payload.answer.question_type, "overview");
  assert.deepEqual(payload.answer.evidence_types, ["aggregate", "timeseries"]);
  assert.deepEqual(payload.answer.missing_evidence_types, []);
  assert.equal(payload.answer.analysis_confidence, "high");
  assert.equal(payload.answer.conversation_state?.requested_time_window?.period, "2025-01~2025-02");
  assert.equal("mode" in payload, false);
  assert.equal("businessIntent" in payload, false);
  assert.equal("surfaceReply" in payload, false);
  assert.equal("output_shape" in payload.answer, false);
});

test("handleChatRequest returns error JSON when tool-first fails", async () => {
  const response = await handleChatRequest(
    buildContext({
      message: "给我产品分析报告",
    }),
    "req-tool-fail",
    {
      verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
      runToolFirstChat: async () => ({
        ok: false,
        fallbackReason: "tool_execution_failed",
      }),
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.equal(payload.error?.code, CHAT_ERROR_CODES.INTERNAL_ERROR);
  assert.match(payload.error?.message || "", /未形成稳定结果|重试/u);
  assert.equal(payload.error?.details?.reason, "tool_execution_failed");
});

test("handleChatRequest returns error JSON instead of bounded/refuse reply", async () => {
  const boundedResponse = await handleChatRequest(
    buildContext({
      message: "给我产品分析报告",
    }),
    "req-bounded",
    {
      verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
      runToolFirstChat: async () => ({
        ok: true,
        reply: "当前只能给出方向性判断。",
        model: "tool-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.BOUNDED_ANSWER,
        },
        plannerState: {
          question_type: "report",
        },
        missingEvidenceTypes: ["timeseries", "breakdown"],
      }),
    },
  );
  const boundedPayload = await boundedResponse.json();
  assert.equal(boundedResponse.status, 400);
  assert.equal(boundedPayload.error?.code, CHAT_ERROR_CODES.BAD_REQUEST);
  assert.deepEqual(boundedPayload.error?.details?.missing_evidence_types, ["timeseries", "breakdown"]);

  const refuseResponse = await handleChatRequest(
    buildContext({
      message: "今天天气怎么样",
    }),
    "req-refuse",
    {
      verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
      runToolFirstChat: async () => ({
        ok: true,
        reply: "这不是业务问题。",
        model: "tool-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.REFUSE,
        },
        plannerState: {
          relevance: QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT,
        },
      }),
    },
  );
  const refusePayload = await refuseResponse.json();
  assert.equal(refuseResponse.status, 400);
  assert.equal(refusePayload.error?.code, CHAT_ERROR_CODES.BAD_REQUEST);
  assert.match(refusePayload.error?.message || "", /仅支持医药销售分析/u);
});
