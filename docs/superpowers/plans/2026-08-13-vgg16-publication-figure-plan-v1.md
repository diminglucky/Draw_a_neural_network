# VGG16 Publication Figure Plan V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the current VGG16 rectangle-stack export path with a versioned, validated publication Figure Plan that renders equivalent editable VGG16 prisms in the browser layout and Microsoft Visio.

**Architecture:** Add a canonical Figure Plan V1 in figure units with a top-left origin. The existing Network IR remains the structural source; a deterministic VGG Paper Style V1 converts it into primitive groups, labels and connectors. Browser layout receives plan-derived nodes while the Visio protocol receives primitive groups and renders front, top and side faces as native shapes. Readback validates plan IDs, text, shape data and connector endpoints, not only aggregate counts.

**Tech Stack:** JavaScript ES modules and node:test; TypeScript/Zod/Vitest; C# .NET 8 Visio COM; existing Electron/desktop and Fastify boundaries.

## Global Constraints

- Work only in C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation on branch codex/commercial-foundation.
- Preserve the existing dirty changes; stage neither unrelated files nor all files.
- The first renderer is VGG Paper Style V1 and cnn-volume-schematic only. Reference-image analysis and other renderer families remain out of scope for this plan.
- The canonical coordinate system is figure-unit: one unit equals 0.01 inch, origin is top-left, page is 1200 by 800 units.
- Browser rendering converts figure units to CSS pixels; Visio rendering converts figure units to inches and reverses the Y axis exactly once.
- Model output remains validated Network IR. It never contains arbitrary SVG, COM, VBA, Shell, Python or raw primitive coordinates.
- API URL remains fixed. API key handling is not changed by this rendering plan; existing request-key behavior must not be broadened.
- Final Visio shapes must be native Shape objects. PNG/SVG insertion is forbidden.

---

### Task 1: Introduce VGG publication visual semantics in Network IR

**Files:**
- Modify: apps/api/src/network-ir.ts
- Modify: apps/api/src/adapters.ts
- Modify: apps/api/tests/agent-service.test.ts
- Modify: publication-layout.js
- Test: publication-layout.test.js

**Interfaces:**
- Consumes: existing Network IR nodes with kind, tensor, visualRole, repeatCount and legacy depth.
- Produces: optional node.visualEncoding with visiblePlaneCount, extrusionDepthFu, projection and spatialShape; legacy depth is accepted only as a migration fallback.
- Produces: deterministic VGG16 preset with the exact classifier metadata: FC-4096, FC-4096, FC-1000 logits and Softmax-1000 represented explicitly in semantic metadata even when visually collapsed.

- [ ] **Step 1: Write failing Node and Vitest tests**

~~~javascript
test("derives independent VGG visual encoding without using legacy depth as network semantics", () => {
  const layout = layoutNetworkIR(vgg16Ir());
  const block = layout.nodes.find((node) => node.id === "block-3");
  assert.deepEqual(block.visualEncoding, {
    visiblePlaneCount: 6,
    extrusionDepthFu: 24,
    projection: "oblique-3d",
    spatialShape: [56, 56],
  });
  assert.equal(block.repeatCount, 3);
  assert.equal(block.channelCount, 256);
});
~~~

~~~typescript
it("keeps the VGG16 FC-1000 logits semantic when softmax is visually collapsed", async () => {
  const result = await service.chat({ userId: "u", message: "Draw VGG16" });
  expect(result.networkIR.nodes.find((node) => node.id === "softmax")).toMatchObject({
    layerRole: "softmax",
    tensor: { shape: [1, 1, 1000] },
    metadata: { contains: ["fc8-logits", "softmax"] },
  });
});
~~~

- [ ] **Step 2: Run tests and verify RED**

Run:

~~~powershell
node --test publication-layout.test.js
.\node_modules\.bin\vitest.cmd run apps/api/tests/agent-service.test.ts
~~~

Expected: the new test fails because visualEncoding and classifier metadata are absent.

- [ ] **Step 3: Implement the minimal schema and preset changes**

Add the following strict visual object to the Network IR node schema:

