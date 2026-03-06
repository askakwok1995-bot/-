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
import { applyRequestedTimeWindowToSnapshot } from "./time-intent.js";

const TOOL_TREND_LIMIT = ON_DEMAND_MAX_WINDOW_MONTHS;

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

function buildCoverageMessage(code, matchedCount, totalCount, zeroResultText = "") {
  if (code === "full") {
    return zeroResultText || "当前请求范围已完整覆盖。";
  }
  if (code === "partial") {
    return `当前请求范围仅部分覆盖（已覆盖 ${matchedCount}/${totalCount || matchedCount}）。`;
  }
  return "当前请求范围暂无可用覆盖。";
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

function buildToolSummaryFromMetrics(metrics, targetDimension, extra = {}) {
  const performanceOverview = buildPerformanceOverviewFromMetrics(metrics);
  const keyBusinessSignals = buildKeyBusinessSignals(metrics, { targetDimension });
  return {
    ...performanceOverview,
    key_business_signals: keyBusinessSignals,
    ...extra,
  };
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
    const period = trimString(record?.period || record?.month_key || record?.record_month);
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

function buildToolExecutionContext({ businessSnapshot, requestedTimeWindow = null, authToken, env }, deps = {}) {
  const normalizedSnapshot = normalizeBusinessSnapshot(businessSnapshot);
  const scopedSnapshot =
    trimString(requestedTimeWindow?.period) && trimString(requestedTimeWindow?.kind) !== "none"
      ? applyRequestedTimeWindowToSnapshot(normalizedSnapshot, requestedTimeWindow)
      : normalizedSnapshot;
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
        windowInfoCache = resolveWindowImpl(scopedSnapshot);
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
      summary: buildToolSummaryFromMetrics(metrics, QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL, {
        focus: trimString(args?.focus),
      }),
      rows: trends,
    }),
    meta: {
      tool_name: TOOL_NAMES.GET_OVERALL_SUMMARY,
      detail_request_mode: "generic",
      coverage_code: hasRows ? "full" : "none",
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
    },
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
    },
  };
}

export function createToolExecutors(deps = {}) {
  return {
    [TOOL_NAMES.GET_OVERALL_SUMMARY]: (args, ctx) => executeOverallSummary(args, ctx, deps),
    [TOOL_NAMES.GET_PRODUCT_SUMMARY]: (args, ctx) => executeProductSummary(args, ctx, deps),
    [TOOL_NAMES.GET_HOSPITAL_SUMMARY]: (args, ctx) => executeHospitalSummary(args, ctx, deps),
    [TOOL_NAMES.GET_PRODUCT_HOSPITAL_CONTRIBUTION]: (args, ctx) => executeProductHospitalContribution(args, ctx, deps),
    [TOOL_NAMES.GET_TREND_SUMMARY]: (args, ctx) => executeTrendSummary(args, ctx, deps),
    [TOOL_NAMES.GET_PERIOD_COMPARISON_SUMMARY]: (args, ctx) => executePeriodComparisonSummary(args, ctx, deps),
  };
}

export async function executeToolByName(name, args, runtimeContext, deps = {}) {
  const executors = createToolExecutors(deps);
  const executor = executors[trimString(name)];
  if (typeof executor !== "function") {
    throw new Error(`UNSUPPORTED_TOOL:${trimString(name)}`);
  }
  return executor(args, runtimeContext);
}

export function createToolRuntimeContext(params, deps = {}) {
  return buildToolExecutionContext(params, deps);
}

export { buildToolDeclarations };
