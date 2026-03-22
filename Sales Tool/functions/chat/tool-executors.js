import {
  ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP,
  ON_DEMAND_MAX_WINDOW_MONTHS,
  ON_DEMAND_PRODUCT_FULL_SAFE_CAP,
  ON_DEMAND_PRODUCT_NAMED_SAFE_CAP,
  QUESTION_JUDGMENT_CODES,
  normalizeBusinessSnapshot,
  normalizeNumericValue,
  trimString,
} from "./shared.js";
import { buildToolDeclarations, TOOL_NAMES } from "./tool-registry.js";
import { matchNamedProductsFromCatalog } from "./retrieval-context.js";
import {
  buildProductsNameMap,
  fetchProductsCatalog,
  fetchSalesRecordsByWindow,
  fetchSalesTargetsByYears,
  resolveRetrievalWindowFromSnapshot,
} from "./retrieval-data.js";
import {
  buildAggregatedMetrics,
  buildHospitalPerformanceRows,
  buildKeyBusinessSignals,
  buildPerformanceOverviewFromMetrics,
  buildProductPerformanceRows,
} from "./retrieval-enhancement.js";
import {
  buildHospitalNamedCandidates,
  normalizeHospitalNameForMatch,
  normalizeProductNameForMatch,
  resolveHospitalNamedMatches,
} from "../../domain/entity-matchers.js";
import { createBriefExecutors } from "./tool-executors-briefs.js";
import { createPrimitiveExecutors } from "./tool-executors-primitives.js";
import { createScopeExecutors } from "./tool-executors-scopes.js";

const TOOL_TREND_LIMIT = ON_DEMAND_MAX_WINDOW_MONTHS;
const MACRO_OVERVIEW_DEFAULT_LIMIT = 8;
const MACRO_REPORT_DEFAULT_LIMIT = 10;
const MACRO_SAFE_LIMIT_CAP = 10;
const TOOL_EVIDENCE_TYPE_MAP = Object.freeze({
  [TOOL_NAMES.GET_SALES_OVERVIEW_BRIEF]: ["aggregate", "timeseries", "breakdown", "diagnostics"],
  [TOOL_NAMES.GET_SALES_TREND_BRIEF]: ["aggregate", "timeseries", "breakdown", "diagnostics"],
  [TOOL_NAMES.GET_DIMENSION_OVERVIEW_BRIEF]: ["aggregate", "breakdown", "ranking"],
  [TOOL_NAMES.GET_DIMENSION_REPORT_BRIEF]: ["aggregate", "timeseries", "breakdown", "ranking", "diagnostics"],
  [TOOL_NAMES.SCOPE_AGGREGATE]: ["aggregate"],
  [TOOL_NAMES.SCOPE_TIMESERIES]: ["timeseries"],
  [TOOL_NAMES.SCOPE_BREAKDOWN]: ["breakdown", "ranking"],
  [TOOL_NAMES.SCOPE_DIAGNOSTICS]: ["diagnostics"],
  [TOOL_NAMES.GET_OVERALL_SUMMARY]: ["aggregate"],
  [TOOL_NAMES.GET_PRODUCT_SUMMARY]: ["aggregate"],
  [TOOL_NAMES.GET_HOSPITAL_SUMMARY]: ["aggregate"],
  [TOOL_NAMES.GET_PRODUCT_HOSPITAL_CONTRIBUTION]: ["breakdown", "ranking"],
  [TOOL_NAMES.GET_TREND_SUMMARY]: ["timeseries"],
  [TOOL_NAMES.GET_PERIOD_COMPARISON_SUMMARY]: ["aggregate", "timeseries"],
  [TOOL_NAMES.GET_PRODUCT_TREND]: ["timeseries"],
  [TOOL_NAMES.GET_HOSPITAL_TREND]: ["timeseries"],
  [TOOL_NAMES.GET_ENTITY_RANKING]: ["ranking"],
  [TOOL_NAMES.GET_SHARE_BREAKDOWN]: ["breakdown", "ranking"],
  [TOOL_NAMES.GET_ANOMALY_INSIGHTS]: ["timeseries", "diagnostics"],
  [TOOL_NAMES.GET_RISK_OPPORTUNITY_SUMMARY]: ["diagnostics"],
});

