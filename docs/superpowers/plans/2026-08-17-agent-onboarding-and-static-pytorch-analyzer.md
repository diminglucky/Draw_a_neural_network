# Agent Onboarding and Static PyTorch Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the maintained product branch to `agent`, make the repository self-describing across computers, and add the first non-executing PyTorch source-analysis path that produces evidence-backed Architecture IR v3 for a bounded sequential model.

**Architecture:** Preserve the existing `EvidenceGraph` and `ArchitectureIRv3` validators; add a source analyzer that tokenizes only a deliberately supported Python subset. It retains declared-module and forward-call observations as internal typed observations, while emitting only strict `node_exists`, `node_kind`, and `edge_exists` facts into the evidence graph with stable source locators. A small compiler converts those observations plus validated evidence into strict v3 IR and reports unsupported or dynamic constructs as unresolved evidence rather than inventing structure. Documentation makes this boundary mandatory for any new coding agent.

**Tech Stack:** TypeScript, Node.js, Vitest, Zod, Fastify project conventions, Git/GitHub.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`, renamed to branch `agent`; do not modify the `main` worktree.
- Preserve `docs/superpowers/plans/2026-08-14-graph-message-passing-grammar.md`; it is an unrelated untracked draft.
- Do not execute, import, evaluate, load weights from, or network-access user Python code.
- The analyzer may emit only evidence, structural facts, v3 IR, and unresolved questions; it must not emit drawing coordinates, Visio commands, SVG/XML, scripts, or output paths.
- A non-evidenced, unsupported, or dynamic architecture must remain unresolved and cannot be marked render-ready.
- Keep the five current grammars as legacy/specialized strategies; do not describe them as universal model support.
- Every behavior change follows red → green → refactor and is verified with focused Vitest, `npm run api:test`, `npm run api:check`, and `git diff --check` before commit.

---

### Task 1: Move the maintained branch to `agent` without losing history

**Files:**
- Modify: Git branch metadata only; no tracked project files.

**Interfaces:**
- Consumes: local `codex/commercial-foundation` at `d682bc92ec60bb10572fd64fb1f6447580561e1c`.
- Produces: local and remote branch `agent` at that commit; legacy remote ref remains temporarily as a compatibility pointer.

- [ ] **Step 1: Verify the source ref and worktree boundary**

```powershell
git -C C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation status --short --branch
git -C C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation rev-parse HEAD
git -C C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation rev-parse origin/codex/commercial-foundation
```

Expected: both SHA values equal; only the known untracked GNN plan may exist.

- [ ] **Step 2: Rename the checked-out local branch and publish its new remote name**

```powershell
git -C C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation branch -m agent
git -C C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation push -u origin agent
```

Expected: the worktree tracks `origin/agent`. Do not delete `origin/codex/commercial-foundation` in this task.

- [ ] **Step 3: Verify the ref transition**

```powershell
git -C C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation rev-parse HEAD
git -C C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation rev-parse origin/agent
```

Expected: local and remote commit IDs match.

### Task 2: Add the mandatory cross-computer project entry point

**Files:**
- Create: `docs/START_HERE.md`
- Create: `AGENTS.md`
- Modify: `README.md`
- Test: `apps/api/tests/project-onboarding.test.ts`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-14-universal-neural-figure-compiler-design.md`.
- Produces: short human/agent onboarding documents, linked from the root, with machine-checked required statements.

- [ ] **Step 1: Write the failing contract test**

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFile(resolve(root, path), "utf8");

describe("cross-computer onboarding", () => {
  it("links the required entry point and records the universal-compiler boundaries", async () => {
    const [readme, startHere, agents] = await Promise.all([
      read("README.md"), read("docs/START_HERE.md"), read("AGENTS.md"),
    ]);
    expect(readme).toContain("docs/START_HERE.md");
    expect(startHere).toContain("agent");
    expect(startHere).toContain("P0");
    expect(startHere).toContain("不得将五个 grammar 宣称为通用支持");
    expect(agents).toContain("docs/START_HERE.md");
    expect(agents).toContain("真实 Windows/Visio");
  });
});
```

- [ ] **Step 2: Run the test and verify red**

```powershell
npx vitest run apps/api/tests/project-onboarding.test.ts
```

Expected: FAIL with `ENOENT` for `docs/START_HERE.md` or `AGENTS.md`.

- [ ] **Step 3: Implement the minimal documentation contract**

Create `docs/START_HERE.md` with current branch, honest capability, prohibited claims, P0→P4 order, checkout commands, acceptance gates, and unrelated-change protection. Create `AGENTS.md` requiring future coding agents to read it plus the canonical design before edits. Add a near-top README link to both documents and `git switch agent`.

- [ ] **Step 4: Run the focused green test**

```powershell
npx vitest run apps/api/tests/project-onboarding.test.ts
```

Expected: PASS.

### Task 3: Define the bounded static-PyTorch analyzer contract

**Files:**
- Create: `apps/api/src/static-pytorch-source-analyzer.ts`
- Create: `apps/api/tests/static-pytorch-source-analyzer.test.ts`

**Interfaces:**
- Consumes: `{ sourceId: string; sourceSha256: string; code: string }`.
- Produces: `StaticPyTorchAnalysis` with `evidence: EvidenceGraph`, ordered `modules: DeclaredModuleObservation[]`, `calls: ForwardCallObservation[]`, and `unresolved`.
- Does not consume: a Python interpreter, arbitrary filesystem paths, a provider response, or user-controlled executable code.

- [ ] **Step 1: Write the first failing sequential-model test**

```ts
import { describe, expect, it } from "vitest";
import { analyzeStaticPyTorchSource } from "../src/static-pytorch-source-analyzer.js";

