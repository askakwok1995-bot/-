import {
  trimString,
  normalizeBusinessSnapshot,
  normalizeNumericValue,
} from "./shared.js";
import {
  buildHospitalNamedCandidates,
  normalizeProductNameForMatch,
  resolveHospitalNamedMatches,
} from "../../domain/entity-matchers.js";

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
  const normalizedSnapshot = normalizeBusinessSnapshot(snapshot);
  const overview = normalizedSnapshot?.performance_overview;
  const coverageCode = trimString(overview?.product_coverage_code).toLocaleLowerCase();
  if (coverageCode === "full" || coverageCode === "partial" || coverageCode === "none") {
    return coverageCode;
  }
  const catalogCountValue = normalizeNumericValue(overview?.product_catalog_count_value);
  const rows = Array.isArray(normalizedSnapshot?.product_performance) ? normalizedSnapshot.product_performance : [];
  const fallbackSnapshotCount = rows.length;
  const snapshotCountValue = normalizeNumericValue(overview?.product_snapshot_count_value);
  return resolveProductCoverageCode(
    catalogCountValue === null ? 0 : catalogCountValue,
    snapshotCountValue === null ? fallbackSnapshotCount : snapshotCountValue,
  );
}

export function resolveProductNamedSupportCode(snapshot, requestedProducts) {
  const normalizedSnapshot = normalizeBusinessSnapshot(snapshot);
  const targets = Array.isArray(requestedProducts) ? requestedProducts : [];
  if (targets.length === 0) {
    return "none";
  }

  const rows = Array.isArray(normalizedSnapshot?.product_performance) ? normalizedSnapshot.product_performance : [];
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
  const normalizedSnapshot = normalizeBusinessSnapshot(snapshot);
  const overview = normalizedSnapshot?.performance_overview;
  const supportCode = trimString(overview?.product_hospital_support_code).toLocaleLowerCase();
  if (supportCode === "full" || supportCode === "partial" || supportCode === "none") {
    return supportCode;
  }
  return "none";
}

export function resolveHospitalMonthlySupportCode(snapshot) {
  const normalizedSnapshot = normalizeBusinessSnapshot(snapshot);
  const rows = Array.isArray(normalizedSnapshot?.hospital_performance) ? normalizedSnapshot.hospital_performance : [];
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

export function resolveHospitalNamedSupportCode(snapshot, requestedHospitals) {
  const normalizedSnapshot = normalizeBusinessSnapshot(snapshot);
  const requested = Array.isArray(requestedHospitals) ? requestedHospitals : [];
  if (requested.length === 0) {
    return "none";
  }
  const rows = Array.isArray(normalizedSnapshot?.hospital_performance) ? normalizedSnapshot.hospital_performance : [];
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