function toPositiveInt(value, fallback, max) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(numeric, max);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => trimString(item)).filter((item) => item);
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((item) => trimString(item)).filter((item) => item)));
}

function buildToolMeta(toolName, meta = {}, evidenceTypes = []) {
  return {
    ...(meta && typeof meta === "object" ? meta : {}),
    tool_name: trimString(toolName),
    evidence_types: uniqueStrings(
      Array.isArray(meta?.evidence_types) && meta.evidence_types.length > 0
        ? meta.evidence_types
        : evidenceTypes.length > 0
          ? evidenceTypes
          : TOOL_EVIDENCE_TYPE_MAP[trimString(toolName)] || [],
    ),
  };
}

function buildCoverageMessage(code, matchedCount, totalCount, zeroResultText = "") {
  if (code === "full") {
    return zeroResultText || "当前请求范围已完整覆盖。";
  }
  if (code === "partial") {
    return `当前请求范围仅部分覆盖（已覆盖 ${matchedCount}/${totalCount || matchedCount}）。`;
  }
  return "当前请求范围暂无可用覆盖。";
}

function mergeTextArrays(...values) {
  return uniqueStrings(values.flatMap((value) => (Array.isArray(value) ? value : [])));
}

function toMacroRowLabel(prefix, row, fallback) {
  const name =
    trimString(row?.product_name) ||
    trimString(row?.hospital_name) ||
    trimString(row?.period) ||
    trimString(row?.ym) ||
    trimString(row?.signal_type) ||
    trimString(fallback);
  return prefix && name ? `${prefix}${name}` : name;
}

function decorateRows(rows, prefix = "", limit = rows?.length || 0, fallback = "") {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, limit)
    .map((row) => ({
      ...row,
      row_label: toMacroRowLabel(prefix, row, fallback),
    }));
}

function decorateTextRows(rows, prefixMap = {}) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const signalType = trimString(row?.signal_type);
    const prefix = prefixMap[signalType] || prefixMap.default || "";
    return {
      ...row,
      row_label: toMacroRowLabel(prefix, row, `条目${index + 1}`),
    };
  });
}

function buildEnvelope(windowInfo, payload = {}) {
  return {
    range: {
      start_month: trimString(windowInfo?.effective_start_month),
      end_month: trimString(windowInfo?.effective_end_month),
      period:
        trimString(windowInfo?.effective_start_month) && trimString(windowInfo?.effective_end_month)
          ? `${trimString(windowInfo?.effective_start_month)}~${trimString(windowInfo?.effective_end_month)}`
          : "",
    },
    matched_entities: {
      products: normalizeStringArray(payload?.matched_entities?.products),
      hospitals: normalizeStringArray(payload?.matched_entities?.hospitals),
    },
    unmatched_entities: {
      products: normalizeStringArray(payload?.unmatched_entities?.products),
      hospitals: normalizeStringArray(payload?.unmatched_entities?.hospitals),
    },
    coverage: {
      code: trimString(payload?.coverage?.code) || "none",
      message: trimString(payload?.coverage?.message),
    },
    boundaries: Array.isArray(payload?.boundaries) ? payload.boundaries.map((item) => trimString(item)).filter((item) => item) : [],
    diagnostic_flags: Array.isArray(payload?.diagnostic_flags)
      ? payload.diagnostic_flags.map((item) => trimString(item)).filter((item) => item)
      : [],
    summary: payload?.summary && typeof payload.summary === "object" && !Array.isArray(payload.summary) ? payload.summary : {},
    rows: Array.isArray(payload?.rows) ? payload.rows : [],
  };
}

function extractYearsFromMonthKeys(monthKeys) {
  return Array.from(
    new Set(
      (Array.isArray(monthKeys) ? monthKeys : [])
        .map((ym) => Number(String(ym || "").slice(0, 4)))
        .filter((year) => Number.isInteger(year)),
    ),
  ).sort((left, right) => left - right);
}

