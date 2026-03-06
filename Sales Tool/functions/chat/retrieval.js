import {
  HOSPITAL_MENTION_CAPTURE_RE,
  HOSPITAL_NAMED_GENERIC_MENTION_KEYWORDS,
  ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP,
  ON_DEMAND_MAX_WINDOW_MONTHS,
  ON_DEMAND_PRODUCT_FULL_SAFE_CAP,
  ON_DEMAND_PRODUCT_NAMED_SAFE_CAP,
  QUESTION_JUDGMENT_CODES,
  ROUTE_DECISION_CODES,
  SUPABASE_DATA_MAX_PAGES,
  SUPABASE_DATA_PAGE_SIZE,
  SUPABASE_DATA_UPSTREAM_TIMEOUT_MS,
  addMonthsToYm,
  calcGrowthRatio,
  createEmptyBusinessSnapshot,
  extractYmFromDate,
  fetchWithTimeout,
  formatAmountWanText,
  formatDeltaPercentText,
  formatPercentText,
  formatQuantityBoxText,
  getEnvString,
  listYmRange,
  normalizeBusinessSnapshot,
  normalizeHospitalAliasKey,
  normalizeHospitalNameForMatch,
  normalizeNumericValue,
  normalizeProductFamilyKey,
  normalizeProductNameForMatch,
  normalizeQuestionText,
  normalizeSnapshotObject,
  normalizeSnapshotObjectArray,
  normalizeSnapshotStringArray,
  normalizeTextForLookup,
  parseJsonSafe,
  roundToTwo,
  trimString,
} from "./shared.js";
function isGenericHospitalMention(value) {
  const text = trimString(value);
  if (!text) {
    return true;
  }
  if (HOSPITAL_NAMED_GENERIC_MENTION_KEYWORDS.includes(text)) {
    return true;
  }
  return /^(这家|这个|那个|哪家|哪个|哪些|该)?(医院|门诊|诊所|机构)$/.test(text);
}

function cleanHospitalMentionText(value) {
  let text = trimString(value);
  if (!text) {
    return "";
  }
  text = text.replace(/^[，,。！？!?:：；;\s]+|[，,。！？!?:：；;\s]+$/g, "");
  text = text.replace(/^(这家|这个|那个|哪家|哪个|哪些|该)/, "");
  text = text.replace(/(.+?)(这家|这个|那个|哪家|哪个|哪些|该)(医院|门诊|诊所|机构)$/u, "$1$3");
  return trimString(text);
}

function extractHospitalMentionTokens(message) {
  const text = trimString(message);
  if (!text) {
    return [];
  }
  const mentions = [];
  const seen = new Set();
  const matched = text.matchAll(HOSPITAL_MENTION_CAPTURE_RE);
  for (const item of matched) {
    const mentionName = cleanHospitalMentionText(item?.[1]);
    if (!mentionName || isGenericHospitalMention(mentionName)) {
      continue;
    }
    const mentionKey = normalizeHospitalNameForMatch(mentionName);
    const mentionAliasKey = normalizeHospitalAliasKey(mentionName);
    if (!mentionKey || mentionKey.length < 2) {
      continue;
    }
    const dedupeKey = mentionKey;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    mentions.push({
      mention_name: mentionName,
      mention_key: mentionKey,
      mention_alias_key: mentionAliasKey,
    });
    if (mentions.length >= ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP) {
      break;
    }
  }
  return mentions;
}

