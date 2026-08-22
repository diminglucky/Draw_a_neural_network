# M2.6 UniversalGraphSpec Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M2.6 UniversalGraphSpec contract and deterministic General Publication Graph so any topology-complete unseen network, including unknown named modules, can obtain a professional semantic drawing without a model-name renderer branch.

**Architecture:** Add UGS beside, rather than in-place replacing, `ArchitectureIRv3`. A strict adapter projects validated v3 IR into UGS while preserving source evidence, ports, repeat semantics, modules, and uncertainty. A generic composer converts renderable UGS into an ID-stable, coordinate-free General Publication Graph using topological rank, port order, structural roles, and custom-module primitives; Figure Plan/Snapshot/Worker integration belongs to later M2.5/M3 work.

**Tech Stack:** TypeScript, Zod, Vitest, current `ArchitectureIRv3`, Figure Component contracts, composable DAG compiler conventions.

## Global Constraints

- Work only after the M2.6 ledger node is the current executable focus.
- Do not execute, import, evaluate, or otherwise run user code.
- No model-name switch, fixed VGG IDs, fixed page coordinates, raw Visio instructions, browser actions, paths, or COM fields may enter UGS or General Publication Graph.
- Unknown operation names and opaque modules must use `custom_operator` or `custom_module` and remain drawable when ports/topology are explicit.
- Only topology uncertainty produces candidate status and blocks later formal export; unknown operation names and unknown shape fields do not.
- General Publication Graph is the default professional output for valid UGS, not a fallback after grammar matching fails.
- M2.6 does not modify public export routes, PlanSnapshot binding, PatternLibrary storage, prompt/code/sketch parsing, Worker DTOs, or live Visio sessions.
- Every emitted component and relation must retain stable UGS IDs and evidence IDs; output must be deterministic for equivalent input.

---

## File structure

| File | Responsibility |
|---|---|
| `apps/api/src/universal-graph-spec.ts` | Strict UGS schema, parser, validation result, render/export eligibility calculation. |
| `apps/api/src/universal-graph-spec-adapter.ts` | Lossless v3-to-UGS projection with stable IDs and explicit uncertainty conversion. |
| `apps/api/src/general-publication-graph.ts` | Deterministic UGS-to-General Publication Graph composer; no geometry or renderer commands. |
| `apps/api/tests/fixtures/universal-graph-spec.ts` | Zero-template unknown dual-stream, repeated custom module, and ambiguous topology fixtures. |
| `apps/api/tests/universal-graph-spec.test.ts` | UGS schema, unknown-module, evidence, port, and uncertainty tests. |
| `apps/api/tests/universal-graph-spec-adapter.test.ts` | ArchitectureIRv3 projection preservation tests. |
| `apps/api/tests/general-publication-graph.test.ts` | Generic composition, determinism, custom primitive, repeat, and candidate-region tests. |

## Contract to introduce

```ts
export type UniversalNodeKind = "input" | "output" | "operator" | "custom_operator" | "custom_module" | "container" | "state";
export type UniversalPortDirection = "input" | "output";
export type UniversalEdgeRelation = "data" | "skip" | "merge" | "condition" | "feedback" | "candidate";
export type GraphKnowledge = "proven" | "declared" | "candidate";

export interface UniversalGraphSpec {
  version: 1;
  graphId: string;
  revision: number;
  sourceIds: string[];
  sourceHashes: string[];
  nodes: UniversalNode[];
  ports: UniversalPort[];
  edges: UniversalEdge[];
  groups: UniversalGroup[];
  evidence: UniversalEvidence[];
  topologyConfidence: number;
  unresolved: UniversalUnresolved[];
}

export interface UniversalNode {
  nodeId: string;
  kind: UniversalNodeKind;
  label: string;
  semanticHints: string[];
  inputPortIds: string[];
  outputPortIds: string[];
  attributes: Record<string, string | number | boolean | null>;
  shapeClaim: "proven" | "symbolic" | "unknown";
  operationKnowledge: "known" | "inferred" | "custom";
  evidenceIds: string[];
}

export interface UniversalPort {
  portId: string;
  nodeId: string;
  direction: UniversalPortDirection;
  label: string | null;
  representation: string | null;
  semanticType: string | null;
  evidenceIds: string[];
}
```

`GeneralPublicationGraph` must contain only semantic components, relations, source mappings, candidate regions, and a deterministic `layoutOrder`; it must not contain `x`, `y`, `width`, `height`, color, SVG, Visio, command, path, or Worker fields.

### Task 1: Define test fixtures and observe the missing M2.6 contract

**Files:**

- Create: `apps/api/tests/fixtures/universal-graph-spec.ts`
- Create: `apps/api/tests/universal-graph-spec.test.ts`

**Interfaces:**

- Consumes: `parseUniversalGraphSpec(input: unknown): UniversalGraphSpec`.
- Produces: explicit zero-template behavior for a novel dual-stream custom fusion and a topology-candidate graph.

