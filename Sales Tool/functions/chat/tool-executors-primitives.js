import {
  addMonthsToYm,
  ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP,
  ON_DEMAND_MAX_WINDOW_MONTHS,
  ON_DEMAND_PRODUCT_FULL_SAFE_CAP,
  ON_DEMAND_PRODUCT_NAMED_SAFE_CAP,
  QUESTION_JUDGMENT_CODES,
  formatDeltaPercentText,
  normalizeNumericValue,
  parseYm,
  trimString,
} from "./shared.js";
import { TOOL_NAMES } from "./tool-registry.js";
import { matchNamedProductsFromCatalog } from "./retrieval-context.js";
import { buildProductsNameMap } from "./retrieval-data.js";
import {
  buildAggregatedMetrics,
  buildHospitalPerformanceRows,
  buildPerformanceOverviewFromMetrics,
  buildProductPerformanceRows,
  buildRecentTrendsFromMetrics,
  buildRiskOpportunityHints,
  filterRecordsForProductHospital,
} from "./retrieval-enhancement.js";
import {
  normalizeHospitalNameForMatch,
  normalizeProductNameForMatch,
} from "../../domain/entity-matchers.js";

const TOOL_TREND_LIMIT = ON_DEMAND_MAX_WINDOW_MONTHS;

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

function filterRecordsByResolvedProductNames(records, productNames, normalizeStringArray) {
  const targets = new Set(normalizeStringArray(productNames).map((item) => normalizeProductNameForMatch(item)).filter((item) => item));
  if (targets.size === 0) {
    return [];
  }
  return (Array.isArray(records) ? records : []).filter((record) => targets.has(normalizeProductNameForMatch(record?.product_name)));
}

function filterRecordsByResolvedHospitalNames(records, hospitalNames, normalizeStringArray) {
  const targets = new Set(normalizeStringArray(hospitalNames).map((item) => normalizeHospitalNameForMatch(item)).filter((item) => item));
  if (targets.size === 0) {
    return [];
  }
  return (Array.isArray(records) ? records : []).filter((record) => targets.has(normalizeHospitalNameForMatch(record?.hospital_name)));
}

async function resolveDimensionSelection(
  {
    ctx,
    records,
    windowInfo,
    dimension,
    targetNames = [],
  } = {},
  helpers = {},
) {
  const {
    buildNamedHospitalResolution,
    normalizeStringArray,
  } = helpers;
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
    filteredRecords = filterRecordsByResolvedProductNames(records, matchedNames, normalizeStringArray);
    coverageCode = matchedNames.length >= safeTargetNames.length ? "full" : matchedNames.length > 0 ? "partial" : "none";
  } else if (safeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL && safeTargetNames.length > 0) {
    const metricsForResolution = buildAggregatedMetrics(records, windowInfo.month_keys);
    const resolution = buildNamedHospitalResolution(safeTargetNames, metricsForResolution.hospital_rows);
    matchedNames = resolution.matchedNames;
    unmatchedNames = resolution.unmatchedNames;
    filteredRecords = filterRecordsByResolvedHospitalNames(records, matchedNames, normalizeStringArray);
    coverageCode = resolution.coverageCode;
  }

  return {
    filteredRecords,
    matchedNames,
    unmatchedNames,
    coverageCode,
  };
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

