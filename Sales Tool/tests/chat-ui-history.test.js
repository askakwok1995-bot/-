import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiChatHeadDescription,
  buildAiChatSystemIntroText,
  buildAssistantHistoryText,
  rollbackFailedUserHistory,
} from "../ai-chat-ui.js";

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

test("buildAssistantHistoryText appends entity anchors from reply", () => {
  const text = buildAssistantHistoryText(
    {
      summary: "已确认两家医院本季度销售表现。",
    },
    "已确认“卓正优社医院”和“广州卓祥医疗门诊部有限公司”本季度销售表现，并建议继续下钻产品规格。",
  );

  assert.match(text, /已确认两家医院本季度销售表现/u);
  assert.match(text, /对象：卓正优社医院、广州卓祥医疗门诊部有限公司/u);
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

test("buildAiChatSystemIntroText returns demo intro copy", () => {
  const text = buildAiChatSystemIntroText({
    workspaceMode: "demo",
    startYm: "2026-01",
    endYm: "2026-03",
  });

  assert.match(text, /演示数据分析/u);
  assert.match(text, /模拟报表/u);
  assert.doesNotMatch(text, /当前账号/u);
});

test("buildAiChatHeadDescription switches between demo and live", () => {
  assert.match(buildAiChatHeadDescription("demo"), /演示数据分析/u);
  assert.match(buildAiChatHeadDescription("demo"), /模拟报表/u);
  assert.match(buildAiChatHeadDescription("live"), /当前账号/u);
});
