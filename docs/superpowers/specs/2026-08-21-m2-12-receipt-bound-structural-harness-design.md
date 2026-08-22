# M2.12 Receipt-Bound Structural Harness Design

**Status:** Owner-approved architecture revision, amended after independent design audit. This is a design baseline and an implementation prerequisite; it does not claim that replacement contracts, Provider integration, Visio behavior, persistence, or Git delivery exist.

**Decision:** M2.12 replaces the free-text public-evidence / Provider-controlled-identity prototype. It is not an independent pipeline: it is the structural phase of the platform sequence `DrawingRun -> Coordinator -> Receipt/EvidencePack -> Structural Harness -> session adapter`. The compatibility interpreter remains regression-only until that sequence is accepted.

## 1. Problem and scope

The old prototype accepts caller/Provider-controlled `sourceId` and `locator` text and copies Provider node, port, and edge IDs into UGS. That makes public safety depend on an evolving reject-list and makes untrusted output influence stable artifact identity.

M2.12 may produce exactly one of these structural results:

- a formal canonical UGS;
- one deterministic blocking clarification plus candidate UGS; or
- a safe structural rejection.

It does not execute source; create a PVP for a candidate or blocking topology; create Snapshot/export work; bind a page; call Worker/COM/Visio; persist raw input in public state; or grant a Provider tool/native authority. Only a formal UGS can be passed to the later visual-composition phase.

## 2. Required predecessor boundary

M2.12 implementation cannot begin until the following platform phases have accepted contracts:

1. `DrawingRun` reducer and public projection (owner, device, run, revision, state transition, safe trace);
2. Coordinator/store/idempotency/cancellation contract (including stale asynchronous result discard);
3. receipt intake and EvidencePack contract.

Receipt retention is therefore a storage-policy input to the Coordinator, not a permission for M2.12 to introduce another database, cache, or file store. Before the durable Coordinator exists, only logical ephemeral receipt fixtures are permitted. `owner_revision` retention is implemented solely by the Coordinator-owned ArtifactStore.

## 3. Authority model

| Component | May create | Must not create or receive |
|---|---|---|
| Intake | private receipt metadata and content handle | public evidence, UGS, PVP, native intent |
| Analyzer/declaration adapter | verified facts and EvidencePack | public IDs, native intent, Provider payload from raw bytes |
| Coordinator | internal context reference, redacted Provider payload, timeout/cancellation fence | topology, public IDs, PVP, native work |
| Provider | local structural proposal referring to local fact tokens | receipt/context IDs, public IDs, page target, Worker/native command |
| Structural Harness | public evidence projection, canonical IDs, formal UGS / clarification / rejection | source execution, PVP, Worker/Visio request |
| Session/route adapter | allowlisted projection of a run result | a second UGS from raw input, receipt, context, or Provider output |

## 4. Contract separation

```ts
export interface PrivateInputReceipt {
  receiptId: string;
  ownerId: string;
  kind: "typed_text" | "pytorch_source" | "architecture_description" | "sketch";
  sha256: string;
  byteLength: number;
  mimeType: string | null;
  retention: "ephemeral" | "owner_revision";
}

/** Internal Coordinator-only reference. It is never sent to a Provider or public DTO. */
export interface ProviderContextReference {
  contextId: string;
  runId: string;
  ownerId: string;
  deviceId: string;
  expectedRevision: number;
  evidencePackHash: string;
  allowedPurpose: "architecture_interpretation";
  expiresAt: string;
}

/** The sole payload sent to an untrusted Provider. */
export interface ProviderContextPayload {
  version: 1;
  allowedPurpose: "architecture_interpretation";
  facts: readonly ProviderFactPayload[];
  maxCharacters: number;
}

export interface ProviderFactPayload {
  localFactRef: `fact:f:${number}`;
  sourceKind: "static_analysis" | "typed_declaration" | "architecture_fact" | "sketch_observation";
  summary: string;
  confidence: number | null;
}

export interface PublicEvidenceReference {
  evidenceId: `evidence:e:${number}`;
  sourceKind: "static_analysis" | "typed_declaration" | "architecture_fact" | "sketch_observation";
  sourceHash: string;
  locatorKind: "section" | "fact" | "observation" | "derived";
  locatorOrdinal: number;
  excerptDigest: string;
}

export interface InterpreterLocalProposal {
  version: 2;
  nodes: readonly InterpreterLocalNode[];
  ports: readonly InterpreterLocalPort[];
  edges: readonly InterpreterLocalEdge[];
  unresolved: readonly InterpreterLocalUnresolved[];
}

export interface ArchitectureInterpreter {
  propose(input: ProviderContextPayload): Promise<InterpreterLocalProposal>;
}
```

`PrivateInputReceipt`, raw bytes, content handles, `ProviderContextReference`, and Provider credentials are internal-only. A Provider gets neither a receipt ID nor a context ID. Every Provider evidence relation uses a `localFactRef`; the Harness alone maps it to a verified EvidencePack fact and later mints a public evidence ID.

## 5. Public-text and evidence policy

