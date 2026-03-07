import {
  CHAT_ERROR_CODES,
  GEMINI_API_BASE,
  GEMINI_UPSTREAM_TIMEOUT_MS,
  fetchWithTimeout,
  getEnvString,
  parseJsonSafe,
  sanitizeModelName,
  trimString,
} from "./shared.js";

export function shouldLogPhase2Trace(env) {
  return getEnvString(env, "DEBUG_TRACE") === "1" || getEnvString(env, "NODE_ENV") !== "production";
}

function logGeminiCallBreadcrumb(prefix, stage, payload = {}) {
  if (!shouldLogPhase2Trace(payload?.env || {})) {
    return;
  }
  try {
    console.log(`[chat.${trimString(prefix) || "gemini"}.${trimString(stage) || "trace"}]`, JSON.stringify(payload));
  } catch (_error) {
    // Logging must never affect request flow.
  }
}

export function extractGeminiReply(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map((part) => trimString(part?.text))
      .filter((item) => item)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

export async function requestGeminiGenerateContent(payload, env, requestId = "", breadcrumbPrefix = "call") {
  const model = sanitizeModelName(getEnvString(env, "GEMINI_MODEL"));
  const apiKey = getEnvString(env, "GEMINI_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      code: CHAT_ERROR_CODES.CONFIG_MISSING,
      message: "服务端未配置 GEMINI_API_KEY。",
      status: 500,
      model,
    };
  }

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  logGeminiCallBreadcrumb(breadcrumbPrefix, "start", {
    env,
    requestId: trimString(requestId),
    model,
  });

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      GEMINI_UPSTREAM_TIMEOUT_MS,
    );

    const responsePayload = await parseJsonSafe(response);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          code: CHAT_ERROR_CODES.UPSTREAM_AUTH_ERROR,
          message: "Gemini Key 无效或无权限，请检查服务端密钥配置。",
          status: 502,
          model,
          payload: responsePayload,
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          code: CHAT_ERROR_CODES.UPSTREAM_RATE_LIMIT,
          message: "Gemini 请求过于频繁或配额受限，请稍后重试。",
          status: 429,
          model,
          payload: responsePayload,
        };
      }
      const upstreamMessage = trimString(responsePayload?.error?.message);
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UPSTREAM_ERROR,
        message: upstreamMessage || `Gemini 服务异常（HTTP ${response.status}）。`,
        status: response.status >= 500 ? 502 : 400,
        model,
        payload: responsePayload,
      };
    }

    return {
      ok: true,
      model,
      payload: responsePayload,
      status: response.status,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
        message: "Gemini 请求超时，请稍后重试。",
        status: 504,
        model,
      };
    }
    return {
      ok: false,
      code: CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
      message: `Gemini 网络请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      status: 502,
      model,
    };
  }
}
