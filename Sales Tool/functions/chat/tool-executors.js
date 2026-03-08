import {
  addMonthsToYm,
  ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP,
  ON_DEMAND_MAX_WINDOW_MONTHS,
  ON_DEMAND_PRODUCT_FULL_SAFE_CAP,
  ON_DEMAND_PRODUCT_NAMED_SAFE_CAP,
  QUESTION_JUDGMENT_CODES,
  formatAmountWanText,
  formatDeltaPercentText,
  normalizeBusinessSnapshot,
  normalizeNumericValue,
  parseYm,
  trimString,
} from "./shared.js";
import { buildToolDeclarations, TOOL_NAMES } from "./tool-registry.js";
import { matchNamedProductsFromCatalog } from "./retrieval-context.js";
import {
  buildProductsNameMap,
  fetchProductsCatalog,
  fetchSalesRecordsByWindow,
  resolveRetrievalWindowFromSnapshot,
} from "./retrieval-data.js";
import {
  buildAggregatedMetrics,
  buildHospitalPerformanceRows,
  buildKeyBusinessSignals,
  buildPerformanceOverviewFromMetrics,
  buildProductPerformanceRows,
  buildRecentTrendsFromMetrics,
  buildRiskOpportunityHints,
  filterRecordsForProductHospital,
} from "./retrieval-enhancement.js";
import {
  buildHospitalNamedCandidates,
  normalizeHospitalNameForMatch,
  normalizeProductNameForMatch,
  resolveHospitalNamedMatches,
} from "../../domain/entity-matchers.js";

const TOOL_TREND_LIMIT = ON_DEMAND_MAX_WINDOW_MONTHS;
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

function compareYm(left, right) {
  const parsedLeft = parseYm(left);
  const parsedRight = parseYm(right);
  if (!parsedLeft || !parsedRight) {
    return 0;
  }
  if (parsedLeft.year !== parsedRight.year) {
    return parsedLeft.year - parsedRight.year;
  }
  return parsedLeft.month - parsedRight.month;
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

function listMonthKeysInRange(startMonth, endMonth) {
  const safeStart = trimString(startMonth);
  const safeEnd = trimString(endMonth);
  if (!parseYm(safeStart) || !parseYm(safeEnd) || compareYm(safeStart, safeEnd) > 0) {
    return [];
  }
  const values = [];
  let cursor = safeStart;
  while (cursor && compareYm(cursor, safeEnd) <= 0) {
    values.push(cursor);
    cursor = addMonthsToYm(cursor, 1);
  }
  return values;
}

function filterRecordsByMonthWindow(records, startMonth, endMonth) {
  const safeStart = trimString(startMonth);
  const safeEnd = trimString(endMonth);
  if (!parseYm(safeStart) || !parseYm(safeEnd)) {
    return [];
  }
  return (Array.isArray(records) ? records : []).filter((record) => {
    const period = trimString(record?.period || record?.month_key || record?.record_month || record?.ym);
    if (period) {
      return compareYm(period, safeStart) >= 0 && compareYm(period, safeEnd) <= 0;
    }
    const recordDate = trimString(record?.record_date);
    const parsed = recordDate ? new Date(recordDate) : null;
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
      return false;
    }
    const month = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
    return compareYm(month, safeStart) >= 0 && compareYm(month, safeEnd) <= 0;
  });
}

function buildPeriodComparisonSummary(primaryMetrics, comparisonMetrics) {
  const primaryOverview = buildPerformanceOverviewFromMetrics(primaryMetrics);
  const comparisonOverview = buildPerformanceOverviewFromMetrics(comparisonMetrics);
  const primaryAmount = normalizeNumericValue(primaryOverview?.sales_amount_value) ?? 0;
  const comparisonAmount = normalizeNumericValue(comparisonOverview?.sales_amount_value) ?? 0;
  const primaryVolume = normalizeNumericValue(primaryOverview?.sales_volume_value) ?? 0;
  const comparisonVolume = normalizeNumericValue(comparisonOverview?.sales_volume_value) ?? 0;
  const deltaAmountRatio =
    comparisonAmount > 0 ? (primaryAmount - comparisonAmount) / comparisonAmount : primaryAmount > 0 ? null : 0;
  const deltaVolumeRatio =
    comparisonVolume > 0 ? (primaryVolume - comparisonVolume) / comparisonVolume : primaryVolume > 0 ? null : 0;
  return {
    primary: primaryOverview,
    comparison: comparisonOverview,
    delta: {
      sales_amount_change_ratio: deltaAmountRatio,
      sales_volume_change_ratio: deltaVolumeRatio,
      achievement_change_ratio: null,
      sales_amount_change: formatDeltaPercentText(deltaAmountRatio),
      sales_volume_change: formatDeltaPercentText(deltaVolumeRatio),
    },
  };
}

function buildToolExecutionContext({ businessSnapshot, authToken, env }, deps = {}) {
  const normalizedSnapshot = normalizeBusinessSnapshot(businessSnapshot);
  const resolveWindowImpl = deps.resolveRetrievalWindowFromSnapshot || resolveRetrievalWindowFromSnapshot;
  const fetchSalesRecordsByWindowImpl = deps.fetchSalesRecordsByWindow || fetchSalesRecordsByWindow;
  const fetchProductsCatalogImpl = deps.fetchProductsCatalog || fetchProductsCatalog;

  let windowInfoCache = null;
  let recordsCache = null;
  let productCatalogCache = null;

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
  };
}

async function executeOverallSummary(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const metrics = buildAggregatedMetrics(records, windowInfo.month_keys);
  const trends = buildRecentTrendsFromMetrics(metrics, Math.min(6, windowInfo.month_keys.length));
  const hasRows = trends.length > 0;
  return {
    result: buildEnvelope(windowInfo, {
      coverage: {
        code: hasRows ? "full" : "none",
        message: hasRows ? "当前分析区间已获取整体摘要。" : "当前分析区间暂无整体业务记录。",
      },
      boundaries: buildToolBoundaries({ coverageCode: hasRows ? "full" : "none" }),
      diagnostic_flags: buildDiagnosticFlags({
        coverageCode: hasRows ? "full" : "none",
        rowCount: trends.length,
      }),
      summary: buildToolSummaryFromMetrics(metrics, QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL, {
        focus: trimString(args?.focus),
      }),
      rows: trends,
    }),
    meta: {
      tool_name: TOOL_NAMES.GET_OVERALL_SUMMARY,
      detail_request_mode: "generic",
      coverage_code: hasRows ? "full" : "none",
      analysis_view: "overall_summary",
    },
  };
}

