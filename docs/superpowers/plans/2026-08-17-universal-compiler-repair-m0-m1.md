# Universal Compiler Repair M0-M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the strict engineering quality gates and expose a bounded, authenticated static-linear PyTorch source-to-Architecture-IR-v3 analysis path without changing the existing v2 Agent/Canvas behavior.

**Architecture:** M0 repairs the existing Visio readback type contract and route narrowing in isolation. M1 adds a versioned `SourcePack` and user-owned `FigureAnalysisRecord`, then routes static PyTorch source through the existing `EvidenceGraph` and v3 IR validator without invoking a Provider or any user code. The v3 analysis route is separate from legacy `/api/agent/chat`; v2 remains the compatibility path until an explicit later M2/M3 preview and export cutover is accepted.

**Tech Stack:** TypeScript 5.9 strict mode, Fastify 5, Zod, PostgreSQL JSONB migrations, Vitest 3, existing FoundationStore/SessionService ownership and idempotency conventions.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on branch `agent`; do not modify the `main` worktree.
- Preserve the unrelated untracked `docs/superpowers/plans/2026-08-14-graph-message-passing-grammar.md` and all pre-existing dirty files.
- Do not use `git add .`, `git add -A`, reset, clean, force-push, or broad formatting.
- Every behavior change follows red -> green -> refactor; each task ends with focused tests and a narrow commit.
- The static analyzer must not execute, import, evaluate, load weights from, or network-access user Python code.
- P0.0 supports only declared `nn.*` modules on one static linear `forward` path. Branches, Add/Concat, skip, module reuse, dynamic shape, repeat, Keras/ONNX, images and arbitrary runtime reflection remain blocking unresolved or out of scope.
- Provider credentials, raw source code, raw attachments, output paths, Worker protocol fields and internal file-system details must not enter public DTOs or audit records.
- A blocking unresolved source cannot create a PlanSnapshot, preview artifact, export token or Worker Job.
- In M1, `ready_for_preview` means only that a validated Architecture IR v3 is eligible to enter the future M2 preview compiler; it does not mean a preview artifact, PlanSnapshot, export token or Worker Job already exists.
- M0/M1 do not implement Figure Components, UniversalPreview route, real Visio acceptance, Keras/ONNX, image understanding or GNN.
- Required verification at the end of each task is `npx vitest run <focused files>`, `npm run api:test`, `npx tsc --noEmit`, `npm run api:check`, and `git diff --check` over exact changed paths.

---

## File and Interface Map

### M0 files

- Create: `apps/api/tests/fixtures/visio-readback.ts` — canonical complete `VisioReadback` factory used by all Worker mocks.
- Modify: `apps/api/src/routes.ts` — explicit type guards for unknown universal output fields.
- Modify: `apps/api/tests/visio-job-runner.test.ts` — replace short legacy readback mocks with the canonical fixture.
- Modify: `apps/api/tests/visio-routes.test.ts` — replace short legacy readback mocks and cover malformed public universal output.
- Modify: `apps/api/tests/visio-worker-client.test.ts` — align Worker response fixtures with the expanded readback contract.
- Modify: `apps/api/tests/visio-protocol.test.ts` — assert every required readback field is required and preserved.

### M1 files