Provider-local references, raw source, paths, filenames, URI-like text, credentials, native controls, and hidden topology cannot become public through any field. This includes labels, operations, attributes, representations, semantic hints, unresolved descriptions, UGS, GPG, PVP, browser DTOs, trace events, and error text.

The Harness owns `PublicDisplayText` projection. Each public text value must be either a closed semantic vocabulary item or a normalized, bounded declaration-derived label with verified fact coverage. It has a defined maximum length and rejects controls, paths, source-like fragments, credentials, URLs, markup, and undeclared free-form attributes. A Provider may suggest a local label but that suggestion is never copied verbatim into a public artifact.

Verified evidence is canonicalized before IDs are minted. Its unique key is:

```text
(sourceKind, sourceHash, locatorKind, locatorOrdinal, excerptDigest)
```

Facts with the same key deduplicate. Facts with the same `(sourceKind, sourceHash, locatorKind, locatorOrdinal)` but a different digest are conflicting evidence and yield a rejection or blocking clarification; they do not receive order-dependent IDs. The Harness sorts by the full unique key, then mints `evidence:e:1...`.

## 6. Canonical structural formalization

1. Coordinator validates owner/device/run/revision, digest, size, MIME, source kind, retention, and cancellation fence; intake creates a private receipt metadata record and content handle.
2. A deterministic adapter creates an EvidencePack of verified facts. The Coordinator derives an internal context reference and a bounded `ProviderContextPayload` only if policy permits optional interpretation.
3. The Provider may return only a strict `InterpreterLocalProposal`. Unknown fields, capacity overflow, unknown local fact tokens, control payloads, and invalid local relationships are rejected before projection.
4. The Harness joins local fact tokens only to verified EvidencePack facts. It never joins a Provider ID directly to a public ID.
5. The Harness canonicalizes evidence first. It then assigns each node an initial semantic/evidence fingerprint and repeatedly refines it from sorted incoming/outgoing relation, port-direction, operation-kind, and neighbor fingerprints until stable.
6. The Harness serializes each connected component with the refinement fingerprint, canonical port/edge signatures, and canonical evidence IDs. Provider local references and input-array positions are forbidden as sort keys. If two structurally indistinguishable nodes remain where distinct public identity would change semantics, the result is a blocking clarification rather than an arbitrary tie-break.
7. In the resulting canonical order the Harness mints `node:n:*`, `port:p:*`, and `edge:e:*`, rewrites all references, projects safe display text, and performs UGS validation: reachability, direction, merge arity, residual lanes, cross-attention roles, evidence coverage, and confidence requirements.
8. A complete graph produces `{ kind: "formal", ugs, ugsHash, evidencePackHash }`. An incomplete graph produces `{ kind: "clarification", candidateUgs, candidateUgsHash, clarification, evidencePackHash }`, where clarification is bound to the run/owner/device/revision by the Coordinator. Otherwise it produces `{ kind: "rejected", errorCategory }`.

Equivalent local proposals must produce the same UGS hash after array permutation and complete local-reference renaming. Non-isomorphic proposals must not share a canonical serialization. A clarification never receives a PVP, native intent, Worker request, or Visio authority.

## 7. Compatibility, cutover, and rollback

The old `architecture-interpretation-contract.ts`, `evidence-augmented-ugs-harness.ts`, and `evidence-augmented-ugs-interpreter.ts` are compatibility-only. Their negative tests remain regression fixtures. No new route, Provider adapter, visual feature, PVP compiler, page binding, or Visio work may import them.

The Phase 0 migration inventory must identify every old compiler/session/route entry point, its replacement, default state, retirement condition, and rollback behavior. Phase 5 introduces a versioned Coordinator-backed route while leaving legacy response semantics untouched. The new route is enabled only after replacement focused tests pass; it rolls back by disabling route selection, never by routing a new request through a legacy interpreter. Compatibility removal occurs only after all callers consume `StructuralAssessment` and regression evidence is retained.

## 8. Acceptance criteria

M2.12 is eligible for `awaiting_acceptance` only when all of the following are recorded:

- Provider internal reference and transmitted payload are distinct types; the payload contains no receipt/context/run/owner/device IDs, source bytes, paths, or public UGS IDs;
- receipt creation, EvidencePack lineage, retention ownership, owner/device/revision fencing, timeout, cancellation, and stale-result discard are proved through the platform predecessors;
- public text and public evidence projection are allowlisted; no raw source/image, path, credential, Provider local reference, free-text locator, or unsafe label reaches UGS/PVP/session/route/trace;
- evidence canonicalization, duplicate/conflict handling, graph canonicalization, local-ref renaming, array reordering, and isomorphic-branch cases produce the specified result;
- malformed, ambiguous, dynamic, unsupported, stale, cancelled, or unsafe proposals yield rejection or one deterministic clarification before PVP/native authority;
- formal-only composition is proved: candidate/blocking/rejected outcomes create no PVP, Snapshot, export, Worker, COM, or Visio work;
- compatibility behavior remains green through adapters, a versioned cutover has no default legacy fallback, and focused/full regression, strict TypeScript, independent review, implementation record, and resolvable commit are present.

M2.12 is not Provider-quality acceptance, publication-visual acceptance, Visio acceptance, or real-host lifecycle acceptance. Those remain later phase gates.