async function executeProductSummary(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const productCatalog = await ctx.getProductCatalog();
  const metrics = buildAggregatedMetrics(records, windowInfo.month_keys);
  const includeAllProducts = Boolean(args?.include_all_products);
  const requestedProductNames = normalizeStringArray(args?.product_names);
  const safeLimit = toPositiveInt(args?.limit, includeAllProducts ? ON_DEMAND_PRODUCT_FULL_SAFE_CAP : 5, ON_DEMAND_PRODUCT_FULL_SAFE_CAP);

  let rows = [];
  let matchedNames = [];
  let unmatchedNames = [];
  let coverageCode = "none";
  let matchMode = "none";

  if (includeAllProducts) {
    const productNameMap = buildProductsNameMap(productCatalog);
    rows = buildProductPerformanceRows(metrics, safeLimit, {
      includeAllCatalogProducts: true,
      productCatalog,
      productNameMap,
    });
    matchedNames = rows.map((item) => trimString(item?.product_name)).filter((item) => item);
    const catalogCount = productCatalog.length;
    coverageCode = catalogCount > 0 && rows.length >= Math.min(catalogCount, ON_DEMAND_PRODUCT_FULL_SAFE_CAP) ? "full" : rows.length > 0 ? "partial" : "none";
  } else if (requestedProductNames.length > 0) {
    const matched = matchNamedProductsFromCatalog(requestedProductNames.join("，"), productCatalog, ON_DEMAND_PRODUCT_NAMED_SAFE_CAP);
    const requestedProducts = Array.isArray(matched?.requestedProducts) ? matched.requestedProducts : [];
    matchMode = trimString(matched?.matchMode) || "none";
    const requestedLookupSet = new Set(requestedProducts.map((item) => normalizeProductNameForMatch(item?.lookup_key || item?.product_name)).filter((item) => item));
    matchedNames = requestedProducts.map((item) => trimString(item?.product_name)).filter((item) => item);
    unmatchedNames = requestedProductNames.filter(
      (item) => !requestedLookupSet.has(normalizeProductNameForMatch(item)),
    );
    const productNameMap = buildProductsNameMap(productCatalog);
    rows = buildProductPerformanceRows(metrics, Math.min(safeLimit, Math.max(requestedProducts.length, 1)), {
      includeNamedProducts: true,
      requestedProducts,
      productNameMap,
      productCatalog,
    });
    coverageCode =
      requestedProductNames.length === 0
        ? "none"
        : matchedNames.length >= requestedProductNames.length
          ? "full"
          : matchedNames.length > 0
            ? "partial"
            : "none";
  } else {
    rows = buildProductPerformanceRows(metrics, safeLimit, {
      productCatalog,
      productNameMap: buildProductsNameMap(productCatalog),
    });
    matchedNames = rows.map((item) => trimString(item?.product_name)).filter((item) => item);
    coverageCode = rows.length > 0 ? "full" : "none";
  }

  return {
    result: buildEnvelope(windowInfo, {
      matched_entities: {
        products: matchedNames,
      },
      unmatched_entities: {
        products: unmatchedNames,
      },
      coverage: {
        code: coverageCode,
        message: buildCoverageMessage(coverageCode, matchedNames.length, requestedProductNames.length || matchedNames.length),
      },
      boundaries: buildToolBoundaries({
        coverageCode,
        unmatchedProducts: unmatchedNames,
      }),
      diagnostic_flags: buildDiagnosticFlags({
        coverageCode,
        unmatchedProducts: unmatchedNames,
        rowCount: rows.length,
        detailRequestMode: includeAllProducts ? "product_full" : requestedProductNames.length > 0 ? "product_named" : "generic",
      }),
      summary: buildToolSummaryFromMetrics(metrics, QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT, {
        match_mode: matchMode,
        include_all_products: includeAllProducts,
      }),
      rows,
    }),
    meta: {
      tool_name: TOOL_NAMES.GET_PRODUCT_SUMMARY,
      detail_request_mode: includeAllProducts ? "product_full" : requestedProductNames.length > 0 ? "product_named" : "generic",
      coverage_code: coverageCode,
      matched_products: matchedNames,
      unmatched_products: unmatchedNames,
      product_named_match_mode: matchMode,
      requested_product_count_value: requestedProductNames.length,
      analysis_view: includeAllProducts ? "product_full" : "product_summary",
    },
  };
}

async function executeHospitalSummary(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const metrics = buildAggregatedMetrics(records, windowInfo.month_keys);
  const requestedHospitalNames = normalizeStringArray(args?.hospital_names);
  const includeMonthly = Boolean(args?.include_monthly);
  const safeLimit = toPositiveInt(args?.limit, requestedHospitalNames.length > 0 ? requestedHospitalNames.length : 5, ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP);

  let rows = [];
  let matchedNames = [];
  let unmatchedNames = [];
  let coverageCode = "none";

  if (requestedHospitalNames.length > 0) {
    const resolution = buildNamedHospitalResolution(requestedHospitalNames, metrics.hospital_rows);
    matchedNames = resolution.matchedNames;
    unmatchedNames = resolution.unmatchedNames;
    coverageCode = resolution.coverageCode;
    rows = buildHospitalPerformanceRows(
      {
        ...metrics,
        include_hospital_monthly_points: includeMonthly,
      },
      Math.min(safeLimit, Math.max(resolution.matchedRows.length, 1)),
      {
        includeNamedHospitals: true,
        requestedHospitals: requestedHospitalNames.map((name) => ({
          mention_name: name,
          mention_key: normalizeHospitalNameForMatch(name),
        })),
      },
    );
  } else {
    rows = buildHospitalPerformanceRows(
      {
        ...metrics,
        include_hospital_monthly_points: includeMonthly,
      },
      safeLimit,
      {},
    );
    matchedNames = rows.map((item) => trimString(item?.hospital_name)).filter((item) => item);
    coverageCode = rows.length > 0 ? "full" : "none";
  }

  return {
    result: buildEnvelope(windowInfo, {
      matched_entities: {
        hospitals: matchedNames,
      },
      unmatched_entities: {
        hospitals: unmatchedNames,
      },
      coverage: {
        code: coverageCode,
        message: buildCoverageMessage(coverageCode, matchedNames.length, requestedHospitalNames.length || matchedNames.length),
      },
      boundaries: buildToolBoundaries({
        coverageCode,
        unmatchedHospitals: unmatchedNames,
      }),
      diagnostic_flags: buildDiagnosticFlags({
        coverageCode,
        unmatchedHospitals: unmatchedNames,
        rowCount: rows.length,
        detailRequestMode: includeMonthly ? "hospital_monthly" : requestedHospitalNames.length > 0 ? "hospital_named" : "generic",
      }),
      summary: buildToolSummaryFromMetrics(metrics, QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL, {
        include_monthly: includeMonthly,
      }),
      rows,
    }),
    meta: {
      tool_name: TOOL_NAMES.GET_HOSPITAL_SUMMARY,
      detail_request_mode: includeMonthly ? "hospital_monthly" : requestedHospitalNames.length > 0 ? "hospital_named" : "generic",
      coverage_code: coverageCode,
      matched_hospitals: matchedNames,
      unmatched_hospitals: unmatchedNames,
      analysis_view: includeMonthly ? "hospital_monthly" : "hospital_summary",
    },
  };
}

