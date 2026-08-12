# Admin Control Plane V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the administrator V1 control plane for user/device status management, session revocation, auditability, and real client-lock behavior.

**Architecture:** Reuse the existing `AdminService`, `SessionService`, `FoundationStore`, JWT admin routes, and vanilla admin page. `AdminService` owns validation, status changes, affected-session revocation, and audit records; routes remain thin adapters; the page calls the new endpoints and refreshes the existing tables.

**Tech Stack:** Fastify 5, TypeScript, Vitest, PostgreSQL-compatible `FoundationStore`, Redis/in-memory lease coordinators, vanilla ES modules, HTML/CSS.

## Global Constraints

- Do not add a new database table or runtime dependency.
- The API remains the source of truth for status and authorization.
- Every state-changing administrator action requires a non-blank reason and writes an audit record.
- Disabling a user/device revokes affected active sessions through `SessionService.revokeSession()` so lease release and fencing stay centralized.
- Re-enabling never creates a session; the user must log in again through the existing device-proof flow.
- Follow TDD: write and run a failing test before production code for each behavior.

---

### Task 1: Add failing service tests for admin status transitions

**Files:**
- Create: `apps/api/tests/admin-control-plane.test.ts`
- Read: `apps/api/src/admin-service.ts`, `apps/api/src/session-service.ts`, `apps/api/src/store.ts`, `apps/api/src/domain.ts`

**Interfaces:**
- Consumes: `buildApp`, `AdminService`, existing `FoundationStore` entities.
- Produces: tests defining `setUserStatus(userId, status, actorId, reason)` and `setDeviceStatus(deviceId, status, actorId, reason)` behavior.

- [x] **Step 1: Write the failing tests**

Cover these exact behaviors:

```ts
it("disables a user, revokes its active session, and audits the action", async () => {
  // register user/device, login, call POST /api/admin/users/:id/status,
  // assert 200, user status disabled, session revoked, audit action present,
  // and the old user token returns SESSION_REVOKED.
});

it("disables a device and revokes only sessions using that device", async () => {
  // create two users/devices/sessions, disable one device,
  // assert only its session is revoked and the other remains active.
});

it("re-enables without issuing access and rejects blank reasons or unsupported status", async () => {
  // assert 400 and unchanged state for invalid requests;
  // assert a valid re-enable returns a user/device but no accessToken.
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npx vitest run apps/api/tests/admin-control-plane.test.ts
```

Expected: FAIL because the admin status endpoints/service methods do not exist.

### Task 2: Implement service and route behavior

**Files:**
- Modify: `apps/api/src/admin-service.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/domain.ts` only if a new error code is required; reuse existing codes where possible.
- Test: `apps/api/tests/admin-control-plane.test.ts`

**Interfaces:**
- Consumes: existing `FoundationStore`, `SessionService.revokeSession`.
- Produces:
  - `AdminService.setUserStatus(userId, status, actorId, reason): Promise<User>`
  - `AdminService.setDeviceStatus(deviceId, status, actorId, reason): Promise<Device>`
  - `POST /api/admin/users/:id/status`
  - `POST /api/admin/devices/:id/status`

- [x] **Step 1: Add validation and status mutation tests for the service boundary**

Use real `buildApp` injection and assert the existing error envelope for blank reasons, invalid status values, and missing IDs.

- [x] **Step 2: Run the focused tests and confirm the new assertions fail**

```powershell
npx vitest run apps/api/tests/admin-control-plane.test.ts
```

- [x] **Step 3: Implement minimal service behavior**

Use this behavior:

```ts
const ADMIN_MUTABLE_STATUS = new Set(["active", "disabled"]);

async function setUserStatus(userId, status, actorId, reason) {
  validateAdminMutation(status, reason);
  const user = await store.getUser(userId);
  if (!user) throw new FoundationError(ApiErrorCode.USER_NOT_FOUND, "User was not found", 404);
  user.status = status;
  await store.updateUser(user);
  if (status === "disabled") {
    for (const session of await store.listSessions()) {
      if (session.userId === user.id && session.status === "active") {
        await sessions.revokeSession({ sessionId: session.id, actorId, reason });
      }
    }
  }
  await audit("admin", actorId, `user.${status}`, "user", user.id, reason, { status });
  return user;
}
```

Implement the same explicit flow for devices, filtering by `deviceId` when revoking sessions and writing `device.active`/`device.disabled` audit actions. Do not delete rows or unbind public keys.