function extractYearsFromMonthKeys(monthKeys) {
  return Array.from(
    new Set(
      (Array.isArray(monthKeys) ? monthKeys : [])
        .map((ym) => Number(String(ym || "").slice(0, 4)))
        .filter((year) => Number.isInteger(year)),
    ),
  ).sort((left, right) => left - right);
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

export function createPrimitiveExecutors(helpers = {}) {
  const {
    buildCoverageMessage,
    buildDiagnosticFlags,
    buildEnvelope,
    buildMetricsWithTargets,
    buildNamedHospitalResolution,
    buildToolBoundaries,
    buildToolSummaryFromMetrics,
    normalizeStringArray,
    toPositiveInt,
  } = helpers;

  async function executeOverallSummary(args, ctx) {
    const windowInfo = await ctx.getWindowInfo();
    const records = await ctx.getRecords();
    const metrics = await buildMetricsWithTargets(ctx, records, windowInfo.month_keys, {
      scopeDimension: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
    });
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
    const productNameMap = buildProductsNameMap(productCatalog);
    const includeAllProducts = Boolean(args?.include_all_products);
    const requestedProductNames = normalizeStringArray(args?.product_names);
    const safeLimit = toPositiveInt(args?.limit, includeAllProducts ? ON_DEMAND_PRODUCT_FULL_SAFE_CAP : 5, ON_DEMAND_PRODUCT_FULL_SAFE_CAP);

    let rows = [];
    let matchedNames = [];
    let unmatchedNames = [];
    let coverageCode = "none";
    let matchMode = "none";
    let metrics = await buildMetricsWithTargets(ctx, records, windowInfo.month_keys, {
      scopeDimension: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
      productNameMap,
      scopeProductIds: includeAllProducts ? productCatalog.map((item) => trimString(item?.product_id)) : [],
    });

    if (includeAllProducts) {
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
      metrics = await buildMetricsWithTargets(ctx, records, windowInfo.month_keys, {
        scopeDimension: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        productNameMap,
        scopeProductIds: requestedProducts.map((item) => trimString(item?.product_id)),
      });
      matchMode = trimString(matched?.matchMode) || "none";
      const requestedLookupSet = new Set(requestedProducts.map((item) => normalizeProductNameForMatch(item?.lookup_key || item?.product_name)).filter((item) => item));
      matchedNames = requestedProducts.map((item) => trimString(item?.product_name)).filter((item) => item);
      unmatchedNames = requestedProductNames.filter(
        (item) => !requestedLookupSet.has(normalizeProductNameForMatch(item)),
      );
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
        productNameMap,
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
    const metrics = await buildMetricsWithTargets(ctx, records, windowInfo.month_keys, {
      scopeDimension: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
    });
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
    let metrics = await buildMetricsWithTargets(ctx, filtered.filtered_records, windowInfo.month_keys, {
      scopeDimension: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
    });
    let hospitalRows = buildHospitalPerformanceRows(metrics, safeLimit, {});
    let matchedHospitalNames = hospitalRows.map((item) => trimString(item?.hospital_name)).filter((item) => item);
    let unmatchedHospitalNames = [];

    if (requestedHospitalNames.length > 0) {
      const resolution = buildNamedHospitalResolution(requestedHospitalNames, metrics.hospital_rows);
      matchedHospitalNames = resolution.matchedNames;
      unmatchedHospitalNames = resolution.unmatchedNames;
      const filteredHospitalRecords = filterRecordsByResolvedHospitalNames(filtered.filtered_records, matchedHospitalNames, normalizeStringArray);
      metrics = await buildMetricsWithTargets(ctx, filteredHospitalRecords, windowInfo.month_keys, {
        scopeDimension: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
      });
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
      filteredRecords = filterRecordsByResolvedProductNames(records, matchedNames, normalizeStringArray);
      coverageCode = matchedNames.length >= targetNames.length ? "full" : matchedNames.length > 0 ? "partial" : "none";
    } else if (dimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL && targetNames.length > 0) {
      const metricsForResolution = buildAggregatedMetrics(records, windowInfo.month_keys);
      const resolution = buildNamedHospitalResolution(targetNames, metricsForResolution.hospital_rows);
      matchedNames = resolution.matchedNames;
      unmatchedNames = resolution.unmatchedNames;
      filteredRecords = filterRecordsByResolvedHospitalNames(records, matchedNames, normalizeStringArray);
      coverageCode = resolution.coverageCode;
    }

    const metrics = await buildMetricsWithTargets(ctx, filteredRecords, windowInfo.month_keys, {
      scopeDimension: dimension,
    });
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
    const primaryMetrics = await buildMetricsWithTargets(ctx, primaryRecords, primaryMonthKeys, {
      scopeDimension: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
      targetYears: extractYearsFromMonthKeys(primaryMonthKeys),
    });
    const comparisonMetrics = await buildMetricsWithTargets(ctx, comparisonRecords, comparisonMonthKeys, {
      scopeDimension: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
      targetYears: extractYearsFromMonthKeys(comparisonMonthKeys),
    });
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
    const selection = await resolveDimensionSelection({ ctx, records, windowInfo, dimension, targetNames }, {
      buildNamedHospitalResolution,
      normalizeStringArray,
    });
    const metrics = await buildMetricsWithTargets(ctx, selection.filteredRecords, windowInfo.month_keys, {
      scopeDimension: dimension,
    });
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

  async function executeAnomalyInsights(args, ctx) {
    const windowInfo = await ctx.getWindowInfo();
    const records = await ctx.getRecords();
    const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
    const targetNames = normalizeStringArray(args?.target_names);
    const safeLimit = toPositiveInt(args?.limit, 3, TOOL_TREND_LIMIT);
    const selection = await resolveDimensionSelection({ ctx, records, windowInfo, dimension, targetNames }, {
      buildNamedHospitalResolution,
      normalizeStringArray,
    });
    const metrics = await buildMetricsWithTargets(ctx, selection.filteredRecords, windowInfo.month_keys, {
      scopeDimension: dimension,
    });
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
    const selection = await resolveDimensionSelection({ ctx, records, windowInfo, dimension, targetNames }, {
      buildNamedHospitalResolution,
      normalizeStringArray,
    });
    const metrics = await buildMetricsWithTargets(ctx, selection.filteredRecords, windowInfo.month_keys, {
      scopeDimension: dimension,
    });
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

  return {
    [TOOL_NAMES.GET_OVERALL_SUMMARY]: executeOverallSummary,
    [TOOL_NAMES.GET_PRODUCT_SUMMARY]: executeProductSummary,
    [TOOL_NAMES.GET_HOSPITAL_SUMMARY]: executeHospitalSummary,
    [TOOL_NAMES.GET_PRODUCT_HOSPITAL_CONTRIBUTION]: executeProductHospitalContribution,
    [TOOL_NAMES.GET_TREND_SUMMARY]: executeTrendSummary,
    [TOOL_NAMES.GET_PERIOD_COMPARISON_SUMMARY]: executePeriodComparisonSummary,
    [TOOL_NAMES.GET_ENTITY_RANKING]: executeEntityRanking,
    [TOOL_NAMES.GET_ANOMALY_INSIGHTS]: executeAnomalyInsights,
    [TOOL_NAMES.GET_RISK_OPPORTUNITY_SUMMARY]: executeRiskOpportunitySummary,
  };
}
