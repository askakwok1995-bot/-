function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDateTimestamp(value) {
  const text = trimString(value);
  if (!text) {
    return Number.NaN;
  }
  return Date.parse(text);
}

function normalizeEntitlementStatus(value) {
  const status = trimString(value).toLowerCase();
  if (status === "grandfathered") {
    return "grandfathered";
  }
  if (status === "revoked") {
    return "revoked";
  }
  if (status === "expired") {
    return "expired";
  }
  return "active";
}

export function evaluateEntitlementRecord(record, now = new Date()) {
  const currentTimeMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  const startedAtMs = parseDateTimestamp(record?.starts_at);
  const endsAtMs = parseDateTimestamp(record?.ends_at);
  const status = normalizeEntitlementStatus(record?.status);
  const planType = trimString(record?.plan_type);
  const startsAt = trimString(record?.starts_at);
  const endsAt = trimString(record?.ends_at);

  if (!record || typeof record !== "object") {
    return {
      isActive: false,
      reason: "missing",
      status: "missing",
      planType: "",
      startsAt: "",
      endsAt: "",
      message: "当前账号未开通可用授权，请联系管理员处理。",
    };
  }

  if (status === "revoked") {
    return {
      isActive: false,
      reason: "revoked",
      status,
      planType,
      startsAt,
      endsAt,
      message: "当前账号授权已停用，请联系管理员处理。",
    };
  }

  if (Number.isFinite(startedAtMs) && Number.isFinite(currentTimeMs) && startedAtMs > currentTimeMs) {
    return {
      isActive: false,
      reason: "not_started",
      status,
      planType,
      startsAt,
      endsAt,
      message: "当前账号授权尚未生效，请稍后再试。",
    };
  }

  if (status === "expired" || (Number.isFinite(endsAtMs) && Number.isFinite(currentTimeMs) && endsAtMs <= currentTimeMs)) {
    return {
      isActive: false,
      reason: "expired",
      status,
      planType,
      startsAt,
      endsAt,
      message: endsAt ? `当前账号授权已于 ${endsAt} 到期，请联系管理员续费。` : "当前账号授权已到期，请联系管理员续费。",
    };
  }

  return {
    isActive: true,
    reason: status === "grandfathered" ? "grandfathered" : "active",
    status,
    planType,
    startsAt,
    endsAt,
    message: "",
  };
}

export function createEntitlementsRepository({ getAuthContext, nowProvider = () => new Date() }) {
  async function fetchCurrentEntitlementStatus() {
    const context = typeof getAuthContext === "function" ? getAuthContext() : null;
    if (!context?.client || !context?.user?.id) {
      return {
        isActive: false,
        reason: "signed_out",
        status: "signed_out",
        planType: "",
        startsAt: "",
        endsAt: "",
        message: "未检测到登录用户。",
      };
    }

    const { client, user } = context;
    try {
      const { data, error } = await client
        .from("user_entitlements")
        .select("user_id,plan_type,status,starts_at,ends_at,source_invite_id,updated_at")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return evaluateEntitlementRecord(data, nowProvider());
    } catch (error) {
      return {
        isActive: false,
        reason: "lookup_failed",
        status: "lookup_failed",
        planType: "",
        startsAt: "",
        endsAt: "",
        message: `授权状态读取失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      };
    }
  }

  async function previewInviteCode(candidateCode) {
    const context = typeof getAuthContext === "function" ? getAuthContext() : null;
    const client = context?.client;
    if (!client) {
      return {
        valid: false,
        planType: "",
        durationDays: null,
        message: "Supabase 客户端未初始化，暂时无法校验邀请码。",
      };
    }

    try {
      const { data, error } = await client.rpc("check_invite_code", {
        candidate_code: trimString(candidateCode),
      });
      if (error) {
        throw error;
      }

      const payload = data && typeof data === "object" ? data : {};
      return {
        valid: payload.valid === true,
        planType: trimString(payload.plan_type),
        durationDays: Number.isInteger(Number(payload.duration_days)) ? Number(payload.duration_days) : null,
        message: trimString(payload.message),
      };
    } catch (error) {
      return {
        valid: false,
        planType: "",
        durationDays: null,
        message: `邀请码校验失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      };
    }
  }

  return {
    fetchCurrentEntitlementStatus,
    previewInviteCode,
  };
}
