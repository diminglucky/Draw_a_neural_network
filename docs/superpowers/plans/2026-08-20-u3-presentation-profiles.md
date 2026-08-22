# U3 Presentation Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, semantic, zero-template Presentation Profiles that improve a General PublicationVisualPlan without changing its UGS/GPG topology, IDs, eligibility, or source mappings.

**Architecture:** The existing compiler remains the sole generator of the General PVP. A registry evaluates only canonical UGS/GPG facts, selects sorted compatible profile overlays, and applies them atomically to a cloned General PVP. Every matching overlay records stable provenance; a malformed or conflicting overlay discards the whole profile set and returns the exact General fallback PVP.

**Tech Stack:** TypeScript, Vitest, canonical JSON/SHA-256 helpers already used by the PVP compiler, browser SVG preview.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on branch `agent`.
- Preserve and do not stage the five pre-existing governance drafts shown by `git status --short`.
- A Profile must not mutate or alter UGS nodes, ports, edges, evidence, knowledge, topology confidence, GPG membership/interfaces, repeat count, source mapping, UGS/GPG IDs, or `formal`/`candidate` eligibility.
- Profile selection must be semantic and structural; model/family-name dispatch is forbidden.
- Unsupported, missing, malformed, conflicting, or non-deterministic Profile output must return the exact canonical General PVP, not reject a valid graph.
- The browser remains a PVP projection only: it may not calculate topology or geometry.
- Every production behavior begins with a focused failing Vitest test, followed by the smallest passing implementation.
- Do not add Visio Worker, COM, export routes, billing, Keras/ONNX input support, or PatternLibrary work in U3.

---

## File structure

- `apps/api/src/presentation-profile.ts`: Profile contracts, immutable match/application values, semantic helpers, overlay validation.
- `apps/api/src/presentation-profile-registry.ts`: Deterministic built-in profile selection and atomic fallback behavior.
- `apps/api/src/publication-visual-plan-compiler.ts`: General-PVP-then-overlay integration and profile lineage hash.
- `apps/api/tests/presentation-profile.test.ts`: Contract/invariance tests for individual semantic Profile matches.
- `apps/api/tests/presentation-profile-registry.test.ts`: Determinism, conflict, malformed-result, and exact-fallback tests.
- `apps/api/tests/publication-visual-plan-compiler.test.ts`: Compiler provenance and no-topology-change integration tests.
- `apps/api/tests/publication-visual-plan-zero-template.test.ts`: Unknown-family fixture matrix expectations, QA, SVG, and profile fallback proof.
- `docs/superpowers/plans/2026-08-20-u3-presentation-profiles.md`: This execution record.

### Task 1: Establish the Presentation Profile contract and deterministic registry seam

**Files:**
- Create: `apps/api/src/presentation-profile.ts`
- Create: `apps/api/src/presentation-profile-registry.ts`
- Test: `apps/api/tests/presentation-profile.test.ts`
- Test: `apps/api/tests/presentation-profile-registry.test.ts`

**Interfaces:**
- Consumes: `UniversalGraphSpec`, `GeneralPublicationGraph`, `PublicationVisualPlan`, and `digestGenericPlanSnapshotValue`.
- Produces: `PresentationProfile`, `PresentationProfileMatch`, `PresentationProfileApplication`, `applyPresentationProfiles(input)`.

- [ ] **Step 1: Write a failing contract test for a structural-only match**

```ts
it("matches residual structure without inspecting the graph name", () => {
  const result = applyPresentationProfiles({ ugs, graph, plan: generalPlan });

  expect(result.applications.map((item) => item.profileId)).toEqual(["residual-branch"]);
  expect(result.plan.sourceMappings).toEqual(generalPlan.sourceMappings);
  expect(result.plan.eligibility).toEqual(generalPlan.eligibility);
});
```

- [ ] **Step 2: Run the test to verify it fails because the module is absent**

Run: `npx vitest run apps/api/tests/presentation-profile.test.ts`

Expected: FAIL with an unresolved `presentation-profile` import.

- [ ] **Step 3: Define the minimal public contracts and application record**