~~~typescript
visualEncoding: z.object({
  visiblePlaneCount: z.number().int().min(1).max(12),
  extrusionDepthFu: z.number().int().min(0).max(120),
  projection: z.enum(["flat", "oblique-3d"]),
  spatialShape: z.array(z.number().int().positive()).min(2).max(3),
}).strict().nullable().optional().default(null),
~~~

Add an optional strict metadata record for semantically collapsed nodes. Set VGG16 visualEncoding explicitly in the local preset. In publication-layout.js pass visualEncoding through and only derive it from depth when the field is absent.

- [ ] **Step 4: Run tests and verify GREEN**

Run the commands in Step 2.

Expected: all existing tests plus the two new tests pass.

### Task 2: Create the canonical Publication Figure Plan V1

**Files:**
- Create: publication-figure-plan.js
- Create: publication-figure-plan.test.js
- Modify: publication-layout.js
- Modify: publication-layout.test.js

**Interfaces:**
- Consumes: validated Network IR with VGG visualEncoding.
- Produces: buildPublicationFigurePlan(ir, options) returning PublicationFigurePlanV1.
- Produces: validatePublicationFigurePlan(plan) returning a report with valid, violations and semantic summary.
- Produces: plan.primitiveGroups with one group per VGG component, each group containing primitive IDs and semantic IDs.

- [ ] **Step 1: Write failing tests**

~~~javascript
test("builds a canonical top-left VGG16 Figure Plan with native prism groups", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  assert.deepEqual(plan.coordinateSpace, {
    unit: "figure-unit",
    figureUnitInches: 0.01,
    origin: "top-left",
    width: 1200,
    height: 800,
  });
  const block3 = plan.primitiveGroups.find((group) => group.id === "block-3");
  assert.equal(block3.kind, "feature-map-prism");
  assert.deepEqual(block3.primitiveIds, ["block-3.front", "block-3.top", "block-3.side"]);
  assert.equal(block3.semantic.channelCount, 256);
  assert.equal(validatePublicationFigurePlan(plan).valid, true);
});

test("uses strictly decreasing feature-map front heights after VGG pooling stages", () => {
  const plan = buildPublicationFigurePlan(vgg16Ir());
  const heights = ["block-1", "block-2", "block-3", "block-4", "block-5"]
    .map((id) => plan.primitiveGroups.find((group) => group.id === id).bounds.height);
  assert.deepEqual(heights, [...heights].sort((left, right) => right - left));
  assert.equal(new Set(heights).size, heights.length);
});
~~~

- [ ] **Step 2: Run the Figure Plan tests and verify RED**

Run:

~~~powershell
node --test publication-figure-plan.test.js
~~~

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the plan builder and validator**

Implement these exports:

~~~javascript
export const VGG_PAPER_STYLE_V1 = Object.freeze({
  id: "vgg-paper-style-v1",
  rendererFamily: "cnn-volume-schematic",
  page: { width: 1200, height: 800, margin: 35 },
  projection: { kind: "oblique-3d", skewX: 18, skewY: -14 },
});

export function buildPublicationFigurePlan(networkIR, options = {}) { /* deterministic VGG plan */ }
export function validatePublicationFigurePlan(plan) { /* structural, bounds, overlap and trend checks */ }
~~~

Every feature-map group must have front, top and side primitives; every pool, FC and softmax group must have a distinct primitive kind. Geometry comes from tensor spatial size using the specified square-root map with minimum height 78 and maximum height 300 figure units. The validator must reject an invalid coordinate space, duplicate primitive IDs, missing group primitive IDs, non-monotonic VGG feature-map sizes, overlaps, out-of-bounds shapes, malformed connectors and labels below 7 points.

- [ ] **Step 4: Adapt browser layout without replacing the legacy path**

For a VGG16 IR, layoutNetworkIR must attach:

~~~javascript
layout.figurePlan = buildPublicationFigurePlan(ir);
~~~

It must retain nodes and edges for the existing canvas. Non-VGG IR continues using the existing layout path unchanged.

- [ ] **Step 5: Run Figure Plan and existing layout tests**

Run:

~~~powershell
node --test publication-figure-plan.test.js publication-layout.test.js
~~~

Expected: all tests pass.

### Task 3: Version the Visio worker protocol and map primitive groups

