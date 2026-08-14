# Phase A0 Protocol Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Universal Neural Figure Compiler's untrusted-input, immutable-preview, and plan-only-export contracts before any general-purpose analyzer, model-family grammar, or Visio automation is added.

**Architecture:** Add versioned, closed domain schemas beside the existing v1/v2 contracts instead of mutating existing browser and Agent paths. A universal request becomes `EvidenceGraph v2 -> ArchitectureIR v3 -> validated FigureSet -> immutable PlanSnapshot`; export authorizes the exact viewed snapshot and sends a signed, in-band sealed plan to the Worker. The existing browser-diagram Visio endpoint remains a separately named legacy/demo path and cannot create an export for a FigureDraft revision.

**Tech Stack:** TypeScript 5.9, Node.js, Fastify 5, Zod 3, Vitest 3, PostgreSQL store abstraction, Node `crypto` SHA-256/HMAC.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on `codex/commercial-foundation`; preserve the two existing untracked design/grammar documents.
- Keep `EvidenceBundle v1`, Canonical NetworkIR v2, current `/api/agent/chat`, and existing fixture grammars compatible throughout the migration.
- Never execute uploaded code. Provider, code, OCR, sketch, screenshot, and reference content are untrusted data, not instructions.
- Provider proposals may contain only closed facts, typed evidence locators, calibrated confidence, and unresolved questions; no SVG, coordinates, Visio/COM/VBA, shell/Python, paths, URLs, object keys, or desktop commands.
- The browser never submits a diagram, FigurePlan, coordinates, Visio instructions, path, URL, or storage key to the universal export route.
- A candidate with an unresolved critical fact is a watermarked `CandidateStructurePreview`, never a `PublicationFigureSet`, snapshot, confirmation token, or Visio job.
- A completed preview is immutable: confirmation binds `tenantId`, `userId`, `deviceId`, `draftId`, `revision`, `planId`, `planHash`, `previewArtifactHash`, expiry, and one-time nonce. Export must not recompile.
- The sealed Worker request contains canonical plan bytes only; it contains no file path, URL, client diagram, or external plan address. Worker verifies signature, binding, expiry, and hash before rendering.
- Default VSDX output is a new document. Native Shape/readback and rendered PDF/PNG QA contracts are required; real Office acceptance remains a distinct later environment gate.
- Do not stage, commit, push, reset, clean, or delete files as part of this plan without separate user authorization.

## File Structure and Ownership

| File | Responsibility |
|---|---|
| `apps/api/src/evidence-graph.ts` | Closed structural-fact/evidence-graph parser, typed locators, fact relations, public-safe projection. |
| `apps/api/src/network-ir-v3.ts` | Architecture IR v3 schema/semantic validator for ports, merge/attention, symbolic shapes, processes, and feedback. |
| `apps/api/src/network-ir-v2-to-v3.ts` | Loss-aware v2 compatibility adapter that emits explicit unresolved items rather than guessing semantics. |
| `apps/api/src/plan-snapshot.ts` | Canonical FigureSet serialization/hash, immutable snapshot input validation, artifact identity checks. |
| `apps/api/src/plan-snapshot-store.ts` | Store contract plus in-memory implementation for immutable snapshots, viewed-preview records, tokens, and idempotent universal exports. |
| `apps/api/src/figure-draft-preview-service.ts` | Candidate/full preview state transition; only full, QA-passing figures persist snapshots. |
| `apps/api/src/figure-export-service.ts` | Ownership-bound, one-time confirmation-token issuance and plan-only job creation. |
| `apps/api/src/visio-universal-protocol.ts` | Versioned sealed-plan Worker DTO plus parse/verification helpers. |
| `apps/api/src/visio-universal-worker-client.ts` | Worker client for verified sealed plans, VSDX readback and renderer-QA response contracts. |
| `apps/api/src/routes.ts` | Version-negotiated draft preview/view/confirm/export routes, while retaining the legacy diagram route in an explicitly scoped branch. |
| `apps/api/src/domain.ts`, `apps/api/src/store.ts`, `apps/api/src/postgres-store.ts` | Additive persistence/model migration only after in-memory contracts and route semantics are green. |
| `apps/api/tests/*` | Contract-first regression suite. Keep existing legacy tests passing unchanged except where a legacy route is explicitly renamed/isolated. |

---

### Task 1: Closed EvidenceGraph v2 contract

**Files:**

- Create: `apps/api/src/evidence-graph.ts`
- Create: `apps/api/tests/evidence-graph.test.ts`
- Keep compatible: `apps/api/src/evidence-bundle.ts`, `apps/api/tests/evidence-bundle.test.ts`

