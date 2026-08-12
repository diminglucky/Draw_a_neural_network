# Visio Job Runtime Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the authenticated Visio export route into a recoverable asynchronous Job flow with cancellation, abortable Worker execution, stale-Job recovery, and frontend polling.

**Architecture:** Keep `VisioWorkerClient` as the child-process/protocol adapter and add `VisioJobRunner` as the API-side lifecycle owner. The route atomically creates or reuses a user-owned Job, queues new work, and returns `202`; the runner owns one abortable Worker per Job and persists terminal state through `JobService`. The browser submits once, polls the existing Job endpoint, and can cancel only its own queued/running Job.

**Tech Stack:** TypeScript, Fastify, Vitest, Node `AbortController`, existing PostgreSQL/in-memory stores, browser ES modules, C# Worker unchanged at the protocol boundary.

## Global Constraints

- The project remains standalone; do not import NPP, Polars.NET, NppStudio, or their runtime assumptions.
- Visio COM remains inside the per-Job C# Worker and its single STA thread.
- The API never accepts a client-controlled output path and never exposes provider or desktop credentials.
- Existing user ownership and `Idempotency-Key` semantics remain enforced.
- New production behavior must start from a failing test and be verified with focused tests before full suites.
- Interactive Visio mode, VSTO/Add-in, advanced stencils, signed installers, billing, and automatic updates remain out of scope.

---

### Task 1: Define the runner boundary and Job recovery contract

**Files:**
- Create: `apps/api/src/visio-job-runner.ts`
- Create: `apps/api/tests/visio-job-runner.test.ts`
- Modify: `apps/api/src/job-service.ts`
- Modify: `apps/api/src/adapters.ts`

**Interfaces:**
- `VisioExecutor.executeDiagram(input, options?: { signal?: AbortSignal }): Promise<{ path: string; readback: VisioReadback }>` accepts an optional cancellation signal.
- `VisioJobRunner.submit(jobId: string): void` schedules one Job and returns without waiting for COM.
- `VisioJobRunner.cancel(jobId: string): Promise<Job>` cancels queued work or aborts the active Worker owned by that Job.
- `VisioJobRunner.recoverStaleJobs(): Promise<void>` transitions persisted `running` Jobs to `expired` before accepting requests.
- `VisioJobRunner.close(): Promise<void>` aborts active Workers and waits for lifecycle cleanup.

- [ ] **Step 1: Write failing runner tests**

Add tests that use an in-memory store and injected fake executor:

```ts
it("runs a submitted Job asynchronously and persists succeeded output", async () => {
  const runner = createRunner({ executor: delayedExecutor(10) });
  const job = await jobService.create({ userId: "u", deviceId: "d", type: "visio-export", input: { diagram: {} } });
  runner.submit(job.id);
  await waitFor(() => jobService.get(job.id).then((value) => value?.status === "succeeded"));
  await expect(jobService.get(job.id)).resolves.toMatchObject({ status: "succeeded", output: { readback: { valid: true } } });
});

it("marks running Jobs expired during startup recovery", async () => {
  const job = await jobService.create({ userId: "u", deviceId: "d", type: "visio-export", input: { diagram: {} } });
  await jobService.start(job.id);
  await runner.recoverStaleJobs();
  await expect(jobService.get(job.id)).resolves.toMatchObject({ status: "expired" });
});

it("cancels a running Job without converting it into a Worker failure", async () => {
  const runner = createRunner({ executor: abortAwareExecutor() });
  const job = await createQueuedVisioJob();
  runner.submit(job.id);
  await waitFor(() => jobService.get(job.id).then((value) => value?.status === "running"));
  await runner.cancel(job.id);
  await expect(jobService.get(job.id)).resolves.toMatchObject({ status: "cancelled" });
});
```

Implement `waitFor` as a bounded test helper that polls every 5ms and throws after 1 second; it must never use an unbounded sleep.

- [ ] **Step 2: Run the focused tests and verify the expected red failure**

Run:

```powershell
npx vitest run apps/api/tests/visio-job-runner.test.ts
```

Expected: FAIL because `VisioJobRunner` and the abortable executor signature do not exist.

- [ ] **Step 3: Implement the minimal runner**

Use a `Map<string, ActiveVisioJob>` where each active entry contains an `AbortController` and a completion Promise. Guard duplicate submissions by returning the existing Promise. The runner must:

