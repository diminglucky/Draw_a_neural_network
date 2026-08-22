# M2.4 Owner-Scoped v3 Preview Route Design

**Status:** Approved direction after user confirmation; implementation begins after this spec review
**Date:** 2026-08-18
**Scope:** M2.4 of the Universal Neural Figure Agent: expose the accepted v3 analysis record through an authenticated, owner-scoped preview route without mixing it with the legacy v2 Draft preview path.

## 1. Decision summary

M2.4 adds a separate v3 preview entry point:

```text
GET /api/figure-analyses/:analysisId/preview
Accept-Figure-Version: 3
```

The route reads the immutable `FigureAnalysisRecord` owned by the authenticated
user. A `candidate_structure` record returns a bounded, watermarked candidate
projection and never invokes the publication compiler. A
`ready_for_preview` record is validated again, compiled through the M2.3
`ComposableDagPublicationPlan` boundary, and checked by v3 Visual QA before a
safe preview projection is returned.

The existing v2 route
`GET /api/figure-drafts/:draftId/preview` remains unchanged. No v2/v3 union
DTO is introduced, and the route does not accept a Draft ID, source code,
provider content, arbitrary geometry, SVG/XML, paths, commands, or Worker
fields.

M2.4 does not fabricate SVG/PNG artifact hashes or force an analysis record to
pretend to be a legacy Draft revision. PlanSnapshot identity and real preview
artifact production remain M2.5 responsibilities. This keeps the route's
accepted result honest: it is a structured v3 publication preview projection,
not browser screenshot QA or a native rendering artifact.

## 2. Route and ownership contract

### Request

- Method: `GET`.
- Path parameter: `analysisId`, a bounded safe identifier.
- Required header: `Accept-Figure-Version: 3`.
- No request body, query-driven layout, source content, Provider key, or
  client-supplied plan fields.
- The route uses a deterministic server-owned default `FigureIntent` and a
  deterministic layout seed derived from the analysis identity. Client layout
  choices are deferred until a separately versioned contract exists.

### Authorization and errors

- The request requires a valid authenticated user session.
- The store lookup is always scoped by `access.user.id`.
- Missing or foreign analysis IDs return the same `404` safe not-found result;
  the route must not reveal whether a foreign record exists.
- Missing or unsupported `Accept-Figure-Version` returns the existing
  validation error shape with supported version `[3]`.
- Invalid analysis data and an unresolved ready analysis fail closed with a
  bounded validation/preview error and no public source payload.
- The route emits `Figure-Version: 3` on successful v3 responses.

## 3. Preview state behavior

### Candidate structure

For `status: "candidate_structure"`:

- return HTTP 200;
- return `kind: "candidate_structure"`;
- return `watermark: "STRUCTURE_PENDING_CONFIRMATION"`;
- return exactly the persisted blocking question and bounded confirmed node
  IDs;
- include safe analysis metadata only;
- do not call `buildComposableDagPublicationPlan`;
- do not call a compiler, Visual QA, PlanSnapshot store, export service, or
  Worker;
- do not return raw Architecture IR or evidence payloads in this candidate
  preview DTO.

### Ready preview

For `status: "ready_for_preview"`:

1. Re-validate the stored Architecture IR v3 at request time.
2. Reject any blocking unresolved question or non-render-ready IR.
3. Build the deterministic M2.3 publication plan using the default intent and
   analysis-derived seed.
4. Run `runComposableDagVisualQa`.
5. Return only a public projection of the ready publication plan and the
   snapshot-compatible Visual QA result when all blocking checks pass.

The public projection omits `evidenceIndex`, raw evidence references, source
locators, source excerpts, and internal compiler-only fields. It contains only
bounded semantic component/connection geometry, ports required for preview
rendering, deterministic visual styles/labels, graph identity, version, and
QA status. The server retains the internal plan only for the request lifetime;
M2.5 will define durable PlanSnapshot/artifact identity.

## 4. Service and module boundaries

Add a focused `FigureAnalysisPreviewService` adapter with these responsibilities:

- load the user-scoped analysis record through `FoundationStore`;
- distinguish candidate and ready states;
- derive the fixed default FigureIntent and bounded layout seed;
- call the v3 publication-plan builder and Visual QA only for ready records;
- project internal plans to a safe public DTO;
- return deterministic, bounded errors without leaking source content.

