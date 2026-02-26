const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTEXT_CHARS = 18000;
const SUPABASE_AUTH_USER_PATH = "/auth/v1/user";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
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
  const safeMode = trimString(mode) || "briefing";
  const contextText = safeContextText(context);

  return [
    "你是销售分析助手，请严格基于给定上下文回答，不要编造数据。",
    "输出语言：简体中文。",
    "回答结构：结论 -> 关键证据 -> 建议 -> 可执行动作。",
    "如果上下文不足，请明确说明“数据不足/口径不足”。",
    `回答模式：${safeMode}`,
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
      code: "UNAUTHORIZED",
      message: "缺少或无效的 Authorization Bearer Token。",
    };
  }

  const supabaseAnonKey = getEnvString(env, "SUPABASE_ANON_KEY");
  const authUserEndpoint = buildSupabaseAuthUserEndpoint(env);
  if (!supabaseAnonKey || !authUserEndpoint) {
    return {
      ok: false,
      status: 500,
      code: "AUTH_CONFIG_MISSING",
      message: "服务端缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY，无法校验登录态。",
    };
  }

  let authResponse;
  try {
    authResponse = await fetch(authUserEndpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      code: "AUTH_UPSTREAM_ERROR",
      message: `登录态校验请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
    };
  }

  const authPayload = await parseJsonSafe(authResponse);
  if (!authResponse.ok) {
    const reason = readUpstreamErrorMessage(authPayload) || "登录态无效或已过期，请重新登录。";
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: reason,
    };
  }

  const userId = trimString(authPayload?.id);
  if (!userId) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
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
    return jsonResponse(
      {
        error: {
          code: authResult.code,
          message: authResult.message,
        },
        requestId,
      },
      authResult.status,
    );
  }

  const key = getEnvString(context.env, "GEMINI_API_KEY");
  const model = sanitizeModelName(getEnvString(context.env, "GEMINI_MODEL"));

  if (!key) {
    return jsonResponse(
      {
        error: {
          code: "CONFIG_MISSING",
          message: "服务端缺少 GEMINI_API_KEY 配置。",
        },
        requestId,
      },
      500,
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch (_error) {
    return jsonResponse(
      {
        error: {
          code: "BAD_REQUEST",
          message: "请求体必须是合法 JSON。",
        },
        requestId,
      },
      400,
    );
  }

  const message = trimString(body && body.message);
  const contextPayload = body && typeof body.context === "object" && body.context ? body.context : {};
  const mode = trimString(body && body.mode) || "briefing";

  if (!message) {
    return jsonResponse(
      {
        error: {
          code: "MESSAGE_REQUIRED",
          message: "message 不能为空。",
        },
        requestId,
      },
      400,
    );
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse(
      {
        error: {
          code: "MESSAGE_TOO_LONG",
          message: `message 过长，最多 ${MAX_MESSAGE_LENGTH} 个字符。`,
        },
        requestId,
      },
      400,
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
    upstreamResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(upstreamPayload),
    });
  } catch (error) {
    return jsonResponse(
      {
        error: {
          code: "UPSTREAM_NETWORK_ERROR",
          message: `Gemini 网络请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
        },
        requestId,
      },
      502,
    );
  }

  const upstreamData = await parseJsonSafe(upstreamResponse);
  if (!upstreamResponse.ok) {
    const upstreamMessage = readUpstreamErrorMessage(upstreamData);
    return jsonResponse(
      {
        error: {
          code: "UPSTREAM_ERROR",
          message: upstreamMessage || `Gemini 返回异常状态：HTTP ${upstreamResponse.status}`,
        },
        requestId,
      },
      502,
    );
  }

  const reply = pickGeminiReply(upstreamData);
  if (!reply) {
    return jsonResponse(
      {
        error: {
          code: "EMPTY_REPLY",
          message: "Gemini 返回为空，请稍后重试。",
        },
        requestId,
      },
      502,
    );
  }

  return jsonResponse({
    reply,
    model,
    requestId,
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS",
    },
  });
}