```ts
export interface PresentationProfileApplication {
  readonly applicationId: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly affectedIds: readonly string[];
}

export interface PresentationProfile {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly match(input: PresentationProfileInput): PresentationProfileMatch | null;
  readonly apply(input: PresentationProfileInput, match: PresentationProfileMatch): PresentationProfileOverlay;
}
```

- [ ] **Step 4: Implement a registry that sorts by `profileId`, rejects duplicate IDs, and returns the unchanged plan for no match**

```ts
export function applyPresentationProfiles(input: PresentationProfileInput): PresentationProfileResult {
  const matches = profiles.map((profile) => ({ profile, match: profile.match(input) }))
    .filter((item): item is { profile: PresentationProfile; match: PresentationProfileMatch } => item.match !== null)
    .sort((left, right) => compareCodeUnits(left.profile.profileId, right.profile.profileId));
  return matches.length === 0 ? { plan: input.plan, applications: [] } : applyAtomically(input, matches);
}
```

- [ ] **Step 5: Run the focused contract and registry tests**

Run: `npx vitest run apps/api/tests/presentation-profile.test.ts apps/api/tests/presentation-profile-registry.test.ts`

Expected: PASS.

### Task 2: Make overlay validation and fallback fail closed

**Files:**
- Modify: `apps/api/src/presentation-profile.ts`
- Modify: `apps/api/src/presentation-profile-registry.ts`
- Test: `apps/api/tests/presentation-profile-registry.test.ts`

**Interfaces:**
- Consumes: profile overlay patches and the unprofiled General PVP.
- Produces: atomic `PresentationProfileResult` whose fallback `plan` is the same PVP object supplied by the compiler.

- [ ] **Step 1: Write failing tests for duplicate ownership, an unknown primitive, and malformed profile output**

```ts
it.each([duplicateProfile, unknownPrimitiveProfile, malformedProfile])("falls back exactly when %s is invalid", (profile) => {
  const result = applyPresentationProfiles({ ugs, graph, plan: generalPlan, profiles: [profile] });
  expect(result).toEqual({ plan: generalPlan, applications: [] });
});
```

- [ ] **Step 2: Run the registry test to verify it fails before validation exists**

Run: `npx vitest run apps/api/tests/presentation-profile-registry.test.ts`

Expected: FAIL because invalid overlays are accepted or the exact fallback is unavailable.

- [ ] **Step 3: Implement immutable overlay validation**

```ts
function validateOverlay(base: PublicationVisualPlan, overlay: PresentationProfileOverlay): void {
  assertOnlyKnownPrimitiveIds(base, overlay.primitiveStyleTokenIds);
  assertOnlyKnownConnectorIds(base, overlay.connectorStyleTokenIds);
  assertUnchangedTopology(base, overlay);
  assertSortedUniqueIds(overlay.affectedIds, "Profile affectedIds");
}
```

- [ ] **Step 4: Apply all overlays to a cloned draft, then call `createPublicationVisualPlan`; catch all profile errors and return the untouched `base`**

```ts
try {
  const draft = structuredClone(input.plan);
  for (const item of matches) validateAndMerge(draft, item);
  return { plan: createPublicationVisualPlan(draft), applications };
} catch {
  return { plan: input.plan, applications: [] };
}
```

- [ ] **Step 5: Run focused fallback tests**

Run: `npx vitest run apps/api/tests/presentation-profile-registry.test.ts`

Expected: PASS.

### Task 3: Implement semantic profile families and their visual-only overlays

**Files:**
- Modify: `apps/api/src/presentation-profile-registry.ts`
- Test: `apps/api/tests/presentation-profile.test.ts`

**Interfaces:**
- Consumes: UGS relation kinds, component roles, node attributes, node/port fan-in/fan-out, and repeat metadata.
- Produces: built-in `spatial-scale`, `residual-branch`, `encoder-decoder`, `dual-tower-fusion`, and `repeat-collapse` Profile applications.

- [ ] **Step 1: Add one failing table-driven test per structural family**

