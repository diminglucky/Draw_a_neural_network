# M2.6 Generic Publication Figure Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile a topology-complete UniversalGraphSpec and its General Publication Graph into a deterministic, evidence-traceable, renderer-neutral Figure Plan, completing the missing bridge before M2.5 snapshot binding.

**Architecture:** A new pure compiler accepts only a validated UGS and matching semantic graph. It derives bounded document-unit geometry from the graph's published `layoutOrder`, then emits strict semantic primitives, connectors, and source mappings. Candidate topology and feedback reject formal plan creation. It does not call a Worker, browser, Visio, SVG renderer, COM API, or user code.

**Tech Stack:** TypeScript, Zod, Vitest, UniversalGraphSpec, GeneralPublicationGraph.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on branch `agent`.
- Never execute, import, instantiate, or network-run user code.
- No model-name branch, VGG ID, raw source, Visio/COM/Worker/browser/path/command/renderer field may enter UGS, General Publication Graph, or the new Figure Plan.
- Unknown custom operators/modules remain drawable when ports and topology are explicit; an unseen name alone never creates candidate status.
- Candidate edges, blocking topology unresolved items, and feedback reject a formal Figure Plan and later snapshot/export eligibility.
- Geometry exists only in the Figure Plan; it is compiler-derived, finite, bounded, deterministic document units, never free user geometry or Visio commands.
- Every primitive/connector retains stable component, node, edge, and evidence identifiers. Equivalent input must produce byte-identical output.
- Do not modify legacy VGG bridge/export routes, legacy snapshot types, public routes, PatternLibrary, input parsers, Worker DTOs, or live Visio sessions.

---

## File structure

| File | Responsibility |
|---|---|
| `apps/api/src/general-publication-figure-plan.ts` | Strict plan parser and pure generic compiler. |
| `apps/api/tests/general-publication-figure-plan.test.ts` | Unknown-module, determinism, geometry, evidence, and rejection tests. |
| `docs/agent-program-state.json` | Factual M2.6 review status and next action. |
| `docs/agent-governance/implementation-records/current-roadmap.md` | Implementation boundary and fresh evidence. |
| `docs/agent-governance/operation-history/2026-08.jsonl` | One append-only relative-path-only event. |

## Contract to introduce

```ts
export interface GeneralPublicationFigurePlan {
  version: 1;
  graphId: string;
  detail: "overview" | "architecture" | "operator_detail";
  sourceGraphHash: string;
  page: { width: number; height: number; margin: number };
  primitives: Array<{
    primitiveId: string;
    role: GeneralPublicationComponentRole;
    label: string;
    bounds: { left: number; top: number; width: number; height: number };
    sourceComponentIds: string[];
    sourceNodeIds: string[];
    sourceEdgeIds: string[];
    evidenceIds: string[];
  }>;
  connectors: Array<{
    connectorId: string;
    role: "flow" | "skip" | "merge" | "condition";
    sourceRelationIds: string[];
    fromPrimitiveId: string;
    toPrimitiveId: string;
    evidenceIds: string[];
  }>;
  sourceMappings: Array<{ primitiveId: string; sourceComponentIds: string[]; sourceNodeIds: string[]; sourceEdgeIds: string[]; evidenceIds: string[] }>;
}

export function compileGeneralPublicationFigurePlan(input: {
  ugs: UniversalGraphSpec;
  graph: GeneralPublicationGraph;
}): GeneralPublicationFigurePlan;
```

`sourceGraphHash` is SHA-256 over canonical JSON of the exact General Publication Graph. Page/primitives must have finite bounds with `0 < width,height <= 10_000`; parse validation is strict and rejects extra fields. Compilation is permitted only when UGS is `renderable/eligible`, graph export eligibility is `eligible`, no candidate region is present, and no UGS feedback edge exists.

### Task 1: Establish strict Figure Plan contract

**Files:**

- Create: `apps/api/src/general-publication-figure-plan.ts`
- Create: `apps/api/tests/general-publication-figure-plan.test.ts`

**Interfaces:**

- Consumes: `UniversalGraphSpec`, `GeneralPublicationGraph`, `composeGeneralPublicationGraph`.
- Produces: `compileGeneralPublicationFigurePlan` and `parseGeneralPublicationFigurePlan`.

- [x] **Step 1: Write the failing unknown-module contract test**

```ts
it("creates a deterministic renderer-neutral plan for a complete unknown-module graph", () => {
  const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  const first = compileGeneralPublicationFigurePlan({ ugs, graph });
  const second = compileGeneralPublicationFigurePlan({ ugs, graph });
  expect(first).toEqual(second);
  expect(first.primitives).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: "custom_operator", sourceNodeIds: ["texture_mixer"] }),
    expect.objectContaining({ role: "custom_module", sourceNodeIds: ["spectral_fusion"] }),
  ]));
  expect(JSON.stringify(first)).not.toMatch(/\b(visio|svg|com|worker|command|path|sourceBytes)\b/i);
});
```

- [x] **Step 2: Prove RED**

Run: `npm run api:test -- apps/api/tests/general-publication-figure-plan.test.ts`

Expected: compilation failure because `general-publication-figure-plan.js` is absent.

- [x] **Step 3: Implement the parser and minimal compiler**

