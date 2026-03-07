import { trimString } from "./shared.js";

function createEmptyRequestedTimeWindow() {
  return {
    kind: "none",
    label: "",
    start_month: "",
    end_month: "",
    period: "",
    anchor_mode: "none",
  };
}

function cloneRequestedTimeWindow(value) {
  const safeValue = value && typeof value === "object" ? value : {};
  return {
    kind: trimString(safeValue.kind) || "none",
    label: trimString(safeValue.label),
    start_month: trimString(safeValue.start_month),
    end_month: trimString(safeValue.end_month),
    period: trimString(safeValue.period),
    anchor_mode: trimString(safeValue.anchor_mode) || "none",
  };
}

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
    requested_time_window: createEmptyRequestedTimeWindow(),
    comparison_time_window: createEmptyRequestedTimeWindow(),
    time_compare_mode: "none",
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
    requested_time_window: cloneRequestedTimeWindow(safeValue.requested_time_window),
    comparison_time_window: cloneRequestedTimeWindow(safeValue.comparison_time_window),
    time_compare_mode: trimString(safeValue.time_compare_mode) || "none",
    entity_scope: {
      products: normalizeStringArray(entityScope.products),
      hospitals: normalizeStringArray(entityScope.hospitals),
    },
    source_period: trimString(safeValue.source_period),
  };
}
