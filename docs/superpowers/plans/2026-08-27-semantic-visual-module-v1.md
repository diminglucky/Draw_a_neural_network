# Semantic Visual Module V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立与渲染器无关、可审计、确定性规范化的 Semantic Architecture Graph，使未知网络的模块能表达数据形态、内部算子、状态、重复和 typed relation，而不再退化为矩形加箭头。

**Architecture:** 新增独立的 semantic visual module contract 层，输入受控的匿名结构事实，输出包含 `SemanticModule`、`SemanticDataObject`、`SemanticRelation`、panel intent 和结构签名的不可变规范化图。该层不修改现有 UGS/GPG/PVP，不保存坐标或 Visio 指令；后续 V2 compiler 通过 adapter 消费它。

**Tech Stack:** TypeScript 5.9、NodeNext、Zod 3、Vitest 3、Node `crypto` SHA-256；不增加第三方依赖。

## Global Constraints

- 只实现 `Semantic Architecture Graph`、模块契约、确定性规范化和结构签名；本计划不接入 Visio、PVP renderer、LangGraph、计费或外围 Agent。
- 不以 VGG、ResNet、U-Net、ViT 或其他模型名称选择模块；选择只依赖结构语义和证据。
- 不执行用户代码，不读取路径，不保存原始代码、图片像素、坐标、bounds、PVP primitive、COM command 或 renderer 字段。
- 所有事实、模块、数据对象和关系必须保留 public evidence IDs；evidence ID、结构对象 ID 和列表均按 code-unit 顺序规范化。
- `confidence` 必须为有限的 `[0, 1]` 数值；存在 blocking unresolved、candidate relation 或 unknown topology 时不得得到 `formal`。
- 保留当前工作树的全部未提交修改；只精确修改本计划声明的新增文件。
- 现有 UGS/GPG/PVP 测试必须保持不回归；本 V1 不改变它们的导出接口。

---

## 文件边界

- Create: `apps/api/src/semantic-visual-module.ts` — V1 版本化类型、受限联合类型和输入结构 schema。
- Create: `apps/api/src/semantic-visual-module-normalizer.ts` — schema 解析、引用/端口/关系校验、排序、candidate/formal 门禁、deep-freeze 和 canonical JSON。
- Create: `apps/api/src/semantic-visual-module-signature.ts` — 不含模型名的 `ArchitectureSignature` 抽取和稳定 SHA-256 signature。
- Create: `apps/api/tests/semantic-visual-module-contract.test.ts` — 四类匿名结构 fixture 与契约反例；测试先于生产代码。
- Create: `docs/superpowers/plans/2026-08-27-semantic-visual-module-v1.md` — 本实施计划。

现有 `apps/api/src/composable-region-visual-compiler.ts`、`apps/api/src/general-publication-graph.ts`、`apps/api/src/publication-visual-plan-compiler.ts` 和现有测试不在本 V1 修改范围内。

---

### Task 1: Define the renderer-neutral semantic contract

**Files:**
- Create: `apps/api/src/semantic-visual-module.ts`
- Test: `apps/api/tests/semantic-visual-module-contract.test.ts`

**Interfaces:**
- Produces `SEMANTIC_VISUAL_CONTRACT_VERSION`, `SemanticArchitectureGraphInput`, `SemanticArchitectureGraph`, `SemanticModule`, `SemanticDataObject`, `SemanticRelation`, `ModulePart`, `RepeatSpec`, `StateSpec`, `ConditionSpec`, `SemanticPanelIntent`, `SemanticModuleType` and their discriminated unions.
- `normalizeSemanticArchitectureGraph` in Task 2 consumes `SemanticArchitectureGraphInput` and returns `SemanticArchitectureGraph`.

- [ ] **Step 1: Write the failing tests**

Create a test fixture with one tensor input, one convolution stage, one feature-map output and one `data_flow` relation. Add anonymous fixtures for:

```ts
const tensor = (dataId: string, dataType: "tensor" | "feature_map", evidenceIds: string[]) => ({
  dataId, dataType, shape: { axes: ["C", "H", "W"], dimensions: ["C", 64, 64] },
  sourceNodeIds: [dataId], evidenceIds, visualRole: "primary", confidence: 0.9,
});

const module = {
  moduleId: "stage:conv",
  semanticType: "convolution_stage",
  label: "Convolution stage",
  sourceNodeIds: ["conv"], evidenceIds: ["fact-conv"],
  inputs: [{ portId: "stage:input", direction: "input", dataId: "input-tensor" }],
  outputs: [{ portId: "stage:output", direction: "output", dataId: "feature-map" }],
  internalParts: [
    { partId: "stage:conv-body", kind: "operator", role: "convolution", label: "Conv", evidenceIds: ["fact-conv"] },
    { partId: "stage:activation", kind: "operator", role: "activation", label: "Activation", evidenceIds: ["fact-conv"] },
  ],
  repeat: null, state: null, condition: null,
  layoutIntent: { emphasis: "primary", preferredPanel: "overview", detailPolicy: "summary" },
  confidence: 0.9,
};
```

The test must assert the public type vocabulary can represent `tensor`, `token_sequence`, `grid`, `mesh`, `memory`, `state`, `convolution_stage`, `attention_block`, `graph_message_passing`, `diffusion_denoiser`, `stage_region`, `repeat_group`, `multi_tower`, `fusion_block`, `feedback_loop` and `diffusion_ladder`. It must also assert every module has `internalParts`, every relation has `source` and `target` ports, and no contract object has geometry or renderer fields.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm.cmd run api:test -- apps/api/tests/semantic-visual-module-contract.test.ts
```

Expected: FAIL because `../src/semantic-visual-module.js` does not exist and the contract exports are missing. If the test fails for a syntax or fixture error instead, correct the test until the failure is caused by the missing contract.

- [ ] **Step 3: Write the minimal contract types**

Define these exact shapes in `semantic-visual-module.ts`:

```ts
export const SEMANTIC_VISUAL_CONTRACT_VERSION = 1 as const;
export type SemanticModuleType =
  | "image_frame" | "tensor_volume" | "token_sequence" | "grid" | "mesh_graph"
  | "latent" | "mask" | "prediction" | "memory_state"
  | "convolution_stage" | "scale_transition" | "attention_block" | "ffn_block"
  | "ssm_block" | "graph_message_passing" | "diffusion_denoiser"
  | "stage_region" | "repeat_group" | "multi_tower" | "fusion_block"
  | "time_axis" | "feedback_loop" | "diffusion_ladder" | "ensemble_branch"
  | "unknown_module";
export type SemanticDataType =
  | "image" | "video_frame" | "tensor" | "feature_map" | "token_sequence"
  | "grid" | "mesh" | "graph" | "latent" | "mask" | "prediction"
  | "memory" | "state" | "unknown";
export type SemanticRelationType =
  | "data_flow" | "condition_flow" | "residual_skip" | "add_merge" | "concat_merge"
  | "cross_attention" | "message_passing" | "state_read" | "state_write"
  | "feedback" | "time_step" | "diffusion_iteration";
export type SemanticKnowledge = "proven" | "declared" | "candidate";
export type SemanticExportEligibility = "formal" | "candidate" | "blocked";

