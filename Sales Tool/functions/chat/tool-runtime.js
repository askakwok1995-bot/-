import {
  ASSISTANT_ROLE_DEFINITION,
  OUTPUT_POLICY_BOUNDED_ANSWER,
  OUTPUT_POLICY_DIRECT_ANSWER,
  ROUTE_DECISION_CODES,
  TOOL_RUNTIME_MAX_CALLS,
  TOOL_RUNTIME_MAX_ROUNDS,
  buildAssistantRoleSystemInstruction,
  normalizeBusinessSnapshot,
  normalizeNumericValue,
  trimString,
} from "./shared.js";
import { buildToolDeclarations } from "./tool-registry.js";
import { createToolRuntimeContext, executeToolByName } from "./tool-executors.js";
import { extractGeminiReply, requestGeminiGenerateContent, shouldLogPhase2Trace } from "./output.js";

const TOOL_FALLBACK_REASONS = Object.freeze({
  INVALID_ANALYSIS_RANGE: "invalid_analysis_range",
  TOOL_LOOP_LIMIT_EXCEEDED: "tool_loop_limit_exceeded",
  TOOL_EXECUTION_FAILED: "tool_execution_failed",
  GEMINI_ERROR: "gemini_error",
  EMPTY_FINAL_REPLY: "empty_final_reply",
});

const TOOL_FIRST_SYSTEM_INSTRUCTION = [
  "当前链路已为你提供一组受控业务工具。",
  "当问题需要具体业务数据时，优先调用最合适的工具，不要假装已经掌握未提供的数据。",
  "工具结果是本轮回答的主要事实依据；若工具结果 coverage=partial 或存在未匹配实体，请按 bounded_answer 风格回答。",
  "若工具结果 coverage=full，按 direct_answer 风格回答；若 coverage=full 且 rows 为空但结果明确为0贡献，请直接说明“当前范围内贡献为0/未产生贡献”，不要写成“数据不足”。",
  "禁止输出任何内部过程词、工具名、函数名、调取过程。",
  "",
  "direct_answer 结构要求：",
  OUTPUT_POLICY_DIRECT_ANSWER,
  "",
  "bounded_answer 结构要求：",
  OUTPUT_POLICY_BOUNDED_ANSWER,
].join("\n");

export function createInitialToolRuntimeState() {
  return {
    attempted: false,
    used_tools: [],
    tool_call_count: 0,
    rounds: 0,
    final_route_code: "",
    success: false,
    fallback_reason: "",
  };
}

function buildToolSeedPrompt(message, businessSnapshot, requestedTimeWindow = null) {
  const normalizedSnapshot = normalizeBusinessSnapshot(businessSnapshot);
  const promptLines = [
    "以下是当前分析范围内的轻量业务快照（seed context），可作为初始背景，但不是唯一数据来源。",
    "如需更具体的数据，请优先调用业务工具。",
  ];
  const requestedPeriod = trimString(requestedTimeWindow?.period);
  if (requestedPeriod) {
    promptLines.push(`本轮用户请求的实际时间区间为 ${requestedPeriod}，请严格按该区间理解“本月/近三个月”等时间表达，不要偷换成报表尾部月份。`);
  }
  promptLines.push(
    "",
    "seed_context:",
    JSON.stringify(normalizedSnapshot, null, 2),
    "",
    `用户问题：${message}`,
  );
  return promptLines.join("\n");
}

function mapHistoryRole(role) {
  const safeRole = trimString(role).toLocaleLowerCase();
  return safeRole === "assistant" ? "model" : "user";
}

function buildInitialContents(historyWindow, message, businessSnapshot, requestedTimeWindow = null) {
  const contents = [];
  const safeHistory = Array.isArray(historyWindow) ? historyWindow : [];
  safeHistory.forEach((item) => {
    const content = trimString(item?.content);
    if (!content) {
      return;
    }
    contents.push({
      role: mapHistoryRole(item?.role),
      parts: [{ text: content }],
    });
  });
  contents.push({
    role: "user",
    parts: [{ text: buildToolSeedPrompt(message, businessSnapshot, requestedTimeWindow) }],
  });
  return contents;
}

