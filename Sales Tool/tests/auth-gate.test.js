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
    "auth-login-btn": new FakeHtmlButtonElement(),
    "auth-register-btn": new FakeHtmlButtonElement(),
    "auth-status": new FakeElement(),
    "auth-error": new FakeElement(),
    "auth-user-email": new FakeElement(),
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
