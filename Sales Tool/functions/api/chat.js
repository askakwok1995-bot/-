const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTEXT_CHARS = 18000;
const SUPABASE_AUTH_USER_PATH = "/auth/v1/user";
const AUTH_UPSTREAM_TIMEOUT_MS = 12000;
const GEMINI_UPSTREAM_TIMEOUT_MS = 12000;
const FETCH_TIMEOUT_CODE = "FETCH_TIMEOUT";

const CHAT_ERROR_CODES = Object.freeze({
  UNAUTHORIZED: "UNAUTHORIZED",
  AUTH_CONFIG_MISSING: "AUTH_CONFIG_MISSING",
  AUTH_UPSTREAM_TIMEOUT: "AUTH_UPSTREAM_TIMEOUT",
  AUTH_UPSTREAM_ERROR: "AUTH_UPSTREAM_ERROR",
  CONFIG_MISSING: "CONFIG_MISSING",
  BAD_REQUEST: "BAD_REQUEST",
  MESSAGE_REQUIRED: "MESSAGE_REQUIRED",
  MESSAGE_TOO_LONG: "MESSAGE_TOO_LONG",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  UPSTREAM_NETWORK_ERROR: "UPSTREAM_NETWORK_ERROR",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  EMPTY_REPLY: "EMPTY_REPLY",
});

const CHAT_MODES = Object.freeze({
  BRIEFING: "briefing",
  DIAGNOSIS: "diagnosis",
  ACTION_PLAN: "action-plan",
});

const MODE_DEFINITIONS = Object.freeze({
  [CHAT_MODES.BRIEFING]: {
    label: "简报模式",
    goal: "用于周报或阶段汇报，先给结论，再给证据和动作。",
    focus: "强调总体结论、亮点、风险、下周动作。",
  },
  [CHAT_MODES.DIAGNOSIS]: {
    label: "诊断模式",
    goal: "用于定位问题根因，优先解释下滑或异常波动。",
    focus: "强调异常定位、影响范围、可验证假设。",
  },
  [CHAT_MODES.ACTION_PLAN]: {
    label: "行动模式",
    goal: "用于制定执行清单，输出可落地动作。",
    focus: "强调负责人、时间、追踪指标与下一步检查点。",
  },
});

function jsonResponse(payload, status = 200, requestId = "") {
  const safeRequestId = trimString(requestId);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (safeRequestId) {
    headers["x-request-id"] = safeRequestId;
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

function errorResponse(code, message, status, requestId) {
  return jsonResponse(
    {
      error: {
        code,
        message,
      },
      requestId,
    },
    status,
    requestId,
  );
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getEnvString(env, name) {
  return trimString(env && typeof env === "object" ? env[name] : "");
}

function sanitizeModelName(rawModel) {
  const model = trimString(rawModel) || DEFAULT_GEMINI_MODEL;
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return model;
}

function sanitizeMode(rawMode) {
  const mode = trimString(rawMode).toLowerCase();
  if (mode === CHAT_MODES.DIAGNOSIS || mode === CHAT_MODES.ACTION_PLAN || mode === CHAT_MODES.BRIEFING) {
    return mode;
  }
  return CHAT_MODES.BRIEFING;
}

function safeContextText(context) {
  if (!context || typeof context !== "object") {
    return "{}";
  }

  try {
    const json = JSON.stringify(context);
    if (json.length <= MAX_CONTEXT_CHARS) {
      return json;
    }
    return `${json.slice(0, MAX_CONTEXT_CHARS)}...(truncated)`;
  } catch (_error) {
    return "{}";
  }
}

function buildPrompt(message, context, mode) {
  const safeMessage = trimString(message);
  const safeMode = sanitizeMode(mode);
  const modeDefinition = MODE_DEFINITIONS[safeMode] || MODE_DEFINITIONS[CHAT_MODES.BRIEFING];
  const contextText = safeContextText(context);

  return [
    "你是销售分析助手，请严格基于给定上下文回答，不要编造数据。",
    "输出语言：简体中文。",
    `当前模式：${modeDefinition.label}。`,
    `模式目标：${modeDefinition.goal}`,
    `模式重点：${modeDefinition.focus}`,
    "必须输出单个 JSON 对象，禁止输出除 JSON 外的解释文字。",
    "JSON 字段必须完整：summary(string), highlights(string[]), evidence([{label,value,insight}]), risks(string[]), actions([{title,owner,timeline,metric}]), nextQuestions(string[])。",
    "若上下文不足，也要输出合法 JSON，并在 summary 或 risks 中明确“数据不足/口径不足”。",
    "禁止使用 Markdown 代码块；如果无法保证格式，仍优先输出可解析 JSON。",
    "",
    "用户问题：",
    safeMessage,
    "",
    "分析上下文(JSON)：",
    contextText,
  ].join("\n");
}

function pickGeminiReply(data) {
  if (!data || typeof data !== "object") return "";
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    const chunks = parts
      .map((part) => trimString(part && part.text))
      .filter((text) => text);
    if (chunks.length > 0) {
      return chunks.join("\n");
    }
  }
  return "";
}

function normalizeStringList(value, maxItems = 6) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => trimString(item))
    .filter((item) => item)
    .slice(0, maxItems);
}

