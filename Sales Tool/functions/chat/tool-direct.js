import { trimString } from "./shared.js";
import { buildToolOutputContext, buildToolCallTraceEntry, createInitialToolRuntimeState } from "./tool-runtime.js";
import { createToolRuntimeContext, executeToolByName } from "./tool-executors.js";
import { buildLocalDeterministicToolReply, callGeminiWithToolResult } from "./output.js";
import { buildComparisonTimeWindowOutputContextFields, buildTimeWindowOutputContextFields } from "./time-intent.js";

const DIRECT_TOOL_LOCAL_FALLBACK_CODES = new Set([
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_ERROR",
  "UPSTREAM_RATE_LIMIT",
  "UPSTREAM_NETWORK_ERROR",
]);

export async function runDirectToolChat(
  {
    message,
    businessSnapshot,
    requestedTimeWindow = null,
    comparisonTimeWindow = null,
    timeCompareMode = "none",
    questionJudgment,
    authToken,
    env,
    requestId,
    deterministicToolRoute,
  },
  deps = {},
) {
  const route = deterministicToolRoute && deterministicToolRoute.matched ? deterministicToolRoute : null;
  const state = createInitialToolRuntimeState();
  const toolCallTrace = [];
  if (!route) {
    return {
      ok: false,
      fallbackReason: "deterministic_route_not_matched",
      toolRuntimeState: state,
      toolCallTrace,
    };
  }

  state.attempted = true;
  const createToolRuntimeContextImpl = deps.createToolRuntimeContext || createToolRuntimeContext;
  const executeToolByNameImpl = deps.executeToolByName || executeToolByName;
  const callGeminiWithToolResultImpl = deps.callGeminiWithToolResult || callGeminiWithToolResult;
  const buildLocalDeterministicToolReplyImpl = deps.buildLocalDeterministicToolReply || buildLocalDeterministicToolReply;
  const buildTimeWindowOutputContextFieldsImpl =
    deps.buildTimeWindowOutputContextFields || buildTimeWindowOutputContextFields;
  const buildComparisonTimeWindowOutputContextFieldsImpl =
    deps.buildComparisonTimeWindowOutputContextFields || buildComparisonTimeWindowOutputContextFields;

  const runtimeContext = createToolRuntimeContextImpl(
    {
      businessSnapshot,
      requestedTimeWindow: trimString(route.route_type) === "overall_period_compare" ? null : requestedTimeWindow,
      authToken,
      env,
    },
    deps,
  );

  let windowInfo;
  try {
    windowInfo = await runtimeContext.getWindowInfo();
  } catch (_error) {
    return {
      ok: false,
      fallbackReason: "invalid_analysis_range",
      toolRuntimeState: state,
      toolCallTrace,
    };
  }

  if (!windowInfo?.valid) {
    return {
      ok: false,
      fallbackReason: "invalid_analysis_range",
      toolRuntimeState: state,
      toolCallTrace,
    };
  }

  let toolExecutionResult;
  try {
    toolExecutionResult = await executeToolByNameImpl(route.tool_name, route.tool_args, runtimeContext, deps);
  } catch (_error) {
    return {
      ok: false,
      fallbackReason: "deterministic_tool_execution_failed",
      toolRuntimeState: state,
      toolCallTrace,
    };
  }

  state.tool_call_count = 1;
  state.rounds = 1;
  state.used_tools = [trimString(route.tool_name)];
  toolCallTrace.push(buildToolCallTraceEntry({ name: route.tool_name }, toolExecutionResult));

  const outputContext = {
    ...buildToolOutputContext(questionJudgment, toolExecutionResult),
    ...buildTimeWindowOutputContextFieldsImpl(requestedTimeWindow, {
      code: "full",
      available_start_month: trimString(windowInfo?.effective_start_month),
      available_end_month: trimString(windowInfo?.effective_end_month),
      available_period:
        trimString(windowInfo?.effective_start_month) && trimString(windowInfo?.effective_end_month)
          ? `${trimString(windowInfo?.effective_start_month)}~${trimString(windowInfo?.effective_end_month)}`
          : "",
    }),
    ...buildComparisonTimeWindowOutputContextFieldsImpl(
      comparisonTimeWindow,
      {
        code: trimString(timeCompareMode) === "quarter_compare" ? "full" : "none",
        available_start_month: trimString(windowInfo?.effective_start_month),
        available_end_month: trimString(windowInfo?.effective_end_month),
        available_period:
          trimString(windowInfo?.effective_start_month) && trimString(windowInfo?.effective_end_month)
            ? `${trimString(windowInfo?.effective_start_month)}~${trimString(windowInfo?.effective_end_month)}`
            : "",
      },
      timeCompareMode,
    ),
    tool_route_mode: "deterministic",
    tool_route_type: trimString(route.route_type),
    tool_route_name: trimString(route.tool_name),
  };

  const geminiResult = await callGeminiWithToolResultImpl(
    message,
    toolExecutionResult.result,
    outputContext,
    env,
    requestId,
  );
  if (!geminiResult.ok) {
    if (DIRECT_TOOL_LOCAL_FALLBACK_CODES.has(trimString(geminiResult.code))) {
      const localReply = trimString(buildLocalDeterministicToolReplyImpl(toolExecutionResult.result, outputContext));
      if (localReply) {
        state.success = true;
        state.final_route_code = trimString(outputContext.route_code);
        return {
          ok: true,
          reply: localReply,
          model: "local-template-tool-fallback",
          outputContext: {
            ...outputContext,
            local_response_mode: "tool_result_fallback",
          },
          toolRuntimeState: state,
          toolCallTrace,
          toolResult: toolExecutionResult.result,
        };
      }
    }
    return {
      ok: false,
      fallbackReason: trimString(geminiResult.code) || "deterministic_tool_gemini_failed",
      toolRuntimeState: state,
      toolCallTrace,
    };
  }

  state.success = true;
  state.final_route_code = trimString(outputContext.route_code);
  return {
    ok: true,
    reply: geminiResult.reply,
    model: geminiResult.model,
    outputContext,
    toolRuntimeState: state,
    toolCallTrace,
    toolResult: toolExecutionResult.result,
  };
}