function buildToolPayload(contents) {
  return {
    systemInstruction: {
      parts: [
        {
          text: `${buildAssistantRoleSystemInstruction(ASSISTANT_ROLE_DEFINITION)}\n\n${TOOL_FIRST_SYSTEM_INSTRUCTION}`,
        },
      ],
    },
    contents,
    tools: [
      {
        functionDeclarations: buildToolDeclarations(),
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: "AUTO",
      },
    },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
  };
}

function extractFunctionCalls(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const candidate = candidates[0];
  const content = candidate?.content && typeof candidate.content === "object" ? candidate.content : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const calls = [];
  parts.forEach((part) => {
    const functionCall = part?.functionCall;
    const name = trimString(functionCall?.name);
    if (!name) {
      return;
    }
    let args = functionCall?.args;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (_error) {
        args = {};
      }
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      args = {};
    }
    calls.push({
      name,
      args,
    });
  });
  return {
    content,
    calls,
  };
}

function deriveFinalRouteCode(lastToolResult) {
  const coverageCode = trimString(lastToolResult?.result?.coverage?.code);
  if (coverageCode === "partial" || coverageCode === "none") {
    return ROUTE_DECISION_CODES.BOUNDED_ANSWER;
  }
  return ROUTE_DECISION_CODES.DIRECT_ANSWER;
}

