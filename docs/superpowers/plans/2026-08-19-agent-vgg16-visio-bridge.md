# Agent VGG16 to Persistent Visio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a confirmed canonical VGG16 through the real Agent server path into one visible, editable Visio VSDX/Page, without accepting browser-provided diagrams or reopening a canvas for revisions.

**Architecture:** A server-loaded Figure Draft revision is compiled once into a strict Worker `DiagramEnvelope`; that exact envelope and digest are frozen in an owner-scoped execution snapshot. A server-created Job reads only the frozen snapshot, derives the visible-session identity, and uses the existing v2 Worker client. The Worker remains the only COM owner.

**Tech Stack:** TypeScript, Fastify, Vitest, existing FigureDraftService, existing v2 VisioWorkerClient, .NET Visio Worker v2.

## Global Constraints

- The HTTP request may select only a server-owned draft revision and an idempotency key; it never supplies a diagram, path, session key, operation, plan hash, or COM field.
- VGG16 requires a render-ready canonical IR with RGB input, Conv repetitions `2/2/3/3/3`, five pools, Flatten, FC6, FC7, and FC8/classifier.
- Snapshot creation compiles once and stores the complete allowlisted Worker diagram plus its SHA-256 digest; execution never recompiles a mutable Draft.
- Initial execution is `apply`; later revisions are `applyDiff`; only authenticated explicit close may send `close(save)`.
- Only `mode=live` and `visible=true` may create a persistent v2 child. The normal v1 export path remains unchanged.
- Automated tests use a JSON-lines fake Worker only and never start Visio. A real host is started only by a separate opt-in acceptance command.

---

### Task 1: Immutable VGG16 execution snapshot

**Files:**
- Create: `apps/api/src/agent-visio-execution-snapshot.ts`
- Create: `apps/api/tests/agent-visio-execution-snapshot.test.ts`
- Reuse: `apps/api/src/agent-visio-bridge.ts`, `apps/api/src/figure-draft-service.ts`

**Interfaces:**
- `AgentVisioExecutionSnapshotService.create({ owner, draftId, revision })` loads the owner-scoped revision, requires `ready_for_preview`, calls the bridge exactly once, and returns a deep-frozen `{ snapshotId, draftId, revision, diagram, planDigest, immutable: true }`.
- The in-memory store keys snapshots by `(tenantId, userId, draftId, revision, snapshotId)` and rejects a second mutable insert.

- [ ] **Step 1: Write the failing snapshot tests.**

```ts
await expect(service.create({ owner, draftId: "draft-vgg16", revision: 1 }))
  .resolves.toMatchObject({ immutable: true, planDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
await expect(service.create({ owner: otherOwner, draftId: "draft-vgg16", revision: 1 }))
  .rejects.toMatchObject({ code: "NOT_FOUND" });
```

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/api/tests/agent-visio-execution-snapshot.test.ts`

Expected: module-not-found or a missing service export; no Worker process starts.

- [ ] **Step 3: Implement the smallest snapshot service.**

```ts
const bridge = compileAgentCnnVisioDiagram({ draftId, revision, canonicalNetworkIR });
const snapshot = deepFreeze({ snapshotId: `visio-${bridge.planDigest.slice(0, 32)}`, draftId, revision, diagram: bridge.diagram, planDigest: bridge.planDigest, immutable: true });
```

Use the established owner-safe `FigureDraftService.get` boundary. Reject non-ready revisions and duplicate snapshot identities before any Job creation.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/api/tests/agent-visio-execution-snapshot.test.ts apps/api/tests/agent-visio-bridge.test.ts`

Expected: all tests pass.

### Task 2: Server-bound export Job and authenticated routes

**Files:**
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/visio-job-runner.ts`
- Modify: `apps/api/src/adapters.ts`
- Create: `apps/api/tests/agent-visio-export-routes.test.ts`
- Modify: `apps/api/tests/visio-job-runner.test.ts`

**Interfaces:**
- `POST /api/figure-drafts/:draftId/revisions/:revision/visio-exports` creates/loads the immutable snapshot and a server-owned `visio-export` Job.
- The request body accepts only `{ idempotencyKey }`; the Job input contains the snapshot ID/digest and server-generated workflow ID.
- The runner resolves the snapshot server-side, then calls `executeDiagram({ jobId, diagram, userId, deviceId, workflowId, operation: "apply" })`.

- [ ] **Step 1: Write the failing route and runner tests.**

```ts
await app.inject({ method: "POST", url, payload: { idempotencyKey: "vgg16-1", diagram: fixtureDiagram } })
  .then((response) => expect(response.statusCode).toBe(400));
