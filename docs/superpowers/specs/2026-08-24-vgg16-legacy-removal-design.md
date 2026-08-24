# VGG16 Legacy Removal and Universal Drawing Core Design

**Status:** Approved for specification review; implementation is not yet started  
**Date:** 2026-08-24  
**Scope:** Remove all VGG16-specific product code so the Agent has no model-name-driven drawing path. Preserve only generic neural-network analysis and publication-visual infrastructure.

## 1. Decision

The product is a general neural-network figure Agent, not a VGG16 renderer. A user may submit unfamiliar code, a structured description, or a sketch; the Agent must infer network structure and choose a publication visual grammar from structural evidence. A model name, filename, title, fixed layer identifier, or preset must not select a drawing path.

The existing canonical VGG16 bridge is therefore retired in full. It validates a fixed `2/2/3/3/3` convolution repeat sequence, fixed pooling and classifier-tail assumptions, and fixed FC identifiers before producing a Visio Figure Plan. This is a model-specific production executor and must not remain as a compatibility authority, an undocumented fallback, or a test-only route.

## 2. Target architecture

```text
code / structured description / future sketch
  -> safe structural extraction
  -> UniversalGraphSpec (UGS)
  -> semantic annotation and General Publication Graph (GPG)
  -> semantic grammar selection
  -> Publication Visual Plan (PVP)
  -> deterministic SVG/PNG/browser preview
  -> visual QA and human review
  -> future: sealed current-Visio-page incremental adapter
```

Grammar selection may use topology, tensor rank/scale/channel facts when known, operator roles, residual and fusion relations, encoder-decoder relations, and token/attention semantics. It must not use VGG16 or any other model-name special case.

## 3. Deletion boundary

### Delete

1. The canonical VGG16 bridge and its direct snapshot/export chain:
   - `apps/api/src/agent-visio-bridge.ts`;
   - `apps/api/src/agent-visio-execution-snapshot.ts`;
   - the draft-revision `visio-exports` route that creates this snapshot;
   - the corresponding App and `VisioJobRunner` dependencies when no longer referenced.
2. VGG16 preset recognition and construction in `apps/api/src/adapters.ts`.
3. VGG16-only generator, smoke, visible acceptance scripts, and their tests.
4. VGG16-only fixtures, export/bridge/snapshot acceptance tests, and VGG-specific service assertions.
5. VGG16-only implementation plans that document an executable product path, if they are not immutable historical evidence.

### Preserve

1. `UniversalGraphSpec`, `GeneralPublicationGraph`, `GrammarRegistry`, and generic grammars.
2. Publication Visual Plan compiler, SVG/browser preview, Visual QA, and the future sealed generic Visio design boundary.
3. Generic draft, authentication, owner/device, job, and legacy Visio capabilities only where they have a non-VGG consumer.
4. Immutable historical operation history and dated evidence. Historical references are not removed or rewritten; a new retirement record records that the old path is no longer product code.

### Replace instead of delete

Tests that only need a confirmed CNN-shaped graph or a ready figure draft must use a new neutral fixture such as `generic-cnn` or a topology fixture from the universal corpus. The fixture must contain no VGG name, five-stage assumption, FC identifier, preset, or fixed repeat vector.

## 4. Compatibility and API behavior

The removed draft-revision VGG export endpoint must not silently accept non-VGG input or route it through a legacy renderer. It is removed from the runtime API. Callers receive the normal framework `404` until a new general sealed PVP-to-Visio adapter is designed and accepted.

No replacement Visio renderer is introduced in this cleanup. The generic preview pipeline remains the executable drawing product path. The future adapter must consume a sealed, QA-passing PVP, target an already selected/open Visio page and an Agent-owned region, preserve user-created shapes, and never use `OpenOrCreate` as a fallback.

## 5. Safety conditions

- Do not delete or stage unrelated visual-rubric drafts already present in the worktree.
- Do not use broad Git staging, history rewriting, force push, reset, or clean.
- Remove only files and import wiring proven by the VGG dependency audit.
- Re-run an exact reference search after edits; remaining VGG occurrences may exist only in historical evidence or intentional migration/retirement documentation.
- A generic fixture must prove test intent without reproducing the old VGG topology.

## 6. Verification

The cleanup is accepted only if all of the following are true:

1. production `apps/api/src` contains no VGG16 preset, model-name branch, canonical-topology assertion, or VGG-only bridge;
2. the VGG-specific export endpoint and its runtime wiring are absent;
3. focused generic draft/preview and grammar tests pass with neutral fixtures;
4. `npm run api:test`, `npx tsc --noEmit`, `npm run api:check`, `npm run agent:verify-roadmap`, and `git diff --check` pass;
5. the two existing roadmap wording regressions are repaired as part of the test-green baseline, without modifying the user's visual-rubric drafts;
6. the operation history and current roadmap record the retirement accurately and do not claim a general Visio renderer or real-host acceptance.

## 7. Non-goals

- No new model template or VGG-to-generic rename.
- No new Provider, billing, or commercial workflow.
- No sketch OCR implementation.
- No new Visio COM, document lifecycle, or current-page drawing implementation.
- No claim that generic SVG/PNG preview or real Visio drawing is already complete merely because the legacy VGG path has been removed.
