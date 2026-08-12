import { describe, expect, it } from "vitest";
import { applyGateState, createAuthGate, renderAdminTable, GATE_STATE } from "./auth-gate.js";

function fakeElement() {
  return {
    dataset: {},
    hidden: false,
    textContent: "",
    innerHTML: "",
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      },
      contains(name) { return this.values.has(name); },
    },
    query: new Map(),
    querySelector(selector) { return this.query.get(selector) ?? null; },
  };
}

function fakeStorage(values = {}) {
  return {
    values: new Map(Object.entries(values)),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
    removeItem(key) { this.values.delete(key); },
  };
}

describe("client authorization gate", () => {
  it("starts locked and explains that online authorization is required", () => {
    const root = fakeElement();
    const status = fakeElement();
    root.query.set("[data-gate-status]", status);

    applyGateState(root, { state: GATE_STATE.LOCKED, message: "请登录" });

    expect(root.dataset.state).toBe(GATE_STATE.LOCKED);
    expect(root.hidden).toBe(false);
    expect(status.textContent).toContain("请登录");
  });

  it("unlocks the canvas only after the server confirms a session", () => {
    const root = fakeElement();
    const status = fakeElement();
    const identity = fakeElement();
    root.query.set("[data-gate-status]", status);
    root.query.set("[data-gate-identity]", identity);

    applyGateState(root, {
      state: GATE_STATE.AUTHORIZED,
      message: "已授权",
      identity: "user@example.com · Windows device",
    });

    expect(root.hidden).toBe(true);
    expect(root.dataset.state).toBe(GATE_STATE.AUTHORIZED);
    expect(identity.textContent).toContain("user@example.com");
    expect(status.textContent).toContain("已授权");
  });

  it("returns to locked state when the heartbeat loses the lease", () => {
    const root = fakeElement();
    const status = fakeElement();
    root.query.set("[data-gate-status]", status);

    applyGateState(root, { state: GATE_STATE.LOCKED, message: "会话已失效，请重新登录" });

    expect(root.hidden).toBe(false);
    expect(root.dataset.state).toBe(GATE_STATE.LOCKED);
    expect(root.classList.contains("is-authorized")).toBe(false);
  });

  it("clears the token and locks when an administrator revoked the server session", async () => {
    const root = fakeElement();
    const status = fakeElement();
    root.query.set("[data-gate-status]", status);
    const storage = fakeStorage({ "synapse.accessToken": "revoked-token" });
    const gate = createAuthGate({
      root,
      storage,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        async json() { return { error: { message: "Session is no longer active", code: "SESSION_REVOKED" } }; },
      }),
    });

    expect(await gate.heartbeat()).toBe(false);
    expect(storage.getItem("synapse.accessToken")).toBeNull();
    expect(gate.getState()).toBe(GATE_STATE.LOCKED);
    expect(status.textContent).toContain("会话已失效");
  });
});

describe("admin table rendering", () => {
  it("renders escaped rows for monitored sessions", () => {
    const html = renderAdminTable([
      { id: "s1", userId: "u1", deviceId: "d1", status: "active", leaseExpiresAt: "2026-08-11T10:00:00.000Z" },
    ], ["id", "userId", "deviceId", "status", "leaseExpiresAt"]);

    expect(html).toContain("s1");
    expect(html).toContain("active");
    expect(html).not.toContain("undefined");
  });
});
