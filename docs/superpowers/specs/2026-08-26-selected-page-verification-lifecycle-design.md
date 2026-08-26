# Selected-Page Verification and Lifecycle Design

**Date:** 2026-08-26
**Status:** Approved direction; implementation requires a separate reviewed plan
**Branch baseline:** `codex/current-page-visio-chain` at `3251382`

## Goal

Make the selected-current-page Visio chain fail closed when the promoted drawing is empty, incomplete, incorrectly source-mapped, cancelled at an unsafe time, or detached from a durable page lease. A Drawing Run may reach `readback_verified` only after the exact promoted native shapes have been verified before save, saved, and verified again afterward.

This design preserves the existing generic `UGS -> GPG -> PVP -> sealed native intent -> selected Visio page` architecture. It does not add model-name templates, create or select a Visio document/page, add unrestricted COM controls, or claim real-Visio acceptance.

## Current Failure Modes

The current chain has four end-to-end truth gaps:

1. A schema-valid readback with zero or missing Agent-owned shapes can be accepted as successful.
2. A renderer-created shape whose semantic source cannot be inferred can fall back to every plan node, hiding an exact-mapping defect.
3. The command order is `attach -> apply -> save -> read -> close`, so an invalid promoted replacement can be persisted before independent verification.
4. A Drawing Run can become terminally cancelled while native work is still running, and a durable `page_bound` run depends on an in-memory, non-replayable lease.

## Chosen Approach

Implement Scheme A in two independently reviewed stages. Stage A1 closes drawing-result truth and save ordering first. Stage A2 closes cancellation and lease-recovery behavior afterward. Neither stage may be reported as real-host acceptance without the separate installed-Visio matrix.

## Stage A1: Exact Promoted-Shape Verification Before Save

### A1.1 Exact creation manifest

Replace the ID-only creation journal with an internal immutable creation manifest. Each renderer-created entry contains:

- the exact native Shape ID returned by Visio;
- one or more exact semantic IDs from the PVP/native plan;
- the renderer role needed to distinguish primary shape, label, auxiliary plane, annotation, or connector;
- the final ownership namespace expected after promotion.

The semantic context is selected before the COM creation call. Immediately after the call returns, the Shape ID and already-known semantic context are recorded before naming, styling, text, Shape Data, or any later fallible operation. Every native creation path remains forced through the tracking page wrapper.

The manifest rejects duplicate Shape IDs, empty semantic mappings, blank semantic IDs, and duplicate semantic IDs within one entry. It is frozen before promotion verification.

### A1.2 Exact source mapping

Staging Shape Data is written from the creation manifest, not inferred from Shape names. The following behavior is removed:

- name-based recovery as an authority source;
- mapping an unrecognized shape to every plan node;
- accepting a promoted shape with no exact semantic mapping.

Names may remain diagnostic metadata but cannot establish source ownership or semantic completeness.

### A1.3 Expected promoted-region state

After promotion, the selected-page session retains an internal expected-region manifest containing the exact promoted Shape IDs, semantic IDs, renderer roles, final namespace, target identity, and plan identity. This is in-process state only; durable process-crash recovery remains outside A1.

Before returning a successful read result, the Worker rereads the final namespace and validates:

- the expected set is nonempty;
- every expected Shape ID exists exactly once;
- every expected Shape remains in the final namespace;
- no expected Shape has an empty source mapping;
- every actual source mapping equals its manifest entry after canonical ordering;
- no duplicate native Shape ID exists in the readback;
- the active document/page still matches the bound target.

An unexpected extra Agent-owned Shape is also a failure. Unrelated user/add-in shapes outside the ownership namespace remain ignored.

### A1.4 Save ordering

The command sequence becomes:

```text
attachSelectedPage
-> applyOwnedRegion
-> readSelectedPage (strict pre-save verification)
-> saveSelectedDocument
-> readSelectedPage (strict post-save verification)
-> closeSession
```

The pre-save readback and post-save readback must have the same canonical exact-ID/semantic manifest hash. If pre-save verification fails, `saveSelectedDocument` is never issued. If save fails or post-save verification differs, the operation fails and the Drawing Run must not enter `readback_verified`.

The public response may continue returning the existing bounded readback DTO. Exact expected-manifest state remains internal to the Worker/session; A1 does not broaden the public browser API or accept client-supplied Shape IDs.

### A1.5 Failure behavior

- Apply failure before promotion: clean only journaled new Shape IDs and retain the old region.
- Apply failure after promotion: retain the promoted replacement and report promoted state truthfully.
- Pre-save readback failure: do not save; return failure and retain diagnostic session state until close.
- Save failure: return failure; do not claim readback verification.
- Post-save readback failure: return failure and record that save may already have persisted the promoted region.
- Empty readback: always fail.