async function executeProductHospitalContribution(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const productCatalog = await ctx.getProductCatalog();
  const requestedProductNames = normalizeStringArray(args?.product_names);
  const requestedHospitalNames = normalizeStringArray(args?.hospital_names);
  const safeLimit = toPositiveInt(args?.limit, 5, ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP);
  const matched = matchNamedProductsFromCatalog(requestedProductNames.join("，"), productCatalog, ON_DEMAND_PRODUCT_NAMED_SAFE_CAP);
  const requestedProducts = Array.isArray(matched?.requestedProducts) ? matched.requestedProducts : [];
  const matchedProductNames = requestedProducts.map((item) => trimString(item?.product_name)).filter((item) => item);
  const matchedProductLookupSet = new Set(
    requestedProducts.map((item) => normalizeProductNameForMatch(item?.lookup_key || item?.product_name)).filter((item) => item),
  );
  const unmatchedProductNames = requestedProductNames.filter(
    (item) => !matchedProductLookupSet.has(normalizeProductNameForMatch(item)),
  );
  const filtered = filterRecordsForProductHospital(records, requestedProducts);
  let metrics = buildAggregatedMetrics(filtered.filtered_records, windowInfo.month_keys);
  let hospitalRows = buildHospitalPerformanceRows(metrics, safeLimit, {});
  let matchedHospitalNames = hospitalRows.map((item) => trimString(item?.hospital_name)).filter((item) => item);
  let unmatchedHospitalNames = [];

  if (requestedHospitalNames.length > 0) {
    const resolution = buildNamedHospitalResolution(requestedHospitalNames, metrics.hospital_rows);
    matchedHospitalNames = resolution.matchedNames;
    unmatchedHospitalNames = resolution.unmatchedNames;
    const filteredHospitalRecords = filterRecordsByResolvedHospitalNames(filtered.filtered_records, matchedHospitalNames);
    metrics = buildAggregatedMetrics(filteredHospitalRecords, windowInfo.month_keys);
    hospitalRows = buildHospitalPerformanceRows(metrics, Math.min(safeLimit, Math.max(matchedHospitalNames.length, 1)), {});
  }

  const targetCount = normalizeNumericValue(filtered.target_count) ?? requestedProductNames.length;
  const coverageCode =
    targetCount > 0
      ? filtered.support_code
      : requestedProductNames.length > 0
        ? "none"
        : "full";
  const zeroResult = coverageCode === "full" && hospitalRows.length === 0;
  const zeroResultText =
    zeroResult && matchedProductNames.length > 0
      ? `${matchedProductNames.join("、")}在当前范围内未产生医院销量贡献。`
      : "";

  return {
    result: buildEnvelope(windowInfo, {
      matched_entities: {
        products: matchedProductNames,
        hospitals: matchedHospitalNames,
      },
      unmatched_entities: {
        products: unmatchedProductNames,
        hospitals: unmatchedHospitalNames,
      },
      coverage: {
        code: coverageCode,
        message: buildCoverageMessage(coverageCode, matchedProductNames.length, requestedProductNames.length, zeroResultText),
      },
      boundaries: buildToolBoundaries({
        coverageCode,
        unmatchedProducts: unmatchedProductNames,
        unmatchedHospitals: unmatchedHospitalNames,
        zeroResultText,
      }),
      diagnostic_flags: buildDiagnosticFlags({
        coverageCode,
        unmatchedProducts: unmatchedProductNames,
        unmatchedHospitals: unmatchedHospitalNames,
        zeroResult,
        rowCount: hospitalRows.length,
        detailRequestMode: "product_hospital",
      }),
      summary: buildToolSummaryFromMetrics(metrics, QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL, {
        product_hospital_zero_result: zeroResult,
        product_named_match_mode: trimString(matched?.matchMode) || "none",
        zero_result_message: zeroResultText,
      }),
      rows: hospitalRows,
    }),
    meta: {
      tool_name: TOOL_NAMES.GET_PRODUCT_HOSPITAL_CONTRIBUTION,
      detail_request_mode: "product_hospital",
      coverage_code: coverageCode,
      matched_products: matchedProductNames,
      unmatched_products: unmatchedProductNames,
      matched_hospitals: matchedHospitalNames,
      unmatched_hospitals: unmatchedHospitalNames,
      product_named_match_mode: trimString(matched?.matchMode) || "none",
      requested_product_count_value: requestedProductNames.length,
      product_hospital_hospital_count_value: hospitalRows.length,
      product_hospital_zero_result: zeroResult ? "yes" : "no",
      analysis_view: "product_hospital_contribution",
    },
  };
}

async function executeTrendSummary(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  const granularity = trimString(args?.granularity) || "summary";
  const targetNames = normalizeStringArray(args?.target_names);

  let filteredRecords = records;
  let matchedNames = [];
  let unmatchedNames = [];
  let coverageCode = "full";

  if (dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT && targetNames.length > 0) {
    const productCatalog = await ctx.getProductCatalog();
    const matched = matchNamedProductsFromCatalog(targetNames.join("，"), productCatalog, ON_DEMAND_PRODUCT_NAMED_SAFE_CAP);
    const requestedProducts = Array.isArray(matched?.requestedProducts) ? matched.requestedProducts : [];
    matchedNames = requestedProducts.map((item) => trimString(item?.product_name)).filter((item) => item);
    const matchedKeySet = new Set(matchedNames.map((item) => normalizeProductNameForMatch(item)));
    unmatchedNames = targetNames.filter((item) => !matchedKeySet.has(normalizeProductNameForMatch(item)));
    filteredRecords = filterRecordsByResolvedProductNames(records, matchedNames);
    coverageCode = matchedNames.length >= targetNames.length ? "full" : matchedNames.length > 0 ? "partial" : "none";
  } else if (dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL && targetNames.length > 0) {
    const metricsForResolution = buildAggregatedMetrics(records, windowInfo.month_keys);
    const resolution = buildNamedHospitalResolution(targetNames, metricsForResolution.hospital_rows);
    matchedNames = resolution.matchedNames;
    unmatchedNames = resolution.unmatchedNames;
    filteredRecords = filterRecordsByResolvedHospitalNames(records, matchedNames);
    coverageCode = resolution.coverageCode;
  }

  const metrics = buildAggregatedMetrics(filteredRecords, windowInfo.month_keys);
  const trends = buildRecentTrendsFromMetrics(metrics, granularity === "monthly" ? TOOL_TREND_LIMIT : Math.min(6, windowInfo.month_keys.length));

  return {
    result: buildEnvelope(windowInfo, {
      matched_entities: {
        products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? matchedNames : [],
        hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? matchedNames : [],
      },
      unmatched_entities: {
        products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? unmatchedNames : [],
        hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? unmatchedNames : [],
      },
      coverage: {
        code: trends.length > 0 ? coverageCode : coverageCode === "full" ? "none" : coverageCode,
        message: buildCoverageMessage(trends.length > 0 ? coverageCode : "none", matchedNames.length, targetNames.length || matchedNames.length),
      },
      boundaries: buildToolBoundaries({
        coverageCode: trends.length > 0 ? coverageCode : "none",
        unmatchedProducts: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? unmatchedNames : [],
        unmatchedHospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? unmatchedNames : [],
      }),
      diagnostic_flags: buildDiagnosticFlags({
        coverageCode: trends.length > 0 ? coverageCode : "none",
        unmatchedProducts: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? unmatchedNames : [],
        unmatchedHospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? unmatchedNames : [],
        rowCount: trends.length,
        detailRequestMode: granularity === "monthly" ? `${dimension}_trend_monthly` : `${dimension}_trend`,
      }),
      summary: buildToolSummaryFromMetrics(metrics, dimension, {
        trend_dimension: dimension,
        trend_granularity: granularity,
      }),
      rows: trends,
    }),
    meta: {
      tool_name: TOOL_NAMES.GET_TREND_SUMMARY,
      detail_request_mode: granularity === "monthly" && dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? "hospital_monthly" : "generic",
      coverage_code: trends.length > 0 ? coverageCode : "none",
      matched_products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? matchedNames : [],
      matched_hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? matchedNames : [],
      unmatched_products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? unmatchedNames : [],
      unmatched_hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? unmatchedNames : [],
      analysis_view: `${dimension}_trend`,
    },
  };
}

