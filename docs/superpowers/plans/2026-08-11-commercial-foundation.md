# Commercial Foundation Platform Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Build the first runnable commercial foundation for Synapse Studio: authenticated access, device registration, one-active-device sessions, subscriptions/entitlements, admin monitoring, audit logs, jobs, and explicit Agent/Visio adapter boundaries.

**Architecture:** Keep the existing browser canvas intact and add a modular Node.js API plus shared contracts. The first slice uses an explicit in-memory development store so it can run and test without pretending PostgreSQL/Redis are configured; SQL migrations and store interfaces define the production boundary. A future Electron shell will own the device key, while the current client gets an authentication gate and status integration.

**Tech Stack:** Node.js ESM, Fastify, TypeScript/tsx, Zod, Argon2id, JOSE JWTs, Vitest, PostgreSQL migration SQL, Redis lease contract, vanilla HTML/JavaScript admin and client UI.

## Global Constraints

- Windows is the target desktop platform; OpenAI and Visio are not invoked in this phase.
- The client must not receive model API keys or service-side authorization secrets.
- One user may have at most one ACTIVE session; a second active device receives ACCOUNT_ALREADY_IN_USE.
- Development may use the explicit memory store; production configuration must select a durable store and must not silently claim PostgreSQL persistence.
- Agent and Visio functionality must return explicit not-configured errors, never simulated success.
- All authentication, device, session, subscription, job, and admin mutations emit audit records.
- Use apply_patch for source edits and run focused tests before broader checks.

## File Map

- Create package.json, tsconfig.json, vitest.config.js: API/test scripts and dependencies.
- Create apps/api/src/app.ts: Fastify composition and route registration.
- Create apps/api/src/config.ts: validated environment configuration.
- Create apps/api/src/domain.ts: shared domain types and error codes.
- Create apps/api/src/security.ts: password hashing, token signing, device proof helpers.
- Create apps/api/src/store.ts: store interface and in-memory implementation.
- Create apps/api/src/session-service.ts: authentication, device registration, single-device lease, heartbeat, logout.
- Create apps/api/src/admin-service.ts: admin queries and force-revoke operations.
- Create apps/api/src/job-service.ts: job lifecycle and unavailable adapter results.
- Create apps/api/src/routes.ts: user, device, subscription, job, and admin HTTP routes.
- Create apps/api/src/main.ts: local API entrypoint.
- Create apps/api/src/adapters.ts: AgentProvider and VisioExecutor interfaces with not-configured implementations.
- Create apps/api/tests/session-service.test.ts: auth, device, single-session and heartbeat tests.
- Create apps/api/tests/routes.test.ts: HTTP contract tests for locked access, admin, jobs and errors.
- Create apps/api/tests/security.test.ts: password and token tests.
- Create apps/api/sql/001_foundation.sql: PostgreSQL schema and single-active-session constraints.
- Create apps/admin/index.html, apps/admin/admin.js, apps/admin/admin.css: minimal authenticated admin console.
- Create apps/client/auth-gate.js: client-side status gate for the existing page.
- Create apps/client/auth-gate.css: locked/unlocked status presentation.
- Modify index.html: load the authentication gate and expose the foundation status panel.
- Modify styles.css: style the foundation status panel without changing canvas rendering.
- Create infra/docker-compose.yml: optional PostgreSQL and Redis development services.
- Create .env.example: documented development and production configuration names.
- Modify README.md: foundation setup, API scripts, dev-store warning, and phase boundary.

### Task 1: Workspace and shared API contracts

**Files:**
- Create: package.json
- Create: tsconfig.json
- Create: vitest.config.js
- Create: apps/api/src/domain.ts
- Test: apps/api/tests/domain.test.ts

**Interfaces:**
- Produces domain types User, Device, Session, Subscription, Job, AuditRecord, and ApiErrorCode.
- Produces scripts npm run api:test, npm run api:dev, and npm run api:check.

- [ ] Step 1: Write the failing contract test.

