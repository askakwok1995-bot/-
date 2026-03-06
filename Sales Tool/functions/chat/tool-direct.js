import { trimString } from "./shared.js";
import { buildToolOutputContext, buildToolCallTraceEntry, createInitialToolRuntimeState } from "./tool-runtime.js";
import { createToolRuntimeContext, executeToolByName } from "./tool-executors.js";
import { callGeminiWithToolResult } from "./output.js";

export async function runDirectToolChat(
  {
    message,
    businessSnapshot,
    requestedTimeWindow = null,
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

  const runtimeContext = createToolRuntimeContextImpl(
    {
      businessSnapshot,
      requestedTimeWindow,
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
