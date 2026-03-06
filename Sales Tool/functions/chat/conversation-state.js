import { QUESTION_JUDGMENT_CODES, formatYm, parseYm, trimString } from "./shared.js";

function createEmptyRequestedTimeWindow() {
  return {
    kind: "none",
    label: "",
    start_month: "",
    end_month: "",
    period: "",
    anchor_mode: "none",
  };
}

function cloneRequestedTimeWindow(value) {
  const safeValue = value && typeof value === "object" ? value : {};
  return {
    kind: trimString(safeValue.kind) || "none",
    label: trimString(safeValue.label),
    start_month: trimString(safeValue.start_month),
    end_month: trimString(safeValue.end_month),
    period: trimString(safeValue.period),
    anchor_mode: trimString(safeValue.anchor_mode) || "none",
  };
}

function normalizeStringArray(value, maxItems = 10) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => trimString(item))
    .filter((item) => item)
    .slice(0, maxItems);
}

function parseQuarterFromLabel(label) {
  const matched = trimString(label).toUpperCase().replace(/\s+/g, "").match(/Q([1-4])|([1-4])季度|第([一二三四])季度|([一二三四])季度/u);
  if (!matched) {
    return null;
  }
  if (matched[1] || matched[2]) {
    return Number(matched[1] || matched[2]);
  }
  const mapping = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
  };
  return mapping[matched[3] || matched[4]] || null;
}

function buildQuarterWindowWithYear(label, year) {
  const quarter = parseQuarterFromLabel(label);
  if (!Number.isInteger(year) || !Number.isInteger(quarter)) {
    return createEmptyRequestedTimeWindow();
  }
  const startMonth = formatYm(year, (quarter - 1) * 3 + 1);
  const endMonth = formatYm(year, quarter * 3);
  return {
    kind: "absolute",
    label: trimString(label) || `Q${quarter}`,
    start_month: startMonth,
    end_month: endMonth,
    period: `${startMonth}~${endMonth}`,
    anchor_mode: "conversation_state",
  };
}

function resolveWindowYear(windowInfo) {
  const startMonth = trimString(windowInfo?.start_month);
  const parsed = parseYm(startMonth);
  return parsed ? parsed.year : null;
}

function hasConcreteTimeWindow(windowInfo) {
  return Boolean(trimString(windowInfo?.period) && trimString(windowInfo?.start_month) && trimString(windowInfo?.end_month));
}

function maybeAnchorAmbiguousQuarter(currentWindow, previousWindow) {
  const safeCurrent = cloneRequestedTimeWindow(currentWindow);
  if (safeCurrent.kind !== "absolute" || safeCurrent.anchor_mode !== "none" || safeCurrent.period) {
    return safeCurrent;
  }
  const previousYear = resolveWindowYear(previousWindow);
  if (!Number.isInteger(previousYear)) {
    return safeCurrent;
  }
  const anchoredWindow = buildQuarterWindowWithYear(safeCurrent.label, previousYear);
  return anchoredWindow.period ? anchoredWindow : safeCurrent;
}

export function createEmptyConversationState() {
  return {
    primary_dimension_code: "",
    requested_time_window: createEmptyRequestedTimeWindow(),
    comparison_time_window: createEmptyRequestedTimeWindow(),
    time_compare_mode: "none",
    entity_scope: {
      products: [],
      hospitals: [],
    },
    route_code: "",
    source_period: "",
  };
}

export function normalizeConversationState(value) {
  const safeValue = value && typeof value === "object" ? value : {};
  const entityScope = safeValue.entity_scope && typeof safeValue.entity_scope === "object" ? safeValue.entity_scope : {};
  return {
    primary_dimension_code: trimString(safeValue.primary_dimension_code),
    requested_time_window: cloneRequestedTimeWindow(safeValue.requested_time_window),
    comparison_time_window: cloneRequestedTimeWindow(safeValue.comparison_time_window),
    time_compare_mode: trimString(safeValue.time_compare_mode) || "none",
    entity_scope: {
      products: normalizeStringArray(entityScope.products),
      hospitals: normalizeStringArray(entityScope.hospitals),
    },
    route_code: trimString(safeValue.route_code),
    source_period: trimString(safeValue.source_period),
  };
}

function shouldInheritPrimaryDimension(sessionState, currentDimensionCode, previousDimensionCode) {
  if (!sessionState?.inherit_primary_dimension || !previousDimensionCode) {
    return false;
  }
  return (
    currentDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL ||
    currentDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.OTHER
  );
}

