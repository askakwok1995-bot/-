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

  assert.equal(declarations.length, 20);
  assert.deepEqual(
    declarations.map((item) => item.name),
    [
      "get_sales_overview_brief",
      "get_sales_trend_brief",
      "get_dimension_overview_brief",
      "get_dimension_report_brief",
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
  let firstRoundSystemInstruction = "";
  let firstRoundGenerationConfig = null;
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
          firstRoundSystemInstruction = String(payload?.systemInstruction?.parts?.[0]?.text || "");
          firstRoundGenerationConfig = payload?.generationConfig || null;
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
                                args: { limit: 4 },
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
  assert.match(firstRoundSystemInstruction, /工作流状态机/u);
  assert.match(firstRoundSystemInstruction, /\[阶段 1：首轮规划阶段\]/u);
  assert.match(firstRoundSystemInstruction, /\[阶段 2：深挖取数阶段\]/u);
  assert.match(firstRoundSystemInstruction, /\[阶段 3：最终总结阶段\]/u);
  assert.match(firstRoundSystemInstruction, /默认优先调用 submit_analysis_plan/u);
  assert.match(firstRoundSystemInstruction, /泛整体问题，可直接先调用宏工具获取首轮事实/u);
  assert.match(firstRoundSystemInstruction, /策略 A：Direct Answer/u);
  assert.match(firstRoundSystemInstruction, /策略 B：Bounded Answer/u);
  assert.equal((firstRoundSystemInstruction.match(/角色定位：/g) || []).length, 1);
  assert.equal(firstRoundGenerationConfig?.temperature, 0.7);
  assert.equal(firstRoundGenerationConfig?.maxOutputTokens, 1800);
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

test("runToolFirstChat allows direct macro start for broad overall report question", async () => {
  const toolCalls = [];
  let firstRoundDeclarationNames = [];
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "生成销售分析报告",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
    questionJudgment: createQuestionJudgment(),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-overall-report-direct-macro",
    deps: {
      requestGeminiGenerateContent: async (payload) => {
        geminiCallCount += 1;
        if (geminiCallCount === 1) {
          firstRoundDeclarationNames = Array.isArray(payload?.tools?.[0]?.functionDeclarations)
            ? payload.tools[0].functionDeclarations.map((item) => item?.name)
            : [];
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
                          name: "get_sales_overview_brief",
                          args: { limit: 5 },
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
                  parts: [{ text: "当前报表区间内整体销售表现稳健，头部产品贡献集中，最近月延续上升趋势，建议围绕增长势头继续放大核心品类。"}],
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
            range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
            matched_entities: { products: [], hospitals: [] },
            unmatched_entities: { products: [], hospitals: [] },
            coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
            boundaries: [],
            diagnostic_flags: ["view_sales_overview_brief"],
            summary: { sales_amount: "2861.75万元" },
            rows: [{ row_label: "Top1产品", sales_amount: "1064.83万元" }],
          },
          meta: {
            detail_request_mode: "macro_overview",
            coverage_code: "full",
            analysis_view: "sales_overview_brief",
            evidence_types: ["aggregate", "timeseries", "breakdown", "diagnostics"],
          },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(geminiCallCount, 2);
  assert.deepEqual(firstRoundDeclarationNames, [
    "submit_analysis_plan",
    "get_sales_overview_brief",
    "get_sales_trend_brief",
    "get_dimension_overview_brief",
  ]);
  assert.deepEqual(toolCalls, ["get_sales_overview_brief"]);
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.DIRECT_ANSWER);
  assert.equal(result.plannerState?.question_type, "report");
  assert.deepEqual(result.plannerState?.requested_views, ["get_sales_overview_brief"]);
});

test("runToolFirstChat allows direct macro start for broad overall trend question without planner", async () => {
  const toolCalls = [];
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "分析销售趋势",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
    questionJudgment: createQuestionJudgment(),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-overall-trend-direct-macro",
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
                          name: "get_sales_trend_brief",
                          args: { limit: 4 },
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
                  parts: [{ text: "当前报表区间内销售趋势整体向上，最近月增速明显抬升，说明市场活跃度正在恢复。"}],
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
            range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
            matched_entities: { products: [], hospitals: [] },
            unmatched_entities: { products: [], hospitals: [] },
            coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
            boundaries: [],
            diagnostic_flags: ["view_sales_trend_brief"],
            summary: { sales_amount: "2861.75万元" },
            rows: [{ row_label: "趋势:2025-12", sales_amount: "316.08万元" }],
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
  assert.equal(geminiCallCount, 2);
  assert.deepEqual(toolCalls, ["get_sales_trend_brief"]);
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.DIRECT_ANSWER);
  assert.equal(result.plannerState?.question_type, "trend");
  assert.deepEqual(result.plannerState?.requested_views, ["get_sales_trend_brief"]);
});

test("runToolFirstChat retries once with planner-only payload when first round misses planner", async () => {
  const toolCalls = [];
  let secondRoundDeclarationNames = [];
  let secondRoundSystemInstruction = "";
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "分析产品表现并给建议",
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
    requestId: "tool-runtime-planner-recovery-success",
    deps: {
      requestGeminiGenerateContent: async (payload) => {
        geminiCallCount += 1;
        if (geminiCallCount === 1) {
          return {
            ok: true,
            model: "stub-model",
            payload: {
              candidates: [
                {
                  content: {
                    parts: [{ text: "当前产品表现稳健，可继续关注头部产品。"}],
                  },
                },
              ],
            },
          };
        }
        if (geminiCallCount === 2) {
          secondRoundDeclarationNames = Array.isArray(payload?.tools?.[0]?.functionDeclarations)
            ? payload.tools[0].functionDeclarations.map((item) => item?.name)
            : [];
          secondRoundSystemInstruction = String(payload?.systemInstruction?.parts?.[0]?.text || "");
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
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "diagnosis",
                            required_evidence: ["aggregate", "timeseries", "breakdown", "ranking", "diagnostics"],
                            requested_views: ["get_dimension_report_brief"],
                            synthesis_expectation: "先总结产品表现，再给出趋势、结构和建议。",
                            required_tool_call_min: 1,
                            initial_tools: [
                              {
                                name: "get_dimension_report_brief",
                                args: { dimension: "product", limit: 4 },
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
                  parts: [{ text: "当前报表区间内头部产品贡献集中，整体趋势向上，建议围绕强势产品继续放大增长。"}],
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
            diagnostic_flags: ["view_product_report_brief"],
            summary: { overview_dimension: "product" },
            rows: [{ row_label: "趋势:2025-03", sales_amount: "12.00万元" }],
          },
          meta: {
            detail_request_mode: "macro_dimension_report",
            coverage_code: "full",
            analysis_view: "product_report_brief",
            evidence_types: ["aggregate", "timeseries", "breakdown", "ranking", "diagnostics"],
          },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(geminiCallCount, 3);
  assert.deepEqual(secondRoundDeclarationNames, ["submit_analysis_plan"]);
  assert.match(secondRoundSystemInstruction, /此轮禁止输出自然语言文本，也禁止调用任何业务工具/u);
  assert.deepEqual(toolCalls, ["get_dimension_report_brief"]);
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.DIRECT_ANSWER);
});

test("runToolFirstChat still returns planner_call_missing when recovery round also misses planner", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "分析产品表现并给建议",
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
    requestId: "tool-runtime-planner-recovery-fail",
    deps: {
      requestGeminiGenerateContent: async () => {
        geminiCallCount += 1;
        return {
          ok: true,
          model: "stub-model",
          payload: {
            candidates: [
              {
                content: {
                  parts: [{ text: "先给你一个简短判断。"}],
                },
              },
            ],
          },
        };
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(geminiCallCount, 2);
  assert.equal(result.fallbackReason, "planner_call_missing");
});

test("runToolFirstChat prefers dimension report macro for product report questions", async () => {
  const toolCalls = [];
  let firstRoundDeclarationNames = [];
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "生成产品分析报告",
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
    requestId: "tool-runtime-dimension-report",
    deps: {
      requestGeminiGenerateContent: async (payload) => {
        geminiCallCount += 1;
        if (geminiCallCount === 1) {
          firstRoundDeclarationNames = Array.isArray(payload?.tools?.[0]?.functionDeclarations)
            ? payload.tools[0].functionDeclarations.map((item) => item?.name)
            : [];
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
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["aggregate", "timeseries", "breakdown", "ranking", "diagnostics"],
                            requested_views: ["get_dimension_report_brief"],
                            synthesis_expectation: "先总结产品整体表现，再补趋势、结构和风险提示。",
                            required_tool_call_min: 1,
                            initial_tools: [
                              {
                                name: "get_dimension_report_brief",
                                args: { dimension: "product", limit: 4 },
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
                  parts: [{ text: "当前报表区间内产品销售集中在头部品种，Botox50 贡献领先，整体趋势延续增长。" }],
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
            diagnostic_flags: ["view_product_report_brief"],
            summary: {
              overview_dimension: "product",
              top_entities: ["Botox50", "Botox100"],
              bottom_entities: ["Juvederm"],
              trend_signals: ["最近月产品销售额较上月上升。"],
              risk_alerts: ["产品集中度较高。"],
              opportunity_hints: ["头部产品仍有增长空间。"],
              concentration_hint: "37.68%",
            },
            rows: [{ row_label: "趋势:2025-03", sales_amount: "12.00万元" }],
          },
          meta: {
            detail_request_mode: "macro_dimension_report",
            coverage_code: "full",
            analysis_view: "product_report_brief",
            evidence_types: ["aggregate", "timeseries", "breakdown", "ranking", "diagnostics"],
          },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.DIRECT_ANSWER);
  assert.deepEqual(firstRoundDeclarationNames, ["submit_analysis_plan", "get_dimension_report_brief"]);
  assert.deepEqual(toolCalls, ["get_dimension_report_brief"]);
  assert.deepEqual(result.plannerState?.requested_views, ["get_dimension_report_brief"]);
  assert.deepEqual(result.evidenceTypesCompleted, ["aggregate", "timeseries", "breakdown", "ranking", "diagnostics"]);
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
                                args: { focus: "整体" },
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
                            { name: "get_product_summary", args: { include_all_products: true } },
                            { name: "get_hospital_summary", args: { limit: 5 } },
                            { name: "get_trend_summary", args: { dimension: "overall" } },
                            { name: "get_overall_summary", args: {} },
                            { name: "scope_diagnostics", args: { dimension: "overall" } },
                            { name: "scope_breakdown", args: { scope_dimension: "overall", breakdown_dimension: "product" } },
                            { name: "scope_timeseries", args: { dimension: "overall", granularity: "monthly" } },
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
    message: "给我 Botox50 的产品分析报告",
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
                            initial_tools: [{ name: "scope_aggregate", args: { dimension: "product" } }],
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

test("runToolFirstChat rejects invalid planner missing relevance and requires resubmission", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "分析产品销售结构",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
    questionJudgment: createQuestionJudgment({
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: "产品",
      },
    }),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-invalid-planner-missing-relevance",
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
                            primary_dimension: "product",
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["breakdown"],
                            requested_views: ["get_share_breakdown"],
                            required_tool_call_min: 1,
                            initial_tools: [{ name: "get_share_breakdown", args: { dimension: "product" } }],
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
          ok: false,
          code: "should-not-reach-second-pass",
        };
      },
      executeToolByName: async () => {
        throw new Error("should-not-call-tools");
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "gemini_error");
  assert.equal(geminiCallCount, 2);
});

test("runToolFirstChat fails when planner is rejected and model skips replanning by calling tools directly", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "分析产品销售结构",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
    questionJudgment: createQuestionJudgment({
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: "产品",
      },
    }),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-rejected-without-resubmission",
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
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["breakdown"],
                            requested_views: ["get_share_breakdown"],
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
                  parts: [
                    {
                      functionCall: {
                        name: "get_share_breakdown",
                        args: {
                          dimension: "product",
                        },
                      },
                    },
                  ],
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

  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "planner_call_missing");
});

test("runToolFirstChat continues after planner resubmission succeeds", async () => {
  let geminiCallCount = 0;
  const toolCalls = [];
  const result = await runToolFirstChat({
    message: "分析产品销售结构",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
    questionJudgment: createQuestionJudgment({
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: "产品",
      },
    }),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-resubmission-success",
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
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["breakdown"],
                            requested_views: ["get_share_breakdown"],
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
        if (geminiCallCount === 2) {
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
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["breakdown"],
                            requested_views: ["get_share_breakdown"],
                            required_tool_call_min: 1,
                            initial_tools: [{ name: "get_share_breakdown", args: { dimension: "product" } }],
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
                  parts: [{ text: "当前报表区间内，产品销售结构集中，头部产品贡献占比较高。" }],
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
            range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
            matched_entities: { products: [], hospitals: [] },
            unmatched_entities: { products: [], hospitals: [] },
            coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
            summary: { sales_amount: "2826.20万元" },
            rows: [{ row_label: "结构:Botox50", sales_share: "37.68%" }],
          },
          meta: {
            detail_request_mode: "generic",
            coverage_code: "full",
            evidence_types: ["breakdown", "ranking"],
          },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(geminiCallCount, 3);
  assert.deepEqual(toolCalls, ["get_share_breakdown"]);
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.DIRECT_ANSWER);
  assert.deepEqual(result.evidenceTypesCompleted, ["breakdown", "ranking"]);
  assert.deepEqual(result.missingEvidenceTypes, []);
  assert.equal(result.analysisConfidence, "high");
});

test("runToolFirstChat keeps planner required_evidence for report when explicitly provided", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "分析产品销售结构",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
    questionJudgment: createQuestionJudgment({
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: "产品",
      },
    }),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-report-required-evidence-explicit",
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
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["breakdown"],
                            requested_views: ["get_share_breakdown"],
                            required_tool_call_min: 1,
                            initial_tools: [{ name: "get_share_breakdown", args: { dimension: "product" } }],
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
                  parts: [{ text: "当前报表区间内，产品销售结构集中，头部产品贡献占比较高。" }],
                },
              },
            ],
          },
        };
      },
      executeToolByName: async () => ({
        result: {
          range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
          matched_entities: { products: [], hospitals: [] },
          unmatched_entities: { products: [], hospitals: [] },
          coverage: { code: "full", message: "当前请求范围已完整覆盖。" },
          summary: { sales_amount: "2826.20万元" },
          rows: [{ row_label: "结构:Botox50", sales_share: "37.68%" }],
        },
        meta: {
          detail_request_mode: "generic",
          coverage_code: "full",
          evidence_types: ["breakdown", "ranking"],
        },
      }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.outputContext.route_code, ROUTE_DECISION_CODES.DIRECT_ANSWER);
  assert.deepEqual(result.plannerState?.required_evidence, ["breakdown"]);
  assert.deepEqual(result.evidenceTypesCompleted, ["breakdown", "ranking"]);
  assert.deepEqual(result.missingEvidenceTypes, []);
});

