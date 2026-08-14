# VGG16 Tensor Plate V3 Implementation Plan

> **For agentic workers:** Execute this plan inline with test-first checkpoints. The working tree is intentionally dirty: do not stage, commit, push, reset, checkout, clean, or alter unrelated files.

**Goal:** Replace the generic VGG prism chain with a compact, publication-style tensor plate whose native Visio Shapes accurately encode VGG16 repetition, spatial downsampling, channel depth, flattening, and classifier stages.

**Architecture:** Keep the model boundary unchanged: validated Network IR remains structural input and the Figure Plan remains deterministic. V3 introduces `vgg-tensor-plate-v3`, emitting semantic native primitive groups for RGB input tiles, dynamic feature-map plane stacks, downsample transitions, a flatten ribbon, dense vector layers, and score bars. The Visio Worker maps that fixed grammar to editable Shapes and validates every planned primitive after reopen.

**Tech Stack:** Node ESM + `node:test`; .NET 8 Visio COM; native Visio Shapes and Shape Data only.

## Global Constraints

- Work only in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on `codex/commercial-foundation`.
- Preserve every unrelated dirty change. Do not stage, commit, push, reset, checkout, clean, kill Visio, or overwrite a user VSDX.
- Do not permit raw model-generated Visio/COM/SVG/script geometry. The model supplies validated Network IR; V3 geometry is deterministic.
- Render only native editable Visio Shapes; no image/SVG/VBA embedding.
- A visible smoke run must leave only its newly generated final VSDX open. Hidden verification may close only its own temporary COM instance.
- Do not claim publication-quality acceptance from tests alone. Require semantic VSDX readback and a fresh Visio screenshot review.

---

### Task 1: Define the V3 Tensor Plate contract in the Figure Plan

**Files:**
- Modify: `publication-figure-plan.js`
- Modify: `publication-figure-plan.test.js`
- Modify: `scripts/generate-vgg16-figure-plan.test.mjs`

**Interfaces:**
- Consumes: VGG16 Network IR nodes with `tensor.shape`, `channelCount`, `repeatCount`, `visualRole`, and ordered forward edges.
- Produces: `styleId: "vgg-tensor-plate-v3"`, a 1600×640 plan, VGG stack plane counts equal to `repeatCount`, `downsample-transition`, `flatten-ribbon`, `dense-vector-layer`, and `score-vector-layer` primitive groups.

- [ ] **Step 1: Write the failing Figure Plan assertions**

```javascript
test("encodes VGG16 repetitions and classifier grammar as a tensor plate", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  const groups = new Map(plan.primitiveGroups.map((group) => [group.id, group]));

  assert.equal(plan.styleId, "vgg-tensor-plate-v3");
  assert.equal(plan.coordinateSpace.height, 640);
  assert.equal(groups.get("block-1").primitiveIds.length, 6);
  assert.equal(groups.get("block-2").primitiveIds.length, 6);
  assert.equal(groups.get("block-3").primitiveIds.length, 9);
  assert.equal(groups.get("pool-1").kind, "downsample-transition");
  assert.equal(groups.get("flatten").kind, "flatten-ribbon");
  assert.equal(groups.get("fc-1").kind, "dense-vector-layer");
  assert.equal(groups.get("softmax").kind, "score-vector-layer");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test publication-figure-plan.test.js scripts/generate-vgg16-figure-plan.test.mjs`

Expected: FAIL because V2 fixes every convolution stack to three planes and emits prism-only pool/classifier groups.

- [ ] **Step 3: Implement the minimal V3 Figure Plan**

```text
input                 -> input-rgb-tile
block-1 .. block-5    -> feature-map-stack with N × {front, top, side}, N = repeatCount
pool-1 .. pool-5      -> downsample-transition with {front, top, side}
flatten               -> flatten-ribbon with {ribbon}
fc-1 / fc-2           -> dense-vector-layer with {frame, unit-1..unit-7}
softmax               -> score-vector-layer with {frame, score-1..score-6}
```

Use a 1600×640 page with a 45 figure-unit margin. Represent spatial resolution through feature-map face height, channel count through bounded extrusion depth, and each pooling group through its input/output spatial metadata. Keep labels compact: `Conv 1`, `3×3 · 64 ×2`, `MaxPool 2×2`, `Flatten`, `FC6 · 4096`, `FC7 · 4096`, `FC8 · 1000`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test publication-figure-plan.test.js publication-layout.test.js scripts/generate-vgg16-figure-plan.test.mjs`

Expected: all Figure Plan and layout tests pass, with no invalid bounds or missing primitive IDs.

### Task 2: Map and render Tensor Plate primitives as native Visio Shapes

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Core/DiagramModel.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Core/DiagramMapper.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/DiagramMapperTests.cs`

