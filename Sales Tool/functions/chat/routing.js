import {
  DATA_AVAILABILITY_CODES,
  QUESTION_JUDGMENT_CODES,
  ROUTE_DECISION_CODES,
  ROUTE_DECISION_LABELS,
  ROUTE_REASON_CODES,
  trimString,
} from "./shared.js";

function toRouteItem(code) {
  return {
    code,
    label: ROUTE_DECISION_LABELS[code] || "",
  };
}

function pushReasonCode(reasonCodes, code) {
  if (!Array.isArray(reasonCodes) || !code) {
    return;
  }
  if (!reasonCodes.includes(code)) {
    reasonCodes.push(code);
  }
}

export function buildRouteDecision(questionJudgment, dataAvailability, routeHints = {}) {
  const relevanceCode = trimString(questionJudgment?.relevance?.code);
  const granularityCode = trimString(questionJudgment?.granularity?.code);
  const hasBusinessDataCode = trimString(dataAvailability?.has_business_data?.code);
  const dimensionAvailabilityCode = trimString(dataAvailability?.dimension_availability?.code);
  const answerDepthCode = trimString(dataAvailability?.answer_depth?.code);
  const gapHintNeededCode = trimString(dataAvailability?.gap_hint_needed?.code);
  const productHospitalRequested = Boolean(routeHints?.productHospitalRequested);
  const productHospitalSupportCode = trimString(dataAvailability?.product_hospital_support);
  const hospitalNamedRequested = Boolean(routeHints?.hospitalNamedRequested);
  const hospitalNamedSupportCode = trimString(dataAvailability?.hospital_named_support);
  const productFullRequested = Boolean(routeHints?.productFullRequested);
  const productNamedRequested = Boolean(routeHints?.productNamedRequested);
  const productNamedSupportCode = trimString(dataAvailability?.product_named_support);

  if (relevanceCode === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT) {
    return {
      route: toRouteItem(ROUTE_DECISION_CODES.REFUSE),
      reason_codes: [ROUTE_REASON_CODES.IRRELEVANT],
    };
  }

  const needMoreDataReasons = [];
  if (hasBusinessDataCode === DATA_AVAILABILITY_CODES.has_business_data.UNAVAILABLE) {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.NO_BUSINESS_DATA);
  }
  if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE) {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.DIMENSION_UNAVAILABLE);
  }
  const isDetailRequestedButInsufficient =
    granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL &&
    answerDepthCode !== DATA_AVAILABILITY_CODES.answer_depth.DETAILED &&
    gapHintNeededCode === DATA_AVAILABILITY_CODES.gap_hint_needed.YES;
  if (isDetailRequestedButInsufficient) {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.DETAIL_REQUESTED_BUT_INSUFFICIENT);
  }
  if (productHospitalRequested && productHospitalSupportCode !== "full") {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.PRODUCT_HOSPITAL_SCOPE_INSUFFICIENT);
  }
  if (productFullRequested && dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL) {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.PRODUCT_FULL_SCOPE_INSUFFICIENT);
  }
  if (productNamedRequested && !productHospitalRequested && productNamedSupportCode !== "full") {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.PRODUCT_NAMED_SCOPE_INSUFFICIENT);
  }
  if (hospitalNamedRequested && hospitalNamedSupportCode !== "full") {
    pushReasonCode(needMoreDataReasons, ROUTE_REASON_CODES.HOSPITAL_NAMED_SCOPE_INSUFFICIENT);
  }
  if (needMoreDataReasons.length > 0) {
    return {
      route: toRouteItem(ROUTE_DECISION_CODES.NEED_MORE_DATA),
      reason_codes: needMoreDataReasons,
    };
  }

  const boundedAnswerReasons = [];
  if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL) {
    pushReasonCode(boundedAnswerReasons, ROUTE_REASON_CODES.DIMENSION_PARTIAL);
  }
  if (gapHintNeededCode === DATA_AVAILABILITY_CODES.gap_hint_needed.YES) {
    pushReasonCode(boundedAnswerReasons, ROUTE_REASON_CODES.GAP_HINT_NEEDED);
  }
  if (boundedAnswerReasons.length > 0) {
    return {
      route: toRouteItem(ROUTE_DECISION_CODES.BOUNDED_ANSWER),
      reason_codes: boundedAnswerReasons,
    };
  }

  return {
    route: toRouteItem(ROUTE_DECISION_CODES.DIRECT_ANSWER),
    reason_codes: [ROUTE_REASON_CODES.SUFFICIENT],
  };
}

export function forceBoundedRouteDecision(dataAvailability) {
  const reasons = [];
  if (trimString(dataAvailability?.dimension_availability?.code) === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL) {
    pushReasonCode(reasons, ROUTE_REASON_CODES.DIMENSION_PARTIAL);
  }
  if (trimString(dataAvailability?.gap_hint_needed?.code) === DATA_AVAILABILITY_CODES.gap_hint_needed.YES) {
    pushReasonCode(reasons, ROUTE_REASON_CODES.GAP_HINT_NEEDED);
  }
  if (reasons.length === 0) {
    pushReasonCode(reasons, ROUTE_REASON_CODES.GAP_HINT_NEEDED);
  }
  return {
    route: toRouteItem(ROUTE_DECISION_CODES.BOUNDED_ANSWER),
    reason_codes: reasons,
  };
}