async function buildMetricsWithTargets(ctx, records, monthKeys, options = {}) {
  let targetsBundle = null;
  if (ctx && typeof ctx.getTargets === "function") {
    try {
      const targetYears = Array.isArray(options?.targetYears) && options.targetYears.length > 0 ? options.targetYears : extractYearsFromMonthKeys(monthKeys);
      targetsBundle = await ctx.getTargets(targetYears);
    } catch (_error) {
      targetsBundle = null;
    }
  }
  return buildAggregatedMetrics(records, monthKeys, {
    ...options,
    targetsBundle,
  });
}

function buildNamedHospitalResolution(targetNames, candidateRows) {
  const requestedHospitals = normalizeStringArray(targetNames).map((name) => ({
    mention_name: name,
    mention_key: normalizeHospitalNameForMatch(name),
  }));
  const matches = resolveHospitalNamedMatches(requestedHospitals, buildHospitalNamedCandidates(candidateRows));
  const matchedNames = matches.map((item) => trimString(item?.name)).filter((item) => item);
  const matchedKeySet = new Set(matchedNames.map((item) => normalizeHospitalNameForMatch(item)));
  const unmatchedNames = normalizeStringArray(targetNames).filter((item) => !matchedKeySet.has(normalizeHospitalNameForMatch(item)));
  return {
    matchedRows: matches.map((item) => item.row),
    matchedNames,
    unmatchedNames,
    coverageCode:
      requestedHospitals.length === 0
        ? "none"
        : matchedNames.length >= requestedHospitals.length
          ? "full"
          : matchedNames.length > 0
            ? "partial"
            : "none",
  };
}

function filterRecordsByResolvedProductNames(records, productNames) {
  const targets = new Set(normalizeStringArray(productNames).map((item) => normalizeProductNameForMatch(item)).filter((item) => item));
  if (targets.size === 0) {
    return [];
  }
  return (Array.isArray(records) ? records : []).filter((record) => targets.has(normalizeProductNameForMatch(record?.product_name)));
}

function filterRecordsByResolvedHospitalNames(records, hospitalNames) {
  const targets = new Set(normalizeStringArray(hospitalNames).map((item) => normalizeHospitalNameForMatch(item)).filter((item) => item));
  if (targets.size === 0) {
    return [];
  }
  return (Array.isArray(records) ? records : []).filter((record) => targets.has(normalizeHospitalNameForMatch(record?.hospital_name)));
}

