import { describe, expect, it } from "vitest";
import type { AgentUsageReservation, AgentUsageReservationInput } from "../src/domain.js";
import { InMemoryFoundationStore } from "../src/store.js";

const baseUsage: AgentUsageReservationInput = {
  userId: "user-1",
  metric: "agentChatRequests",
  periodStart: "2026-08-01T00:00:00.000Z",
  idempotencyKey: "req-1",
  requestHash: "hash-1",
  amount: 1,
  limit: 1,
};

describe("InMemoryFoundationStore Agent usage", () => {
  it("reserves one monthly agent request and rejects the next request at the limit", async () => {
    const store = new InMemoryFoundationStore();

    await expect(store.reserveAgentUsage(baseUsage)).resolves.toMatchObject({
      consumed: 1,
      remaining: 0,
      state: "accepted",
    });
    await expect(store.reserveAgentUsage({ ...baseUsage, idempotencyKey: "req-2", requestHash: "hash-2" })).resolves.toBeNull();
  });

  it("does not consume twice for a repeated idempotency key", async () => {
    const store = new InMemoryFoundationStore();
    const input = { ...baseUsage, limit: 2 };

    const first = await store.reserveAgentUsage(input);
    const duplicate = await store.reserveAgentUsage(input);

    expect(first).toMatchObject({ consumed: 1 });
    expect(duplicate).toMatchObject({
      duplicate: true,
      requestHashMatches: true,
      reservation: { consumed: 1 },
    });
  });

  it("finalizes a reservation once without changing the consumed quota", async () => {
    const store = new InMemoryFoundationStore();
    const result = await store.reserveAgentUsage({ ...baseUsage, limit: 2 });
    if (!result || "duplicate" in result) throw new Error("expected a new usage reservation");
    const reservation: AgentUsageReservation = result;

    await expect(store.finalizeAgentUsage({
      id: reservation!.id,
      state: "failed",
      outcome: "provider_error",
      provider: "local-deterministic",
      errorCode: "AGENT_PROVIDER_FAILED",
    })).resolves.toMatchObject({ state: "failed", outcome: "provider_error" });
    await expect(store.finalizeAgentUsage({
      id: reservation!.id,
      state: "completed",
      outcome: "completed",
    })).resolves.toMatchObject({ state: "failed", outcome: "provider_error" });
  });
});
