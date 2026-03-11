const MIN_PASSWORD_LENGTH = 6;

let supabaseClient = null;
let currentUser = null;
let lastSignedInUserId = "";
let lastNotifiedSignedInUserId = "";
let authDom = null;
let authReadyResolved = false;
let authCallbacks = {};
let subscriptionViewModel = null;

const PLAN_LABELS = {
  trial_3d: "体验版",
  half_year: "半年版",
  one_year: "一年版",
  lifetime: "永久版",
};

const STATUS_LABELS = {
  active: "有效",
  grandfathered: "有效",
  expired: "已到期",
  revoked: "已停用",
  lookup_failed: "状态读取失败",
  missing: "未开通",
  not_started: "未生效",
  signed_out: "",
};

function setAuthBootstrapStateVisible(visible) {
  if (authDom?.bootstrapStateEl instanceof HTMLElement) {
    authDom.bootstrapStateEl.hidden = !visible;
  }
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function formatSubscriptionDate(value) {
  const text = trimString(value);
  if (!text) {
    return "永久有效";
  }

  const parsedMs = Date.parse(text);
  if (!Number.isFinite(parsedMs)) {
    return text.slice(0, 10) || text;
  }

  const parsedDate = new Date(parsedMs);
  return `${parsedDate.getFullYear()}-${padNumber(parsedDate.getMonth() + 1)}-${padNumber(parsedDate.getDate())}`;
}

function getSubscriptionPlanLabel(entitlementStatus) {
  if (trimString(entitlementStatus?.status) === "grandfathered" && trimString(entitlementStatus?.planType) === "lifetime") {
    return "老用户永久";
  }

  return PLAN_LABELS[trimString(entitlementStatus?.planType)] || "未开通";
}

function getSubscriptionStatusLabel(entitlementStatus) {
  const status = trimString(entitlementStatus?.status);
  const reason = trimString(entitlementStatus?.reason);
  return STATUS_LABELS[status] || STATUS_LABELS[reason] || "有效";
}

function createLoadingSubscriptionViewModel() {
  return {
    primaryText: "订阅状态读取中...",
    secondaryText: "",
    showSecondary: false,
  };
}

export function createAuthSubscriptionViewModel(entitlementStatus) {
  if (!entitlementStatus || typeof entitlementStatus !== "object") {
    return createLoadingSubscriptionViewModel();
  }

  const planLabel = getSubscriptionPlanLabel(entitlementStatus);
  const statusLabel = getSubscriptionStatusLabel(entitlementStatus);
  const hasKnownExpiry = Boolean(trimString(entitlementStatus?.endsAt));
  const secondaryText =
    trimString(entitlementStatus?.planType) === "lifetime" || !hasKnownExpiry
      ? "到期：永久有效"
      : `到期：${formatSubscriptionDate(entitlementStatus.endsAt)}`;

  if (trimString(entitlementStatus?.status) === "lookup_failed" || trimString(entitlementStatus?.reason) === "lookup_failed") {
    return {
      primaryText: "订阅：状态读取失败",
      secondaryText: "到期：--",
      showSecondary: true,
    };
  }

  if (planLabel === "未开通" && !hasKnownExpiry) {
    return {
      primaryText: statusLabel ? `订阅：未开通 · ${statusLabel}` : "订阅：未开通",
      secondaryText: "到期：--",
      showSecondary: true,
    };
  }

  return {
    primaryText: statusLabel ? `订阅：${planLabel} · ${statusLabel}` : `订阅：${planLabel}`,
    secondaryText,
    showSecondary: true,
  };
}

function getConfigValue(key) {
  const config = window.__APP_CONFIG__;
  if (!config || typeof config !== "object") {
    return "";
  }

  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

function showAuthError(message) {
  if (authDom?.errorEl instanceof HTMLElement) {
    authDom.errorEl.textContent = message;
  }
}

function clearAuthError() {
  if (authDom?.errorEl instanceof HTMLElement) {
    authDom.errorEl.textContent = "";
  }
}

function showAuthStatus(message) {
  if (authDom?.statusEl instanceof HTMLElement) {
    authDom.statusEl.textContent = message;
  }
}

function clearAuthStatus() {
  if (authDom?.statusEl instanceof HTMLElement) {
    authDom.statusEl.textContent = "";
  }
}

function renderSubscriptionPanel(user) {
  if (
    !(authDom?.subscriptionEl instanceof HTMLElement) ||
    !(authDom?.subscriptionPrimaryEl instanceof HTMLElement) ||
    !(authDom?.subscriptionSecondaryEl instanceof HTMLElement)
  ) {
    return;
  }

  if (!user?.email) {
    authDom.subscriptionEl.hidden = true;
    authDom.subscriptionPrimaryEl.textContent = "";
    authDom.subscriptionSecondaryEl.textContent = "";
    authDom.subscriptionSecondaryEl.hidden = true;
    return;
  }

  const viewModel = subscriptionViewModel && typeof subscriptionViewModel === "object" ? subscriptionViewModel : createLoadingSubscriptionViewModel();
  authDom.subscriptionEl.hidden = false;
  authDom.subscriptionPrimaryEl.textContent = viewModel.primaryText;
  authDom.subscriptionSecondaryEl.textContent = viewModel.secondaryText;
  authDom.subscriptionSecondaryEl.hidden = viewModel.showSecondary !== true;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readCredentialsFromDom() {
  if (
    !(authDom?.emailInput instanceof HTMLInputElement) ||
    !(authDom?.passwordInput instanceof HTMLInputElement) ||
    !(authDom?.inviteCodeInput instanceof HTMLInputElement)
  ) {
    return null;
  }

  const email = normalizeEmail(authDom.emailInput.value);
  authDom.emailInput.value = email;

  return {
    email,
    password: String(authDom.passwordInput.value || ""),
    inviteCode: String(authDom.inviteCodeInput.value || "").trim(),
  };
}

function validateCredentials(email, password) {
  if (!isValidEmail(email)) {
    return "请输入有效邮箱地址。";
  }

  if (!password) {
    return "请输入密码。";
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `密码长度至少 ${MIN_PASSWORD_LENGTH} 位。`;
  }

  return "";
}

function validateInviteCode(inviteCode) {
  if (!String(inviteCode || "").trim()) {
    return "首次注册需填写有效邀请码。";
  }
  return "";
}

function mapSignUpErrorMessage(error) {
  const rawMessage = error instanceof Error ? trimString(error.message) : trimString(error?.message);
  if (!rawMessage) {
    return "注册失败：请稍后重试。";
  }

  if (/database error saving new user/i.test(rawMessage)) {
    return "注册失败：邀请码不可用，或注册信息未通过校验。";
  }

  if (/user already registered|already been registered/i.test(rawMessage)) {
    return "注册失败：该邮箱已注册，请直接登录。";
  }

  return `注册失败：${rawMessage}`;
}

function setAuthSubmitting(isSubmitting, mode = "") {
  if (authDom?.loginBtn instanceof HTMLButtonElement) {
    authDom.loginBtn.disabled = isSubmitting;
    authDom.loginBtn.textContent = isSubmitting && mode === "login" ? "登录中..." : "登录";
  }

  if (authDom?.registerBtn instanceof HTMLButtonElement) {
    authDom.registerBtn.disabled = isSubmitting;
    authDom.registerBtn.textContent = isSubmitting && mode === "register" ? "注册中..." : "注册";
  }
}

function setAuthActionsEnabled(enabled) {
  if (authDom?.loginBtn instanceof HTMLButtonElement) {
    authDom.loginBtn.disabled = !enabled;
  }

  if (authDom?.registerBtn instanceof HTMLButtonElement) {
    authDom.registerBtn.disabled = !enabled;
  }
}

function setGateLocked(locked, options = {}) {
  const showModal = locked && options.showModal !== false;

  document.body.classList.toggle("auth-gated", locked);

  if (authDom?.modal instanceof HTMLElement) {
    authDom.modal.hidden = !showModal;
  }

  if (showModal) {
    setAuthBootstrapStateVisible(false);
  }

  if (showModal && authDom?.emailInput instanceof HTMLInputElement) {
    window.setTimeout(() => {
      authDom.emailInput.focus();
    }, 0);
  }
}

function updateUserPanel(user) {
  if (
    !(authDom?.userEmailEl instanceof HTMLElement) ||
    !(authDom?.signOutBtn instanceof HTMLButtonElement) ||
    !(authDom?.subscriptionEl instanceof HTMLElement)
  ) {
    return;
  }

  document.body.classList.toggle("auth-signed-in", Boolean(user?.email));

  if (user?.email) {
    authDom.userEmailEl.hidden = false;
    authDom.userEmailEl.textContent = `已登录：${user.email}`;
    renderSubscriptionPanel(user);
    authDom.signOutBtn.hidden = false;
    return;
  }

  authDom.userEmailEl.hidden = true;
  authDom.userEmailEl.textContent = "";
  renderSubscriptionPanel(null);
  authDom.signOutBtn.hidden = true;
}

function ensureSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = getConfigValue("SUPABASE_URL");
  const supabaseAnonKey = getConfigValue("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    showAuthStatus("请先配置 Supabase 连接信息。可复制 config.example.js 为 config.js 后填写。");
    showAuthError("缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY。登录已禁用。");
    setAuthActionsEnabled(false);
    return null;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    showAuthError("Supabase SDK 未加载，无法发起登录请求。");
    setAuthActionsEnabled(false);
    return null;
  }

  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
}

async function signInWithPassword() {
  clearAuthError();
  clearAuthStatus();

  const client = ensureSupabaseClient();
  if (!client) {
    return;
  }

  const credentials = readCredentialsFromDom();
  if (!credentials) {
    return;
  }

  const validationError = validateCredentials(credentials.email, credentials.password);
  if (validationError) {
    showAuthError(validationError);
    return;
  }

  setAuthSubmitting(true, "login");

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    });

    if (error) {
      showAuthError(`登录失败：${error.message || "请检查邮箱和密码"}`);
      return;
    }

    currentUser = data?.user || null;
    if (authDom?.passwordInput instanceof HTMLInputElement) {
      authDom.passwordInput.value = "";
    }

    showAuthStatus("登录成功。");
    setGateLocked(false);
    updateUserPanel(currentUser);
  } catch (error) {
    showAuthError(`网络异常，登录失败：${error instanceof Error ? error.message : "请稍后再试"}`);
  } finally {
    setAuthSubmitting(false);
  }
}

