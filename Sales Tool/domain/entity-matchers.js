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