```ts
it.each([
  [unknownCustomSpatialBackboneUgs, "spatial-scale"],
  [unknownResidualMultiBranchUgs, "residual-branch"],
  [unknownMultiScaleEncoderDecoderUgs, "encoder-decoder"],
  [unknownDualTowerCrossModalFusionUgs, "dual-tower-fusion"],
  [unknownRepeatedFusionStackUgs, "repeat-collapse"],
])("selects %s by graph semantics", (fixture, expectedId) => {
  expect(profileIdsFor(fixture())).toContain(expectedId);
});
```

- [ ] **Step 2: Run the table test and verify profile IDs are initially absent**

Run: `npx vitest run apps/api/tests/presentation-profile.test.ts`

Expected: FAIL with missing expected Profile applications.

- [ ] **Step 3: Implement constrained structural predicates and style-only overlays**

```ts
const residualBranchProfile = profile("residual-branch", input => hasSplitMergeOrSkip(input.graph), match => ({
  primitiveStyleTokenIds: match.componentIds.map((id) => [primitiveId(id), ["profile:residual-branch"]]),
  connectorStyleTokenIds: match.relationIds.map((id) => [connectorId(id), ["profile:residual-flow"]]),
  affectedIds: [...match.componentIds, ...match.relationIds],
}));
```

- [ ] **Step 4: Add only declared profile style tokens and validate every resulting PVP with `createPublicationVisualPlan`**

```ts
styleTokens: {
  tokenSetVersion: "pvp-style-1",
  tokens: [{ tokenId: "profile:residual-branch", role: "primitive", values: { stroke: "#1d4ed8" } }],
}
```

- [ ] **Step 5: Run semantic Profile tests**

Run: `npx vitest run apps/api/tests/presentation-profile.test.ts apps/api/tests/presentation-profile-registry.test.ts`

Expected: PASS.

### Task 4: Compile Profile provenance into canonical PVP lineage without changing general topology

**Files:**
- Modify: `apps/api/src/publication-visual-plan-compiler.ts`
- Test: `apps/api/tests/publication-visual-plan-compiler.test.ts`

**Interfaces:**
- Consumes: exact General PVP created by the existing compiler body and registry result.
- Produces: profile-enhanced PVP with `profileApplications` and `lineage.profileSetHash`; otherwise returns the exact unprofiled PVP.

- [ ] **Step 1: Write a failing compiler test for deterministic provenance**

```ts
expect(first.profileApplications).toEqual(second.profileApplications);
expect(first.lineage.profileSetHash).not.toBe(digestGenericPlanSnapshotValue([]));
expect(first.sourceMappings).toEqual(general.sourceMappings);
expect(first.ports).toEqual(general.ports);
expect(first.connectors.map((item) => item.connectorId)).toEqual(general.connectors.map((item) => item.connectorId));
```

- [ ] **Step 2: Run the compiler test to verify profile provenance is not yet generated**

Run: `npx vitest run apps/api/tests/publication-visual-plan-compiler.test.ts`

Expected: FAIL because `profileApplications` is empty and the profile-set hash is the empty-set hash.

- [ ] **Step 3: Split `compilePublicationVisualPlan` into `compileGeneralPublicationVisualPlan` plus a final profile registry call**

```ts
const generalPlan = compileGeneralPublicationVisualPlan({ ugs, graph: canonicalGraph, updateIdentity: input.updateIdentity });
return applyPresentationProfiles({ ugs, graph: canonicalGraph, plan: generalPlan }).plan;
```

- [ ] **Step 4: Build `profileSetHash` from the canonical sorted application records before the final `createPublicationVisualPlan` call**

```ts
draft.lineage.profileSetHash = digestGenericPlanSnapshotValue(applications);
draft.profileApplications = applications;
```

- [ ] **Step 5: Run compiler tests**

Run: `npx vitest run apps/api/tests/publication-visual-plan-compiler.test.ts`

Expected: PASS.

### Task 5: Prove zero-template fallback, PVP QA, and browser exact-PVP rendering

**Files:**
- Modify: `apps/api/tests/publication-visual-plan-zero-template.test.ts`
- Modify: `apps/api/tests/publication-visual-plan-compiler.test.ts`
- Test: `apps/client/publication-visual-plan-preview.test.js`

**Interfaces:**
- Consumes: all unknown-family fixture creators and the browser PVP projection function.
- Produces: regression evidence for deterministic styled PVPs, generic fallback, preserved candidate state, structural QA, and SVG source identity.