Create apps/api/tests/domain.test.ts and assert that ACCOUNT_ALREADY_IN_USE, SESSION_REVOKED, AGENT_PROVIDER_NOT_CONFIGURED, and VISIO_EXECUTOR_NOT_CONFIGURED are exported.

- [ ] Step 2: Run the test to verify it fails.

Run: npm run api:test -- apps/api/tests/domain.test.ts
Expected: FAIL because the workspace and domain module do not yet exist.

- [ ] Step 3: Add the workspace and domain definitions.

Create the ESM package scripts and define plain serializable domain types. Keep public error code strings stable because the desktop client and admin console consume them.

- [ ] Step 4: Run the focused test.

Run: npm run api:test -- apps/api/tests/domain.test.ts
Expected: PASS.

- [ ] Step 5: Commit.

~~~powershell
git add package.json tsconfig.json vitest.config.js apps/api/src/domain.ts apps/api/tests/domain.test.ts
git commit -m "feat: add foundation workspace contracts"
~~~

### Task 2: Security primitives and configuration

**Files:**
- Create: apps/api/src/config.ts
- Create: apps/api/src/security.ts
- Test: apps/api/tests/security.test.ts

**Interfaces:**
- loadConfig(env): AppConfig
- hashPassword(password): Promise<string>
- verifyPassword(password, encodedHash): Promise<boolean>
- signAccessToken(payload, secret, now?): Promise<string>
- verifyAccessToken(token, secret, now?): Promise<AccessTokenClaims>
- hashRefreshToken(token): string

- [ ] Step 1: Write failing security tests.

Cover password round-trip, wrong-password rejection, token round-trip, expired-token rejection, and configuration failure when SESSION_SECRET is missing in production mode.

- [ ] Step 2: Run the focused tests.

Run: npm run api:test -- apps/api/tests/security.test.ts
Expected: FAIL because security and config modules do not exist.

- [ ] Step 3: Implement the primitives.

Use Argon2id for passwords, JOSE-compatible signed JWTs for short-lived access tokens, SHA-256 for refresh-token storage, and Zod-backed environment parsing. Development may use a documented local secret; production must require an explicit secret.

- [ ] Step 4: Run the focused tests.

Run: npm run api:test -- apps/api/tests/security.test.ts
Expected: PASS.

- [ ] Step 5: Commit.

~~~powershell
git add apps/api/src/config.ts apps/api/src/security.ts apps/api/tests/security.test.ts
git commit -m "feat: add auth security primitives"
~~~

### Task 3: Store and session service

**Files:**
- Create: apps/api/src/store.ts
- Create: apps/api/src/session-service.ts
- Test: apps/api/tests/session-service.test.ts

**Interfaces:**
- FoundationStore methods for users, devices, sessions, subscriptions, jobs, and audit records.
- SessionService.registerUser(input)
- SessionService.login(input)
- SessionService.registerDevice(input)
- SessionService.heartbeat(input)
- SessionService.logout(input)
- SessionService.revokeSession(input)
- SessionService.getCurrentAccess(input)

- [ ] Step 1: Write failing service tests.

Cover registration, duplicate email rejection, login, device registration, first session activation, second-device rejection with ACCOUNT_ALREADY_IN_USE, heartbeat renewal, expired lease rejection, logout, admin revocation, and audit record creation.

- [ ] Step 2: Run the focused tests.

Run: npm run api:test -- apps/api/tests/session-service.test.ts
Expected: FAIL because the store and service do not exist.

- [ ] Step 3: Implement the in-memory store and service.

Implement deterministic in-memory maps with explicit lease timestamps. The store must expose an atomic claimActiveSession(userId, session) operation so the service contract mirrors the future PostgreSQL/Redis implementation. Do not use a client-supplied isPro or machineCode as authorization truth.

- [ ] Step 4: Run the focused tests.

Run: npm run api:test -- apps/api/tests/session-service.test.ts
Expected: PASS.

- [ ] Step 5: Commit.

