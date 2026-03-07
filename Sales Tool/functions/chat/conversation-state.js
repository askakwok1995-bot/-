import { trimString } from "./shared.js";

function normalizeStringArray(value, maxItems = 10) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => trimString(item))
    .filter((item) => item)
    .slice(0, maxItems);
}

export function createEmptyConversationState() {
  return {
    primary_dimension_code: "",
    entity_scope: {
      products: [],
      hospitals: [],
    },
    source_period: "",
  };
}

export function normalizeConversationState(value) {
  const safeValue = value && typeof value === "object" ? value : {};
  const entityScope = safeValue.entity_scope && typeof safeValue.entity_scope === "object" ? safeValue.entity_scope : {};
  return {
    primary_dimension_code: trimString(safeValue.primary_dimension_code),
    entity_scope: {
      products: normalizeStringArray(entityScope.products),
      hospitals: normalizeStringArray(entityScope.hospitals),
    },
    source_period: trimString(safeValue.source_period),
  };
}
