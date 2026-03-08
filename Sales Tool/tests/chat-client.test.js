import assert from "node:assert/strict";
import test from "node:test";

import { createChatReplyRequester } from "../app/chat-client.js";

function createRequester(fetchImpl) {
  return createChatReplyRequester({
    getAccessToken: async () => "token",
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