## Stage A2: Safe Cancellation and Durable Replayable Lease

### A2.1 Cancellation boundary

Do not attempt a new interruptible COM protocol in this stage. The existing `applyOwnedRegion` command remains one bounded native operation.

Cancellation is allowed only before native apply dispatch. Once the run has entered `applying`, the cancel route returns a conflict stating that cancellation is not safe while the selected-page mutation is in flight. It must not transition the durable run to terminal `cancelled`.

Between Worker commands, the orchestrator rechecks the durable run revision/state before pre-save read, before save, and before terminal verification. A timeout or transport closure is a Worker failure with an unknown native postcondition, not a successful cancellation. Recovery then requires readback/reconciliation; it may not silently retry apply.

This deliberately favors a truthful, non-interruptible short critical section over a larger Worker protocol redesign. Cross-process cancellation and process-termination recovery remain future work.

### A2.2 Durable lease contract

Replace production-default `InMemorySelectedPageLeaseStore` with a PostgreSQL-backed store when durable storage is configured. The in-memory store remains test/local-only.

Each durable lease stores:

- opaque lease ID;
- tenant/user/device/workflow identity;
- selected document/page identity and fingerprints;
- positive expected revision;
- issue and expiry times;
- consumed time;
- capture idempotency key and request hash.

Lease capture is replayable. Repeating the same authenticated capture idempotency key and request hash returns the same unexpired lease. Reusing the key for a different request fails. The run must not publish `page_bound` unless the durable lease is committed and retrievable. A lost HTTP response can therefore be replayed without recapturing a different page.

Lease consumption remains one-use and owner/device/workflow bound. Database compare-and-set behavior prevents two apply requests from consuming the same lease.

### A2.3 Revision invariant

Require a positive selected-page revision at the first capture/lease boundary and enforce the same invariant in TypeScript, Worker protocol parsing, and C# native-intent mapping. Zero is invalid for a real selected Visio target.

## Data and Authority Boundaries

- The browser never supplies document IDs, page IDs, native Shape IDs, fingerprints, semantic mappings, ownership namespaces, or COM commands.
- Worker discovery remains the only source of selected-page identity.
- PVP/native intent remains the source of expected semantic identity.
- The renderer remains the only source of native Shape IDs created during the operation.
- The Worker/session owns exact manifest verification.
- The API only promotes the Drawing Run to `readback_verified` after successful post-save verification.

## Testing Strategy

All production changes use RED-GREEN TDD.

### A1 focused tests

- zero promoted shapes fail;
- one missing promoted Shape fails;
- duplicate actual Shape ID fails;
- wrong or empty semantic mapping fails;
- unknown renderer-created shape cannot map to all plan nodes;
- unrelated external Shape remains ignored;
- every supported native creation path records exact semantics;
- pre-save readback failure proves save was not issued;
- post-save mismatch fails terminal verification;
- successful order is exactly attach/apply/read/save/read/close;
- pre-save and post-save manifest hashes match.

### A2 focused tests

- cancel before apply succeeds without native mutation;
- cancel while applying returns conflict and does not set `cancelled`;
- timeout is recorded as Worker failure with unknown postcondition;
- durable lease survives service reconstruction;
- identical capture replay returns the same lease;
- changed request under the same key fails;
- lost-response replay does not recapture another page;
- concurrent consume permits exactly one winner;
- zero revision is rejected at the first boundary.

### Completion gates

For each stage:

- focused TypeScript/C# tests;
- complete Worker Release suite;
- complete API suite, with pre-existing unrelated baseline failures separated rather than hidden;
- TypeScript compilation;
- foundation boundary check;
- diff check;
- independent code review;
- implementation-history record;
- clean commit and remote SHA verification when push is requested.

Real installed-Visio drawing, visual screenshot review, save/close/reopen native readback, Worker/Visio process termination, and cross-process operation locking remain separate acceptance gates.

## Explicit Non-Goals

- No model-specific templates or model-name routing.
- No change to UGS/GPG/PVP structural authority.
- No browser-supplied native identifiers or coordinates.
- No document/page creation, resizing, replacement, `SaveAs`, close, or Visio quit.
- No claim of atomic COM transactions.
- No automatic retry after an unknown native timeout.
- No publication-aesthetic improvement in this lifecycle slice.
- No claim that unit tests substitute for real Visio acceptance.

## Delivery Sequence

1. Implement and independently review A1.
2. Run a visible real-Visio pre-save/post-save smoke after A1 source gates pass.
3. Implement and independently review A2.
4. Run restart, lost-response, and concurrent-consume tests.
5. Only then consider integration into the formal `agent` branch.