export interface SymbolicShape { axes: string[]; dimensions: Array<number | string>; }
export interface SemanticPort { portId: string; direction: "input" | "output"; dataId: string | null; role: "data" | "condition" | "state" | "query" | "key" | "value" | "mask"; }
export interface ModulePart { partId: string; kind: "operator" | "data" | "relation" | "annotation"; role: string; label: string; evidenceIds: string[]; }
export interface RepeatSpec { kind: "block" | "time" | "diffusion" | "recurrent" | "ensemble"; count: number | "unknown"; unitModuleIds: string[]; display: "collapsed" | "first_last" | "expanded"; }
export interface StateSpec { stateId: string; stateType: "memory" | "recurrent" | "latent" | "unknown"; readPortIds: string[]; writePortIds: string[]; persistent: boolean; evidenceIds: string[]; }
export interface ConditionSpec { conditionId: string; conditionType: "text" | "time" | "noise" | "mask" | "external" | "unknown"; portIds: string[]; evidenceIds: string[]; }
export interface ModuleLayoutIntent { emphasis: "primary" | "secondary" | "auxiliary"; preferredPanel: "overview" | "detail" | "process" | "legend"; detailPolicy: "summary" | "expand" | "inset"; }
export interface SemanticModule { moduleId: string; semanticType: SemanticModuleType; label: string; sourceNodeIds: string[]; evidenceIds: string[]; inputs: SemanticPort[]; outputs: SemanticPort[]; internalParts: ModulePart[]; repeat: RepeatSpec | null; state: StateSpec | null; condition: ConditionSpec | null; layoutIntent: ModuleLayoutIntent; confidence: number; knowledge: SemanticKnowledge; }
export interface SemanticDataObject { dataId: string; dataType: SemanticDataType; shape: SymbolicShape | null; sourceNodeIds: string[]; evidenceIds: string[]; visualRole: "primary" | "condition" | "state" | "output" | "auxiliary"; confidence: number; knowledge: SemanticKnowledge; }
export interface SemanticRelation { relationId: string; type: SemanticRelationType; source: { moduleId: string; portId: string }; target: { moduleId: string; portId: string }; dataId: string | null; knowledge: SemanticKnowledge; evidenceIds: string[]; }
export interface SemanticPanelIntent { panelId: string; kind: "overview" | "detail" | "process" | "legend"; memberModuleIds: string[]; }
export interface UnresolvedSemantic { unresolvedId: string; scope: "module" | "relation" | "shape" | "topology"; severity: "blocking" | "warning"; evidenceIds: string[]; }
export interface SemanticArchitectureGraphInput { graphId: string; revision: string; modules: SemanticModule[]; dataObjects: SemanticDataObject[]; relations: SemanticRelation[]; panels: SemanticPanelIntent[]; evidenceIds: string[]; confidence: number; unresolved: UnresolvedSemantic[]; }
export interface SemanticArchitectureGraph extends SemanticArchitectureGraphInput { version: typeof SEMANTIC_VISUAL_CONTRACT_VERSION; exportEligibility: SemanticExportEligibility; canonicalHash: string; }
```

Do not add coordinates, `bounds`, renderer names, Visio fields, paths, commands or free-form source content to these interfaces.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the same focused Vitest command and expect the contract vocabulary and fixture shape assertions to pass after Task 2 exports the normalizer. Do not proceed if TypeScript reports an import/export mismatch.

---

### Task 2: Add deterministic validation and canonical normalization

**Files:**
- Create: `apps/api/src/semantic-visual-module-normalizer.ts`
- Modify: `apps/api/tests/semantic-visual-module-contract.test.ts`

**Interfaces:**
- `export function normalizeSemanticArchitectureGraph(input: SemanticArchitectureGraphInput): SemanticArchitectureGraph`
- `export function canonicalSemanticArchitectureGraphJson(graph: SemanticArchitectureGraph): string`
- `export function getSemanticExportEligibility(graph: SemanticArchitectureGraphInput): SemanticExportEligibility`

- [ ] **Step 1: Add failing validation tests**

Add tests for these exact behaviors:

```ts
it("rejects duplicate module, data, relation, port, part, panel and unresolved IDs", () => {
  const duplicate = structuredClone(fixture());
  duplicate.modules.push(structuredClone(duplicate.modules[0]));
  expect(() => normalizeSemanticArchitectureGraph(duplicate)).toThrow(/duplicate|unique/i);
});
it("rejects relation endpoints whose module or port does not exist", () => {
  const invalid = structuredClone(fixture());
  invalid.relations[0].target.moduleId = "missing-module";
  expect(() => normalizeSemanticArchitectureGraph(invalid)).toThrow(/port|module|endpoint/i);
});
it("rejects state write/read directions that do not match the module port direction", () => {
  const invalid = structuredClone(fixtureWithState());
  invalid.modules[0].state.readPortIds = [invalid.modules[0].outputs[0].portId];
  expect(() => normalizeSemanticArchitectureGraph(invalid)).toThrow(/state.*read|input/i);
});
it("rejects non-finite or out-of-range confidence", () => {
  for (const confidence of [-0.1, 1.1, Number.POSITIVE_INFINITY]) {
    const invalid = structuredClone(fixture());
    invalid.confidence = confidence;
    expect(() => normalizeSemanticArchitectureGraph(invalid)).toThrow(/confidence/i);
  }
});
it("rejects candidate topology from formal export", () => {
  const candidate = structuredClone(fixture());
  candidate.relations[0].knowledge = "candidate";
  expect(normalizeSemanticArchitectureGraph(candidate).exportEligibility).toBe("candidate");
});
it("keeps evidence IDs sorted and returns byte-identical output for reordered equivalent input", () => {
  const first = normalizeSemanticArchitectureGraph(fixture());
  const secondInput = structuredClone(fixture());
  secondInput.modules.reverse();
  secondInput.evidenceIds.reverse();
  const second = normalizeSemanticArchitectureGraph(secondInput);
  expect(canonicalSemanticArchitectureGraphJson(first)).toBe(canonicalSemanticArchitectureGraphJson(second));
});
it("rejects geometry and renderer leakage", () => {
  const invalid = structuredClone(fixture()) as Record<string, unknown>;
  invalid.coordinates = { x: 1, y: 2 };
  expect(() => normalizeSemanticArchitectureGraph(invalid as never)).toThrow(/forbidden|renderer|geometry/i);
});
it("allows an unknown module only as candidate or blocked", () => {
  const unknown = structuredClone(fixture());
  unknown.modules[0].semanticType = "unknown_module";
  unknown.modules[0].knowledge = "proven";
  expect(normalizeSemanticArchitectureGraph(unknown).exportEligibility).toBe("blocked");
});
```

- [ ] **Step 2: Run the focused test to verify the new cases fail**

Run:

```powershell
npm.cmd run api:test -- apps/api/tests/semantic-visual-module-contract.test.ts
```

Expected: the new tests FAIL because the normalizer is not implemented; existing contract type tests may pass. Confirm failures name missing `normalizeSemanticArchitectureGraph` or missing validation behavior, not malformed test data.

- [ ] **Step 3: Implement minimal validation and normalization**

In `semantic-visual-module-normalizer.ts`:

1. Use strict Zod schemas or equivalent explicit checks for every contract field, stable ID format `^[A-Za-z][A-Za-z0-9._:-]*$`, label length 1–240, maximum collection sizes of modules 512, data objects 1024, relations 2048, parts 128 per module, ports 64 per module, panels 64, evidence IDs 2048, and unresolved 128.
2. Reject unknown keys recursively, including keys whose lower-case normalized name contains `coordinate`, `bounds`, `geometry`, `renderer`, `visio`, `command`, `path`, `script`, `sourcecode`, `rawsource` or `outputpath`.
3. Validate all IDs are unique within their collection; validate each module port, relation endpoint, state read/write port and panel member reference.
4. Require every module to contain at least one `internalParts` item and every module/data/relation/unresolved object to contain at least one evidence ID unless its `knowledge` is `candidate` and the unresolved record has an explicit evidence ID.
5. Validate relation compatibility: `state_read` source port must be `output` and target port must be `input`; `state_write` source port must be `output` and target port must be `input`; data/condition relations cannot use null endpoint modules. For `add_merge`, `concat_merge`, `cross_attention`, `message_passing`, `feedback`, `time_step` and `diffusion_iteration`, preserve the typed relation instead of converting it to `data_flow`.
6. Sort all ID lists and collections with `compareCodeUnits`; keep module port ordering by `portId`, parts by `partId`, panels by `panelId`, and relations by `relationId`.
7. Compute eligibility: `blocked` for invalid/unknown topology or a blocking unresolved; `candidate` for candidate knowledge or candidate relations; `formal` only when all objects are proven/declared, all evidence references are present, confidence is valid, and no unresolved item is blocking.
8. Clone and recursively freeze the normalized result. Set `canonicalHash` to SHA-256 of canonical JSON with `canonicalHash` blanked before hashing. Canonical JSON must sort object keys recursively and reject non-finite numbers.

- [ ] **Step 4: Run focused tests and the existing semantic suite**

Run:

```powershell
npm.cmd run api:test -- apps/api/tests/semantic-visual-module-contract.test.ts
npm.cmd run api:test -- apps/api/tests/figure-semantic-model.test.ts apps/api/tests/publication-visual-grammar.test.ts apps/api/tests/general-publication-graph.test.ts
```

Expected: all new tests and the three existing semantic/publication test files pass with no warnings.

---

### Task 3: Add structure-derived ArchitectureSignature

**Files:**
- Create: `apps/api/src/semantic-visual-module-signature.ts`
- Modify: `apps/api/tests/semantic-visual-module-contract.test.ts`

**Interfaces:**
- `export interface ArchitectureSignature { dataTypes: SemanticDataType[]; hasSpatialScaleChange: boolean; hasGraphStructure: boolean; hasPersistentState: boolean; hasConditionPath: boolean; hasCrossAttention: boolean; hasRepeat: boolean; hasFeedback: boolean; hasDiffusionIteration: boolean; hasMultiTower: boolean; complexity: "compact" | "composite" | "high"; }`
- `export function deriveArchitectureSignature(graph: SemanticArchitectureGraph): ArchitectureSignature`
- `export function architectureSignatureId(signature: ArchitectureSignature): string`

- [ ] **Step 1: Add failing signature tests**

Add four anonymous fixtures and assert only structural traits:

```ts
it("detects spatial scale transitions from data shapes and scale_transition modules", () => {
  const signature = deriveArchitectureSignature(normalizeSemanticArchitectureGraph(fixtureWithScaleTransition()));
  expect(signature.hasSpatialScaleChange).toBe(true);
});
it("detects graph/mesh message passing without relying on a model name", () => {
  const signature = deriveArchitectureSignature(normalizeSemanticArchitectureGraph(fixtureWithGraphMessagePassing()));
  expect(signature.hasGraphStructure).toBe(true);
});
it("detects state, condition, feedback, cross attention, repeat, diffusion and multi-tower", () => {
  const signature = deriveArchitectureSignature(normalizeSemanticArchitectureGraph(fixtureWithProcessAndFusion()));
  expect(signature).toMatchObject({
    hasPersistentState: true, hasConditionPath: true, hasCrossAttention: true,
    hasRepeat: true, hasFeedback: true, hasDiffusionIteration: true, hasMultiTower: true,
  });
});
it("produces the same signature ID for reordered equivalent semantic graphs", () => {
  const first = deriveArchitectureSignature(normalizeSemanticArchitectureGraph(fixtureWithProcessAndFusion()));
  const second = deriveArchitectureSignature(normalizeSemanticArchitectureGraph(reordered(fixtureWithProcessAndFusion())));
  expect(architectureSignatureId(first)).toBe(architectureSignatureId(second));
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run the focused test file. Expected: FAIL because `semantic-visual-module-signature.ts` does not exist.

- [ ] **Step 3: Implement signature derivation**

Derive traits from normalized module/data/relation semantics:

- `hasSpatialScaleChange`: a `scale_transition` module or at least two spatial `tensor`/`feature_map` objects with different symbolic shape tuples;
- `hasGraphStructure`: `grid`, `mesh`, `graph`, `mesh_graph` or `graph_message_passing`;
- `hasPersistentState`: `memory_state`, `ssm_block`, state object or any `state_read`/`state_write` relation;
- `hasConditionPath`: non-empty module condition or `condition_flow` relation;
- `hasCrossAttention`: `cross_attention` relation or `attention_block` with a condition input;
- `hasRepeat`: any non-null repeat or `repeat_group`/`ensemble_branch` module;
- `hasFeedback`: `feedback` relation or `feedback_loop` module;
- `hasDiffusionIteration`: `diffusion_iteration`, `diffusion_denoiser` or `diffusion_ladder`;
- `hasMultiTower`: at least two `stage_region`/`multi_tower` branches feeding one fusion module, or a `multi_tower` module;
- `complexity`: `compact` for <= 4 modules and no branches/process/state, `composite` for <= 16 modules or any one advanced trait, `high` otherwise.

`architectureSignatureId` must hash canonical JSON of the signature, not labels, graph ID, revision, evidence IDs, source IDs or model names.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm.cmd run api:test -- apps/api/tests/semantic-visual-module-contract.test.ts
```

Expected: all contract and signature tests pass.

---

### Task 4: Final verification and handoff boundary

**Files:**
- Modify: `apps/api/tests/semantic-visual-module-contract.test.ts` only if a regression assertion is needed.

- [ ] **Step 1: Run the complete API test suite**

Run:

```powershell
npm.cmd run api:test
```

Expected: Vitest exits with code 0 and no failing tests. A failure in a pre-existing dirty test must be reported separately and must not be hidden by narrowing the command.

- [ ] **Step 2: Run the TypeScript check**

Run:

```powershell
npx.cmd tsc --noEmit
```

Expected: exit code 0 with no type errors.

- [ ] **Step 3: Run repository diff validation**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors. Inspect `git diff --stat` and `git status --short` to confirm only the plan, semantic contract files and focused test are newly changed by this task; preserve all earlier dirty files.

- [ ] **Step 4: Report the exact completion boundary**

Report separately:

1. V1 source/test evidence: contract, normalization, eligibility and signature tests;
2. not implemented in this task: visual module compiler, overview/detail composer, PVP vNext adapter, Visio native groups, Windows/Visio save/reopen/readback;
3. next core drawing task: V2 compiler that turns semantic modules into renderer-neutral internal visual parts, still before Visio integration.