Use Zod `.strict()` object schemas and public role unions. `parseGeneralPublicationFigurePlan` accepts only plan data; it requires stable IDs, bounded labels/mappings, SHA-256 `sourceGraphHash`, finite page/bounds, and non-empty source/evidence mappings. `compileGeneralPublicationFigurePlan` starts by creating a strict, frozen plan containing deterministic source mappings and a canonical SHA-256; it must never accept a free-geometry input.

- [x] **Step 4: Prove GREEN**

Run: `npm run api:test -- apps/api/tests/general-publication-figure-plan.test.ts`

Expected: the unknown-module contract passes.

### Task 2: Compile generic rank/lane geometry and semantic connectors

**Files:**

- Modify: `apps/api/src/general-publication-figure-plan.ts`
- Modify: `apps/api/tests/general-publication-figure-plan.test.ts`

**Interfaces:**

- Consumes: `graph.layoutOrder`, components, relations, and matching UGS eligibility.
- Produces: bounded primitive bounds and one connector per formal relation.

- [x] **Step 1: Write failing layout/mapping tests**

```ts
it("maps rank/lane order to stable bounds and traceable formal connectors", () => {
  const plan = compileKnownFixture();
  expect(plan.primitives.every((item) => item.bounds.width > 0 && item.bounds.height > 0)).toBe(true);
  expect(plan.connectors).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: "flow", sourceRelationIds: ["relation:input-to-texture"] }),
  ]));
  expect(plan.sourceMappings).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceNodeIds: ["texture_mixer"], evidenceIds: ["e-texture"] }),
  ]));
});
```

- [x] **Step 2: Prove RED**

Run: `npm run api:test -- apps/api/tests/general-publication-figure-plan.test.ts`

Expected: the initial compiler lacks rank/lane bounds and formal connector output.

- [x] **Step 3: Implement deterministic geometry**

Derive each formal component's bounds only from `layoutOrder.rank` and `layoutOrder.order`. Use local constants `MARGIN=72`, `COLUMN_GAP=96`, `LANE_GAP=32`, `BASE_WIDTH=144`, `BASE_HEIGHT=72`. Sort emitted primitives by `primitiveId`; page extents are maximum primitive right/bottom plus margin and are capped at `10_000`. Build connectors only for `flow`, `skip`, `merge`, and `condition` relations whose primitive endpoints exist. Candidate regions use the union of referenced formal primitive bounds plus `24` padding only after Task 3 permits preview-only plan mode; this formal compiler must reject candidates instead.

- [x] **Step 4: Prove GREEN**

Run: `npm run api:test -- apps/api/tests/general-publication-figure-plan.test.ts`

Expected: stable bounds, connectors, and evidence mappings pass.

### Task 3: Enforce topology and feedback fail-closed rules

**Files:**

- Modify: `apps/api/tests/general-publication-figure-plan.test.ts`
- Modify: `apps/api/src/general-publication-figure-plan.ts`

**Interfaces:**

- Consumes: candidate edge, blocking unresolved, and feedback UGS fixtures.
- Produces: rejection before a formal Figure Plan value can exist.

- [x] **Step 1: Write failing rejection tests**

```ts
it.each(["candidate-edge", "blocking-topology", "feedback"])("rejects %s before formal planning", (kind) => {
  const { ugs, graph } = ineligibleFixture(kind);
  expect(() => compileGeneralPublicationFigurePlan({ ugs, graph })).toThrow(/eligible|candidate|feedback/i);
});
```

- [x] **Step 2: Prove RED**

Run: `npm run api:test -- apps/api/tests/general-publication-figure-plan.test.ts`

Expected: any ineligible fixture currently accepted causes this test to fail.

- [x] **Step 3: Implement guards before all layout work**

Reject UGS candidate/blocked topology, graph `ineligible`, every candidate-region component, and every feedback edge. Return only stable semantic reason text; never include source text, paths, or commands.

- [x] **Step 4: Prove GREEN with predecessor tests**

Run: `npm run api:test -- apps/api/tests/universal-graph-spec.test.ts apps/api/tests/general-publication-graph.test.ts apps/api/tests/general-publication-figure-plan.test.ts`

Expected: all predecessor and Figure Plan tests pass.

### Task 4: Record proven state and keep M2.6 open for independent review

**Files:**

- Modify: `docs/agent-program-state.json`
- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`
- Modify: `docs/agent-governance/operation-history/2026-08.jsonl`

- [x] **Step 1: Run fresh verification**

Run: `npm run api:check`, `npm run api:test`, `npm run agent:verify-roadmap -- --strict`, and `git diff --check`.

Expected: every command exits `0`; no legacy VGG export route changed.

- [x] **Step 2: Append only demonstrated evidence**

Record actual test counts and revision after commit. Keep M2.6 `in_progress` or `awaiting_review`; explicitly leave generic public preview, immutable generic snapshot, Worker DTO, Visio applyDiff, save/reopen/readback, and host acceptance unimplemented.

- [ ] **Step 3: Commit after every task review is clean**

Stage only this compiler, its tests, the top-level `layoutOrder` correction, this plan, and governance files with an exact allowlist. Run `git diff --cached --check`; never use broad staging, force push, or move tag `0.0.5`.

## Plan self-review

- **Spec coverage:** this fills the required UGS → General Publication Graph → Figure Plan bridge before M2.5.
- **Scope:** snapshot persistence, routes, Worker, Visio lifecycle, PatternLibrary, and prompt/code/sketch parsing remain outside this plan.
- **Type consistency:** geometry starts only in Figure Plan and never flows backward into UGS or General Publication Graph.
