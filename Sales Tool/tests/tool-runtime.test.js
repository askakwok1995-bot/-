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

  assert.equal(declarations.length, 19);
  assert.deepEqual(
    declarations.map((item) => item.name),
    [
      "get_sales_overview_brief",
      "get_sales_trend_brief",
      "get_dimension_overview_brief",
      "scope_aggregate",
      "scope_timeseries",
      "scope_breakdown",
      "scope_diagnostics",
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

test("runToolFirstChat accepts macro tool plan for broad trend question", async () => {
  const toolCalls = [];
  let firstRoundDeclarationNames = [];
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "分析销售趋势",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-03", period: "2025-01~2025-03" },
    },
    questionJudgment: createQuestionJudgment(),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-macro-trend",
    deps: {
      requestGeminiGenerateContent: async (payload) => {
        geminiCallCount += 1;
        if (geminiCallCount === 1) {
          firstRoundDeclarationNames = Array.isArray(payload?.tools?.[0]?.functionDeclarations)
            ? payload.tools[0].functionDeclarations.map((item) => item?.name)
            : [];
        }
        if (geminiCallCount === 1) {
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
                          name: "submit_analysis_plan",
                          args: {
                            relevance: "relevant",
                            primary_dimension: "overall",
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "trend",
                            required_evidence: ["aggregate", "timeseries"],
                            requested_views: ["get_sales_trend_brief"],
                            synthesis_expectation: "先给出当前报表区间的趋势判断，再补一条关键波动依据。",
                            required_tool_call_min: 1,
                            initial_tools: [
                              {
                                name: "get_sales_trend_brief",
                                args_json: "{\"limit\":4}",
                              },
                            ],
                          },
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
                  parts: [{ text: "当前报表区间内销售整体呈上升趋势，最近月份波动放大。" }],
                },
              },
            ],
          },
        };
      },
      executeToolByName: async (name) => {
        toolCalls.push(name);
        return {
          result: {
            range: { start_month: "2025-01", end_month: "2025-03", period: "2025-01~2025-03" },
            matched_entities: { products: [], hospitals: [] },
            unmatched_entities: { products: [], hospitals: [] },
            coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
            boundaries: [],
            diagnostic_flags: ["view_sales_trend_brief"],
            summary: { sales_amount: "30.00万元" },
            rows: [{ row_label: "趋势:2025-03", sales_amount: "12.00万元" }],
          },
          meta: {
            detail_request_mode: "macro_trend",
            coverage_code: "full",
            analysis_view: "sales_trend_brief",
            evidence_types: ["aggregate", "timeseries", "breakdown", "diagnostics"],
          },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.DIRECT_ANSWER);
  assert.deepEqual(firstRoundDeclarationNames, [
    "submit_analysis_plan",
    "get_sales_overview_brief",
    "get_sales_trend_brief",
    "get_dimension_overview_brief",
  ]);
  assert.deepEqual(toolCalls, ["get_sales_trend_brief"]);
  assert.deepEqual(result.plannerState?.requested_views, ["get_sales_trend_brief"]);
  assert.deepEqual(result.evidenceTypesCompleted, ["aggregate", "timeseries", "breakdown", "diagnostics"]);
  assert.deepEqual(result.missingEvidenceTypes, []);
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
                          name: "submit_analysis_plan",
                          args: {
                            relevance: "relevant",
                            primary_dimension: "overall",
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "overview",
                            required_evidence: ["aggregate"],
                            requested_views: ["get_overall_summary"],
                            synthesis_expectation: "先给整体结论，再补一条关键依据。",
                            required_tool_call_min: 1,
                            initial_tools: [
                              {
                                name: "get_overall_summary",
                                args_json: "{\"focus\":\"整体\"}",
                              },
                            ],
                          },
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
            evidence_types: ["aggregate"],
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
  assert.equal(result.plannerState?.relevance, QUESTION_JUDGMENT_CODES.relevance.RELEVANT);
  assert.equal(result.plannerState?.question_type, "overview");
  assert.equal(result.questionJudgment?.primary_dimension?.code, QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL);
  assert.deepEqual(result.evidenceTypesCompleted, ["aggregate"]);
  assert.deepEqual(result.missingEvidenceTypes, []);
  assert.deepEqual(toolCalls.map((item) => item.name), ["get_overall_summary"]);
  assert.equal(result.toolCallTrace[0].analysis_view, "");
});