~~~powershell
git add apps/api/src/store.ts apps/api/src/session-service.ts apps/api/tests/session-service.test.ts
git commit -m "feat: enforce single-device sessions"
~~~

### Task 4: Jobs and adapter boundaries

**Files:**
- Create: apps/api/src/adapters.ts
- Create: apps/api/src/job-service.ts
- Test: apps/api/tests/job-service.test.ts

**Interfaces:**
- AgentProvider.chat, AgentProvider.analyzeCode, AgentProvider.analyzeImage.
- VisioExecutor.healthCheck, VisioExecutor.executeDiagram, VisioExecutor.readback.
- JobService.create, JobService.get, JobService.cancel.

- [ ] Step 1: Write failing job tests.

Assert that jobs move through queued, running, failed, cancelled, and succeeded states, and that unconfigured Agent/Visio adapters return AGENT_PROVIDER_NOT_CONFIGURED or VISIO_EXECUTOR_NOT_CONFIGURED rather than success.

- [ ] Step 2: Run the focused tests.

Run: npm run api:test -- apps/api/tests/job-service.test.ts
Expected: FAIL because adapters and job service do not exist.

- [ ] Step 3: Implement explicit adapter stubs and job lifecycle.

Persist each transition and emit an audit/job event. Keep adapter input/output types serializable and independent of OpenAI or COM classes.

- [ ] Step 4: Run the focused tests.

Run: npm run api:test -- apps/api/tests/job-service.test.ts
Expected: PASS.

- [ ] Step 5: Commit.

~~~powershell
git add apps/api/src/adapters.ts apps/api/src/job-service.ts apps/api/tests/job-service.test.ts
git commit -m "feat: add job and integration adapter boundaries"
~~~

### Task 5: HTTP API and admin routes

**Files:**
- Create: apps/api/src/admin-service.ts
- Create: apps/api/src/routes.ts
- Create: apps/api/src/app.ts
- Create: apps/api/src/main.ts
- Test: apps/api/tests/routes.test.ts

**Interfaces:**
- buildApp(options): FastifyInstance
- User routes under /api/auth, /api/devices, /api/license, and /api/jobs.
- Admin routes under /api/admin.

- [ ] Step 1: Write failing HTTP tests.

Cover locked access without a token, register/login, current session, duplicate active-device login, heartbeat, logout, job creation, admin login, user/device/session listing, and force revoke.

- [ ] Step 2: Run the focused tests.

Run: npm run api:test -- apps/api/tests/routes.test.ts
Expected: FAIL because the Fastify app and routes do not exist.

- [ ] Step 3: Implement route composition.

Use a single consistent error serializer, request IDs, authorization hooks, and explicit admin authorization. The development store is injected into buildApp so tests do not depend on external services. Admin mutations must accept a reason and write audit records.

- [ ] Step 4: Run the focused tests.

Run: npm run api:test -- apps/api/tests/routes.test.ts
Expected: PASS.

- [ ] Step 5: Run the API locally.

Run: npm run api:dev
Expected: the API listens on http://127.0.0.1:4180 and /health returns { "status": "ok" }.

- [ ] Step 6: Commit.

~~~powershell
git add apps/api/src apps/api/tests/routes.test.ts
git commit -m "feat: expose foundation auth and admin API"
~~~

### Task 6: Database migration and infrastructure boundary

**Files:**
- Create: apps/api/sql/001_foundation.sql
- Create: infra/docker-compose.yml
- Create: apps/api/src/production-store-not-configured.ts
- Modify: apps/api/src/config.ts
- Test: apps/api/tests/production-boundary.test.ts

- [ ] Step 1: Write migration verification checks.

Add a test that checks required SQL identifiers and the partial unique index for active user sessions. Add a config test that production mode rejects STORAGE_DRIVER=memory.

- [ ] Step 2: Run the checks to verify they fail.

Run: npm run api:check
Expected: FAIL because the migration and production guard do not exist.

- [ ] Step 3: Add the schema and compose boundary.

