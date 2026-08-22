import { describe, expect, it } from "vitest";
import { InMemoryDrawingRunCoordinator } from "../../src/drawing-run/coordinator.js";
import { DrawingRunError } from "../../src/drawing-run/errors.js";
import { InMemoryFoundationStore } from "../../src/store.js";
import { FoundationDrawingRunStoreAdapter } from "../../src/drawing-run/store.js";

const intent = {
  action: "create_figure" as const,
  requestedDetail: "overview" as const,
  target: "browser_preview" as const,
  sourceKinds: ["typed_text" as const],
};

describe("Drawing Run coordinator", () => {
  it("creates an owner/device-scoped observable run and replays cancellation", async () => {
    const coordinator = new InMemoryDrawingRunCoordinator({ createRunId: () => "run-1", now: () => "2026-08-22T00:00:00.000Z" });
    const started = await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-1", intent });
    expect(await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-1", intent })).toEqual(started);
    expect(started).toMatchObject({ runId: "run-1", status: "received", revision: 0, allowedActions: ["accept_input", "cancel"] });
    const cancelled = await coordinator.cancel({ ownerId: "owner-1", deviceId: "device-1", runId: "run-1", expectedRevision: 0, idempotencyKey: "cancel-1" });
    expect(cancelled).toMatchObject({ status: "cancelled", revision: 1, allowedActions: [] });
    expect(await coordinator.cancel({ ownerId: "owner-1", deviceId: "device-1", runId: "run-1", expectedRevision: 0, idempotencyKey: "cancel-1" })).toEqual(cancelled);
  });

  it("rejects foreign access and stale concurrent commands", async () => {
    const coordinator = new InMemoryDrawingRunCoordinator({ createRunId: () => "run-1" });
    await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-1", intent });
    await expect(coordinator.get("owner-2", "run-1")).resolves.toBeNull();
    await expect(coordinator.cancel({ ownerId: "owner-1", deviceId: "foreign", runId: "run-1", expectedRevision: 0, idempotencyKey: "cancel-1" })).rejects.toBeInstanceOf(DrawingRunError);
  });

  it("restores start idempotency from the shared durable store", async () => {
    const foundation = new InMemoryFoundationStore();
    const first = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), createRunId: () => "run-1" });
    const input = { ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-1", intent };
    const started = await first.start(input);
    const second = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), createRunId: () => "run-2" });
    await expect(second.start(input)).resolves.toEqual(started);
  });
});
