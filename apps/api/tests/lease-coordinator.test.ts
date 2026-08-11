import { describe, expect, it } from "vitest";
import { InMemoryLeaseCoordinator } from "../src/lease-coordinator.js";

describe("InMemoryLeaseCoordinator", () => {
  it("allows one owner to claim and renew a lease until it expires", async () => {
    let now = new Date("2026-08-11T00:00:00.000Z");
    const coordinator = new InMemoryLeaseCoordinator({ now: () => new Date(now) });

    await expect(coordinator.claim("session:user-1", "session-1", 30)).resolves.toEqual({ acquired: true, fencingToken: 1 });
    await expect(coordinator.claim("session:user-1", "session-2", 30)).resolves.toEqual({ acquired: false, fencingToken: null });
    await expect(coordinator.renew("session:user-1", "session-2", 2, 30)).resolves.toEqual({ acquired: false, fencingToken: null });
    await expect(coordinator.renew("session:user-1", "session-1", 1, 30)).resolves.toEqual({ acquired: true, fencingToken: 1 });

    now = new Date("2026-08-11T00:01:00.000Z");
    await expect(coordinator.claim("session:user-1", "session-2", 30)).resolves.toEqual({ acquired: true, fencingToken: 2 });
    await coordinator.release("session:user-1", "session-2", 2);
    await expect(coordinator.renew("session:user-1", "session-2", 2, 30)).resolves.toEqual({ acquired: false, fencingToken: null });
  });
});