- [x] **Step 4: Add thin authenticated routes**

Validate `request.params.id`, `body.status`, and `body.reason` through the service. Obtain the administrator actor from `requireAdmin`, and return `{ user: publicUser(user) }` or `{ device }`.

- [x] **Step 5: Run focused tests and verify green**

```powershell
npx vitest run apps/api/tests/admin-control-plane.test.ts
```

Expected: all admin control-plane tests pass.

### Task 3: Enforce disabled state at current-session boundaries

**Files:**
- Modify: `apps/api/src/session-service.ts`
- Modify: `apps/api/tests/admin-control-plane.test.ts`

**Interfaces:**
- Consumes: existing `getCurrentAccess`, `heartbeat`, `login` paths.
- Produces: disabled users/devices cannot continue using an otherwise valid bearer token.

- [x] **Step 1: Add a failing boundary test**

Create a valid session, mutate the backing user/device to `disabled` through the admin endpoint, then assert `/api/auth/session` and `/api/devices/heartbeat` return the expected authorization error even if a session record still exists.

- [x] **Step 2: Run the focused test and confirm the failure**

```powershell
npx vitest run apps/api/tests/admin-control-plane.test.ts
```

- [x] **Step 3: Implement the smallest guard**

After resolving the session user/device in `getCurrentAccess` and heartbeat, reject a disabled user with `USER_DISABLED` and a disabled device with `DEVICE_NOT_AUTHORIZED`, while preserving existing `SESSION_REVOKED` behavior for revoked sessions.

- [x] **Step 4: Run the focused and existing session tests**

```powershell
npx vitest run apps/api/tests/admin-control-plane.test.ts apps/api/tests/session-service.test.ts apps/api/tests/routes.test.ts
```

### Task 4: Add admin page actions and filters

**Files:**
- Modify: `apps/admin/index.html`
- Modify: `apps/admin/admin.js`
- Modify: `apps/admin/admin.css`
- Create: `apps/admin/admin.test.js`

**Interfaces:**
- Consumes: `POST /api/admin/users/:id/status` and `POST /api/admin/devices/:id/status`.
- Produces: filterable users/devices tables, disable/enable buttons, reason prompt, refresh and error feedback.

- [x] **Step 1: Write failing pure rendering tests**

Export and test small helpers such as `statusAction(item, targetType)` and `filterRows(items, query)`; assert HTML escapes IDs/statuses and filters by email/name/id without executing DOM code.

- [x] **Step 2: Run the focused UI test and confirm it fails**

```powershell
npx vitest run apps/admin/admin.test.js
```

- [x] **Step 3: Implement minimal UI helpers and controls**

Add search inputs for users/devices, status action buttons with `data-status-target`/`data-status-kind`, and a shared `changeStatus()` function that prompts for a reason, calls the endpoint, then refreshes all admin data.

- [x] **Step 4: Run the focused UI test and syntax check**

```powershell
npx vitest run apps/admin/admin.test.js
node --check apps/admin/admin.js
```

### Task 5: Host acceptance and documentation

**Files:**
- Modify: `docs/superpowers/plans/verification-foundation.md`
- Modify: `docs/superpowers/specs/2026-08-12-admin-control-plane-v1-design.md` only for verified evidence, not planned behavior.

- [x] **Step 1: Run complete source verification**

```powershell
npm run api:test
npm run api:check
npx tsc --noEmit
node --check apps/admin/admin.js
node --check apps/desktop/main.mjs
node --check apps/desktop/preload.cjs
git diff --check
```

- [x] **Step 2: Run PostgreSQL and Redis smoke tests**

```powershell
npm run api:smoke:postgres
npm run api:smoke:redis
```

- [ ] **Step 3: Perform real HTTP/admin/client acceptance**

Start the API and static server, register/login a temporary Electron user, log into `/apps/admin/index.html`, disable the user, and confirm the Electron gate becomes locked after its next session check. Re-enable the user and require a fresh login. Do not retain test credentials or user-data directories.

Current evidence covers the API/static HTTP loop and client-gate regression test, but the real Electron window interaction and restart path remain pending.

- [ ] **Step 4: Review staged paths and commit the feature**

```powershell
git diff --check
git status --short
git add apps/api apps/admin docs/superpowers/specs/2026-08-12-admin-control-plane-v1-design.md docs/superpowers/plans/2026-08-12-admin-control-plane-v1.md docs/superpowers/plans/verification-foundation.md
git commit -m "feat: complete admin control plane v1"
```
