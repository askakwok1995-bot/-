import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseToolTraceLogText,
  parseChatErrorLogText,
  parseManualSamplesCsv,
  runAnalysis,
} = require("../scripts/analyze-chat-runtime-samples.js");

test("parseToolTraceLogText extracts mixed log lines", () => {
  const traces = parseToolTraceLogText(`
noise
[chat.tool.trace] {"requestId":"req-1","fallback_reason":"planner_call_missing","planner_question_type":"report"}
{"requestId":"req-2","fallback_reason":"","planner_question_type":"trend"}
`);

  assert.equal(traces.length, 2);
  assert.equal(traces[0].requestId, "req-1");
  assert.equal(traces[1].requestId, "req-2");
});

test("parseChatErrorLogText extracts chat.error payload", () => {
  const errors = parseChatErrorLogText(`
[chat.error] {"requestId":"req-1","stage":"chat","error_name":"InternalError","error_message":"boom"}
`);

  assert.equal(errors.length, 1);
  assert.equal(errors[0].stage, "chat");
  assert.equal(errors[0].error_name, "InternalError");
});

test("parseManualSamplesCsv parses hand-collected request samples", () => {
  const samples = parseManualSamplesCsv(`
requestId,category,question,analysisRange,uiResult,notes
req-1,详细销售分析报告,根据当前分析区间生成详细销售分析报告,2026-01~2026-03,failure,planner missing
req-2,医院表现,分析当前区间内医院表现,2026-01~2026-03,success,
`);

  assert.equal(samples.length, 2);
  assert.equal(samples[0].requestId, "req-1");
  assert.equal(samples[1].uiResult, "success");
});

test("runAnalysis joins requestId and produces priority suggestion", () => {
  const result = runAnalysis({
    toolLogText: `
[chat.tool.trace] {"requestId":"req-1","fallback_reason":"planner_call_missing","planner_requested_views":[],"tool_call_count":0}
[chat.tool.trace] {"requestId":"req-2","fallback_reason":"","planner_requested_views":["get_sales_overview_brief"],"tool_call_count":1,"final_route_code":"direct_answer"}
`,
    errorLogText: `
[chat.error] {"requestId":"req-1","stage":"chat","error_name":"InternalError","error_message":"planner missing"}
`,
    sampleText: `
requestId,category,question,analysisRange,uiResult,notes
req-1,详细销售分析报告,根据当前分析区间生成详细销售分析报告,2026-01~2026-03,failure,
req-2,机会点和风险点,洞察当前业务机会点和风险点,2026-01~2026-03,success,
`,
    sampleExtension: ".csv",
  });

  assert.equal(result.records.length, 2);
  assert.match(result.report, /详细销售分析报告/u);
  assert.match(result.report, /planner_call_missing: 1/u);
  assert.match(result.report, /优先修首轮入口和 planner 协议/u);
});