export function resolveConversationContext({
  conversationState,
  sessionState,
  questionJudgment,
  requestedTimeWindow,
  comparisonTimeWindow,
  timeCompareMode = "none",
} = {}) {
  const previousState = normalizeConversationState(conversationState);
  let nextRequestedTimeWindow = cloneRequestedTimeWindow(requestedTimeWindow);
  let nextComparisonTimeWindow = cloneRequestedTimeWindow(comparisonTimeWindow);
  let nextTimeCompareMode = trimString(timeCompareMode) || "none";

  if (sessionState?.inherit_scope) {
    if (!hasConcreteTimeWindow(nextRequestedTimeWindow) && hasConcreteTimeWindow(previousState.requested_time_window)) {
      nextRequestedTimeWindow = cloneRequestedTimeWindow(previousState.requested_time_window);
    }
    if (!hasConcreteTimeWindow(nextComparisonTimeWindow) && hasConcreteTimeWindow(previousState.comparison_time_window)) {
      nextComparisonTimeWindow = cloneRequestedTimeWindow(previousState.comparison_time_window);
    }
    if (nextTimeCompareMode === "none" && trimString(previousState.time_compare_mode) !== "none") {
      nextTimeCompareMode = trimString(previousState.time_compare_mode);
    }
  }

  nextRequestedTimeWindow = maybeAnchorAmbiguousQuarter(nextRequestedTimeWindow, previousState.requested_time_window);
  nextComparisonTimeWindow = maybeAnchorAmbiguousQuarter(nextComparisonTimeWindow, previousState.comparison_time_window);

  const currentDimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  const primaryDimensionCode = shouldInheritPrimaryDimension(
    sessionState,
    currentDimensionCode,
    previousState.primary_dimension_code,
  )
    ? previousState.primary_dimension_code
    : currentDimensionCode;

  return {
    conversationState: previousState,
    primary_dimension_code: primaryDimensionCode,
    requested_time_window: nextRequestedTimeWindow,
    comparison_time_window: nextComparisonTimeWindow,
    time_compare_mode: nextTimeCompareMode,
  };
}

export function resolveConversationEntityScope({
  conversationState,
  sessionState,
  requestedProducts,
  requestedHospitals,
  productNamedRequested,
  hospitalNamedRequested,
} = {}) {
  const previousState = normalizeConversationState(conversationState);
  let nextRequestedProducts = Array.isArray(requestedProducts) ? requestedProducts.slice(0, 10) : [];
  let nextRequestedHospitals = Array.isArray(requestedHospitals) ? requestedHospitals.slice(0, 10) : [];
  let nextProductNamedRequested = Boolean(productNamedRequested);
  let nextHospitalNamedRequested = Boolean(hospitalNamedRequested);

  if (sessionState?.inherit_scope) {
    if (nextRequestedProducts.length === 0 && previousState.entity_scope.products.length > 0) {
      nextRequestedProducts = previousState.entity_scope.products.map((productName) => ({
        product_name: productName,
        lookup_key: productName,
      }));
      nextProductNamedRequested = true;
    }
    if (nextRequestedHospitals.length === 0 && previousState.entity_scope.hospitals.length > 0) {
      nextRequestedHospitals = previousState.entity_scope.hospitals.map((hospitalName) => ({
        mention_name: hospitalName,
        mention_key: hospitalName,
      }));
      nextHospitalNamedRequested = true;
    }
  }

  return {
    requested_products: nextRequestedProducts,
    requested_hospitals: nextRequestedHospitals,
    product_named_requested: nextProductNamedRequested,
    hospital_named_requested: nextHospitalNamedRequested,
  };
}

function normalizeEntityScopeNames(requestedProducts, requestedHospitals) {
  const products = normalizeStringArray(
    (Array.isArray(requestedProducts) ? requestedProducts : []).map((item) => item?.product_name || item),
  );
  const hospitals = normalizeStringArray(
    (Array.isArray(requestedHospitals) ? requestedHospitals : []).map((item) => item?.mention_name || item?.name || item),
  );
  return { products, hospitals };
}

export function buildConversationState({
  questionJudgment,
  requestedTimeWindow,
  comparisonTimeWindow,
  timeCompareMode = "none",
  requestedProducts,
  requestedHospitals,
  routeDecision,
  outputContext,
} = {}) {
  const entityScope = normalizeEntityScopeNames(requestedProducts, requestedHospitals);
  const sourcePeriod =
    trimString(outputContext?.requested_time_window_period) ||
    trimString(outputContext?.tool_result_primary_period) ||
    trimString(outputContext?.available_time_window_period) ||
    trimString(outputContext?.comparison_time_window_period);
  return {
    primary_dimension_code: trimString(outputContext?.primary_dimension_code) || trimString(questionJudgment?.primary_dimension?.code),
    requested_time_window: cloneRequestedTimeWindow(requestedTimeWindow),
    comparison_time_window: cloneRequestedTimeWindow(comparisonTimeWindow),
    time_compare_mode: trimString(timeCompareMode) || "none",
    entity_scope: entityScope,
    route_code: trimString(routeDecision?.route?.code) || trimString(outputContext?.route_code),
    source_period: sourcePeriod,
  };
}
