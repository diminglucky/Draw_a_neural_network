# Visio Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Visio export Jobs from becoming permanently queued after an API restart and limit live Visio COM execution to a controlled global concurrency.

**Architecture:** Extend `VisioJobRunner` from an immediate per-Job launcher into a FIFO scheduler with a bounded `maxConcurrentJobs`. Startup recovery expires persisted `running` Jobs and resubmits persisted `queued` Visio Jobs through the same scheduler. The API configuration supplies the concurrency limit, while injected test runners remain deterministic.

**Tech Stack:** TypeScript, Fastify lifecycle hooks, Vitest, existing in-memory/PostgreSQL Job stores, Node `AbortController`.

## Global Constraints

- The project remains standalone; do not import NPP, Polars.NET, NppStudio, or their runtime assumptions.
- Visio COM remains inside the per-Job C# Worker and its single STA thread.
- The default global Visio concurrency is `1`; it must be configurable only through validated server configuration.
- Existing authenticated ownership, idempotency, cancellation, terminal-state, and Worker output-path boundaries remain unchanged.
- Every production behavior change starts from a failing test and is verified with focused tests before the full suite.
- Worker retry policy, Visio health API, installers, billing, and advanced diagram features remain out of scope for this plan.

---

### Task 1: Convert VisioJobRunner into a bounded FIFO scheduler

**Files:**
- Modify: `apps/api/src/visio-job-runner.ts`
- Modify: `apps/api/tests/visio-job-runner.test.ts`

**Interfaces:**
- `VisioJobRunnerOptions.maxConcurrentJobs?: number` defaults to `1`.
- `VisioJobRunner.submit(jobId: string): void` enqueues a non-terminal Visio Job once and starts it when capacity is available.
- `VisioJobRunner.recoverJobs(): Promise<void>` expires persisted `running` Jobs and enqueues persisted `queued` Visio Jobs.
- `VisioJobRunner.recoverStaleJobs(): Promise<void>` remains as a compatibility wrapper for stale-running recovery tests.

- [ ] **Step 1: Write failing scheduler and queued-recovery tests**

Add tests that use two abort-aware/delayed fake executors:

```ts
it("keeps the second Job queued until the first Worker completes", async () => {
  const { jobService, runner } = createRunner(successfulExecutor(20), { maxConcurrentJobs: 1 });
  const first = await createQueuedJob(jobService);
  const second = await createQueuedJob(jobService);

  runner.submit(first.id);
  runner.submit(second.id);
  await waitFor(async () => (await jobService.get(first.id))?.status === "running");
  await expect(jobService.get(second.id)).resolves.toMatchObject({ status: "queued" });
  await waitFor(async () => (await jobService.get(first.id))?.status === "succeeded");
  await waitFor(async () => (await jobService.get(second.id))?.status === "succeeded");
});

it("resubmits queued Jobs during startup recovery", async () => {
  const { jobService, runner } = createRunner(successfulExecutor(), { maxConcurrentJobs: 1 });
  const queued = await createQueuedJob(jobService);

  await runner.recoverJobs();

  await waitFor(async () => (await jobService.get(queued.id))?.status === "succeeded");
});

it("does not enqueue the same Job twice", async () => {
  const { jobService, runner, executorCalls } = createRunner(successfulExecutor(10), { maxConcurrentJobs: 1 });
  const job = await createQueuedJob(jobService);

  runner.submit(job.id);
  runner.submit(job.id);
  await waitFor(async () => (await jobService.get(job.id))?.status === "succeeded");

  expect(executorCalls()).toBe(1);
});
```

The test helper must expose executor invocation count without inspecting private Runner state.

- [ ] **Step 2: Run the focused tests and verify the expected red failure**

Run:

```powershell
npx vitest run apps/api/tests/visio-job-runner.test.ts
```

Expected: the new tests fail because `maxConcurrentJobs`, queued scheduling, and `recoverJobs` do not exist.

- [ ] **Step 3: Implement the minimal FIFO scheduler**

Add a private FIFO `Set<string>` for queued Job ids, an `active` map for running Worker controllers, and a guarded async drain loop. `submit` must ignore duplicate queued/active ids and terminal Jobs. The drain loop may start work only while `active.size < maxConcurrentJobs`; every completion removes its active entry and triggers another drain. `cancel` must remove a Job from the pending queue before calling `JobService.cancel`, while a running Job must preserve the existing AbortController behavior.

Implement `recoverJobs` as:

```ts
for (const job of await store.listJobs()) {
  if (job.type !== "visio-export") continue;
  if (job.status === "running") await jobService.expire(job.id);
  if (job.status === "queued") this.submit(job.id);
}
```

Keep `recoverStaleJobs` as a stale-only wrapper for existing callers, and ensure `close` waits for active work without silently starting pending Jobs.

- [ ] **Step 4: Run the focused tests and verify green**

Run the same Vitest command. Expected: all runner tests pass, including cancellation, stale expiration, FIFO capacity, duplicate submission, and queued startup recovery.

- [ ] **Step 5: Commit the scheduler**

```powershell
git add apps/api/src/visio-job-runner.ts apps/api/tests/visio-job-runner.test.ts
git commit -m "feat: bound Visio Worker concurrency"
```

### Task 2: Wire validated concurrency and startup recovery into Fastify

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/tests/config.test.ts`
- Modify: `apps/api/tests/visio-routes.test.ts`

**Interfaces:**
- Environment variable: `VISIO_MAX_CONCURRENCY`, integer range `1..8`, default `1`.
- `AppConfig.visioMaxConcurrency: number`.
- The default app constructs `VisioJobRunner` with `maxConcurrentJobs: config.visioMaxConcurrency`.
- Fastify `onReady` calls `recoverJobs`, so queued Jobs are resubmitted and stale running Jobs are expired before requests are accepted.

- [ ] **Step 1: Write failing configuration and lifecycle tests**

Add tests that assert the default is `1`, valid `VISIO_MAX_CONCURRENCY=2` is accepted, values `0` and `9` are rejected, and an injected runner receives `recoverJobs` during app readiness. Add a route-level test that creates a queued Visio Job in the store before `app.ready()` and verifies it reaches `succeeded` after readiness.

- [ ] **Step 2: Run the focused tests and verify red**

```powershell
npx vitest run apps/api/tests/config.test.ts apps/api/tests/visio-routes.test.ts
```

Expected: configuration and startup recovery assertions fail before implementation.

- [ ] **Step 3: Implement configuration and lifecycle wiring**

Extend the Zod environment schema with `VISIO_MAX_CONCURRENCY`, map it to `AppConfig`, pass it into the default `VisioJobRunner`, and change the Fastify ready hook to call `recoverJobs`.

- [ ] **Step 4: Run focused and full verification**

```powershell
npx vitest run apps/api/tests/config.test.ts apps/api/tests/visio-job-runner.test.ts apps/api/tests/visio-routes.test.ts
npm run api:test
npx tsc --noEmit
git diff --check
```

- [ ] **Step 5: Commit the configuration integration**

```powershell
git add apps/api/src/config.ts apps/api/src/app.ts apps/api/tests/config.test.ts apps/api/tests/visio-routes.test.ts
git commit -m "feat: recover queued Visio Jobs on startup"
```

## Follow-up boundary

After this plan is verified, the next independent plan should cover Worker retry classification and `GET /api/visio/health`. Do not combine those behaviors with this scheduler change.
