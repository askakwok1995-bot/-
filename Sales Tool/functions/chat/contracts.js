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
  void value;
  return CHAT_MODES.AUTO;
}

export function isStructuredChatMode(mode) {
  normalizeChatMode(mode);
  return false;
}

export function resolveAnswerStyle(mode) {
  normalizeChatMode(mode);
  return ANSWER_STYLES.NATURAL;
}

export function buildBusinessIntent(mode) {
  normalizeChatMode(mode);
  return "chat";
}