export function buildToolOutputContext(questionJudgment, lastToolResult) {
  const routeCode = deriveFinalRouteCode(lastToolResult);
  const detailRequestMode = trimString(lastToolResult?.meta?.detail_request_mode);
  const matchedHospitals = Array.isArray(lastToolResult?.meta?.matched_hospitals) ? lastToolResult.meta.matched_hospitals : [];
  const matchedProducts = Array.isArray(lastToolResult?.meta?.matched_products) ? lastToolResult.meta.matched_products : [];
  const rows = Array.isArray(lastToolResult?.result?.rows) ? lastToolResult.result.rows : [];
  const primarySummary = lastToolResult?.result?.summary?.primary && typeof lastToolResult.result.summary.primary === "object"
    ? lastToolResult.result.summary.primary
    : {};
  const comparisonSummary = lastToolResult?.result?.summary?.comparison && typeof lastToolResult.result.summary.comparison === "object"
    ? lastToolResult.result.summary.comparison
    : {};
  const comparisonRange = lastToolResult?.result?.comparison_range && typeof lastToolResult.result.comparison_range === "object"
    ? lastToolResult.result.comparison_range
    : {};
  const deltaSummary = lastToolResult?.result?.summary?.delta && typeof lastToolResult.result.summary.delta === "object"
    ? lastToolResult.result.summary.delta
    : {};
  const rowNames = rows
    .map((row) => trimString(row?.hospital_name || row?.product_name || row?.period))
    .filter((item) => item)
    .slice(0, 5);
  return {
    route_code: routeCode,
    primary_dimension_code: trimString(questionJudgment?.primary_dimension?.code),
    granularity_code: trimString(questionJudgment?.granularity?.code),
    boundary_needed: routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER,
    refuse_mode: false,
    hospital_monthly_detail_mode: detailRequestMode === "hospital_monthly",
    product_hospital_detail_mode: detailRequestMode === "product_hospital",
    hospital_named_detail_mode: detailRequestMode === "hospital_named",
    product_full_detail_mode: detailRequestMode === "product_full",
    product_named_detail_mode: detailRequestMode === "product_named",
    overall_period_compare_mode: detailRequestMode === "overall_period_compare",
    product_hospital_support_code:
      detailRequestMode === "product_hospital" ? trimString(lastToolResult?.meta?.coverage_code) : "",
    product_hospital_hospital_count_value:
      detailRequestMode === "product_hospital"
        ? Array.isArray(lastToolResult?.result?.rows)
          ? lastToolResult.result.rows.length
          : 0
        : 0,
    hospital_named_support_code:
      detailRequestMode === "hospital_named" ? trimString(lastToolResult?.meta?.coverage_code) : "",
    product_full_support_code:
      detailRequestMode === "product_full" ? trimString(lastToolResult?.meta?.coverage_code) : "",
    product_named_support_code:
      detailRequestMode === "product_named" ? trimString(lastToolResult?.meta?.coverage_code) : "",
    dimension_availability_code: trimString(lastToolResult?.meta?.coverage_code) === "partial" ? "partial" : "available",
    answer_depth_code: trimString(questionJudgment?.granularity?.code) === "detail" ? "focused" : "focused",
    tool_matched_hospital_count_value: matchedHospitals.length,
    tool_matched_product_count_value: matchedProducts.length,
    product_hospital_zero_result_mode: trimString(lastToolResult?.meta?.product_hospital_zero_result) === "yes",
    tool_result_coverage_code: trimString(lastToolResult?.result?.coverage?.code),
    tool_result_row_count_value: rows.length,
    tool_result_row_names: rowNames,
    tool_result_matched_products: matchedProducts.slice(0, 5),
    tool_result_primary_period: trimString(lastToolResult?.meta?.primary_period) || trimString(lastToolResult?.result?.range?.period),
    tool_result_comparison_period: trimString(lastToolResult?.meta?.comparison_period) || trimString(comparisonRange?.period),
    tool_result_primary_sales_amount: trimString(primarySummary?.sales_amount),
    tool_result_primary_sales_volume: trimString(primarySummary?.sales_volume),
    tool_result_primary_sales_amount_value: normalizeNumericValue(primarySummary?.sales_amount_value),
    tool_result_primary_sales_volume_value: normalizeNumericValue(primarySummary?.sales_volume_value),
    tool_result_comparison_sales_amount: trimString(comparisonSummary?.sales_amount),
    tool_result_comparison_sales_volume: trimString(comparisonSummary?.sales_volume),
    tool_result_comparison_sales_amount_value: normalizeNumericValue(comparisonSummary?.sales_amount_value),
    tool_result_comparison_sales_volume_value: normalizeNumericValue(comparisonSummary?.sales_volume_value),
    tool_result_delta_sales_amount_change_ratio: lastToolResult?.result?.summary?.delta?.sales_amount_change_ratio,
    tool_result_delta_sales_volume_change_ratio: lastToolResult?.result?.summary?.delta?.sales_volume_change_ratio,
    tool_result_delta_achievement_change_ratio: lastToolResult?.result?.summary?.delta?.achievement_change_ratio,
    tool_result_delta_sales_amount_change: trimString(deltaSummary?.sales_amount_change),
    tool_result_delta_sales_volume_change: trimString(deltaSummary?.sales_volume_change),
  };
}

export function buildToolCallTraceEntry(call, executionResult) {
  return {
    tool_name: trimString(call?.name),
    coverage_code: trimString(executionResult?.result?.coverage?.code),
    row_count: Array.isArray(executionResult?.result?.rows) ? executionResult.result.rows.length : 0,
    matched_products: Array.isArray(executionResult?.meta?.matched_products) ? executionResult.meta.matched_products.length : 0,
    matched_hospitals: Array.isArray(executionResult?.meta?.matched_hospitals) ? executionResult.meta.matched_hospitals.length : 0,
  };
}

function logToolTrace(tracePayload, env) {
  if (!shouldLogPhase2Trace(env)) {
    return;
  }
  try {
    console.log("[chat.tool.trace]", JSON.stringify(tracePayload));
  } catch (_error) {
    // Tool trace logging should never affect primary flow.
  }
}

