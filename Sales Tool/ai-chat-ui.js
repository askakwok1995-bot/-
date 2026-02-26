const CHAT_API_KEY = "__SALES_TOOL_AI_CHAT__";
const CHAT_STATES = {
  CLOSED: "closed",
  COMPACT: "compact",
  EXPANDED: "expanded",
};
const CHAT_MODES = {
  BRIEFING: "briefing",
  DIAGNOSIS: "diagnosis",
  ACTION_PLAN: "action-plan",
};
const CHAT_FORMAT_REASONS = {
  STRUCTURED_OK: "structured_ok",
  JSON_PARSE_FAILED: "json_parse_failed",
  SCHEMA_INVALID: "schema_invalid",
  OUTPUT_TRUNCATED: "output_truncated",
  EMPTY_REPLY: "empty_reply",
};

let initialized = false;

function isValidState(value) {
  return value === CHAT_STATES.CLOSED || value === CHAT_STATES.COMPACT || value === CHAT_STATES.EXPANDED;
}

function isValidMode(value) {
  return value === CHAT_MODES.BRIEFING || value === CHAT_MODES.DIAGNOSIS || value === CHAT_MODES.ACTION_PLAN;
}

function normalizeMode(value) {
  const candidate = String(value || "").trim();
  return isValidMode(candidate) ? candidate : CHAT_MODES.BRIEFING;
}

function getModeLabel(mode) {
  if (mode === CHAT_MODES.DIAGNOSIS) return "诊断";
  if (mode === CHAT_MODES.ACTION_PLAN) return "行动";
  return "简报";
}

function toText(value) {
  return String(value || "").trim();
}

function normalizeFormatReason(value) {
  const candidate = toText(value);
  const allowed = Object.values(CHAT_FORMAT_REASONS);
  return allowed.includes(candidate) ? candidate : CHAT_FORMAT_REASONS.JSON_PARSE_FAILED;
}

function getFormatReasonLabel(reason) {
  const safeReason = normalizeFormatReason(reason);
  if (safeReason === CHAT_FORMAT_REASONS.SCHEMA_INVALID) return "结构化字段不完整";
  if (safeReason === CHAT_FORMAT_REASONS.OUTPUT_TRUNCATED) return "输出被截断";
  if (safeReason === CHAT_FORMAT_REASONS.EMPTY_REPLY) return "输出为空";
  if (safeReason === CHAT_FORMAT_REASONS.STRUCTURED_OK) return "结构化成功";
  return "结构化解析失败";
}

function looksLikeJsonFragment(text) {
  const safeText = toText(text);
  if (!safeText || !safeText.startsWith("{")) {
    return false;
  }

  try {
    JSON.parse(safeText);
    return false;
  } catch (_error) {
    return true;
  }
}

function normalizeStringList(value, maxItems = 6) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toText(item))
    .filter((item) => item)
    .slice(0, maxItems);
}

function normalizeEvidenceList(value, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const label = toText(item.label);
      const rawValue = item.value;
      const valueText =
        typeof rawValue === "number" || typeof rawValue === "string" ? toText(rawValue) : toText(item.valueText);
      const insight = toText(item.insight);
      if (!label || !valueText) return null;
      return { label, value: valueText, insight };
    })
    .filter((item) => item !== null)
    .slice(0, maxItems);
}

function normalizeActionList(value, maxItems = 6) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = toText(item.title);
      if (!title) return null;
      return {
        title,
        owner: toText(item.owner),
        timeline: toText(item.timeline),
        metric: toText(item.metric),
      };
    })
    .filter((item) => item !== null)
    .slice(0, maxItems);
}

function normalizeStructuredPayload(value) {
  if (!value || typeof value !== "object") return null;
  const summary = toText(value.summary);
  if (!summary) return null;

  return {
    summary,
    highlights: normalizeStringList(value.highlights, 6),
    evidence: normalizeEvidenceList(value.evidence, 8),
    risks: normalizeStringList(value.risks, 6),
    actions: normalizeActionList(value.actions, 6),
    nextQuestions: normalizeStringList(value.nextQuestions, 6),
  };
}

