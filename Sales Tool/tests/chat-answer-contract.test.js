import assert from "node:assert/strict";
import test from "node:test";

import { buildChatSuccessPayload } from "../functions/chat/render.js";

test("buildChatSuccessPayload returns minimal text-first contract", () => {
  const payload = buildChatSuccessPayload({
    replyText: "2025年1月至2月整体销售保持增长，近期趋势延续向上。",
    evidenceBundle: {
      source_period: "2025-01~2025-02",
      question_type: "overview",
      evidence_types: ["aggregate", "timeseries"],
      missing_evidence_types: [],
      analysis_confidence: "high",
      evidence: [
        { label: "销售额", value: "468.81万元", insight: "当前分析区间" },
        { label: "销量", value: "3719盒", insight: "趋势延续向上" },
      ],
      actions: [{ title: "继续跟踪重点对象", timeline: "下次复盘前", metric: "销售额/销量" }],
    },
    model: "tool-model",
    requestId: "req-minimal-answer",
    conversationState: {
      primary_dimension_code: "overall",
      requested_time_window: {
        kind: "absolute",
        label: "1月到2月",
        start_month: "2025-01",
        end_month: "2025-02",
        period: "2025-01~2025-02",
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
      source_period: "2025-01~2025-02",
    },
  });

  assert.equal(payload.reply, "2025年1月至2月整体销售保持增长，近期趋势延续向上。");
  assert.equal(payload.model, "tool-model");
  assert.equal(payload.requestId, "req-minimal-answer");
  assert.equal(payload.answer.summary, "2025年1月至2月整体销售保持增长，近期趋势延续向上。");
  assert.equal(payload.answer.source_period, "2025-01~2025-02");
  assert.equal(payload.answer.question_type, "overview");
  assert.deepEqual(payload.answer.evidence_types, ["aggregate", "timeseries"]);
  assert.deepEqual(payload.answer.missing_evidence_types, []);
  assert.equal(payload.answer.analysis_confidence, "high");
  assert.equal(payload.answer.conversation_state?.requested_time_window?.period, "2025-01~2025-02");
  assert.equal("surfaceReply" in payload, false);
  assert.equal("mode" in payload, false);
  assert.equal("businessIntent" in payload, false);
  assert.equal("output_shape" in payload.answer, false);
  assert.equal("route_code" in payload.answer, false);
  assert.equal("boundaries" in payload.answer, false);
});
