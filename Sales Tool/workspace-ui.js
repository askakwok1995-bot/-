function isDisableCapableControl(control) {
  return (
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLButtonElement ||
    control instanceof HTMLTextAreaElement
  );
}

function getSummaryElement(detail) {
  if (!detail || typeof detail.querySelector !== "function") {
    return null;
  }
  const summary = detail.querySelector("summary");
  return summary instanceof HTMLElement ? summary : null;
}

export function setWorkspaceControlsDisabled(controls, disabled) {
  const safeControls = Array.isArray(controls) ? controls : [];
  safeControls.forEach((control) => {
    if (!isDisableCapableControl(control)) {
      return;
    }

    control.disabled = disabled;
    if (disabled) {
      control.setAttribute("aria-disabled", "true");
      return;
    }

    control.removeAttribute("aria-disabled");
  });
}

export function setWorkspaceDetailsLocked(details, locked) {
  const safeDetails = Array.isArray(details) ? details : [];
  safeDetails.forEach((detail) => {
    if (!(detail instanceof HTMLDetailsElement)) {
      return;
    }

    if (locked) {
      detail.open = true;
    }
    detail.dataset.readonlyLocked = locked ? "true" : "false";

    const summary = getSummaryElement(detail);
    if (!(summary instanceof HTMLElement)) {
      return;
    }

    summary.setAttribute("aria-disabled", locked ? "true" : "false");
    summary.tabIndex = locked ? -1 : 0;
  });
}

export function bindWorkspaceReadOnlyGuards(details, isReadOnly) {
  const safeDetails = Array.isArray(details) ? details : [];
  safeDetails.forEach((detail) => {
    if (!(detail instanceof HTMLDetailsElement)) {
      return;
    }
    if (detail.dataset.readonlyGuardBound === "true") {
      return;
    }

    const summary = getSummaryElement(detail);
    if (summary instanceof HTMLElement) {
      summary.addEventListener("click", (event) => {
        if (typeof isReadOnly === "function" && isReadOnly()) {
          event.preventDefault();
          detail.open = true;
        }
      });
    }

    detail.addEventListener("toggle", () => {
      if (typeof isReadOnly === "function" && isReadOnly() && !detail.open) {
        detail.open = true;
      }
    });

    detail.dataset.readonlyGuardBound = "true";
  });
}

export function renderWorkspaceModeBanner(dom, state) {
  const bannerEl = dom?.workspaceModeBannerEl;
  const kickerEl = dom?.workspaceModeBannerKickerEl;
  const titleEl = dom?.workspaceModeBannerTitleEl;
  const descEl = dom?.workspaceModeBannerDescEl;
  if (
    !(bannerEl instanceof HTMLElement) ||
    !(kickerEl instanceof HTMLElement) ||
    !(titleEl instanceof HTMLElement) ||
    !(descEl instanceof HTMLElement)
  ) {
    return;
  }

  const isDemoMode = Boolean(state?.isDemoMode);
  const banner = state?.workspaceBanner && typeof state.workspaceBanner === "object" ? state.workspaceBanner : {};
  const shouldShow = isDemoMode || Boolean(state?.isWorkspaceReadOnly && (banner.title || banner.description));
  bannerEl.hidden = !shouldShow;
  if (!shouldShow) {
    return;
  }

  kickerEl.textContent = String(banner.kicker || (isDemoMode ? "演示工作台" : "使用授权")).trim();
  titleEl.textContent = String(
    banner.title || (isDemoMode ? "当前展示的是模拟经营数据" : "当前账号暂不可使用"),
  ).trim();
  descEl.textContent = String(
    banner.description ||
      (isDemoMode
        ? "未登录时可查看演示工作台，登录后即可编辑并保存你的真实业务数据。"
        : "当前账号授权不可用，请联系管理员处理。"),
  ).trim();
}

export function applyWorkspaceReadOnlyState(dom, state) {
  const readOnly = Boolean(state?.isWorkspaceReadOnly);
  const controls = Array.isArray(dom?.workspaceLockedControls)
    ? dom.workspaceLockedControls
    : Array.isArray(dom?.workspaceControls)
      ? dom.workspaceControls
      : [];
  const details = Array.isArray(dom?.workspaceDetails) ? dom.workspaceDetails : [];

  document.body.classList.toggle("workspace-readonly", readOnly);
  document.body.classList.toggle("workspace-demo-mode", Boolean(state?.isDemoMode));

  if (dom?.workspaceGrid instanceof HTMLElement) {
    dom.workspaceGrid.dataset.workspaceMode = state?.isDemoMode ? "demo" : "live";
  }

  setWorkspaceDetailsLocked(details, readOnly);
  setWorkspaceControlsDisabled(controls, readOnly);
  renderWorkspaceModeBanner(dom, state);
}
