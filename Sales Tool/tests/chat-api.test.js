import assert from "node:assert/strict";
import test from "node:test";

import { handleChatRequest } from "../functions/api/chat.js";
import { CHAT_ERROR_CODES } from "../functions/chat/shared.js";

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