async function signUpWithPassword() {
  clearAuthError();
  clearAuthStatus();

  const client = ensureSupabaseClient();
  if (!client) {
    return;
  }

  const credentials = readCredentialsFromDom();
  if (!credentials) {
    return;
  }

  const validationError = validateCredentials(credentials.email, credentials.password);
  if (validationError) {
    showAuthError(validationError);
    return;
  }

  const inviteValidationError = validateInviteCode(credentials.inviteCode);
  if (inviteValidationError) {
    showAuthError(inviteValidationError);
    return;
  }

  setAuthSubmitting(true, "register");

  try {
    const { data, error } = await client.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: {
        data: {
          invite_code: credentials.inviteCode,
        },
      },
    });

    if (error) {
      showAuthError(mapSignUpErrorMessage(error));
      return;
    }

    if (data?.session && data.user) {
      currentUser = data.user;
      if (authDom?.passwordInput instanceof HTMLInputElement) {
        authDom.passwordInput.value = "";
      }
      if (authDom?.inviteCodeInput instanceof HTMLInputElement) {
        authDom.inviteCodeInput.value = "";
      }

      showAuthStatus("注册并登录成功。");
      setGateLocked(false);
      updateUserPanel(currentUser);
      return;
    }

    if (authDom?.inviteCodeInput instanceof HTMLInputElement) {
      authDom.inviteCodeInput.value = "";
    }
    showAuthStatus("注册成功，请先验证邮箱后登录。");
  } catch (error) {
    showAuthError(`网络异常，注册失败：${error instanceof Error ? error.message : "请稍后再试"}`);
  } finally {
    setAuthSubmitting(false);
  }
}