function normalizeEvidenceList(value, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const label = trimString(item.label);
      const rawValue = item.value;
      const valueText =
        typeof rawValue === "number" || typeof rawValue === "string" ? trimString(String(rawValue)) : trimString(item.valueText);
      const insight = trimString(item.insight);
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
      const title = trimString(item.title);
      if (!title) return null;
      return {
        title,
        owner: trimString(item.owner),
        timeline: trimString(item.timeline),
        metric: trimString(item.metric),
      };
    })
    .filter((item) => item !== null)
    .slice(0, maxItems);
}

function normalizeStructuredPayload(value) {
  if (!value || typeof value !== "object") return null;
  const summary = trimString(value.summary);
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

function parseJsonCandidate(text) {
  const safeText = trimString(text);
  if (!safeText) return null;
  try {
    return JSON.parse(safeText);
  } catch (_error) {
    return null;
  }
}

function pickStructuredFromObject(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.structured && typeof candidate.structured === "object") {
    const nested = normalizeStructuredPayload(candidate.structured);
    if (nested) return nested;
  }
  return normalizeStructuredPayload(candidate);
}

function extractStructuredPayload(rawReply) {
  const safeReply = trimString(rawReply);
  if (!safeReply) return null;

  const directCandidate = parseJsonCandidate(safeReply);
  const directStructured = pickStructuredFromObject(directCandidate);
  if (directStructured) return directStructured;

  const fencedJsonMatch = safeReply.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJsonMatch && fencedJsonMatch[1]) {
    const fencedCandidate = parseJsonCandidate(fencedJsonMatch[1]);
    const fencedStructured = pickStructuredFromObject(fencedCandidate);
    if (fencedStructured) return fencedStructured;
  }

  const firstBraceIndex = safeReply.indexOf("{");
  const lastBraceIndex = safeReply.lastIndexOf("}");
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    const maybeJson = safeReply.slice(firstBraceIndex, lastBraceIndex + 1);
    const embeddedCandidate = parseJsonCandidate(maybeJson);
    const embeddedStructured = pickStructuredFromObject(embeddedCandidate);
    if (embeddedStructured) return embeddedStructured;
  }

  return null;
}

function readUpstreamErrorMessage(payload) {
  if (!payload || typeof payload !== "object") return "";
  const topLevelMessage = trimString(payload.message);
  if (topLevelMessage) return topLevelMessage;
  if (payload.error && typeof payload.error === "object") {
    const message = trimString(payload.error.message);
    if (message) return message;
  }
  return "";
}

function createTimeoutError(timeoutMs) {
  const timeoutError = new Error(`请求超时（>${timeoutMs}ms）。`);
  timeoutError.code = FETCH_TIMEOUT_CODE;
  return timeoutError;
}