1. load the Job and ignore terminal/missing Jobs;
2. transition queued → running through `JobService.start`;
3. call `executeDiagram({ jobId, diagram }, { signal })`;
4. persist `succeeded` only when the signal is not aborted;
5. persist `cancelled` when cancellation aborts the operation;
6. persist `failed` with `VISIO_EXECUTION_FAILED` for timeout, protocol, or Worker errors;
7. delete the active entry in `finally`.

`recoverStaleJobs` must enumerate `store.listJobs()` and call `jobService.expire` only for `status === "running"`; add `JobService.expire` with the same terminal timestamp/audit behavior as `fail`.

- [ ] **Step 4: Run the focused tests and verify green**

Run the same Vitest command. Expected: all runner tests pass, including cancellation and stale recovery.

- [ ] **Step 5: Commit the runner boundary**

```powershell
git add apps/api/src/visio-job-runner.ts apps/api/tests/visio-job-runner.test.ts apps/api/src/job-service.ts apps/api/src/adapters.ts
git commit -m "feat: add recoverable Visio Job runner"
```

### Task 2: Make the Worker client abortable and verify process cleanup

**Files:**
- Modify: `apps/api/src/visio-worker-client.ts`
- Modify: `apps/api/tests/visio-worker-client.test.ts`
- Create: `apps/api/tests/fixtures/visio-worker-fake-hang.mjs`

**Interfaces:**
- `VisioWorkerClient.executeDiagram(input, options?: { signal?: AbortSignal })` must terminate the child process when the signal aborts and reject with an error carrying `VISIO_EXECUTION_FAILED`.

- [ ] **Step 1: Write failing abort and timeout tests**

Add a fake Worker that stays alive until killed. Assert that aborting the signal rejects promptly, the process closes, and the output file is not accepted as a successful Job. Add a second test that keeps the existing timeout behavior unchanged.

- [ ] **Step 2: Run the focused client tests and verify red**

```powershell
npx vitest run apps/api/tests/visio-worker-client.test.ts
```

Expected: the new abort test fails because the client does not subscribe to `AbortSignal`.

- [ ] **Step 3: Implement signal-aware child cleanup**

Register one abort listener per child, call `child.kill()` only once, reject with a `FoundationError` carrying `VISIO_EXECUTION_FAILED` and `{ reason: "cancelled", jobId }`, and remove the listener in every settle path. Preserve response identity, output-root, realpath, readback, and timeout validation.

- [ ] **Step 4: Run the focused client tests and the API suite**

```powershell
npx vitest run apps/api/tests/visio-worker-client.test.ts
npm run api:test
```

Expected: focused tests and the full API suite pass.

- [ ] **Step 5: Commit the abortable adapter**

```powershell
git add apps/api/src/visio-worker-client.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/fixtures/visio-worker-fake-hang.mjs
git commit -m "feat: make Visio Worker execution cancellable"
```

