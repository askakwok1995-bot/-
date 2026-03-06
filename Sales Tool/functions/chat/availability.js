import {
  DATA_AVAILABILITY_CODES,
  DATA_AVAILABILITY_LABELS,
  QUESTION_JUDGMENT_CODES,
  formatPercentText,
  formatAmountWanText,
  formatQuantityBoxText,
  formatDeltaPercentText,
  hasEffectiveArrayContent,
  hasEffectiveObjectContent,
  isEffectiveScalar,
  normalizeBusinessSnapshot,
  normalizeHospitalAliasKey,
  normalizeHospitalNameForMatch,
  normalizeNumericValue,
  normalizeProductNameForMatch,
  trimString,
} from "./shared.js";

function toDataAvailabilityItem(groupKey, code) {
  const labels = DATA_AVAILABILITY_LABELS[groupKey] || {};
  return {
    code,
    label: labels[code] || "",
  };
}

function hasEffectiveSnapshotField(snapshot, fieldName) {
  const value = snapshot?.[fieldName];
  if (Array.isArray(value)) {
    return hasEffectiveArrayContent(value);
  }
  if (value && typeof value === "object") {
    return hasEffectiveObjectContent(value);
  }
  return isEffectiveScalar(value, fieldName);
}

function hasEffectiveBusinessContent(snapshot) {
  const businessFields = [
    "performance_overview",
    "key_business_signals",
    "product_performance",
    "hospital_performance",
    "recent_trends",
    "risk_alerts",
    "opportunity_hints",
  ];
  return businessFields.some((fieldName) => hasEffectiveSnapshotField(snapshot, fieldName));
}

export function judgeBusinessDataAvailability(snapshot) {
  const hasBusinessData = hasEffectiveBusinessContent(snapshot);
  const code = hasBusinessData
    ? DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE
    : DATA_AVAILABILITY_CODES.has_business_data.UNAVAILABLE;
  return toDataAvailabilityItem("has_business_data", code);
}

export function resolveProductCoverageCode(catalogCountValue, snapshotCountValue) {
  const catalogCount = normalizeNumericValue(catalogCountValue);
  const snapshotCount = normalizeNumericValue(snapshotCountValue);
  const safeCatalogCount = catalogCount === null ? 0 : Math.max(0, Math.floor(catalogCount));
  const safeSnapshotCount = snapshotCount === null ? 0 : Math.max(0, Math.floor(snapshotCount));
  if (safeCatalogCount > 0 && safeSnapshotCount >= safeCatalogCount) {
    return "full";
  }
  if (safeSnapshotCount > 0) {
    return "partial";
  }
  return "none";
}

export function resolveProductFullSupportCode(snapshot) {
  const overview = snapshot?.performance_overview;
  const coverageCode = trimString(overview?.product_coverage_code).toLocaleLowerCase();
  if (coverageCode === "full" || coverageCode === "partial" || coverageCode === "none") {
    return coverageCode;
  }
  const catalogCountValue = normalizeNumericValue(overview?.product_catalog_count_value);
  const rows = Array.isArray(snapshot?.product_performance) ? snapshot.product_performance : [];
  const fallbackSnapshotCount = rows.length;
  const snapshotCountValue = normalizeNumericValue(overview?.product_snapshot_count_value);
  return resolveProductCoverageCode(
    catalogCountValue === null ? 0 : catalogCountValue,
    snapshotCountValue === null ? fallbackSnapshotCount : snapshotCountValue,
  );
}

export function resolveProductNamedSupportCode(snapshot, requestedProducts) {
  const targets = Array.isArray(requestedProducts) ? requestedProducts : [];
  if (targets.length === 0) {
    return "none";
  }

  const rows = Array.isArray(snapshot?.product_performance) ? snapshot.product_performance : [];
  if (rows.length === 0) {
    return "none";
  }

  const rowProductIds = new Set();
  const rowLookupKeys = new Set();
  rows.forEach((row) => {
    const productId = trimString(row?.product_code);
    if (productId) {
      rowProductIds.add(productId);
    }
    const lookupKey = normalizeProductNameForMatch(row?.product_name);
    if (lookupKey) {
      rowLookupKeys.add(lookupKey);
    }
  });

  let matchedCount = 0;
  const dedupeTargets = new Set();
  targets.forEach((target) => {
    const productId = trimString(target?.product_id);
    const lookupKey = normalizeProductNameForMatch(target?.lookup_key || target?.product_name);
    const dedupeKey = productId || lookupKey;
    if (!dedupeKey || dedupeTargets.has(dedupeKey)) {
      return;
    }
    dedupeTargets.add(dedupeKey);
    if ((productId && rowProductIds.has(productId)) || (lookupKey && rowLookupKeys.has(lookupKey))) {
      matchedCount += 1;
    }
  });

  const targetCount = dedupeTargets.size;
  if (targetCount === 0) {
    return "none";
  }
  if (matchedCount >= targetCount) {
    return "full";
  }
  if (matchedCount > 0) {
    return "partial";
  }
  return "none";
}

