import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const AUTH_MODULE_URL = pathToFileURL(path.resolve(process.cwd(), "auth.js")).href;

class FakeClassList {
  constructor() {
    this.set = new Set();
  }

  add(...names) {
    names.forEach((name) => this.set.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.set.delete(name));
  }

  toggle(name, force) {
    if (force === undefined) {
      if (this.set.has(name)) {
        this.set.delete(name);
        return false;
      }
      this.set.add(name);
      return true;
    }
    if (force) {
      this.set.add(name);
      return true;
    }
    this.set.delete(name);
    return false;
  }

  contains(name) {
    return this.set.has(name);
  }
}

class FakeElement {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.value = "";
    this.classList = new FakeClassList();
    this.listeners = {};
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  focus() {}
}

class FakeHtmlFormElement extends FakeElement {}
class FakeHtmlInputElement extends FakeElement {}
class FakeHtmlButtonElement extends FakeElement {}

function installFakeBrowserEnv(client) {
  const previousGlobals = {
    HTMLElement: globalThis.HTMLElement,
    HTMLFormElement: globalThis.HTMLFormElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    document: globalThis.document,
    window: globalThis.window,
  };

  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLFormElement = FakeHtmlFormElement;
  globalThis.HTMLInputElement = FakeHtmlInputElement;
  globalThis.HTMLButtonElement = FakeHtmlButtonElement;

  const elements = {
    "auth-modal": new FakeElement(),
    "auth-form": new FakeHtmlFormElement(),
    "auth-email": new FakeHtmlInputElement(),
    "auth-password": new FakeHtmlInputElement(),
    "auth-invite-code": new FakeHtmlInputElement(),
    "auth-login-btn": new FakeHtmlButtonElement(),
    "auth-register-btn": new FakeHtmlButtonElement(),
    "auth-status": new FakeElement(),
    "auth-error": new FakeElement(),
    "auth-user-email": new FakeElement(),
    "auth-subscription": new FakeElement(),
    "auth-subscription-primary": new FakeElement(),
    "auth-subscription-secondary": new FakeElement(),
    "auth-signout-btn": new FakeHtmlButtonElement(),
    "auth-bootstrap-state": new FakeElement(),
  };

  globalThis.document = {
    body: new FakeElement(),
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector() {
      return new FakeElement();
    },
  };

  globalThis.window = {
    __APP_CONFIG__: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
    },
    supabase: {
      createClient() {
        return client;
      },
    },
    setTimeout,
    clearTimeout,
    location: {
      reload() {
        throw new Error("should-not-reload");
      },
    },
  };

  return {
    restore() {
      globalThis.HTMLElement = previousGlobals.HTMLElement;
      globalThis.HTMLFormElement = previousGlobals.HTMLFormElement;
      globalThis.HTMLInputElement = previousGlobals.HTMLInputElement;
      globalThis.HTMLButtonElement = previousGlobals.HTMLButtonElement;
      globalThis.document = previousGlobals.document;
      globalThis.window = previousGlobals.window;
    },
  };
}

async function loadFreshAuthModule() {
  return import(`${AUTH_MODULE_URL}?test=${Date.now()}-${Math.random()}`);
}

