import {
  HOSPITAL_MENTION_CAPTURE_RE,
  HOSPITAL_NAMED_GENERIC_MENTION_KEYWORDS,
  HOSPITAL_NAMED_TRIGGER_KEYWORDS,
  ON_DEMAND_HOSPITAL_NAMED_SAFE_CAP,
  ON_DEMAND_PRODUCT_NAMED_SAFE_CAP,
  PRODUCT_HOSPITAL_SCOPE_KEYWORDS,
  QUESTION_JUDGMENT_CODES,
  containsAnyKeyword,
  normalizeQuestionText,
  trimString,
} from "./shared.js";
import { fetchProductsCatalog } from "./retrieval-data.js";
import {
  normalizeHospitalAliasKey,
  normalizeHospitalNameForMatch,
  normalizeProductFamilyKey,
  normalizeProductNameForMatch,
} from "../../domain/entity-matchers.js";

function isProductHospitalRequest(message, _questionJudgment, productNamedRequested) {
  if (!productNamedRequested) {
    return false;
  }
  return containsAnyKeyword(normalizeQuestionText(message), PRODUCT_HOSPITAL_SCOPE_KEYWORDS);
}

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

export function extractHospitalMentionTokens(message) {
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

export function matchNamedProductsFromCatalog(message, productCatalog, cap = ON_DEMAND_PRODUCT_NAMED_SAFE_CAP) {
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

export async function resolveProductNamedRequestContext({
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

export function resolveHospitalNamedRequestContext({
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

export function resolveProductHospitalRequestContext({
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