- [x] **Step 1: Write the unknown dual-stream custom fusion fixture**

  Create a `unknownDualStreamFusionUgs()` fixture with `texture_mixer` and `context_router` custom operators, a `spectral_fusion` custom module, two explicit input ports, one explicit output port, data edges, a stable evidence record per structural claim, and `unresolved: []`. The fixture must not use `vgg`, `resnet`, `unet`, `vit`, fixed canvas values, or model-specific IDs.

- [x] **Step 2: Write the initial UGS behavior tests**

  ```ts
  it("accepts explicit unknown modules as directly renderable structure", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    expect(ugs.nodes.map((node) => node.kind)).toContain("custom_module");
    expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "renderable", export: "eligible" });
  });

  it("keeps ambiguous topology as a candidate and denies export eligibility", () => {
    const input = unknownDualStreamFusionUgs();
    input.edges[1] = { ...input.edges[1], relation: "candidate", knowledge: "candidate" };
    input.unresolved = [{ id: "fusion-target", scope: "topology", severity: "blocking", evidenceIds: ["e-fusion"] }];
    const ugs = parseUniversalGraphSpec(input);
    expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "candidate", export: "ineligible" });
  });
  ```

- [x] **Step 3: Run the focused test and confirm RED**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/universal-graph-spec.test.ts
  ```

  Expected: compilation failure because `universal-graph-spec.js` and its exported contract do not yet exist.

### Task 2: Implement strict UniversalGraphSpec parsing and validation

**Files:**

- Create: `apps/api/src/universal-graph-spec.ts`
- Test: `apps/api/tests/universal-graph-spec.test.ts`

**Interfaces:**

- Consumes: untrusted bounded DTO input.
- Produces: `validateUniversalGraphSpec`, `parseUniversalGraphSpec`, and `getUniversalGraphEligibility`.

- [x] **Step 1: Define Zod schemas with strict object keys and bounded counts**

  Use version `1`; accept at most 256 nodes, 1,024 ports, 2,048 edges, 128 groups, 512 evidence records, and 64 unresolved records. Require unique node, port, edge, group, and evidence IDs. Require every node port reference to be owned by that node and match its direction; require every edge to join an output port to an input port.

- [x] **Step 2: Encode the three uncertainty classes**

  Implement eligibility exactly as:

  ```ts
  export function getUniversalGraphEligibility(ugs: UniversalGraphSpec) {
    const topologyCandidate = ugs.edges.some((edge) => edge.relation === "candidate" || edge.knowledge === "candidate")
      || ugs.unresolved.some((item) => item.scope === "topology" && item.severity === "blocking");
    return topologyCandidate
      ? { preview: "candidate" as const, export: "ineligible" as const }
      : { preview: "renderable" as const, export: "eligible" as const };
  }
  ```

  Do not make `operationKnowledge: "custom"` or `shapeClaim: "unknown"` alter this result.

- [x] **Step 3: Add validation tests for invalid port ownership and unsupported free geometry**

  ```ts
  expect(() => parseUniversalGraphSpec({ ...unknownDualStreamFusionUgs(), nodes: [{ ...unknownDualStreamFusionUgs().nodes[0], inputPortIds: ["other-node:in"] }] })).toThrow(/port|owner/i);
  expect(() => parseUniversalGraphSpec({ ...unknownDualStreamFusionUgs(), layout: { x: 1 } })).toThrow(/unrecognized|unknown/i);
  ```

- [x] **Step 4: Run the focused test and confirm GREEN**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/universal-graph-spec.test.ts
  ```

  Expected: all UGS schema, evidence, unknown-module, and candidate-topology tests pass.

### Task 3: Project existing ArchitectureIRv3 to UGS without losing evidence or module boundaries

**Files:**

- Create: `apps/api/src/universal-graph-spec-adapter.ts`
- Create: `apps/api/tests/universal-graph-spec-adapter.test.ts`

**Interfaces:**

- Consumes: `ArchitectureIRv3` validated by `parseArchitectureIRv3`.
- Produces: `projectArchitectureIrV3ToUniversalGraphSpec(ir: ArchitectureIRv3): UniversalGraphSpec`.

- [x] **Step 1: Write the preservation test first**

  ```ts
  const source = cnnGoldIr();
  source.nodes[1] = { ...source.nodes[1], semanticRole: "spectral_mixer" };
  const ugs = projectArchitectureIrV3ToUniversalGraphSpec(parseArchitectureIRv3(source));
  expect(ugs.nodes.find((node) => node.nodeId === "operator")).toMatchObject({
    kind: "custom_operator",
    operationKnowledge: "custom",
    evidenceIds: ["evidence-main"],
  });
  expect(ugs.ports).toEqual(expect.arrayContaining([
    expect.objectContaining({ portId: "operator:in", direction: "input" }),
    expect.objectContaining({ portId: "operator:out", direction: "output" }),
  ]));
  ```

