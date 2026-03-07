import assert from "node:assert/strict";
import test from "node:test";

import { buildToolDeclarations } from "../functions/chat/tool-registry.js";
import { runToolFirstChat } from "../functions/chat/tool-runtime.js";
import { QUESTION_JUDGMENT_CODES, ROUTE_DECISION_CODES } from "../functions/chat/shared.js";

function createQuestionJudgment(overrides = {}) {
  return {
    primary_dimension: {
      code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
      label: "整体",
      ...overrides.primary_dimension,
    },
    granularity: {
      code: QUESTION_JUDGMENT_CODES.granularity.SUMMARY,
      label: "摘要级",
      ...overrides.granularity,
    },
    relevance: {
      code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT,
      label: "医药销售相关",
      ...overrides.relevance,
    },
  };
}

test("tool registry exposes expanded controlled declarations", () => {
  const declarations = buildToolDeclarations();

  assert.equal(declarations.length, 12);
  assert.deepEqual(
    declarations.map((item) => item.name),
    [
      "get_overall_summary",
      "get_product_summary",
      "get_hospital_summary",
      "get_product_hospital_contribution",
      "get_trend_summary",
      "get_period_comparison_summary",
      "get_product_trend",
      "get_hospital_trend",
      "get_entity_ranking",
      "get_share_breakdown",
      "get_anomaly_insights",
      "get_risk_opportunity_summary",
    ],
  );
});

test("runToolFirstChat completes after single tool call and returns final reply", async () => {
  const geminiCalls = [];
  const toolCalls = [];
  const result = await runToolFirstChat({
    message: "这个月整体怎么样",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
    },
    questionJudgment: createQuestionJudgment(),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-success",
    deps: {
      requestGeminiGenerateContent: async (_payload, _env, _requestId, _prefix) => {
        geminiCalls.push(_prefix);
        if (geminiCalls.length === 1) {
          return {
            ok: true,
            model: "stub-model",
            payload: {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: "get_overall_summary",
                          args: { focus: "整体" },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          };
        }
        return {
          ok: true,
          model: "stub-model",
          payload: {
            candidates: [
              {
                content: {
                  parts: [{ text: "当前整体销售保持增长，达成率稳定。" }],
                },
              },
            ],
          },
        };
      },
      executeToolByName: async (name, args) => {
        toolCalls.push({ name, args });
        return {
          result: {
            range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
            matched_entities: { products: [], hospitals: [] },
            unmatched_entities: { products: [], hospitals: [] },
            coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
            summary: { sales_amount: "10.00万元" },
            rows: [{ period: "2025-02", sales_amount: "6.00万元" }],
          },
          meta: {
            detail_request_mode: "generic",
            coverage_code: "full",
            matched_products: [],
            matched_hospitals: [],
          },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reply, "当前整体销售保持增长，达成率稳定。");
  assert.equal(result.model, "stub-model");
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.DIRECT_ANSWER);
  assert.equal(result.toolRuntimeState.tool_call_count, 1);
  assert.deepEqual(toolCalls.map((item) => item.name), ["get_overall_summary"]);
  assert.equal(result.toolCallTrace[0].analysis_view, "");
});

test("runToolFirstChat falls back when tool loop exceeds max calls", async () => {
  const result = await runToolFirstChat({
    message: "分析所有产品表现",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
    },
    questionJudgment: createQuestionJudgment(),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-loop-limit",
    deps: {
      requestGeminiGenerateContent: async () => ({
        ok: true,
        model: "stub-model",
        payload: {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: "get_product_summary", args: { include_all_products: true } } },
                  { functionCall: { name: "get_hospital_summary", args: { limit: 5 } } },
                  { functionCall: { name: "get_trend_summary", args: { dimension: "overall" } } },
                  { functionCall: { name: "get_overall_summary", args: {} } },
                ],
              },
            },
          ],
        },
      }),
      executeToolByName: async (name) => ({
        result: {
          range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
          matched_entities: { products: [], hospitals: [] },
          unmatched_entities: { products: [], hospitals: [] },
          coverage: { code: "full", message: `${name} ok` },
          summary: {},
          rows: [],
        },
        meta: {
          detail_request_mode: "generic",
          coverage_code: "full",
        },
      }),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "tool_loop_limit_exceeded");
  assert.equal(result.toolRuntimeState.tool_call_count, 3);
  assert.equal(result.toolCallTrace.length, 3);
});
