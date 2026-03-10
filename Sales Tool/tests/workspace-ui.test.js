import assert from "node:assert/strict";
import test from "node:test";

import { applyWorkspaceReadOnlyState, bindWorkspaceReadOnlyGuards } from "../workspace-ui.js";

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
    this.classList = new FakeClassList();
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.tabIndex = 0;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }
}

class FakeHtmlInputElement extends FakeElement {}
class FakeHtmlSelectElement extends FakeElement {}
class FakeHtmlButtonElement extends FakeElement {}
class FakeHtmlTextAreaElement extends FakeElement {}

class FakeHtmlDetailsElement extends FakeElement {
  constructor(summary) {
    super();
    this.summary = summary;
    this.open = false;
  }

  querySelector(selector) {
    if (selector === "summary") {
      return this.summary;
    }
    return null;
  }
}

function installFakeBrowserEnv() {
  const previousGlobals = {
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    HTMLDetailsElement: globalThis.HTMLDetailsElement,
    document: globalThis.document,
  };

  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = FakeHtmlInputElement;
  globalThis.HTMLSelectElement = FakeHtmlSelectElement;
  globalThis.HTMLButtonElement = FakeHtmlButtonElement;
  globalThis.HTMLTextAreaElement = FakeHtmlTextAreaElement;
  globalThis.HTMLDetailsElement = FakeHtmlDetailsElement;
  globalThis.document = {
    body: new FakeElement(),
  };

  return {
    restore() {
      globalThis.HTMLElement = previousGlobals.HTMLElement;
      globalThis.HTMLInputElement = previousGlobals.HTMLInputElement;
      globalThis.HTMLSelectElement = previousGlobals.HTMLSelectElement;
      globalThis.HTMLButtonElement = previousGlobals.HTMLButtonElement;
      globalThis.HTMLTextAreaElement = previousGlobals.HTMLTextAreaElement;
      globalThis.HTMLDetailsElement = previousGlobals.HTMLDetailsElement;
      globalThis.document = previousGlobals.document;
    },
  };
}

test("applyWorkspaceReadOnlyState 会锁定控件、展开卡片并展示演示横幅", () => {
  const env = installFakeBrowserEnv();

  try {
    const summary = new FakeElement();
    const details = new FakeHtmlDetailsElement(summary);
    const banner = new FakeElement();
    const title = new FakeElement();
    const desc = new FakeElement();
    const input = new FakeHtmlInputElement();
    const select = new FakeHtmlSelectElement();
    const button = new FakeHtmlButtonElement();
    const root = new FakeElement();
    const state = {
      isWorkspaceReadOnly: true,
      isDemoMode: true,
      workspaceBanner: {
        title: "当前展示的是模拟经营数据",
        description: "登录后可切换到真实工作台。",
      },
    };

    applyWorkspaceReadOnlyState(
      {
        workspaceGrid: root,
        workspaceModeBannerEl: banner,
        workspaceModeBannerTitleEl: title,
        workspaceModeBannerDescEl: desc,
        workspaceControls: [input, select, button],
        workspaceDetails: [details],
      },
      state,
    );

    assert.equal(input.disabled, true);
    assert.equal(select.disabled, true);
    assert.equal(button.disabled, true);
    assert.equal(details.open, true);
    assert.equal(summary.tabIndex, -1);
    assert.equal(banner.hidden, false);
    assert.equal(title.textContent, "当前展示的是模拟经营数据");
    assert.equal(desc.textContent, "登录后可切换到真实工作台。");
    assert.equal(document.body.classList.contains("workspace-readonly"), true);
    assert.equal(root.dataset.workspaceMode, "demo");

    state.isWorkspaceReadOnly = false;
    state.isDemoMode = false;
    applyWorkspaceReadOnlyState(
      {
        workspaceGrid: root,
        workspaceModeBannerEl: banner,
        workspaceModeBannerTitleEl: title,
        workspaceModeBannerDescEl: desc,
        workspaceControls: [input, select, button],
        workspaceDetails: [details],
      },
      state,
    );

    assert.equal(input.disabled, false);
    assert.equal(select.disabled, false);
    assert.equal(button.disabled, false);
    assert.equal(summary.tabIndex, 0);
    assert.equal(banner.hidden, true);
    assert.equal(document.body.classList.contains("workspace-readonly"), false);
    assert.equal(root.dataset.workspaceMode, "live");
  } finally {
    env.restore();
  }
});

test("bindWorkspaceReadOnlyGuards 会阻止只读态折叠卡片", () => {
  const env = installFakeBrowserEnv();

  try {
    const summary = new FakeElement();
    const details = new FakeHtmlDetailsElement(summary);
    let prevented = false;
    let readOnly = true;

    bindWorkspaceReadOnlyGuards([details], () => readOnly);

    summary.listeners.click({
      preventDefault() {
        prevented = true;
      },
    });

    assert.equal(prevented, true);
    assert.equal(details.open, true);

    details.open = false;
    details.listeners.toggle();
    assert.equal(details.open, true);

    readOnly = false;
    prevented = false;
    summary.listeners.click({
      preventDefault() {
        prevented = true;
      },
    });

    assert.equal(prevented, false);
  } finally {
    env.restore();
  }
});
