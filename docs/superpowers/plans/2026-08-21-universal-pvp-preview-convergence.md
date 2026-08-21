# Universal PVP Preview Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route typed prompt declarations and static PyTorch source through the single UGS → GPG → PVP compilation path and expose a bounded, renderer-neutral preview DTO.

**Architecture:** A pure input-compilation service selects an already-approved input adapter, then delegates topology composition to `PublicationVisualPreviewService`. A separate pure projection maps the canonical PVP and GPG into an allowlisted preview DTO. Neither component creates snapshots, export jobs, Worker calls, COM calls, renderer commands, or file paths.

**Tech Stack:** TypeScript, Vitest, existing UGS/GPG/PVP modules.

## Global Constraints

- Treat unknown operators and modules with declared/provable ports as drawable custom structures; never branch on a model name or template.
- Never execute, import, instantiate, or dynamically evaluate submitted Python.
- Any blocking unresolved item yields `candidate`, `exportEligible: false`, and creates no snapshot/export/Worker side effect.
- Do not modify the existing `/api/figure-analyses` route, the sealed-export payload, Worker protocol, COM bridge, or Visio lifecycle in this slice.
- Public preview data must not include prompt text, Python source, source locators/excerpts, absolute paths, Worker/COM controls, renderer command data, or arbitrary user-supplied fields.
- Preserve existing uncommitted U3 visual-rubric drafts and the current M2.8/M2.10 adapter files.

---

### Task 1: Universal input compilation service

**Files:**
- Create: `apps/api/src/universal-input-compilation-service.ts`
- Create: `apps/api/tests/universal-input-compilation-service.test.ts`

**Interfaces:**
- Consumes: `compilePromptToUniversalGraphSpec`, `compileStaticPyTorchSourceToUniversalGraphSpec`, and `PublicationVisualPreviewService`.
- Produces: `compileUniversalInputToPublicationPreview(input, options)` returning a discriminated `formal | candidate` result with the canonical UGS, GPG, and PVP.

- [ ] **Step 1: Write the failing test**

```ts
const result = compileUniversalInputToPublicationPreview(
  { kind: "typed-prompt", sourceId: "prompt-1", prompt: completeDeclaration },
  { detail: "architecture", updateIdentity },
);
expect(result.kind).toBe("formal");
expect(result.ugs.nodes.some((node) => node.kind === "custom_operator")).toBe(true);
```

Add a static-PyTorch test that verifies a provable forward path is formal without executing source, plus an ambiguous-input test that is candidate and `exportEligible: false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- apps/api/tests/universal-input-compilation-service.test.ts`

Expected: FAIL because `universal-input-compilation-service.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type UniversalPreviewInput =
  | { kind: "typed-prompt"; sourceId: string; prompt: string; revision?: number }
  | { kind: "static-pytorch"; sourceId: string; sourceSha256: string; code: string };

export function compileUniversalInputToPublicationPreview(
  input: UniversalPreviewInput,
  options: { detail: "overview" | "architecture" | "operator_detail"; updateIdentity: PublicationVisualPlanUpdateIdentity },
): UniversalInputPublicationPreview {
  const ugs = input.kind === "typed-prompt"
    ? compilePromptToUniversalGraphSpec(input)
    : compileStaticPyTorchSourceToUniversalGraphSpec(input);
  const preview = new PublicationVisualPreviewService().preview({ ugs, ...options });
  return { ...preview, ugs };
}
```

The public union must keep `candidate` export-ineligible and must not invoke any export, snapshot, Worker, COM, renderer, or filesystem function.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run api:test -- apps/api/tests/universal-input-compilation-service.test.ts`

Expected: PASS with all tests in the file green.

### Task 2: Safe PVP preview projection

**Files:**
- Create: `apps/api/src/publication-visual-plan-preview.ts`
- Create: `apps/api/tests/publication-visual-plan-preview.test.ts`

**Interfaces:**
- Consumes: a canonical `PublicationVisualPlan` plus its `GeneralPublicationGraph`.
- Produces: `projectPublicationVisualPlanPreview({ graph, pvp })`, a renderer-neutral allowlisted DTO suitable for a future versioned route.

- [ ] **Step 1: Write the failing test**

```ts
const preview = projectPublicationVisualPlanPreview({ graph, pvp });
expect(preview).toMatchObject({ schemaVersion: 1, kind: "formal" });
expect(JSON.stringify(preview)).not.toContain("prompt text");
expect(preview).not.toHaveProperty("updateIdentity");
expect(preview).not.toHaveProperty("sourceMappings");
```

Add a candidate case that retains only bounded component/connector preview data and always reports `exportEligible: false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- apps/api/tests/publication-visual-plan-preview.test.ts`

Expected: FAIL because `publication-visual-plan-preview.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function projectPublicationVisualPlanPreview(input: {
  graph: GeneralPublicationGraph;
  pvp: PublicationVisualPlan;
}): PublicationVisualPlanPreview {
  const plan = parsePublicationVisualPlan(input.pvp);
  return {
    schemaVersion: 1,
    kind: plan.eligibility.kind,
    exportEligible: plan.eligibility.kind === "formal" && plan.eligibility.qaStatus === "passed",
    plan: allowlistedPlanFields(plan),
    graph: allowlistedGraphFields(input.graph),
  };
}
```

Allowlist only plan identity, eligibility, coordinate space, regions, groups, primitives, ports, connectors, annotations, legend, style tokens, and profile applications. For graph data allowlist version, graph ID, detail, export eligibility, components, relations, and layout order. Exclude all source/evidence mappings and update identity.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run api:test -- apps/api/tests/publication-visual-plan-preview.test.ts`

Expected: PASS with all tests in the file green.

### Task 3: Integration regression and quality gates

**Files:**
- Create: `apps/api/tests/universal-pvp-preview-convergence.test.ts`

**Interfaces:**
- Consumes: both Task 1 and Task 2 public functions.
- Produces: a regression proof that formal unknown structures and candidate ambiguity remain safely separated through the same universal path.

- [ ] **Step 1: Write the failing test**

```ts
const compiled = compileUniversalInputToPublicationPreview(formalUnknownModule, options);
const publicPreview = projectPublicationVisualPlanPreview(compiled);
expect(publicPreview.kind).toBe("formal");
expect(publicPreview.plan.primitives).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: "CustomOperator" }),
]));
```

Add the corresponding ambiguous input assertion: `kind === "candidate"` and `exportEligible === false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- apps/api/tests/universal-pvp-preview-convergence.test.ts`

Expected: FAIL before Task 1 and Task 2 are both implemented.

- [ ] **Step 3: Implement only fixture/setup code needed by the regression**

Use the actual Task 1 and Task 2 functions; do not add a route or invoke export/Worker/COM code.

- [ ] **Step 4: Run focused and repository quality checks**

Run:

```powershell
npm run api:test -- apps/api/tests/universal-input-compilation-service.test.ts apps/api/tests/publication-visual-plan-preview.test.ts apps/api/tests/universal-pvp-preview-convergence.test.ts
npx tsc --noEmit
npm run api:check
git diff --check
```

Expected: all commands exit 0.

## Verification Matrix

- Formal typed declaration with an unknown operator becomes a formal PVP preview through one shared path.
- Provable static PyTorch becomes a formal PVP preview without executing source.
- Ambiguous prompt or dynamic PyTorch becomes candidate only and cannot be export eligible.
- The public DTO contains no raw prompt/source, evidence mappings, update identity, Worker/COM controls, paths, or arbitrary fields.
- No existing route/export/Worker/COM code changes in this slice.