export function resolveProductHospitalSupportCode(snapshot) {
  const overview = snapshot?.performance_overview;
  const supportCode = trimString(overview?.product_hospital_support_code).toLocaleLowerCase();
  if (supportCode === "full" || supportCode === "partial" || supportCode === "none") {
    return supportCode;
  }
  return "none";
}

export function resolveHospitalMonthlySupportCode(snapshot) {
  const rows = Array.isArray(snapshot?.hospital_performance) ? snapshot.hospital_performance : [];
  if (rows.length === 0) {
    return "none";
  }
  let hasPartial = false;
  for (const row of rows) {
    const code = trimString(row?.monthly_coverage_code).toLocaleLowerCase();
    if (code === "full") {
      return "full";
    }
    if (code === "partial") {
      hasPartial = true;
    }
  }
  return hasPartial ? "partial" : "none";
}

function buildHospitalNamedCandidates(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  return sourceRows
    .map((row) => {
      const name = trimString(row?.hospital_name || row?.name);
      const fullKey = normalizeHospitalNameForMatch(name);
      const aliasKey = normalizeHospitalAliasKey(name);
      if (!name || !fullKey) {
        return null;
      }
      return {
        name,
        full_key: fullKey,
        alias_key: aliasKey,
      };
    })
    .filter((item) => item !== null);
}

function resolveHospitalNamedMatches(requestedHospitals, candidateRows) {
  const requested = Array.isArray(requestedHospitals) ? requestedHospitals : [];
  const candidates = Array.isArray(candidateRows) ? candidateRows : [];
  if (requested.length === 0 || candidates.length === 0) {
    return [];
  }

  const resolved = [];
  const usedCandidates = new Set();
  requested.forEach((requestItem) => {
    const mentionKey = normalizeHospitalNameForMatch(requestItem?.mention_key || requestItem?.mention_name);
    const mentionAliasKey = normalizeHospitalAliasKey(requestItem?.mention_alias_key || requestItem?.mention_name);
    if (!mentionKey || mentionKey.length < 2) {
      return;
    }

    const exactMatches = candidates.filter((candidate) => {
      return candidate.full_key === mentionKey || (mentionAliasKey && candidate.alias_key && candidate.alias_key === mentionAliasKey);
    });

    let selected = null;
    if (exactMatches.length === 1) {
      selected = exactMatches[0];
    } else if (exactMatches.length === 0) {
      const fuzzyMatches = candidates.filter((candidate) => {
        if (candidate.full_key.includes(mentionKey)) {
          return true;
        }
        if (mentionAliasKey && candidate.alias_key && candidate.alias_key.includes(mentionAliasKey)) {
          return true;
        }
        if (mentionAliasKey && candidate.alias_key && mentionAliasKey.includes(candidate.alias_key) && candidate.alias_key.length >= 2) {
          return true;
        }
        return false;
      });
      if (fuzzyMatches.length === 1) {
        selected = fuzzyMatches[0];
      }
    }

    if (!selected) {
      return;
    }
    const dedupeKey = selected.full_key;
    if (usedCandidates.has(dedupeKey)) {
      return;
    }
    usedCandidates.add(dedupeKey);
    resolved.push(selected);
  });

  return resolved;
}

export function resolveHospitalNamedSupportCode(snapshot, requestedHospitals) {
  const requested = Array.isArray(requestedHospitals) ? requestedHospitals : [];
  if (requested.length === 0) {
    return "none";
  }
  const rows = Array.isArray(snapshot?.hospital_performance) ? snapshot.hospital_performance : [];
  if (rows.length === 0) {
    return "none";
  }
  const candidates = buildHospitalNamedCandidates(rows);
  const resolved = resolveHospitalNamedMatches(requested, candidates);
  if (resolved.length >= requested.length) {
    return "full";
  }
  if (resolved.length > 0) {
    return "partial";
  }
  return "none";
}

