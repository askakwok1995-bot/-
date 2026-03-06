function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getSupabaseAuthContext({ getSupabaseClient, getCurrentAuthUser }) {
  const client = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
  const user = typeof getCurrentAuthUser === "function" ? getCurrentAuthUser() : null;
  if (!client || !user?.id) {
    return null;
  }
  return { client, user };
}

export async function getSupabaseSessionAccessToken({ getSupabaseClient, logger = console }) {
  const client = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
  if (!client) {
    return "";
  }
  try {
    const { data, error } = await client.auth.getSession();
    if (error) {
      throw error;
    }
    return trimString(data?.session?.access_token);
  } catch (error) {
    logger.warn("[Sales Tool] 读取聊天鉴权令牌失败。", error);
    return "";
  }
}
