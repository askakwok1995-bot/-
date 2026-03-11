function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

const INVITE_PLAN_META = {
  trial_3d: {
    label: "体验版",
    durationLabel: "3 天",
  },
  half_year: {
    label: "半年版",
    durationLabel: "183 天",
  },
  one_year: {
    label: "一年版",
    durationLabel: "365 天",
  },
  lifetime: {
    label: "永久版",
    durationLabel: "永久有效",
  },
};

const INVITE_STATUS_META = {
  active: "可用",
  redeemed: "已兑换",
  disabled: "已停用",
};

function normalizePositiveInteger(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : fallback;
}

export function normalizeInviteAdminRow(row) {
  const planType = trimString(row?.plan_type);
  const status = trimString(row?.status);
  const durationDays = row?.duration_days == null ? null : normalizePositiveInteger(row.duration_days, null);
  const meta = INVITE_PLAN_META[planType] || {
    label: "未分类",
    durationLabel: durationDays ? `${durationDays} 天` : "未设置",
  };
  const codeHint = trimString(row?.code_hint) || "历史批次";
  const redeemedEmail = trimString(row?.redeemed_email);

  return {
    id: trimString(row?.id),
    codeHint,
    planType,
    planLabel: meta.label,
    durationDays,
    durationLabel: meta.durationLabel,
    status,
    statusLabel: INVITE_STATUS_META[status] || "未知状态",
    batchLabel: trimString(row?.batch_label) || "未分组",
    redeemedEmail,
    redeemedAt: trimString(row?.redeemed_at),
    createdAt: trimString(row?.created_at),
    canDisable: status === "active" && !redeemedEmail,
    canEnable: status === "disabled" && !redeemedEmail,
  };
}

export function buildInviteAdminSummary(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return items.reduce(
    (summary, row) => {
      summary.total += 1;
      if (row?.status === "active") {
        summary.active += 1;
      } else if (row?.status === "redeemed") {
        summary.redeemed += 1;
      } else if (row?.status === "disabled") {
        summary.disabled += 1;
      }
      return summary;
    },
    {
      total: 0,
      active: 0,
      redeemed: 0,
      disabled: 0,
    },
  );
}

function normalizeGeneratedInviteItems(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map((item) => {
    const normalized = normalizeInviteAdminRow(item);
    return {
      ...normalized,
      code: trimString(item?.code),
    };
  });
}

export function createInviteAdminRepository({ getAuthContext }) {
  async function fetchInviteAdminProfile() {
    const context = typeof getAuthContext === "function" ? getAuthContext() : null;
    if (!context?.client || !context?.user?.id) {
      return {
        isAuthenticated: false,
        isAdmin: false,
        email: "",
        message: "请先登录后再使用邀请码管理功能。",
      };
    }

    const { client, user } = context;
    try {
      const { data, error } = await client.rpc("get_invite_admin_profile");
      if (error) {
        throw error;
      }

      const payload = data && typeof data === "object" ? data : {};
      return {
        isAuthenticated: payload.is_authenticated === true,
        isAdmin: payload.is_admin === true,
        email: trimString(payload.email || user.email),
        message: trimString(payload.message),
      };
    } catch (error) {
      return {
        isAuthenticated: true,
        isAdmin: false,
        email: trimString(user.email),
        message: `邀请码管理权限读取失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      };
    }
  }

  async function listInviteCodes({ limit = 200 } = {}) {
    const context = typeof getAuthContext === "function" ? getAuthContext() : null;
    if (!context?.client || !context?.user?.id) {
      return {
        items: [],
        summary: buildInviteAdminSummary([]),
      };
    }

    const { client } = context;
    const safeLimit = Math.max(1, Math.min(normalizePositiveInteger(limit, 200), 500));
    const { data, error } = await client.rpc("list_invite_code_admin_rows", {
      limit_count: safeLimit,
    });
    if (error) {
      throw new Error(error.message || "邀请码列表加载失败");
    }

    const items = (Array.isArray(data) ? data : []).map(normalizeInviteAdminRow);
    return {
      items,
      summary: buildInviteAdminSummary(items),
    };
  }

  async function createInviteCodes({ planType, quantity, batchLabel }) {
    const context = typeof getAuthContext === "function" ? getAuthContext() : null;
    if (!context?.client || !context?.user?.id) {
      throw new Error("当前未登录，无法生成邀请码。");
    }

    const { client } = context;
    const { data, error } = await client.rpc("create_invite_codes_batch", {
      plan_type_input: trimString(planType),
      quantity_input: Math.max(1, Math.min(normalizePositiveInteger(quantity, 1), 100)),
      batch_label_input: trimString(batchLabel),
    });
    if (error) {
      throw new Error(error.message || "邀请码生成失败");
    }

    const payload = data && typeof data === "object" ? data : {};
    return {
      items: normalizeGeneratedInviteItems(payload),
      count: normalizePositiveInteger(payload.count, 0),
      batchLabel: trimString(payload.batch_label),
    };
  }

  async function updateInviteCodeStatus({ inviteId, status }) {
    const context = typeof getAuthContext === "function" ? getAuthContext() : null;
    if (!context?.client || !context?.user?.id) {
      throw new Error("当前未登录，无法修改邀请码状态。");
    }

    const { client } = context;
    const { data, error } = await client.rpc("set_invite_code_status", {
      target_invite_id: trimString(inviteId),
      next_status: trimString(status),
    });
    if (error) {
      throw new Error(error.message || "邀请码状态更新失败");
    }

    return normalizeInviteAdminRow(data && typeof data === "object" ? data : {});
  }

  return {
    fetchInviteAdminProfile,
    listInviteCodes,
    createInviteCodes,
    updateInviteCodeStatus,
  };
}