**Interfaces:**
- Consumes: Figure Plan V3 primitive group IDs, `repeatCount`, `channelCount`, and pooling input/output spatial metadata.
- Produces: named, Shape Data annotated Visio Shapes for every planned plane, transition face, ribbon, vector unit, and score bar.

- [ ] **Step 1: Write failing mapper/render-palette tests**

```csharp
[Fact]
public void Maps_dynamic_feature_map_plane_ids_and_downsample_metadata()
{
    var document = DiagramMapper.Map(FigurePlanFixture.VggTensorPlateV3());
    var block1 = Assert.Single(document.FigurePlan!.PrimitiveGroups, group => group.Id == "block-1");
    var pool1 = Assert.Single(document.FigurePlan.PrimitiveGroups, group => group.Id == "pool-1");

    Assert.Equal(6, block1.PrimitiveIds.Count);
    Assert.Equal("112", pool1.ShapeData["synapse.outputSpatialSize"]);
}

[Fact]
public void Uses_a_print_safe_feature_map_front_fill()
{
    Assert.Equal((247, 251, 255), PublicationRenderPalette.FeatureMapFrontFill);
}
```

- [ ] **Step 2: Verify RED**

Run: `dotnet test workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore`

Expected: FAIL because V2 has no V3 transition metadata or V3 front-fill contract.

- [ ] **Step 3: Implement native V3 renderers**

```text
DrawFeatureMapPlaneStack
  derives plane count from planned .plane-N primitive IDs;
  draws rear to front; uses off-white front planes and pale blue rear planes;
  uses bounded channel-dependent extrusion depth.

DrawDownsampleTransition
  builds a tapered polygon whose left opening reflects input spatial size
  and right opening reflects output spatial size; it occupies the route
  between adjacent feature-map stacks rather than reading as a separate box.

DrawFlattenRibbon
  builds one tapered native polygon from the final feature-map stack to FC6.

DrawDenseVectorLayer / DrawScoreVectorLayer
  create a native outline/frame plus seven vector units or six score bars;
  they must never be rendered as classifier prisms.
```

Use an off-white and pale-blue feature-map palette with dark desaturated blue outlines; use neutral slate for transformations; reserve one restrained teal accent for dense vectors and muted gold only for score bars. No saturated RGB stripes and no generic white prism chain.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
dotnet build workers\visio-worker\VisioWorker.sln --no-restore
dotnet test workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore
```

Expected: zero build warnings/errors and all focused Worker tests pass.

### Task 3: Execute real VGG16 Tensor Plate acceptance

**Files:**
- Modify if required: `scripts/vgg16-visio-smoke.ps1`

**Interfaces:**
- Consumes: canonical V3 Figure Plan and the constrained live Worker.
- Produces: a unique visible VSDX that remains open, semantic readback, a hidden reopenable VSDX, and a screenshot for visual review.

- [ ] **Step 1: Run hidden semantic render**

Run: `powershell -ExecutionPolicy Bypass -File scripts\vgg16-visio-smoke.ps1 -Hidden`

Expected: 5 VGG blocks yield 6/6/9/9/9 native plane faces, all dynamic V3 primitives are present after reopen, and the hidden worker closes only its own document.

- [ ] **Step 2: Inspect VSDX XML Shape names and shape data**

Verify `page1.xml` contains `block_1_plane_2_front`, no `block_1_plane_3_front`, `flatten_ribbon`, `fc_1_frame`, `fc_1_unit_7`, and the plan/source/primitive Shape Data for each expected group.

- [ ] **Step 3: Run visible smoke and inspect screenshot**

Run: `powershell -ExecutionPolicy Bypass -File scripts\vgg16-visio-smoke.ps1 -Visible`

Expected: the new VSDX remains open. Review the visible Visio document for all of the following before reporting: repeated-plane counts visually match VGG16, pooling is a scale transition rather than a standalone block, classifier is vector grammar, text is readable/no `?`, the plate occupies the compact artboard, and the palette remains print-safe.

## Plan self-review

- Coverage: V3 replaces the incorrect fixed three-plane grammar, adds deterministic downsampling and classifier semantics, preserves native Shape readback, and keeps interactive lifecycle isolation.
- Boundaries: the model/Agent authority, browser preview integration, non-VGG grammars, API relay, credential handling, and commit/push remain out of scope.
- Acceptance: automated tests establish structural behavior; VSDX reopen/readback establishes editability; a fresh visible Visio screenshot remains the visual acceptance gate.
