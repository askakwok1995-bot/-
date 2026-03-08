const CHAT_API_KEY = "__SALES_TOOL_AI_CHAT__";
const CHAT_STATES = {
  CLOSED: "closed",
  COMPACT: "compact",
  EXPANDED: "expanded",
};
const CHAT_HISTORY_MAX_ROUNDS = 6;
const CHAT_HISTORY_MAX_ITEMS = CHAT_HISTORY_MAX_ROUNDS * 2;
const CHAT_FAILURE_COOLDOWN_SHORT_SEC = 3;
const CHAT_FAILURE_COOLDOWN_LONG_SEC = 5;
const CHAT_SYSTEM_INTRO_ATTR = "data-chat-system-intro";
const REPORT_START_MONTH_INPUT_ID = "report-start-month";
const REPORT_END_MONTH_INPUT_ID = "report-end-month";

let initialized = false;

function isValidState(value) {
  return value === CHAT_STATES.CLOSED || value === CHAT_STATES.COMPACT || value === CHAT_STATES.EXPANDED;
}

function toText(value) {
  return String(value || "").trim();
}

function appendInlineMarkdown(container, content) {
  const safeContent = String(content || "");
  if (!safeContent) {
    return;
  }

  const markerPattern = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__)/g;
  let matched = markerPattern.exec(safeContent);
  if (!matched) {
    container.appendChild(document.createTextNode(safeContent));
    return;
  }

  let lastIndex = 0;
  while (matched) {
    const start = matched.index;
    if (start > lastIndex) {
      container.appendChild(document.createTextNode(safeContent.slice(lastIndex, start)));
    }

    const token = matched[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      const inlineCode = document.createElement("code");
      inlineCode.className = "ai-chat-md-inline-code";
      inlineCode.textContent = token.slice(1, -1);
      container.appendChild(inlineCode);
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      container.appendChild(strong);
    } else {
      container.appendChild(document.createTextNode(token));
    }

    lastIndex = markerPattern.lastIndex;
    matched = markerPattern.exec(safeContent);
  }

  if (lastIndex < safeContent.length) {
    container.appendChild(document.createTextNode(safeContent.slice(lastIndex)));
  }
}

