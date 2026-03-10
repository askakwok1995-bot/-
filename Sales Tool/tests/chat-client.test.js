import assert from "node:assert/strict";
import test from "node:test";

import { buildBusinessSnapshotPayload, createChatReplyRequester } from "../app/chat-client.js";

function createRequester(fetchImpl, options = {}) {
  return createChatReplyRequester({
    getAccessToken: options.getAccessToken || (async () => "token"),
    getWorkspaceMode: options.getWorkspaceMode,
    getBusinessSnapshot: () => ({
      analysis_range: { start_month: "2025-01", end_month: "2025-03", period: "2025-01~2025-03" },
    }),
    fetchImpl,
  });
}

test("createChatReplyRequester maps runtime failure reasons to readable Chinese message", async () => {
  const requester = createRequester(async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: "internal_error",
          message: "AI 工具分析未形成稳定结果，请缩小分析范围后重试。",
          details: {
            reason: "tool_loop_limit_exceeded",
          },
        },
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  });

  await assert.rejects(
    requester("生成销售分析报告"),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message, "本次问题需要的分析视角较多，当前轮次内未完成。");
      return true;
    },
  );
});

test("createChatReplyRequester maps planner_rejected_without_resubmission to readable Chinese message", async () => {
  const requester = createRequester(async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: "internal_error",
          message: "AI 工具分析未形成稳定结果，请缩小分析范围后重试。",
          details: {
            reason: "planner_rejected_without_resubmission",
          },
        },
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  });

  await assert.rejects(
    requester("分析产品销售结构"),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message, "模型未按要求重新生成分析计划，请换一种问法重试。");
      return true;
    },
  );
});

test("createChatReplyRequester returns minimal current payload", async () => {
  const requester = createRequester(async () => {
    return new Response(
      JSON.stringify({
        reply: "当前报表区间内整体销售保持增长。",
        answer: {
          summary: "当前报表区间内整体销售保持增长。",
          conversation_state: {
            primary_dimension_code: "overall",
            entity_scope: { products: [], hospitals: [] },
            source_period: "2025-01~2025-03",
          },
        },
        model: "tool-model",
        requestId: "req-chat-client-success",
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-chat-client-success",
        },
      },
    );
  });

  const payload = await requester("整体怎么样");
  assert.deepEqual(payload, {
    reply: "当前报表区间内整体销售保持增长。",
    answer: {
      summary: "当前报表区间内整体销售保持增长。",
      conversation_state: {
        primary_dimension_code: "overall",
        entity_scope: { products: [], hospitals: [] },
        source_period: "2025-01~2025-03",
      },
    },
    model: "tool-model",
    requestId: "req-chat-client-success",
  });
});

test("createChatReplyRequester allows demo mode request without access token", async () => {
  let capturedHeaders = null;
  let capturedBody = null;
  const requester = createRequester(
    async (_url, options = {}) => {
      capturedHeaders = options.headers || null;
      capturedBody = JSON.parse(String(options.body || "{}"));
      return new Response(
        JSON.stringify({
          reply: "当前演示报表显示整体销售平稳增长。",
          answer: {
            summary: "当前演示报表显示整体销售平稳增长。",
          },
          model: "demo-model",
          requestId: "req-demo-chat-client",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    },
    {
      getAccessToken: async () => "",
      getWorkspaceMode: async () => "demo",
    },
  );

  const payload = await requester("看看当前演示数据", {
    history: [{ role: "user", content: "上一轮问题" }],
  });

  assert.equal(capturedHeaders?.authorization, undefined);
  assert.equal(capturedBody?.workspace_mode, "demo");
  assert.deepEqual(capturedBody?.history, [{ role: "user", content: "上一轮问题" }]);
  assert.equal(payload.model, "demo-model");
});

test("createChatReplyRequester still requires token in live mode", async () => {
  const requester = createRequester(
    async () => {
      throw new Error("live mode should stop before fetch");
    },
    {
      getAccessToken: async () => "",
      getWorkspaceMode: async () => "live",
    },
  );

  await assert.rejects(
    requester("看真实数据"),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message, "登录状态已失效，请重新登录后再试。");
      return true;
    },
  );
});

test("buildBusinessSnapshotPayload falls back to quantity achievement when amount target is unavailable", () => {
  const snapshot = buildBusinessSnapshotPayload(
    {
      reportStartYm: "2025-01",
      reportEndYm: "2025-01",
      reportRecords: [
        {
          date: "2025-01-02",
          productId: "p1",
          productName: "Botox50",
          hospital: "华山医院",
          amount: 1000,
          quantity: 5,
        },
      ],
      products: [],
    },
    {
      roundMoney: (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
      formatMoney: (value) => Number(value).toFixed(2),
      normalizeText: (value) => String(value || "").trim().toLowerCase(),
      isValidDateParts: () => true,
      getEffectiveMonthlyTargetMap(_year, metric = "amount") {
        if (metric === "quantity") {
          return { "2025-01": 10 };
        }
        return null;
      },
      getProductMonthlyAllocationMap() {
        return null;
      },
    },
  );

  assert.equal(snapshot.performance_overview.amount_achievement, "--");
  assert.equal(snapshot.performance_overview.quantity_achievement, "50.00%");
  assert.equal(snapshot.performance_overview.preferred_achievement_metric, "quantity");
});
