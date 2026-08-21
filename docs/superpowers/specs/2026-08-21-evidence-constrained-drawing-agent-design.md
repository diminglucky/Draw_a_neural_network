# Evidence-Constrained Drawing Agent: Core Session Design

**Status:** Approved for the first staged implementation slice.

**Supersedes in scope:** Treating a standalone preview compiler, a provider-draft record, or a renderer request as the Agent's drawing state. It does not supersede the UniversalGraphSpec (UGS), General Publication Graph (GPG), PublicationVisualPlan (PVP), Snapshot, or restricted-renderer contracts.

## 1. Product decision

The neural-network drawing Agent must understand an unfamiliar architecture from evidence, not select a known-model template. Its first durable capability is an evidence-constrained drawing session:

```text
typed prompt / static PyTorch source / future sketch observations
  -> bounded evidence and UGS
  -> clarification OR UGS -> GPG -> PVP preview
  -> immutable renderer-neutral session revision and local visual delta
```

An unknown module with explicit ports is drawable as a `custom_operator` or `custom_module`. An unknown model name is never a blocking condition. A topology that cannot be established is a blocking condition and results in exactly one deterministic clarification question. The core Agent does not execute code, control Visio, create a Snapshot, authorize export, use browser geometry, or learn patterns in this slice.

## 2. Why a session is required

`compileUniversalInputToPublicationPreview` safely compiles one input into UGS/GPG/PVP. `FigureDraftService` persists provider-facing revisions, but its confirmation only removes a question: it does not deterministically recompute a preview, bind PVP lineage, or express the visual area that changed. A renderer must never infer those missing facts.

`EvidenceConstrainedDrawingSession` is the single renderer-neutral state object that owns:

- owner/device identity and monotonically increasing session revision;
- input source identifiers and content hashes, never raw prompt text or raw source code;
- canonical UGS and its SHA-256 digest;
- one of `clarification`, `candidate_preview`, or `formal_preview` states;
- deterministic GPG/PVP lineage when a preview exists;
- one optional clarification descriptor and source/evidence-scoped affected UGS IDs;
- a local visual delta between revisions expressed only through existing semantic PVP IDs.

The session is a pure compiler result in this slice. Persistence, HTTP routes, and provider adapters are separate integration work. This makes the first capability deterministic and testable before it becomes durable or controls a renderer.

## 3. Contract

### 3.1 Open request

`openEvidenceConstrainedDrawingSession` accepts only:

```ts
{
  owner: { ownerId: string; deviceId: string },
  input: UniversalPreviewInput,
  detail: "overview" | "architecture" | "operator_detail",
  updateTarget: {
    workflowId: string; documentId: string; pageId: string; expectedRevision: number;
  }
}
```

The service derives the UGS only through the existing typed-prompt or static-PyTorch compiler. It copies no raw `prompt` or `code` into the returned session. `updateIdentity` is derived from the owner plus the bounded update target; callers cannot set a different owner/device inside it.

Each session revision identity is deterministic: a SHA-256 projection of the contract version, owner ID, device ID, canonical UGS digest, detail, and update target. It contains no timestamp or random UUID. Same source facts in the same target produce the same revision-one identity; a different owner, device, target, source digest, detail, or confirmed UGS revision produces a different identity. A confirmation authenticates the preceding revision identity and returns a new one.

For static PyTorch input, the supplied `sourceSha256` must equal SHA-256 of the submitted bytes before analysis begins. Candidate UGS evidence must preserve that same source ID and digest; a synthetic compiler fallback may not replace or weaken user-source provenance.

### 3.2 States and eligibility

| Session state | Condition | PVP | Snapshot/export/renderer authority |
| --- | --- | --- | --- |
| `formal_preview` | UGS has no blocking topology unresolved item and compiled PVP is formal | exact GPG and PVP | none in this slice; `exportEligible` remains `false` |
| `candidate_preview` | UGS has candidate-only structure but no blocking question | exact GPG and candidate PVP | none |
| `clarification` | UGS has a blocking topology unresolved item | absent | none |