**Interfaces:**

```ts
export type FactKind =
  | "node_exists" | "node_kind" | "port_type" | "tensor_representation"
  | "edge_exists" | "merge_kind" | "skip_relation" | "attention_relation"
  | "repeat" | "stage_membership" | "shape" | "output_semantics"
  | "process_semantics" | "layout_hint" | "style_hint";

export type StructuralFact = /* discriminated union whose payload.kind equals kind */;
export interface EvidenceGraph { version: 2; facts: StructuralFact[]; relations: FactRelation[]; }
export function parseEvidenceGraph(value: unknown): EvidenceGraph;
export function publicEvidenceGraphSummary(value: EvidenceGraph): PublicEvidenceGraphSummary;
```

- [ ] **Step 1: Write failing contract tests.** Add tests that accept a `merge_kind` fact with a typed code locator and accepted provenance, reject a free-form `value`, reject `payload.kind !== kind`, reject out-of-range image bounds and invalid code/text ranges, reject relations to unknown facts, and ensure public summaries expose no locator/excerpt/source hash.

```ts
expect(() => parseEvidenceGraph({ version: 2, facts: [mergeFact], relations: [] })).not.toThrow();
expect(() => parseEvidenceGraph({ version: 2, facts: [{ ...mergeFact, payload: { kind: "node_kind", semanticRole: "merge" } }], relations: [] })).toThrow(/payload|kind/i);
expect(JSON.stringify(publicEvidenceGraphSummary(graph))).not.toMatch(/model\.py|sha256|startLine/i);
```

- [ ] **Step 2: Verify the tests are red.** Run `npx vitest run apps/api/tests/evidence-graph.test.ts`. Expected: import/module failure because `evidence-graph.ts` does not exist.

- [ ] **Step 3: Implement the minimal closed Zod schema.** Use strict objects for every locator and payload variant. Require unique fact/relation IDs; require `conflictGroupId` for `conflicted` facts; check relation endpoints after parsing; disallow unsafe free strings by construction rather than by keyword filtering.

- [ ] **Step 4: Verify green and legacy compatibility.** Run `npx vitest run apps/api/tests/evidence-graph.test.ts apps/api/tests/evidence-bundle.test.ts`. Expected: all tests pass.

### Task 2: Architecture IR v3 and loss-aware v2 adapter

**Files:**

- Create: `apps/api/src/network-ir-v3.ts`
- Create: `apps/api/src/network-ir-v2-to-v3.ts`
- Create: `apps/api/tests/network-ir-v3.test.ts`
- Create: `apps/api/tests/network-ir-v2-to-v3.test.ts`
- Keep compatible: `apps/api/src/network-ir-v2.ts`, `apps/api/tests/network-ir-v2.test.ts`

**Interfaces:**

```ts
export interface ArchitectureIRv3 { version: 3; graphId: string; inputs: PortRef[]; outputs: PortRef[]; modules: ArchitectureModule[]; nodes: ArchitectureNode[]; edges: ArchitectureEdge[]; processes: ProcessSemantic[]; evidenceIndex: Record<string, EvidenceRef[]>; unresolved: UnresolvedQuestion[]; }
export interface ArchitectureIRv3ValidationResult { valid: boolean; ir?: ArchitectureIRv3; issues: ArchitectureIRv3ValidationIssue[]; }
export function validateArchitectureIRv3(value: unknown, graph?: EvidenceGraph, options?: { renderReady?: boolean }): ArchitectureIRv3ValidationResult;
export function adaptCanonicalNetworkIRv2(value: CanonicalNetworkIR, evidence?: EvidenceGraph): ArchitectureIRv3;
```

- [ ] **Step 1: Write failing tests.** Cover an Add with two data ports and proven shape compatibility; reject Add arity one; require concat axis and block unknown non-concat dimensions in render-ready validation; require attention Q/K/V roles; reject data edges that point to missing ports; accept a feedback edge only when referenced by an iterative/recurrent process; and prove the v2 adapter preserves IDs/evidence while adding a blocking unresolved for lost port/axis semantics.

```ts
expect(validateArchitectureIRv3(validAdd, graph, { renderReady: true }).valid).toBe(true);
expect(validateArchitectureIRv3({ ...validAdd, nodes: [{ ...add, inputPorts: [add.inputPorts[0]] }] }, graph).issues).toContainEqual(expect.objectContaining({ code: "merge-arity" }));
expect(adapted.unresolved).toContainEqual(expect.objectContaining({ severity: "blocking", conflictKey: "v2:merge:add-1" }));
```