test("runToolFirstChat falls back to question_type default evidence only when planner required_evidence is empty", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "给我 Botox50 的产品分析报告",
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
    requestId: "tool-runtime-report-required-evidence-fallback",
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
                            required_evidence: [],
                            requested_views: ["scope_aggregate"],
                            synthesis_expectation: "需要完整产品报告。",
                            required_tool_call_min: 1,
                            initial_tools: [{ name: "scope_aggregate", args: { dimension: "product" } }],
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
  assert.deepEqual(result.plannerState?.required_evidence, ["aggregate", "timeseries", "breakdown", "diagnostics"]);
  assert.deepEqual(result.missingEvidenceTypes, ["timeseries", "breakdown", "diagnostics"]);
});

test("submit_analysis_plan schema uses structured args object instead of args_json", async () => {
  let plannerDeclaration = null;
  await runToolFirstChat({
    message: "分析销售趋势",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-03", period: "2025-01~2025-03" },
    },
    questionJudgment: createQuestionJudgment(),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-schema-structured-args",
    deps: {
      requestGeminiGenerateContent: async (payload) => {
        plannerDeclaration = payload?.tools?.[0]?.functionDeclarations?.find((item) => item?.name === "submit_analysis_plan") || null;
        return { ok: false, code: "schema-captured" };
      },
      executeToolByName: async () => {
        throw new Error("should-not-call-tools");
      },
    },
  });

  const initialToolSchema = plannerDeclaration?.parameters?.properties?.initial_tools?.items;
  assert.ok(initialToolSchema);
  assert.equal(initialToolSchema.properties?.args?.type, "OBJECT");
  assert.deepEqual(initialToolSchema.required, ["name", "args"]);
  assert.equal(Object.prototype.hasOwnProperty.call(initialToolSchema.properties || {}, "args_json"), false);
});