`clarification` deliberately does not return a candidate PVP. A blocking topology cannot be converted into a visual guess. The question is chosen by stable UGS-unresolved ID ordering. Its affected IDs are derived only from the unresolved evidence IDs, then sorted by the existing code-unit comparator. The first slice provides a closed response value `confirm-topology-complete`: the user asserts that the submitted topology is complete. It is allowed only for the exact current owner, device, session ID, revision, and question ID.

### 3.3 Confirmation and local update

`confirmEvidenceConstrainedDrawingSession` accepts the current session and a bounded confirmation:

```ts
{
  owner: { ownerId: string; deviceId: string },
  sessionId: string,
  expectedRevision: number,
  questionId: string,
  value: "confirm-topology-complete"
}
```

It rejects a foreign owner/device, stale revision, wrong session/question ID, extra fields, or an unsupported answer. It only resolves the blocking topology fact represented by the selected question. The result receives `revision + 1`, a new revision identity, derives a new UGS revision, and remains renderer-neutral. If another blocking topology fact remains, it returns the next deterministic clarification and still no PVP. Only when no blocking topology fact remains does it recompute GPG/PVP through the shared compiler. For this first bounded confirmation, the affected region is the unresolved evidence's referenced nodes plus any components mapped from those nodes. The returned delta includes only added/removed/changed PVP primitive, connector, annotation, and region IDs; these categories are mutually exclusive and contain no geometry supplied by the caller.

Future question kinds may resolve a candidate merge relation or an edge direction only after their response schema and UGS transformation are separately specified and tested. They must never silently clear an unrelated unresolved fact.

## 4. Security and ownership boundaries

- Input code remains statically parsed only; no source executes.
- The public session result excludes raw prompt text, code, sketch bytes, paths, browser geometry, document-page selectors beyond the bounded update target, provider credentials, Worker/COM commands, and export tokens.
- Session identity and PVP lineage are recomputed from parsed canonical objects, never accepted from a caller.
- Owner/device are checked both at open derivation and confirmation. A confirmation cannot substitute a different `updateIdentity`.
- Clarification and candidate states expose zero Snapshot, export, native intent, Worker, COM, VSDX, or filesystem authority.
- No PatternCandidate or PatternLibrary promotion occurs. A later learning feature receives only user-confirmed, reviewed, owner-scoped structural signatures—not raw sources or unreviewed model output.

## 5. First implementation slice

The initial code introduces `apps/api/src/evidence-constrained-drawing-session.ts` and focused Vitest coverage. It composes existing UGS/GPG/PVP services rather than duplicating their graph or visual grammar. The service returns immutable parsed objects and uses existing canonical SHA-256 helpers.

Covered behavior:

1. a typed prompt with an unknown operator and complete topology creates a stable formal session;
2. provable static PyTorch code creates the same renderer-neutral formal session without execution;
3. a blocking topology creates exactly one clarification and no PVP;
4. the allowed confirmation produces revision two, recomputes a formal PVP, and reports a semantic local delta;
5. ownership, revision, tamper, raw-control-field, and determinism boundaries reject fail-closed.

## 6. Explicit non-goals

This slice does not add sketch OCR/CV, natural-language free-form model extraction, a provider call, a HTTP endpoint, database persistence, PatternLibrary storage, Snapshot creation, trusted QA promotion, export authorization, Visio Worker/COM/VSDX activity, or manual visual acceptance. It is an Agent-core capability foundation, not a claim that the system already produces a real Visio publication figure.

## 7. Acceptance evidence

Before this slice can move from implementation to acceptance, the focused new tests, TypeScript compilation, the full API suite, foundation check, roadmap verification, and diff check must pass. A successful unit suite proves the renderer-neutral core session only. It does not prove professional visual quality, browser rendering, Visio behavior, save/reopen, native readback, or production delivery.