function buildToolTracePayload({ requestId, state, toolCallTrace }) {
  return {
    requestId,
    tool_call_count: state.tool_call_count,
    rounds: state.rounds,
    final_route_code: trimString(state.final_route_code),
    fallback_reason: trimString(state.fallback_reason),
    tool_calls: Array.isArray(toolCallTrace) ? toolCallTrace : [],
  };
}

export async function runToolFirstChat({
  message,
  historyWindow,
  businessSnapshot,
  requestedTimeWindow = null,
  questionJudgment,
  authToken,
  env,
  requestId,
  deps = {},
}) {
  const state = createInitialToolRuntimeState();
  state.attempted = true;
  const runtimeContext = createToolRuntimeContext(
    {
      businessSnapshot,
      requestedTimeWindow,
      authToken,
      env,
    },
    deps,
  );
  const toolCallTrace = [];
  const executeToolByNameImpl = deps.executeToolByName || executeToolByName;
  const requestGeminiGenerateContentImpl = deps.requestGeminiGenerateContent || requestGeminiGenerateContent;

  const contents = buildInitialContents(historyWindow, message, businessSnapshot, requestedTimeWindow);
  let lastToolResult = null;

  for (let roundIndex = 0; roundIndex < TOOL_RUNTIME_MAX_ROUNDS; roundIndex += 1) {
    state.rounds = roundIndex + 1;
    const geminiResponse = await requestGeminiGenerateContentImpl(buildToolPayload(contents), env, requestId, "tool");
    if (!geminiResponse.ok) {
      state.fallback_reason = TOOL_FALLBACK_REASONS.GEMINI_ERROR;
      logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
      return {
        ok: false,
        fallbackReason: state.fallback_reason,
        toolRuntimeState: state,
        toolCallTrace,
      };
    }

    const replyText = extractGeminiReply(geminiResponse.payload);
    const { content, calls } = extractFunctionCalls(geminiResponse.payload);

    if (calls.length === 0) {
      if (!replyText) {
        state.fallback_reason = TOOL_FALLBACK_REASONS.EMPTY_FINAL_REPLY;
        logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
        return {
          ok: false,
          fallbackReason: state.fallback_reason,
          toolRuntimeState: state,
          toolCallTrace,
        };
      }
      const outputContext = buildToolOutputContext(questionJudgment, lastToolResult);
      state.success = true;
      state.final_route_code = trimString(outputContext.route_code);
      logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
      return {
        ok: true,
        reply: replyText,
        model: geminiResponse.model,
        outputContext,
        toolRuntimeState: state,
        toolCallTrace,
      };
    }

    if (content) {
      contents.push(content);
    }

    for (const call of calls) {
      if (state.tool_call_count >= TOOL_RUNTIME_MAX_CALLS) {
        state.fallback_reason = TOOL_FALLBACK_REASONS.TOOL_LOOP_LIMIT_EXCEEDED;
        logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
        return {
          ok: false,
          fallbackReason: state.fallback_reason,
          toolRuntimeState: state,
          toolCallTrace,
        };
      }
      let executionResult;
      try {
        executionResult = await executeToolByNameImpl(call.name, call.args, runtimeContext, deps);
      } catch (_error) {
        state.fallback_reason = TOOL_FALLBACK_REASONS.TOOL_EXECUTION_FAILED;
        logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
        return {
          ok: false,
          fallbackReason: state.fallback_reason,
          toolRuntimeState: state,
          toolCallTrace,
        };
      }
      state.tool_call_count += 1;
      state.used_tools.push(trimString(call.name));
      lastToolResult = executionResult;
      toolCallTrace.push(buildToolCallTraceEntry(call, executionResult));
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: trimString(call.name),
              response: executionResult.result,
            },
          },
        ],
      });
    }
  }

  state.fallback_reason = TOOL_FALLBACK_REASONS.TOOL_LOOP_LIMIT_EXCEEDED;
  logToolTrace(buildToolTracePayload({ requestId, state, toolCallTrace }), env);
  return {
    ok: false,
    fallbackReason: state.fallback_reason,
    toolRuntimeState: state,
    toolCallTrace,
  };
}
