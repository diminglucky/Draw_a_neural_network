import { describe, expect, it } from "vitest";
import { PlanExportConfirmationService, type ViewedPlanIdentity } from "../src/plan-export-confirmation.js";

function identity(overrides: Partial<ViewedPlanIdentity> = {}): ViewedPlanIdentity {
  return {
    tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", draftId: "draft-1", revision: 2,
    planId: "plan-1", planHash: "a".repeat(64), previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "b".repeat(64) }],
    ...overrides,
  };
}

describe("PlanExportConfirmationService", () => {
  it("inspects an authentic unconsumed token without consuming its one-time authorization", () => {
    const service = new PlanExportConfirmationService({ secret: "test-secret", now: () => 1_000 });
    const token = service.issue(identity());

    expect(service.inspect(token)).toMatchObject(identity());
    expect(service.consume(token, identity())).toMatchObject(identity());
  });

  it("issues a one-time token bound to the exact viewed snapshot identity", () => {
    const service = new PlanExportConfirmationService({ secret: "test-secret", now: () => 1_000 });
    const token = service.issue(identity());
    expect(service.consume(token, identity())).toMatchObject(identity());
    expect(() => service.consume(token, identity())).toThrow(/consumed|replayed/i);
  });

  it("rejects a token presented by a different device or for a changed artifact", () => {
    const service = new PlanExportConfirmationService({ secret: "test-secret", now: () => 1_000 });
    const token = service.issue(identity());
    expect(() => service.consume(token, identity({ deviceId: "device-2" }))).toThrow(/binding|identity/i);
    expect(() => service.consume(token, identity({ previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "c".repeat(64) }] }))).toThrow(/binding|identity/i);
  });

  it("rejects expired and tampered tokens", () => {
    let now = 1_000;
    const service = new PlanExportConfirmationService({ secret: "test-secret", now: () => now, ttlMs: 10 });
    const expired = service.issue(identity());
    now = 1_011;
    expect(() => service.consume(expired, identity())).toThrow(/expired/i);
    const token = service.issue(identity());
    expect(() => service.consume(`${token}x`, identity())).toThrow(/invalid|signature/i);
  });
});
