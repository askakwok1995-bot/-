import assert from "node:assert/strict";
import test from "node:test";

import { buildAssistantHistoryText, rollbackFailedUserHistory } from "../ai-chat-ui.js";

test("buildAssistantHistoryText appends missing anchor terms from reply", () => {
  const text = buildAssistantHistoryText(
    {
      summary: "医院端整体销售表现积极。",
    },
    "医院端整体销售表现积极，但部分医院月度覆盖率不足，存在结构集中度风险。",
  );

  assert.match(text, /医院端整体销售表现积极/u);
  assert.match(text, /术语：月度覆盖率、结构集中度/u);
});

test("rollbackFailedUserHistory removes last failed user message only", () => {
  const next = rollbackFailedUserHistory(
    [
      { role: "user", content: "分析医院表现并指出问题" },
      { role: "assistant", content: "医院端整体销售表现积极。术语：月度覆盖率。" },
      { role: "user", content: "月度覆盖率是什么意思？" },
    ],
    "月度覆盖率是什么意思？",
  );

  assert.deepEqual(next, [
    { role: "user", content: "分析医院表现并指出问题" },
    { role: "assistant", content: "医院端整体销售表现积极。术语：月度覆盖率。" },
  ]);
});
