# v3 Publication Visual Quality Design

**Status:** Approved direction for implementation after user confirmation of a stable, complete implementation
**Date:** 2026-08-18
**Scope:** M2.3 of the `agent` branch: a versioned, server-side, fail-closed visual-quality boundary for v3 composable figure plans.

## 1. Decision summary

M2.3 will not extend the legacy v2 `visual-qa.ts` contract and will not put visual validation inside the M2.2 topology compiler. The implementation introduces a v3 publication-plan boundary with three explicit responsibilities:

1. `ComposableDagFigureCompiler` remains responsible for deterministic semantic DAG layout and routing.
2. A v3 publication-plan builder adds deterministic visual tokens, label geometry, and evidence-index continuity without accepting Provider text, file paths, SVG/XML, or Worker commands.
3. A pure v3 Visual QA validator checks geometry, routing, source mappings, style safety, grayscale distinction, scale, and label readability. Any blocking issue returns a failed QA result and cannot become a PlanSnapshot.

The first implementation remains server-side and artifact-independent. It validates the structured plan; it does not claim browser screenshot comparison, human visual review, real Visio output, or native readback. Those remain M2.9/M3 acceptance gates.

## 2. Existing boundaries to preserve

- M2.1 `FigureComponentGraph` remains the semantic component contract.
- M2.2 `ComposableDagFigurePlan` remains the deterministic topology/layout output.
- v2 `PublicationFigurePlanV2` and its `visual-qa.ts` validator remain compatibility-only.
- `candidate_structure` must never invoke the publication compiler, create a PlanSnapshot, issue an export token, or create a Worker Job.
- The v3 plan must not contain Provider content, raw user source, absolute paths, shell/PowerShell/VBA/COM instructions, arbitrary SVG/XML, or Worker protocol fields.
- Visual QA must be deterministic for the same input plan, visual specification, evidence index, and validation version.
- Visual QA must not mutate its input.

## 3. v3 publication-plan contract

M2.3 adds a wrapper rather than changing the meaning of the M2.2 topology plan:

```ts
type ComposableDagPublicationPlan = {
  version: 1;
  dagPlan: ComposableDagFigurePlan;
  visualSpec: ComposableDagVisualSpec;
  evidenceIndex: ArchitectureIRv3["evidenceIndex"];
  qaVersion: string;
};
```

`dagPlan` is produced by the existing M2.2 compiler. `visualSpec` is deterministic and derived only from the validated semantic plan and `FigureIntent`; it never uses model/provider prose to choose arbitrary coordinates or commands. `evidenceIndex` is copied from the validated v3 IR so source mappings can be checked without exposing source content.

The minimum visual specification is:

```ts
type ComposableDagVisualSpec = {
  page: {
    background: string;
    minMargin: number;
    minFontSizePt: number;
    minContrastRatio: number;
  };
  componentStyles: Record<string, {
    fill: string;
    stroke: string;
    grayscalePattern: "solid" | "stripe" | "dot" | "hatch" | "none";
  }>;
  connectionStyles: Record<string, {
    stroke: string;
    grayscalePattern: "solid" | "dash" | "dot" | "double";
    thickness: number;
  }>;
  labels: Array<{
    id: string;
    semanticId: string;
    text: string;
    bounds: FigureBounds;
    fontSizePt: number;
  }>;
};
```

All identifiers are bounded stable identifiers. Text is bounded, single-line, and is not executable content. Colors are normalized bounded CSS hex values; arbitrary CSS, URLs, data URIs, XML, and scripts are rejected.

## 4. Visual QA contract

The validator exposes one pure entry point:

```ts
function runComposableDagVisualQa(
  input: ComposableDagPublicationPlan,
): VisualQaResult;
```

It returns the existing snapshot-compatible result shape:

```ts
type VisualQaResult = {
  status: "pass" | "fail";
  checks: Array<{
    id: string;
    severity: "blocking" | "warning";
    passed: boolean;
    message: string;
  }>;
};
```

Checks are evaluated in stable identifier order and are grouped into the following families.

### 4.1 Geometry and page safety

