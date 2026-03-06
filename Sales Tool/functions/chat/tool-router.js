import { trimString } from "./shared.js";
import { TOOL_NAMES } from "./tool-registry.js";

function buildNoMatchRoute() {
  return {
    matched: false,
    route_type: "none",
    tool_name: "",
    tool_args: {},
  };
}

function normalizeRequestedProductNames(productNamedContext) {
  const requestedProducts = Array.isArray(productNamedContext?.requestedProducts)
    ? productNamedContext.requestedProducts
    : [];
  return requestedProducts.map((item) => trimString(item?.product_name)).filter((item) => item);
}

function normalizeRequestedHospitalNames(hospitalNamedContext) {
  const requestedHospitals = Array.isArray(hospitalNamedContext?.requestedHospitals)
    ? hospitalNamedContext.requestedHospitals
    : [];
  return requestedHospitals.map((item) => trimString(item?.mention_name)).filter((item) => item);
}

export function buildDeterministicToolRoute({
  message,
  questionJudgment,
  requestedTimeWindow,
  comparisonTimeWindow,
  timeCompareMode = "none",
  primaryWindowCoverageCode = "",
  comparisonWindowCoverageCode = "",
  productFullRequested,
  hospitalMonthlyDetailRequested,
  productNamedContext,
  hospitalNamedContext,
  productHospitalContext,
} = {}) {
  const productNames = normalizeRequestedProductNames(productNamedContext);
  const hospitalNames = normalizeRequestedHospitalNames(hospitalNamedContext);
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  const requestedTimeWindowKind = trimString(requestedTimeWindow?.kind);
  const comparisonTimeWindowKind = trimString(comparisonTimeWindow?.kind);
  const normalizedTimeCompareMode = trimString(timeCompareMode);
  const primaryCoverageCode = trimString(primaryWindowCoverageCode);
  const comparisonCoverage = trimString(comparisonWindowCoverageCode);

  if (Boolean(productHospitalContext?.productHospitalRequested) && productNames.length > 0) {
    return {
      matched: true,
      route_type: "product_hospital",
      tool_name: TOOL_NAMES.GET_PRODUCT_HOSPITAL_CONTRIBUTION,
      tool_args: {
        product_names: productNames,
        limit: 10,
      },
    };
  }

  if (Boolean(hospitalMonthlyDetailRequested)) {
    return {
      matched: true,
      route_type: "hospital_monthly",
      tool_name: TOOL_NAMES.GET_HOSPITAL_SUMMARY,
      tool_args: {
        include_monthly: true,
        limit: 10,
      },
    };
  }

  if (Boolean(productFullRequested)) {
    return {
      matched: true,
      route_type: "product_full",
      tool_name: TOOL_NAMES.GET_PRODUCT_SUMMARY,
      tool_args: {
        include_all_products: true,
        limit: 50,
      },
    };
  }

  if (Boolean(hospitalNamedContext?.hospitalNamedRequested) && hospitalNames.length > 0) {
    return {
      matched: true,
      route_type: "hospital_named",
      tool_name: TOOL_NAMES.GET_HOSPITAL_SUMMARY,
      tool_args: {
        hospital_names: hospitalNames,
        limit: 10,
      },
    };
  }

  if (
    normalizedTimeCompareMode === "quarter_compare" &&
    (primaryDimensionCode === "overall" || primaryDimensionCode === "trend") &&
    requestedTimeWindowKind !== "none" &&
    comparisonTimeWindowKind !== "none" &&
    primaryCoverageCode === "full" &&
    comparisonCoverage === "full"
  ) {
    return {
      matched: true,
      route_type: "overall_period_compare",
      tool_name: TOOL_NAMES.GET_PERIOD_COMPARISON_SUMMARY,
      tool_args: {
        primary_start_month: trimString(requestedTimeWindow?.start_month),
        primary_end_month: trimString(requestedTimeWindow?.end_month),
        comparison_start_month: trimString(comparisonTimeWindow?.start_month),
        comparison_end_month: trimString(comparisonTimeWindow?.end_month),
        dimension: "overall",
      },
    };
  }

  if (
    requestedTimeWindowKind !== "none" &&
    (primaryDimensionCode === "overall" || primaryDimensionCode === "trend")
  ) {
    const useTrendTool = primaryDimensionCode === "trend";
    return {
      matched: true,
      route_type: "overall_time_window",
      tool_name: useTrendTool ? TOOL_NAMES.GET_TREND_SUMMARY : TOOL_NAMES.GET_OVERALL_SUMMARY,
      tool_args: useTrendTool
        ? {
            dimension: "overall",
            granularity: "monthly",
          }
        : {},
    };
  }

  return buildNoMatchRoute();
}