expect(executor.calls[0]).toMatchObject({ operation: "apply", workflowId: expect.any(String) });
expect(executor.calls[0]).not.toHaveProperty("planHash");
```

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/api/tests/agent-visio-export-routes.test.ts apps/api/tests/visio-job-runner.test.ts`

Expected: the route is absent or runner input lacks the server-derived identity.

- [ ] **Step 3: Implement only the constrained route and runner binding.**

```ts
const snapshot = await snapshots.create({ owner: universalOwner(access.user.id), draftId, revision });
const job = await jobService.create({ type: "visio-export", input: { executionSnapshotId: snapshot.snapshotId, workflowId: createdJobId } });
runner.submit(job.id);
```

The runner must load the snapshot by owner/revision, and must reject a missing/tampered digest before calling the executor.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/api/tests/agent-visio-export-routes.test.ts apps/api/tests/visio-job-runner.test.ts`

Expected: all tests pass and a foreign device never reaches the executor.

### Task 3: Persistent visible-session closure

**Files:**
- Modify: `apps/api/src/visio-worker-client.ts`
- Modify: `apps/api/tests/visio-worker-client.test.ts`
- Reuse: `apps/api/src/visio-session-protocol.ts`
- Reuse: `apps/api/tests/fixtures/visio-worker-v2-session-fake.mjs`

**Interfaces:**
- The first server-owned execution sends `open`, `apply`, `save`; a later stored revision sends `applyDiff`, `save` to the same `(tenantId,userId,deviceId,workflowId)` child.
- The public close action sends `close(save)`, then ends stdin and accepts only clean EOF plus exit code `0`.

- [ ] **Step 1: Write failing lifecycle tests.**

```ts
await expect(client.executeDiagram({ ...identity, operation: "applyDiff", diagram })).rejects.toThrow(/baseline/i);
await expect(client.executeDiagram({ ...identity, operation: "apply", diagram })).resolves.toMatchObject({ readback: { valid: true } });
await expect(client.executeDiagram({ ...identity, operation: "apply", diagram })).rejects.toThrow(/applyDiff/i);
```

Add independent cases for pre-aborted execution, malformed pre-EOF response, nonzero post-close exit, and close response followed by a hang.

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/api/tests/visio-worker-client.test.ts`

Expected: each added assertion fails against the incomplete v2 state machine.

- [ ] **Step 3: Implement the minimal v2 state machine.**

```ts
if (signal?.aborted) { invalidate(sessionKey); throw abortError(); }
if (!session.hasBaseline && operation !== "apply") throw new Error("first visible operation must be apply");
if (session.hasBaseline && operation !== "applyDiff") throw new Error("visible revision must be applyDiff");
```

Invalidate the session on every transport or close-contract fault. Never terminate unowned Visio processes.

- [ ] **Step 4: Run GREEN.**

Run: `npx vitest run apps/api/tests/visio-worker-client.test.ts && npx tsc --noEmit`

Expected: all tests pass and TypeScript exits `0`.

### Task 4: Opt-in real Agent VGG16 acceptance

**Files:**
- Create: `scripts/agent-vgg16-visio-acceptance.ts`
- Create: `docs/evidence/2026-08-19-agent-vgg16-visio.md`

**Interfaces:**
- The script requires `SYNAPSE_REAL_VISIO_ACCEPTANCE=1`, invokes the authenticated Agent export route, records sanitized job/snapshot/readback counts, keeps the visible document open, and only closes after an explicit confirmation argument.

- [ ] **Step 1: Write the failing non-live harness test.**

```ts
await expect(runAcceptance({ environment: {} })).rejects.toThrow(/SYNAPSE_REAL_VISIO_ACCEPTANCE=1/);
```

- [ ] **Step 2: Run RED.**

Run: `npx vitest run apps/api/tests/agent-vgg16-visio-acceptance.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the guard and acceptance flow.**

```ts
if (environment.SYNAPSE_REAL_VISIO_ACCEPTANCE !== "1") throw new Error("SYNAPSE_REAL_VISIO_ACCEPTANCE=1 is required");
```

Create one isolated account/device/workflow, perform initial `apply`, inspect native readback, retain the window, and write only safe evidence fields.

- [ ] **Step 4: Verify the complete non-live suite.**

Run: `npm run api:test && npx tsc --noEmit && dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj --no-restore`

Expected: all test suites pass. Run the real-host command only after Task 3 has a clean independent review.