**Files:**
- Modify: apps/api/src/visio-worker-client.ts
- Modify: apps/api/tests/visio-worker-client.test.ts
- Modify: workers/visio-worker/src/VisioWorker.Core/DiagramModel.cs
- Modify: workers/visio-worker/src/VisioWorker.Core/DiagramMapper.cs
- Modify: workers/visio-worker/tests/VisioWorker.Core.Tests/DiagramMapperTests.cs

**Interfaces:**
- Consumes: diagram.figurePlan with coordinateSpace and primitiveGroups.
- Produces: DiagramDocument primitive groups in inches, preserving legacy node mapping for non-Figure Plan diagrams.
- Produces: each group ShapeData containing synapse.planId, synapse.sourceNodeId, synapse.visualRole, synapse.repeatCount and synapse.channelCount.

- [ ] **Step 1: Write failing TypeScript and C# tests**

~~~typescript
it("serializes a Figure Plan prism group in figure units without treating depth as channel semantics", async () => {
  const request = buildRequestFor(plan);
  expect(request.diagram.figurePlan.coordinateSpace.origin).toBe("top-left");
  expect(request.diagram.figurePlan.primitiveGroups[0]).toMatchObject({
    id: "block-1",
    kind: "feature-map-prism",
    primitiveIds: ["block-1.front", "block-1.top", "block-1.side"],
  });
});
~~~

~~~csharp
[Fact]
public void Maps_figure_units_to_inches_and_preserves_prism_group_shape_data()
{
    var document = DiagramMapper.Map(FigurePlanFixture.Vgg16());
    var group = Assert.Single(document.PrimitiveGroups, item => item.Id == "block-1");
    Assert.Equal(2.40, group.Bounds.HeightInches, 2);
    Assert.Equal("block-1", group.ShapeData["synapse.planId"]);
    Assert.Equal("64", group.ShapeData["synapse.channelCount"]);
}
~~~

- [ ] **Step 2: Run tests and verify RED**

Run:

~~~powershell
.\node_modules\.bin\vitest.cmd run apps/api/tests/visio-worker-client.test.ts
dotnet test workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore
~~~

Expected: tests fail because Figure Plan protocol types and mapping do not exist.

- [ ] **Step 3: Add protocol V2 alongside protocol V1**

Do not break existing diagrams. Add FigurePlan to the diagram envelope and add C# records:

~~~csharp
public sealed record FigurePlanDocument(
    FigureCoordinateSpace CoordinateSpace,
    IReadOnlyList<VisioPrimitiveGroup> PrimitiveGroups,
    IReadOnlyList<VisioConnector> Connectors);

public sealed record VisioPrimitiveGroup(
    string Id,
    string Kind,
    VisioBounds Bounds,
    double ExtrusionDepthInches,
    double SkewXInches,
    double SkewYInches,
    IReadOnlyList<string> PrimitiveIds,
    IReadOnlyDictionary<string, string> ShapeData);
~~~

The mapper converts each figure value to inches by multiplying it by 0.01. It does not reverse Y; only the COM renderer performs that inversion. Keep current VisioNode mapping as the V1 fallback.

- [ ] **Step 4: Run tests and verify GREEN**

Run the commands in Step 2.

Expected: both V1 and V2 protocol tests pass.

### Task 4: Render native Visio prisms and perform semantic readback

**Files:**
- Modify: workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs
- Modify: workers/visio-worker/src/VisioWorker.Core/DiagramModel.cs
- Modify: workers/visio-worker/tests/VisioWorker.Core.Tests/DiagramMapperTests.cs
- Modify: scripts/vgg16-visio-smoke.ps1

**Interfaces:**
- Consumes: VisioPrimitiveGroup in top-left figure-derived inches.
- Produces: separate native front, top and side Visio Shape objects for each feature-map prism.
- Produces: ReadbackResultV2 with groups, primitive Shape IDs, text, shape data and connector endpoint IDs.

- [ ] **Step 1: Write failing mapper and readback contract tests**

~~~csharp
[Fact]
public void Readback_requires_all_three_shapes_for_a_feature_map_prism()
{
    var result = ReadbackValidator.Validate(
        FigurePlanFixture.OnePrism(),
        new [] { "block-1.front", "block-1.top" });
    Assert.False(result.Valid);
    Assert.Contains("block-1.side", result.MissingPrimitiveIds);
}
~~~