function isTimeoutError(error) {
  return Boolean(error && typeof error === "object" && error.code === FETCH_TIMEOUT_CODE);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 12000) {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return fetch(url, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw createTimeoutError(timeout);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractBearerToken(request) {
  const authHeader = trimString(request?.headers?.get("authorization"));
  if (!authHeader) {
    return "";
  }

  const matched = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!matched) {
    return "";
  }

  return trimString(matched[1]);
}

function buildSupabaseAuthUserEndpoint(env) {
  const supabaseUrl = getEnvString(env, "SUPABASE_URL");
  if (!supabaseUrl) {
    return "";
  }

  return `${supabaseUrl.replace(/\/+$/, "")}${SUPABASE_AUTH_USER_PATH}`;
}

async function verifySupabaseAccessToken(request, env) {
  const token = extractBearerToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: CHAT_ERROR_CODES.UNAUTHORIZED,
      message: "缺少或无效的 Authorization Bearer Token。",
    };
  }

  const supabaseAnonKey = getEnvString(env, "SUPABASE_ANON_KEY");
  const authUserEndpoint = buildSupabaseAuthUserEndpoint(env);
  if (!supabaseAnonKey || !authUserEndpoint) {
    return {
      ok: false,
      status: 500,
      code: CHAT_ERROR_CODES.AUTH_CONFIG_MISSING,
      message: "服务端缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY，无法校验登录态。",
    };
  }

  let authResponse;
  try {
    authResponse = await fetchWithTimeout(
      authUserEndpoint,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
        },
      },
      AUTH_UPSTREAM_TIMEOUT_MS,
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return {
        ok: false,
        status: 504,
        code: CHAT_ERROR_CODES.AUTH_UPSTREAM_TIMEOUT,
        message: `登录态校验超时（>${AUTH_UPSTREAM_TIMEOUT_MS}ms），请稍后重试。`,
      };
    }

    return {
      ok: false,
      status: 502,
      code: CHAT_ERROR_CODES.AUTH_UPSTREAM_ERROR,
      message: `登录态校验请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
    };
  }

  const authPayload = await parseJsonSafe(authResponse);
  if (!authResponse.ok) {
    const reason = readUpstreamErrorMessage(authPayload) || "登录态无效或已过期，请重新登录。";
    return {
      ok: false,
      status: 401,
      code: CHAT_ERROR_CODES.UNAUTHORIZED,
      message: reason,
    };
  }

  const userId = trimString(authPayload?.id);
  if (!userId) {
    return {
      ok: false,
      status: 401,
      code: CHAT_ERROR_CODES.UNAUTHORIZED,
      message: "登录态无效或已过期，请重新登录。",
    };
  }

  return {
    ok: true,
    status: 200,
    code: "",
    message: "",
    user: {
      id: userId,
      email: trimString(authPayload?.email),
    },
  };
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

export async function onRequestPost(context) {
  const requestId = crypto.randomUUID();
  const authResult = await verifySupabaseAccessToken(context.request, context.env);
  if (!authResult.ok) {
    return errorResponse(authResult.code, authResult.message, authResult.status, requestId);
  }

  const key = getEnvString(context.env, "GEMINI_API_KEY");
  const model = sanitizeModelName(getEnvString(context.env, "GEMINI_MODEL"));

  if (!key) {
    return errorResponse(CHAT_ERROR_CODES.CONFIG_MISSING, "服务端缺少 GEMINI_API_KEY 配置。", 500, requestId);
  }

  let body;
  try {
    body = await context.request.json();
  } catch (_error) {
    return errorResponse(CHAT_ERROR_CODES.BAD_REQUEST, "请求体必须是合法 JSON。", 400, requestId);
  }

  const message = trimString(body && body.message);
  const contextPayload = body && typeof body.context === "object" && body.context ? body.context : {};
  const mode = sanitizeMode(body && body.mode);

  if (!message) {
    return errorResponse(CHAT_ERROR_CODES.MESSAGE_REQUIRED, "message 不能为空。", 400, requestId);
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(
      CHAT_ERROR_CODES.MESSAGE_TOO_LONG,
      `message 过长，最多 ${MAX_MESSAGE_LENGTH} 个字符。`,
      400,
      requestId,
    );
  }

  const upstreamPayload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildPrompt(message, contextPayload, mode),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 1024,
    },
  };

  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  let upstreamResponse;
  try {
    upstreamResponse = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify(upstreamPayload),
      },
      GEMINI_UPSTREAM_TIMEOUT_MS,
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return errorResponse(
        CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
        `Gemini 请求超时（>${GEMINI_UPSTREAM_TIMEOUT_MS}ms），请稍后重试。`,
        504,
        requestId,
      );
    }
    return errorResponse(
      CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
      `Gemini 网络请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      502,
      requestId,
    );
  }

  const upstreamData = await parseJsonSafe(upstreamResponse);
  if (!upstreamResponse.ok) {
    const upstreamMessage = readUpstreamErrorMessage(upstreamData);
    return errorResponse(
      CHAT_ERROR_CODES.UPSTREAM_ERROR,
      upstreamMessage || `Gemini 返回异常状态：HTTP ${upstreamResponse.status}`,
      502,
      requestId,
    );
  }

  const reply = pickGeminiReply(upstreamData);
  if (!reply) {
    return errorResponse(CHAT_ERROR_CODES.EMPTY_REPLY, "Gemini 返回为空，请稍后重试。", 502, requestId);
  }

  const structured = extractStructuredPayload(reply);
  const format = structured ? "structured" : "text_fallback";
  const safeReply = structured ? structured.summary : reply;

  return jsonResponse(
    {
      reply: safeReply,
      model,
      requestId,
      mode,
      format,
      structured,
    },
    200,
    requestId,
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS",
    },
  });
}
