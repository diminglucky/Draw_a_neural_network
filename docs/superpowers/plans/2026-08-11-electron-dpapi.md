# Electron DPAPI Device Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows DPAPI-backed Ed25519 key store and expose it through Electron main/preload IPC without placing private-key material in renderer code.

**Architecture:** `DeviceKeyStore` is a small main-process service with injected DPAPI and filesystem dependencies. Electron main registers two IPC handlers and preload exposes only typed methods. The existing browser provider continues to work only when production proof is disabled.

**Tech Stack:** Electron 43, Node `crypto`, `win-dpapi` 1.1.0, ESM, Vitest, Docker-backed API already present.

## Global Constraints

- Private key bytes never enter renderer, IPC response, API request, PostgreSQL, or logs.
- DPAPI scope is fixed to `CurrentUser` and the key file stays under Electron `app.getPath('userData')`.
- Existing encrypted key material is not silently replaced.
- Main IPC accepts only identity/sign requests and bounds challenge length to 4096 bytes.
- Linux/test environments use injected fakes; production native acceptance is Windows-only.
- Every new behavior starts with a failing test.

---

### Task 1: DPAPI key-store contract

**Files:**
- Create: `apps/desktop/device-key-store.mjs`
- Create: `apps/desktop/device-key-store.test.mjs`

- [ ] Add failing tests for first key generation, persistence/reload, signing, malformed-file rejection, and atomic file writes using fake DPAPI/filesystem dependencies.
- [ ] Run `npm run api:test -- apps/desktop/device-key-store.test.mjs` and observe the missing module failure.
- [ ] Implement `createDeviceKeyStore({ storagePath, dpapi, fsImpl, now })` with `getIdentity()` and `signChallenge(challenge)`.
- [ ] Run focused tests and `node --check apps/desktop/device-key-store.mjs`.
- [ ] Commit `feat: add dpapi device key store`.

### Task 2: Electron main and preload bridge

**Files:**
- Create: `apps/desktop/main.mjs`
- Create: `apps/desktop/preload.mjs`
- Create: `apps/desktop/electron-bridge.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Add failing tests for fixed IPC channel registration, challenge type/length validation, and preload method exposure.
- [ ] Run focused bridge tests and observe missing Electron bridge modules.
- [ ] Implement main-process handlers and preload `contextBridge` exposure; load the existing UI URL from `FOUNDATION_UI_URL`.
- [ ] Add `desktop:dev` and Electron dependencies; keep native DPAPI import main-process-only.
- [ ] Run bridge tests and JavaScript syntax checks.
- [ ] Commit `feat: add electron device proof bridge`.

### Task 3: Native Windows dependency and local acceptance

**Files:**
- Modify: `apps/desktop/main.mjs`
- Modify: `README.md`
- Modify: `.env.example`
- Create: `scripts/desktop-dpapi-smoke.mjs`

- [ ] Implement runtime loading of `win-dpapi` and fail clearly on non-Windows production startup.
- [ ] Run `npm install`/Electron rebuild on Windows and verify the native module loads.
- [ ] Run a DPAPI smoke that creates/reloads the key, signs a challenge, and verifies the signature against the API verifier.
- [ ] Document that native DPAPI and signed installer acceptance are Windows-only release gates.
- [ ] Run all API/client tests, syntax checks, both existing smokes, and the DPAPI smoke.
- [ ] Commit `test: verify windows dpapi device key`.

## Self-review

- Key storage, IPC, native dependency, and release acceptance are separate boundaries.
- A DPAPI-backed key proves possession of the Windows user-protected key; it does not by itself prevent a fully compromised local account from using the client.
- The API protocol and browser development fallback remain compatible.