The route remains responsible for HTTP authentication, version negotiation,
status codes, response headers, and safe route-level audit metadata. The
service has no Fastify dependency and does not call Provider, filesystem,
Worker, Electron, Visio, or export code.

The current `UniversalPreviewService` remains a separate lower-level v3
snapshot orchestration abstraction. M2.4 does not silently retrofit its
`draftId`/`revision` contract onto `FigureAnalysisRecord`; M2.5 may introduce
an explicit analysis-preview identity after artifact and snapshot semantics
are specified.

## 5. Public DTO

The route returns one of two versioned projections:

```ts
type FigureAnalysisPreviewResponse =
  | {
      version: 3;
      kind: "candidate_structure";
      analysis: { id: string; status: "candidate_structure"; capabilityVersion: string };
      watermark: "STRUCTURE_PENDING_CONFIRMATION";
      blockingQuestion: FigureAnalysisBlockingQuestion;
      confirmedNodeIds: string[];
    }
  | {
      version: 3;
      kind: "publication_plan";
      analysis: { id: string; status: "ready_for_preview"; capabilityVersion: string };
      publicationPlan: PublicComposableDagPublicationPlan;
      visualQa: VisualQaResult;
    };
```

`PublicComposableDagPublicationPlan` is an explicit projection, not a type
alias of the internal plan. It must not contain raw source, evidence index,
source excerpts, absolute paths, Provider fields, shell/PowerShell/VBA/COM,
SVG/XML, Worker protocol fields, or arbitrary renderer commands.

## 6. Audit and persistence boundary

Successful route reads may append a bounded audit event containing only
user-scoped analysis ID, preview kind, graph/component/connection counts, QA
status, and capability/version metadata. It must not contain source code,
source paths, evidence payloads, Provider credentials, plan geometry dumps, or
raw request headers.

M2.4 does not write a PlanSnapshot, preview artifact, export token, Job, or
Worker request. Candidate and failed-ready paths must produce none of these
side effects.

## 7. Test strategy

Tests are test-first and must cover:

1. missing `Accept-Figure-Version` is rejected;
2. unauthenticated access is rejected;
3. same-owner ready analysis returns a v3 publication preview and
   `Figure-Version: 3`;
4. foreign analysis access returns safe `404`;
5. candidate structure returns a watermark and never calls the compiler,
   Visual QA, snapshot store, export service, or Worker;
6. ready analysis with blocking unresolved data fails closed;
7. malformed/stale stored IR fails closed without source payload;
8. ready preview output omits `evidenceIndex`, source excerpts, paths,
   provider fields, Worker fields, and arbitrary commands;
9. repeated requests for the same analysis are byte-deterministic;
10. the legacy v2 Draft preview route and tests remain unchanged;
11. audit metadata is bounded and source-safe;
12. no PlanSnapshot or export side effect is created in M2.4.

Focused tests must pass before the full API suite, strict TypeScript,
foundation boundary, roadmap verification, and diff check.

## 8. Non-goals

- No browser UI or SVG/PNG rasterization.
- No pixel/screenshot comparison or manual visual review.
- No durable PlanSnapshot or preview artifact identity; that is M2.5.
- No Provider, Keras, ONNX, image understanding, GNN, or model execution.
- No Electron, Worker-live, Visio COM, VSDX, save/close/reopen, or native
  readback acceptance.
- No changes to the v2 Draft preview route or legacy v2 Visual QA contract.

## 9. Exit criteria

M2.4 is ready for acceptance only when:

1. the independent authenticated route is registered and versioned;
2. ownership is enforced with a safe foreign-resource response;
3. candidate structures never compile or create durable preview/export state;
4. ready analyses pass through the M2.3 publication-plan and Visual QA
   boundary;
5. the public DTO is source-safe and deterministic;
6. focused route/service tests and unchanged v2 tests pass;
7. the full API suite, strict TypeScript, foundation check, roadmap verify, and
   diff check pass;
8. the evidence record separately lists unaccepted browser, artifact,
   snapshot, Worker, and real Visio gates.
