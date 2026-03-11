import assert from "node:assert/strict";
import test from "node:test";

import { handleChatRequest } from "../functions/api/chat.js";
import { CHAT_ERROR_CODES, QUESTION_JUDGMENT_CODES, ROUTE_DECISION_CODES } from "../functions/chat/shared.js";

function buildContext(body, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers && typeof options.headers === "object" ? options.headers : {}),
  };
  if (options.includeAuthorization !== false && !("authorization" in headers)) {
    headers.authorization = "Bearer test-token";
  }
  return {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    env: options.env && typeof options.env === "object" ? options.env : {},
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

test("handleChatRequest returns tool-first success with minimal payload", async () => {
  const context = buildContext({
    message: "这个月整体怎么样",
    mode: "briefing",
    history: [{ role: "user", content: "上个月表现如何" }],
    conversation_state: {
      primary_dimension_code: "overall",
      entity_scope: { products: [], hospitals: [] },
      source_period: "2025-01~2025-03",
    },
    business_snapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
  });

  const response = await handleChatRequest(context, "req-tool-success", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    runToolFirstChat: async ({ businessSnapshot }) => {
      assert.equal(businessSnapshot?.analysis_range?.period, "2025-01~2025-12");
      return {
        ok: true,
        reply: "在当前报表区间 2025-01~2025-12 内，整体销售保持增长，近期趋势延续向上。",
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
          range: { period: "2025-01~2025-12" },
          coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
          summary: {
            sales_amount: "2861.75万元",
            sales_volume: "22383盒",
            key_business_signals: ["最近月销售额上升。"],
          },
          rows: [{ period: "2025-12", sales_amount: "508.27万元", sales_volume: "3391盒" }],
        },
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.reply, "在当前报表区间 2025-01~2025-12 内，整体销售保持增长，近期趋势延续向上。");
  assert.equal(payload.model, "tool-model");
  assert.equal(payload.answer.question_type, "overview");
  assert.deepEqual(payload.answer.evidence_types, ["aggregate", "timeseries"]);
  assert.deepEqual(payload.answer.missing_evidence_types, []);
  assert.equal(payload.answer.analysis_confidence, "high");
  assert.equal(payload.answer.conversation_state?.source_period, "2025-01~2025-12");
  assert.equal("requested_time_window" in (payload.answer.conversation_state || {}), false);
  assert.equal("mode" in payload, false);
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

test("handleChatRequest blocks live chat when entitlement is inactive", async () => {
  const response = await handleChatRequest(
    buildContext({
      message: "分析本月销售",
    }),
    "req-entitlement-expired",
    {
      verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token", userId: "user-1" }),
      checkActiveEntitlement: async () => ({
        ok: false,
        code: CHAT_ERROR_CODES.UNAUTHORIZED,
        message: "当前账号授权已到期，请联系管理员续费后再试。",
        status: 403,
      }),
      runToolFirstChat: async () => {
        throw new Error("expired entitlement should not call tool-first");
      },
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.error?.code, CHAT_ERROR_CODES.UNAUTHORIZED);
  assert.match(payload.error?.message || "", /授权已到期/u);
});

test("handleChatRequest returns success payload for bounded answer and error JSON for refuse", async () => {
  const boundedResponse = await handleChatRequest(
    buildContext({
      message: "给我产品分析报告",
    }),
    "req-bounded",
    {
      verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
      runToolFirstChat: async () => ({
        ok: true,
        reply: "在当前报表区间内，产品表现已有初步结论，但趋势和结构证据仍不完整。",
        model: "tool-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.BOUNDED_ANSWER,
        },
        plannerState: {
          question_type: "report",
          analysis_confidence: "low",
          missing_evidence_types: ["timeseries", "breakdown"],
        },
        toolRuntimeState: {
          evidence_types_completed: ["aggregate"],
        },
        questionJudgment: {
          primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT, label: "产品" },
          granularity: { code: QUESTION_JUDGMENT_CODES.granularity.DETAIL, label: "明细级" },
          relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
        },
        missingEvidenceTypes: ["timeseries", "breakdown"],
        toolResult: {
          range: { period: "2025-01~2025-12" },
          coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
          summary: {
            sales_amount: "2861.75万元",
            sales_volume: "22383盒",
          },
          rows: [{ product_name: "Botox50", sales_amount: "1084.10万元" }],
        },
      }),
    },
  );
  const boundedPayload = await boundedResponse.json();
  assert.equal(boundedResponse.status, 200);
  assert.equal(boundedPayload.reply, "在当前报表区间内，产品表现已有初步结论，但趋势和结构证据仍不完整。");
  assert.equal(boundedPayload.answer.question_type, "report");
  assert.deepEqual(boundedPayload.answer.evidence_types, ["aggregate"]);
  assert.deepEqual(boundedPayload.answer.missing_evidence_types, ["timeseries", "breakdown"]);
  assert.equal(boundedPayload.answer.analysis_confidence, "low");

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

test("handleChatRequest explains explicit term follow-up from recent assistant history without tool-first", async () => {
  const context = buildContext({
    message: "月度覆盖率是什么意思？",
    history: [
      {
        role: "assistant",
        content: "在2025-01~2025-12的医院分析中，部分医院月度覆盖率不足。术语：月度覆盖率。",
      },
    ],
    conversation_state: {
      primary_dimension_code: "hospital",
      entity_scope: { products: [], hospitals: [] },
      source_period: "2025-01~2025-12",
    },
    business_snapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
  });

  const response = await handleChatRequest(context, "req-term-explain", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    runToolFirstChat: async () => {
      throw new Error("term explain path should not call tool-first");
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.match(payload.reply, /月度覆盖率/u);
  assert.match(payload.reply, /2025-01~2025-12/u);
  assert.match(payload.reply, /医院/u);
  assert.equal(payload.model, "term_explainer");
});

test("handleChatRequest writes matched hospitals into conversation_state entity_scope", async () => {
  const response = await handleChatRequest(
    buildContext({
      message: "卓正和卓祥这个季度卖了多少了",
      conversation_state: {
        primary_dimension_code: "overall",
        entity_scope: { products: [], hospitals: [] },
        source_period: "2025-01~2025-12",
      },
    }),
    "req-entity-scope",
    {
      verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
      runToolFirstChat: async () => ({
        ok: true,
        reply: "卓正优社医院和广州卓祥医疗门诊部有限公司本季度均有销售表现。",
        model: "tool-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
        },
        plannerState: {
          relevance: QUESTION_JUDGMENT_CODES.relevance.RELEVANT,
          route_intent: ROUTE_DECISION_CODES.DIRECT_ANSWER,
          question_type: "overview",
          required_evidence: ["aggregate"],
          requested_views: ["get_hospital_summary"],
          missing_evidence_types: [],
          analysis_confidence: "high",
        },
        questionJudgment: {
          primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL, label: "医院" },
          granularity: { code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY, label: "摘要级" },
          relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
        },
        toolRuntimeState: {
          evidence_types_completed: ["aggregate"],
        },
        toolResult: {
          range: { period: "2025-01~2025-12" },
          matched_entities: {
            hospitals: ["卓正优社医院", "广州卓祥医疗门诊部有限公司"],
          },
          unmatched_entities: {
            hospitals: [],
            products: [],
          },
          coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
          summary: {
            sales_amount: "11.12万元",
          },
          rows: [],
        },
      }),
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.answer.conversation_state?.entity_scope?.hospitals, [
    "卓正优社医院",
    "广州卓祥医疗门诊部有限公司",
  ]);
  assert.equal(payload.answer.conversation_state?.primary_dimension_code, "hospital");
});

test("handleChatRequest forwards narrow referential follow-up context into tool-first", async () => {
  const context = buildContext({
    message: "是这两家，我要看具体产品规格和数量",
    history: [
      {
        role: "assistant",
        content: "已确认对象：卓正优社医院、广州卓祥医疗门诊部有限公司。",
      },
    ],
    conversation_state: {
      primary_dimension_code: "hospital",
      entity_scope: {
        products: [],
        hospitals: ["卓正优社医院", "广州卓祥医疗门诊部有限公司"],
      },
      source_period: "2025-01~2025-12",
    },
    business_snapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
  });

  const response = await handleChatRequest(context, "req-followup-scope", {
    verifySupabaseAccessToken: async () => ({ ok: true, token: "test-token" }),
    runToolFirstChat: async ({ conversationState, followupContext }) => {
      assert.deepEqual(conversationState?.entity_scope?.hospitals, [
        "卓正优社医院",
        "广州卓祥医疗门诊部有限公司",
      ]);
      assert.equal(followupContext?.kind, "entity_scope_followup");
      assert.equal(followupContext?.primary_entity_type, "hospital");
      return {
        ok: true,
        reply: "这两家医院的具体产品规格和数量如下。",
        model: "tool-model",
        outputContext: {
          route_code: ROUTE_DECISION_CODES.DIRECT_ANSWER,
        },
        plannerState: {
          relevance: QUESTION_JUDGMENT_CODES.relevance.RELEVANT,
          route_intent: ROUTE_DECISION_CODES.DIRECT_ANSWER,
          question_type: "overview",
          required_evidence: ["breakdown"],
          requested_views: ["scope_breakdown"],
          missing_evidence_types: [],
          analysis_confidence: "high",
        },
        questionJudgment: {
          primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL, label: "医院" },
          granularity: { code: QUESTION_JUDGMENT_CODES.granularity.DETAIL, label: "明细级" },
          relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT, label: "医药销售相关" },
        },
        toolRuntimeState: {
          evidence_types_completed: ["breakdown"],
        },
        toolResult: {
          range: { period: "2025-01~2025-12" },
          coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
          summary: { sales_amount: "11.12万元" },
          rows: [{ hospital_name: "卓正优社医院", product_name: "诺和盈0.25mg", sales_volume: "10盒" }],
          matched_entities: {
            hospitals: ["卓正优社医院", "广州卓祥医疗门诊部有限公司"],
          },
          unmatched_entities: {
            hospitals: [],
            products: [],
          },
        },
      };
    },
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.match(payload.reply, /具体产品规格和数量/u);
});

test("handleChatRequest supports demo mode without authorization and skips tool-first", async () => {
  let verifyCalled = false;
  let toolCalled = false;
  let demoCalled = false;
  const response = await handleChatRequest(
    buildContext(
      {
        message: "根据当前分析区间，生成详细销售分析报告",
        workspace_mode: "demo",
        conversation_state: {
          primary_dimension_code: "overall",
          entity_scope: { products: [], hospitals: [] },
          source_period: "2026-01~2026-03",
        },
        business_snapshot: {
          analysis_range: { start_month: "2026-01", end_month: "2026-03", period: "2026-01~2026-03" },
          performance_overview: {
            sales_amount: "15.00万元",
            amount_achievement: "92.00%",
          },
          key_business_signals: ["最近月金额环比上升。"],
          recent_trends: [{ period: "2026-03", sales_amount: "5.20万元", amount_mom: "+8.00%" }],
        },
      },
      {
        includeAuthorization: false,
        headers: {
          "x-forwarded-for": "203.0.113.11",
        },
      },
    ),
    "req-demo-success",
    {
      verifySupabaseAccessToken: async () => {
        verifyCalled = true;
        throw new Error("demo mode should not verify auth");
      },
      runToolFirstChat: async () => {
        toolCalled = true;
        throw new Error("demo mode should not call tool-first");
      },
      requestDemoSnapshotChat: async ({ businessSnapshot, conversationState }) => {
        demoCalled = true;
        assert.equal(businessSnapshot?.analysis_range?.period, "2026-01~2026-03");
        assert.equal(conversationState?.source_period, "2026-01~2026-03");
        return {
          ok: true,
          replyText: "基于当前演示报表，整体销售维持增长，最近月表现继续向上。",
          model: "demo-model",
          evidenceBundle: {
            source_period: "2026-01~2026-03",
            question_type: "report",
            evidence_types: ["aggregate", "timeseries"],
            missing_evidence_types: [],
            analysis_confidence: "high",
            evidence: [{ label: "销售额", value: "15.00万元", insight: "2026-01~2026-03" }],
            actions: [],
          },
          conversationState: {
            primary_dimension_code: "overall",
            entity_scope: { products: [], hospitals: [] },
            source_period: "2026-01~2026-03",
          },
        };
      },
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.model, "demo-model");
  assert.equal(payload.answer.conversation_state?.source_period, "2026-01~2026-03");
  assert.equal(verifyCalled, false);
  assert.equal(toolCalled, false);
  assert.equal(demoCalled, true);
});

test("handleChatRequest supports demo term explain without authorization", async () => {
  const response = await handleChatRequest(
    buildContext(
      {
        message: "月度覆盖率是什么意思？",
        workspace_mode: "demo",
        history: [
          {
            role: "assistant",
            content: "在2026-01~2026-03的医院分析中，部分医院月度覆盖率不足。术语：月度覆盖率。",
          },
        ],
        conversation_state: {
          primary_dimension_code: "hospital",
          entity_scope: { products: [], hospitals: [] },
          source_period: "2026-01~2026-03",
        },
        business_snapshot: {
          analysis_range: { start_month: "2026-01", end_month: "2026-03", period: "2026-01~2026-03" },
        },
      },
      {
        includeAuthorization: false,
        headers: {
          "x-forwarded-for": "203.0.113.12",
        },
      },
    ),
    "req-demo-term",
    {
      verifySupabaseAccessToken: async () => {
        throw new Error("demo term explain should not verify auth");
      },
      runToolFirstChat: async () => {
        throw new Error("demo term explain should not call tool-first");
      },
      requestDemoSnapshotChat: async () => {
        throw new Error("demo term explain should not call gemini branch");
      },
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.model, "term_explainer");
  assert.match(payload.reply, /月度覆盖率/u);
  assert.match(payload.reply, /2026-01~2026-03/u);
});

test("handleChatRequest rate limits anonymous demo requests on the seventh call", async () => {
  const headers = {
    "x-forwarded-for": "203.0.113.19",
  };

  for (let index = 0; index < 6; index += 1) {
    const response = await handleChatRequest(
      buildContext(
        {
          message: `分析第 ${index + 1} 次`,
          workspace_mode: "demo",
          business_snapshot: {
            analysis_range: { start_month: "2026-01", end_month: "2026-03", period: "2026-01~2026-03" },
          },
        },
        {
          includeAuthorization: false,
          headers,
        },
      ),
      `req-demo-limit-${index}`,
      {
        requestDemoSnapshotChat: async () => ({
          ok: true,
          replyText: "演示回答正常返回。",
          model: "demo-model",
          evidenceBundle: {
            source_period: "2026-01~2026-03",
            question_type: "overview",
            evidence_types: ["aggregate"],
            missing_evidence_types: [],
            analysis_confidence: "medium",
            evidence: [],
            actions: [],
          },
          conversationState: {
            primary_dimension_code: "",
            entity_scope: { products: [], hospitals: [] },
            source_period: "2026-01~2026-03",
          },
        }),
      },
    );
    assert.equal(response.status, 200);
  }

  const limitedResponse = await handleChatRequest(
    buildContext(
      {
        message: "第七次请求",
        workspace_mode: "demo",
        business_snapshot: {
          analysis_range: { start_month: "2026-01", end_month: "2026-03", period: "2026-01~2026-03" },
        },
      },
      {
        includeAuthorization: false,
        headers,
      },
    ),
    "req-demo-limit-7",
    {
      requestDemoSnapshotChat: async () => {
        throw new Error("limited request should not reach gemini");
      },
    },
  );

  const payload = await limitedResponse.json();
  assert.equal(limitedResponse.status, 429);
  assert.equal(payload.error?.code, CHAT_ERROR_CODES.RATE_LIMITED);
  assert.match(payload.error?.message || "", /演示 AI 请求过于频繁/u);
});
