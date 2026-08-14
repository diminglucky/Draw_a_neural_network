# VGG16 Paper Plate V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the VGG16 single-prism chain with a publication-style, native-editable Visio plate that communicates input, convolution blocks, pooling transitions and classifier semantics.

**Architecture:** Keep Network IR structural. The deterministic Figure Plan emits a V2 `vgg-paper-plate-v2` grammar: RGB input tile, multi-plane feature-map stacks, pooling wedges, classifier prisms, stage headings and local tensor annotations. The Visio renderer maps each planned primitive to native shapes and semantic readback verifies every face after close/reopen.

**Tech Stack:** JavaScript ES modules and node:test; C# .NET 8 Visio COM; native Visio shapes only.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on `codex/commercial-foundation`.
- Preserve unrelated dirty changes; do not stage, commit, push, reset, checkout, or clean the worktree.
- The final Visio artifact must contain editable native Shapes; do not insert SVG, PNG, screenshots, VBA, arbitrary COM, shell, or model-generated geometry.
- Model output remains validated Network IR. VGG Figure Plan V2 remains deterministic.
- Interactive visible rendering must preserve the reopened final VSDX in Visio. Hidden smoke verification may close only its own temporary Visio instance.
- The visual acceptance gate is a real VSDX close/reopen, semantic primitive readback, PNG inspection, and user review; focused tests are not a visual-quality claim.

---

### Task 1: Express VGG block stacks and paper annotations in Figure Plan V2

**Files:**
- Modify: `publication-figure-plan.js`
- Modify: `publication-figure-plan.test.js`

**Interfaces:**
- Consumes: validated VGG16 Network IR nodes with tensor shape, repeat count and visual encoding.
- Produces: `styleId: "vgg-paper-plate-v2"`, V2 primitive groups, `stage-heading` / `detail-label` annotations, and page-local label geometry.

- [ ] **Step 1: Write failing tests**

```javascript
test("builds VGG blocks as multi-plane feature-map stacks with local stage headings", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  const block1 = plan.primitiveGroups.find((group) => group.id === "block-1");
  assert.equal(plan.styleId, "vgg-paper-plate-v2");
  assert.equal(block1.kind, "feature-map-stack");
  assert.equal(block1.primitiveIds.length, 9);
  assert.ok(plan.labels.some((label) => label.id === "block-1.heading" && label.text === "CONV BLOCK 1"));
  assert.ok(plan.labels.some((label) => label.id === "block-1.detail" && label.text.includes("3×3 Conv ×2")));
});
```

- [ ] **Step 2: Verify RED**

Run `node --test publication-figure-plan.test.js`.

Expected: the test fails because V1 has one prism per block and no V2 stage labels.

- [ ] **Step 3: Implement V2 geometry**

Emit three plane triplets for each convolution feature-map stack with IDs `<block>.plane-1.front/top/side` through `<block>.plane-3.front/top/side`. Create `input-rgb-tile`, `pooling-wedge`, `classifier-prism` and `softmax-prism` groups. Place local headings above blocks and details below their bounds. Make `224 → 112 → 56 → 28 → 14 → 7` geometrically evident, use the full page width, and retain deterministic output.

- [ ] **Step 4: Verify GREEN**

Run `node --test publication-figure-plan.test.js publication-layout.test.js`.

Expected: all tests pass.

### Task 2: Map and render V2 native Visio primitives

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Core/DiagramMapper.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/DiagramMapperTests.cs`

**Interfaces:**
- Consumes: V2 Figure Plan primitive IDs and labels.
- Produces: native Visio tile, multi-plane stack, wedge and prism Shapes, all with plan/source/primitive Shape Data.

- [ ] **Step 1: Write failing mapper tests**

```csharp
[Fact]
public void Maps_multi_plane_stack_primitive_ids_without_requiring_a_single_root_face()
{
    var document = DiagramMapper.Map(FigurePlanFixture.VggV2());
    var block = Assert.Single(document.FigurePlan!.PrimitiveGroups, group => group.Id == "block-1");
    Assert.Equal(9, block.PrimitiveIds.Count);
    Assert.Contains("block-1.plane-3.side", block.PrimitiveIds);
}
```

- [ ] **Step 2: Verify RED**

Run `dotnet test workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore`.

Expected: V1 root-face validation rejects a V2 plane triplet.

- [ ] **Step 3: Implement native renderers**

Use explicit primitive triplets, never fallback rectangles: render each stack plane with increasing offset; use a three-layer RGB input tile; render pooling as tapered front/top/side wedge; retain classifier and softmax prism faces. Render labels by explicit planned position and font size.

- [ ] **Step 4: Verify GREEN**

Run the Task 2 test command and `dotnet build workers\visio-worker\VisioWorker.sln --no-restore`.

Expected: test suite passes and build has zero warnings/errors.

### Task 3: Execute real VGG16 V2 acceptance

**Files:**
- Modify if needed: `scripts/vgg16-visio-smoke.ps1`

**Interfaces:**
- Consumes: canonical VGG16 Figure Plan V2.
- Produces: a unique visible VSDX that remains open, semantic readback, and a separate hidden PNG inspection artifact.

- [ ] **Step 1: Run visible smoke**

Run `powershell -ExecutionPolicy Bypass -File scripts\vgg16-visio-smoke.ps1`.

Expected: VSDX is generated, all V2 primitive IDs / connector IDs / Shape Data pass, and Visio keeps the final VSDX open.

- [ ] **Step 2: Run hidden visual inspection**

Run `powershell -ExecutionPolicy Bypass -File scripts\vgg16-visio-smoke.ps1 -Hidden -VerifyPreview`.

Expected: temporary hidden VSDX is reopened, exported to PNG, and inspected without affecting user-visible Visio documents.

- [ ] **Step 3: Inspect VSDX and PNG**

Verify that VSDX has polygonal top/side faces, 3 feature-map plane triplets per convolution block, readable labels, a centered plate composition, and no generic block IDs in visible text.

## Plan self-review

- Coverage: the plan changes VGG visual grammar, native Visio renderer, semantic preservation, interactive lifecycle, and real acceptance without broadening the model/tool authority.
- No placeholders: all interfaces, IDs, output types, and commands are explicit.
- Scope: VGG-only renderer grammar. Reference-image style inference and other architectures remain separate work.