- [ ] **Step 2: Verify red.** Run `npx vitest run apps/api/tests/network-ir-v3.test.ts apps/api/tests/network-ir-v2-to-v3.test.ts`. Expected: missing modules.

- [ ] **Step 3: Implement the schemas and semantic passes.** Parse strict v3 JSON first; build node/port/module/process indexes; validate module tree, one direct module per node, all edge endpoints, input/output reachability, typed merge/attention constraints, symbolic-shape compatibility and feedback/process coupling. The adapter may map v2 tensors to ports but must never infer concat axis, attention role, process semantics, or evidence not present in v2.

- [ ] **Step 4: Verify green.** Run `npx vitest run apps/api/tests/network-ir-v3.test.ts apps/api/tests/network-ir-v2-to-v3.test.ts apps/api/tests/network-ir-v2.test.ts`. Expected: all tests pass.

### Task 3: Immutable FigureSet and PlanSnapshot contract

**Files:**

- Create: `apps/api/src/plan-snapshot.ts`
- Create: `apps/api/src/plan-snapshot-store.ts`
- Create: `apps/api/tests/plan-snapshot.test.ts`
- Create: `apps/api/tests/plan-snapshot-store.test.ts`

**Interfaces:**

```ts
export interface PlanSnapshot { planId: string; draftId: string; revision: number; figureSet: PublicationFigureSet; canonicalPlanBytesSha256: string; previewArtifactHashes: PreviewArtifactHash[]; compilerManifest: CompilerManifest; visualQa: VisualQaResult; createdAt: string; immutable: true; }
export function createPlanSnapshot(input: CreatePlanSnapshotInput): PlanSnapshot;
export interface PlanSnapshotStore { insert(snapshot: PlanSnapshot): Promise<PlanSnapshot>; getForRevision(owner: OwnerScope, draftId: string, revision: number, planId: string): Promise<PlanSnapshot | null>; recordViewedPreview(input: ViewedPreviewInput): Promise<void>; }
```

- [ ] **Step 1: Write failing tests.** Prove canonical reordering of JSON object keys produces the same SHA-256 hash; changing a preview hash or compiler manifest produces a different hash/snapshot identity; reject non-passing QA, duplicate panel IDs, cross-panel mappings to missing panels, or non-immutable inserts; and prevent replacement of an existing `planId`.

- [ ] **Step 2: Verify red.** Run `npx vitest run apps/api/tests/plan-snapshot.test.ts apps/api/tests/plan-snapshot-store.test.ts`. Expected: missing modules.

- [ ] **Step 3: Implement deterministic snapshot construction.** Use a recursive canonical JSON encoder with sorted object keys and no non-finite values; hash UTF-8 canonical bytes using `createHash("sha256")`; freeze/clone stored values; validate exact panel/preview/hash correspondence before insertion.

- [ ] **Step 4: Verify green.** Run the two focused tests. Expected: all tests pass.

### Task 4: Candidate/full preview state transition

**Files:**

- Modify: `apps/api/src/figure-draft-preview-service.ts`
- Modify: `apps/api/src/figure-draft-service.ts`
- Modify: `apps/api/src/figure-draft-payload.ts`
- Create: `apps/api/tests/universal-preview-state.test.ts`
- Modify: `apps/api/tests/figure-draft-preview-service.test.ts`

**Interfaces:**

```ts
export type UniversalPreview = CandidateStructurePreview | FullPublicationPreview;
export interface CandidateStructurePreview { kind: "candidate_structure"; watermark: "STRUCTURE_PENDING_CONFIRMATION"; blockingQuestion: UnresolvedQuestion; preview: SafeCandidateProjection; }
export interface FullPublicationPreview { kind: "publication_figure_set"; planId: string; planHash: string; previewArtifacts: PreviewArtifactHash[]; figureSet: PublicPublicationFigureSet; }
```

- [ ] **Step 1: Write failing tests.** Confirm unresolved critical structure returns only a watermarked candidate and persists no snapshot; confirm ready IR plus passing QA persists one immutable snapshot and returns its exact artifact hashes; confirm the same revision cannot quietly substitute a changed manifest/artifact hash; confirm question answers are appended without deleting earlier question history.

- [ ] **Step 2: Verify red.** Run `npx vitest run apps/api/tests/universal-preview-state.test.ts apps/api/tests/figure-draft-preview-service.test.ts`. Expected: missing types/incorrect transient preview behavior.

