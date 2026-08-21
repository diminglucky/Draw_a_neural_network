# Universal Neural Drawing Agent Runtime Design

**Status:** Phase 0 design baseline. This document fixes runtime boundaries and migration behavior; it does not implement or accept a runtime capability.

## Purpose and current truth

The product must eventually convert unfamiliar, evidence-backed neural-network inputs into a publication-quality diagram and then apply a bounded update to a user-selected existing Visio page. It is not a VGG-specific generator, a free-text-to-COM bridge, or a generic desktop-control agent.

At this Phase 0 point, no Provider integration, Worker dispatch, Visio mutation, real-host behavior, persistence route, or current-page capability is implemented or accepted. Existing Provider-like interpreter, export, Worker, VGG, and `OpenOrCreate` code remains a compatibility or regression surface only. It must not be represented as a new-runtime acceptance result.

## Canonical chain and authority

All new requests have one canonical lineage:

```text
DrawingIntent
  -> DrawingRun / Coordinator fence
  -> PrivateInputReceipt + private ArtifactStore content handle
  -> EvidencePack
  -> StructuralAssessment
  -> formal UGS | revision-bound clarification | rejection
  -> GPG
  -> formal PVP
  -> sealed execution request
  -> restricted Worker
  -> independent readback and recovery
```

`DrawingRun` is the authoritative state identity for a request. The Coordinator owns owner/device/revision fencing, cancellation, idempotency, durable progression, receipt retention, stale-result discard, and selection of the next stage. It is the only component that can cross the private receipt, evidence, and execution boundaries.

The structural result is terminal before composition unless it is a formal UGS. A candidate, clarification, rejection, cancellation, stale revision, foreign owner/device, or changed target must not mint a PVP, Snapshot, native intent, Worker command, COM operation, page binding, or Visio artifact.

Only the later, formal chain can make an existing-page claim. The roadmap node must declare the structured `capabilities: ["current-page-visio"]` marker; prose in a title, outcome, acceptance item, or next action neither creates nor suppresses this policy. A marked claim must directly depend on formal PVP (`M2.13`), sealed binding (`M3.2`), Worker (`M3.3`), readback/recovery (`M3.4`), and real-host acceptance (`M3.5`). `OpenOrCreate` is never a fallback for a selected existing page.

## Privacy and public-projection fences

`PrivateInputReceipt`, content handles, owner/device/run/revision IDs, paths, source bytes, credentials, Provider transport data, and internal execution records are private. A `ProviderContextReference` is Coordinator-internal and is never transmitted.

If optional interpretation is enabled in a later phase, the Provider receives only a bounded `ProviderContextPayload`: redacted, verified local facts under local tokens. It receives no receipt/context/run/owner/device identifier, raw byte, path, credential, public UGS identifier, renderer control, page target, or native authority. It may return only a local proposal.

The Structural Harness joins local tokens to verified EvidencePack facts, rejects unsupported or ambiguous proposals, canonicalizes structure without Provider local references or input-array order, and alone mints public evidence/node/port/edge identifiers. Every public label, attribute, event, and response is allowlist-projected. Provider text, free-text locators, source fragments, and private identifiers are not public data.

## Compatibility and cutover boundary

Legacy `NetworkIR`, FigureAnalysis, free-text interpretation, preview, draft, Snapshot, export, Worker, VGG bridge, and `OpenOrCreate` pathways retain their documented read compatibility and regression tests during migration. They may adapt an old request into `DrawingIntent` or verified evidence, but may not inject a graph, PVP, page target, native intent, Worker command, or Visio result at a later stage.

New request rollout is explicit and versioned. It begins with the Coordinator path when that path exists; it never silently falls back to a free-text interpreter, legacy preview/export route, VGG bridge, or `OpenOrCreate`. A rollback disables new-route or new-binding selection and returns a controlled unavailable/compatibility response. It does not send a new request through a legacy authority path. Existing saved objects can remain readable through documented adapters until retirement conditions and regression retention are met.

## Phase 0 and Phase 1 scope

Phase 0 records the migration inventory, canonical-chain governance, runtime design, and roadmap validator rules. It leaves `M2.12` active with exactly its established dependencies `M2.8`, `M2.10`, and `M2.11`; it records no acceptance evidence and does not activate or accept a successor platform node.

Phase 1 introduces only pure DrawingRun contracts, reducer behavior, append-only safe events, and allowlisted public projection. It does not introduce a Coordinator, database/artifact store, idempotency store, receipt, EvidencePack, Provider call, Harness, PVP, Snapshot, Worker, COM, Visio, page binding, or real-host behavior. Those require their own later phases and independent evidence.

## Acceptance discipline

Design documents, unit tests, source commits, and legacy fixtures are different kinds of evidence and do not substitute for one another. `M2.12` cannot enter acceptance from test-only results: it requires documented Phase 0–2 predecessor closure and its defined evidence. `M2.13` also requires manual visual review. Existing-page Visio requires the formal predecessor chain, independent readback, save/close/reopen behavior on an explicit target, real-host proof, and manual review.

This document is a compatibility and safety contract. Any implementation that contradicts it must stop and revise the design baseline before expanding runtime authority.