- Create: `apps/api/src/source-pack.ts` — bounded, transient source input validation and SHA-256 verification.
- Create: `apps/api/src/figure-analysis.ts` — user-owned analysis record, public projection and status contract.
- Create: `apps/api/src/figure-analysis-service.ts` — static PyTorch analyzer/compiler orchestration; no Provider or route code.
- Modify: `apps/api/src/evidence-graph.ts` only if the current public summary type needs a small export refinement; do not reintroduce `EvidenceBundle` into the v3 static-analysis path.
- Modify: `apps/api/src/domain.ts` — add the persisted `FigureAnalysisRecord` type and `FigureAnalysisStatus`.
- Modify: `apps/api/src/store.ts` — add idempotent create/get methods with owner scope.
- Modify: `apps/api/src/postgres-store.ts` — implement the new FoundationStore methods.
- Create: `apps/api/sql/009_figure_analyses.sql` — durable owner-scoped analysis table and idempotency uniqueness.
- Modify: `apps/api/src/routes.ts` — parse the versioned analysis request, require user/device authorization, call the service and project safe responses.
- Modify: `apps/api/src/app.ts` — construct or inject `FigureAnalysisService` and register its dependencies without changing legacy route defaults.
- Modify: `apps/api/src/adapters.ts` only if the existing attachment type cannot be reused without widening Provider capabilities; do not add a Provider method for static analysis.
- Create: `apps/api/tests/source-pack.test.ts` — source bounds, MIME, hash and forbidden payload behavior.
- Create: `apps/api/tests/figure-analysis-service.test.ts` — linear success, dynamic rejection, unsupported call rejection and no-Provider behavior.
- Create: `apps/api/tests/figure-analysis-routes.test.ts` — authentication, ownership, idempotency, safe DTO and audit behavior.
- Modify: `apps/api/tests/postgres-store.test.ts` — durable record and idempotency contract if the existing test store harness can exercise the migration.
- Modify: `apps/api/tests/production-boundary.test.ts` — assert source analysis has no shell, Python runtime or Provider-to-IR bypass.
- Modify: `docs/START_HERE.md` and `README.md` — advertise P0.0 only as static-linear PyTorch analysis after the route is accepted.
- Modify: `docs/superpowers/plans/2026-08-17-agent-onboarding-and-static-pytorch-analyzer.md` — check only verified P0.0 steps and record excluded capabilities.

---

### Task 1: Establish the M0 red baseline and canonical Visio readback fixture

**Files:**
- Create: `apps/api/tests/fixtures/visio-readback.ts`
- Modify: `apps/api/tests/visio-protocol.test.ts`
- Test: `apps/api/tests/visio-protocol.test.ts`

**Interfaces:**
- Consumes: `VisioReadback` from `apps/api/src/visio-protocol.ts`.
- Produces: `completeVisioReadback(overrides?: Partial<VisioReadback>): VisioReadback` with all required primitive, connector and shape-data arrays.

- [ ] **Step 1: Write the failing fixture-contract test**

Add a test that constructs a successful Worker response using the new factory and verifies the strict protocol parser preserves all fields:

```ts
import { completeVisioReadback } from "./fixtures/visio-readback.js";

it("requires and preserves complete native readback evidence", () => {
  const readback = completeVisioReadback({
    expectedPrimitiveIds: ["input"],
    actualPrimitiveIds: ["input"],
    expectedConnectorIds: ["edge-1"],
    actualConnectorIds: ["edge-1"],
  });
  const parsed = parseVisioWorkerResponse({
    protocolVersion: 1,
    requestId: "request-1",
    jobId: "job-1",
    status: "succeeded",
    path: "C:\\exports\\job-1.vsdx",
    readback,
  });
  expect(parsed.readback).toEqual(readback);
});
```

- [ ] **Step 2: Run the test and verify the expected red failure**

Run:

```powershell
npx vitest run apps/api/tests/visio-protocol.test.ts
```

Expected: FAIL because `completeVisioReadback` does not exist.

- [ ] **Step 3: Implement the minimal canonical fixture**

Create the factory with explicit valid defaults:

```ts
import type { VisioReadback } from "../../src/visio-protocol.js";

export function completeVisioReadback(overrides: Partial<VisioReadback> = {}): VisioReadback {
  return {
    valid: true,
    shapeCount: 0,
    connectorCount: 0,
    expectedPrimitiveIds: [],
    actualPrimitiveIds: [],
    missingPrimitiveIds: [],
    expectedConnectorIds: [],
    actualConnectorIds: [],
    missingConnectorIds: [],
    shapeDataFailures: [],
    ...overrides,
  };
}
```

- [ ] **Step 4: Run the focused test and protocol regression**

Run:

```powershell
npx vitest run apps/api/tests/visio-protocol.test.ts apps/api/tests/visio-universal-protocol.test.ts
```

Expected: all protocol tests pass and a response missing any required readback array is rejected.

- [ ] **Step 5: Commit the isolated M0 fixture**

```powershell
git add -- apps/api/tests/fixtures/visio-readback.ts apps/api/tests/visio-protocol.test.ts
git diff --cached --check
git commit -m "test: centralize complete Visio readback fixtures"
```

### Task 2: Repair universal public output narrowing

**Files:**
- Modify: `apps/api/src/routes.ts:204-222`
- Modify: `apps/api/tests/universal-figure-export-routes.test.ts`
- Test: `apps/api/tests/universal-figure-export-routes.test.ts`