Create PostgreSQL tables for users, devices, sessions, subscriptions, entitlements, jobs, job events, admins, and audit logs. Create PostgreSQL and Redis service definitions without making the current test suite depend on Docker.

- [ ] Step 4: Run the checks.

Run: npm run api:check
Expected: PASS and the script reports that memory storage is development-only.

- [ ] Step 5: Commit.

~~~powershell
git add apps/api/sql/001_foundation.sql apps/api/src/production-store-not-configured.ts apps/api/src/config.ts infra/docker-compose.yml apps/api/tests/production-boundary.test.ts
git commit -m "feat: define production persistence boundary"
~~~

### Task 7: Client auth gate and admin console

**Files:**
- Create: apps/client/auth-gate.js
- Create: apps/client/auth-gate.css
- Create: apps/admin/index.html
- Create: apps/admin/admin.js
- Create: apps/admin/admin.css
- Test: apps/client/auth-gate.test.js
- Modify: index.html
- Modify: styles.css

**Interfaces:**
- Client gate consumes /api/auth/session, /api/license/status, and /api/devices/heartbeat.
- Admin console consumes /api/admin/dashboard, /api/admin/users, /api/admin/devices, /api/admin/sessions, and /api/admin/audit-logs.

- [ ] Step 1: Write UI behavior checks.

Add browser-independent DOM tests for locked state, authorized state, heartbeat failure locking, and admin table rendering. Keep current canvas rendering unchanged.

- [ ] Step 2: Run the checks.

Run: npm run api:test -- apps/client/auth-gate.test.js
Expected: FAIL because the gate does not exist.

- [ ] Step 3: Implement the gate and minimal admin console.

The client must show locked status before authorization and a clear placeholder for Agent/Visio not-configured states. The admin console must show users, active devices, sessions, job counts, and provide force-revoke controls with a reason field.

- [ ] Step 4: Run focused UI checks and syntax checks.

Run: npm run api:test -- apps/client/auth-gate.test.js; node --check apps/admin/admin.js; node --check apps/client/auth-gate.js
Expected: PASS.

- [ ] Step 5: Commit.

~~~powershell
git add apps/client apps/admin index.html styles.css
git commit -m "feat: add client authorization gate and admin console"
~~~

### Task 8: Documentation and full verification

**Files:**
- Modify: README.md
- Modify: package.json if scripts need final names
- Create: docs/superpowers/plans/verification-foundation.md

- [ ] Step 1: Document local development.

Document Node version, npm install, npm run api:test, npm run api:dev, memory-store limitations, environment variables, optional Docker services, and the explicit absence of real OpenAI/Visio behavior in this phase.

- [ ] Step 2: Run the full verification suite.

Run:

~~~powershell
npm run api:test
npm run api:check
node --check server.js
node --check app.js
node --check models.js
node --check code-workflow.js
node --check ai-workflow.js
git diff --check
~~~

Expected: all tests pass, all syntax checks pass, and git diff --check is clean.

- [ ] Step 3: Inspect the final change set.

Run:

~~~powershell
git status --short
git diff --stat HEAD~8..HEAD
git log --oneline -10
~~~

Confirm only foundation files changed and no OpenAI key, test secret, generated database, or user data was committed.

- [ ] Step 4: Commit documentation.

~~~powershell
git add README.md docs/superpowers/plans/verification-foundation.md package.json
git commit -m "docs: document commercial foundation setup"
~~~

## Plan Self-Review

- Spec coverage: authentication, device identity, one-active-session enforcement, subscriptions, admin monitoring, audit, jobs, adapters, client gate, persistence boundary, and verification each map to one or more tasks.
- Placeholder scan: explicit adapter stubs are intentional and return stable not-configured errors; there are no unresolved design placeholders.
- Type consistency: AgentProvider, VisioExecutor, FoundationStore, SessionService, JobService, and route paths are named consistently across tasks.
- Scope boundary: OpenAI analysis and Visio COM are intentionally deferred; the plan produces a runnable commercial foundation without pretending those integrations are complete.
