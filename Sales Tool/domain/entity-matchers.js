function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeTextForLookup(value) {
  return trimString(value)
    .toLocaleLowerCase()
    .replace(/\s+/g, "");
}

export function normalizeProductNameForMatch(value) {
  return normalizeTextForLookup(value).replace(/[()（）\[\]【】\-_.·,，。:：;；/\\]/g, "");
}

export function normalizeProductFamilyKey(value) {
  const normalized = normalizeProductNameForMatch(value);
  if (!normalized) {
    return "";
  }
  const stripped = normalized
    .replace(/(?<![a-z])[x×*]\d+(?:\.\d+)?$/i, "")
    .replace(/(?:\d+(?:\.\d+)?(?:mg|g|kg|ml|l|iu|u|%)?)$/i, "")
    .replace(/(?:\d+)(?:支|盒|瓶|片|粒|针|袋|ml|mg|g|iu|u)?$/i, "");
  return stripped || normalized;
}

export function normalizeHospitalNameForMatch(value) {
  return normalizeTextForLookup(value).replace(/[()（）\[\]【】\-_.·,，。:：;；/\\]/g, "");
}

export function normalizeHospitalAliasKey(value) {
  return normalizeHospitalNameForMatch(value).replace(
    /(有限责任公司|有限公司|医疗美容|医疗|美容|门诊部|门诊|诊所|医院|机构|中心|集团|股份|连锁)/g,
    "",
  );
}

export function buildHospitalNamedCandidates(rows) {
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

export function resolveHospitalNamedMatches(requestedHospitals, candidateRows) {
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