function setAuthFormStateForLoggedOut() {
  if (authDom?.passwordInput instanceof HTMLInputElement) {
    authDom.passwordInput.value = "";
  }
  if (authDom?.inviteCodeInput instanceof HTMLInputElement) {
    authDom.inviteCodeInput.value = "";
  }

  setAuthSubmitting(false);
  clearAuthStatus();
}

function bindAuthEvents() {
  if (!(authDom?.authForm instanceof HTMLFormElement)) {
    return;
  }

  authDom.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signInWithPassword();
  });

  if (authDom.registerBtn instanceof HTMLButtonElement) {
    authDom.registerBtn.addEventListener("click", async () => {
      await signUpWithPassword();
    });
  }

  if (authDom.signOutBtn instanceof HTMLButtonElement) {
    authDom.signOutBtn.addEventListener("click", async () => {
      await signOutAuth();
    });
  }
}

function resolveAuthReady(user, resolver) {
  if (authReadyResolved) {
    return;
  }

  authReadyResolved = true;
  if (typeof authCallbacks.onAuthResolved === "function") {
    authCallbacks.onAuthResolved(user || null);
  }
  resolver(user);
}

function cacheDomRefs(domRefs) {
  const appRoot = domRefs?.appRoot instanceof HTMLElement ? domRefs.appRoot : document.querySelector("main.container");

  return {
    appRoot,
    modal: document.getElementById("auth-modal"),
    authForm: document.getElementById("auth-form"),
    emailInput: document.getElementById("auth-email"),
    passwordInput: document.getElementById("auth-password"),
    inviteCodeInput: document.getElementById("auth-invite-code"),
    loginBtn: document.getElementById("auth-login-btn"),
    registerBtn: document.getElementById("auth-register-btn"),
    statusEl: document.getElementById("auth-status"),
    errorEl: document.getElementById("auth-error"),
    userEmailEl: document.getElementById("auth-user-email"),
    subscriptionEl: document.getElementById("auth-subscription"),
    subscriptionPrimaryEl: document.getElementById("auth-subscription-primary"),
    subscriptionSecondaryEl: document.getElementById("auth-subscription-secondary"),
    signOutBtn: document.getElementById("auth-signout-btn"),
    bootstrapStateEl: document.getElementById("auth-bootstrap-state"),
  };
}

