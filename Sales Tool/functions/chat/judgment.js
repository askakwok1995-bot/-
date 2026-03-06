import {
  FULL_PRODUCT_REQUEST_KEYWORDS,
  HOSPITAL_MONTHLY_DETAIL_KEYWORDS,
  PRODUCT_HOSPITAL_SCOPE_KEYWORDS,
  QUESTION_JUDGMENT_CODES,
  QUESTION_JUDGMENT_LABELS,
  QUESTION_KEYWORDS,
  containsAnyKeyword,
  containsProductDimensionKeyword,
  normalizeQuestionText,
  trimString,
} from "./shared.js";

export function isHospitalMonthlyDetailRequest(message, questionJudgment) {
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  const granularityCode = trimString(questionJudgment?.granularity?.code);
  if (
    primaryDimensionCode !== QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ||
    granularityCode !== QUESTION_JUDGMENT_CODES.granularity.DETAIL
  ) {
    return false;
  }
  const text = normalizeQuestionText(message);
  return Boolean(text) && containsAnyKeyword(text, HOSPITAL_MONTHLY_DETAIL_KEYWORDS);
}

export function isFullProductRequest(message, questionJudgment) {
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  if (primaryDimensionCode !== QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    return false;
  }
  const text = normalizeQuestionText(message);
  return Boolean(text) && containsAnyKeyword(text, FULL_PRODUCT_REQUEST_KEYWORDS);
}

export function isProductHospitalRequest(message, questionJudgment, productNamedRequested) {
  if (!productNamedRequested) {
    return false;
  }
  const relevanceCode = trimString(questionJudgment?.relevance?.code);
  if (relevanceCode !== QUESTION_JUDGMENT_CODES.relevance.RELEVANT) {
    return false;
  }
  const text = normalizeQuestionText(message);
  return Boolean(text) && containsAnyKeyword(text, PRODUCT_HOSPITAL_SCOPE_KEYWORDS);
}

export function judgeRelevance(text) {
  if (containsAnyKeyword(text, QUESTION_KEYWORDS.irrelevant)) {
    return QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT;
  }
  return QUESTION_JUDGMENT_CODES.relevance.RELEVANT;
}

export function judgeGranularity(text) {
  if (containsAnyKeyword(text, QUESTION_KEYWORDS.detail)) {
    return QUESTION_JUDGMENT_CODES.granularity.DETAIL;
  }
  return QUESTION_JUDGMENT_CODES.granularity.SUMMARY;
}

export function judgePrimaryDimension(text, relevanceCode) {
  if (relevanceCode === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.OTHER;
  }
  if (!text) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.OTHER;
  }

  const candidates = [
    QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
    QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
    QUESTION_JUDGMENT_CODES.primary_dimension.TREND,
    QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY,
    QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL,
  ];

  for (const code of candidates) {
    const keywords = QUESTION_KEYWORDS.primary_dimension[code];
    const matched =
      code === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT
        ? containsProductDimensionKeyword(text, keywords)
        : containsAnyKeyword(text, keywords);
    if (matched) {
      return code;
    }
  }
  return QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
}

export function buildQuestionJudgment(message) {
  const text = normalizeQuestionText(message);
  const relevanceCode = judgeRelevance(text);
  const granularityCode = judgeGranularity(text);
  const primaryDimensionCode = judgePrimaryDimension(text, relevanceCode);

  return {
    primary_dimension: {
      code: primaryDimensionCode,
      label: QUESTION_JUDGMENT_LABELS.primary_dimension[primaryDimensionCode],
    },
    granularity: {
      code: granularityCode,
      label: QUESTION_JUDGMENT_LABELS.granularity[granularityCode],
    },
    relevance: {
      code: relevanceCode,
      label: QUESTION_JUDGMENT_LABELS.relevance[relevanceCode],
    },
  };
}

export function buildEffectiveQuestionJudgment(questionJudgment, options = {}) {
  const base = questionJudgment && typeof questionJudgment === "object" ? questionJudgment : null;
  if (!base) {
    return buildQuestionJudgment("");
  }
  if (!options?.productFullRequested && !options?.productHospitalRequested && !options?.productNamedRequested && !options?.hospitalNamedRequested) {
    return base;
  }
  if (options?.productFullRequested) {
    return {
      ...base,
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: QUESTION_JUDGMENT_LABELS.primary_dimension[QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT],
      },
    };
  }
  if (options?.productHospitalRequested) {
    return {
      ...base,
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
        label: QUESTION_JUDGMENT_LABELS.primary_dimension[QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL],
      },
    };
  }
  if (options?.productNamedRequested) {
    return {
      ...base,
      primary_dimension: {
        code: QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT,
        label: QUESTION_JUDGMENT_LABELS.primary_dimension[QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT],
      },
    };
  }
  return {
    ...base,
    primary_dimension: {
      code: QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL,
      label: QUESTION_JUDGMENT_LABELS.primary_dimension[QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL],
    },
  };
}
