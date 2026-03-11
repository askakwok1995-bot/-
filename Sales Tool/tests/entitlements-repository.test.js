import assert from "node:assert/strict";
import test from "node:test";

import { createEntitlementsRepository, evaluateEntitlementRecord } from "../infra/entitlements-repository.js";

test("evaluateEntitlementRecord marks lifetime grandfathered access as active", () => {
  const result = evaluateEntitlementRecord(
    {
      plan_type: "lifetime",
      status: "grandfathered",
      starts_at: "2025-01-01T00:00:00.000Z",
      ends_at: null,
    },
    new Date("2026-03-11T00:00:00.000Z"),
  );

  assert.equal(result.isActive, true);
  assert.equal(result.reason, "grandfathered");
  assert.equal(result.planType, "lifetime");
});

test("evaluateEntitlementRecord marks expired access as inactive with renewal message", () => {
  const result = evaluateEntitlementRecord(
    {
      plan_type: "trial_3d",
      status: "active",
      starts_at: "2026-03-01T00:00:00.000Z",
      ends_at: "2026-03-04T00:00:00.000Z",
    },
    new Date("2026-03-11T00:00:00.000Z"),
  );

  assert.equal(result.isActive, false);
  assert.equal(result.reason, "expired");
  assert.match(result.message, /到期/u);
});

test("fetchCurrentEntitlementStatus uses database-evaluated rpc payload", async () => {
  const repository = createEntitlementsRepository({
    getAuthContext() {
      return {
        user: { id: "user-1" },
        client: {
          async rpc(name) {
            assert.equal(name, "get_current_entitlement_status");
            return {
              data: {
                is_active: false,
                reason: "expired",
                status: "expired",
                plan_type: "trial_3d",
                starts_at: "2026-03-01T00:00:00.000Z",
                ends_at: "2026-03-04T00:00:00.000Z",
                message: "当前账号授权已到期，请联系管理员续费。",
              },
              error: null,
            };
          },
        },
      };
    },
  });

  const result = await repository.fetchCurrentEntitlementStatus();

  assert.equal(result.isActive, false);
  assert.equal(result.reason, "expired");
  assert.equal(result.status, "expired");
  assert.equal(result.planType, "trial_3d");
  assert.equal(result.endsAt, "2026-03-04T00:00:00.000Z");
});
