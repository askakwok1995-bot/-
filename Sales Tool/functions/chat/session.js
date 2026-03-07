import { SESSION_HISTORY_ROLE_SET, SESSION_HISTORY_WINDOW_MAX_ITEMS, trimString } from "./shared.js";

function normalizeSessionHistoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const role = trimString(item.role).toLocaleLowerCase();
  if (!SESSION_HISTORY_ROLE_SET.has(role)) {
    return null;
  }
  const content = trimString(item.content);
  if (!content) {
    return null;
  }
  return { role, content };
}

export function normalizeSessionHistoryWindow(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  const sanitized = history.map((item) => normalizeSessionHistoryItem(item)).filter((item) => item !== null);
  if (sanitized.length <= SESSION_HISTORY_WINDOW_MAX_ITEMS) {
    return sanitized;
  }
  return sanitized.slice(sanitized.length - SESSION_HISTORY_WINDOW_MAX_ITEMS);
}
