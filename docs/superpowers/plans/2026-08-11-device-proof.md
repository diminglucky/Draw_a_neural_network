# Windows Device Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-time Ed25519 device proof to the API and define the renderer-safe Electron key-provider boundary.

**Architecture:** The API creates and atomically consumes short-lived challenges. SessionService verifies the signature against the registered device public key before production login. The client exposes identity/signing through an IPC-shaped provider; native DPAPI storage remains behind that provider.

**Tech Stack:** TypeScript/NodeNext, Node `crypto`, Fastify, PostgreSQL 16, Vitest, vanilla JavaScript client, Docker Compose.

## Global Constraints

- Production login requires a valid device proof.
- The private key never enters renderer code, API payloads, PostgreSQL, or logs.
- Challenge consumption is one-time and atomic across API instances.
- Browser bootstrap identity is test/development-only.
- Machine fingerprint is not a cryptographic credential.
- Every new behavior starts with a failing test.
- Native DPAPI implementation and signed Electron packaging remain separate later gates.

---

### Task 1: Proof verifier and error contracts

**Files:**
- Modify: `apps/api/src/domain.ts`
- Create: `apps/api/src/device-proof.ts`
- Create: `apps/api/tests/device-proof.test.ts`

- [x] Add failing tests for valid Ed25519 signatures, wrong-message rejection, malformed key rejection, and bounded base64 signatures.
- [x] Run `npm run api:test -- apps/api/tests/device-proof.test.ts` and observe the missing verifier failure.
- [x] Implement `verifyDeviceSignature(publicKeyPem, challenge, signatureBase64): boolean` using Node `crypto.verify` and add `DEVICE_PROOF_REQUIRED`, `DEVICE_PROOF_INVALID`, and `DEVICE_CHALLENGE_INVALID` error codes.
- [x] Run focused tests and `npx tsc --noEmit`.
- [x] Commit `feat: add device proof verifier`.

### Task 2: Durable challenge contract and Store

**Files:**
- Modify: `apps/api/src/domain.ts`
- Modify: `apps/api/src/store.ts`
- Modify: `apps/api/src/postgres-store.ts`
- Modify: `apps/api/sql/001_foundation.sql`
- Create: `apps/api/sql/003_device_challenges.sql`
- Create or modify: `apps/api/tests/device-challenge-store.test.ts`

- [x] Add failing tests for challenge creation and atomic consume, including second-consume rejection and expiry rejection.
- [x] Run focused tests and observe missing challenge methods/table contract.
- [x] Add `DeviceChallenge`, `createDeviceChallenge`, and `consumeDeviceChallenge` to both stores; use PostgreSQL `UPDATE ... WHERE consumed_at IS NULL AND expires_at > $2 RETURNING`.
- [x] Add the initial schema table and an idempotent upgrade migration for existing Docker volumes.
- [x] Run Store tests and TypeScript checking.
- [x] Commit `feat: persist device challenges`.

### Task 3: SessionService and HTTP production gate

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/session-service.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/tests/routes.test.ts`
- Create: `apps/api/tests/device-proof-flow.test.ts`

- [x] Add failing tests for challenge issuance, proof login, replay rejection, wrong-device rejection, and production missing-proof rejection.
- [x] Run focused tests and confirm routes/SessionService have no challenge flow.
- [x] Implement `createLoginChallenge`, consume-before-verify proof validation, `REQUIRE_DEVICE_PROOF`, `/api/auth/challenge`, and login payload parsing.
- [x] Preserve development test login without proof only when `requireDeviceProof` is false.
- [x] Run all API tests and TypeScript checking.
- [x] Commit `feat: require device proof for production login`.

### Task 4: Electron-safe client provider boundary

**Files:**
- Create: `apps/client/device-key-provider.js`
- Create: `apps/client/device-key-provider.test.js`
- Modify: `apps/client/auth-gate.js`
- Modify: `README.md`

- [x] Add failing tests for IPC identity/signing delegation, missing bridge rejection in production, and development-only browser fallback.
- [x] Implement a provider that accepts an injected bridge; renderer code can request identity/signature but cannot access private key material.
- [x] Keep the existing bootstrap path only behind an explicit development flag and document that it is not commercial security.
- [x] Run client tests and JavaScript syntax checks.
- [x] Commit `feat: add electron device key provider boundary`.

### Task 5: Docker challenge smoke and documentation

**Files:**
- Modify: `scripts/postgres-smoke.mjs`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/verification-foundation.md`

- [x] Extend PostgreSQL smoke to create, consume, reject replay, and reject expired challenges.
- [x] Run all API tests, both smoke scripts, source checks, syntax checks, and Docker health checks.
- [x] Record that DPAPI native implementation and signed installer acceptance remain pending.
- [x] Commit `test: verify device proof challenge flow`.

## Self-review

- Cryptographic verification, durable one-time state, service orchestration, renderer boundary, and real PostgreSQL acceptance are separate tasks.
- The protocol does not claim that a fingerprint prevents machine cloning; only private-key proof authenticates the device.
- Native DPAPI and package signing are intentionally not conflated with the server protocol.