async function executeScopeAggregate(args, ctx) {
  const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  if (dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    const result = await executeProductSummary(
      {
        product_names: normalizeStringArray(args?.target_names),
        include_all_products: normalizeStringArray(args?.target_names).length === 0,
        limit: args?.limit,
      },
      ctx,
    );
    return {
      ...result,
      meta: buildToolMeta(TOOL_NAMES.SCOPE_AGGREGATE, {
        ...result.meta,
        analysis_view: "product_aggregate",
        primitive_delegate: TOOL_NAMES.GET_PRODUCT_SUMMARY,
      }, ["aggregate"]),
    };
  }
  if (dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    const result = await executeHospitalSummary(
      {
        hospital_names: normalizeStringArray(args?.target_names),
        include_monthly: false,
        limit: args?.limit,
      },
      ctx,
    );
    return {
      ...result,
      meta: buildToolMeta(TOOL_NAMES.SCOPE_AGGREGATE, {
        ...result.meta,
        analysis_view: "hospital_aggregate",
        primitive_delegate: TOOL_NAMES.GET_HOSPITAL_SUMMARY,
      }, ["aggregate"]),
    };
  }
  const result = await executeOverallSummary({ focus: trimString(args?.focus) }, ctx);
  return {
    ...result,
    meta: buildToolMeta(TOOL_NAMES.SCOPE_AGGREGATE, {
      ...result.meta,
      analysis_view: "overall_aggregate",
      primitive_delegate: TOOL_NAMES.GET_OVERALL_SUMMARY,
    }, ["aggregate"]),
  };
}

async function executeScopeTimeseries(args, ctx) {
  const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  const granularity = trimString(args?.granularity) || "monthly";
  const result = await executeTrendSummary(
    {
      dimension,
      target_names: normalizeStringArray(args?.target_names),
      granularity: granularity === "detail" ? "monthly" : granularity,
    },
    ctx,
  );
  return {
    ...result,
    meta: buildToolMeta(TOOL_NAMES.SCOPE_TIMESERIES, {
      ...result.meta,
      analysis_view: `${dimension}_timeseries`,
      primitive_delegate:
        dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT
          ? TOOL_NAMES.GET_PRODUCT_TREND
          : dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL
            ? TOOL_NAMES.GET_HOSPITAL_TREND
            : TOOL_NAMES.GET_TREND_SUMMARY,
    }, ["timeseries"]),
  };
}

