export function createScopeExecutors(helpers = {}) {
  const {
    ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP,
    ON_DEMAND_PRODUCT_FULL_SAFE_CAP,
    QUESTION_JUDGMENT_CODES,
    TOOL_NAMES,
    TOOL_TREND_LIMIT,
    buildCoverageMessage,
    buildDiagnosticFlags,
    buildEnvelope,
    buildProductsNameMap,
    buildToolBoundaries,
    buildToolMeta,
    buildToolSummaryFromMetrics,
    buildHospitalPerformanceRows,
    buildMetricsWithTargets,
    buildProductPerformanceRows,
    normalizeStringArray,
    primitiveExecutors,
    resolveDimensionSelection,
    sortRowsByMetric,
    toPositiveInt,
    trimString,
    uniqueStrings,
  } = helpers;

  async function executeScopeAggregate(args, ctx) {
    const dimension = trimString(args?.dimension) || QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
    if (dimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
      const result = await primitiveExecutors[TOOL_NAMES.GET_PRODUCT_SUMMARY](
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
      const result = await primitiveExecutors[TOOL_NAMES.GET_HOSPITAL_SUMMARY](
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
    const result = await primitiveExecutors[TOOL_NAMES.GET_OVERALL_SUMMARY]({ focus: trimString(args?.focus) }, ctx);
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
    const result = await primitiveExecutors[TOOL_NAMES.GET_TREND_SUMMARY](
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

    if (
      scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT &&
      breakdownDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL
    ) {
      const result = await primitiveExecutors[TOOL_NAMES.GET_PRODUCT_HOSPITAL_CONTRIBUTION](
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
      const result = await primitiveExecutors[TOOL_NAMES.GET_TREND_SUMMARY](
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
    const metrics = await buildMetricsWithTargets(ctx, selection.filteredRecords, windowInfo.month_keys, {
      scopeDimension,
    });
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
          products: scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
          hospitals: scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
        },
        unmatched_entities: {
          products: scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
          hospitals: scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
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
        matched_products: scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.matchedNames : [],
        matched_hospitals: scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.matchedNames : [],
        unmatched_products: scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? selection.unmatchedNames : [],
        unmatched_hospitals: scopeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ? selection.unmatchedNames : [],
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
        await primitiveExecutors[TOOL_NAMES.GET_ANOMALY_INSIGHTS](
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
        await primitiveExecutors[TOOL_NAMES.GET_RISK_OPPORTUNITY_SUMMARY](
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

  return {
    [TOOL_NAMES.SCOPE_AGGREGATE]: executeScopeAggregate,
    [TOOL_NAMES.SCOPE_TIMESERIES]: executeScopeTimeseries,
    [TOOL_NAMES.SCOPE_BREAKDOWN]: executeScopeBreakdown,
    [TOOL_NAMES.SCOPE_DIAGNOSTICS]: executeScopeDiagnostics,
  };
}
