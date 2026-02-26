const MIN_PASSWORD_LENGTH = 6;

let supabaseClient = null;
let currentUser = null;
let lastSignedInUserId = "";
let authDom = null;
let authReadyResolved = false;

function setAuthBootstrapStateVisible(visible) {
  if (authDom?.bootstrapStateEl instanceof HTMLElement) {
    authDom.bootstrapStateEl.hidden = !visible;
  }
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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readCredentialsFromDom() {
  if (!(authDom?.emailInput instanceof HTMLInputElement) || !(authDom?.passwordInput instanceof HTMLInputElement)) {
    return null;
  }

  const email = normalizeEmail(authDom.emailInput.value);
  authDom.emailInput.value = email;

  return {
    email,
    password: String(authDom.passwordInput.value || ""),
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

  if (authDom?.appRoot instanceof HTMLElement) {
    authDom.appRoot.classList.toggle("runtime-blocked", locked);
  }

  document.body.classList.toggle("auth-lock-scroll", locked);

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
  if (!(authDom?.userEmailEl instanceof HTMLElement) || !(authDom?.signOutBtn instanceof HTMLButtonElement)) {
    return;
  }

  if (user?.email) {
    authDom.userEmailEl.hidden = false;
    authDom.userEmailEl.textContent = `已登录：${user.email}`;
    authDom.signOutBtn.hidden = false;
    return;
  }

  authDom.userEmailEl.hidden = true;
  authDom.userEmailEl.textContent = "";
  authDom.signOutBtn.hidden = true;
}

function ensureSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = getConfigValue("SUPABASE_URL");
  const supabaseAnonKey = getConfigValue("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    showAuthStatus("请先配置 Supabase 连接信息。可复制 config.example.js 为 config.local.js 后填写。");
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

  setAuthSubmitting(true, "register");

  try {
    const { data, error } = await client.auth.signUp({
      email: credentials.email,
      password: credentials.password,
    });

    if (error) {
      showAuthError(`注册失败：${error.message || "请稍后重试"}`);
      return;
    }

    if (data?.session && data.user) {
      currentUser = data.user;
      if (authDom?.passwordInput instanceof HTMLInputElement) {
        authDom.passwordInput.value = "";
      }

      showAuthStatus("注册并登录成功。");
      setGateLocked(false);
      updateUserPanel(currentUser);
      return;
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
    loginBtn: document.getElementById("auth-login-btn"),
    registerBtn: document.getElementById("auth-register-btn"),
    statusEl: document.getElementById("auth-status"),
    errorEl: document.getElementById("auth-error"),
    userEmailEl: document.getElementById("auth-user-email"),
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
    ["auth-login-btn", authDom?.loginBtn],
    ["auth-register-btn", authDom?.registerBtn],
    ["auth-status", authDom?.statusEl],
    ["auth-error", authDom?.errorEl],
    ["auth-user-email", authDom?.userEmailEl],
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
  setAuthBootstrapStateVisible(false);
  updateUserPanel(null);
  setAuthFormStateForLoggedOut();
  setGateLocked(true);
  showAuthStatus("已退出登录，请重新登录。");
  return true;
}

export async function bootstrapAuthGate(domRefs = {}) {
  authReadyResolved = false;
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
    return new Promise(() => {});
  }

  return new Promise((resolve) => {
    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        setAuthBootstrapStateVisible(false);
        updateUserPanel(null);
        setAuthFormStateForLoggedOut();
        setGateLocked(true);
        showAuthStatus("已退出登录，请重新登录。");
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
        }
      } catch (error) {
        setGateLocked(true, { showModal: true });
        showAuthError(`读取会话失败：${error instanceof Error ? error.message : "请重新登录"}`);
      }
    };

    void initSession();
  });
}