async function executeScopeBreakdown(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const scopeDimension = trimString(args?.scope_dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  const breakdownDimension = trimString(args?.breakdown_dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  const targetNames = normalizeStringArray(args?.target_names);
  const ranking = trimString(args?.ranking) || "top";
  const includeShare = Boolean(args?.include_share);
  const metric = trimString(args?.metric) || (includeShare ? "sales_share" : "sales_amount");
  const safeLimit = toPositiveInt(
    args?.limit,
    5,
    breakdownDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT
      ? ON_DEMAND_PRODUCT_FULL_SAFE_CAP
      : ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP,
  );

  if (scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT && breakdownDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    const result = await executeProductHospitalContribution(
      {
        product_names: targetNames,
        limit: safeLimit,
      },
      ctx,
    );
    return {
      ...result,
      meta: buildToolMeta(TOOL_NAMES.SCOPE_BREAKDOWN, {
        ...result.meta,
        analysis_view: "product_to_hospital_breakdown",
        primitive_delegate: TOOL_NAMES.GET_PRODUCT_HOSPITAL_CONTRIBUTION,
      }, ["breakdown", "ranking"]),
    };
  }

  if (breakdownDimension === "month") {
    const result = await executeTrendSummary(
      {
        dimension: scopeDimension,
        target_names: targetNames,
        granularity: "monthly",
      },
      ctx,
    );
    return {
      ...result,
      meta: buildToolMeta(TOOL_NAMES.SCOPE_BREAKDOWN, {
        ...result.meta,
        analysis_view: `${scopeDimension}_monthly_breakdown`,
        primitive_delegate: TOOL_NAMES.GET_TREND_SUMMARY,
      }, ["breakdown", "timeseries"]),
    };
  }

  const selection = await resolveDimensionSelection({
    ctx,
    records,
    windowInfo,
    dimension: scopeDimension,
    targetNames,
  });
  const metrics = buildAggregatedMetrics(selection.filteredRecords, windowInfo.month_keys);
  let baseRows = [];
  if (breakdownDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    const productCatalog = await ctx.getProductCatalog();
    baseRows = buildProductPerformanceRows(metrics, ON_DEMAND_PRODUCT_FULL_SAFE_CAP, {
      productCatalog,
      productNameMap: buildProductsNameMap(productCatalog),
    });
  } else {
    baseRows = buildHospitalPerformanceRows(metrics, ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP, {});
  }
  const rows = sortRowsByMetric(baseRows, metric, ranking).slice(0, safeLimit);
  const effectiveCoverage = rows.length > 0 ? selection.coverageCode : "none";
  return {
    result: buildEnvelope(windowInfo, {
      matched_entities: {
        products:
          scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
        hospitals:
          scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
      },
      unmatched_entities: {
        products:
          scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        hospitals:
          scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      },
      coverage: {
        code: effectiveCoverage,
        message: buildCoverageMessage(
          effectiveCoverage,
          selection.matchedNames.length,
          targetNames.length || selection.matchedNames.length,
        ),
      },
      boundaries: buildToolBoundaries({
        coverageCode: effectiveCoverage,
        unmatchedProducts:
          scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        unmatchedHospitals:
          scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      }),
      diagnostic_flags: buildDiagnosticFlags({
        coverageCode: effectiveCoverage,
        unmatchedProducts:
          scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        unmatchedHospitals:
          scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
        rowCount: rows.length,
        detailRequestMode: "scope_breakdown",
      }),
      summary: buildToolSummaryFromMetrics(metrics, scopeDimension, {
        scope_dimension: scopeDimension,
        breakdown_dimension: breakdownDimension,
        ranking,
        ranking_metric: metric,
        include_share: includeShare,
        concentration: Boolean(args?.concentration),
      }),
      rows,
    }),
    meta: buildToolMeta(TOOL_NAMES.SCOPE_BREAKDOWN, {
      detail_request_mode: "scope_breakdown",
      coverage_code: effectiveCoverage,
      matched_products:
        scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
      matched_hospitals:
        scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
      unmatched_products:
        scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
      unmatched_hospitals:
        scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      analysis_view: `${scopeDimension}_to_${breakdownDimension}_breakdown`,
    }, breakdownDimension === "month" ? ["breakdown", "timeseries"] : ["breakdown", "ranking"]),
  };
}

async function executeScopeDiagnostics(args, ctx) {
  const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  const targetNames = normalizeStringArray(args?.target_names);
  const includeAnomaly = args?.include_anomaly !== false;
  const includeRisk = args?.include_risk !== false;
  const safeLimit = toPositiveInt(args?.limit, 4, TOOL_TREND_LIMIT);
  const results = [];
  if (includeAnomaly) {
    results.push(
      await executeAnomalyInsights(
        {
          dimension,
          target_names: targetNames,
          limit: safeLimit,
        },
        ctx,
      ),
    );
  }
  if (includeRisk) {
    results.push(
      await executeRiskOpportunitySummary(
        {
          dimension,
          target_names: targetNames,
        },
        ctx,
      ),
    );
  }
  const primaryResult = results[0] || { result: buildEnvelope(await ctx.getWindowInfo(), {}), meta: {} };
  const mergedRows = results.flatMap((item) => (Array.isArray(item?.result?.rows) ? item.result.rows : [])).slice(0, safeLimit * 2);
  const mergedBoundaries = uniqueStrings(results.flatMap((item) => item?.result?.boundaries || []));
  const mergedFlags = uniqueStrings(results.flatMap((item) => item?.result?.diagnostic_flags || [])).concat("view_scope_diagnostics");
  const matchedProducts = uniqueStrings(results.flatMap((item) => item?.result?.matched_entities?.products || []));
  const matchedHospitals = uniqueStrings(results.flatMap((item) => item?.result?.matched_entities?.hospitals || []));
  const unmatchedProducts = uniqueStrings(results.flatMap((item) => item?.result?.unmatched_entities?.products || []));
  const unmatchedHospitals = uniqueStrings(results.flatMap((item) => item?.result?.unmatched_entities?.hospitals || []));
  const coverageCodes = results.map((item) => trimString(item?.result?.coverage?.code)).filter((item) => item);
  const coverageCode = coverageCodes.includes("partial")
    ? "partial"
    : coverageCodes.includes("full")
      ? "full"
      : "none";
  const summary = {
    ...(primaryResult?.result?.summary && typeof primaryResult.result.summary === "object" ? primaryResult.result.summary : {}),
    anomaly_count: mergedRows.filter((item) => trimString(item?.signal_type) !== "risk" && trimString(item?.signal_type) !== "opportunity").length,
    diagnostic_count: mergedRows.length,
  };
  return {
    result: {
      ...primaryResult.result,
      matched_entities: {
        products: matchedProducts,
        hospitals: matchedHospitals,
      },
      unmatched_entities: {
        products: unmatchedProducts,
        hospitals: unmatchedHospitals,
      },
      coverage: {
        code: coverageCode,
        message: mergedRows.length > 0 ? "当前范围内已生成诊断证据。" : "当前范围内暂未生成明确诊断证据。",
      },
      boundaries: mergedBoundaries,
      diagnostic_flags: uniqueStrings(mergedFlags),
      summary,
      rows: mergedRows,
    },
    meta: buildToolMeta(TOOL_NAMES.SCOPE_DIAGNOSTICS, {
      detail_request_mode: "scope_diagnostics",
      coverage_code: coverageCode,
      matched_products: matchedProducts,
      matched_hospitals: matchedHospitals,
      unmatched_products: unmatchedProducts,
      unmatched_hospitals: unmatchedHospitals,
      analysis_view: `${dimension}_diagnostics`,
    }, ["diagnostics"]),
  };
}

async function executePeriodComparisonSummary(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const primaryStartMonth = trimString(args?.primary_start_month);
  const primaryEndMonth = trimString(args?.primary_end_month);
  const comparisonStartMonth = trimString(args?.comparison_start_month);
  const comparisonEndMonth = trimString(args?.comparison_end_month);

  const primaryMonthKeys = listMonthKeysInRange(primaryStartMonth, primaryEndMonth);
  const comparisonMonthKeys = listMonthKeysInRange(comparisonStartMonth, comparisonEndMonth);
  const primaryRecords = filterRecordsByMonthWindow(records, primaryStartMonth, primaryEndMonth);
  const comparisonRecords = filterRecordsByMonthWindow(records, comparisonStartMonth, comparisonEndMonth);
  const primaryMetrics = buildAggregatedMetrics(primaryRecords, primaryMonthKeys);
  const comparisonMetrics = buildAggregatedMetrics(comparisonRecords, comparisonMonthKeys);
  const summary = buildPeriodComparisonSummary(primaryMetrics, comparisonMetrics);

  return {
    result: {
      ...buildEnvelope(windowInfo, {
        coverage: {
          code: "full",
          message: "当前请求的两个季度窗口已完整覆盖。",
        },
        boundaries: [],
        diagnostic_flags: buildDiagnosticFlags({
          coverageCode: "full",
          rowCount: 0,
          detailRequestMode: "overall_period_compare",
        }),
        summary,
        rows: [],
      }),
      range: {
        start_month: primaryStartMonth,
        end_month: primaryEndMonth,
        period: `${primaryStartMonth}~${primaryEndMonth}`,
      },
      comparison_range: {
        start_month: comparisonStartMonth,
        end_month: comparisonEndMonth,
        period: `${comparisonStartMonth}~${comparisonEndMonth}`,
      },
    },
    meta: {
      tool_name: TOOL_NAMES.GET_PERIOD_COMPARISON_SUMMARY,
      detail_request_mode: "overall_period_compare",
      coverage_code: "full",
      primary_period: `${primaryStartMonth}~${primaryEndMonth}`,
      comparison_period: `${comparisonStartMonth}~${comparisonEndMonth}`,
      analysis_view: "period_comparison",
    },
  };
}

async function executeProductTrend(args, ctx) {
  const result = await executeScopeTimeseries(
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

async function executeHospitalTrend(args, ctx) {
  const result = await executeScopeTimeseries(
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

async function executeEntityRanking(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  const targetNames = normalizeStringArray(args?.target_names);
  const ranking = trimString(args?.ranking) || "top";
  const metric = trimString(args?.metric) || "sales_amount";
  const safeLimit = toPositiveInt(
    args?.limit,
    5,
    dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT
      ? ON_DEMAND_PRODUCT_FULL_SAFE_CAP
      : ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP,
  );
  const selection = await resolveDimensionSelection({ ctx, records, windowInfo, dimension, targetNames });
  const metrics = buildAggregatedMetrics(selection.filteredRecords, windowInfo.month_keys);
  let baseRows = [];

  if (dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    const productCatalog = await ctx.getProductCatalog();
    baseRows = buildProductPerformanceRows(metrics, ON_DEMAND_PRODUCT_FULL_SAFE_CAP, {
      productCatalog,
      productNameMap: buildProductsNameMap(productCatalog),
    });
  } else {
    baseRows = buildHospitalPerformanceRows(metrics, ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP, {});
  }

  const rows = sortRowsByMetric(baseRows, metric, ranking).slice(0, safeLimit);
  const effectiveCoverage = rows.length > 0 ? selection.coverageCode : "none";
  return {
    result: buildEnvelope(windowInfo, {
      matched_entities: {
        products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
        hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
      },
      unmatched_entities: {
        products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      },
      coverage: {
        code: effectiveCoverage,
        message: buildCoverageMessage(effectiveCoverage, selection.matchedNames.length, targetNames.length || selection.matchedNames.length),
      },
      boundaries: buildToolBoundaries({
        coverageCode: effectiveCoverage,
        unmatchedProducts: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        unmatchedHospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      }),
      diagnostic_flags: buildDiagnosticFlags({
        coverageCode: effectiveCoverage,
        unmatchedProducts: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        unmatchedHospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
        rowCount: rows.length,
        detailRequestMode: "entity_ranking",
      }),
      summary: buildToolSummaryFromMetrics(metrics, dimension, {
        ranking,
        ranking_metric: metric,
      }),
      rows,
    }),
    meta: {
      tool_name: TOOL_NAMES.GET_ENTITY_RANKING,
      detail_request_mode: "entity_ranking",
      coverage_code: effectiveCoverage,
      matched_products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
      matched_hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
      unmatched_products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
      unmatched_hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      analysis_view: "entity_ranking",
    },
  };
}

async function executeShareBreakdown(args, ctx) {
  const result = await executeScopeBreakdown(
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

async function executeAnomalyInsights(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  const targetNames = normalizeStringArray(args?.target_names);
  const safeLimit = toPositiveInt(args?.limit, 3, TOOL_TREND_LIMIT);
  const selection = await resolveDimensionSelection({ ctx, records, windowInfo, dimension, targetNames });
  const metrics = buildAggregatedMetrics(selection.filteredRecords, windowInfo.month_keys);
  const trendRows = buildRecentTrendsFromMetrics(metrics, TOOL_TREND_LIMIT);
  const rows = sortRowsByMetric(trendRows, "change_value", "top")
    .map((row) => ({
      ...row,
      anomaly_reason:
        normalizeNumericValue(row?.amount_mom_ratio) === null
          ? "当前月份缺少可比基线。"
          : `该月金额环比波动 ${trimString(row?.amount_mom) || "--"}。`,
    }))
    .slice(0, safeLimit);
  const effectiveCoverage = rows.length > 0 ? selection.coverageCode : "none";
  return {
    result: buildEnvelope(windowInfo, {
      matched_entities: {
        products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
        hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
      },
      unmatched_entities: {
        products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      },
      coverage: {
        code: effectiveCoverage,
        message: rows.length > 0 ? "当前范围内已识别出主要异动月份。" : "当前范围内暂未识别出可比异动月份。",
      },
      boundaries: buildToolBoundaries({
        coverageCode: effectiveCoverage,
        unmatchedProducts: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        unmatchedHospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      }),
      diagnostic_flags: buildDiagnosticFlags({
        coverageCode: effectiveCoverage,
        unmatchedProducts: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        unmatchedHospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
        rowCount: rows.length,
        detailRequestMode: "anomaly_insights",
      }),
      summary: buildToolSummaryFromMetrics(metrics, dimension, {
        anomaly_count: rows.length,
      }),
      rows,
    }),
    meta: {
      tool_name: TOOL_NAMES.GET_ANOMALY_INSIGHTS,
      detail_request_mode: "anomaly_insights",
      coverage_code: effectiveCoverage,
      matched_products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
      matched_hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
      unmatched_products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
      unmatched_hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      analysis_view: "anomaly_insights",
    },
  };
}

async function executeRiskOpportunitySummary(args, ctx) {
  const windowInfo = await ctx.getWindowInfo();
  const records = await ctx.getRecords();
  const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  const targetNames = normalizeStringArray(args?.target_names);
  const selection = await resolveDimensionSelection({ ctx, records, windowInfo, dimension, targetNames });
  const metrics = buildAggregatedMetrics(selection.filteredRecords, windowInfo.month_keys);
  const riskHints = buildRiskOpportunityHints(metrics);
  const rows = [
    ...riskHints.risk_alerts.map((text) => ({ signal_type: "risk", text })),
    ...riskHints.opportunity_hints.map((text) => ({ signal_type: "opportunity", text })),
  ];
  const effectiveCoverage = rows.length > 0 ? selection.coverageCode : "none";
  return {
    result: buildEnvelope(windowInfo, {
      matched_entities: {
        products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
        hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
      },
      unmatched_entities: {
        products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      },
      coverage: {
        code: effectiveCoverage,
        message: rows.length > 0 ? "当前范围内已生成风险与机会提示。" : "当前范围内暂未生成明确风险与机会提示。",
      },
      boundaries: buildToolBoundaries({
        coverageCode: effectiveCoverage,
        unmatchedProducts: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        unmatchedHospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      }),
      diagnostic_flags: buildDiagnosticFlags({
        coverageCode: effectiveCoverage,
        unmatchedProducts: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        unmatchedHospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
        rowCount: rows.length,
        detailRequestMode: "risk_opportunity",
      }),
      summary: buildToolSummaryFromMetrics(metrics, dimension, {
        risk_alerts: riskHints.risk_alerts,
        opportunity_hints: riskHints.opportunity_hints,
      }),
      rows,
    }),
    meta: {
      tool_name: TOOL_NAMES.GET_RISK_OPPORTUNITY_SUMMARY,
      detail_request_mode: "risk_opportunity",
      coverage_code: effectiveCoverage,
      matched_products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
      matched_hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
      unmatched_products: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
      unmatched_hospitals: dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
      analysis_view: "risk_opportunity",
    },
  };
}

async function executeSalesOverviewBrief(args, ctx) {
  const safeLimit = toPositiveInt(args?.limit, 4, 6);
  const [overall, trend, products, hospitals, diagnostics] = await Promise.all([
    executeOverallSummary({}, ctx),
    executeTrendSummary(
      {
        dimension: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
        granularity: "monthly",
      },
      ctx,
    ),
    executeProductSummary(
      {
        include_all_products: true,
        limit: Math.max(3, safeLimit),
      },
      ctx,
    ),
    executeHospitalSummary(
      {
        limit: Math.max(3, safeLimit),
      },
      ctx,
    ),
    executeRiskOpportunitySummary(
      {
        dimension: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
      },
      ctx,
    ),
  ]);

  const summary = {
    ...(overall.result.summary && typeof overall.result.summary === "object" ? overall.result.summary : {}),
    key_business_signals: mergeTextArrays(
      overall.result.summary?.key_business_signals,
      diagnostics.result.summary?.risk_alerts,
      diagnostics.result.summary?.opportunity_hints,
    ).slice(0, 4),
    risk_alerts: Array.isArray(diagnostics.result.summary?.risk_alerts) ? diagnostics.result.summary.risk_alerts.slice(0, 2) : [],
    opportunity_hints: Array.isArray(diagnostics.result.summary?.opportunity_hints)
      ? diagnostics.result.summary.opportunity_hints.slice(0, 2)
      : [],
    top_products: decorateRows(products.result.rows, "", 3).map((row) => trimString(row?.product_name)).filter((item) => item),
    top_hospitals: decorateRows(hospitals.result.rows, "", 3).map((row) => trimString(row?.hospital_name)).filter((item) => item),
  };

  return {
    result: {
      ...overall.result,
      coverage: overall.result.coverage,
      boundaries: mergeTextArrays(
        overall.result.boundaries,
        products.result.boundaries,
        hospitals.result.boundaries,
        diagnostics.result.boundaries,
      ).slice(0, 4),
      diagnostic_flags: mergeTextArrays(
        overall.result.diagnostic_flags,
        trend.result.diagnostic_flags,
        products.result.diagnostic_flags,
        hospitals.result.diagnostic_flags,
        diagnostics.result.diagnostic_flags,
        ["view_sales_overview_brief"],
      ),
      summary,
      rows: [
        ...decorateRows(trend.result.rows, "趋势:", Math.min(3, safeLimit)),
        ...decorateRows(products.result.rows, "产品:", Math.min(3, safeLimit)),
        ...decorateRows(hospitals.result.rows, "医院:", Math.min(3, safeLimit)),
        ...decorateTextRows(diagnostics.result.rows.slice(0, 2), {
          risk: "风险:",
          opportunity: "机会:",
          default: "诊断:",
        }),
      ].slice(0, Math.max(6, safeLimit * 2)),
    },
    meta: {
      tool_name: TOOL_NAMES.GET_SALES_OVERVIEW_BRIEF,
      detail_request_mode: "macro_overview",
      coverage_code: trimString(overall.result.coverage?.code) || "none",
      analysis_view: "sales_overview_brief",
      evidence_types: TOOL_EVIDENCE_TYPE_MAP[TOOL_NAMES.GET_SALES_OVERVIEW_BRIEF],
    },
  };
}

async function executeSalesTrendBrief(args, ctx) {
  const safeLimit = toPositiveInt(args?.limit, 4, 6);
  const [overall, trend, breakdown, diagnostics] = await Promise.all([
    executeOverallSummary({}, ctx),
    executeTrendSummary(
      {
        dimension: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
        granularity: "monthly",
      },
      ctx,
    ),
    executeShareBreakdown(
      {
        dimension: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        limit: Math.max(3, safeLimit),
      },
      ctx,
    ),
    executeAnomalyInsights(
      {
        dimension: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
        limit: Math.max(3, safeLimit),
      },
      ctx,
    ),
  ]);

  const summary = {
    ...(overall.result.summary && typeof overall.result.summary === "object" ? overall.result.summary : {}),
    trend_focus: "当前报表区间趋势概览",
    key_business_signals: mergeTextArrays(
      overall.result.summary?.key_business_signals,
      trend.result.summary?.key_business_signals,
    ).slice(0, 4),
    anomaly_count: normalizeNumericValue(diagnostics.result.summary?.anomaly_count) ?? diagnostics.result.rows.length,
  };

  return {
    result: {
      ...overall.result,
      coverage: trend.result.coverage,
      boundaries: mergeTextArrays(
        trend.result.boundaries,
        breakdown.result.boundaries,
        diagnostics.result.boundaries,
      ).slice(0, 4),
      diagnostic_flags: mergeTextArrays(
        trend.result.diagnostic_flags,
        breakdown.result.diagnostic_flags,
        diagnostics.result.diagnostic_flags,
        ["view_sales_trend_brief"],
      ),
      summary,
      rows: [
        ...decorateRows(trend.result.rows, "趋势:", Math.min(4, safeLimit)),
        ...decorateRows(breakdown.result.rows, "结构:", Math.min(3, safeLimit)),
        ...decorateTextRows(diagnostics.result.rows.slice(0, 2), {
          default: "异动:",
        }),
      ].slice(0, Math.max(6, safeLimit * 2)),
    },
    meta: {
      tool_name: TOOL_NAMES.GET_SALES_TREND_BRIEF,
      detail_request_mode: "macro_trend",
      coverage_code: trimString(trend.result.coverage?.code) || "none",
      analysis_view: "sales_trend_brief",
      evidence_types: TOOL_EVIDENCE_TYPE_MAP[TOOL_NAMES.GET_SALES_TREND_BRIEF],
    },
  };
}

async function executeDimensionOverviewBrief(args, ctx) {
  const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  const safeDimension =
    dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL
      ? QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL
      : QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  const safeLimit = toPositiveInt(args?.limit, 5, safeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? 10 : 10);
  const [summaryResult, rankingResult, breakdownResult] = await Promise.all([
    safeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT
      ? executeProductSummary(
          {
            include_all_products: true,
            limit: safeLimit,
          },
          ctx,
        )
      : executeHospitalSummary(
          {
            limit: safeLimit,
          },
          ctx,
        ),
    executeEntityRanking(
      {
        dimension: safeDimension,
        ranking: "bottom",
        metric: "sales_amount",
        limit: Math.min(3, safeLimit),
      },
      ctx,
    ),
    executeShareBreakdown(
      {
        dimension: safeDimension,
        limit: Math.min(5, safeLimit),
      },
      ctx,
    ),
  ]);

  const summary = {
    ...(summaryResult.result.summary && typeof summaryResult.result.summary === "object" ? summaryResult.result.summary : {}),
    overview_dimension: safeDimension,
    concentration_hint:
      trimString(breakdownResult.result.rows?.[0]?.sales_share) || trimString(breakdownResult.result.rows?.[0]?.sales_amount),
  };

  return {
    result: {
      ...summaryResult.result,
      coverage: summaryResult.result.coverage,
      boundaries: mergeTextArrays(
        summaryResult.result.boundaries,
        rankingResult.result.boundaries,
        breakdownResult.result.boundaries,
      ).slice(0, 4),
      diagnostic_flags: mergeTextArrays(
        summaryResult.result.diagnostic_flags,
        rankingResult.result.diagnostic_flags,
        breakdownResult.result.diagnostic_flags,
        [`view_${safeDimension}_overview_brief`],
      ),
      summary,
      rows: [
        ...decorateRows(summaryResult.result.rows, safeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? "产品:" : "医院:", Math.min(4, safeLimit)),
        ...decorateRows(rankingResult.result.rows, "待关注:", Math.min(2, safeLimit), "待关注对象"),
        ...decorateRows(breakdownResult.result.rows, "结构:", Math.min(3, safeLimit)),
      ].slice(0, Math.max(6, safeLimit * 2)),
    },
    meta: {
      tool_name: TOOL_NAMES.GET_DIMENSION_OVERVIEW_BRIEF,
      detail_request_mode: "macro_dimension_overview",
      coverage_code: trimString(summaryResult.result.coverage?.code) || "none",
      analysis_view: `${safeDimension}_overview_brief`,
      evidence_types: TOOL_EVIDENCE_TYPE_MAP[TOOL_NAMES.GET_DIMENSION_OVERVIEW_BRIEF],
    },
  };
}

async function executeDimensionReportBrief(args, ctx) {
  const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  const safeDimension =
    dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL
      ? QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL
      : QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  const safeLimit = toPositiveInt(args?.limit, 5, 10);
  const [summaryResult, topRankingResult, bottomRankingResult, breakdownResult, trendResult, riskResult, anomalyResult] =
    await Promise.all([
      safeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT
        ? executeProductSummary(
            {
              include_all_products: true,
              limit: safeLimit,
            },
            ctx,
          )
        : executeHospitalSummary(
            {
              limit: safeLimit,
            },
            ctx,
          ),
      executeEntityRanking(
        {
          dimension: safeDimension,
          ranking: "top",
          metric: "sales_amount",
          limit: Math.min(3, safeLimit),
        },
        ctx,
      ),
      executeEntityRanking(
        {
          dimension: safeDimension,
          ranking: "bottom",
          metric: "sales_amount",
          limit: Math.min(3, safeLimit),
        },
        ctx,
      ),
      executeShareBreakdown(
        {
          dimension: safeDimension,
          limit: Math.min(5, safeLimit),
        },
        ctx,
      ),
      executeTrendSummary(
        {
          dimension: safeDimension,
          granularity: "monthly",
          limit: Math.max(3, safeLimit),
        },
        ctx,
      ),
      executeRiskOpportunitySummary(
        {
          dimension: safeDimension,
        },
        ctx,
      ),
      executeAnomalyInsights(
        {
          dimension: safeDimension,
          limit: Math.min(3, safeLimit),
        },
        ctx,
      ),
    ]);

  const topEntities = decorateRows(topRankingResult.result.rows, "", 3)
    .map((row) => trimString(row?.product_name || row?.hospital_name || row?.row_label))
    .filter((item) => item);
  const bottomEntities = decorateRows(bottomRankingResult.result.rows, "", 3)
    .map((row) => trimString(row?.product_name || row?.hospital_name || row?.row_label))
    .filter((item) => item);
  const trendSignals = mergeTextArrays(
    summaryResult.result.summary?.key_business_signals,
    trendResult.result.summary?.key_business_signals,
  ).slice(0, 4);
  const riskAlerts = Array.isArray(riskResult.result.summary?.risk_alerts) ? riskResult.result.summary.risk_alerts.slice(0, 2) : [];
  const opportunityHints = Array.isArray(riskResult.result.summary?.opportunity_hints)
    ? riskResult.result.summary.opportunity_hints.slice(0, 2)
    : [];
  const summary = {
    ...(summaryResult.result.summary && typeof summaryResult.result.summary === "object" ? summaryResult.result.summary : {}),
    overview_dimension: safeDimension,
    top_entities: topEntities,
    bottom_entities: bottomEntities,
    trend_signals: trendSignals,
    risk_alerts: riskAlerts,
    opportunity_hints: opportunityHints,
    concentration_hint:
      trimString(breakdownResult.result.rows?.[0]?.sales_share) || trimString(breakdownResult.result.rows?.[0]?.sales_amount),
  };

  return {
    result: {
      ...summaryResult.result,
      coverage: summaryResult.result.coverage,
      boundaries: mergeTextArrays(
        summaryResult.result.boundaries,
        topRankingResult.result.boundaries,
        bottomRankingResult.result.boundaries,
        breakdownResult.result.boundaries,
        trendResult.result.boundaries,
        riskResult.result.boundaries,
        anomalyResult.result.boundaries,
      ).slice(0, 5),
      diagnostic_flags: mergeTextArrays(
        summaryResult.result.diagnostic_flags,
        topRankingResult.result.diagnostic_flags,
        bottomRankingResult.result.diagnostic_flags,
        breakdownResult.result.diagnostic_flags,
        trendResult.result.diagnostic_flags,
        riskResult.result.diagnostic_flags,
        anomalyResult.result.diagnostic_flags,
        [`view_${safeDimension}_report_brief`],
      ),
      summary,
      rows: [
        ...decorateRows(trendResult.result.rows, "趋势:", Math.min(3, safeLimit)),
        ...decorateRows(topRankingResult.result.rows, "Top:", Math.min(3, safeLimit), "头部对象"),
        ...decorateRows(bottomRankingResult.result.rows, "待关注:", Math.min(2, safeLimit), "待关注对象"),
        ...decorateRows(breakdownResult.result.rows, "结构:", Math.min(3, safeLimit)),
        ...decorateTextRows(
          [...(Array.isArray(riskResult.result.rows) ? riskResult.result.rows : []), ...(Array.isArray(anomalyResult.result.rows) ? anomalyResult.result.rows : [])].slice(0, 3),
          {
            risk: "风险:",
            opportunity: "机会:",
            default: "诊断:",
          },
        ),
      ].slice(0, Math.max(8, safeLimit * 2)),
    },
    meta: {
      tool_name: TOOL_NAMES.GET_DIMENSION_REPORT_BRIEF,
      detail_request_mode: "macro_dimension_report",
      coverage_code: trimString(summaryResult.result.coverage?.code) || "none",
      analysis_view: `${safeDimension}_report_brief`,
      evidence_types: TOOL_EVIDENCE_TYPE_MAP[TOOL_NAMES.GET_DIMENSION_REPORT_BRIEF],
    },
  };
}

export function createToolExecutors(deps = {}) {
  return {
    [TOOL_NAMES.GET_SALES_OVERVIEW_BRIEF]: (args, ctx) => executeSalesOverviewBrief(args, ctx, deps),
    [TOOL_NAMES.GET_SALES_TREND_BRIEF]: (args, ctx) => executeSalesTrendBrief(args, ctx, deps),
    [TOOL_NAMES.GET_DIMENSION_OVERVIEW_BRIEF]: (args, ctx) => executeDimensionOverviewBrief(args, ctx, deps),
    [TOOL_NAMES.GET_DIMENSION_REPORT_BRIEF]: (args, ctx) => executeDimensionReportBrief(args, ctx, deps),
    [TOOL_NAMES.SCOPE_AGGREGATE]: (args, ctx) => executeScopeAggregate(args, ctx, deps),
    [TOOL_NAMES.SCOPE_TIMESERIES]: (args, ctx) => executeScopeTimeseries(args, ctx, deps),
    [TOOL_NAMES.SCOPE_BREAKDOWN]: (args, ctx) => executeScopeBreakdown(args, ctx, deps),
    [TOOL_NAMES.SCOPE_DIAGNOSTICS]: (args, ctx) => executeScopeDiagnostics(args, ctx, deps),
    [TOOL_NAMES.GET_OVERALL_SUMMARY]: (args, ctx) => executeOverallSummary(args, ctx, deps),
    [TOOL_NAMES.GET_PRODUCT_SUMMARY]: (args, ctx) => executeProductSummary(args, ctx, deps),
    [TOOL_NAMES.GET_HOSPITAL_SUMMARY]: (args, ctx) => executeHospitalSummary(args, ctx, deps),
    [TOOL_NAMES.GET_PRODUCT_HOSPITAL_CONTRIBUTION]: (args, ctx) => executeProductHospitalContribution(args, ctx, deps),
    [TOOL_NAMES.GET_TREND_SUMMARY]: (args, ctx) => executeTrendSummary(args, ctx, deps),
    [TOOL_NAMES.GET_PERIOD_COMPARISON_SUMMARY]: (args, ctx) => executePeriodComparisonSummary(args, ctx, deps),
    [TOOL_NAMES.GET_PRODUCT_TREND]: (args, ctx) => executeProductTrend(args, ctx, deps),
    [TOOL_NAMES.GET_HOSPITAL_TREND]: (args, ctx) => executeHospitalTrend(args, ctx, deps),
    [TOOL_NAMES.GET_ENTITY_RANKING]: (args, ctx) => executeEntityRanking(args, ctx, deps),
    [TOOL_NAMES.GET_SHARE_BREAKDOWN]: (args, ctx) => executeShareBreakdown(args, ctx, deps),
    [TOOL_NAMES.GET_ANOMALY_INSIGHTS]: (args, ctx) => executeAnomalyInsights(args, ctx, deps),
    [TOOL_NAMES.GET_RISK_OPPORTUNITY_SUMMARY]: (args, ctx) => executeRiskOpportunitySummary(args, ctx, deps),
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