- [ ] **Step 1: Write failing fixture assertions for profile use and forced generic fallback**

```ts
expect(plan.profileApplications).toHaveLength(1);
expect(evaluatePublicationVisualPlanQa(plan).status).toBe("passed");
expect(renderPublicationVisualPlanPreview(response)).toContain(`data-pvp-primitive="${plan.primitives[0].primitiveId}"`);

expect(forcedFallback.profileApplications).toEqual([]);
expect(forcedFallback.identity.canonicalHash).toBe(general.identity.canonicalHash);
```

- [ ] **Step 2: Run matrix tests and verify the new expectations fail before integration is complete**

Run: `npx vitest run apps/api/tests/publication-visual-plan-zero-template.test.ts apps/client/publication-visual-plan-preview.test.js`

Expected: FAIL only at Profile provenance/fallback assertions.

- [ ] **Step 3: Add candidate-state assertions that matching presentation has no eligibility authority**

```ts
expect(candidate.profileApplications.length).toBeGreaterThanOrEqual(0);
expect(candidate.eligibility).toMatchObject({ kind: "candidate", qaStatus: "pending" });
expect(evaluatePublicationVisualPlanQa(candidate).status).toBe("failed");
```

- [ ] **Step 4: Run focused visual pipeline checks**

Run: `npx vitest run apps/api/tests/publication-visual-plan-zero-template.test.ts apps/client/publication-visual-plan-preview.test.js apps/api/tests/publication-visual-plan-qa.test.ts`

Expected: PASS.

### Task 6: Verify, inspect, and deliver the exact change set

**Files:**
- Modify: only files listed in Tasks 1–5 plus this plan.

- [ ] **Step 1: Run TypeScript compilation**

Run: `npx tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 2: Run all API tests and foundation policy check**

Run: `npm run api:test && npm run api:check`

Expected: all tests pass and the policy check exits 0.

- [ ] **Step 3: Inspect whitespace and the intended diff only**

Run: `git diff --check; git status --short; git diff -- apps/api/src/presentation-profile.ts apps/api/src/presentation-profile-registry.ts apps/api/src/publication-visual-plan-compiler.ts apps/api/tests/presentation-profile.test.ts apps/api/tests/presentation-profile-registry.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts apps/api/tests/publication-visual-plan-zero-template.test.ts docs/superpowers/plans/2026-08-20-u3-presentation-profiles.md`

Expected: no whitespace errors; the five pre-existing governance drafts remain outside the staged allowlist.

- [ ] **Step 4: Commit only the exact allowlist after fresh successful verification**

```powershell
git add -- apps/api/src/presentation-profile.ts apps/api/src/presentation-profile-registry.ts apps/api/src/publication-visual-plan-compiler.ts apps/api/tests/presentation-profile.test.ts apps/api/tests/presentation-profile-registry.test.ts apps/api/tests/publication-visual-plan-compiler.test.ts apps/api/tests/publication-visual-plan-zero-template.test.ts docs/superpowers/plans/2026-08-20-u3-presentation-profiles.md
git commit -m "feat(agent): add deterministic presentation profiles"
```

- [ ] **Step 5: Re-check local/remote ancestry before any user-requested push**

Run: `git status --short --branch; git fetch origin agent; git rev-parse HEAD; git rev-parse origin/agent`

Expected: report actual SHA relationship; do not force-push and do not push unless requested.

## Plan self-review

- **Coverage:** Tasks 1–2 cover contracts, determinism, atomic invalid/conflict fallback, and immutability. Task 3 covers the five first semantic families. Task 4 binds profile provenance into the canonical PVP. Task 5 verifies zero-template fixtures, formal/candidate eligibility, structural QA, and browser projection. Task 6 covers type, full test, policy, whitespace, diff scope, and precise Git staging.
- **No placeholders:** Checked for `TBD`, `TODO`, and vague implementation steps; each code-changing step specifies a target interface or code fragment and each test step has an exact command.
- **Consistency:** `profileApplications` and `lineage.profileSetHash` are generated only by the registry integration; the registry accepts UGS, GPG, and the unprofiled PVP and never changes UGS/GPG.