function judgeDimensionAvailability(snapshot, questionJudgment, hasBusinessDataCode, options = {}) {
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  const productHospitalRequested = Boolean(options?.productHospitalRequested);
  const hospitalNamedRequested = Boolean(options?.hospitalNamedRequested);
  const requestedHospitals = Array.isArray(options?.requestedHospitals) ? options.requestedHospitals : [];
  const productFullRequested = Boolean(options?.productFullRequested);
  const productNamedRequested = Boolean(options?.productNamedRequested);
  const requestedProducts = Array.isArray(options?.requestedProducts) ? options.requestedProducts : [];

  const normalizedSnapshot = normalizeBusinessSnapshot(snapshot);
  const hasPerformanceOverview = hasEffectiveSnapshotField(normalizedSnapshot, "performance_overview");
  const hasKeyBusinessSignals = hasEffectiveSnapshotField(normalizedSnapshot, "key_business_signals");
  const hasProductPerformance = hasEffectiveSnapshotField(normalizedSnapshot, "product_performance");
  const hasHospitalPerformance = hasEffectiveSnapshotField(normalizedSnapshot, "hospital_performance");
  const hasRecentTrends = hasEffectiveSnapshotField(normalizedSnapshot, "recent_trends");
  const hasRiskAlerts = hasEffectiveSnapshotField(normalizedSnapshot, "risk_alerts");
  const hasOpportunityHints = hasEffectiveSnapshotField(normalizedSnapshot, "opportunity_hints");

  let code = DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
  switch (primaryDimensionCode) {
    case QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL: {
      if (hasPerformanceOverview && (hasKeyBusinessSignals || hasRecentTrends)) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
      } else if (hasPerformanceOverview || hasKeyBusinessSignals || hasRecentTrends) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
      }
      break;
    }
    case QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT: {
      if (productFullRequested) {
        const productSupportCode = resolveProductFullSupportCode(normalizedSnapshot);
        if (productSupportCode === "full") {
          code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
        } else if (productSupportCode === "partial") {
          code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
        } else {
          code = DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
        }
      } else if (productNamedRequested) {
        const productNamedSupportCode = resolveProductNamedSupportCode(normalizedSnapshot, requestedProducts);
        if (productNamedSupportCode === "full") {
          code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
        } else if (productNamedSupportCode === "partial") {
          code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
        } else {
          code = DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
        }
      } else if (hasProductPerformance) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
      } else if (hasKeyBusinessSignals || hasRecentTrends) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
      }
      break;
    }
    case QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL: {
      if (productHospitalRequested) {
        const productHospitalSupportCode = resolveProductHospitalSupportCode(normalizedSnapshot);
        if (productHospitalSupportCode === "full") {
          code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
        } else if (productHospitalSupportCode === "partial") {
          code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
        } else {
          code = DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
        }
      } else if (hospitalNamedRequested) {
        const hospitalNamedSupportCode = resolveHospitalNamedSupportCode(normalizedSnapshot, requestedHospitals);
        if (hospitalNamedSupportCode === "full") {
          code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
        } else if (hospitalNamedSupportCode === "partial") {
          code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
        } else {
          code = DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
        }
      } else {
        code = hasHospitalPerformance
          ? DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE
          : DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
      }
      break;
    }
    case QUESTION_JUDGMENT_CODES.primary_dimension.TREND: {
      if (hasRecentTrends) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
      } else if (hasPerformanceOverview || hasKeyBusinessSignals) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
      }
      break;
    }
    case QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY: {
      if (hasRiskAlerts || hasOpportunityHints) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.AVAILABLE;
      } else if (hasKeyBusinessSignals) {
        code = DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL;
      }
      break;
    }
    default: {
      code =
        hasBusinessDataCode === DATA_AVAILABILITY_CODES.has_business_data.AVAILABLE
          ? DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL
          : DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE;
    }
  }

  return toDataAvailabilityItem("dimension_availability", code);
}

