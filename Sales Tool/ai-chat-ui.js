const CHAT_API_KEY = "__SALES_TOOL_AI_CHAT__";
const CHAT_STATES = {
  CLOSED: "closed",
  COMPACT: "compact",
  EXPANDED: "expanded",
};

let initialized = false;

function isValidState(value) {
  return value === CHAT_STATES.CLOSED || value === CHAT_STATES.COMPACT || value === CHAT_STATES.EXPANDED;
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

  const required = Object.entries(dom).filter(([, el]) => !(el instanceof HTMLElement));
  if (required.length > 0) {
    console.warn(
      `[Sales Tool] AI chat UI 初始化失败，缺少 DOM：${required.map(([key]) => key).join(", ")}`,
    );
    return null;
  }

  let state = CHAT_STATES.CLOSED;
  let sendHandler = null;
  let isSending = false;

  const placeholderStatus =
    typeof options.placeholderStatus === "string" && options.placeholderStatus.trim()
      ? options.placeholderStatus.trim()
      : "AI 未接入，当前仅展示交互壳层。";
  const readyStatus =
    typeof options.readyStatus === "string" && options.readyStatus.trim()
      ? options.readyStatus.trim()
      : "已接入预留处理器，可继续联调接口。";

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

  function updateComposerState() {
    const hasHandler = typeof sendHandler === "function";
    dom.sendBtn.disabled = !hasHandler || isSending;
    dom.input.disabled = isSending;
    dom.statusEl.classList.toggle("ai-chat-status-ready", hasHandler);
    dom.statusEl.textContent = hasHandler ? readyStatus : placeholderStatus;
  }

  function scrollMessagesToBottom() {
    dom.messages.scrollTop = dom.messages.scrollHeight;
  }

  function appendMessage(role, text) {
    const message = String(text || "").trim();
    if (!message) return;

    const article = document.createElement("article");
    article.className = "ai-chat-message";
    article.classList.add(role === "user" ? "ai-chat-message--user" : "ai-chat-message--assistant");
    article.textContent = message;
    dom.messages.appendChild(article);
    scrollMessagesToBottom();
  }

  function normalizeReplyText(payload) {
    if (typeof payload === "string") {
      return payload.trim();
    }
    if (!payload || typeof payload !== "object") {
      return "";
    }

    const reply =
      (typeof payload.reply === "string" && payload.reply) ||
      (typeof payload.message === "string" && payload.message) ||
      (typeof payload.text === "string" && payload.text) ||
      "";
    return String(reply).trim();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const text = String(dom.input.value || "").trim();
    if (!text) {
      return;
    }

    if (typeof sendHandler !== "function") {
      dom.statusEl.classList.remove("ai-chat-status-ready");
      dom.statusEl.textContent = placeholderStatus;
      return;
    }

    appendMessage("user", text);
    dom.input.value = "";
    isSending = true;
    updateComposerState();

    try {
      const result = await Promise.resolve(sendHandler(text));
      const replyText = normalizeReplyText(result);
      if (replyText) {
        appendMessage("assistant", replyText);
      }
      dom.statusEl.classList.add("ai-chat-status-ready");
      dom.statusEl.textContent = replyText ? "AI 已回复。" : "处理器已执行，但未返回可显示内容。";
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "请稍后重试";
      dom.statusEl.classList.remove("ai-chat-status-ready");
      dom.statusEl.textContent = `预留处理器执行失败：${message}`;
      appendMessage("assistant", `调用失败：${message}`);
    } finally {
      isSending = false;
      dom.sendBtn.disabled = typeof sendHandler !== "function";
      dom.input.disabled = false;
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
    setSendHandler: (handler) => {
      sendHandler = typeof handler === "function" ? handler : null;
      isSending = false;
      updateComposerState();
    },
  };

  window[CHAT_API_KEY] = api;
  initialized = true;
  updateComposerState();

  if (isValidState(options.initialState) && options.initialState !== CHAT_STATES.CLOSED) {
    applyState(options.initialState);
  } else {
    applyState(CHAT_STATES.CLOSED);
  }

  return api;
}
