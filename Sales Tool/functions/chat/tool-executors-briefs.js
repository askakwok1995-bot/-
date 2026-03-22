export function createBriefExecutors(helpers = {}) {
  const {
    decorateRows,
    decorateTextRows,
    executeAnomalyInsights,
    executeEntityRanking,
    executeHospitalSummary,
    executeOverallSummary,
    executeProductSummary,
    executeRiskOpportunitySummary,
    executeShareBreakdown,
    executeTrendSummary,
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
  } = helpers;

  async function executeSalesOverviewBrief(args, ctx) {
    const safeLimit = toPositiveInt(args?.limit, MACRO_OVERVIEW_DEFAULT_LIMIT, MACRO_SAFE_LIMIT_CAP);
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
          limit: safeLimit,
        },
        ctx,
      ),
      executeHospitalSummary(
        {
          limit: safeLimit,
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
      top_products: decorateRows(products.result.rows, "", safeLimit).map((row) => trimString(row?.product_name)).filter((item) => item),
      top_hospitals: decorateRows(hospitals.result.rows, "", safeLimit).map((row) => trimString(row?.hospital_name)).filter((item) => item),
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
          ...decorateRows(trend.result.rows, "趋势:", safeLimit),
          ...decorateRows(products.result.rows, "产品:", safeLimit),
          ...decorateRows(hospitals.result.rows, "医院:", safeLimit),
          ...decorateTextRows(diagnostics.result.rows.slice(0, Math.min(safeLimit, 4)), {
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
    const safeLimit = toPositiveInt(args?.limit, MACRO_OVERVIEW_DEFAULT_LIMIT, MACRO_SAFE_LIMIT_CAP);
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
          limit: safeLimit,
        },
        ctx,
      ),
      executeAnomalyInsights(
        {
          dimension: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
          limit: safeLimit,
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
          ...decorateRows(trend.result.rows, "趋势:", safeLimit),
          ...decorateRows(breakdown.result.rows, "结构:", safeLimit),
          ...decorateTextRows(diagnostics.result.rows.slice(0, Math.min(safeLimit, 4)), {
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
    const safeLimit = toPositiveInt(args?.limit, MACRO_OVERVIEW_DEFAULT_LIMIT, MACRO_SAFE_LIMIT_CAP);
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
          limit: safeLimit,
        },
        ctx,
      ),
      executeShareBreakdown(
        {
          dimension: safeDimension,
          limit: safeLimit,
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
          ...decorateRows(summaryResult.result.rows, safeDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT ? "产品:" : "医院:", safeLimit),
          ...decorateRows(rankingResult.result.rows, "待关注:", safeLimit, "待关注对象"),
          ...decorateRows(breakdownResult.result.rows, "结构:", safeLimit),
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
    const safeLimit = toPositiveInt(args?.limit, MACRO_REPORT_DEFAULT_LIMIT, MACRO_SAFE_LIMIT_CAP);
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
            limit: safeLimit,
          },
          ctx,
        ),
        executeEntityRanking(
          {
            dimension: safeDimension,
            ranking: "bottom",
            metric: "sales_amount",
            limit: safeLimit,
          },
          ctx,
        ),
        executeShareBreakdown(
          {
            dimension: safeDimension,
            limit: safeLimit,
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
            limit: safeLimit,
          },
          ctx,
        ),
      ]);

    const topEntities = decorateRows(topRankingResult.result.rows, "", safeLimit)
      .map((row) => trimString(row?.product_name || row?.hospital_name || row?.row_label))
      .filter((item) => item);
    const bottomEntities = decorateRows(bottomRankingResult.result.rows, "", safeLimit)
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
          ...decorateRows(trendResult.result.rows, "趋势:", safeLimit),
          ...decorateRows(topRankingResult.result.rows, "Top:", safeLimit, "头部对象"),
          ...decorateRows(bottomRankingResult.result.rows, "待关注:", safeLimit, "待关注对象"),
          ...decorateRows(breakdownResult.result.rows, "结构:", safeLimit),
          ...decorateTextRows(
            [...(Array.isArray(riskResult.result.rows) ? riskResult.result.rows : []), ...(Array.isArray(anomalyResult.result.rows) ? anomalyResult.result.rows : [])].slice(0, safeLimit),
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

  return {
    [TOOL_NAMES.GET_SALES_OVERVIEW_BRIEF]: executeSalesOverviewBrief,
    [TOOL_NAMES.GET_SALES_TREND_BRIEF]: executeSalesTrendBrief,
    [TOOL_NAMES.GET_DIMENSION_OVERVIEW_BRIEF]: executeDimensionOverviewBrief,
    [TOOL_NAMES.GET_DIMENSION_REPORT_BRIEF]: executeDimensionReportBrief,
  };
}