const code = [
  "import torch.nn as nn",
  "class TinyNet(nn.Module):",
  "    def __init__(self):",
  "        self.conv = nn.Conv2d(3, 16, 3)",
  "        self.pool = nn.MaxPool2d(2)",
  "    def forward(self, x):",
  "        x = self.conv(x)",
  "        return self.pool(x)",
].join("\n");

describe("analyzeStaticPyTorchSource", () => {
  it("recovers declared modules and ordered forward calls without executing code", () => {
    const result = analyzeStaticPyTorchSource({ sourceId: "source-tiny", sourceSha256: "a".repeat(64), code });
    expect(result.modules).toMatchObject([
      { id: "conv", constructor: "Conv2d", locator: { line: 4 } },
      { id: "pool", constructor: "MaxPool2d", locator: { line: 5 } },
    ]);
    expect(result.calls).toMatchObject([
      { id: "forward:1", moduleId: "conv", locator: { line: 7 } },
      { id: "forward:2", moduleId: "pool", locator: { line: 8 } },
    ]);
    expect(result.evidence.facts.map((fact) => fact.kind)).toEqual(expect.arrayContaining(["node_exists", "node_kind", "edge_exists"]));
    expect(result.unresolved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify red**

```powershell
npx vitest run apps/api/tests/static-pytorch-source-analyzer.test.ts
```

Expected: FAIL with module-not-found for `static-pytorch-source-analyzer.js`.

- [ ] **Step 3: Implement the minimal non-executing analyzer**

Implement `analyzeStaticPyTorchSource(input)` using only string lines and anchored regular expressions. Recognize `self.<name> = nn.<Constructor>(...)`, assignment calls `self.<name>(<identifier>)`, and direct return calls inside `forward`. Return stable module/call observation IDs in source order, code locators, a static analyzer descriptor, and `parseEvidenceGraph({ version: 2, facts, relations: [] })` containing only valid `node_exists`, `node_kind`, and observed-path `edge_exists` facts. Each accepted architecture fact has the source line's SHA-256 excerpt digest. It must never use `child_process`, `eval`, dynamic import, `Function`, `vm`, Python, or network APIs.

- [ ] **Step 4: Run the focused green test**

```powershell
npx vitest run apps/api/tests/static-pytorch-source-analyzer.test.ts
```

Expected: PASS.

### Task 4: Compile supported source facts into render-gated Architecture IR v3

**Files:**
- Create: `apps/api/src/static-pytorch-ir-compiler.ts`
- Create: `apps/api/tests/static-pytorch-ir-compiler.test.ts`
- Modify: `apps/api/src/static-pytorch-source-analyzer.ts`

**Interfaces:**
- Consumes: `StaticPyTorchAnalysis`.
- Produces: `compileStaticPyTorchToArchitectureIR(analysis, options?): ArchitectureIRv3`.
- Uses: `parseArchitectureIRv3(ir, analysis.evidence, { renderReady })` as its final contract check.

- [ ] **Step 1: Write the failing compiler test**

```ts
import { describe, expect, it } from "vitest";
import { analyzeStaticPyTorchSource } from "../src/static-pytorch-source-analyzer.js";
import { compileStaticPyTorchToArchitectureIR } from "../src/static-pytorch-ir-compiler.js";

describe("compileStaticPyTorchToArchitectureIR", () => {
  it("turns supported sequential calls into evidence-backed ordered v3 nodes", () => {
    const analysis = analyzeStaticPyTorchSource({
      sourceId: "tiny", sourceSha256: "b".repeat(64),
      code: "class N(nn.Module):\n def __init__(self):\n  self.conv = nn.Conv2d(3,16,3)\n def forward(self,x):\n  return self.conv(x)",
    });
    const ir = compileStaticPyTorchToArchitectureIR(analysis);
    expect(ir).toMatchObject({ version: 3, graphId: "pytorch:tiny", unresolved: [] });
    expect(ir.nodes.map((node) => node.id)).toEqual(["input", "conv", "output"]);
    expect(ir.edges.map((edge) => [edge.source.nodeId, edge.target.nodeId])).toEqual([["input", "conv"], ["conv", "output"]]);
  });
});
```

- [ ] **Step 2: Run the test and verify red**

```powershell
npx vitest run apps/api/tests/static-pytorch-ir-compiler.test.ts
```

Expected: FAIL with module-not-found for `static-pytorch-ir-compiler.js`.

- [ ] **Step 3: Implement the compiler and mandatory v3 validation**

Map observed `nn.*` calls to `operator` nodes with typed data input/output ports, add synthetic `input` and `output` nodes, connect calls in forward order, and copy validated `node_exists`, `node_kind`, and `edge_exists` fact IDs to all nodes and edges. Set `graphId` to `pytorch:<sourceId>`. If declarations or call arguments cannot establish one linear flow, emit a blocking unresolved question instead of guessing. Supported linear input must pass `parseArchitectureIRv3(..., { renderReady: true })`.

- [ ] **Step 4: Run both focused green tests**

```powershell
npx vitest run apps/api/tests/static-pytorch-source-analyzer.test.ts apps/api/tests/static-pytorch-ir-compiler.test.ts
```

Expected: PASS.

### Task 5: Fail closed for dynamic source and complete integration proof

**Files:**
- Modify: `apps/api/tests/static-pytorch-source-analyzer.test.ts`
- Modify: `apps/api/tests/static-pytorch-ir-compiler.test.ts`
- Modify: `docs/START_HERE.md`

**Interfaces:**
- Consumes: dynamic or unsupported `forward` source.
- Produces: a blocking unresolved record with source-line evidence; no render-ready IR and no invented branch/merge semantics.

- [ ] **Step 1: Write the failing dynamic-control-flow test**

```ts
it("does not guess a graph for dynamic control flow", () => {
  const analysis = analyzeStaticPyTorchSource({
    sourceId: "dynamic", sourceSha256: "c".repeat(64),
    code: "class N(nn.Module):\n def forward(self,x):\n  if x.sum() > 0:\n   return x\n  return -x",
  });
  expect(analysis.unresolved).toContainEqual(expect.objectContaining({
    severity: "blocking", code: "dynamic-control-flow", locator: { line: 3 },
  }));
  expect(() => compileStaticPyTorchToArchitectureIR(analysis, { renderReady: true })).toThrow(/blocking unresolved/i);
});
```

- [ ] **Step 2: Run the tests and verify red**

```powershell
npx vitest run apps/api/tests/static-pytorch-source-analyzer.test.ts apps/api/tests/static-pytorch-ir-compiler.test.ts
```

Expected: FAIL because no blocking `dynamic-control-flow` unresolved is emitted.

- [ ] **Step 3: Implement the fail-closed detection**

Inside `forward`, recognize `if`, `for`, `while`, `try`, `with`, `match`, `lambda`, `getattr`, `setattr`, `eval`, and `exec` as blocking unresolved static-analysis limits. Keep their locators and `EvidenceRef` values. `EvidenceGraph` has no dynamic-control-flow structural-fact kind, so do not fabricate an unrelated fact merely to obtain an ID. Update `docs/START_HERE.md` to state the first P0 slice supports only declared `nn.*` modules on a linear forward path; branches, Add/Concat, reuse, shapes, repeats, Keras/ONNX, and image understanding remain future work.

- [ ] **Step 4: Run all required verification**

```powershell
npx vitest run apps/api/tests/project-onboarding.test.ts apps/api/tests/static-pytorch-source-analyzer.test.ts apps/api/tests/static-pytorch-ir-compiler.test.ts
npm run api:test
npm run api:check
git diff --check
```

Expected: every command exits 0; focused success does not replace the full suite.

- [ ] **Step 5: Commit the P0 slice and push `agent`**

```powershell
git status --short
git add README.md AGENTS.md docs/START_HERE.md docs/superpowers/plans/2026-08-17-agent-onboarding-and-static-pytorch-analyzer.md apps/api/src/static-pytorch-source-analyzer.ts apps/api/src/static-pytorch-ir-compiler.ts apps/api/tests/project-onboarding.test.ts apps/api/tests/static-pytorch-source-analyzer.test.ts apps/api/tests/static-pytorch-ir-compiler.test.ts
git commit -m "feat: add static PyTorch analysis entry point"
git push
git rev-parse HEAD
git rev-parse origin/agent
```

Expected: only listed paths are staged, the unrelated GNN plan remains unmodified, and local `HEAD` equals `origin/agent`.

## Plan self-review

- Coverage: Task 1 moves the maintained branch; Task 2 fixes cross-machine discovery; Tasks 3–5 deliver the first safe code-to-evidence-to-v3-IR P0 path and its fail-closed boundary.
- Deliberate exclusions: this slice does not claim branch/merge/reuse/shape/repeat analysis, figure components, `ComposableDagFigureCompiler`, real Visio rendering, Keras/ONNX, or image understanding.
- Consistency: module/call observations are internal parser records; every externally consumed structural assertion flows through `EvidenceGraph`; the compiler is the only new v3 producer; v3 validation controls render readiness.