**Interfaces:**
- Consumes: `unknown` Worker output from a completed universal export Job.
- Produces: the existing path-free public DTO, with all numeric fields proven to be safe non-negative integers before access.

- [ ] **Step 1: Write the failing type/regression test**

Add a completed-job projection test by reusing the existing route harness, then mutating the queued job through `store.getJob(...)` and `store.updateJob(...)`. The Worker output must include malformed unknown numeric values, and the route must return the existing failed public projection rather than reading or exposing them:

```ts
it("rejects malformed unknown universal output fields before public projection", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/figure-drafts/draft-1/revisions/1/exports",
    headers: {
      ...access.headers,
      "accept-figure-version": "3",
      "idempotency-key": "universal-export-projection-malformed",
    },
    payload: {
      confirmationToken: token,
      idempotencyKey: "universal-export-projection-malformed",
    },
  });
  const queued = await store.getJob(created.json().id);
  if (!queued) throw new Error("expected queued universal export Job");
  await store.updateJob({
    ...queued,
    status: "succeeded",
    completedAt: "2026-08-14T00:03:00.000Z",
    output: {
      artifacts: [{ format: "vsdx", sha256: "a".repeat(64), bytes: "512" }],
      readback: { valid: true, shapeCount: 1, connectorCount: 0 },
      rendererQa: { pageFit: { passed: true } },
    },
  });
  const result = await app.inject({ method: "GET", url: created.json().pollUrl, headers: access.headers });
  const body = result.json();
  expect(body.status).toBe("failed");
  expect(body.artifacts).toBeUndefined();
  expect(body.readback).toBeUndefined();
});
```

Use the existing route harness and Worker fake already present in `apps/api/tests/universal-figure-export-routes.test.ts`; do not weaken the assertion by casting the malformed value to a typed DTO.

- [ ] **Step 2: Run the focused test and the strict compiler to record red**

```powershell
npx vitest run apps/api/tests/universal-figure-export-routes.test.ts
npx tsc --noEmit
```

Expected: the route regression fails if the fake is accepted, and the compiler reports the current `unknown` errors in `routes.ts`.

- [ ] **Step 3: Implement one explicit narrowing helper**

Add a local type guard in `routes.ts`:

```ts
function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
```

Use it for artifact bytes, shape count and connector count. Keep the public DTO path-free and keep the existing `null`/failed projection behavior. Do not use `as number` as the type fix.

- [ ] **Step 4: Run the focused test and strict compiler**

```powershell
npx vitest run apps/api/tests/universal-figure-export-routes.test.ts
npx tsc --noEmit
```

Expected: the focused route test and strict TypeScript pass; old Worker mocks may still fail compilation until Task 3 updates them.

### Task 3: Align every legacy Worker mock with the expanded readback DTO

**Files:**
- Modify: `apps/api/tests/visio-job-runner.test.ts`
- Modify: `apps/api/tests/visio-routes.test.ts`
- Modify: `apps/api/tests/visio-worker-client.test.ts`
- Modify: `apps/api/tests/visio-protocol.test.ts` if a duplicate fixture remains
- Test: the three modified test files

**Interfaces:**
- Consumes: `completeVisioReadback()` from Task 1.
- Produces: no short `{ valid, shapeCount, connectorCount }` object anywhere a `VisioReadback` is required.

- [ ] **Step 1: Write the failing contract scan**

Add a small source-shape test or run the existing strict compiler against the current fixtures. The expected failure is the current `TS2322` set where Worker mocks return only three readback fields.

```powershell
npx tsc --noEmit
```

Expected: errors reference `visio-job-runner.test.ts`, `visio-routes.test.ts`, and `visio-worker-client.test.ts`.

- [ ] **Step 2: Replace short mocks with the canonical factory**

For every mock response, replace:

```ts
readback: { valid: true, shapeCount: 1, connectorCount: 0 }
```

with:

```ts
readback: completeVisioReadback({ shapeCount: 1, connectorCount: 0 })
```

Import the fixture from `./fixtures/visio-readback.js`. Where a test intentionally exercises a missing field, construct an `unknown` malformed response and pass it through `parseVisioWorkerResponse` instead of assigning it to `VisioReadback`.

