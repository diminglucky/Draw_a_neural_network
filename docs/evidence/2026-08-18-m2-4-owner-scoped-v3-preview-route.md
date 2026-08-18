# M2.4 Owner-Scoped v3 Preview Route Evidence

Date: 2026-08-18
Branch: `agent`
Worktree: `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`
Implementation commit: `75f92c4` (`feat: expose owner scoped v3 analysis preview route`)

## Accepted implementation boundary

M2.4 adds the independent authenticated v3 route:

```text
GET /api/figure-analyses/:analysisId/preview
Accept-Figure-Version: 3
```

The route scopes `getFigureAnalysis` by the authenticated user ID and returns
the same bounded `404` for missing and foreign analyses. Successful responses
set `Figure-Version: 3`.

For `candidate_structure`, the route returns HTTP 200 with
`STRUCTURE_PENDING_CONFIRMATION`, the persisted blocking question, and bounded
confirmed node IDs. It does not compile, run Visual QA, create a Job, create a
PlanSnapshot, export an artifact, or issue a Worker request.

For `ready_for_preview`, the service revalidates Architecture IR v3, uses the
server-owned default `FigureIntent` and deterministic `m2-4-${analysisId}`
layout seed, calls the M2.3 composable DAG publication builder, and rejects a
failed blocking Visual QA result. The response is a deep-cloned safe
publication-plan projection containing bounded semantic geometry, ports, route
fields, visual styles/labels, graph/version metadata, and QA status. It omits
the internal evidence index, evidence IDs, source mappings, source excerpts,
Provider/Worker fields, SVG/XML, paths, and commands.

The v2 route
`GET /api/figure-drafts/:draftId/preview` remains unchanged. M2.4 does not
create durable PlanSnapshot/artifact identity; that remains an M2.5 boundary.

During integration, the persisted static v3 compiler was also repaired to copy
accepted fact evidence references into `ArchitectureIRv3.evidenceIndex`. This
is required for the existing M2.3 evidence/source-mapping QA checks to pass on
real persisted ready analyses. The preview service identifier guard was aligned
with the existing route guard so UUID analysis IDs beginning with a digit are
accepted.

## Focused verification

Command:

```text
npx.cmd vitest run apps/api/tests/figure-analysis-preview-service.test.ts apps/api/tests/figure-analysis-preview-routes.test.ts apps/api/tests/figure-analysis-routes.test.ts apps/api/tests/figure-draft-preview-routes.test.ts apps/api/tests/universal-preview-service.test.ts apps/api/tests/visual-qa.test.ts apps/api/tests/composable-dag-visual-qa.test.ts apps/api/tests/static-pytorch-ir-compiler.test.ts
```

Result: 8 test files passed, 64 tests passed.

The focused tests cover version negotiation, authentication, owner scope,
missing/foreign not-found parity, real UUID-shaped persisted IDs, ready
publication-plan compilation through M2.3 and passing QA, candidate watermark
and no preview side effects, deterministic repeated responses, caller
mutation isolation, bounded audit metadata, safe DTO omission, unresolved
ready IR rejection, evidence-index continuity, and unchanged v2 preview
compatibility.

## Repository verification

| Gate | Result |
| --- | --- |
| `npm.cmd run api:test` | 92 test files passed, 561 tests passed |
| `npx.cmd tsc --noEmit` | passed, exit code 0 |
| `npm.cmd run api:check` | passed: Foundation boundary OK |
| `npm.cmd run agent:verify-roadmap` | passed, exit code 0 before state transition |
| `git diff --check` | passed, exit code 0 |

The implementation commits are `be3232a` (service), `4d33959` (route RED
contract), and `75f92c4` (route wiring plus evidence-index and UUID fixes).
The design and implementation plan are `75c9f99` and `3fea0ac`.

## Audit and persistence boundary

Successful route reads append only bounded audit metadata: user-scoped analysis
ID, preview kind, capability/version, component/connection counts, confirmed
node count, and QA status. No source code, source path, evidence payload,
Provider data, plan geometry dump, Job, export request, PlanSnapshot, or Worker
request is created by M2.4.

## Scope not accepted by M2.4

The following are explicitly not claimed by this evidence:

- browser rendering, browser screenshot comparison, pixel-level QA, or manual visual review;
- real SVG, XML, PNG, PDF, or other preview artifact rendering;
- durable PlanSnapshot identity, artifact hashes, export tokens, or export Job creation;
- Provider calls, model execution, Keras, ONNX, GNN, or image understanding;
- live PostgreSQL or Redis acceptance;
- Electron packaging or desktop host acceptance;
- live Worker execution, Worker cancellation/recovery, or Worker artifact readback;
- Visio COM automation, VSDX save, close/reopen, editability, or independent native readback;
- real Windows host acceptance or preview-to-native-Visio equivalence.

Those gates remain separate M2.5/M2.9/M3/M4 responsibilities and require
independent evidence.
