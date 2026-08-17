# M0/M1 Static PyTorch Evidence Record

Date: 2026-08-17
Branch: `agent`
Local and remote revision: `bae5b02f9bde4e026cf878e9e4f205040cf02f85`

This record describes the accepted M0/M1 capability boundary on the synchronized `agent` branch. It is not a release or real-host acceptance record.

## Revision State

- Local `HEAD`: `bae5b02f9bde4e026cf878e9e4f205040cf02f85`
- `origin/agent`: `bae5b02f9bde4e026cf878e9e4f205040cf02f85`
- The worktree is clean and the branch has no upstream divergence.

## Implemented Boundary

- M0 restores the strict Visio readback contract, explicit unknown-value narrowing, and complete Worker fixtures.
- `SourcePack` validates source identity, MIME, strict Base64, UTF-8, a 200,000-byte bound, and SHA-256 without executing source content.
- `FigureAnalysisService` analyzes only the bounded static-linear PyTorch subset through `EvidenceGraph` and `Architecture IR v3`.
- Dynamic control flow, repeated module calls, and unsupported forward calls produce a bounded `candidate_structure` with one deterministic blocking question.
- `POST /api/figure-analyses` and `GET /api/figure-analyses/:id` require an authenticated owner and `Accept-Figure-Version: 3`; successful responses set `Figure-Version: 3`.
- Public analysis responses and analysis audit metadata omit raw source, Base64, retained-source references, provider credentials, paths, commands, SVG/XML, coordinates, and Worker fields.
- Candidate and ready analysis records do not create a preview artifact, PlanSnapshot, export token, or Worker Job.

## Verification

Focused M1 tests:

- onboarding: 1 passed
- SourcePack: 7 passed
- FigureAnalysisService: 4 passed
- FigureAnalysis routes: 7 passed
- Store contract: 20 passed
- Static analyzer/compiler regression: 10 passed

Fresh full checks:

- `npm run api:test`: 87 test files, 500 tests passed
- `npx tsc --noEmit`: passed
- `npm run api:check`: `Foundation boundary OK`
- `git diff --check`: passed

## Not Accepted

| Gate | Status | Reason |
|---|---|---|
| Arbitrary PyTorch, Keras, ONNX, image, sketch, GNN, branch/merge/shape understanding | NOT_ACCEPTED | P0.0 is static-linear PyTorch only |
| Figure Components, publication preview, ComposableDagFigureCompiler | NOT_ACCEPTED | M2 scope |
| Real PostgreSQL migration and transactional host smoke | NOT_ACCEPTED | Adapter contract tests exist; no fresh live database evidence in this run |
| Real Provider call, relay production key, cost/retry controls | NOT_ACCEPTED | Static analysis is Provider-free |
| Real Windows/Visio create, save, close, reopen, native readback, PDF/PNG and visual QA | NOT_ACCEPTED | Existing mock/protocol tests are not real-host acceptance |
| Electron packaging, signing, DPAPI clean-machine acceptance | NOT_ACCEPTED | Outside M0/M1 |

The next permitted milestone is M2.1 Figure Component contract design. M2 work must not be described as complete based on this evidence.