- [x] **Step 2: Run the adapter test and confirm RED**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/universal-graph-spec-adapter.test.ts
  ```

  Expected: compilation failure because the adapter module is absent.

- [x] **Step 3: Implement the pure projection**

  Map `input`, `output`, `module`, `operator`, `merge`, `split`, `attention`, `repeat`, `process`, and `adapter` into UGS node kinds and semantic hints. Map v3 module membership into UGS groups. Preserve all edge endpoint port IDs and evidence IDs. Map v3 blocking unresolved questions into UGS topology unresolved only when their conflict key concerns connectivity, merge type, or edge direction; map other uncertainty to operation/shape scope without revoking preview eligibility.

- [x] **Step 4: Run the adapter test and existing v3 contract tests**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/universal-graph-spec-adapter.test.ts apps/api/tests/network-ir-v3.test.ts
  ```

  Expected: adapter fixtures pass and existing v3 validation remains unchanged.

### Task 4: Compose a deterministic General Publication Graph

**Files:**

- Create: `apps/api/src/general-publication-graph.ts`
- Create: `apps/api/tests/general-publication-graph.test.ts`

**Interfaces:**

- Consumes: `composeGeneralPublicationGraph(ugs: UniversalGraphSpec, intent: { detail: "overview" | "architecture" | "operator_detail" }): GeneralPublicationGraph`.
- Produces: coordinate-free components using `input`, `output`, `generic_module`, `custom_operator`, `custom_module`, `split`, `merge_add`, `merge_concat`, `custom_fusion`, `repeat_badge`, and `candidate_region` roles.

- [x] **Step 1: Write zero-template composition tests**

  ```ts
  const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
  const first = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  const second = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  expect(first).toEqual(second);
  expect(first.components).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: "custom_operator", sourceNodeIds: ["texture_mixer"] }),
    expect.objectContaining({ role: "custom_module", sourceNodeIds: ["spectral_fusion"] }),
    expect.objectContaining({ role: "custom_fusion", sourceNodeIds: ["spectral_fusion"] }),
  ]));
  expect(JSON.stringify(first)).not.toMatch(/\b(x|y|width|height|visio|svg|command|path)\b/i);
  ```

- [x] **Step 2: Add repeat and candidate-region fixtures**

  The repeated custom-block fixture must produce one stable `repeat_badge` with `count: 3` and retain all member node IDs. The ambiguous topology fixture must produce a `candidate_region`, preserve confirmed subgraph components, and expose `exportEligibility: "ineligible"`.

- [x] **Step 3: Implement deterministic ordering and role selection**

  Derive stable topological rank from proven/declared non-feedback edges; sort ties by canonical node ID. Pick `custom_operator` or `custom_module` from UGS kind, never from model name. Pick merge roles only from proven/declared explicit relation/semantic hints; otherwise emit `custom_fusion`. Emit candidate regions without inventing a connector for candidate edges.

- [x] **Step 4: Run the graph composer tests**

  Run:

  ```powershell
  npm run api:test -- apps/api/tests/general-publication-graph.test.ts apps/api/tests/universal-graph-spec.test.ts apps/api/tests/universal-graph-spec-adapter.test.ts
  ```

  Expected: unknown modules directly compose, repeat is stable, ambiguous topology is candidate-only, and identical input produces byte-identical semantic graph output.

### Task 5: Close M2.6 automated implementation evidence without overclaiming export

**Files:**

- Modify: `docs/agent-governance/implementation-records/current-roadmap.md`
- Modify: `docs/agent-governance/operation-history/2026-08.jsonl`

**Interfaces:**

- Consumes: focused and full test output.
- Produces: factual M2.6 implementation status, explicitly retaining M2.5/M3 as unimplemented.

- [x] **Step 1: Run full API and roadmap checks**

  Run:

  ```powershell
  npm run api:check
  npm run api:test
  npm run agent:verify-roadmap -- --strict
  git diff --check
  ```

  Expected: all commands pass; no R1 change alters the public legacy VGG export route.

- [x] **Step 2: Record only demonstrated evidence**

  State whether M2.6 is still `in_progress` or awaiting review from actual tests. Do not mark M2.6 accepted without a narrow commit, a final independent review, zero-template visual review, generic snapshot binding, and real Visio evidence. Append one relative-path-only operation event.

- [ ] **Step 3: Commit only with renewed user authorization**

  If and only if requested, stage a narrow allowlist of the new UGS/composer sources, fixtures, tests, record, history, baseline, and this plan. Do not use `git add .`, and do not include unrelated uncommitted R0 or design documents without explicit review.

## Plan self-review

- **Spec coverage:** all M2.6 requirements are covered: universal graph, evidence and ports, unknown modules, topology candidates, deterministic professional semantic graph, and zero-template fixtures.
- **Scope boundary:** generic Snapshot, export eligibility enforcement, PatternLibrary, input parsers, Worker changes, and live Visio acceptance are intentionally deferred to their mapped ledger nodes.
- **Type consistency:** UGS IDs are stable strings; ports are globally referenced by `portId`; relations preserve source/target port IDs; graph components retain `sourceNodeIds` and evidence mappings.