### Task 3: Connect asynchronous submit, startup recovery, and cancellation to Fastify

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/tests/visio-routes.test.ts`
- Modify: `apps/api/tests/job-service.test.ts`

**Interfaces:**
- `BuildAppOptions.visioJobRunner?: VisioJobRunner` allows deterministic route tests.
- `POST /api/visio/export` returns `202` and `{ ...job, pollUrl: "/api/jobs/:id" }` for a new export.
- `POST /api/jobs/:id/cancel` delegates Visio Jobs to `VisioJobRunner.cancel` and preserves generic Job cancellation behavior for other Job types.

- [ ] **Step 1: Add failing route tests**

Extend the Visio route tests to assert:

```ts
expect(response.statusCode).toBe(202);
expect(response.json()).toMatchObject({ status: "queued", pollUrl: `/api/jobs/${response.json().id}` });
```

Add tests for a later `GET /api/jobs/:id` reaching `succeeded`, user isolation, queued cancellation, and repeated key returning the same Job without a second executor call.

- [ ] **Step 2: Run route tests and verify red**

```powershell
npx vitest run apps/api/tests/visio-routes.test.ts
```

Expected: the tests fail because the route still executes the Worker inline and returns `201`.

- [ ] **Step 3: Wire the runner into the app lifecycle**

Create one runner per Fastify app. Use an injected runner in tests; otherwise create it from the configured `VisioExecutor`. Register `onReady` to recover stale Jobs and `onClose` to abort active Workers. The submit route must create/reuse the Job, schedule only new Jobs, and return without awaiting Worker execution. The status route must never expose another user's Job.

- [ ] **Step 4: Run route and full API tests**

```powershell
npx vitest run apps/api/tests/visio-routes.test.ts apps/api/tests/job-service.test.ts
npm run api:test
npx tsc --noEmit
```

Expected: all pass and the route returns `202` only for a new queued export.

- [ ] **Step 5: Commit the asynchronous API boundary**

```powershell
git add apps/api/src/app.ts apps/api/src/routes.ts apps/api/tests/visio-routes.test.ts apps/api/tests/job-service.test.ts
git commit -m "feat: expose asynchronous Visio export Jobs"
```

### Task 4: Add frontend polling, cancellation, and terminal-state rendering

**Files:**
- Modify: `chat-agent.js`
- Modify: `apps/client/chat-agent.test.js`
- Modify: `styles.css`

**Interfaces:**
- `submitVisioExport(diagram, options)` returns a queued/existing Job.
- `getVisioExportJob(jobId, options)` reads a user-owned Job.
- `cancelVisioExportJob(jobId, options)` requests cancellation.
- `waitForVisioExport(jobId, options)` polls with bounded delays and stops on `succeeded`, `failed`, `cancelled`, or `expired`.

- [ ] **Step 1: Add failing client tests**

Test that the client submits once, polls queued → running → succeeded, stops polling on a terminal failure, and sends cancellation only while the Job is cancellable. Test that API error messages are shown without inserting unescaped HTML.

- [ ] **Step 2: Run client tests and verify red**

```powershell
npx vitest run apps/client/chat-agent.test.js
```

Expected: the new polling functions are missing.

- [ ] **Step 3: Implement bounded polling and UI state**

Use `fetch` with the existing bearer and idempotency headers. Poll at 100ms, 250ms, 500ms, then cap at 1000ms; stop after 120 seconds with a local timeout error. Render status text through `textContent`, disable duplicate submit/cancel actions, and keep the current `应用到画布` behavior unchanged.

- [ ] **Step 4: Run client and full API tests**

```powershell
npx vitest run apps/client/chat-agent.test.js
npm run api:test
```

- [ ] **Step 5: Commit the frontend runtime flow**

```powershell
git add chat-agent.js apps/client/chat-agent.test.js styles.css
git commit -m "feat: add Visio Job polling and cancellation UI"
```

### Task 5: Add recovery documentation and end-to-end acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-12-visio-worker-acceptance.md`
- Modify: `scripts/visio-api-route-live-smoke.ts`
- Create: `scripts/visio-api-route-async-live-smoke.ts`

- [ ] **Step 1: Add a failing async live smoke assertion**

The new script must authenticate, submit the route, require `202`, poll the returned Job until `succeeded`, then submit the same key again and require the same Job id without a second output file.

- [ ] **Step 2: Run the script and verify the expected missing-script failure**

```powershell
npx tsx scripts/visio-api-route-async-live-smoke.ts
```

Expected: the script does not exist yet.

- [ ] **Step 3: Implement async route smoke and document operations**

Use the existing real Worker configuration, a bounded polling loop, and a unique output root. Document startup recovery, cancellation semantics, `202`/`200` responses, and the distinction between source, focused proof, real COM acceptance, and signed production packaging.

- [ ] **Step 4: Run the complete verification set**

```powershell
npx tsc --noEmit
npm run api:test
dotnet test workers/visio-worker/VisioWorker.sln --no-restore
npm run api:smoke:postgres
powershell -ExecutionPolicy Bypass -File scripts/visio-worker-mock-smoke.ps1
powershell -ExecutionPolicy Bypass -File scripts/visio-com-smoke.ps1
npx tsx scripts/visio-api-route-async-live-smoke.ts
git diff --check
```

Expected: all commands exit successfully; live smoke reports valid readback and the async route reports `202` followed by `succeeded`.

- [ ] **Step 5: Commit documentation and acceptance**

```powershell
git add README.md docs/superpowers/plans/2026-08-12-visio-worker-acceptance.md scripts/visio-api-route-live-smoke.ts scripts/visio-api-route-async-live-smoke.ts
git commit -m "test: accept asynchronous Visio Job runtime"
```
