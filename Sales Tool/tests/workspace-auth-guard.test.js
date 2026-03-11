import assert from "node:assert/strict";
import test from "node:test";

import { shouldReloadLiveWorkspaceOnSignedIn } from "../app/auth-session-guards.js";

test("shouldReloadLiveWorkspaceOnSignedIn reloads when current workspace is demo", () => {
  assert.equal(
    shouldReloadLiveWorkspaceOnSignedIn({
      isDemoMode: true,
      activeWorkspaceUserId: "user-1",
      nextUserId: "user-1",
    }),
    true,
  );
});

test("shouldReloadLiveWorkspaceOnSignedIn reloads when live workspace has no active user yet", () => {
  assert.equal(
    shouldReloadLiveWorkspaceOnSignedIn({
      isDemoMode: false,
      activeWorkspaceUserId: "",
      nextUserId: "user-1",
    }),
    true,
  );
});

test("shouldReloadLiveWorkspaceOnSignedIn skips reload for repeated same-user sign-in events", () => {
  assert.equal(
    shouldReloadLiveWorkspaceOnSignedIn({
      isDemoMode: false,
      activeWorkspaceUserId: "user-1",
      nextUserId: "user-1",
    }),
    false,
  );
});

test("shouldReloadLiveWorkspaceOnSignedIn reloads when signed-in user changes", () => {
  assert.equal(
    shouldReloadLiveWorkspaceOnSignedIn({
      isDemoMode: false,
      activeWorkspaceUserId: "user-1",
      nextUserId: "user-2",
    }),
    true,
  );
});