test("runToolFirstChat rejects legacy args_json planner payload", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "生成产品分析报告",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
    questionJudgment: createQuestionJudgment({
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: "产品",
      },
    }),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-legacy-args-json",
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
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["aggregate", "ranking"],
                            requested_views: ["get_dimension_overview_brief"],
                            required_tool_call_min: 1,
                            initial_tools: [
                              {
                                name: "get_dimension_overview_brief",
                                args_json: "{\"dimension\":\"product\"}",
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
        return { ok: false, code: "rejected-as-expected" };
      },
      executeToolByName: async () => {
        throw new Error("should-not-call-tools");
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "gemini_error");
  assert.equal(geminiCallCount, 2);
});

test("runToolFirstChat rejects planner initial_tools when args is not an object", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "生成产品分析报告",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
    questionJudgment: createQuestionJudgment({
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: "产品",
      },
    }),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-invalid-args-type",
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
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["aggregate", "ranking"],
                            requested_views: ["get_dimension_overview_brief"],
                            required_tool_call_min: 1,
                            initial_tools: [
                              {
                                name: "get_dimension_overview_brief",
                                args: "{\"dimension\":\"product\"}",
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
        return { ok: false, code: "rejected-as-expected" };
      },
      executeToolByName: async () => {
        throw new Error("should-not-call-tools");
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "gemini_error");
  assert.equal(geminiCallCount, 2);
});

test("runToolFirstChat rejects planner initial_tools missing required tool args", async () => {
  let geminiCallCount = 0;
  const result = await runToolFirstChat({
    message: "生成产品分析报告",
    historyWindow: [],
    businessSnapshot: {
      analysis_range: { start_month: "2025-01", end_month: "2025-12", period: "2025-01~2025-12" },
    },
    questionJudgment: createQuestionJudgment({
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: "产品",
      },
    }),
    authToken: "token",
    env: {},
    requestId: "tool-runtime-missing-required-tool-args",
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
                            granularity: "summary",
                            route_intent: "direct_answer",
                            question_type: "report",
                            required_evidence: ["aggregate", "ranking"],
                            requested_views: ["get_dimension_overview_brief"],
                            required_tool_call_min: 1,
                            initial_tools: [
                              {
                                name: "get_dimension_overview_brief",
                                args: {},
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
        return { ok: false, code: "rejected-as-expected" };
      },
      executeToolByName: async () => {
        throw new Error("should-not-call-tools");
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "gemini_error");
  assert.equal(geminiCallCount, 2);
});