function getGranularityCode(questionJudgment) {
  const code = trimString(questionJudgment?.granularity?.code);
  return code === QUESTION_JUDGMENT_CODES.granularity.DETAIL
    ? QUESTION_JUDGMENT_CODES.granularity.DETAIL
    : QUESTION_JUDGMENT_CODES.granularity.SUMMARY;
}

function countObjectRowsWithAnyEffectiveKeys(rows, keys) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }
  return rows.filter((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return false;
    }
    return keys.some((key) => isEffectiveScalar(row[key], key));
  }).length;
}

function hasDetailedSupport(snapshot, primaryDimensionCode, options = {}) {
  const hospitalMonthlyDetailRequested = Boolean(options?.hospitalMonthlyDetailRequested);
  if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    const rows = Array.isArray(snapshot?.product_performance) ? snapshot.product_performance : [];
    if (rows.length < 2) return false;
    return countObjectRowsWithAnyEffectiveKeys(rows, ["sales_amount_value", "sales_share_ratio", "change_value_ratio"]) >= 2;
  }

  if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.TREND) {
    const rows = Array.isArray(snapshot?.recent_trends) ? snapshot.recent_trends : [];
    if (rows.length < 3) return false;
    const amountSupportCount = countObjectRowsWithAnyEffectiveKeys(rows, ["sales_amount_value"]);
    const momSupportCount = countObjectRowsWithAnyEffectiveKeys(rows, ["amount_mom_ratio"]);
    return amountSupportCount >= 2 && momSupportCount >= 1;
  }

  if (primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    const rows = Array.isArray(snapshot?.hospital_performance) ? snapshot.hospital_performance : [];
    if (rows.length < 2) return false;
    if (hospitalMonthlyDetailRequested) {
      const supportedRows = rows.filter((row) => {
        const points = Array.isArray(row?.monthly_points) ? row.monthly_points : [];
        const pointSupportCount = countObjectRowsWithAnyEffectiveKeys(points, [
          "sales_amount_value",
          "sales_volume_value",
          "amount_mom_ratio",
        ]);
        const coverageCode = trimString(row?.monthly_coverage_code).toLocaleLowerCase();
        const coverageRatio = normalizeNumericValue(row?.monthly_coverage_ratio);
        const hasCoverage = coverageCode === "full" || (coverageRatio !== null && coverageRatio >= 0.6);
        return pointSupportCount >= 3 && hasCoverage;
      });
      return supportedRows.length >= 1;
    }
    return countObjectRowsWithAnyEffectiveKeys(rows, ["sales_amount_value", "sales_share_ratio", "change_value_ratio", "amount_yoy_ratio"]) >= 2;
  }

  return false;
}

function judgeAnswerDepth(questionJudgment, dimensionAvailabilityCode, snapshot, options = {}) {
  const granularityCode = getGranularityCode(questionJudgment);
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);

  let code = DATA_AVAILABILITY_CODES.answer_depth.OVERALL;
  if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE) {
    code = DATA_AVAILABILITY_CODES.answer_depth.OVERALL;
  } else if (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL) {
    code =
      granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL
        ? DATA_AVAILABILITY_CODES.answer_depth.OVERALL
        : DATA_AVAILABILITY_CODES.answer_depth.FOCUSED;
  } else if (granularityCode === QUESTION_JUDGMENT_CODES.granularity.SUMMARY) {
    code = DATA_AVAILABILITY_CODES.answer_depth.FOCUSED;
  } else {
    code = hasDetailedSupport(snapshot, primaryDimensionCode, options)
      ? DATA_AVAILABILITY_CODES.answer_depth.DETAILED
      : DATA_AVAILABILITY_CODES.answer_depth.FOCUSED;
  }

  return toDataAvailabilityItem("answer_depth", code);
}

function getAnswerDepthRank(code) {
  switch (code) {
    case DATA_AVAILABILITY_CODES.answer_depth.DETAILED:
      return 3;
    case DATA_AVAILABILITY_CODES.answer_depth.FOCUSED:
      return 2;
    default:
      return 1;
  }
}

function getRequiredDepthCode(questionJudgment) {
  const granularityCode = getGranularityCode(questionJudgment);
  return granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL
    ? DATA_AVAILABILITY_CODES.answer_depth.DETAILED
    : DATA_AVAILABILITY_CODES.answer_depth.FOCUSED;
}

