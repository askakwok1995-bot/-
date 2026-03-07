import { trimString } from "./shared.js";

export const CHAT_MODES = Object.freeze({
  AUTO: "auto",
});

export const CHAT_RESPONSE_ACTIONS = Object.freeze({
  NATURAL: "natural_answer",
  STRUCTURED: "structured_answer",
  CLARIFY: "clarify",
});

export const ANSWER_STYLES = Object.freeze({
  NATURAL: "natural",
});

export function normalizeChatMode(value) {
  const candidate = trimString(value).toLocaleLowerCase();
  if (candidate === CHAT_MODES.AUTO) {
    return CHAT_MODES.AUTO;
  }
  return CHAT_MODES.AUTO;
}

export function isValidChatMode(value) {
  const candidate = trimString(value).toLocaleLowerCase();
  return !candidate || candidate === CHAT_MODES.AUTO;
}

export function resolveAnswerStyle(mode) {
  normalizeChatMode(mode);
  return ANSWER_STYLES.NATURAL;
}

export function buildBusinessIntent(mode) {
  normalizeChatMode(mode);
  return "chat";
}