- [ ] **Step 3: Cover the actual extended evidence**

Add one Worker client assertion with a non-empty `expectedPrimitiveIds`, `actualPrimitiveIds`, `expectedConnectorIds`, `actualConnectorIds` and `shapeDataFailures: []`; assert the parsed result retains those arrays. This prevents the fixture from becoming a compile-only shell.

- [ ] **Step 4: Run M0 tests and strict TypeScript**

```powershell
npx vitest run apps/api/tests/visio-job-runner.test.ts apps/api/tests/visio-routes.test.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/visio-protocol.test.ts
npx tsc --noEmit
```

Expected: all focused Visio tests pass and `tsc` exits 0.

- [ ] **Step 5: Commit M0**

```powershell
git add -- apps/api/src/routes.ts apps/api/tests/fixtures/visio-readback.ts apps/api/tests/visio-protocol.test.ts apps/api/tests/universal-figure-export-routes.test.ts apps/api/tests/visio-job-runner.test.ts apps/api/tests/visio-routes.test.ts apps/api/tests/visio-worker-client.test.ts
git diff --cached --check
git commit -m "fix: restore strict Visio readback contract"
```

### Task 4: Add the bounded SourcePack and persisted analysis contract

**Files:**
- Create: `apps/api/src/source-pack.ts`
- Create: `apps/api/src/figure-analysis.ts`
- Modify: `apps/api/src/domain.ts`
- Modify: `apps/api/src/store.ts`
- Modify: `apps/api/src/postgres-store.ts`
- Create: `apps/api/sql/009_figure_analyses.sql`
- Create: `apps/api/tests/source-pack.test.ts`
- Modify: `apps/api/tests/postgres-store.test.ts`
- Test: `apps/api/tests/source-pack.test.ts`

**Interfaces:**
- Consumes: authenticated request source `{ sourceId, name, mimeType, data, sourceSha256 }` where `data` is base64 text.
- Produces: `parsePyTorchSourcePack(input): SourcePack`, `FigureAnalysisRecord`, `FoundationStore.createFigureAnalysisIdempotent(...)`, and `FoundationStore.getFigureAnalysis(userId, id)`.

Define these exact contracts:

```ts
import type { PublicEvidenceGraphSummary } from "./evidence-graph.js";
import type { ArchitectureIRv3 } from "./network-ir-v3.js";
import type { StaticPyTorchUnresolved } from "./static-pytorch-source-analyzer.js";

export interface SourcePack {
  sourceId: string;
  name: string;
  kind: "pytorch-source";
  mimeType: "text/plain" | "text/markdown" | "text/x-python";
  sourceSha256: string;
  code: string;
  bytes: number;
}

export type FigureAnalysisStatus = "needs_confirmation" | "ready_for_preview" | "failed";

export interface FigureAnalysisRecord {
  id: string;
  userId: string;
  sourceId: string;
  sourceName: string;
  sourceMimeType: SourcePack["mimeType"];
  sourceBytes: number;
  sourceSha256: string;
  kind: "pytorch-source";
  status: FigureAnalysisStatus;
  architectureIR: ArchitectureIRv3 | null;
  unresolved: StaticPyTorchUnresolved[];
  evidenceSummary: PublicEvidenceGraphSummary;
  warnings: string[];
  capabilityVersion: "pytorch-static-linear-v0";
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 1: Write failing SourcePack tests**

Cover valid Python, wrong SHA-256, unsupported MIME, invalid base64, empty source, source over 200,000 UTF-8 bytes, and forbidden payload markers only as source content (the analyzer must report them as unresolved; SourcePack validation must not execute them). The valid test must assert decoded code is returned transiently and no output path/command field exists.

- [ ] **Step 2: Run SourcePack tests and verify red**

```powershell
npx vitest run apps/api/tests/source-pack.test.ts
```

Expected: FAIL because `source-pack.ts` and `parsePyTorchSourcePack` do not exist.

- [ ] **Step 3: Implement SourcePack validation**

Use `createHash("sha256")` over the decoded UTF-8 bytes. Require a 64-character lowercase/uppercase hexadecimal supplied hash and compare it before analysis. Reuse the existing identifier, base64 and size conventions in `routes.ts`, but keep source parsing in this focused module. Do not log `code` or include it in `FigureAnalysisRecord`; persist only `sourceId`, `sourceName`, `sourceMimeType`, `sourceBytes`, and `sourceSha256` for later GET projection.

- [ ] **Step 4: Add the durable record schema and Store methods**

Add migration `009_figure_analyses.sql` with owner-scoped columns for the record fields, JSONB for IR/unresolved/evidence summary/warnings, a unique `(user_id, idempotency_key)` index, and an index on `(user_id, created_at)`. Store only the hash and safe analysis result, never raw code. Add:

```ts
createFigureAnalysisIdempotent(input: {
  record: FigureAnalysisRecord;
  idempotencyKey: string;
  requestHash: string;
}): Promise<{ record: FigureAnalysisRecord; duplicate: boolean; requestHashMatches: boolean }>;
getFigureAnalysis(userId: string, id: string): Promise<FigureAnalysisRecord | null>;
```

Implement the same owner/idempotency behavior in `InMemoryFoundationStore` and `PostgresFoundationStore`. A duplicate key with a different request hash must return `requestHashMatches: false`; the route will reject it with the existing validation error pattern.

- [ ] **Step 5: Run contract tests**

```powershell
npx vitest run apps/api/tests/source-pack.test.ts apps/api/tests/postgres-store.test.ts
npx tsc --noEmit
```

Expected: SourcePack and store tests pass, and all new record fields type-check.

- [ ] **Step 6: Commit the SourcePack/record contract**

```powershell
git add -- apps/api/src/source-pack.ts apps/api/src/figure-analysis.ts apps/api/src/domain.ts apps/api/src/store.ts apps/api/src/postgres-store.ts apps/api/sql/009_figure_analyses.sql apps/api/tests/source-pack.test.ts apps/api/tests/postgres-store.test.ts
git diff --cached --check
git commit -m "feat: add owned figure analysis storage contract"
```

### Task 5: Implement the Provider-free FigureAnalysisService

**Files:**
- Create: `apps/api/src/figure-analysis-service.ts`
- Create: `apps/api/tests/figure-analysis-service.test.ts`
- Test: `apps/api/tests/figure-analysis-service.test.ts`

**Interfaces:**
- Consumes: `SourcePack`, `analyzeStaticPyTorchSource`, `compileStaticPyTorchToArchitectureIR`, and the FoundationStore methods from Task 4.
- Produces: `FigureAnalysisService.analyze(input)` with `{ record: FigureAnalysisRecord; duplicate: boolean }`.

Define:

```ts
export interface FigureAnalysisServiceInput {
  userId: string;
  source: SourcePack;
  idempotencyKey: string;
  requestHash: string;
}

export class FigureAnalysisService {
  async analyze(input: FigureAnalysisServiceInput): Promise<{
    record: FigureAnalysisRecord;
    duplicate: boolean;
  }>;
}
```

- [ ] **Step 1: Write failing service tests**

Add four tests:

1. A linear `Conv2d -> MaxPool2d` SourcePack creates `ready_for_preview`, stores v3 IR with graph ID `pytorch:<sourceId>`, preserves evidence IDs, and still creates no preview artifact or PlanSnapshot.
2. A source containing `if` creates `needs_confirmation`, stores one blocking unresolved record, and stores `architectureIR: null`.
3. A repeated module call or unsupported dynamic call creates `needs_confirmation` and never calls the compiler.
4. The service accepts no Provider dependency; a spy Provider must not be constructed or invoked.

- [ ] **Step 2: Run the service tests and verify red**

```powershell
npx vitest run apps/api/tests/figure-analysis-service.test.ts
```

Expected: FAIL because the service module and class do not exist.

- [ ] **Step 3: Implement the minimal orchestration**

Use `analyzeStaticPyTorchSource({ sourceId, sourceSha256, code })`. If `unresolved` contains a blocking item, persist a record with status `needs_confirmation`, `publicEvidenceGraphSummary(analysis.evidence)`, unresolved entries and no IR. Otherwise call `compileStaticPyTorchToArchitectureIR(analysis, { renderReady: true })`, persist `ready_for_preview` with the IR, and never call a Provider. Preserve the analyzer capability version in the record. `ready_for_preview` here means the IR is eligible for the future M2 preview compiler only.

- [ ] **Step 4: Run service and regression tests**

```powershell
npx vitest run apps/api/tests/figure-analysis-service.test.ts apps/api/tests/static-pytorch-source-analyzer.test.ts apps/api/tests/static-pytorch-ir-compiler.test.ts
npx tsc --noEmit
```

Expected: all tests pass and the service compiles under strict TypeScript.

- [ ] **Step 5: Commit the service**

```powershell
git add -- apps/api/src/figure-analysis-service.ts apps/api/tests/figure-analysis-service.test.ts
git diff --cached --check
git commit -m "feat: compile static PyTorch analysis into v3 IR"
```

### Task 6: Add authenticated versioned analysis routes and safe audit projection

**Files:**
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/tests/figure-analysis-routes.test.ts`
- Test: `apps/api/tests/figure-analysis-routes.test.ts`