- all page values are finite and positive where required;
- all component bounds are finite, positive, and inside page bounds;
- every component respects the configured minimum page margin;
- component collisions are rejected unless a future explicit overlap policy allows them;
- labels are finite, positive, inside page bounds, and respect the minimum margin;
- label bounds do not overlap each other or their owning component in an unsafe way;
- scale and density stay within bounded plan limits.

### 4.2 Connection and route safety

- every connection references an existing component and declared port;
- route points are finite and inside page bounds;
- route has at least two points;
- first and last route points touch the declared source and target bounds;
- zero-length or detached routes are rejected;
- connection style exists for the connection transport/kind;
- route diagnostics identify the connection ID and endpoint IDs.

### 4.3 Evidence and source mapping

- every component has at least one semantic/evidence mapping when the source IR requires it;
- every connection mapping resolves against `evidenceIndex`;
- no mapping references an unknown evidence ID;
- no evidence payload or source excerpt is returned in the QA result;
- all mapping failures are blocking and deterministic.

### 4.4 Contrast and grayscale safety

- background and foreground colors parse as bounded hex colors;
- required component text/stroke contrast meets `minContrastRatio`;
- connection styles remain distinguishable in grayscale by pattern or thickness;
- component styles that collapse to the same grayscale role are rejected when their semantic roles differ;
- unsupported or missing style tokens are blocking.

### 4.5 Result semantics

- one or more blocking failures produce `status: "fail"`;
- warnings never allow a blocking failure to pass;
- a passing result contains no failed blocking check;
- validation does not mutate the publication plan;
- result ordering is stable for byte-identical inputs.

## 5. Integration boundaries

M2.3 will provide the plan builder and validator, but will not create a new public preview route. The later `UniversalPreviewService` integration will consume the v3 publication plan and pass the `VisualQaResult` into `createPlanSnapshot`.

The required state transition is:

```text
validated Architecture IR v3
  -> ComposableDagFigurePlan
  -> ComposableDagPublicationPlan
  -> runComposableDagVisualQa
  -> pass only
  -> later PlanSnapshot
```

For a blocking unresolved IR:

```text
candidate_structure
  -> visible unresolved result
  -> no publication plan
  -> no Visual QA pass
  -> no PlanSnapshot
  -> no export authorization
```

M2.3 must not silently repair invalid geometry, missing mappings, or unsafe styles. The caller must receive a structured failure and fix the upstream plan or ask for a new revision.

## 6. Test strategy

Tests are test-first and cover:

1. a valid CNN publication plan passes;
2. residual, encoder-decoder, and token-transformer plans pass through the same validator;
3. component overflow fails;
4. component collision fails;
5. label overflow and label collision fail;
6. detached route endpoints fail;
7. out-of-page route points fail;
8. invalid component/port references fail;
9. missing or unknown evidence mapping fails;
10. invalid colors and missing style tokens fail;
11. insufficient contrast fails;
12. grayscale-colliding relation styles fail;
13. non-finite geometry fails;
14. blocking unresolved input cannot produce a publication plan;
15. the validator does not mutate the input;
16. identical inputs produce identical results and diagnostics.

The focused suite must pass before the full API suite, strict TypeScript, foundation boundary, roadmap verification, and diff check. M2.3 evidence must record the exact implementation commit and commands. It must not claim browser screenshot QA, human visual review, real Provider calls, or real Windows/Visio acceptance.

## 7. Non-goals

- No v2/v3 union type in the legacy visual QA module.
- No browser or Electron preview route in M2.3.
- No SVG/PNG rasterization or pixel-level comparison in M2.3.
- No automatic semantic repair of invalid plans.
- No Keras, ONNX, image understanding, GNN, Provider, billing, or Visio COM work.
- No PlanSnapshot persistence or export-job creation in this milestone.

## 8. Exit criteria

M2.3 is ready for acceptance only when:

1. the v3 publication-plan and Visual QA contracts are implemented;
2. all blocking cases above have focused regression tests;
3. valid gold fixtures pass through one common validator;
4. `npm run api:test` passes;
5. `npx tsc --noEmit` passes;
6. `npm run api:check` passes;
7. `npm run agent:verify-roadmap` passes;
8. `git diff --check` passes;
9. the M2.3 evidence document identifies the exact commit and separately states that browser/manual/real-host gates remain unaccepted;
10. the roadmap state is updated only after the evidence and implementation commit are present.