function isMarkdownBlockStarter(line) {
  const safeLine = String(line || "");
  return (
    /^\s*#{1,4}\s+/.test(safeLine) ||
    /^\s*>\s?/.test(safeLine) ||
    /^\s*[-*+]\s+/.test(safeLine) ||
    /^\s*\d+\.\s+/.test(safeLine) ||
    /^\s*```/.test(safeLine)
  );
}

function renderTextWithMarkdownMarkers(container, text) {
  if (!(container instanceof HTMLElement)) return;
  const content = String(text || "").replace(/\r\n?/g, "\n");
  if (!content) {
    container.textContent = "";
    return;
  }

  container.textContent = "";
  const lines = content.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (/^\s*$/.test(line)) {
      index += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && /^\s*```/.test(lines[index])) {
        index += 1;
      }

      const pre = document.createElement("pre");
      pre.className = "ai-chat-md-code-block ai-chat-md-block";
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }

    const headingMatched = line.match(/^\s*(#{1,4})\s+(.+)\s*$/);
    if (headingMatched) {
      const headingLevel = Math.min(4, headingMatched[1].length);
      const heading = document.createElement("div");
      heading.className = `ai-chat-md-heading ai-chat-md-heading-${headingLevel} ai-chat-md-block`;
      appendInlineMarkdown(heading, headingMatched[2]);
      container.appendChild(heading);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = document.createElement("blockquote");
      quote.className = "ai-chat-md-quote ai-chat-md-block";
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        const quoteLine = lines[index].replace(/^\s*>\s?/, "");
        appendInlineMarkdown(quote, quoteLine);
        if (index < lines.length - 1 && /^\s*>\s?/.test(lines[index + 1])) {
          quote.appendChild(document.createElement("br"));
        }
        index += 1;
      }
      container.appendChild(quote);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const list = document.createElement("ul");
      list.className = "ai-chat-md-list ai-chat-md-list-ul ai-chat-md-block";
      while (index < lines.length) {
        const itemMatched = lines[index].match(/^\s*[-*+]\s+(.+)\s*$/);
        if (!itemMatched) break;
        const li = document.createElement("li");
        appendInlineMarkdown(li, itemMatched[1]);
        list.appendChild(li);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = document.createElement("ol");
      list.className = "ai-chat-md-list ai-chat-md-list-ol ai-chat-md-block";
      while (index < lines.length) {
        const itemMatched = lines[index].match(/^\s*\d+\.\s+(.+)\s*$/);
        if (!itemMatched) break;
        const li = document.createElement("li");
        appendInlineMarkdown(li, itemMatched[1]);
        list.appendChild(li);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && !/^\s*$/.test(lines[index]) && !isMarkdownBlockStarter(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    if (paragraphLines.length > 0) {
      const paragraph = document.createElement("p");
      paragraph.className = "ai-chat-md-paragraph ai-chat-md-block";
      paragraphLines.forEach((paragraphLine, lineIndex) => {
        appendInlineMarkdown(paragraph, paragraphLine);
        if (lineIndex < paragraphLines.length - 1) {
          paragraph.appendChild(document.createElement("br"));
        }
      });
      container.appendChild(paragraph);
      continue;
    }

    index += 1;
  }
}

function isValidHistoryRole(value) {
  return value === "user" || value === "assistant";
}

const ASSISTANT_HISTORY_TERM_RE = /([A-Za-z0-9\u4e00-\u9fa5]{1,12}(?:覆盖率|占比|集中度|贡献|趋势))/gu;

function normalizeAssistantAnchorTerm(term) {
  let next = toText(term);
  if (!next) {
    return "";
  }
  const prefixPatterns = [/^但/u, /^存在/u, /^部分医院/u, /^部分产品/u, /^部分/u, /^整体/u, /^当前/u, /^最近/u, /^主要/u, /^核心/u];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of prefixPatterns) {
      const trimmed = next.replace(pattern, "");
      if (trimmed !== next && toText(trimmed)) {
        next = toText(trimmed);
        changed = true;
      }
    }
  }
  return next;
}

export function extractAssistantAnchorTerms(text) {
  const content = toText(text);
  if (!content) {
    return [];
  }
  const terms = [];
  const seen = new Set();
  let matched = ASSISTANT_HISTORY_TERM_RE.exec(content);
  while (matched) {
    const term = normalizeAssistantAnchorTerm(matched[1]);
    if (term && !seen.has(term)) {
      seen.add(term);
      terms.push(term);
      if (terms.length >= 4) {
        break;
      }
    }
    matched = ASSISTANT_HISTORY_TERM_RE.exec(content);
  }
  return terms;
}

export function buildAssistantHistoryText(answer, replyText = "") {
  const summary = toText(answer?.summary || replyText);
  const fullReply = toText(replyText);
  if (!summary && !fullReply) {
    return "";
  }
  const anchorTerms = extractAssistantAnchorTerms(fullReply);
  if (anchorTerms.length === 0) {
    return summary || fullReply;
  }
  const missingTerms = anchorTerms.filter((term) => !summary.includes(term));
  if (missingTerms.length === 0) {
    return summary || fullReply;
  }
  return `${summary || fullReply} 术语：${missingTerms.join("、")}。`;
}

export function rollbackFailedUserHistory(historyItems, failedText) {
  const safeHistory = Array.isArray(historyItems) ? historyItems.map((item) => ({ ...item })) : [];
  const expectedText = toText(failedText);
  if (!expectedText || safeHistory.length === 0) {
    return safeHistory;
  }
  const lastItem = safeHistory[safeHistory.length - 1];
  if (lastItem?.role === "user" && toText(lastItem?.content) === expectedText) {
    safeHistory.pop();
  }
  return safeHistory;
}

export function initAiChatUi(options = {}) {
  if (initialized && window[CHAT_API_KEY]) {
    return window[CHAT_API_KEY];
  }

  const dom = {
    fab: document.getElementById("ai-chat-fab"),
    backdrop: document.getElementById("ai-chat-backdrop"),
    sheet: document.getElementById("ai-chat-sheet"),
    resizeBtn: document.getElementById("ai-chat-resize-btn"),
    closeBtn: document.getElementById("ai-chat-close-btn"),
    messages: document.getElementById("ai-chat-messages"),
    form: document.getElementById("ai-chat-form"),
    input: document.getElementById("ai-chat-input"),
    sendBtn: document.getElementById("ai-chat-send"),
    statusEl: document.getElementById("ai-chat-status"),
  };

  const required = Object.entries({
    fab: dom.fab,
    backdrop: dom.backdrop,
    sheet: dom.sheet,
    resizeBtn: dom.resizeBtn,
    closeBtn: dom.closeBtn,
    messages: dom.messages,
    form: dom.form,
    input: dom.input,
    sendBtn: dom.sendBtn,
    statusEl: dom.statusEl,
  }).filter(([, el]) => !(el instanceof HTMLElement));
  if (required.length > 0) {
    console.warn(
      `[Sales Tool] AI chat UI 初始化失败，缺少 DOM：${required.map(([key]) => key).join(", ")}`,
    );
    return null;
  }

  let state = CHAT_STATES.CLOSED;
  let sendHandler = null;
  let isSending = false;
  let sessionHistory = [];
  let sessionConversationState = null;
  let consecutiveFailureCount = 0;
  let cooldownUntilMs = 0;
  let cooldownTimerId = 0;

  const serviceUnavailableStatus =
    typeof options.placeholderStatus === "string" && options.placeholderStatus.trim()
      ? options.placeholderStatus.trim()
      : "聊天服务暂不可用，请稍后再试。";

  function showErrorStatus(message) {
    const text = toText(message) || "暂时无法完成本次回答，请稍后重试。";
    dom.statusEl.classList.add("ai-chat-status-error");
    dom.statusEl.textContent = text;
  }

  function clearStatus() {
    dom.statusEl.classList.remove("ai-chat-status-error");
    dom.statusEl.textContent = "";
  }

  function updateResizeControl() {
    if (state === CHAT_STATES.EXPANDED) {
      dom.resizeBtn.setAttribute("data-mode", "shrink");
      dom.resizeBtn.setAttribute("aria-label", "缩小对话窗口");
      return;
    }

    dom.resizeBtn.setAttribute("data-mode", "expand");
    dom.resizeBtn.setAttribute("aria-label", "放大对话窗口");
  }

  function applyState(nextState) {
    if (!isValidState(nextState)) {
      return;
    }

    const prevState = state;
    if (prevState === CHAT_STATES.CLOSED && nextState !== CHAT_STATES.CLOSED) {
      refreshSystemIntro();
    }

    state = nextState;
    const isOpen = state !== CHAT_STATES.CLOSED;
    document.body.classList.toggle("ai-chat-open", isOpen);
    dom.backdrop.hidden = !isOpen;
    dom.sheet.classList.toggle("ai-chat-sheet--open", isOpen);
    dom.sheet.classList.toggle("ai-chat-sheet--compact", state === CHAT_STATES.COMPACT);
    dom.sheet.classList.toggle("ai-chat-sheet--expanded", state === CHAT_STATES.EXPANDED);
    dom.fab.setAttribute("aria-expanded", isOpen ? "true" : "false");
    dom.sheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
    updateResizeControl();
  }

  function cycleState() {
    if (state === CHAT_STATES.CLOSED) {
      applyState(CHAT_STATES.COMPACT);
      return;
    }
    if (state === CHAT_STATES.COMPACT) {
      applyState(CHAT_STATES.EXPANDED);
      return;
    }
    applyState(CHAT_STATES.CLOSED);
  }

  function close() {
    applyState(CHAT_STATES.CLOSED);
  }

  function openCompact() {
    applyState(CHAT_STATES.COMPACT);
  }

  function openExpanded() {
    applyState(CHAT_STATES.EXPANDED);
  }

  function toggleSize() {
    if (state === CHAT_STATES.COMPACT) {
      applyState(CHAT_STATES.EXPANDED);
      return;
    }

    if (state === CHAT_STATES.EXPANDED) {
      applyState(CHAT_STATES.COMPACT);
      return;
    }

    applyState(CHAT_STATES.COMPACT);
  }

  function getCooldownRemainingMs() {
    if (!Number.isFinite(cooldownUntilMs) || cooldownUntilMs <= 0) {
      return 0;
    }
    return Math.max(0, cooldownUntilMs - Date.now());
  }

  function isInCooldown() {
    return getCooldownRemainingMs() > 0;
  }

  function clearCooldownTimer() {
    if (!cooldownTimerId) {
      return;
    }
    window.clearTimeout(cooldownTimerId);
    cooldownTimerId = 0;
  }

  function renderCooldownStatus() {
    const remainingMs = getCooldownRemainingMs();
    if (remainingMs <= 0) {
      return false;
    }
    const remainingSec = Math.ceil(remainingMs / 1000);
    showErrorStatus(`操作过于频繁，请 ${remainingSec} 秒后重试。`);
    return true;
  }

  function scheduleCooldownTick() {
    clearCooldownTimer();
    if (!isInCooldown()) {
      cooldownUntilMs = 0;
      return;
    }

    const tick = () => {
      const hasHandler = typeof sendHandler === "function";
      const cooling = renderCooldownStatus();
      dom.sendBtn.disabled = !hasHandler || isSending || cooling;
      if (!cooling) {
        cooldownUntilMs = 0;
        clearCooldownTimer();
        updateComposerState();
        return;
      }
      cooldownTimerId = window.setTimeout(tick, 250);
    };

    tick();
  }

  function startFailureCooldown(seconds) {
    const safeSeconds = Number(seconds);
    if (!Number.isFinite(safeSeconds) || safeSeconds <= 0) {
      return;
    }
    cooldownUntilMs = Date.now() + Math.floor(safeSeconds * 1000);
    scheduleCooldownTick();
  }

  function resetFailureState() {
    consecutiveFailureCount = 0;
    cooldownUntilMs = 0;
    clearCooldownTimer();
  }

  function updateComposerState() {
    const hasHandler = typeof sendHandler === "function";
    const cooling = isInCooldown();
    dom.sendBtn.disabled = !hasHandler || isSending || cooling;
    dom.input.disabled = isSending;
    if (cooling) {
      renderCooldownStatus();
      return;
    }
    clearStatus();
  }

  function sanitizeHistoryItem(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const role = toText(item.role).toLowerCase();
    if (!isValidHistoryRole(role)) {
      return null;
    }
    const content = toText(item.content);
    if (!content) {
      return null;
    }
    return { role, content };
  }

  function trimHistory(items, maxItems = CHAT_HISTORY_MAX_ITEMS) {
    if (!Array.isArray(items)) {
      return [];
    }
    const sanitized = items.map((item) => sanitizeHistoryItem(item)).filter((item) => item !== null);
    if (sanitized.length <= maxItems) {
      return sanitized;
    }
    return sanitized.slice(sanitized.length - maxItems);
  }

  function pushHistory(role, content) {
    const next = sanitizeHistoryItem({ role, content });
    if (!next) return;
    sessionHistory.push(next);
    sessionHistory = trimHistory(sessionHistory);
  }

  function getSessionHistory() {
    return sessionHistory.map((item) => ({ ...item }));
  }

  function rollbackPendingUserHistory(failedText) {
    sessionHistory = rollbackFailedUserHistory(sessionHistory, failedText);
  }

  function getConversationState() {
    return sessionConversationState && typeof sessionConversationState === "object"
      ? { ...sessionConversationState }
      : null;
  }

  function clearSessionHistory() {
    sessionHistory = [];
    sessionConversationState = null;
    clearStatus();
  }

  function getCurrentReportRange() {
    const startInput = document.getElementById(REPORT_START_MONTH_INPUT_ID);
    const endInput = document.getElementById(REPORT_END_MONTH_INPUT_ID);
    const startYm = startInput instanceof HTMLInputElement ? toText(startInput.value) : "";
    const endYm = endInput instanceof HTMLInputElement ? toText(endInput.value) : "";
    return { startYm, endYm };
  }

  function buildSystemIntroText() {
    const { startYm, endYm } = getCurrentReportRange();
    const periodText =
      startYm && endYm
        ? `当前分析时间范围：${startYm} ~ ${endYm}。`
        : "当前分析时间范围：尚未设置，请先在报表区选择起始月和结束月。";
    return [
      "我是销售分析助手，仅基于当前账号已录入的销售记录、产品主数据和目标配置进行分析。",
      periodText,
      "可在报表区调整起止月后继续提问。",
    ].join("");
  }

  function upsertSystemIntro(text) {
    const message = toText(text);
    if (!message) return;
    let article = dom.messages.querySelector(`article[${CHAT_SYSTEM_INTRO_ATTR}="true"]`);
    if (!(article instanceof HTMLElement)) {
      article = document.createElement("article");
      article.className = "ai-chat-message ai-chat-message--assistant ai-chat-message--system-intro";
      article.setAttribute(CHAT_SYSTEM_INTRO_ATTR, "true");
      dom.messages.prepend(article);
    }
    article.textContent = message;
  }

  function refreshSystemIntro() {
    upsertSystemIntro(buildSystemIntroText());
  }

  function scrollMessagesToBottom() {
    dom.messages.scrollTop = dom.messages.scrollHeight;
  }

  function appendTextMessage(role, text) {
    const message = toText(text);
    if (!message) return;

    const article = document.createElement("article");
    article.className = "ai-chat-message";
    article.classList.add(role === "user" ? "ai-chat-message--user" : "ai-chat-message--assistant");
    if (role === "assistant") {
      renderTextWithMarkdownMarkers(article, message);
    } else {
      article.textContent = message;
    }
    dom.messages.appendChild(article);
    scrollMessagesToBottom();
  }

  function createThinkingMessage() {
    const article = document.createElement("article");
    article.className = "ai-chat-message ai-chat-message--assistant ai-chat-thinking";

    const label = document.createElement("span");
    label.className = "ai-chat-thinking-label";
    label.textContent = "AI 思考中";
    article.appendChild(label);

    const dots = document.createElement("span");
    dots.className = "ai-chat-typing-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i += 1) {
      dots.appendChild(document.createElement("span"));
    }
    article.appendChild(dots);

    dom.messages.appendChild(article);
    scrollMessagesToBottom();

    return {
      article,
      label,
      text: "",
      hasDelta: false,
      isActive: true,
    };
  }

  function updateThinkingLabel(liveMessage, text) {
    if (!liveMessage || !liveMessage.isActive) return;
    const nextText = toText(text) || "AI 思考中";
    if (liveMessage.label instanceof HTMLElement) {
      liveMessage.label.textContent = nextText;
    }
  }

  function setLiveMessageText(liveMessage, text) {
    if (!liveMessage || !liveMessage.isActive) return;
    liveMessage.text = String(text || "");
    liveMessage.article.classList.remove("ai-chat-thinking");
    renderTextWithMarkdownMarkers(liveMessage.article, liveMessage.text || " ");
    scrollMessagesToBottom();
  }

  function appendLiveMessageDelta(liveMessage, deltaText) {
    if (!liveMessage || !liveMessage.isActive) return;
    const delta = typeof deltaText === "string" ? deltaText : String(deltaText || "");
    if (!delta) return;
    liveMessage.hasDelta = true;
    setLiveMessageText(liveMessage, `${liveMessage.text}${delta}`);
  }

  function removeLiveMessage(liveMessage) {
    if (!liveMessage || !liveMessage.isActive) return;
    if (liveMessage.article && liveMessage.article.parentNode === dom.messages) {
      dom.messages.removeChild(liveMessage.article);
    }
    liveMessage.isActive = false;
  }

  function normalizeReplyPayload(payload) {
    if (typeof payload === "string") {
      return {
        reply: payload.trim(),
        requestId: "",
        answer: null,
        conversationState: null,
      };
    }
    if (!payload || typeof payload !== "object") {
      return {
        reply: "",
        requestId: "",
        answer: null,
        conversationState: null,
      };
    }

    const reply =
      toText(payload.reply) ||
      toText(payload.message) ||
      toText(payload.text);
    const answer = payload.answer && typeof payload.answer === "object" ? payload.answer : null;
    const requestId = toText(payload.requestId);
    return {
      reply,
      answer,
      requestId,
      conversationState:
        answer?.conversation_state && typeof answer.conversation_state === "object" ? answer.conversation_state : null,
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isInCooldown()) {
      renderCooldownStatus();
      return;
    }

    const text = toText(dom.input.value);
    if (!text) {
      return;
    }

    if (typeof sendHandler !== "function") {
      showErrorStatus(serviceUnavailableStatus);
      return;
    }

    pushHistory("user", text);
    appendTextMessage("user", text);
    dom.input.value = "";
    isSending = true;
    updateComposerState();
    const liveMessage = createThinkingMessage();
    clearStatus();

    try {
      const result = await Promise.resolve(
        sendHandler(text, {
          history: getSessionHistory(),
          conversationState: getConversationState(),
          onThinking: (message) => {
            updateThinkingLabel(liveMessage, message);
          },
          onDelta: (chunk) => {
            appendLiveMessageDelta(liveMessage, chunk);
          },
        }),
      );
      const normalized = normalizeReplyPayload(result);
      let hasRendered = false;

      if (normalized.reply) {
        setLiveMessageText(liveMessage, normalized.reply);
        hasRendered = true;
      }
      if (!hasRendered) {
        removeLiveMessage(liveMessage);
      }

      if (normalized.conversationState) {
        sessionConversationState = { ...normalized.conversationState };
      }

      const assistantHistoryText = buildAssistantHistoryText(normalized.answer, normalized.reply);
      if (assistantHistoryText) {
        pushHistory("assistant", assistantHistoryText);
      }
      resetFailureState();
      clearStatus();
    } catch (error) {
      rollbackPendingUserHistory(text);
      const message = error instanceof Error && error.message ? error.message : "请稍后重试";
      const userErrorMessage =
        message && message !== "请稍后重试"
          ? `暂时无法完成本次回答，请稍后重试。（${message}）`
          : "暂时无法完成本次回答，请稍后重试。";
      showErrorStatus(userErrorMessage);
      if (!liveMessage.hasDelta) {
        removeLiveMessage(liveMessage);
        appendTextMessage("assistant", userErrorMessage);
      }
      consecutiveFailureCount += 1;
      if (consecutiveFailureCount >= 3) {
        startFailureCooldown(CHAT_FAILURE_COOLDOWN_LONG_SEC);
      } else if (consecutiveFailureCount >= 2) {
        startFailureCooldown(CHAT_FAILURE_COOLDOWN_SHORT_SEC);
      }
    } finally {
      isSending = false;
      dom.sendBtn.disabled = typeof sendHandler !== "function" || isInCooldown();
      dom.input.disabled = false;
      if (isInCooldown()) {
        renderCooldownStatus();
      }
      dom.input.focus();
    }
  }

  dom.fab.addEventListener("click", () => {
    cycleState();
  });

  dom.backdrop.addEventListener("click", () => {
    close();
  });

  dom.resizeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSize();
  });

  dom.closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  dom.sheet.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  dom.form.addEventListener("submit", (event) => {
    void handleSubmit(event);
  });

  const reportStartInput = document.getElementById(REPORT_START_MONTH_INPUT_ID);
  const reportEndInput = document.getElementById(REPORT_END_MONTH_INPUT_ID);
  const bindReportRangeListener = (element) => {
    if (!(element instanceof HTMLInputElement)) return;
    element.addEventListener("input", refreshSystemIntro);
    element.addEventListener("change", refreshSystemIntro);
  };
  bindReportRangeListener(reportStartInput);
  bindReportRangeListener(reportEndInput);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state !== CHAT_STATES.CLOSED) {
      close();
    }
  });

  const api = {
    openCompact,
    openExpanded,
    close,
    getState: () => state,
    getSessionHistory,
    clearSessionHistory,
    setSendHandler: (handler) => {
      sendHandler = typeof handler === "function" ? handler : null;
      isSending = false;
      if (!sendHandler) {
        resetFailureState();
      }
      updateComposerState();
    },
  };

  window[CHAT_API_KEY] = api;
  initialized = true;
  updateComposerState();
  refreshSystemIntro();

  if (isValidState(options.initialState) && options.initialState !== CHAT_STATES.CLOSED) {
    applyState(options.initialState);
  } else {
    applyState(CHAT_STATES.CLOSED);
  }

  return api;
}