function validateRequiredDom() {
  const requiredEntries = [
    ["auth-modal", authDom?.modal],
    ["auth-form", authDom?.authForm],
    ["auth-email", authDom?.emailInput],
    ["auth-password", authDom?.passwordInput],
    ["auth-invite-code", authDom?.inviteCodeInput],
    ["auth-login-btn", authDom?.loginBtn],
    ["auth-register-btn", authDom?.registerBtn],
    ["auth-status", authDom?.statusEl],
    ["auth-error", authDom?.errorEl],
    ["auth-user-email", authDom?.userEmailEl],
    ["auth-subscription", authDom?.subscriptionEl],
    ["auth-subscription-primary", authDom?.subscriptionPrimaryEl],
    ["auth-subscription-secondary", authDom?.subscriptionSecondaryEl],
    ["auth-signout-btn", authDom?.signOutBtn],
    ["auth-bootstrap-state", authDom?.bootstrapStateEl],
  ];

  const missing = requiredEntries.filter(([, el]) => !(el instanceof HTMLElement)).map(([id]) => id);

  if (missing.length > 0) {
    throw new Error(`缺少认证相关 DOM：${missing.join(", ")}`);
  }
}

export function getCurrentAuthUser() {
  return currentUser;
}

export function getSupabaseClient() {
  return ensureSupabaseClient();
}

