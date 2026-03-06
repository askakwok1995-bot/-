import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRequestedTimeWindowToSnapshot,
  buildTimeWindowCoverage,
  parseRequestedTimeWindow,
} from "../functions/chat/time-intent.js";
import { createToolRuntimeContext } from "../functions/chat/tool-executors.js";

const FIXED_NOW = new Date("2026-03-06T08:00:00+08:00");

test("parseRequestedTimeWindow normalizes core relative expressions using real-world time", () => {
  const thisMonth = parseRequestedTimeWindow("本月怎么样", { now: FIXED_NOW });
  assert.equal(thisMonth.period, "2026-03~2026-03");

  const lastMonth = parseRequestedTimeWindow("上月情况如何", { now: FIXED_NOW });
  assert.equal(lastMonth.period, "2026-02~2026-02");

  const recentThreeMonths = parseRequestedTimeWindow("近三个月整体趋势如何", { now: FIXED_NOW });
  assert.equal(recentThreeMonths.period, "2025-12~2026-02");

  const previousTwoMonths = parseRequestedTimeWindow("前两个月销售情况", { now: FIXED_NOW });
  assert.equal(previousTwoMonths.period, "2026-01~2026-02");
});

test("parseRequestedTimeWindow supports absolute quarter expressions", () => {
  const quarterWindow = parseRequestedTimeWindow("请分析2024年Q4", { now: FIXED_NOW });
  assert.equal(quarterWindow.kind, "absolute");
  assert.equal(quarterWindow.period, "2024-10~2024-12");
});

test("buildTimeWindowCoverage distinguishes full partial and none", () => {
  const snapshot = {
    analysis_range: {
      start_month: "2025-01",
      end_month: "2025-12",
      period: "2025-01~2025-12",
    },
  };

  const fullCoverage = buildTimeWindowCoverage(
    {
      kind: "relative",
      label: "去年Q4",
      start_month: "2025-10",
      end_month: "2025-12",
      period: "2025-10~2025-12",
    },
    snapshot,
  );
  assert.equal(fullCoverage.code, "full");

  const partialCoverage = buildTimeWindowCoverage(
    {
      kind: "relative",
      label: "近三个月",
      start_month: "2025-12",
      end_month: "2026-02",
      period: "2025-12~2026-02",
    },
    snapshot,
  );
  assert.equal(partialCoverage.code, "partial");

  const noneCoverage = buildTimeWindowCoverage(
    {
      kind: "absolute",
      label: "2024年Q4",
      start_month: "2024-10",
      end_month: "2024-12",
      period: "2024-10~2024-12",
    },
    snapshot,
  );
  assert.equal(noneCoverage.code, "none");
});

test("applyRequestedTimeWindowToSnapshot scopes analysis_range and clears stale aggregate payload", () => {
  const scoped = applyRequestedTimeWindowToSnapshot(
    {
      analysis_range: {
        start_month: "2025-01",
        end_month: "2025-12",
        period: "2025-01~2025-12",
      },
      performance_overview: { sales_amount: "100.00万元" },
      key_business_signals: ["全年增长较快"],
      recent_trends: [{ period: "2025-12" }],
    },
    {
      kind: "relative",
      label: "近三个月",
      start_month: "2025-10",
      end_month: "2025-12",
      period: "2025-10~2025-12",
    },
  );

  assert.deepEqual(scoped.analysis_range, {
    start_month: "2025-10",
    end_month: "2025-12",
    period: "2025-10~2025-12",
  });
  assert.deepEqual(scoped.performance_overview, {});
  assert.deepEqual(scoped.key_business_signals, []);
  assert.deepEqual(scoped.recent_trends, []);
});

test("createToolRuntimeContext uses requested subwindow instead of full analysis_range", async () => {
  let observedSnapshot = null;
  const runtimeContext = createToolRuntimeContext(
    {
      businessSnapshot: {
        analysis_range: {
          start_month: "2025-01",
          end_month: "2025-12",
          period: "2025-01~2025-12",
        },
      },
      requestedTimeWindow: {
        kind: "relative",
        label: "近三个月",
        start_month: "2025-10",
        end_month: "2025-12",
        period: "2025-10~2025-12",
      },
      authToken: "token",
      env: {},
    },
    {
      resolveRetrievalWindowFromSnapshot: (snapshot) => {
        observedSnapshot = snapshot;
        return {
          valid: true,
          effective_start_month: snapshot.analysis_range.start_month,
          effective_end_month: snapshot.analysis_range.end_month,
          month_keys: [snapshot.analysis_range.start_month, snapshot.analysis_range.end_month],
        };
      },
    },
  );

  const windowInfo = await runtimeContext.getWindowInfo();
  assert.equal(windowInfo.effective_start_month, "2025-10");
  assert.equal(windowInfo.effective_end_month, "2025-12");
  assert.equal(observedSnapshot.analysis_range.period, "2025-10~2025-12");
});
