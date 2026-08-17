# M0/M1 Static PyTorch Evidence Record

Date: 2026-08-17
Branch: `agent`
Worktree: `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`

This record describes the verified local worktree state. It is intentionally not a release or remote-branch acceptance record.

## Revision State

- Local `HEAD`: `237a1dc5603c61902240b1653e13f4ed28389f36`
- `origin/agent`: `d682bc92ec60bb10572fd64fb1f6447580561e1c`
- The local worktree is ahead by six existing commits and also contains uncommitted M0/M1 changes.
- The unrelated untracked GNN plan remains present and was not staged, removed, or modified.

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
- SourcePack: 6 passed
- FigureAnalysisService: 4 passed
- FigureAnalysis routes: 7 passed
- Store contract: 20 passed
- Static analyzer/compiler regression: 10 passed

Fresh full checks:

- `npm.cmd run api:test`: 84 test files, 466 tests passed
- `npx.cmd tsc --noEmit`: passed
- `npm.cmd run api:check`: `Foundation boundary OK`
- `git diff --check`: passed; only line-ending normalization warnings were reported

## Not Accepted

| Gate | Status | Reason |
|---|---|---|
| Arbitrary PyTorch, Keras, ONNX, image, sketch, GNN, branch/merge/shape understanding | NOT_ACCEPTED | P0.0 is static-linear PyTorch only |
| Figure Components, publication preview, ComposableDagFigureCompiler | NOT_ACCEPTED | M2 scope |
| Real PostgreSQL migration and transactional host smoke | NOT_ACCEPTED | Adapter contract tests exist; no fresh live database evidence in this run |
| Real Provider call, relay production key, cost/retry controls | NOT_ACCEPTED | Static analysis is Provider-free |
| Real Windows/Visio create, save, close, reopen, native readback, PDF/PNG and visual QA | NOT_ACCEPTED | Existing mock/protocol tests are not real-host acceptance |
| Electron packaging, signing, DPAPI clean-machine acceptance | NOT_ACCEPTED | Outside M0/M1 |

The next permitted milestone is review and integration of this local M0/M1 change set. M2 work must not be described as complete based on this evidence.
