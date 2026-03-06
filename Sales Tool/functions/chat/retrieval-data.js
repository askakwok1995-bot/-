import {
  ON_DEMAND_MAX_WINDOW_MONTHS,
  QUESTION_JUDGMENT_CODES,
  SUPABASE_DATA_MAX_PAGES,
  SUPABASE_DATA_PAGE_SIZE,
  SUPABASE_DATA_UPSTREAM_TIMEOUT_MS,
  extractYmFromDate,
  fetchWithTimeout,
  getEnvString,
  isValidYm,
  listYmRange,
  normalizeNumericValue,
  parseJsonSafe,
  roundToTwo,
  trimString,
} from "./shared.js";
import { normalizeTextForLookup } from "../../domain/entity-matchers.js";

export function createInitialRetrievalState() {
  return {
    triggered: false,
    target_dimension: "",
    success: false,
    window_capped: false,
    degraded_to_bounded: false,
  };
}

export function resolveTargetDimensionForEnhancement(primaryDimensionCode) {
  const code = trimString(primaryDimensionCode);
  if (code && code !== QUESTION_JUDGMENT_CODES.primary_dimension.OTHER) {
    return code;
  }
  return QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
}

export function resolveRetrievalWindowFromSnapshot(snapshot) {
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

export async function fetchSupabaseRestRows(pathWithQuery, token, env) {
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

export function mapFetchedSalesRecord(row, monthSet) {
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

export async function fetchSalesRecordsByWindow(windowInfo, token, env) {
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

export async function fetchProductsCatalog(token, env) {
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

export function buildProductsNameMap(catalog) {
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