test("runToolFirstChat allows planner to zero-tool refuse for irrelevant questions", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "今天天气怎么样",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-02", period: "2025-01~2025-02" },
    },
    questionJudgment: createQuestionJudgment({
      relevance: {
        code: QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT,
        label: "明显无关",
      },
    }),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-refuse",
    deps: {
      requestGeminiGenerateContent: async () => {
        geminiCallCount += 1;
        if (geminiCallCount === 1) {
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
                          name: "submit_analysis_plan",
                          args: {
                            relevance: "irrelevant",
                            primary_dimension: "other",
                            granularity: "summary",
                            route_intent: "refuse",
                            question_type: "overview",
                            required_evidence: [],
                            requested_views: [],
                            refuse_reason: "non_business_question",
                            synthesis_expectation: "直接拒答并给出可问示例。",
                            required_tool_call_min: 0,
                            initial_tools: [],
                          },
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
                  parts: [{ text: "我当前只支持医药销售数据分析相关问题。你可以继续问整体业绩、产品表现或医院贡献。" }],
                },
              },
            ],
          },
        };
      },
      executeToolByName: async () => {
        throw new Error("should-not-call-tools");
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.REFUSE);
  assert.equal(result.toolRuntimeState.tool_call_count, 0);
  assert.equal(result.plannerState?.zero_tool_refuse, true);
  assert.equal(result.questionJudgment?.relevance?.code, QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT);
});

test("runToolFirstChat falls back when planner requests more tools than max calls", async () => {
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
                    {
                      functionCall: {
                        name: "submit_analysis_plan",
                        args: {
                          relevance: "relevant",
                          primary_dimension: "product",
                          granularity: "detail",
                          route_intent: "direct_answer",
                          question_type: "report",
                          required_evidence: ["aggregate", "timeseries", "breakdown", "diagnostics"],
                          requested_views: [
                            "get_product_summary",
                            "get_hospital_summary",
                            "get_trend_summary",
                            "get_overall_summary",
                            "scope_diagnostics",
                            "scope_breakdown",
                            "scope_timeseries",
                          ],
                          synthesis_expectation: "产品报告需要聚合、趋势、结构和诊断证据。",
                          required_tool_call_min: 1,
                          initial_tools: [
                            { name: "get_product_summary", args_json: "{\"include_all_products\":true}" },
                            { name: "get_hospital_summary", args_json: "{\"limit\":5}" },
                            { name: "get_trend_summary", args_json: "{\"dimension\":\"overall\"}" },
                            { name: "get_overall_summary", args_json: "{}" },
                            { name: "scope_diagnostics", args_json: "{\"dimension\":\"overall\"}" },
                            { name: "scope_breakdown", args_json: "{\"scope_dimension\":\"overall\",\"breakdown_dimension\":\"product\"}" },
                            { name: "scope_timeseries", args_json: "{\"dimension\":\"overall\",\"granularity\":\"monthly\"}" },
                          ],
                        },
                      },
                    },
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
  assert.equal(result.toolRuntimeState.tool_call_count, 6);
  assert.equal(result.toolCallTrace.length, 6);
});

test("runToolFirstChat downgrades report answer to bounded when required evidence is incomplete", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "给我产品分析报告",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-03", period: "2025-01~2025-03" },
    },
    questionJudgment: createQuestionJudgment({
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: "产品",
      },
    }),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-report-bounded",
    deps: {
      requestGeminiGenerateContent: async () => {
        geminiCallCount += 1;
        if (geminiCallCount === 1) {
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
                          name: "submit_analysis_plan",
                          args: {
                            relevance: "relevant",
                            primary_dimension: "product",
                            granularity: "detail",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["aggregate", "timeseries", "breakdown", "diagnostics"],
                            requested_views: ["scope_aggregate"],
                            synthesis_expectation: "需要完整产品报告。",
                            required_tool_call_min: 1,
                            initial_tools: [{ name: "scope_aggregate", args_json: "{\"dimension\":\"product\"}" }],
                          },
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
                  parts: [{ text: "当前产品表现有一定基础，但更完整的报告仍需要补充趋势、结构和风险证据。" }],
                },
              },
            ],
          },
        };
      },
      executeToolByName: async () => ({
        result: {
          range: { start_month: "2025-01", end_month: "2025-03", period: "2025-01~2025-03" },
          matched_entities: { products: ["Botox50"], hospitals: [] },
          unmatched_entities: { products: [], hospitals: [] },
          coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
          summary: { sales_amount: "18.00万元" },
          rows: [{ product_name: "Botox50", sales_amount: "18.00万元" }],
        },
        meta: {
          detail_request_mode: "generic",
          coverage_code: "full",
          evidence_types: ["aggregate"],
          matched_products: ["Botox50"],
        },
      }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.BOUNDED_ANSWER);
  assert.deepEqual(result.evidenceTypesCompleted, ["aggregate"]);
  assert.deepEqual(result.missingEvidenceTypes, ["timeseries", "breakdown", "diagnostics"]);
  assert.equal(result.analysisConfidence, "low");
});