- [ ] **Step 3: Implement the state boundary.** Gate all full compilation behind `validateArchitectureIRv3(..., { renderReady: true })` and QA `pass`. Store the completed FigureSet before responding. Candidate previews must not invoke the full layout compiler or snapshot store.

- [ ] **Step 4: Verify green.** Run the focused preview tests plus `apps/api/tests/figure-draft-service.test.ts`.

### Task 5: Exact-view confirmation and plan-only export authorization

**Files:**

- Create: `apps/api/src/figure-export-service.ts`
- Create: `apps/api/tests/figure-export-service.test.ts`
- Modify: `apps/api/src/domain.ts`
- Modify: `apps/api/src/store.ts`
- Modify: `apps/api/src/postgres-store.ts`
- Modify: `apps/api/src/routes.ts`
- Create: `apps/api/tests/universal-figure-export-routes.test.ts`

**Interfaces:**

```ts
export interface ExportConfirmationTokenService { issueViewedSnapshotToken(input: ViewedSnapshotIdentity): Promise<string>; consume(input: ConsumeSnapshotTokenInput): Promise<AuthorizedUniversalExport>; }
export interface UniversalExportRequest { confirmationToken: string; idempotencyKey: string; }
// POST /api/figure-drafts/:draftId/revisions/:revision/exports
```

- [ ] **Step 1: Write failing tests.** Require authenticated same-tenant/user/device ownership; require accepted `Accept-Figure-Version: 3` and response `Figure-Version: 3`; reject missing/expired/replayed token; reject a token for a different revision, plan hash, or preview artifact; reject bodies containing `diagram`, `figurePlan`, `coordinates`, `path`, `url`, or storage keys; ensure an idempotency repeat returns the same job without consuming another token.

- [ ] **Step 2: Verify red.** Run `npx vitest run apps/api/tests/figure-export-service.test.ts apps/api/tests/universal-figure-export-routes.test.ts`. Expected: endpoint/service missing.

- [ ] **Step 3: Implement authorization.** Use HMAC-signed, 15-minute one-time opaque tokens with a server-side nonce record. Bind the token to the exact viewed identity, then create an idempotent job whose input holds only server-created `planId`, `planHash`, and sealed plan envelope. Do not accept any client rendering payload.

- [ ] **Step 4: Verify green.** Run the focused route/service tests and existing `apps/api/tests/figure-draft-routes.test.ts`.

### Task 6: Sealed universal Worker protocol and renderer-QA response

**Files:**

- Create: `apps/api/src/visio-universal-protocol.ts`
- Create: `apps/api/src/visio-universal-worker-client.ts`
- Create: `apps/api/tests/visio-universal-protocol.test.ts`
- Create: `apps/api/tests/visio-universal-worker-client.test.ts`
- Modify: `apps/api/src/visio-job-runner.ts`

**Interfaces:**

```ts
export const UNIVERSAL_VISIO_PROTOCOL_VERSION = 1 as const;
export interface SealedPlanEnvelope { version: 1; jobId: string; tenantId: string; userId: string; deviceId: string; planId: string; planHash: string; expiresAt: string; canonicalPlanBase64: string; signature: string; }
export interface UniversalVisioWorkerRequest { protocolVersion: 1; requestId: string; jobId: string; mode: "mock" | "live"; sealedPlan: SealedPlanEnvelope; }
```

- [ ] **Step 1: Write failing tests.** Accept an authentic envelope; reject any request containing `diagram`, `outputPath`, `planUrl`, or `planPath`; reject expired/tampered/binding-mismatched envelope; ensure runner calls the universal executor with sealed plan only; require response native-shape readback, semantic IDs, PDF/PNG artifact metadata, page-fit, overflow, font fallback, endpoint, OCR/readability, geometry-tolerance, and Office-content-safety QA fields.

- [ ] **Step 2: Verify red.** Run `npx vitest run apps/api/tests/visio-universal-protocol.test.ts apps/api/tests/visio-universal-worker-client.test.ts`. Expected: missing universal protocol/client.

- [ ] **Step 3: Implement protocol/client/runner split.** Keep `visio-protocol.ts` and `executeDiagram` only for explicitly legacy jobs. Introduce a different job type and executor method for universal sealed plans. Verify envelope before child process spawn and again in Worker parser; never derive an input file path from envelope data.

- [ ] **Step 4: Verify green.** Run focused universal Worker tests plus `apps/api/tests/visio-job-runner.test.ts` and `apps/api/tests/visio-worker-client.test.ts`.

### Task 7: Legacy route isolation, migration, and retention controls

**Files:**

- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/domain.ts`
- Modify: `apps/api/src/store.ts`
- Modify: `apps/api/src/postgres-store.ts`
- Create: `apps/api/src/figure-lifecycle-service.ts`
- Create: `apps/api/tests/legacy-visio-isolation.test.ts`
- Create: `apps/api/tests/figure-lifecycle-service.test.ts`
- Modify: `apps/api/tests/visio-routes.test.ts`

- [ ] **Step 1: Write failing tests.** Assert legacy browser-diagram exports use a `/api/legacy/visio-exports` namespace and cannot reference a draft/revision/snapshot; assert universal exports cannot reach `normalizeVisioDiagram`; assert retention deletion revokes outstanding tokens, quarantines snapshot/artifact access, preserves minimum audit data, and allows re-export only from a retained immutable snapshot.

- [ ] **Step 2: Verify red.** Run `npx vitest run apps/api/tests/legacy-visio-isolation.test.ts apps/api/tests/figure-lifecycle-service.test.ts apps/api/tests/visio-routes.test.ts`. Expected: universal/legacy boundary is not yet enforced.

- [ ] **Step 3: Implement additive migration flags and lifecycle actions.** Add explicit `legacy-diagram-export` versus `universal-figure-export` job types, version-negotiated DTOs, dual-write/read feature flags, retention states, token revocation, and structured audit events. Preserve existing legacy behavior only behind its legacy namespace until a separately approved deprecation release.

- [ ] **Step 4: Verify green.** Run the focused tests and `npx vitest run apps/api/tests/routes.test.ts apps/api/tests/agent-routes.test.ts`.

### Task 8: Complete A0 regression, migration checks, and delivery evidence

**Files:**

- Modify as required: `docs/superpowers/specs/2026-08-14-universal-neural-figure-compiler-design.md` only if implementation exposes a real contradiction.
- Do not modify: `docs/superpowers/plans/2026-08-14-graph-message-passing-grammar.md`.

- [ ] **Step 1: Run A0 focused suite.**

```powershell
npx vitest run apps/api/tests/evidence-graph.test.ts apps/api/tests/network-ir-v3.test.ts apps/api/tests/network-ir-v2-to-v3.test.ts apps/api/tests/plan-snapshot.test.ts apps/api/tests/plan-snapshot-store.test.ts apps/api/tests/universal-preview-state.test.ts apps/api/tests/figure-export-service.test.ts apps/api/tests/universal-figure-export-routes.test.ts apps/api/tests/visio-universal-protocol.test.ts apps/api/tests/visio-universal-worker-client.test.ts apps/api/tests/legacy-visio-isolation.test.ts apps/api/tests/figure-lifecycle-service.test.ts
```

Expected: every A0 contract test passes.

- [ ] **Step 2: Run project regression and TypeScript/static boundary checks.**

```powershell
npm run api:test
npm run api:check
```

Expected: 0 failing test files, 0 failing tests, and no forbidden client-to-Worker diagram path in the universal route.

- [ ] **Step 3: Manually inspect the boundary.** Use `rg -n 'diagram|figurePlan|outputPath|planUrl|planPath' apps/api/src/routes.ts apps/api/src/visio-universal-* apps/api/src/visio-job-runner.ts` and verify universal export parsing accepts only `{ confirmationToken, idempotencyKey }`; inspect `git status --short` to ensure only intended files changed and existing untracked documents remain.

- [ ] **Step 4: Report gates precisely.** Report automated contract/regression evidence separately from unperformed real Provider, actual Visio/COM, VSDX reopen/readback, PDF/PNG renderer, installer, and external-service acceptance gates. Do not commit or push unless the user separately authorizes it.

## Plan Self-Review

- **Spec coverage:** Tasks 1–2 cover closed facts, typed locators, symbolic shapes, typed ports, process/feedback and v2 compatibility. Tasks 3–4 cover FigureSet/Snapshot identity and candidate/full preview separation. Tasks 5–7 cover exact confirmation, plan-only routes, sealed Worker input, legacy isolation, API versions, retention, and migration. Task 8 requires both focused and full regression evidence.
- **Intentional exclusions:** A0 does not implement PyTorch/Keras/sketch analyzers, architecture signatures, new visual grammars, top-journal layout design, or real Visio COM rendering. Those begin in A.1–E after the contracts are closed.
- **Consistency check:** `planHash` always derives from canonical FigureSet bytes; confirmation and sealed plan bind that exact hash; the universal worker never recompiles nor dereferences external input; v2/legacy paths remain additive and cannot become a universal export shortcut.