test("bootstrapAuthGate only notifies real signed-in transitions", async () => {
  let authStateChangeHandler = null;
  const authEvents = [];
  const client = {
    auth: {
      onAuthStateChange(handler) {
        authStateChangeHandler = handler;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async getSession() {
        return {
          data: { session: null },
          error: null,
        };
      },
      async signOut() {
        return { error: null };
      },
    },
  };

  const env = installFakeBrowserEnv(client);

  try {
    const { bootstrapAuthGate } = await loadFreshAuthModule();
    await bootstrapAuthGate({
      appRoot: new FakeElement(),
      callbacks: {
        onSignedIn(user) {
          authEvents.push(`signed-in:${String(user?.id || "")}`);
        },
        onSignedOut() {
          authEvents.push("signed-out");
        },
      },
    });

    assert.equal(typeof authStateChangeHandler, "function");

    authStateChangeHandler("INITIAL_SESSION", {
      user: { id: "user-1", email: "user@example.com" },
    });
    assert.deepEqual(authEvents, []);

    authStateChangeHandler("TOKEN_REFRESHED", {
      user: { id: "user-1", email: "user@example.com" },
    });
    assert.deepEqual(authEvents, []);

    authStateChangeHandler("SIGNED_IN", {
      user: { id: "user-1", email: "user@example.com" },
    });
    assert.deepEqual(authEvents, ["signed-in:user-1"]);

    authStateChangeHandler("SIGNED_IN", {
      user: { id: "user-1", email: "user@example.com" },
    });
    assert.deepEqual(authEvents, ["signed-in:user-1"]);

    authStateChangeHandler("SIGNED_OUT", null);
    assert.deepEqual(authEvents, ["signed-in:user-1", "signed-out"]);
  } finally {
    env.restore();
  }
});

test("register flow requires invite code and forwards it to signUp metadata", async () => {
  let signUpPayload = null;
  const client = {
    auth: {
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async getSession() {
        return {
          data: { session: null },
          error: null,
        };
      },
      async signOut() {
        return { error: null };
      },
      async signUp(payload) {
        signUpPayload = payload;
        return {
          data: {
            session: {
              user: { id: "new-user", email: payload.email },
            },
            user: { id: "new-user", email: payload.email },
          },
          error: null,
        };
      },
    },
  };

  const env = installFakeBrowserEnv(client);

  try {
    const { bootstrapAuthGate } = await loadFreshAuthModule();
    await bootstrapAuthGate({
      appRoot: new FakeElement(),
      callbacks: {},
    });

    document.getElementById("auth-email").value = "new@example.com";
    document.getElementById("auth-password").value = "123456";
    document.getElementById("auth-invite-code").value = " trial-abc ";

    await document.getElementById("auth-register-btn").listeners.click();

    assert.equal(signUpPayload?.options?.data?.invite_code, "trial-abc");
    assert.equal(document.getElementById("auth-status").textContent, "注册并登录成功。");
  } finally {
    env.restore();
  }
});

test("register flow blocks empty invite code before calling Supabase", async () => {
  let signUpCalled = false;
  const client = {
    auth: {
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async getSession() {
        return {
          data: { session: null },
          error: null,
        };
      },
      async signOut() {
        return { error: null };
      },
      async signUp() {
        signUpCalled = true;
        return { data: null, error: null };
      },
    },
  };

  const env = installFakeBrowserEnv(client);

  try {
    const { bootstrapAuthGate } = await loadFreshAuthModule();
    await bootstrapAuthGate({
      appRoot: new FakeElement(),
      callbacks: {},
    });

    document.getElementById("auth-email").value = "new@example.com";
    document.getElementById("auth-password").value = "123456";
    document.getElementById("auth-invite-code").value = "";

    await document.getElementById("auth-register-btn").listeners.click();

    assert.equal(signUpCalled, false);
    assert.equal(document.getElementById("auth-error").textContent, "首次注册需填写有效邀请码。");
  } finally {
    env.restore();
  }
});

test("register flow maps generic database signup failure to invite-safe message", async () => {
  const client = {
    auth: {
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async getSession() {
        return {
          data: { session: null },
          error: null,
        };
      },
      async signOut() {
        return { error: null };
      },
      async signUp() {
        return {
          data: null,
          error: {
            message: "Database error saving new user",
          },
        };
      },
    },
  };

  const env = installFakeBrowserEnv(client);

  try {
    const { bootstrapAuthGate } = await loadFreshAuthModule();
    await bootstrapAuthGate({
      appRoot: new FakeElement(),
      callbacks: {},
    });

    document.getElementById("auth-email").value = "new@example.com";
    document.getElementById("auth-password").value = "123456";
    document.getElementById("auth-invite-code").value = "trial-abc";

    await document.getElementById("auth-register-btn").listeners.click();

    assert.equal(document.getElementById("auth-error").textContent, "注册失败：邀请码不可用，或注册信息未通过校验。");
  } finally {
    env.restore();
  }
});

test("subscription panel shows loading first and then renders entitlement summary", async () => {
  let authStateChangeHandler = null;
  const client = {
    auth: {
      onAuthStateChange(handler) {
        authStateChangeHandler = handler;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async getSession() {
        return {
          data: { session: null },
          error: null,
        };
      },
      async signOut() {
        return { error: null };
      },
    },
  };

  const env = installFakeBrowserEnv(client);

  try {
    const { bootstrapAuthGate, setAuthSubscriptionPanel } = await loadFreshAuthModule();
    await bootstrapAuthGate({
      appRoot: new FakeElement(),
      callbacks: {},
    });

    authStateChangeHandler("SIGNED_IN", {
      user: { id: "trial-user", email: "trial@example.com" },
    });

    assert.equal(document.getElementById("auth-subscription").hidden, false);
    assert.equal(document.getElementById("auth-subscription-primary").textContent, "订阅状态读取中...");
    assert.equal(document.getElementById("auth-subscription-secondary").hidden, true);

    setAuthSubscriptionPanel({
      isActive: false,
      reason: "expired",
      status: "expired",
      planType: "trial_3d",
      startsAt: "2026-03-11T00:00:00.000Z",
      endsAt: "2026-03-14T00:00:00.000Z",
      message: "当前账号授权已到期。",
    });

    assert.equal(document.getElementById("auth-subscription-primary").textContent, "订阅：体验版 · 已到期");
    assert.equal(document.getElementById("auth-subscription-secondary").textContent, "到期：2026-03-14");
    assert.equal(document.getElementById("auth-subscription-secondary").hidden, false);
  } finally {
    env.restore();
  }
});

test("subscription view model formats grandfathered lifetime users", async () => {
  const env = installFakeBrowserEnv({
    auth: {
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
      async signOut() {
        return { error: null };
      },
    },
  });

  try {
    const { createAuthSubscriptionViewModel } = await loadFreshAuthModule();
    const viewModel = createAuthSubscriptionViewModel({
      isActive: true,
      reason: "grandfathered",
      status: "grandfathered",
      planType: "lifetime",
      startsAt: "2026-03-11T00:00:00.000Z",
      endsAt: "",
      message: "",
    });

    assert.deepEqual(viewModel, {
      primaryText: "订阅：老用户永久 · 有效",
      secondaryText: "到期：永久有效",
      showSecondary: true,
    });
  } finally {
    env.restore();
  }
});