async function resolveDimensionSelection({ ctx, records, windowInfo, dimension, targetNames = [] } = {}) {
  const safeDimension = trimString(dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  const safeTargetNames = normalizeStringArray(targetNames);
  let filteredRecords = Array.isArray(records) ? records : [];
  let matchedNames = [];
  let unmatchedNames = [];
  let coverageCode = safeTargetNames.length > 0 ? "none" : "full";

  if (safeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT && safeTargetNames.length > 0) {
    const productCatalog = await ctx.getProductCatalog();
    const matched = matchNamedProductsFromCatalog(
      safeTargetNames.join("，"),
      productCatalog,
      ON_DEMAND_PRODUCT_NAMED_SAFE_CAP,
    );
    const requestedProducts = Array.isArray(matched?.requestedProducts) ? matched.requestedProducts : [];
    matchedNames = requestedProducts.map((item) => trimString(item?.product_name)).filter((item) => item);
    const matchedKeySet = new Set(matchedNames.map((item) => normalizeProductNameForMatch(item)));
    unmatchedNames = safeTargetNames.filter((item) => !matchedKeySet.has(normalizeProductNameForMatch(item)));
    filteredRecords = filterRecordsByResolvedProductNames(records, matchedNames);
    coverageCode = matchedNames.length >= safeTargetNames.length ? "full" : matchedNames.length > 0 ? "partial" : "none";
  } else if (safeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL && safeTargetNames.length > 0) {
    const metricsForResolution = buildAggregatedMetrics(records, windowInfo.month_keys);
    const resolution = buildNamedHospitalResolution(safeTargetNames, metricsForResolution.hospital_rows);
    matchedNames = resolution.matchedNames;
    unmatchedNames = resolution.unmatchedNames;
    filteredRecords = filterRecordsByResolvedHospitalNames(records, matchedNames);
    coverageCode = resolution.coverageCode;
  }

  return {
    filteredRecords,
    matchedNames,
    unmatchedNames,
    coverageCode,
  };
}

function buildToolSummaryFromMetrics(metrics, targetDimension, extra = {}) {
  const performanceOverview = buildPerformanceOverviewFromMetrics(metrics);
  const keyBusinessSignals = buildKeyBusinessSignals(metrics, { targetDimension });
  return {
    ...performanceOverview,
    key_business_signals: keyBusinessSignals,
    ...extra,
  };
}

function buildDiagnosticFlags({
  coverageCode = "none",
  unmatchedProducts = [],
  unmatchedHospitals = [],
  zeroResult = false,
  rowCount = 0,
  detailRequestMode = "generic",
} = {}) {
  const flags = [];
  if (coverageCode === "partial") {
    flags.push("partial_coverage");
  } else if (coverageCode === "none") {
    flags.push("no_coverage");
  }
  if (Array.isArray(unmatchedProducts) && unmatchedProducts.length > 0) {
    flags.push("unmatched_products");
  }
  if (Array.isArray(unmatchedHospitals) && unmatchedHospitals.length > 0) {
    flags.push("unmatched_hospitals");
  }
  if (zeroResult) {
    flags.push("zero_result");
  }
  if (rowCount === 0) {
    flags.push("empty_rows");
  }
  flags.push(`view_${trimString(detailRequestMode) || "generic"}`);
  return Array.from(new Set(flags));
}

function buildToolBoundaries({
  coverageCode = "none",
  unmatchedProducts = [],
  unmatchedHospitals = [],
  zeroResultText = "",
} = {}) {
  const boundaries = [];
  if (coverageCode === "partial") {
    boundaries.push("当前请求范围仅部分覆盖，结论以已命中的范围为准。");
  } else if (coverageCode === "none") {
    boundaries.push("当前请求范围暂无完整覆盖。");
  }
  if (Array.isArray(unmatchedProducts) && unmatchedProducts.length > 0) {
    boundaries.push(`未完全匹配的产品：${unmatchedProducts.slice(0, 3).join("、")}。`);
  }
  if (Array.isArray(unmatchedHospitals) && unmatchedHospitals.length > 0) {
    boundaries.push(`未完全匹配的医院：${unmatchedHospitals.slice(0, 3).join("、")}。`);
  }
  if (trimString(zeroResultText)) {
    boundaries.push(trimString(zeroResultText));
  }
  return Array.from(new Set(boundaries.map((item) => trimString(item)).filter((item) => item))).slice(0, 4);
}

function getRowMetricValue(row, metric) {
  const safeMetric = trimString(metric) || "sales_amount";
  if (safeMetric === "sales_volume") {
    return normalizeNumericValue(row?.sales_volume_value) ?? 0;
  }
  if (safeMetric === "sales_share") {
    return normalizeNumericValue(row?.sales_share_ratio) ?? 0;
  }
  if (safeMetric === "change_value") {
    return Math.abs(normalizeNumericValue(row?.change_value_ratio) ?? 0);
  }
  return normalizeNumericValue(row?.sales_amount_value) ?? 0;
}

function sortRowsByMetric(rows, metric = "sales_amount", ranking = "top") {
  const safeRows = Array.isArray(rows) ? rows.slice() : [];
  safeRows.sort((left, right) => {
    const delta = getRowMetricValue(right, metric) - getRowMetricValue(left, metric);
    if (delta !== 0) {
      return delta;
    }
    return trimString(left?.product_name || left?.hospital_name || left?.period).localeCompare(
      trimString(right?.product_name || right?.hospital_name || right?.period),
      "zh-Hans-CN",
    );
  });
  if (trimString(ranking) === "bottom") {
    safeRows.reverse();
  }
  return safeRows;
}

function buildToolExecutionContext({ businessSnapshot, authToken, env }, deps = {}) {
  const normalizedSnapshot = normalizeBusinessSnapshot(businessSnapshot);
  const resolveWindowImpl = deps.resolveRetrievalWindowFromSnapshot || resolveRetrievalWindowFromSnapshot;
  const fetchSalesRecordsByWindowImpl = deps.fetchSalesRecordsByWindow || fetchSalesRecordsByWindow;
  const fetchProductsCatalogImpl = deps.fetchProductsCatalog || fetchProductsCatalog;
  const fetchSalesTargetsByYearsImpl = deps.fetchSalesTargetsByYears || fetchSalesTargetsByYears;

  let windowInfoCache = null;
  let recordsCache = null;
  let productCatalogCache = null;
  let targetsCache = null;
  let targetsCacheKey = "";

  return {
    snapshot: normalizedSnapshot,
    async getWindowInfo() {
      if (!windowInfoCache) {
        windowInfoCache = resolveWindowImpl(normalizedSnapshot);
      }
      return windowInfoCache;
    },
    async getRecords() {
      if (!recordsCache) {
        const windowInfo = await this.getWindowInfo();
        if (!windowInfo.valid) {
          recordsCache = [];
        } else {
          recordsCache = await fetchSalesRecordsByWindowImpl(windowInfo, authToken, env);
        }
      }
      return recordsCache;
    },
    async getProductCatalog() {
      if (!productCatalogCache) {
        productCatalogCache = await fetchProductsCatalogImpl(authToken, env);
      }
      return productCatalogCache;
    },
    async getTargets(years = []) {
      const fallbackWindow = await this.getWindowInfo();
      const targetYears = Array.isArray(years) && years.length > 0 ? years : extractYearsFromMonthKeys(fallbackWindow.month_keys);
      const cacheKey = targetYears.join(",");
      if (!targetsCache || targetsCacheKey !== cacheKey) {
        try {
          targetsCache = await fetchSalesTargetsByYearsImpl(targetYears, authToken, env);
        } catch (_error) {
          targetsCache = null;
        }
        targetsCacheKey = cacheKey;
      }
      return targetsCache;
    },
  };
}

async function executeProductTrend(args, ctx, scopeExecutors) {
  const result = await scopeExecutors[TOOL_NAMES.SCOPE_TIMESERIES](
    {
      dimension: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
      target_names: normalizeStringArray(args?.product_names),
      granularity: trimString(args?.granularity) || "monthly",
    },
    ctx,
  );
  return {
    ...result,
    meta: buildToolMeta(TOOL_NAMES.GET_PRODUCT_TREND, {
      ...result.meta,
      primitive_delegate: TOOL_NAMES.SCOPE_TIMESERIES,
      analysis_view: "product_trend",
    }, ["timeseries"]),
  };
}

async function executeHospitalTrend(args, ctx, scopeExecutors) {
  const result = await scopeExecutors[TOOL_NAMES.SCOPE_TIMESERIES](
    {
      dimension: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
      target_names: normalizeStringArray(args?.hospital_names),
      granularity: trimString(args?.granularity) || "monthly",
    },
    ctx,
  );
  return {
    ...result,
    meta: buildToolMeta(TOOL_NAMES.GET_HOSPITAL_TREND, {
      ...result.meta,
      primitive_delegate: TOOL_NAMES.SCOPE_TIMESERIES,
      analysis_view: "hospital_trend",
    }, ["timeseries"]),
  };
}

async function executeShareBreakdown(args, ctx, scopeExecutors) {
  const result = await scopeExecutors[TOOL_NAMES.SCOPE_BREAKDOWN](
    {
      scope_dimension: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
      breakdown_dimension: trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
      target_names: normalizeStringArray(args?.target_names),
      ranking: "top",
      metric: "sales_share",
      include_share: true,
      limit: args?.limit,
    },
    ctx,
  );
  return {
    ...result,
    meta: buildToolMeta(TOOL_NAMES.GET_SHARE_BREAKDOWN, {
      ...result.meta,
      primitive_delegate: TOOL_NAMES.SCOPE_BREAKDOWN,
      analysis_view: "share_breakdown",
    }, ["breakdown", "ranking"]),
  };
}

export function createToolExecutors(deps = {}) {
  const primitiveExecutors = createPrimitiveExecutors({
    buildCoverageMessage,
    buildDiagnosticFlags,
    buildEnvelope,
    buildMetricsWithTargets,
    buildNamedHospitalResolution,
    buildToolBoundaries,
    buildToolSummaryFromMetrics,
    normalizeStringArray,
    toPositiveInt,
  });
  const scopeExecutors = createScopeExecutors({
    ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP,
    ON_DEMAND_PRODUCT_FULL_SAFE_CAP,
    QUESTION_JUDGMENT_CODES,
    TOOL_NAMES,
    TOOL_TREND_LIMIT,
    buildCoverageMessage,
    buildDiagnosticFlags,
    buildEnvelope,
    buildHospitalPerformanceRows,
    buildMetricsWithTargets,
    buildProductPerformanceRows,
    buildProductsNameMap,
    buildToolBoundaries,
    buildToolMeta,
    buildToolSummaryFromMetrics,
    normalizeStringArray,
    primitiveExecutors,
    resolveDimensionSelection,
    sortRowsByMetric,
    toPositiveInt,
    trimString,
    uniqueStrings,
  });
  const briefExecutors = createBriefExecutors({
    decorateRows,
    decorateTextRows,
    executeAnomalyInsights: primitiveExecutors[TOOL_NAMES.GET_ANOMALY_INSIGHTS],
    executeEntityRanking: primitiveExecutors[TOOL_NAMES.GET_ENTITY_RANKING],
    executeHospitalSummary: primitiveExecutors[TOOL_NAMES.GET_HOSPITAL_SUMMARY],
    executeOverallSummary: primitiveExecutors[TOOL_NAMES.GET_OVERALL_SUMMARY],
    executeProductSummary: primitiveExecutors[TOOL_NAMES.GET_PRODUCT_SUMMARY],
    executeRiskOpportunitySummary: primitiveExecutors[TOOL_NAMES.GET_RISK_OPPORTUNITY_SUMMARY],
    executeShareBreakdown: (args, ctx) => executeShareBreakdown(args, ctx, scopeExecutors),
    executeTrendSummary: primitiveExecutors[TOOL_NAMES.GET_TREND_SUMMARY],
    MACRO_OVERVIEW_DEFAULT_LIMIT,
    MACRO_REPORT_DEFAULT_LIMIT,
    MACRO_SAFE_LIMIT_CAP,
    mergeTextArrays,
    normalizeNumericValue,
    QUESTION_JUDGMENT_CODES,
    toPositiveInt,
    TOOL_EVIDENCE_TYPE_MAP,
    TOOL_NAMES,
    trimString,
  });
  return {
    ...briefExecutors,
    ...primitiveExecutors,
    ...scopeExecutors,
    [TOOL_NAMES.GET_PRODUCT_TREND]: (args, ctx) => executeProductTrend(args, ctx, scopeExecutors),
    [TOOL_NAMES.GET_HOSPITAL_TREND]: (args, ctx) => executeHospitalTrend(args, ctx, scopeExecutors),
    [TOOL_NAMES.GET_SHARE_BREAKDOWN]: (args, ctx) => executeShareBreakdown(args, ctx, scopeExecutors),
  };
}

export async function executeToolByName(name, args, runtimeContext, deps = {}) {
  const executors = createToolExecutors(deps);
  const safeName = trimString(name);
  const executor = executors[safeName];
  if (typeof executor !== "function") {
    throw new Error(`UNSUPPORTED_TOOL:${safeName}`);
  }
  const result = await executor(args, runtimeContext);
  return {
    ...result,
    meta: buildToolMeta(safeName, result?.meta, TOOL_EVIDENCE_TYPE_MAP[safeName] || []),
  };
}

export function createToolRuntimeContext(params, deps = {}) {
  return buildToolExecutionContext(params, deps);
}

export { buildToolDeclarations };