- [ ] **Step 2: Run the C# test and verify RED**

Run:

~~~powershell
dotnet test workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore
~~~

Expected: FAIL because semantic primitive readback validation does not exist.

- [ ] **Step 3: Implement native primitive rendering**

Implement a DrawFeatureMapPrism method using one rectangle for the front face and two native freeform polygons for top and side faces. Name faces synapse.primitive.{sanitizedPlanId}.front, top and side. Apply the plan ShapeData to every face plus synapse.primitiveId. Render pooling, FC and softmax as their specified thin native prism variants. Draw labels after primitives and connect only group front faces.

Readback after reopening must enumerate every named primitive, compare it with the planned IDs, inspect Prop rows for the required shape data, compare labels and verify connector endpoints. Aggregate shape counts remain diagnostic only.

- [ ] **Step 4: Run C# tests and live VGG smoke**

Run:

~~~powershell
dotnet test workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore
powershell -ExecutionPolicy Bypass -File scripts\vgg16-visio-smoke.ps1
~~~

Expected: unit tests pass. The live smoke writes a new .vsdx, reopens it, reports zero missing primitive IDs and exports a PNG path for manual review. If Visio is not installed or COM is unavailable, report that as an external acceptance gap rather than a passing result.

### Task 5: Wire Figure Plan validation into Agent and final focused verification

**Files:**
- Modify: apps/api/src/agent-service.ts
- Modify: apps/api/tests/agent-service.test.ts
- Modify: publication-layout.js
- Modify: publication-layout.test.js
- Modify: README.md

**Interfaces:**
- Consumes: VGG16 Network IR generated by the deterministic provider.
- Produces: Agent chat result whose diagram includes a valid Figure Plan V1.
- Produces: agent failure before Visio export when a VGG Figure Plan violates publication validation.

- [ ] **Step 1: Write failing AgentService test**

~~~typescript
it("returns a validated VGG Figure Plan and never sends an invalid plan to Visio", async () => {
  const result = await service.chat({ userId: "u", message: "Draw VGG16" });
  expect(result.diagram.figurePlan.validation.valid).toBe(true);
  expect(result.diagram.figurePlan.primitiveGroups).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "feature-map-prism" })]),
  );
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

~~~powershell
.\node_modules\.bin\vitest.cmd run apps/api/tests/agent-service.test.ts
~~~

Expected: FAIL because AgentService does not yet attach and validate Figure Plan V1.

- [ ] **Step 3: Implement only the VGG wiring**

When the diagram layout supplies a figurePlan, AgentService validates it before returning the chat result. A failed validation becomes a stable FoundationError with the violation summary. Generic IR behavior remains unchanged.

Document the supported first-release contract in README:

~~~text
VGG16 uses the built-in VGG Paper Style V1.
The first renderer does not infer arbitrary reference-image styles.
Visio output is native editable Shape geometry and is validated after reopening.
~~~

- [ ] **Step 4: Run final focused verification**

Run:

~~~powershell
node --test publication-figure-plan.test.js publication-layout.test.js
.\node_modules\.bin\vitest.cmd run apps/api/tests/agent-service.test.ts apps/api/tests/visio-worker-client.test.ts
dotnet test workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore
dotnet build workers\visio-worker\VisioWorker.sln --no-restore
~~~

Expected: all focused tests and the worker build pass. Run the live VGG smoke separately and report its result as a real Visio acceptance gate.

## Plan self-review

- Spec coverage: Tasks 1 through 5 cover independent visual semantics, canonical Figure Plan, shared coordinate space, native Visio primitive rendering, semantic readback, VGG16 classifier accuracy, validation and focused acceptance. API key safe storage and arbitrary reference-image style analysis are deliberately separate phases because they are independent subsystems and must not be hidden inside the VGG renderer change.
- Placeholder scan: no unresolved marker or deferred implementation phrase is used as a task step.
- Type consistency: Figure Plan is created in Task 2, serialized in Task 3, consumed in Task 4 and validated by AgentService in Task 5. Protocol V1 stays available as fallback.
