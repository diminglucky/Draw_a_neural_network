import { describe, expect, it } from "vitest";
import { InMemoryLeaseCoordinator } from "../src/lease-coordinator.js";

describe("InMemoryLeaseCoordinator", () => {
  it("allows one owner to claim and renew a lease until it expires", async () => {
    let now = new Date("2026-08-11T00:00:00.000Z");
    const coordinator = new InMemoryLeaseCoordinator({ now: () => new Date(now) });

    await expect(coordinator.claim("session:user-1", "session-1", 30)).resolves.toBe(true);
    await expect(coordinator.claim("session:user-1", "session-2", 30)).resolves.toBe(false);
    await expect(coordinator.renew("session:user-1", "session-2", 30)).resolves.toBe(false);
    await expect(coordinator.renew("session:user-1", "session-1", 30)).resolves.toBe(true);

    now = new Date("2026-08-11T00:01:00.000Z");
    await expect(coordinator.claim("session:user-1", "session-2", 30)).resolves.toBe(true);
    await coordinator.release("session:user-1", "session-2");
    await expect(coordinator.renew("session:user-1", "session-2", 30)).resolves.toBe(false);
  });
});
