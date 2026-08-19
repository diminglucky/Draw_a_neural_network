# CNN Publication Geometry Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current rectangle-stack VGG16 Visio output with a Unicode-safe, semantically anchored, native-editable CNN tensor plate.

**Architecture:** Keep the Agent and Worker ownership chain intact. Extend the deterministic Figure Plan with stage anchors and annotation tracks, render feature maps and transitions from one closed-polygon tensor geometry contract, and make the process standard streams UTF-8 before host I/O begins.

**Tech Stack:** Node ESM + `node:test`; TypeScript/Vitest focused integration tests; .NET 8/xUnit; Microsoft Visio COM native shapes.

## Global Constraints

- Work in `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation` on `agent`; preserve unrelated dirty changes.
- Do not use `git add .`, reset, clean, force-push, or alter existing tags.
- Preserve native editable Visio Shapes, server-owned plan authority, v2 session ownership, save/reopen, and semantic readback.
- Do not implement code or sketch intake in this plan.

---

### Task 1: Make the CNN Figure Plan stage-anchored and collision-safe

**Files:**
- Modify: `publication-figure-plan.js`
- Modify: `publication-figure-plan.test.js`

**Interfaces:**
- Produces feature-map groups with semantic `stageRegion`, `leftAnchor`, and `rightAnchor` values.
- Produces pooling groups with source/target stage IDs and endpoints matching neighboring tensor anchors.
- Produces non-overlapping labels in dedicated annotation tracks.

- [ ] Write failing Node tests for a 1800×720 artboard, `Block 1` labels, pool endpoint ownership, and no label rectangle intersections.
- [ ] Run `node --test publication-figure-plan.test.js` and verify the assertions fail against the current cursor-based layout.
- [ ] Replace generic linear positioning with semantic stage regions; derive feature, pool, flatten, and classifier bounds from adjacent anchors.
- [ ] Add validator violations for missing anchors, non-owned pool transitions, invalid CNN primitive geometry, label overlap, and connector-label intersection.
- [ ] Run `node --test publication-figure-plan.test.js publication-layout.test.js` and verify all pass.

### Task 2: Render tensor slabs and pool contractions only from closed polygons

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Modify/Create: focused `VisioWorker.Core.Tests` geometry tests using the existing renderer test seams

**Interfaces:**
- Consumes Figure Plan primitive groups and anchor-derived bounds.
- Produces front, top, and side shapes with the shared `synapse.primitiveId` contract.

- [ ] Write a failing renderer test that rejects a CNN Feature Map face emitted as a rectangle/fallback primitive and asserts a shared projection vector for a plane triplet.
- [ ] Run the focused `dotnet test` filter and verify the expected failure.
- [ ] Implement one `DrawTensorSlabPlane` polygon helper and route feature-map stacks through it; remove the Feature Map `DrawRectangle` path.
- [ ] Implement a pool frustum that takes the source and target visual anchors and shares their endpoints.
- [ ] Run focused Worker tests, then `dotnet test workers\visio-worker\tests\VisioWorker.Core.Tests\VisioWorker.Core.Tests.csproj --no-restore`.

### Task 3: Make Worker standard streams UTF-8 and protect label round-trip

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Host/Program.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/WorkerHostLineProcessorTests.cs`
- Modify if required: native readback focused test fixture

**Interfaces:**
- Host process reads JSON Lines and emits JSON Lines through UTF-8 streams independently of the Windows active code page.

- [ ] Write a failing host/process test that sends `3×3 · 64 ×2` in a Figure Plan label and expects the exact same Unicode text after processing/readback.
- [ ] Run the test with a non-UTF-8 console-code-page seam and verify it exposes the current mojibake failure.
- [ ] Set input, output, and error encodings to UTF-8 before using `Console.In`, `Console.Out`, or `Console.Error`.
- [ ] Run focused host tests and the full Worker Core suite.

### Task 4: Re-render and inspect a real VGG16 artifact

**Files:**
- Modify only if required: `scripts/agent-vgg16-visio-acceptance.ts`
- Create: `docs/evidence/2026-08-19-cnn-publication-geometry-repair.md`

- [ ] Run API focused tests, Worker tests, strict TypeScript compilation, and `git diff --check` for the exact allowlist.
- [ ] Create a new hidden VGG16 VSDX, save it, independently reopen it, and assert expected primitive IDs plus exact Unicode label text.
- [ ] Create a new visible VGG16 VSDX without closing it automatically.
- [ ] Export a screenshot from the saved artifact; inspect it against the target visual contract and record both passed and unaccepted gates in the evidence document.