export function setAuthSubscriptionPanel(entitlementStatus) {
  subscriptionViewModel =
    entitlementStatus && typeof entitlementStatus === "object" ? createAuthSubscriptionViewModel(entitlementStatus) : null;
  updateUserPanel(currentUser);
}

export async function signOutAuth() {
  const client = ensureSupabaseClient();

  if (client) {
    const { error } = await client.auth.signOut();
    if (error) {
      showAuthError(`退出登录失败：${error.message || "请稍后再试"}`);
      return false;
    }
  }

  currentUser = null;
  lastNotifiedSignedInUserId = "";
  subscriptionViewModel = null;
  setAuthBootstrapStateVisible(false);
  updateUserPanel(null);
  setAuthFormStateForLoggedOut();
  setGateLocked(true);
  showAuthStatus("已退出登录，请重新登录。");
  return true;
}

export async function bootstrapAuthGate(domRefs = {}) {
  authReadyResolved = false;
  lastNotifiedSignedInUserId = "";
  subscriptionViewModel = null;
  authCallbacks = domRefs?.callbacks && typeof domRefs.callbacks === "object" ? domRefs.callbacks : {};
  authDom = cacheDomRefs(domRefs);
  validateRequiredDom();
  bindAuthEvents();
  updateUserPanel(null);
  setAuthFormStateForLoggedOut();
  setAuthBootstrapStateVisible(true);
  // Lock interactions immediately, but keep modal hidden until session check completes.
  setGateLocked(true, { showModal: false });

  const client = ensureSupabaseClient();
  if (!client) {
    setGateLocked(true, { showModal: true });
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        lastNotifiedSignedInUserId = "";
        setAuthBootstrapStateVisible(false);
        updateUserPanel(null);
        setAuthFormStateForLoggedOut();
        setGateLocked(true);
        showAuthStatus("已退出登录，请重新登录。");
        if (typeof authCallbacks.onSignedOut === "function") {
          authCallbacks.onSignedOut();
        }
        resolveAuthReady(null, resolve);
        return;
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        const nextUserId = session?.user?.id || "";
        if (event === "SIGNED_IN" && lastSignedInUserId && nextUserId && lastSignedInUserId !== nextUserId) {
          console.info("[Sales Tool] 检测到账号切换，正在刷新并同步数据...");
          window.location.reload();
          return;
        }

        if (nextUserId) {
          lastSignedInUserId = nextUserId;
        }

        currentUser = session?.user || null;
        updateUserPanel(currentUser);

        if (currentUser) {
          setAuthBootstrapStateVisible(false);
          clearAuthError();
          setGateLocked(false);
          const shouldNotifySignedIn =
            event === "SIGNED_IN" &&
            nextUserId &&
            nextUserId !== lastNotifiedSignedInUserId;
          if (shouldNotifySignedIn && typeof authCallbacks.onSignedIn === "function") {
            lastNotifiedSignedInUserId = nextUserId;
            authCallbacks.onSignedIn(currentUser);
          }
          resolveAuthReady(currentUser, resolve);
        }
      }
    });

    const initSession = async () => {
      try {
        const { data, error } = await client.auth.getSession();

        if (error) {
          showAuthError(`读取会话失败：${error.message || "请重新登录"}`);
        }

        currentUser = data?.session?.user || null;
        if (currentUser?.id) {
          lastSignedInUserId = currentUser.id;
        }
        updateUserPanel(currentUser);

        if (currentUser) {
          setAuthBootstrapStateVisible(false);
          setGateLocked(false);
          clearAuthError();
          showAuthStatus("");
          resolveAuthReady(currentUser, resolve);
        } else {
          setGateLocked(true, { showModal: true });
          resolveAuthReady(null, resolve);
        }
      } catch (error) {
        setGateLocked(true, { showModal: true });
        showAuthError(`读取会话失败：${error instanceof Error ? error.message : "请重新登录"}`);
        resolveAuthReady(null, resolve);
      }
    };

    void initSession();
  });
}