function buildHospitalNamedCandidates(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  return sourceRows
    .map((row) => {
      const name = trimString(row?.name || row?.hospital_name);
      const fullKey = normalizeHospitalNameForMatch(name);
      const aliasKey = normalizeHospitalAliasKey(name);
      if (!name || !fullKey) {
        return null;
      }
      return {
        name,
        full_key: fullKey,
        alias_key: aliasKey,
        row,
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

function createInitialRetrievalState() {
  return {
    triggered: false,
    target_dimension: "",
    success: false,
    window_capped: false,
    degraded_to_bounded: false,
  };
}

function resolveTargetDimensionForEnhancement(primaryDimensionCode) {
  const code = trimString(primaryDimensionCode);
  if (code && code !== QUESTION_JUDGMENT_CODES.primary_dimension.OTHER) {
    return code;
  }
  return QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
}

function resolveRetrievalWindowFromSnapshot(snapshot) {
  const startMonth = trimString(snapshot?.analysis_range?.start_month);
  const endMonth = trimString(snapshot?.analysis_range?.end_month);
  if (!isValidYm(startMonth) || !isValidYm(endMonth) || startMonth > endMonth) {
    return {
      valid: false,
      month_keys: [],
      effective_start_month: "",
      effective_end_month: "",
      window_capped: false,
    };
  }

  const monthKeys = listYmRange(startMonth, endMonth);
  if (monthKeys.length === 0) {
    return {
      valid: false,
      month_keys: [],
      effective_start_month: "",
      effective_end_month: "",
      window_capped: false,
    };
  }

  const clippedKeys =
    monthKeys.length > ON_DEMAND_MAX_WINDOW_MONTHS ? monthKeys.slice(-ON_DEMAND_MAX_WINDOW_MONTHS) : monthKeys;

  return {
    valid: true,
    month_keys: clippedKeys,
    effective_start_month: clippedKeys[0],
    effective_end_month: clippedKeys[clippedKeys.length - 1],
    window_capped: clippedKeys.length !== monthKeys.length,
  };
}

async function fetchSupabaseRestRows(pathWithQuery, token, env) {
  const supabaseUrl = getEnvString(env, "SUPABASE_URL");
  const supabaseAnonKey = getEnvString(env, "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("SUPABASE_CONFIG_MISSING");
  }
  const safeToken = trimString(token);
  if (!safeToken) {
    throw new Error("SUPABASE_TOKEN_MISSING");
  }

  const url = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${pathWithQuery}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${safeToken}`,
      },
    },
    SUPABASE_DATA_UPSTREAM_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`SUPABASE_REST_ERROR_${response.status}`);
  }
  const payload = await parseJsonSafe(response);
  return Array.isArray(payload) ? payload : [];
}

function mapFetchedSalesRecord(row, monthSet) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const ym = extractYmFromDate(row.record_date);
  if (!ym || !monthSet.has(ym)) {
    return null;
  }

  const amount = normalizeNumericValue(row.assessed_amount);
  const quantity = normalizeNumericValue(row.purchase_quantity_boxes);
  if (amount === null || quantity === null) {
    return null;
  }

  return {
    ym,
    amount: roundToTwo(amount) || 0,
    quantity: roundToTwo(quantity) || 0,
    product_name: trimString(row.product_name) || "未命名产品",
    hospital_name: trimString(row.hospital_name) || "未命名医院",
  };
}

async function fetchSalesRecordsByWindow(windowInfo, token, env) {
  const monthSet = new Set(windowInfo.month_keys);
  const startDate = `${windowInfo.effective_start_month}-01`;
  const endDate = `${windowInfo.effective_end_month}-31`;
  const rows = [];

  for (let pageIndex = 0; pageIndex < SUPABASE_DATA_MAX_PAGES; pageIndex += 1) {
    const offset = pageIndex * SUPABASE_DATA_PAGE_SIZE;
    const query = [
      "select=record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount",
      `record_date=gte.${encodeURIComponent(startDate)}`,
      `record_date=lte.${encodeURIComponent(endDate)}`,
      "order=record_date.asc",
      `limit=${SUPABASE_DATA_PAGE_SIZE}`,
      `offset=${offset}`,
    ].join("&");

    const pageRows = await fetchSupabaseRestRows(`sales_records?${query}`, token, env);
    for (const row of pageRows) {
      const mapped = mapFetchedSalesRecord(row, monthSet);
      if (mapped) {
        rows.push(mapped);
      }
    }

    if (pageRows.length < SUPABASE_DATA_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function fetchProductsCatalog(token, env) {
  const rows = await fetchSupabaseRestRows("products?select=id,product_name", token, env);
  const catalog = [];
  const seen = new Set();
  rows.forEach((row) => {
    const productId = trimString(row?.id);
    const productName = trimString(row?.product_name);
    const key = normalizeTextForLookup(productName);
    if (!productId || !productName || !key || seen.has(productId)) {
      return;
    }
    seen.add(productId);
    catalog.push({
      product_id: productId,
      product_name: productName,
      lookup_key: key,
    });
  });
  return catalog;
}

function buildProductsNameMap(catalog) {
  const map = new Map();
  const rows = Array.isArray(catalog) ? catalog : [];
  rows.forEach((row) => {
    const lookupKey = trimString(row?.lookup_key);
    const productId = trimString(row?.product_id);
    if (!lookupKey || !productId || map.has(lookupKey)) {
      return;
    }
    map.set(lookupKey, productId);
  });
  return map;
}

function matchNamedProductsFromCatalog(message, productCatalog, cap = ON_DEMAND_PRODUCT_NAMED_SAFE_CAP) {
  const sourceText = trimString(message);
  const normalizedSourceText = normalizeProductNameForMatch(sourceText);
  if (!sourceText || !normalizedSourceText || !Array.isArray(productCatalog) || productCatalog.length === 0) {
    return {
      requestedProducts: [],
      matchMode: "none",
    };
  }

  const safeCap = Number.isInteger(cap) && cap > 0 ? cap : ON_DEMAND_PRODUCT_NAMED_SAFE_CAP;
  const normalizedCatalog = productCatalog
    .map((row) => {
      const productId = trimString(row?.product_id);
      const productName = trimString(row?.product_name);
      const lookupKey = normalizeProductNameForMatch(row?.lookup_key || productName);
      const familyKey = normalizeProductFamilyKey(productName);
      if (!productId || !productName || !lookupKey || lookupKey.length < 2) {
        return null;
      }
      return {
        product_id: productId,
        product_name: productName,
        lookup_key: lookupKey,
        family_key: familyKey,
      };
    })
    .filter((item) => item !== null);

  const exactMatches = [];
  const usedExact = new Set();
  normalizedCatalog.forEach((row) => {
    const productId = trimString(row?.product_id);
    const productName = trimString(row?.product_name);
    const lookupKey = normalizeProductNameForMatch(row?.lookup_key || productName);
    const dedupeKey = `${productId}::${lookupKey}`;
    if (usedExact.has(dedupeKey)) {
      return;
    }

    const rawIndex = sourceText.indexOf(productName);
    const normalizedIndex = normalizedSourceText.indexOf(lookupKey);
    if (rawIndex < 0 && normalizedIndex < 0) {
      return;
    }

    const order =
      rawIndex >= 0 && normalizedIndex >= 0 ? Math.min(rawIndex, normalizedIndex) : rawIndex >= 0 ? rawIndex : normalizedIndex;
    usedExact.add(dedupeKey);
    exactMatches.push({
      order,
      product_id: productId,
      product_name: productName,
      lookup_key: lookupKey,
    });
  });

  if (exactMatches.length > 0) {
    exactMatches.sort((left, right) => left.order - right.order);
    return {
      requestedProducts: exactMatches.slice(0, safeCap),
      matchMode: "exact",
    };
  }

  // Fallback: group products by normalized family key (e.g., Botox50/Botox100 -> botox).
  const familyMatchedEntries = normalizedCatalog
    .map((row) => {
      const familyKey = trimString(row?.family_key);
      if (!familyKey || familyKey.length < 2) {
        return null;
      }
      const familyIndex = normalizedSourceText.indexOf(familyKey);
      if (familyIndex < 0) {
        return null;
      }
      return {
        familyIndex,
        product_id: row.product_id,
        product_name: row.product_name,
        lookup_key: row.lookup_key,
      };
    })
    .filter((item) => item !== null);

  if (familyMatchedEntries.length === 0) {
    return {
      requestedProducts: [],
      matchMode: "none",
    };
  }

  const usedFamilyIds = new Set();
  const dedupedFamilyMatches = [];
  familyMatchedEntries
    .sort((left, right) => left.familyIndex - right.familyIndex)
    .forEach((item) => {
      const productId = trimString(item?.product_id);
      if (!productId || usedFamilyIds.has(productId)) {
        return;
      }
      usedFamilyIds.add(productId);
      dedupedFamilyMatches.push({
        product_id: productId,
        product_name: trimString(item?.product_name),
        lookup_key: trimString(item?.lookup_key),
      });
    });

  return {
    requestedProducts: dedupedFamilyMatches.slice(0, safeCap),
    matchMode: dedupedFamilyMatches.length > 0 ? "family" : "none",
  };
}

async function resolveProductNamedRequestContext({
  message,
  questionJudgment,
  productFullRequested,
  token,
  env,
}) {
  const relevanceCode = trimString(questionJudgment?.relevance?.code);
  if (relevanceCode !== QUESTION_JUDGMENT_CODES.relevance.RELEVANT || productFullRequested) {
    return {
      productNamedRequested: false,
      requestedProducts: [],
      productNamedMatchMode: "none",
    };
  }

  try {
    const productCatalog = await fetchProductsCatalog(token, env);
    const matched = matchNamedProductsFromCatalog(message, productCatalog, ON_DEMAND_PRODUCT_NAMED_SAFE_CAP);
    const requestedProducts = Array.isArray(matched?.requestedProducts) ? matched.requestedProducts : [];
    const matchMode = trimString(matched?.matchMode) || "none";
    return {
      productNamedRequested: requestedProducts.length > 0,
      requestedProducts,
      productNamedMatchMode: requestedProducts.length > 0 ? matchMode : "none",
    };
  } catch (_error) {
    return {
      productNamedRequested: false,
      requestedProducts: [],
      productNamedMatchMode: "none",
    };
  }
}

function resolveHospitalNamedRequestContext({
  message,
  questionJudgment,
  productFullRequested,
  productNamedRequested,
}) {
  const relevanceCode = trimString(questionJudgment?.relevance?.code);
  if (
    relevanceCode !== QUESTION_JUDGMENT_CODES.relevance.RELEVANT ||
    productFullRequested ||
    productNamedRequested
  ) {
    return {
      hospitalNamedRequested: false,
      requestedHospitals: [],
    };
  }

  const normalizedMessage = normalizeQuestionText(message);
  const primaryDimensionCode = trimString(questionJudgment?.primary_dimension?.code);
  const hasHospitalCue =
    primaryDimensionCode === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL ||
    containsAnyKeyword(normalizedMessage, HOSPITAL_NAMED_TRIGGER_KEYWORDS);
  if (!hasHospitalCue) {
    return {
      hospitalNamedRequested: false,
      requestedHospitals: [],
    };
  }

  const requestedHospitals = extractHospitalMentionTokens(message);
  return {
    hospitalNamedRequested: requestedHospitals.length > 0,
    requestedHospitals,
  };
}

function resolveProductHospitalRequestContext({
  message,
  questionJudgment,
  productFullRequested,
  productNamedRequested,
  requestedProducts,
}) {
  const relevanceCode = trimString(questionJudgment?.relevance?.code);
  if (
    relevanceCode !== QUESTION_JUDGMENT_CODES.relevance.RELEVANT ||
    productFullRequested ||
    !productNamedRequested
  ) {
    return {
      productHospitalRequested: false,
    };
  }
  const safeRequestedProducts = Array.isArray(requestedProducts) ? requestedProducts : [];
  if (safeRequestedProducts.length === 0) {
    return {
      productHospitalRequested: false,
    };
  }
  return {
    productHospitalRequested: isProductHospitalRequest(message, questionJudgment, productNamedRequested),
  };
}

function resolveControlledRowLimit(existingRows, granularityCode, availableCount) {
  if (!Number.isInteger(availableCount) || availableCount <= 0) {
    return 0;
  }
  const baseSize = Array.isArray(existingRows) ? existingRows.length : 0;
  const growth = granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL ? 4 : 2;
  const floor = granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL ? 5 : 3;
  const target = Math.max(floor, baseSize + growth);
  return Math.min(availableCount, target);
}

function resolveControlledTrendLimit(existingRows, granularityCode, availableCount) {
  if (!Number.isInteger(availableCount) || availableCount <= 0) {
    return 0;
  }
  const baseSize = Array.isArray(existingRows) ? existingRows.length : 0;
  const growth = granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL ? 6 : 3;
  const floor = granularityCode === QUESTION_JUDGMENT_CODES.granularity.DETAIL ? 8 : 4;
  const target = Math.max(floor, baseSize + growth);
  return Math.min(availableCount, target);
}

function buildAggregatedMetrics(records, monthKeys) {
  const monthSet = new Set(monthKeys);
  const monthTotals = new Map();
  const productMap = new Map();
  const hospitalMap = new Map();

  monthKeys.forEach((ym) => {
    monthTotals.set(ym, { amount: 0, quantity: 0 });
  });

  let totalAmount = 0;
  let totalQuantity = 0;

  records.forEach((record) => {
    if (!record || !monthSet.has(record.ym)) {
      return;
    }

    const amount = normalizeNumericValue(record.amount) || 0;
    const quantity = normalizeNumericValue(record.quantity) || 0;
    totalAmount += amount;
    totalQuantity += quantity;

    const monthMetric = monthTotals.get(record.ym) || { amount: 0, quantity: 0 };
    monthMetric.amount += amount;
    monthMetric.quantity += quantity;
    monthTotals.set(record.ym, monthMetric);

    const productKey = trimString(record.product_name) || "未命名产品";
    const productMetric = productMap.get(productKey) || { name: productKey, amount: 0, quantity: 0, monthly: new Map() };
    productMetric.amount += amount;
    productMetric.quantity += quantity;
    const productMonthMetric = productMetric.monthly.get(record.ym) || { amount: 0, quantity: 0 };
    productMonthMetric.amount += amount;
    productMonthMetric.quantity += quantity;
    productMetric.monthly.set(record.ym, productMonthMetric);
    productMap.set(productKey, productMetric);

    const hospitalKey = trimString(record.hospital_name) || "未命名医院";
    const hospitalMetric = hospitalMap.get(hospitalKey) || { name: hospitalKey, amount: 0, quantity: 0, monthly: new Map() };
    hospitalMetric.amount += amount;
    hospitalMetric.quantity += quantity;
    const hospitalMonthMetric = hospitalMetric.monthly.get(record.ym) || { amount: 0, quantity: 0 };
    hospitalMonthMetric.amount += amount;
    hospitalMonthMetric.quantity += quantity;
    hospitalMetric.monthly.set(record.ym, hospitalMonthMetric);
    hospitalMap.set(hospitalKey, hospitalMetric);
  });

  const monthlyRows = monthKeys.map((ym) => {
    const monthMetric = monthTotals.get(ym) || { amount: 0, quantity: 0 };
    const prevYm = addMonthsToYm(ym, -1);
    const yoyYm = addMonthsToYm(ym, -12);
    const prevMetric = monthTotals.get(prevYm) || null;
    const yoyMetric = monthTotals.get(yoyYm) || null;
    return {
      ym,
      amount: roundToTwo(monthMetric.amount) || 0,
      quantity: roundToTwo(monthMetric.quantity) || 0,
      amount_mom_ratio: prevMetric ? calcGrowthRatio(monthMetric.amount, prevMetric.amount) : null,
      amount_yoy_ratio: yoyMetric ? calcGrowthRatio(monthMetric.amount, yoyMetric.amount) : null,
    };
  });

  const toRankedRows = (sourceMap) => {
    const rows = Array.from(sourceMap.values()).map((row) => {
      const amount = roundToTwo(row.amount) || 0;
      const quantity = roundToTwo(row.quantity) || 0;
      const amountShare = totalAmount > 0 ? amount / totalAmount : null;
      const quantityShare = totalQuantity > 0 ? quantity / totalQuantity : null;
      return {
        ...row,
        amount,
        quantity,
        amount_share_ratio: amountShare,
        quantity_share_ratio: quantityShare,
      };
    });
    rows.sort((left, right) => right.amount - left.amount);
    return rows;
  };

  return {
    total_amount: roundToTwo(totalAmount) || 0,
    total_quantity: roundToTwo(totalQuantity) || 0,
    monthly_rows: monthlyRows,
    product_rows: toRankedRows(productMap),
    hospital_rows: toRankedRows(hospitalMap),
  };
}

function buildPerformanceOverviewFromMetrics(metrics) {
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const latestRow = monthlyRows.length > 0 ? monthlyRows[monthlyRows.length - 1] : null;

  let latestKeyChange = "--";
  let latestKeyChangeRatio = null;
  let latestKeyChangeCode = "unknown";
  if (latestRow && normalizeNumericValue(latestRow.amount_mom_ratio) !== null) {
    latestKeyChangeRatio = normalizeNumericValue(latestRow.amount_mom_ratio);
    latestKeyChangeCode = "amount_mom";
    latestKeyChange = `最近月金额环比 ${formatDeltaPercentText(latestKeyChangeRatio)}`;
  } else if (latestRow && normalizeNumericValue(latestRow.amount_yoy_ratio) !== null) {
    latestKeyChangeRatio = normalizeNumericValue(latestRow.amount_yoy_ratio);
    latestKeyChangeCode = "amount_yoy";
    latestKeyChange = `最近月金额同比 ${formatDeltaPercentText(latestKeyChangeRatio)}`;
  }

  return {
    sales_amount: formatAmountWanText(metrics?.total_amount),
    sales_amount_value: normalizeNumericValue(metrics?.total_amount),
    amount_achievement: "--",
    amount_achievement_ratio: null,
    latest_key_change: latestKeyChange,
    latest_key_change_ratio: latestKeyChangeRatio,
    latest_key_change_code: latestKeyChangeCode,
    sales_volume: formatQuantityBoxText(metrics?.total_quantity),
    sales_volume_value: normalizeNumericValue(metrics?.total_quantity),
  };
}

function buildRecentTrendsFromMetrics(metrics, limit) {
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : monthlyRows.length;
  return monthlyRows.slice(-safeLimit).map((row) => ({
    period: trimString(row?.ym),
    sales_amount: formatAmountWanText(row?.amount),
    sales_amount_value: normalizeNumericValue(row?.amount),
    amount_mom: formatDeltaPercentText(row?.amount_mom_ratio),
    amount_mom_ratio: normalizeNumericValue(row?.amount_mom_ratio),
    sales_volume: formatQuantityBoxText(row?.quantity),
    sales_volume_value: normalizeNumericValue(row?.quantity),
  }));
}

function buildKeyBusinessSignals(metrics, options = {}) {
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const productRows = Array.isArray(metrics?.product_rows) ? metrics.product_rows : [];
  const hospitalRows = Array.isArray(metrics?.hospital_rows) ? metrics.hospital_rows : [];
  const target = trimString(options.targetDimension);

  const signals = [];
  const latestRow = monthlyRows.length > 0 ? monthlyRows[monthlyRows.length - 1] : null;
  if (latestRow && normalizeNumericValue(latestRow.amount_mom_ratio) !== null) {
    const ratio = normalizeNumericValue(latestRow.amount_mom_ratio);
    const trendText = ratio > 0 ? "上升" : ratio < 0 ? "下降" : "持平";
    signals.push(`最近月（${latestRow.ym}）销售额较上月${trendText}，变动${formatDeltaPercentText(ratio)}。`);
  } else if (latestRow && normalizeNumericValue(latestRow.amount_yoy_ratio) !== null) {
    const ratio = normalizeNumericValue(latestRow.amount_yoy_ratio);
    const trendText = ratio > 0 ? "上升" : ratio < 0 ? "下降" : "持平";
    signals.push(`最近月（${latestRow.ym}）销售额同比${trendText}，变动${formatDeltaPercentText(ratio)}。`);
  }

  if (target === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    const topHospital = hospitalRows[0];
    if (topHospital) {
      signals.push(
        `Top1医院${topHospital.name}贡献销售额${formatAmountWanText(topHospital.amount)}，占比${formatPercentText(topHospital.amount_share_ratio)}。`,
      );
    }
  } else {
    const topProduct = productRows[0];
    if (topProduct) {
      signals.push(
        `Top1产品${topProduct.name}贡献销售额${formatAmountWanText(topProduct.amount)}，占比${formatPercentText(topProduct.amount_share_ratio)}。`,
      );
    }
  }

  return signals.slice(0, 2);
}

function calcEntityRatioByYm(monthlyMap, currentYm, deltaMonths) {
  if (!(monthlyMap instanceof Map)) {
    return null;
  }
  const current = monthlyMap.get(currentYm);
  const baseYm = addMonthsToYm(currentYm, deltaMonths);
  const base = monthlyMap.get(baseYm);
  if (!current || !base) {
    return null;
  }
  return calcGrowthRatio(current.amount, base.amount);
}

function buildProductPerformanceRows(metrics, limit, options = {}) {
  const sourceRows = Array.isArray(metrics?.product_rows) ? metrics.product_rows : [];
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const latestYm = trimString(monthlyRows[monthlyRows.length - 1]?.ym);
  const includeAllCatalogProducts = Boolean(options?.includeAllCatalogProducts);
  const includeNamedProducts = Boolean(options?.includeNamedProducts);
  const requestedProducts = Array.isArray(options?.requestedProducts) ? options.requestedProducts : [];
  const productCatalog = Array.isArray(options?.productCatalog) ? options.productCatalog : [];
  const productNameMap = options?.productNameMap instanceof Map ? options.productNameMap : new Map();

  let rows = sourceRows.map((row) => ({
    ...row,
    _has_record: true,
    _catalog_product_id: "",
    _lookup_key: normalizeTextForLookup(row?.name),
  }));

  if (includeNamedProducts && requestedProducts.length > 0) {
    const rowMap = new Map();
    rows.forEach((row) => {
      const lookupKey = trimString(row?._lookup_key);
      if (!lookupKey || rowMap.has(lookupKey)) {
        return;
      }
      rowMap.set(lookupKey, row);
    });

    const selectedRows = [];
    const selectedKeys = new Set();
    requestedProducts.forEach((requestedRow) => {
      const lookupKey = normalizeProductNameForMatch(requestedRow?.lookup_key || requestedRow?.product_name);
      const productId = trimString(requestedRow?.product_id);
      const productName = trimString(requestedRow?.product_name);
      if (!lookupKey || !productName || selectedKeys.has(lookupKey)) {
        return;
      }
      const matched = rowMap.get(lookupKey);
      if (matched) {
        selectedRows.push({
          ...matched,
          _catalog_product_id: productId || trimString(matched?._catalog_product_id),
          _lookup_key: lookupKey,
        });
      } else {
        selectedRows.push({
          name: productName,
          amount: 0,
          quantity: 0,
          amount_share_ratio: 0,
          quantity_share_ratio: 0,
          monthly: new Map(),
          _has_record: false,
          _catalog_product_id: productId,
          _lookup_key: lookupKey,
        });
      }
      selectedKeys.add(lookupKey);
    });
    rows = selectedRows;
  } else if (includeAllCatalogProducts && productCatalog.length > 0) {
    const rowMap = new Map();
    rows.forEach((row) => {
      const lookupKey = trimString(row?._lookup_key);
      if (!lookupKey || rowMap.has(lookupKey)) {
        return;
      }
      rowMap.set(lookupKey, row);
    });

    const mergedRows = [];
    const usedLookupKeys = new Set();
    productCatalog.forEach((catalogRow) => {
      const lookupKey = trimString(catalogRow?.lookup_key);
      const productId = trimString(catalogRow?.product_id);
      const productName = trimString(catalogRow?.product_name);
      if (!lookupKey || !productName) {
        return;
      }
      const matched = rowMap.get(lookupKey);
      if (matched) {
        usedLookupKeys.add(lookupKey);
        mergedRows.push({
          ...matched,
          _catalog_product_id: productId,
          _lookup_key: lookupKey,
        });
        return;
      }
      mergedRows.push({
        name: productName,
        amount: 0,
        quantity: 0,
        amount_share_ratio: 0,
        quantity_share_ratio: 0,
        monthly: new Map(),
        _has_record: false,
        _catalog_product_id: productId,
        _lookup_key: lookupKey,
      });
    });

    rows.forEach((row) => {
      const lookupKey = trimString(row?._lookup_key);
      if (!lookupKey || usedLookupKeys.has(lookupKey)) {
        return;
      }
      mergedRows.push(row);
    });
    rows = mergedRows;
    rows.sort((left, right) => {
      const leftAmount = normalizeNumericValue(left?.amount) ?? 0;
      const rightAmount = normalizeNumericValue(right?.amount) ?? 0;
      if (rightAmount !== leftAmount) {
        return rightAmount - leftAmount;
      }
      if (left._has_record !== right._has_record) {
        return right._has_record ? 1 : -1;
      }
      return trimString(left?.name).localeCompare(trimString(right?.name), "zh-Hans-CN");
    });
  }

  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : rows.length;

  return rows.slice(0, safeLimit).map((row) => {
    const yoyRatio = latestYm ? calcEntityRatioByYm(row.monthly, latestYm, -12) : null;
    const momRatio = latestYm ? calcEntityRatioByYm(row.monthly, latestYm, -1) : null;
    let changeMetric = "变化值";
    let changeMetricCode = "unknown";
    let changeValue = "--";
    let changeValueRatio = null;

    if (normalizeNumericValue(yoyRatio) !== null) {
      changeMetric = "金额同比";
      changeMetricCode = "amount_yoy";
      changeValue = formatDeltaPercentText(yoyRatio);
      changeValueRatio = normalizeNumericValue(yoyRatio);
    } else if (normalizeNumericValue(momRatio) !== null) {
      changeMetric = "金额环比";
      changeMetricCode = "amount_mom";
      changeValue = formatDeltaPercentText(momRatio);
      changeValueRatio = normalizeNumericValue(momRatio);
    }

    const lookupKey = normalizeTextForLookup(row.name);
    const productCode =
      trimString(row?._catalog_product_id) ||
      (lookupKey && productNameMap instanceof Map ? trimString(productNameMap.get(lookupKey)) : "");

    return {
      product_name: row.name,
      product_code: productCode,
      sales_amount: formatAmountWanText(row.amount),
      sales_amount_value: normalizeNumericValue(row.amount),
      sales_share: formatPercentText(row.amount_share_ratio),
      sales_share_ratio: normalizeNumericValue(row.amount_share_ratio),
      sales_volume: formatQuantityBoxText(row.quantity),
      sales_volume_value: normalizeNumericValue(row.quantity),
      change_metric: changeMetric,
      change_metric_code: changeMetricCode,
      change_value: changeValue,
      change_value_ratio: changeValueRatio,
    };
  });
}

function buildHospitalPerformanceRows(metrics, limit, options = {}) {
  let rows = Array.isArray(metrics?.hospital_rows) ? metrics.hospital_rows : [];
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const latestYm = trimString(monthlyRows[monthlyRows.length - 1]?.ym);
  const monthKeys = monthlyRows.map((item) => trimString(item?.ym)).filter((item) => item);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : rows.length;
  const includeMonthlyPoints = Boolean(metrics?.include_hospital_monthly_points);
  const includeNamedHospitals = Boolean(options?.includeNamedHospitals);
  const requestedHospitals = Array.isArray(options?.requestedHospitals) ? options.requestedHospitals : [];

  if (includeNamedHospitals && requestedHospitals.length > 0) {
    const candidates = buildHospitalNamedCandidates(rows);
    const resolved = resolveHospitalNamedMatches(requestedHospitals, candidates);
    rows = resolved.map((item) => item.row);
  }

  return rows.slice(0, safeLimit).map((row) => {
    const yoyRatio = latestYm ? calcEntityRatioByYm(row.monthly, latestYm, -12) : null;
    const momRatio = latestYm ? calcEntityRatioByYm(row.monthly, latestYm, -1) : null;
    let changeMetric = "变化值";
    let changeMetricCode = "unknown";
    let changeValue = "--";
    let changeValueRatio = null;
    if (normalizeNumericValue(yoyRatio) !== null) {
      changeMetric = "金额同比";
      changeMetricCode = "amount_yoy";
      changeValue = formatDeltaPercentText(yoyRatio);
      changeValueRatio = normalizeNumericValue(yoyRatio);
    } else if (normalizeNumericValue(momRatio) !== null) {
      changeMetric = "金额环比";
      changeMetricCode = "amount_mom";
      changeValue = formatDeltaPercentText(momRatio);
      changeValueRatio = normalizeNumericValue(momRatio);
    }

    const observedMonthCount = row?.monthly instanceof Map ? monthKeys.filter((ym) => row.monthly.has(ym)).length : 0;
    const coverageRatio = monthKeys.length > 0 ? observedMonthCount / monthKeys.length : 0;
    let coverageCode = "none";
    if (monthKeys.length > 0 && observedMonthCount >= monthKeys.length) {
      coverageCode = "full";
    } else if (observedMonthCount > 0) {
      coverageCode = "partial";
    }

    const rowPayload = {
      hospital_name: row.name,
      hospital_code: "",
      sales_amount: formatAmountWanText(row.amount),
      sales_amount_value: normalizeNumericValue(row.amount),
      sales_share: formatPercentText(row.amount_share_ratio),
      sales_share_ratio: normalizeNumericValue(row.amount_share_ratio),
      change_metric: changeMetric,
      change_metric_code: changeMetricCode,
      change_value: changeValue,
      change_value_ratio: changeValueRatio,
      monthly_coverage_ratio: normalizeNumericValue(coverageRatio),
      monthly_coverage_code: coverageCode,
    };

    if (includeMonthlyPoints) {
      let previousAmount = null;
      rowPayload.monthly_points = monthKeys.map((ym) => {
        const monthMetric = row?.monthly instanceof Map ? row.monthly.get(ym) : null;
        const amount = normalizeNumericValue(monthMetric?.amount) ?? 0;
        const quantity = normalizeNumericValue(monthMetric?.quantity) ?? 0;
        const amountMomRatio = previousAmount === null ? null : calcGrowthRatio(amount, previousAmount);
        previousAmount = amount;
        return {
          period: ym,
          sales_amount: formatAmountWanText(amount),
          sales_amount_value: normalizeNumericValue(amount),
          sales_volume: formatQuantityBoxText(quantity),
          sales_volume_value: normalizeNumericValue(quantity),
          amount_mom: formatDeltaPercentText(amountMomRatio),
          amount_mom_ratio: normalizeNumericValue(amountMomRatio),
        };
      });
    }

    return rowPayload;
  });
}

function resolveProductCoverageCode(catalogCountValue, snapshotCountValue) {
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

function resolveProductFullSupportCode(snapshot) {
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

function resolveProductNamedSupportCode(snapshot, requestedProducts) {
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

function buildRequestedProductLookupKeySet(requestedProducts) {
  const targets = Array.isArray(requestedProducts) ? requestedProducts : [];
  const targetKeys = new Set();
  targets.forEach((target) => {
    const key = normalizeProductNameForMatch(target?.lookup_key || target?.product_name);
    if (key) {
      targetKeys.add(key);
    }
  });
  return targetKeys;
}

function resolveProductHospitalSupportCode(snapshot) {
  const overview = snapshot?.performance_overview;
  const supportCode = trimString(overview?.product_hospital_support_code).toLocaleLowerCase();
  if (supportCode === "full" || supportCode === "partial" || supportCode === "none") {
    return supportCode;
  }
  return "none";
}

function resolveHospitalMonthlySupportCode(snapshot) {
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

function resolveHospitalNamedSupportCode(snapshot, requestedHospitals) {
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

function buildRiskOpportunityHints(metrics) {
  const monthlyRows = Array.isArray(metrics?.monthly_rows) ? metrics.monthly_rows : [];
  const productRows = Array.isArray(metrics?.product_rows) ? metrics.product_rows : [];
  const hospitalRows = Array.isArray(metrics?.hospital_rows) ? metrics.hospital_rows : [];

  const riskAlerts = [];
  const opportunityHints = [];

  const latestRow = monthlyRows.length > 0 ? monthlyRows[monthlyRows.length - 1] : null;
  if (latestRow && normalizeNumericValue(latestRow.amount_mom_ratio) !== null) {
    const momRatio = normalizeNumericValue(latestRow.amount_mom_ratio);
    if (momRatio < 0) {
      riskAlerts.push(`最近月（${latestRow.ym}）销售额环比下滑${formatDeltaPercentText(momRatio)}，需关注短期波动风险。`);
    } else if (momRatio > 0) {
      opportunityHints.push(`最近月（${latestRow.ym}）销售额环比增长${formatDeltaPercentText(momRatio)}，可延续当前有效动作。`);
    }
  }

  const topProduct = productRows[0];
  if (topProduct && normalizeNumericValue(topProduct.amount_share_ratio) !== null) {
    const share = normalizeNumericValue(topProduct.amount_share_ratio);
    if (share >= 0.6) {
      riskAlerts.push(`Top1产品占比${formatPercentText(share)}，结构集中度偏高，需防止单品波动风险。`);
    } else if (share <= 0.4) {
      opportunityHints.push(`Top1产品占比${formatPercentText(share)}，结构相对均衡，可挖掘协同增长机会。`);
    }
  }

  if (hospitalRows.length > 6) {
    opportunityHints.push("医院覆盖层级较丰富，可梳理长尾医院分层推进节奏。");
  }

  return {
    risk_alerts: riskAlerts.slice(0, 2),
    opportunity_hints: opportunityHints.slice(0, 2),
  };
}

function filterRecordsForProductHospital(records, requestedProducts) {
  const sourceRecords = Array.isArray(records) ? records : [];
  const requestedRows = Array.isArray(requestedProducts) ? requestedProducts : [];
  const targetKeys = buildRequestedProductLookupKeySet(requestedProducts);
  if (requestedRows.length === 0 || targetKeys.size === 0) {
    return {
      filtered_records: sourceRecords,
      target_count: targetKeys.size,
      matched_target_count: 0,
      support_code: "none",
      filter_applied: false,
    };
  }

  const matchedTargetKeys = new Set();
  const filteredRecords = sourceRecords.filter((record) => {
    const productKey = normalizeProductNameForMatch(record?.product_name);
    if (!productKey || !targetKeys.has(productKey)) {
      return false;
    }
    matchedTargetKeys.add(productKey);
    return true;
  });

  const supportCode = targetKeys.size < requestedRows.length ? "partial" : "full";
  return {
    filtered_records: filteredRecords,
    target_count: targetKeys.size,
    matched_target_count: matchedTargetKeys.size,
    support_code: supportCode,
    filter_applied: true,
  };
}

async function buildDimensionEnhancementPayload(params) {
  const targetDimension = trimString(params?.targetDimension);
  const granularityCode = trimString(params?.granularityCode);
  const hospitalMonthlyDetailRequested = Boolean(params?.hospitalMonthlyDetailRequested);
  const hospitalNamedRequested = Boolean(params?.hospitalNamedRequested);
  const requestedHospitals = Array.isArray(params?.requestedHospitals) ? params.requestedHospitals : [];
  const productHospitalRequested = Boolean(params?.productHospitalRequested);
  const productFullRequested = Boolean(params?.productFullRequested);
  const productNamedRequested = Boolean(params?.productNamedRequested);
  const requestedProducts = Array.isArray(params?.requestedProducts) ? params.requestedProducts : [];
  const metrics = params?.metrics && typeof params.metrics === "object" ? params.metrics : {};
  const sourceSnapshot = params?.sourceSnapshot && typeof params.sourceSnapshot === "object" ? params.sourceSnapshot : {};
  const authToken = trimString(params?.authToken);
  const env = params?.env;

  const monthlyRows = Array.isArray(metrics.monthly_rows) ? metrics.monthly_rows : [];
  const productRows = Array.isArray(metrics.product_rows) ? metrics.product_rows : [];
  const hospitalRows = Array.isArray(metrics.hospital_rows) ? metrics.hospital_rows : [];
  const baseTrends = Array.isArray(sourceSnapshot?.recent_trends) ? sourceSnapshot.recent_trends : [];
  const baseProducts = Array.isArray(sourceSnapshot?.product_performance) ? sourceSnapshot.product_performance : [];
  const baseHospitals = Array.isArray(sourceSnapshot?.hospital_performance) ? sourceSnapshot.hospital_performance : [];

  const trendLimit = resolveControlledTrendLimit(baseTrends, granularityCode, monthlyRows.length);
  let productLimit = resolveControlledRowLimit(baseProducts, granularityCode, productRows.length);
  let hospitalLimit = resolveControlledRowLimit(baseHospitals, granularityCode, hospitalRows.length);

  const payload = {
    performance_overview: buildPerformanceOverviewFromMetrics(metrics),
    key_business_signals: buildKeyBusinessSignals(metrics, { targetDimension }),
    recent_trends: buildRecentTrendsFromMetrics(metrics, trendLimit),
    product_performance: [],
    hospital_performance: [],
    risk_alerts: [],
    opportunity_hints: [],
  };

  if (targetDimension === QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT) {
    let productCatalog = [];
    let productNameMap = new Map();
    if (authToken && env) {
      try {
        productCatalog = await fetchProductsCatalog(authToken, env);
        productNameMap = buildProductsNameMap(productCatalog);
      } catch (_error) {
        productCatalog = [];
        productNameMap = new Map();
      }
    }
    if (productNamedRequested) {
      productLimit = Math.min(ON_DEMAND_PRODUCT_NAMED_SAFE_CAP, requestedProducts.length);
    } else if (productFullRequested) {
      const desiredCount = productCatalog.length > 0 ? productCatalog.length : productRows.length;
      productLimit = Math.min(ON_DEMAND_PRODUCT_FULL_SAFE_CAP, Math.max(0, desiredCount));
    }
    payload.product_performance = buildProductPerformanceRows(metrics, productLimit, {
      productNameMap,
      productCatalog,
      includeAllCatalogProducts: productFullRequested,
      includeNamedProducts: productNamedRequested,
      requestedProducts,
    });
    if (productFullRequested) {
      const catalogCount = productCatalog.length;
      const snapshotCount = payload.product_performance.length;
      payload.performance_overview = normalizeSnapshotObject({
        ...payload.performance_overview,
        product_catalog_count_value: catalogCount,
        product_snapshot_count_value: snapshotCount,
        product_coverage_code: resolveProductCoverageCode(catalogCount, snapshotCount),
      });
    }
  }

  if (targetDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL) {
    if (hospitalNamedRequested) {
      hospitalLimit = Math.min(ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP, requestedHospitals.length);
    }
    payload.hospital_performance = buildHospitalPerformanceRows(
      {
        ...metrics,
        include_hospital_monthly_points: hospitalMonthlyDetailRequested,
      },
      hospitalLimit,
      {
        includeNamedHospitals: hospitalNamedRequested,
        requestedHospitals,
      },
    );
    if (productHospitalRequested) {
      const supportCode = trimString(params?.productHospitalSupportCode).toLocaleLowerCase();
      const targetCount = normalizeNumericValue(params?.productHospitalTargetCount);
      const safeSupportCode = supportCode === "full" || supportCode === "partial" || supportCode === "none" ? supportCode : "none";
      payload.performance_overview = normalizeSnapshotObject({
        ...payload.performance_overview,
        product_hospital_support_code: safeSupportCode,
        product_hospital_target_count_value: targetCount === null ? 0 : targetCount,
        product_hospital_hospital_count_value: payload.hospital_performance.length,
      });
      if (payload.hospital_performance.length === 0) {
        const productNames = requestedProducts
          .map((item) => trimString(item?.product_name))
          .filter((item) => item)
          .slice(0, 3);
        const nameText = productNames.length > 0 ? productNames.join("、") : "该产品";
        payload.key_business_signals = [`${nameText}在当前范围内未产生医院销量贡献。`];
      }
    }
  }

  if (targetDimension === QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY) {
    const riskHints = buildRiskOpportunityHints(metrics);
    payload.risk_alerts = riskHints.risk_alerts;
    payload.opportunity_hints = riskHints.opportunity_hints;
  }

  return payload;
}

function mergeSnapshotByTargetDimension(baseSnapshot, enhancementPayload, targetDimension) {
  const merged = normalizeBusinessSnapshot(baseSnapshot);
  const enhancement = enhancementPayload && typeof enhancementPayload === "object" ? enhancementPayload : {};

  const applyOverallLikeFields = () => {
    if (enhancement.performance_overview && Object.keys(enhancement.performance_overview).length > 0) {
      merged.performance_overview = normalizeSnapshotObject(enhancement.performance_overview);
    }
    if (Array.isArray(enhancement.key_business_signals)) {
      merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
    }
    if (Array.isArray(enhancement.recent_trends)) {
      merged.recent_trends = normalizeSnapshotObjectArray(enhancement.recent_trends);
    }
  };

  switch (targetDimension) {
    case QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT:
      if (enhancement.performance_overview && Object.keys(enhancement.performance_overview).length > 0) {
        merged.performance_overview = {
          ...merged.performance_overview,
          ...normalizeSnapshotObject(enhancement.performance_overview),
        };
      }
      if (Array.isArray(enhancement.product_performance)) {
        merged.product_performance = normalizeSnapshotObjectArray(enhancement.product_performance);
      }
      if (Array.isArray(enhancement.key_business_signals)) {
        merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
      }
      if (Array.isArray(enhancement.recent_trends)) {
        merged.recent_trends = normalizeSnapshotObjectArray(enhancement.recent_trends);
      }
      break;
    case QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL:
      if (enhancement.performance_overview && Object.keys(enhancement.performance_overview).length > 0) {
        merged.performance_overview = {
          ...merged.performance_overview,
          ...normalizeSnapshotObject(enhancement.performance_overview),
        };
      }
      if (Array.isArray(enhancement.hospital_performance)) {
        merged.hospital_performance = normalizeSnapshotObjectArray(enhancement.hospital_performance);
      }
      if (Array.isArray(enhancement.key_business_signals)) {
        merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
      }
      break;
    case QUESTION_JUDGMENT_CODES.primary_dimension.TREND:
      if (Array.isArray(enhancement.recent_trends)) {
        merged.recent_trends = normalizeSnapshotObjectArray(enhancement.recent_trends);
      }
      if (Array.isArray(enhancement.key_business_signals)) {
        merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
      }
      break;
    case QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY:
      if (Array.isArray(enhancement.risk_alerts)) {
        merged.risk_alerts = normalizeSnapshotStringArray(enhancement.risk_alerts);
      }
      if (Array.isArray(enhancement.opportunity_hints)) {
        merged.opportunity_hints = normalizeSnapshotStringArray(enhancement.opportunity_hints);
      }
      if (Array.isArray(enhancement.key_business_signals)) {
        merged.key_business_signals = normalizeSnapshotStringArray(enhancement.key_business_signals).slice(0, 2);
      }
      break;
    case QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL:
    default:
      applyOverallLikeFields();
      break;
  }

  return merged;
}

async function buildOnDemandSnapshotEnhancement(params) {
  const routeCode = trimString(params?.routeDecision?.route?.code);
  const sourceSnapshot = normalizeBusinessSnapshot(params?.businessSnapshot);
  const retrievalState = createInitialRetrievalState();

  if (routeCode !== ROUTE_DECISION_CODES.NEED_MORE_DATA) {
    return {
      effectiveSnapshot: sourceSnapshot,
      retrievalState,
    };
  }

  retrievalState.triggered = true;
  const targetDimension = resolveTargetDimensionForEnhancement(params?.questionJudgment?.primary_dimension?.code);
  const productHospitalRequested = Boolean(params?.productHospitalRequested);
  const requestedProducts = Array.isArray(params?.requestedProducts) ? params.requestedProducts : [];
  retrievalState.target_dimension = targetDimension;

  const windowInfo = resolveRetrievalWindowFromSnapshot(sourceSnapshot);
  retrievalState.window_capped = Boolean(windowInfo.window_capped);
  if (!windowInfo.valid) {
    return {
      effectiveSnapshot: sourceSnapshot,
      retrievalState,
    };
  }

  let records = [];
  try {
    records = await fetchSalesRecordsByWindow(windowInfo, params?.authToken, params?.env);
  } catch (_error) {
    return {
      effectiveSnapshot: sourceSnapshot,
      retrievalState,
    };
  }

  const useProductHospitalFiltering =
    targetDimension === QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL && productHospitalRequested;
  if (records.length === 0 && !useProductHospitalFiltering) {
    return {
      effectiveSnapshot: sourceSnapshot,
      retrievalState,
    };
  }

  let recordsForMetrics = records;
  let productHospitalSupportCode = "none";
  let productHospitalTargetCount = 0;
  if (useProductHospitalFiltering) {
    const filteredResult = filterRecordsForProductHospital(records, requestedProducts);
    recordsForMetrics = filteredResult.filtered_records;
    productHospitalSupportCode = filteredResult.support_code;
    productHospitalTargetCount = filteredResult.target_count;
  }

  const metrics = buildAggregatedMetrics(recordsForMetrics, windowInfo.month_keys);
  const enhancementPayload = await buildDimensionEnhancementPayload({
    targetDimension,
    granularityCode: trimString(params?.questionJudgment?.granularity?.code),
    hospitalMonthlyDetailRequested: Boolean(params?.hospitalMonthlyDetailRequested),
    hospitalNamedRequested: Boolean(params?.hospitalNamedRequested),
    requestedHospitals: Array.isArray(params?.requestedHospitals) ? params.requestedHospitals : [],
    productHospitalRequested,
    productHospitalSupportCode,
    productHospitalTargetCount,
    productFullRequested: Boolean(params?.productFullRequested),
    productNamedRequested: Boolean(params?.productNamedRequested),
    requestedProducts,
    metrics,
    sourceSnapshot,
    authToken: params?.authToken,
    env: params?.env,
  });
  const merged = mergeSnapshotByTargetDimension(sourceSnapshot, enhancementPayload, targetDimension);
  retrievalState.success = true;

  return {
    effectiveSnapshot: merged,
    retrievalState,
  };
}

export {
  buildOnDemandSnapshotEnhancement,
  createInitialRetrievalState,
  normalizeBusinessSnapshot,
  resolveHospitalNamedRequestContext,
  resolveProductHospitalRequestContext,
  resolveProductNamedRequestContext,
};
