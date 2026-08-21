# DB-2026-08-21: DrawingRun Runtime Migration Governance

**Status:** Planned governance baseline. This record establishes migration and evidence rules only. It implements no DrawingRun runtime, Provider, PVP, Worker, Visio behavior, production route, persistence, or host capability.

## Decision

All new neural-drawing capabilities must converge on one canonical artifact chain:

```text
DrawingIntent
-> PrivateInputReceipt(s)
-> EvidencePack
-> StructuralAssessment
-> formal UGS or clarification
-> GPG
-> formal PVP
-> sealed execution request
-> independent Visio readback
```

An adapter may translate a legacy request into `DrawingIntent` or verified evidence. It must not inject a PVP, page target, native intent, Worker command, or Visio artifact into a later stage. A candidate, clarification, rejection, cancellation, stale revision, foreign owner/device, or changed target terminates the path before PVP composition or native work.

## Authority and compatibility rules

| Area | Current treatment | Governance rule | Successor and retirement condition |
| --- | --- | --- | --- |
| `AgentService` / `agent-runtime.ts` | Legacy chat authority | May emit a compatibility `DrawingIntent`; cannot decide structure, publish PVP, or issue native work. | Coordinator adapter after documented Phase 0-2 closure; retire only after every new route uses DrawingRun. |
| `NetworkIR` family | Legacy graph representation | Existing saved drafts remain readable; no new capability may make it a second canonical graph. | UGS through an adapter; retire writer use after saved-draft migration and regression retention. |
| Free-text M2.12 prototype | Regression-only compatibility path | No new route, Provider feature, public identifier field, PVP, Snapshot, export, Worker, or Visio authority. | Receipt-bound Structural Harness after documented Phase 0-2 closure; remove only after all callers use `StructuralAssessment`. |
| Existing preview/export/Visio paths | Historical and fixture-specific paths | Preserve tests and explicit owner/device checks, but do not treat them as the future current-page pipeline. | Formal PVP -> sealed binding -> Worker -> readback -> real-host chain; retire or fence each legacy path after equivalent regression evidence. |

## Sequencing and ledger rule

`M2.12` remains the active design-gated current focus with its existing accepted dependencies `M2.8`, `M2.10`, and `M2.11`. Phase 0 migration governance, Phase 1 DrawingRun contracts/public projection, and Phase 2 Coordinator/durability are non-skippable prerequisites recorded in M2.12's existing quality acceptance and next action, not replacement DAG dependencies or new current focus. M2.12 must not move to `awaiting_acceptance` or `accepted` until document and commit evidence records the Phase 0-2 predecessor closure. Receipt/EvidencePack implementation follows that closure. `M2.13` remains the later semantic visual-corpus stage.

Current-page Visio is a separate planned node, `M3.6`. It cannot be accepted from unit tests or from an existing export path. Its dependencies are formal PVP (`M2.13`), sealed binding (`M3.2`), restricted Worker (`M3.3`), independent readback/recovery (`M3.4`), and real-host acceptance (`M3.5`). `OpenOrCreate` is excluded from this path: it may never create a document or page as a fallback for an existing-page update.

## Evidence and status policy

- A roadmap status, design baseline, test result, commit, or fixture is not an acceptance record by itself.
- M2.12 requires test, typecheck, document, and commit evidence for its stated acceptance items; M2.13 also requires recorded manual visual review. Test-only evidence cannot make either node accepted.
- M3.6 requires test, document, independent real-host evidence, and manual visual review. It must additionally demonstrate a formal PVP lineage, selected page/owned-region binding, preservation of unrelated shapes, save/close/reopen on an explicit test target, and independent readback.
- The existing accepted M3.1 Snapshot-only native-intent mapping remains limited to its documented contract. It does not imply a Worker, current-page mutation, or real-host acceptance.

## Phase 0 exit condition

Phase 0 is limited to this baseline, the migration inventory, planned-node governance, focused roadmap assertions, generated `docs/ROADMAP.md`, and append-only operation history. No evidence is added and no future runtime node moves to `accepted`.