**Interfaces:**
- Consumes: `POST /api/figure-analyses` with an authenticated bearer token, `Idempotency-Key`, and bounded source object.
- Produces: `201` for a new analysis, `200` for an exact idempotent replay, `409` for a reused key with a different request hash, and `GET /api/figure-analyses/:id` owner-safe projection.

Every create/read request for this v3 analysis route must require `Accept-Figure-Version: 3`, and every successful response must set `Figure-Version: 3`, so v2 and v3 DTOs cannot be mixed accidentally.

Use this request shape:

```json
{
  "source": {
    "sourceId": "source-tiny",
    "name": "tiny.py",
    "mimeType": "text/x-python",
    "data": "<base64 UTF-8 Python source>",
    "sourceSha256": "<64 hex characters>"
  }
}
```

Use this public response shape:

```ts
import type { PublicEvidenceGraphSummary } from "./evidence-graph.js";
import type { ArchitectureIRv3 } from "./network-ir-v3.js";
import type { EvidenceLocator } from "./evidence-graph.js";

{
  id: string;
  kind: "pytorch-source";
  status: "needs_confirmation" | "ready_for_preview" | "failed";
  source: { sourceId: string; name: string; mimeType: string; sourceSha256: string; bytes: number };
  architectureIR: ArchitectureIRv3 | null;
  evidence: PublicEvidenceGraphSummary;
  unresolved: Array<{ code: string; severity: "blocking" | "warning"; locator: EvidenceLocator; message: string }>;
  warnings: string[];
  capabilityVersion: "pytorch-static-linear-v0";
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 1: Write failing route tests**

Using the existing `buildApp` and register/login helpers, add tests for:

1. missing `Accept-Figure-Version: 3` returns the existing validation error;
2. unauthenticated POST returns 401;
3. valid linear source returns 201, response header `Figure-Version: 3`, v3 IR and only safe source metadata;
4. dynamic source returns 201 with `needs_confirmation`, one unresolved item and `architectureIR: null`;
5. exact idempotent replay returns 200 and does not create a second record;
6. same idempotency key with a changed source returns 409;
7. another user cannot GET the first user’s analysis and receives 404;
8. response and audit record do not contain raw code, Provider, API key, output path, command, SVG/XML or Worker fields;
9. no call is made to `agentService` or a Provider for this route.

- [ ] **Step 2: Run the route tests and verify red**

```powershell
npx vitest run apps/api/tests/figure-analysis-routes.test.ts
```

Expected: FAIL because `/api/figure-analyses` is not registered and `BuildAppOptions` has no analysis service.

- [ ] **Step 3: Add route parsing and service injection**

Add a `FigureAnalysisService` dependency to `RouteOptions` and `BuildAppOptions`. Construct it from the FoundationStore by default in `buildApp`. Parse only the request shape above, require `Accept-Figure-Version: 3`, require the existing authenticated session/device, validate `Idempotency-Key`, calculate a request hash from source metadata and bytes, and call `parsePyTorchSourcePack` before the service.

Register:

```ts
app.post("/api/figure-analyses", async (request, reply) => { /* authenticated create/replay */ });
app.get("/api/figure-analyses/:id", async (request) => { /* owner-safe read */ });
```

The audit events may contain only analysis ID, source hash, bytes, capability version, status, unresolved count and duplicate flag. Do not reuse the legacy `agent.chat.completed` event for this route.

- [ ] **Step 4: Implement the safe public projection**

Project the stored record into the response shape and set `Figure-Version: 3` on successful POST/GET responses. Do not return `code`, base64 data, internal `EvidenceGraph` source excerpts, raw Provider output, filesystem paths, plan primitives, coordinates, Worker DTO fields or job IDs. Keep `needs_confirmation` a successful HTTP response; use 4xx only for invalid input, authorization, version negotiation and idempotency conflicts.

- [ ] **Step 5: Run route, service and full checks**

```powershell
npx vitest run apps/api/tests/figure-analysis-routes.test.ts apps/api/tests/figure-analysis-service.test.ts
npm run api:test
npx tsc --noEmit
npm run api:check
git diff --check
```

Expected: the new route tests and all existing tests pass; strict TypeScript and foundation checks exit 0.

- [ ] **Step 6: Commit authenticated P0.0 route**

```powershell
git add -- apps/api/src/routes.ts apps/api/src/app.ts apps/api/tests/figure-analysis-routes.test.ts
git diff --cached --check
git commit -m "feat: expose authenticated static PyTorch analysis"
```

### Task 7: Update capability documentation and close the M1 evidence record

**Files:**
- Modify: `docs/START_HERE.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-17-agent-onboarding-and-static-pytorch-analyzer.md`
- Create: `docs/evidence/2026-08-17-m0-m1-static-pytorch.md`
- Test: `apps/api/tests/project-onboarding.test.ts`

**Interfaces:**
- Consumes: accepted M0/M1 route, service, type and full-suite output.
- Produces: honest capability wording and an evidence record that keeps M2/M3/M4 gates separate.

- [ ] **Step 1: Write the failing documentation assertion**

Extend onboarding tests to require the exact bounded wording:

```ts
expect(startHere).toContain("authenticated static-linear PyTorch analysis");
expect(startHere).toContain("does not execute user Python");
expect(readme).toContain("P0.0");
expect(readme).toContain("real Windows/Visio acceptance remains separate");
```

- [ ] **Step 2: Run the documentation test and verify red**

```powershell
npx vitest run apps/api/tests/project-onboarding.test.ts
```

Expected: FAIL because the current wording does not yet state the accepted route capability.

- [ ] **Step 3: Update documentation without overclaiming**

State that P0.0 supports authenticated static-linear PyTorch analysis only. State explicitly that v3 publication preview, Figure Components, Universal export, real Visio readback, Keras/ONNX, images and GNN remain unaccepted. Mark the 2026-08-17 implementation-plan checkboxes only for tasks whose command evidence exists.

- [ ] **Step 4: Write the evidence record**

Record:

- exact branch and commit SHAs;
- changed paths;
- focused test counts;
- full test count;
- strict TypeScript result;
- `api:check` and diff-check result;
- route statuses for success, unresolved, unauthorized, ownership and idempotency cases;
- explicit `NOT_ACCEPTED` rows for real Provider, Postgres/Redis, Electron package, real Visio close/reopen/readback and visual human review.

- [ ] **Step 5: Run the final M0/M1 verification**

```powershell
npx vitest run apps/api/tests/project-onboarding.test.ts apps/api/tests/source-pack.test.ts apps/api/tests/figure-analysis-service.test.ts apps/api/tests/figure-analysis-routes.test.ts
npm run api:test
npx tsc --noEmit
npm run api:check
git diff --check
git status --short --branch
```

Expected: all commands exit 0; the status output lists only intentional out-of-scope user drafts that remain unstaged, and no unrelated GNN plan is staged.

- [ ] **Step 6: Commit the M1 documentation/evidence**

```powershell
git add -- docs/START_HERE.md README.md docs/superpowers/plans/2026-08-17-agent-onboarding-and-static-pytorch-analyzer.md docs/evidence/2026-08-17-m0-m1-static-pytorch.md apps/api/tests/project-onboarding.test.ts
git diff --cached --check
git commit -m "docs: record m0 m1 static analysis acceptance"
```

## M0/M1 Completion Gate

M0/M1 is complete only when Tasks 1–7 have their checkbox evidence, the strict compiler is green, all 443+ existing tests plus new route tests pass, the authenticated route produces v3 IR for the supported linear fixture, dynamic/unsupported input remains blocked, and the evidence record explicitly leaves M2/M3/M4 unaccepted.

Do not begin Figure Components, UniversalPreview route, sealed production export, Keras/ONNX, image understanding or GNN implementation until this gate is reviewed.
