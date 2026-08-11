# Electron Device Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the server-issued device id beside the DPAPI device key and complete the Electron registration-to-relogin authorization data flow.

**Architecture:** Extend the main-process `DeviceKeyStore` with a write-once `deviceId` metadata field. Add one fixed IPC channel and preload method for binding; the client auth gate calls it immediately after server registration. The API's existing public-key challenge verification remains the authorization truth.

**Tech Stack:** Node.js ESM, Electron 43, Node `crypto`, Windows DPAPI adapter, Vitest, existing browser-independent auth gate tests.

## Global Constraints

- Private key bytes never enter renderer code, IPC responses, API payloads, PostgreSQL, or logs.
- `deviceId` is non-secret metadata and is accepted only through the fixed bridge method.
- Binding is write-once and idempotent; conflicting ids never replace the original association.
- The existing API challenge/signature protocol and one-active-session lease remain unchanged.
- Every implementation behavior starts with a failing test.

---

### Task 1: DPAPI key-store device binding

**Files:**
- Modify: `apps/desktop/device-key-store.mjs`
- Modify: `apps/desktop/device-key-store.test.js`

**Interfaces:**
- Produces `getIdentity()` with an optional `id` field after binding.
- Produces `bindDeviceId(deviceId): Promise<{ id: string }>`.

- [ ] Add failing tests for binding, reload, idempotence, conflicting ids, and invalid ids.
- [ ] Run `npm run api:test -- apps/desktop/device-key-store.test.js` and observe the missing method/behavior failure.
- [ ] Implement optional `deviceId` document metadata, validation, atomic persistence, and identity projection.
- [ ] Run the focused test and `node --check apps/desktop/device-key-store.mjs`.
- [ ] Commit `feat: persist bound desktop device id`.

### Task 2: Electron bridge and provider

**Files:**
- Modify: `apps/desktop/channels.mjs`
- Modify: `apps/desktop/main.mjs`
- Modify: `apps/desktop/preload.mjs`
- Modify: `apps/desktop/electron-bridge.test.js`
- Modify: `apps/client/device-key-provider.js`
- Modify: `apps/client/device-key-provider.test.js`

**Interfaces:**
- Adds `device-key:bind-device`.
- Exposes `window.synapseDeviceKey.bindDeviceId(deviceId)`.
- Provider delegates `bindDeviceId` to the bridge in production and allows no-op fallback only in development.

- [ ] Add failing tests for fixed channel registration, input validation, preload exposure, and provider delegation.
- [ ] Run the focused bridge/provider tests and confirm the missing binding behavior.
- [ ] Implement the main handler, preload method, and provider boundary.
- [ ] Run focused tests and JavaScript syntax checks.
- [ ] Commit `feat: expose desktop device binding bridge`.

### Task 3: Auth gate registration binding

**Files:**
- Modify: `apps/client/auth-gate.js`
- Modify: `apps/client/auth-device-proof.test.js`
- Create: `apps/client/auth-device-binding.test.js`

**Interfaces:**
- After `/api/auth/register` returns a device, call `deviceProvider.bindDeviceId(registration.device.id)` before reporting registration success.
- Preserve browser development fallback behavior by making binding optional outside production bridge mode.

- [ ] Add a failing registration test that proves the server-issued id is bound before the subsequent login.
- [ ] Run the focused auth tests and observe that the provider is not called today.
- [ ] Implement the smallest auth-gate change.
- [ ] Run focused auth tests and syntax checks.
- [ ] Commit `feat: bind registered device in auth gate`.

### Task 4: Full verification and delivery

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/verification-foundation.md`

- [ ] Document the restart/relogin binding behavior and remaining signed-release gates.
- [ ] Run `npm run api:test`, `npm run api:check`, `npx tsc --noEmit`, all syntax checks, PostgreSQL/Redis smokes, `npm run desktop:rebuild`, and `npm run desktop:smoke`.
- [ ] Inspect `git diff --check`, staged paths, and the final branch status.
- [ ] Commit `docs: document electron device binding acceptance`.
