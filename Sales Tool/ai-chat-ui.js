const CHAT_API_KEY = "__SALES_TOOL_AI_CHAT__";
const CHAT_STATES = {
  CLOSED: "closed",
  COMPACT: "compact",
  EXPANDED: "expanded",
};
const CHAT_MODES = {
  AUTO: "auto",
  BRIEFING: "briefing",
  DIAGNOSIS: "diagnosis",
  ACTION_PLAN: "action-plan",
};
const CHAT_RESPONSE_ACTIONS = {
  NATURAL: "natural_answer",
  STRUCTURED: "structured_answer",
  CLARIFY: "clarify",
};
const CHAT_FORMAT_REASONS = {
  STRUCTURED_OK: "structured_ok",
  JSON_PARSE_FAILED: "json_parse_failed",
  SCHEMA_INVALID: "schema_invalid",
  OUTPUT_TRUNCATED: "output_truncated",
  EMPTY_REPLY: "empty_reply",
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

function isValidMode(value) {
  return (
    value === CHAT_MODES.AUTO ||
    value === CHAT_MODES.BRIEFING ||
    value === CHAT_MODES.DIAGNOSIS ||
    value === CHAT_MODES.ACTION_PLAN
  );
}

function normalizeMode(value) {
  const candidate = String(value || "").trim();
  return isValidMode(candidate) ? candidate : CHAT_MODES.AUTO;
}

function getModeLabel(mode) {
  if (mode === CHAT_MODES.AUTO) return "自动";
  if (mode === CHAT_MODES.DIAGNOSIS) return "诊断";
  if (mode === CHAT_MODES.ACTION_PLAN) return "行动";
  return "简报";
}

function normalizeResponseAction(value) {
  const candidate = toText(value);
  if (candidate === CHAT_RESPONSE_ACTIONS.NATURAL || candidate === CHAT_RESPONSE_ACTIONS.CLARIFY) {
    return candidate;
  }
  return CHAT_RESPONSE_ACTIONS.STRUCTURED;
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

function formatDurationSeconds(durationMs) {
  const safe = Number(durationMs);
  if (!Number.isFinite(safe) || safe <= 0) {
    return "0.0";
  }
  return (safe / 1000).toFixed(1);
}

function isLikelyDevHost() {
  const host = String(window?.location?.hostname || "").trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
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

function normalizeAttemptDiagnostics(rawDiagnostics) {
  if (!Array.isArray(rawDiagnostics)) {
    return [];
  }
  return rawDiagnostics
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const stageCandidate = toText(item.stage);
      const stage = stageCandidate === "retry" || stageCandidate === "repair" ? stageCandidate : "first";
      const format = item.format === "structured" ? "structured" : "text_fallback";
      const outputCharsRaw = Number(item.outputChars);
      const elapsedMsRaw = Number(item.elapsedMs);
      const maxOutputTokensRaw = Number(item.maxOutputTokens);
      return {
        stage,
        format,
        formatReason: toText(item.formatReason) || CHAT_FORMAT_REASONS.JSON_PARSE_FAILED,
        finishReason: toText(item.finishReason),
        outputChars: Number.isFinite(outputCharsRaw) && outputCharsRaw >= 0 ? Math.floor(outputCharsRaw) : 0,
        elapsedMs: Number.isFinite(elapsedMsRaw) && elapsedMsRaw >= 0 ? Math.floor(elapsedMsRaw) : 0,
        maxOutputTokens:
          Number.isFinite(maxOutputTokensRaw) && maxOutputTokensRaw > 0 ? Math.floor(maxOutputTokensRaw) : 0,
      };
    })
    .filter((item) => item !== null);
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

function isValidHistoryRole(value) {
  return value === "user" || value === "assistant";
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
  let sessionHistory = [];
  let consecutiveFailureCount = 0;
  let cooldownUntilMs = 0;
  let cooldownTimerId = 0;

  const placeholderStatus =
    typeof options.placeholderStatus === "string" && options.placeholderStatus.trim()
      ? options.placeholderStatus.trim()
      : "聊天接口已接线；请先登录并完成服务端 Gemini 配置。";
  const readyStatus =
    typeof options.readyStatus === "string" && options.readyStatus.trim()
      ? options.readyStatus.trim()
      : "聊天接口已就绪，可开始提问。";
  const debugStatusDetails =
    Boolean(options.debugStatusDetails) || Boolean(window.__SALES_TOOL_CHAT_DEBUG__) || isLikelyDevHost();

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
    refreshSystemIntro();
    applyState(CHAT_STATES.COMPACT);
  }

  function openExpanded() {
    refreshSystemIntro();
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
    dom.statusEl.classList.remove("ai-chat-status-ready");
    dom.statusEl.textContent = `调用过于频繁，${remainingSec} 秒后可重试。`;
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
    dom.statusEl.classList.toggle("ai-chat-status-ready", hasHandler);
    dom.statusEl.textContent = hasHandler ? readyStatus : placeholderStatus;
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

  function clearSessionHistory() {
    sessionHistory = [];
    const hasHandler = typeof sendHandler === "function";
    dom.statusEl.classList.toggle("ai-chat-status-ready", hasHandler);
    dom.statusEl.textContent = "会话记忆已清空。";
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
    article.textContent = message;
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
    liveMessage.article.textContent = liveMessage.text || " ";
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
        surfaceReply: payload.trim(),
        structured: null,
        mode: currentMode,
        format: "text_fallback",
        responseAction: CHAT_RESPONSE_ACTIONS.NATURAL,
        businessIntent: "chat",
        internalStructured: null,
        requestId: "",
        meta: null,
        fallbackNotice: "",
      };
    }
    if (!payload || typeof payload !== "object") {
      return {
        reply: "",
        surfaceReply: "",
        structured: null,
        mode: currentMode,
        format: "text_fallback",
        responseAction: CHAT_RESPONSE_ACTIONS.NATURAL,
        businessIntent: "chat",
        internalStructured: null,
        requestId: "",
        meta: null,
        fallbackNotice: "",
      };
    }

    const reply =
      toText(payload.surfaceReply) ||
      toText(payload.reply) ||
      toText(payload.message) ||
      toText(payload.text);
    const responseAction = normalizeResponseAction(payload.responseAction);
    const businessIntent = toText(payload.businessIntent) || (responseAction === CHAT_RESPONSE_ACTIONS.STRUCTURED ? normalizeMode(payload.mode) : "chat");
    const structured = normalizeStructuredPayload(payload.structured);
    const internalStructured = payload.internalStructured && typeof payload.internalStructured === "object" ? payload.internalStructured : null;
    const mode = normalizeMode(payload.mode || currentMode);
    const format = payload.format === "structured" ? "structured" : "text_fallback";
    const requestId = toText(payload.requestId);
    const rawMeta = payload.meta && typeof payload.meta === "object" ? payload.meta : null;
    const meta = rawMeta
      ? {
          formatReason: normalizeFormatReason(rawMeta.formatReason),
          retryCount: Number(rawMeta.retryCount) === 1 ? 1 : 0,
          repairApplied: Boolean(rawMeta.repairApplied),
          repairSucceeded: Boolean(rawMeta.repairSucceeded),
          attemptCount: Number.isFinite(Number(rawMeta.attemptCount)) && Number(rawMeta.attemptCount) > 0
            ? Math.floor(Number(rawMeta.attemptCount))
            : 1,
          totalDurationMs: Number.isFinite(Number(rawMeta.totalDurationMs)) && Number(rawMeta.totalDurationMs) >= 0
            ? Math.floor(Number(rawMeta.totalDurationMs))
            : 0,
          finalStage: ["first", "retry", "repair"].includes(String(rawMeta.finalStage || "").trim())
            ? String(rawMeta.finalStage).trim()
            : "first",
          attemptDiagnostics: normalizeAttemptDiagnostics(rawMeta.attemptDiagnostics),
        }
      : null;
    return {
      reply,
      surfaceReply: reply,
      structured,
      internalStructured,
      responseAction,
      businessIntent,
      mode,
      format,
      requestId,
      meta,
      fallbackNotice: toText(payload.fallbackNotice),
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
      dom.statusEl.classList.remove("ai-chat-status-ready");
      dom.statusEl.textContent = placeholderStatus;
      return;
    }

    pushHistory("user", text);
    appendTextMessage("user", text);
    dom.input.value = "";
    isSending = true;
    updateComposerState();
    const liveMessage = createThinkingMessage();
    dom.statusEl.classList.remove("ai-chat-status-ready");
    dom.statusEl.textContent = "AI 思考中...";

    try {
      const result = await Promise.resolve(
        sendHandler(text, {
          mode: currentMode,
          history: getSessionHistory(),
          onThinking: (message) => {
            updateThinkingLabel(liveMessage, message);
            dom.statusEl.classList.remove("ai-chat-status-ready");
            dom.statusEl.textContent = "AI 思考中...";
          },
          onDelta: (chunk) => {
            appendLiveMessageDelta(liveMessage, chunk);
            dom.statusEl.classList.remove("ai-chat-status-ready");
            dom.statusEl.textContent = "AI 正在生成回复...";
          },
        }),
      );
      const normalized = normalizeReplyPayload(result);
      let hasRendered = false;

      const shouldRenderStructuredCard =
        normalized.responseAction === CHAT_RESPONSE_ACTIONS.STRUCTURED && normalized.structured;
      if (shouldRenderStructuredCard) {
        removeLiveMessage(liveMessage);
        hasRendered = appendStructuredAssistantMessage(normalized.structured, normalized.mode);
      }
      if (!hasRendered && normalized.reply) {
        setLiveMessageText(liveMessage, normalized.reply);
        hasRendered = true;
      }
      if (!hasRendered) {
        removeLiveMessage(liveMessage);
      }

      const assistantHistoryText = normalized.structured
        ? toText(normalized.structured.summary || normalized.reply)
        : toText(normalized.reply);
      if (assistantHistoryText) {
        pushHistory("assistant", assistantHistoryText);
      }
      resetFailureState();

      dom.statusEl.classList.add("ai-chat-status-ready");
      if (
        normalized.format === "text_fallback" &&
        normalized.responseAction === CHAT_RESPONSE_ACTIONS.STRUCTURED
      ) {
        let fallbackStatus = normalized.fallbackNotice;
        if (!fallbackStatus && normalized.meta) {
          fallbackStatus = `已回退文本显示：${getFormatReasonLabel(normalized.meta.formatReason)}（原因码: ${normalized.meta.formatReason}）`;
        }
        const shouldShowIncompleteJsonHint =
          looksLikeJsonFragment(normalized.reply) &&
          normalized.meta &&
          (normalized.meta.formatReason === CHAT_FORMAT_REASONS.OUTPUT_TRUNCATED ||
            normalized.meta.formatReason === CHAT_FORMAT_REASONS.JSON_PARSE_FAILED) &&
          !normalized.meta.repairSucceeded;
        if (shouldShowIncompleteJsonHint) {
          fallbackStatus = "结构化输出未完成，请重试。";
        }
        if (normalized.requestId && !fallbackStatus.includes("请求号")) {
          fallbackStatus = fallbackStatus
            ? `${fallbackStatus}（请求号: ${normalized.requestId}）`
            : `已回退文本显示（请求号: ${normalized.requestId}）。`;
        }
        dom.statusEl.textContent = fallbackStatus || "已回退文本显示。";
      } else if (normalized.responseAction === CHAT_RESPONSE_ACTIONS.CLARIFY) {
        dom.statusEl.textContent = "AI 需要你补充信息后继续分析。";
      } else if (normalized.responseAction === CHAT_RESPONSE_ACTIONS.NATURAL) {
        dom.statusEl.textContent = "AI 已按自由问答回复。";
      } else {
        if (hasRendered && debugStatusDetails && normalized.meta) {
          dom.statusEl.textContent = `AI 已按${getModeLabel(normalized.mode)}模式回复（耗时 ${formatDurationSeconds(
            normalized.meta.totalDurationMs,
          )}s，阶段 ${normalized.meta.finalStage}，尝试 ${normalized.meta.attemptCount} 次）。`;
        } else {
          dom.statusEl.textContent = hasRendered
            ? `AI 已按${getModeLabel(normalized.mode)}模式回复。`
            : "处理器已执行，但未返回可显示内容。";
        }
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "请稍后重试";
      dom.statusEl.classList.remove("ai-chat-status-ready");
      dom.statusEl.textContent = `调用失败：${message}`;
      if (!liveMessage.hasDelta) {
        removeLiveMessage(liveMessage);
        appendTextMessage("assistant", `调用失败：${message}`);
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
    getMode,
    setMode,
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
  updateModeControls();
  refreshSystemIntro();

  if (isValidState(options.initialState) && options.initialState !== CHAT_STATES.CLOSED) {
    applyState(options.initialState);
  } else {
    applyState(CHAT_STATES.CLOSED);
  }

  return api;
}
