import { trimString } from "./shared.js";

export const CHAT_MODES = Object.freeze({
  AUTO: "auto",
  BRIEFING: "briefing",
  DIAGNOSIS: "diagnosis",
  ACTION_PLAN: "action-plan",
});

export const CHAT_RESPONSE_ACTIONS = Object.freeze({
  NATURAL: "natural_answer",
  STRUCTURED: "structured_answer",
  CLARIFY: "clarify",
});

export const ANSWER_STYLES = Object.freeze({
  NATURAL: "natural",
  BRIEFING: "briefing",
  DIAGNOSIS: "diagnosis",
  ACTION_PLAN: "action_plan",
});

export function normalizeChatMode(value) {
  const candidate = trimString(value).toLocaleLowerCase();
  if (candidate === CHAT_MODES.BRIEFING || candidate === CHAT_MODES.DIAGNOSIS || candidate === CHAT_MODES.ACTION_PLAN) {
    return candidate;
  }
  return CHAT_MODES.AUTO;
}

export function isStructuredChatMode(mode) {
  const safeMode = normalizeChatMode(mode);
  return safeMode === CHAT_MODES.BRIEFING || safeMode === CHAT_MODES.DIAGNOSIS || safeMode === CHAT_MODES.ACTION_PLAN;
}

export function resolveAnswerStyle(mode) {
  const safeMode = normalizeChatMode(mode);
  if (safeMode === CHAT_MODES.BRIEFING) {
    return ANSWER_STYLES.BRIEFING;
  }
  if (safeMode === CHAT_MODES.DIAGNOSIS) {
    return ANSWER_STYLES.DIAGNOSIS;
  }
  if (safeMode === CHAT_MODES.ACTION_PLAN) {
    return ANSWER_STYLES.ACTION_PLAN;
  }
  return ANSWER_STYLES.NATURAL;
}

export function buildBusinessIntent(mode) {
  const safeMode = normalizeChatMode(mode);
  if (safeMode === CHAT_MODES.AUTO) {
    return "chat";
  }
  return safeMode;
}
