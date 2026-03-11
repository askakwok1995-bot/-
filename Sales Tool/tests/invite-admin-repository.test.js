import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInviteAdminSummary,
  createInviteAdminRepository,
  normalizeInviteAdminRow,
} from "../infra/invite-admin-repository.js";

test("normalizeInviteAdminRow maps invite fields into readable labels", () => {
  const row = normalizeInviteAdminRow({
    id: "invite-1",
    code_hint: "AB12CD34",
    plan_type: "trial_3d",
    duration_days: 3,
    status: "active",
    batch_label: "launch_batch",
    redeemed_email: "",
    created_at: "2026-03-11T00:00:00.000Z",
    redeemed_at: null,
  });

  assert.equal(row.planLabel, "体验版");
  assert.equal(row.durationLabel, "3 天");
  assert.equal(row.statusLabel, "可用");
  assert.equal(row.expiryLabel, "兑换后 + 3 天");
  assert.equal(row.canDisable, true);
  assert.equal(row.canEnable, false);
});

test("buildInviteAdminSummary aggregates status buckets", () => {
  const summary = buildInviteAdminSummary([
    { status: "active" },
    { status: "active" },
    { status: "redeemed" },
    { status: "disabled" },
  ]);

  assert.deepEqual(summary, {
    total: 4,
    active: 2,
    redeemed: 1,
    disabled: 1,
  });
});

test("createInviteAdminRepository fetches admin profile and list via rpc", async () => {
  const calls = [];
  const repository = createInviteAdminRepository({
    getAuthContext() {
      return {
        user: { id: "user-1", email: "owner@example.com" },
        client: {
          async rpc(name, payload) {
            calls.push({ name, payload });
            if (name === "get_invite_admin_profile") {
              return {
                data: {
                  is_authenticated: true,
                  is_admin: true,
                  email: "owner@example.com",
                  message: "",
                },
                error: null,
              };
            }

            if (name === "list_invite_code_admin_rows") {
              return {
                data: [
                  {
                    id: "invite-1",
                    code_hint: "ZXCV1234",
                    plan_type: "one_year",
                    duration_days: 365,
                    status: "redeemed",
                    batch_label: "batch_1",
                    redeemed_email: "user@example.com",
                    created_at: "2026-03-11T00:00:00.000Z",
                    redeemed_at: "2026-03-12T00:00:00.000Z",
                    entitlement_ends_at: "2026-03-15T00:00:00.000Z",
                  },
                ],
                error: null,
              };
            }

            throw new Error(`Unexpected rpc ${name}`);
          },
        },
      };
    },
  });

  const profile = await repository.fetchInviteAdminProfile();
  const listResult = await repository.listInviteCodes({ limit: 50 });

  assert.equal(profile.isAdmin, true);
  assert.equal(listResult.items.length, 1);
  assert.equal(listResult.items[0].planLabel, "一年版");
  assert.equal(listResult.items[0].expiryLabel, "2026-03-15T00:00:00.000Z");
  assert.equal(listResult.summary.redeemed, 1);
  assert.deepEqual(calls, [
    {
      name: "get_invite_admin_profile",
      payload: undefined,
    },
    {
      name: "list_invite_code_admin_rows",
      payload: {
        limit_count: 50,
      },
    },
  ]);
});
