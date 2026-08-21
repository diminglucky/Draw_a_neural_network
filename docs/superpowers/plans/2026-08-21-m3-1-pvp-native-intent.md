# M3.1 PVP Native Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile a formal server-created `PublicationVisualPlan` into a deterministic, renderer-neutral native-shape intent that a later sealed Visio Worker path can consume.

**Architecture:** A new pure TypeScript mapper reparses the PVP, verifies its existing renderer-capability contract, rejects candidate and unsupported visual primitives, and produces only allowlisted shape and connector intents in the original PVP document-unit coordinate space. The module does not call COM, create a job, read a path, seal bytes, or reuse legacy `figureSet`/VGG DTOs; those concerns remain behind M3.2 onward.

**Tech Stack:** TypeScript ESM, existing PVP parser/compiler/QA contracts, Vitest.

## Global Constraints

- Consume only `PublicationVisualPlan`; never consume raw prompt, source code, sketch bytes, browser SVG, legacy Figure Plan, VGG DTO, output path, URL, COM parameter, or Worker command.
- Reject candidate PVP and PVP primitives or connectors outside the explicit native-intent allowlist.
- Preserve PVP plan hash, update identity, stable primitive IDs, stable connector IDs, anchored routes, style-token references, and source-safe ownership metadata.
- Preserve document-unit geometry; inches, Visio shapes, document/page sessions, applyDiff, persistence, native readback, save/reopen, cancellation, and human review are out of scope.
- Do not expose this mapper through an HTTP route or existing export service in M3.1.

---

### Task 1: Define the M3.1 native-intent contract with failing tests

**Files:**

- Create: `apps/api/tests/publication-visual-plan-native-intent.test.ts`
- Verify: `apps/api/tests/fixtures/universal-graph-spec.ts`

**Consumes:** Zero-template UGS fixtures and `compilePublicationVisualPlan`.

**Produces:** Tests that specify deterministic output, an explicit shape/connector allowlist, immutable PVP identity metadata, and rejection of candidate or unsupported PVP input.

- [x] **Step 1: Write the failing test for a formal zero-template PVP.**

```ts
const first = compilePublicationVisualPlanToNativeIntent(plan);
const second = compilePublicationVisualPlanToNativeIntent(plan);
expect(first).toEqual(second);
expect(first).toMatchObject({
  protocolVersion: "pvp-native-intent-1",
  planId: plan.identity.planId,
  planHash: plan.identity.canonicalHash,
});
expect(first.primitives.every((item) => ["terminal", "module", "split", "merge-add", "merge-concat", "repeat-badge"].includes(item.nativeKind))).toBe(true);
```

- [x] **Step 2: Add rejection tests.** Create a candidate PVP and a canonical PVP whose first primitive is changed to `ArbitraryVisioCom`. Assert the mapper throws before it produces an intent.

- [x] **Step 3: Run the focused test and verify the missing module failure.**

Run: `npx vitest run apps/api/tests/publication-visual-plan-native-intent.test.ts`

Expected: FAIL because `publication-visual-plan-native-intent.js` does not exist.

### Task 2: Implement the pure PVP-to-native-intent mapper

**Files:**

- Create: `apps/api/src/publication-visual-plan-native-intent.ts`
- Test: `apps/api/tests/publication-visual-plan-native-intent.test.ts`

**Consumes:** `parsePublicationVisualPlan`, `assertPublicationVisualPlanRendererCapabilities`, PVP ports/connectors/primitives, and stable code-unit ordering.

**Produces:** `compilePublicationVisualPlanToNativeIntent(input: PublicationVisualPlan): PublicationVisualNativeIntent`.

- [x] **Step 1: Parse and gate the PVP.** Require `eligibility.kind === "formal"`, require `native-text`, `orthogonal-route`, and `shape-data` capabilities, and reject malformed values using the existing parser.

- [x] **Step 2: Map primitives with a closed allowlist.** Map `Input` and `Output` to `terminal`, `GenericModule`, `CustomOperator`, and `CustomModule` to `module`, `Split` to `split`, `MergeAdd` to `merge-add`, `MergeConcat` and `CustomFusion` to `merge-concat`, and `RepeatBadge` to `repeat-badge`. Each output retains only PVP IDs, component ID, label, bounds, style-token IDs, and fixed PVP ownership metadata.

- [x] **Step 3: Map connectors with a closed allowlist.** Map `flow`, `skip`, `merge`, and `condition` relations to their matching native connection kinds; reject all others. Resolve source and target primitive IDs through PVP ports, retain the canonical route and style-token IDs, and attach only fixed PVP ownership metadata.

- [x] **Step 4: Freeze the resulting intent and run focused tests.**

Run: `npx vitest run apps/api/tests/publication-visual-plan-native-intent.test.ts && npx tsc --noEmit`

Expected: PASS.

### Task 3: Record the M3.1 evidence boundary and run regression checks

**Files:**

- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`
- Modify: `docs/agent-governance/operation-history/2026-08.jsonl`
- Modify: `docs/agent-program-state.json`

**Consumes:** The focused mapper test result and source contract.

**Produces:** An M3.1 governance record that distinguishes local native-intent proof from sealed export, native Visio, lifecycle, and real-host acceptance. The strict roadmap state accepts evidence entries only after an authorized, resolvable commit; uncommitted local evidence belongs in the implementation record and append-only operation history.

- [x] **Step 1: Record M3.1 mapper evidence without changing its status to accepted.** Reference the new source, test, and this plan in the implementation record; leave `M3.1` active because M3.2–M3.5 remain unimplemented. Keep state evidence empty until an authorized, resolvable commit exists.

- [x] **Step 2: Append a JSONL operation-history event.** Use `commit: null` until an authorized commit exists and state that the mapper is not a COM or real-host result.

- [x] **Step 3: Run focused and full checks.**

Run: `npm run agent:render-roadmap && npm run agent:verify-roadmap && npx vitest run apps/api/tests/publication-visual-plan-native-intent.test.ts && npx tsc --noEmit && npm run api:test && npm run api:check && git diff --check`

Expected: all commands exit 0; none demonstrates real Visio acceptance.
