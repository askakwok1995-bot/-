import {
  DATA_AVAILABILITY_CODES,
  QUESTION_JUDGMENT_CODES,
  ROUTE_DECISION_CODES,
  ROUTE_REASON_CODES,
  trimString,
} from "./shared.js";
import {
  buildDirectAnswerDecision,
  collectBoundedAnswerReasons,
  collectNeedMoreDataReasons,
  pushReasonCode,
  toRouteItem,
} from "./routing-rules.js";

export function buildRouteDecision(questionJudgment, dataAvailability, routeHints = {}) {
  const relevanceCode = trimString(questionJudgment?.relevance?.code);

  if (relevanceCode === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT) {
    return {
      route: toRouteItem(ROUTE_DECISION_CODES.REFUSE),
      reason_codes: [ROUTE_REASON_CODES.IRRELEVANT],
    };
  }

  const needMoreDataReasons = collectNeedMoreDataReasons(questionJudgment, dataAvailability, routeHints);
  if (needMoreDataReasons.length > 0) {
    return {
      route: toRouteItem(ROUTE_DECISION_CODES.NEED_MORE_DATA),
      reason_codes: needMoreDataReasons,
    };
  }

  const boundedAnswerReasons = collectBoundedAnswerReasons(dataAvailability);
  if (boundedAnswerReasons.length > 0) {
    return {
      route: toRouteItem(ROUTE_DECISION_CODES.BOUNDED_ANSWER),
      reason_codes: boundedAnswerReasons,
    };
  }

  return buildDirectAnswerDecision();
}

export function forceBoundedRouteDecision(dataAvailability) {
  const reasons = collectBoundedAnswerReasons(dataAvailability);
  if (reasons.length === 0) {
    pushReasonCode(reasons, ROUTE_REASON_CODES.GAP_HINT_NEEDED);
  }
  return {
    route: toRouteItem(ROUTE_DECISION_CODES.BOUNDED_ANSWER),
    reason_codes: reasons,
  };
}