function judgeGapHintNeeded(questionJudgment, hasBusinessDataCode, dimensionAvailabilityCode, answerDepthCode) {
  const requiredDepthCode = getRequiredDepthCode(questionJudgment);

  const needHint =
    hasBusinessDataCode === DATA_AVAILABILITY_CODES.has_business_data.UNAVAILABLE ||
    dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.UNAVAILABLE ||
    (dimensionAvailabilityCode === DATA_AVAILABILITY_CODES.dimension_availability.PARTIAL &&
      getGranularityCode(questionJudgment) === QUESTION_JUDGMENT_CODES.granularity.DETAIL) ||
    getAnswerDepthRank(requiredDepthCode) > getAnswerDepthRank(answerDepthCode);

  const code = needHint ? DATA_AVAILABILITY_CODES.gap_hint_needed.YES : DATA_AVAILABILITY_CODES.gap_hint_needed.NO;
  return toDataAvailabilityItem("gap_hint_needed", code);
}

export function buildDataAvailability(snapshot, questionJudgment, options = {}) {
  const hospitalMonthlyDetailRequested = Boolean(options?.hospitalMonthlyDetailRequested);
  const productHospitalRequested = Boolean(options?.productHospitalRequested);
  const hospitalNamedRequested = Boolean(options?.hospitalNamedRequested);
  const requestedHospitals = Array.isArray(options?.requestedHospitals) ? options.requestedHospitals : [];
  const productFullRequested = Boolean(options?.productFullRequested);
  const productNamedRequested = Boolean(options?.productNamedRequested);
  const requestedProducts = Array.isArray(options?.requestedProducts) ? options.requestedProducts : [];
  const productNamedMatchMode = trimString(options?.productNamedMatchMode).toLocaleLowerCase();
  const normalizedSnapshot = normalizeBusinessSnapshot(snapshot);
  const hasBusinessData = judgeBusinessDataAvailability(normalizedSnapshot);
  const dimensionAvailability = judgeDimensionAvailability(normalizedSnapshot, questionJudgment, hasBusinessData.code, {
    productHospitalRequested,
    hospitalNamedRequested,
    requestedHospitals,
    productFullRequested,
    productNamedRequested,
    requestedProducts,
  });
  const answerDepth = judgeAnswerDepth(questionJudgment, dimensionAvailability.code, normalizedSnapshot, {
    hospitalMonthlyDetailRequested,
  });
  const gapHintNeeded = judgeGapHintNeeded(
    questionJudgment,
    hasBusinessData.code,
    dimensionAvailability.code,
    answerDepth.code,
  );

  return {
    has_business_data: hasBusinessData,
    dimension_availability: dimensionAvailability,
    answer_depth: answerDepth,
    gap_hint_needed: gapHintNeeded,
    detail_request_mode: hospitalMonthlyDetailRequested
      ? "hospital_monthly"
      : productFullRequested
        ? "product_full"
        : productHospitalRequested
          ? "product_hospital"
          : productNamedRequested
            ? "product_named"
            : hospitalNamedRequested
              ? "hospital_named"
              : "generic",
    hospital_monthly_support: hospitalMonthlyDetailRequested ? resolveHospitalMonthlySupportCode(normalizedSnapshot) : "none",
    product_hospital_support: productHospitalRequested ? resolveProductHospitalSupportCode(normalizedSnapshot) : "none",
    hospital_named_support: hospitalNamedRequested ? resolveHospitalNamedSupportCode(normalizedSnapshot, requestedHospitals) : "none",
    product_full_support: productFullRequested ? resolveProductFullSupportCode(normalizedSnapshot) : "none",
    product_named_support: productNamedRequested ? resolveProductNamedSupportCode(normalizedSnapshot, requestedProducts) : "none",
    product_named_match_mode:
      productNamedRequested && (productNamedMatchMode === "exact" || productNamedMatchMode === "family")
        ? productNamedMatchMode
        : "none",
    requested_product_count_value: requestedProducts.length,
    product_hospital_hospital_count_value:
      normalizeNumericValue(normalizedSnapshot?.performance_overview?.product_hospital_hospital_count_value) ??
      (Array.isArray(normalizedSnapshot?.hospital_performance) ? normalizedSnapshot.hospital_performance.length : 0),
  };
}
