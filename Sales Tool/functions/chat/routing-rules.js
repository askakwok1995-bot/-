import {
  DATA_AVAILABILITY_CODES,
  QUESTION_JUDGMENT_CODES,
  ROUTE_DECISION_CODES,
  ROUTE_DECISION_LABELS,
  ROUTE_REASON_CODES,
  trimString,
} from "./shared.js";

export function toRouteItem(code) {
  return {
    code,
    label: ROUTE_DECISION_LABELS[code] || "",
  };
}

export function pushReasonCode(reasonCodes, code) {
  if (!Array.isArray(reasonCodes) || !code) {
    return;
  }
  if (!reasonCodes.includes(code)) {
    reasonCodes.push(code);
  }
}

export function collectNeedMoreDataReasons(questionJudgment, dataAvailability, routeHints = {}) {
  const reasonCodes = [];
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

  if (hasBusinessDataCode === DATA_AVAILABILITY_CODES.has_business_data.UNAVAILABLE) {
    pushReasonCode(reasonCodes, ROUTE_REASON_CODES.NO_BUSINESS_DATA);
  }
  if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE) {
    pushReasonCode(reasonCodes, ROUTE_REASON_CODES.DIMENSION_UNAVAILABLE);
  }
  const isDetailRequestedButInsufficient =
    granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL &&
    answerDepthCode !== DATA_AVAILABILITY_CODES.answer_depth.DETAILED &&
    gapHintNeededCode === DATA_AVAILABILITY_CODES.gap_hint_needed.YES;
  if (isDetailRequestedButInsufficient) {
    pushReasonCode(reasonCodes, ROUTE_REASON_CODES.DETAIL_REQUESTED_BUT_INSUFFICIENT);
  }
  if (productHospitalRequested && productHospitalSupportCode !== "full") {
    pushReasonCode(reasonCodes, ROUTE_REASON_CODES.PRODUCT_HOSPITAL_SCOPE_INSUFFICIENT);
  }
  if (productFullRequested && dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL) {
    pushReasonCode(reasonCodes, ROUTE_REASON_CODES.PRODUCT_FULL_SCOPE_INSUFFICIENT);
  }
  if (productNamedRequested && !productHospitalRequested && productNamedSupportCode !== "full") {
    pushReasonCode(reasonCodes, ROUTE_REASON_CODES.PRODUCT_NAMED_SCOPE_INSUFFICIENT);
  }
  if (hospitalNamedRequested && hospitalNamedSupportCode !== "full") {
    pushReasonCode(reasonCodes, ROUTE_REASON_CODES.HOSPITAL_NAMED_SCOPE_INSUFFICIENT);
  }

  return reasonCodes;
}

export function collectBoundedAnswerReasons(dataAvailability) {
  const reasonCodes = [];
  const dimensionAvailabilityCode = trimString(dataAvailability?.dimension_availability?.code);
  const gapHintNeededCode = trimString(dataAvailability?.gap_hint_needed?.code);
  if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL) {
    pushReasonCode(reasonCodes, ROUTE_REASON_CODES.DIMENSION_PARTIAL);
  }
  if (gapHintNeededCode === DATA_AVAILABILITY_CODES.gap_hint_needed.YES) {
    pushReasonCode(reasonCodes, ROUTE_REASON_CODES.GAP_HINT_NEEDED);
  }
  return reasonCodes;
}

export function buildDirectAnswerDecision() {
  return {
    route: toRouteItem(ROUTE_DECISION_CODES.DIRECT_ANSWER),
    reason_codes: [ROUTE_REASON_CODES.SUFFICIENT],
  };
}
