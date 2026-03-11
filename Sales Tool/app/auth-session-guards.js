function normalizeUserId(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function shouldReloadLiveWorkspaceOnSignedIn({ isDemoMode, activeWorkspaceUserId, nextUserId } = {}) {
  if (Boolean(isDemoMode)) {
    return true;
  }

  const activeUserId = normalizeUserId(activeWorkspaceUserId);
  const signedInUserId = normalizeUserId(nextUserId);

  if (!activeUserId) {
    return true;
  }

  if (!signedInUserId) {
    return false;
  }

  return activeUserId !== signedInUserId;
}