function buildActionMeta(action) {
  const parts = [];
  if (action.owner) parts.push(`负责人：${action.owner}`);
  if (action.timeline) parts.push(`时间：${action.timeline}`);
  if (action.metric) parts.push(`指标：${action.metric}`);
  return parts.join(" | ");
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
    modeButtons: Array.from(document.querySelectorAll(".ai-chat-mode-btn[data-chat-mode]")),
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
  let currentMode = normalizeMode(options.initialMode);
  let sendHandler = null;
  let isSending = false;

  const placeholderStatus =
    typeof options.placeholderStatus === "string" && options.placeholderStatus.trim()
      ? options.placeholderStatus.trim()
      : "聊天接口已接线；请先登录并完成服务端 Gemini 配置。";
  const readyStatus =
    typeof options.readyStatus === "string" && options.readyStatus.trim()
      ? options.readyStatus.trim()
      : "聊天接口已就绪，可开始提问。";

  function updateResizeControl() {
    if (state === CHAT_STATES.EXPANDED) {
      dom.resizeBtn.setAttribute("data-mode", "shrink");
      dom.resizeBtn.setAttribute("aria-label", "缩小对话窗口");
      return;
    }

    dom.resizeBtn.setAttribute("data-mode", "expand");
    dom.resizeBtn.setAttribute("aria-label", "放大对话窗口");
  }

  function updateModeControls() {
    dom.modeButtons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const buttonMode = normalizeMode(button.dataset.chatMode);
      const isActive = buttonMode === currentMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function setMode(nextMode) {
    currentMode = normalizeMode(nextMode);
    updateModeControls();
  }

  function getMode() {
    return currentMode;
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

  function appendTextMessage(role, text) {
    const message = toText(text);
    if (!message) return;

    const article = document.createElement("article");
    article.className = "ai-chat-message";
    article.classList.add(role === "user" ? "ai-chat-message--user" : "ai-chat-message--assistant");
    article.textContent = message;
    dom.messages.appendChild(article);
    scrollMessagesToBottom();
  }

  function appendStructuredAssistantMessage(structured, mode) {
    const normalized = normalizeStructuredPayload(structured);
    if (!normalized) return false;

    const article = document.createElement("article");
    article.className = "ai-chat-message ai-chat-message--assistant ai-chat-structured";

    const summary = document.createElement("p");
    summary.className = "ai-chat-structured-summary";
    summary.textContent = normalized.summary;
    article.appendChild(summary);

    const sections = [
      { title: "亮点", key: "highlights" },
      { title: "风险", key: "risks" },
      { title: "追问建议", key: "nextQuestions" },
    ];

    sections.forEach((item) => {
      const values = normalized[item.key];
      if (!Array.isArray(values) || values.length === 0) return;
      const section = document.createElement("section");
      section.className = "ai-chat-structured-section";
      const title = document.createElement("h4");
      title.className = "ai-chat-structured-title";
      title.textContent = item.title;
      section.appendChild(title);
      const list = document.createElement("ul");
      list.className = "ai-chat-structured-list";
      values.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        list.appendChild(li);
      });
      section.appendChild(list);
      article.appendChild(section);
    });

    if (normalized.evidence.length > 0) {
      const section = document.createElement("section");
      section.className = "ai-chat-structured-section";
      const title = document.createElement("h4");
      title.className = "ai-chat-structured-title";
      title.textContent = "关键证据";
      section.appendChild(title);
      const list = document.createElement("ul");
      list.className = "ai-chat-structured-list";
      normalized.evidence.forEach((item) => {
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.className = "ai-chat-structured-evidence-label";
        label.textContent = `${item.label}：`;
        li.appendChild(label);
        li.appendChild(document.createTextNode(`${item.value}`));
        if (item.insight) {
          li.appendChild(document.createTextNode(`（${item.insight}）`));
        }
        list.appendChild(li);
      });
      section.appendChild(list);
      article.appendChild(section);
    }

    if (normalized.actions.length > 0) {
      const section = document.createElement("section");
      section.className = "ai-chat-structured-section";
      const title = document.createElement("h4");
      title.className = "ai-chat-structured-title";
      title.textContent = "执行动作";
      section.appendChild(title);
      const list = document.createElement("ul");
      list.className = "ai-chat-structured-list";
      normalized.actions.forEach((item) => {
        const li = document.createElement("li");
        const actionTitle = document.createElement("div");
        actionTitle.className = "ai-chat-structured-action-title";
        actionTitle.textContent = item.title;
        li.appendChild(actionTitle);
        const metaText = buildActionMeta(item);
        if (metaText) {
          const meta = document.createElement("div");
          meta.className = "ai-chat-structured-action-meta";
          meta.textContent = metaText;
          li.appendChild(meta);
        }
        list.appendChild(li);
      });
      section.appendChild(list);
      article.appendChild(section);
    }

    article.dataset.chatMode = normalizeMode(mode);
    dom.messages.appendChild(article);
    scrollMessagesToBottom();
    return true;
  }

  function normalizeReplyPayload(payload) {
    if (typeof payload === "string") {
      return {
        reply: payload.trim(),
        structured: null,
        mode: currentMode,
        format: "text_fallback",
        requestId: "",
        meta: null,
        fallbackNotice: "",
      };
    }
    if (!payload || typeof payload !== "object") {
      return {
        reply: "",
        structured: null,
        mode: currentMode,
        format: "text_fallback",
        requestId: "",
        meta: null,
        fallbackNotice: "",
      };
    }

    const reply =
      toText(payload.reply) ||
      toText(payload.message) ||
      toText(payload.text);
    const structured = normalizeStructuredPayload(payload.structured);
    const mode = normalizeMode(payload.mode || currentMode);
    const format = payload.format === "structured" ? "structured" : "text_fallback";
    const requestId = toText(payload.requestId);
    const rawMeta = payload.meta && typeof payload.meta === "object" ? payload.meta : null;
    const meta = rawMeta
      ? {
          formatReason: normalizeFormatReason(rawMeta.formatReason),
          retryCount: Number(rawMeta.retryCount) === 1 ? 1 : 0,
        }
      : null;
    return {
      reply,
      structured,
      mode,
      format,
      requestId,
      meta,
      fallbackNotice: toText(payload.fallbackNotice),
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const text = toText(dom.input.value);
    if (!text) {
      return;
    }

    if (typeof sendHandler !== "function") {
      dom.statusEl.classList.remove("ai-chat-status-ready");
      dom.statusEl.textContent = placeholderStatus;
      return;
    }

    appendTextMessage("user", text);
    dom.input.value = "";
    isSending = true;
    updateComposerState();

    try {
      const result = await Promise.resolve(sendHandler(text, { mode: currentMode }));
      const normalized = normalizeReplyPayload(result);
      let hasRendered = false;

      if (normalized.structured) {
        hasRendered = appendStructuredAssistantMessage(normalized.structured, normalized.mode);
      }
      if (!hasRendered && normalized.reply) {
        appendTextMessage("assistant", normalized.reply);
        hasRendered = true;
      }

      dom.statusEl.classList.add("ai-chat-status-ready");
      if (normalized.format === "text_fallback") {
        let fallbackStatus = normalized.fallbackNotice;
        if (!fallbackStatus && normalized.meta) {
          fallbackStatus = `已回退文本显示：${getFormatReasonLabel(normalized.meta.formatReason)}（原因码: ${normalized.meta.formatReason}）`;
        }
        if (looksLikeJsonFragment(normalized.reply)) {
          fallbackStatus = "结构化输出未完成，请重试。";
        }
        if (normalized.requestId && !fallbackStatus.includes("请求号")) {
          fallbackStatus = fallbackStatus
            ? `${fallbackStatus}（请求号: ${normalized.requestId}）`
            : `已回退文本显示（请求号: ${normalized.requestId}）。`;
        }
        dom.statusEl.textContent = fallbackStatus || "已回退文本显示。";
      } else {
        dom.statusEl.textContent = hasRendered
          ? `AI 已按${getModeLabel(normalized.mode)}模式回复。`
          : "处理器已执行，但未返回可显示内容。";
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "请稍后重试";
      dom.statusEl.classList.remove("ai-chat-status-ready");
      dom.statusEl.textContent = `预留处理器执行失败：${message}`;
      appendTextMessage("assistant", `调用失败：${message}`);
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

  dom.modeButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setMode(button.dataset.chatMode);
    });
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
    getMode,
    setMode,
    setSendHandler: (handler) => {
      sendHandler = typeof handler === "function" ? handler : null;
      isSending = false;
      updateComposerState();
    },
  };

  window[CHAT_API_KEY] = api;
  initialized = true;
  updateComposerState();
  updateModeControls();

  if (isValidState(options.initialState) && options.initialState !== CHAT_STATES.CLOSED) {
    applyState(options.initialState);
  } else {
    applyState(CHAT_STATES.CLOSED);
  }

  return api;
}
