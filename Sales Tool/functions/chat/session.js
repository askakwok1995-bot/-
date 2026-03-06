import {
  QUESTION_JUDGMENT_CODES,
  SESSION_EXPLICIT_DIMENSION_KEYWORDS,
  SESSION_FOLLOWUP_CUES,
  SESSION_HARD_TOPIC_SHIFT_CUES,
  SESSION_HISTORY_ROLE_SET,
  SESSION_HISTORY_WINDOW_MAX_ITEMS,
  SESSION_SCOPE_OVERRIDE_CUES,
  SESSION_SCOPE_OVERRIDE_PATTERNS,
  SESSION_SHORT_FOLLOWUP_CUES,
  SESSION_SHORT_FOLLOWUP_PATTERNS,
  containsAnyKeyword,
  containsProductDimensionKeyword,
  normalizeQuestionText,
  trimString,
} from "./shared.js";
import { buildQuestionJudgment } from "./judgment.js";

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

function getPreviousUserMessage(historyWindow, currentMessage = "") {
  const currentText = trimString(currentMessage);
  if (!Array.isArray(historyWindow) || historyWindow.length === 0) {
    return "";
  }
  for (let index = historyWindow.length - 1; index >= 0; index -= 1) {
    const item = historyWindow[index];
    if (!item || item.role !== "user") {
      continue;
    }
    const content = trimString(item.content);
    if (!content) {
      continue;
    }
    if (currentText && content === currentText) {
      continue;
    }
    return content;
  }
  return "";
}

function containsAnyPattern(text, patterns) {
  if (!text || !Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => pattern instanceof RegExp && pattern.test(text));
}

function normalizeShortFollowupText(text) {
  return trimString(text).replace(/[\s，,。！？!?；;：:、]/g, "");
}

function hasShortFollowupSignal(messageText) {
  const text = trimString(messageText);
  if (!text) {
    return false;
  }
  const normalizedText = normalizeShortFollowupText(text);
  if (!normalizedText) {
    return false;
  }
  const hasExactCue = SESSION_SHORT_FOLLOWUP_CUES.some((cue) => normalizeShortFollowupText(cue) === normalizedText);
  if (hasExactCue) {
    return true;
  }
  return containsAnyPattern(text, SESSION_SHORT_FOLLOWUP_PATTERNS);
}

function hasFollowupSignal(messageText) {
  const text = trimString(messageText);
  if (!text) {
    return false;
  }
  return containsAnyKeyword(text, SESSION_FOLLOWUP_CUES) || hasShortFollowupSignal(text);
}

function hasScopeOverrideSignal(messageText) {
  const text = trimString(messageText);
  if (!text) {
    return false;
  }
  return containsAnyKeyword(text, SESSION_SCOPE_OVERRIDE_CUES) || containsAnyPattern(text, SESSION_SCOPE_OVERRIDE_PATTERNS);
}

function hasHardTopicShiftSignal(messageText) {
  return containsAnyKeyword(trimString(messageText), SESSION_HARD_TOPIC_SHIFT_CUES);
}

function resolveExplicitDimensionCode(messageText) {
  const text = trimString(messageText);
  if (!text) {
    return "";
  }
  if (containsProductDimensionKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.product)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.PRODUCT;
  }
  if (containsAnyKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.hospital)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL;
  }
  if (containsAnyKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.trend)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.TREND;
  }
  if (containsAnyKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.risk_opportunity)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.RISK_OPPORTUNITY;
  }
  if (containsAnyKeyword(text, SESSION_EXPLICIT_DIMENSION_KEYWORDS.overall)) {
    return QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL;
  }
  return "";
}

function hasExplicitDimensionSignal(messageText) {
  return Boolean(resolveExplicitDimensionCode(messageText));
}

function detectTopicShift(messageText, questionJudgment, previousQuestionJudgment, scopeOverrideDetected) {
  const relevanceCode = trimString(questionJudgment?.relevance?.code);
  if (relevanceCode === QUESTION_JUDGMENT_CODES.relevance.IRRELEVANT) {
    return true;
  }
  if (hasHardTopicShiftSignal(messageText)) {
    return true;
  }
  if (!previousQuestionJudgment || typeof previousQuestionJudgment !== "object") {
    return false;
  }

  const currentDimension = trimString(questionJudgment?.primary_dimension?.code);
  const previousDimension = trimString(previousQuestionJudgment?.primary_dimension?.code);
  if (!currentDimension || !previousDimension || currentDimension === previousDimension) {
    return false;
  }

  const explicitDimension = resolveExplicitDimensionCode(messageText);
  if (!explicitDimension) {
    return false;
  }

  if (scopeOverrideDetected && explicitDimension === previousDimension) {
    return false;
  }
  return explicitDimension !== previousDimension;
}

function judgeIsFollowup(messageText, previousUserText, scopeOverrideDetected) {
  const previousText = trimString(previousUserText);
  if (!previousText) {
    return false;
  }
  if (hasFollowupSignal(messageText)) {
    return true;
  }
  return Boolean(scopeOverrideDetected);
}

function judgeInheritPrimaryDimension(messageText, isFollowup, topicShiftDetected, currentQuestionJudgment, previousQuestionJudgment) {
  if (!isFollowup || topicShiftDetected) {
    return false;
  }
  const currentDimension = trimString(currentQuestionJudgment?.primary_dimension?.code);
  const previousDimension = trimString(previousQuestionJudgment?.primary_dimension?.code);
  if (currentDimension && previousDimension && currentDimension === previousDimension) {
    return true;
  }
  if (hasShortFollowupSignal(messageText) && !hasExplicitDimensionSignal(messageText)) {
    return true;
  }
  return false;
}

function judgeInheritScope(messageText, isFollowup, topicShiftDetected, scopeOverrideDetected) {
  if (!isFollowup || topicShiftDetected) {
    return false;
  }
  if (scopeOverrideDetected) {
    return false;
  }
  return true;
}

export function buildSessionState(message, historyWindow, questionJudgment) {
  const messageText = normalizeQuestionText(message);
  const previousUserText = getPreviousUserMessage(historyWindow, message);
  const previousQuestionJudgment = previousUserText ? buildQuestionJudgment(previousUserText) : null;
  const scopeOverrideDetected = hasScopeOverrideSignal(messageText);
  const topicShiftDetected = detectTopicShift(messageText, questionJudgment, previousQuestionJudgment, scopeOverrideDetected);
  const isFollowup = judgeIsFollowup(messageText, previousUserText, scopeOverrideDetected);

  let inheritPrimaryDimension = judgeInheritPrimaryDimension(
    messageText,
    isFollowup,
    topicShiftDetected,
    questionJudgment,
    previousQuestionJudgment,
  );
  let inheritScope = judgeInheritScope(messageText, isFollowup, topicShiftDetected, scopeOverrideDetected);

  if (topicShiftDetected) {
    inheritPrimaryDimension = false;
    inheritScope = false;
  }
  if (!isFollowup) {
    inheritPrimaryDimension = false;
    inheritScope = false;
  }

  return {
    is_followup: isFollowup,
    inherit_primary_dimension: inheritPrimaryDimension,
    inherit_scope: inheritScope,
    topic_shift_detected: topicShiftDetected,
  };
}
