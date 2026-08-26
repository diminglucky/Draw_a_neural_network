# Selected-Page Verification A1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent empty, incomplete, or incorrectly source-mapped selected-page replacements from being saved or reported as `readback_verified`.

**Architecture:** Extend the existing operation-scoped creation journal into an exact internal shape/semantic manifest, make the live backend validate the promoted region against that manifest, and change orchestration to verify before save and again after save. Keep browser/API schemas and the v3 command vocabulary unchanged; exact expected Shape IDs remain Worker/session authority.

**Tech Stack:** C#/.NET 8, xUnit, Visio COM dynamic interop, TypeScript, Zod, Vitest, existing selected-page v3 session protocol.

## Global Constraints

- Do not add model-name, architecture-name, paper-name, fixture-name, or source-text routing.
- Do not create/open/resize/close a Visio document or page, call `SaveAs`, or quit Visio.
- Do not accept native Shape IDs, semantic mappings, page identities, coordinates, or COM commands from the browser.
- Do not change UGS, GPG, PVP, sealed-native-intent, browser DTO, or v3 JSON command schemas.
- Every renderer-created Shape ID must be recorded immediately after the COM creation method returns and before later fallible work.
- Every successful renderer-created Shape must have exact nonempty semantic IDs; name inference and all-node fallback are not authority.
- `saveSelectedDocument` must fail unless the current promoted manifest passed an exact pre-save readback.
- `readback_verified` requires an equal post-save exact-manifest readback.
- Keep real Visio, process-termination recovery, cross-process locking, A2 cancellation, and durable leases outside this plan.

## Completion Status — 2026-08-26

- [x] Tasks 1–4 implementation and review fixes are committed through code HEAD `b89bcf4`.
- [x] Task 5 focused, Worker, build, TypeScript, foundation, Git, and independent-review evidence is recorded.
- [ ] Full API baseline is green. Five unchanged baseline failures remain across three files.
- [ ] Real installed-Visio save/close/reopen acceptance is complete. The two live-acceptance tests remain skipped.
- [ ] A2 native-apply cancellation, durable leases, process-termination recovery, and cross-process locking are complete.
- [ ] Publication-aesthetic improvement or publication-quality acceptance is complete.

---

### Task 1: Replace the ID-only journal with an exact creation manifest

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Live/SelectedPageOwnedRegionReplacement.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageOwnedRegionReplacementTests.cs`

**Interfaces:**
- Produces: `SelectedPageShapeRole` with `Primary`, `Auxiliary`, `Label`, `Annotation`, `Connector`, and `Title` values.
- Produces: immutable `SelectedPageShapeCreationEntry(int ShapeId, IReadOnlyList<string> SemanticIds, SelectedPageShapeRole Role)`.
- Changes: `SelectedPageShapeCreationJournal.Record(int shapeId, IEnumerable<string> semanticIds, SelectedPageShapeRole role)`.
- Produces: immutable `SelectedPagePromotedRegionManifest(Target, OwnershipNamespace, Entries)` returned by `SelectedPageOwnedRegionReplacement.Execute(...)`.
- Preserves: cleanup uses only IDs in the current operation's creation journal.

- [x] **Step 1: Write failing manifest validation tests**

Add tests proving duplicate Shape IDs, an empty semantic list, blank semantic IDs, and duplicate semantic IDs are rejected, while canonical ordering is stable:

```csharp
var journal = new SelectedPageShapeCreationJournal();
journal.Record(21, new[] { "semantic:b", "semantic:a" }, SelectedPageShapeRole.Primary);

var entry = Assert.Single(journal.Entries);
Assert.Equal(21, entry.ShapeId);
Assert.Equal(new[] { "semantic:a", "semantic:b" }, entry.SemanticIds);
Assert.Throws<WorkerProtocolException>(() =>
    journal.Record(21, new[] { "semantic:c" }, SelectedPageShapeRole.Label));
Assert.Throws<WorkerProtocolException>(() =>
    new SelectedPageShapeCreationJournal().Record(22, Array.Empty<string>(), SelectedPageShapeRole.Primary));
```

Update the fake mutation to record semantic entries and assert the returned promoted manifest contains only renderer-created IDs, never externally inserted ID `40`.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj -c Release --filter FullyQualifiedName~SelectedPageOwnedRegionReplacementTests
```

Expected: compilation fails because `SelectedPageShapeRole`, `SelectedPageShapeCreationEntry`, `Entries`, and the manifest return type do not exist.

- [x] **Step 3: Implement immutable journal entries and manifest return**

Implement the journal around a Shape-ID keyed dictionary and freeze every public collection:

```csharp
internal enum SelectedPageShapeRole { Primary, Auxiliary, Label, Annotation, Connector, Title }

internal sealed record SelectedPageShapeCreationEntry(
    int ShapeId,
    IReadOnlyList<string> SemanticIds,
    SelectedPageShapeRole Role);

internal sealed class SelectedPageShapeCreationJournal
{
    private readonly Dictionary<int, SelectedPageShapeCreationEntry> _entries = [];

    internal IReadOnlyList<SelectedPageShapeCreationEntry> Entries =>
        _entries.Values.OrderBy(entry => entry.ShapeId).ToArray();

    internal IReadOnlySet<int> ShapeIds => _entries.Keys.ToFrozenSet();

    internal void Record(int shapeId, IEnumerable<string> semanticIds, SelectedPageShapeRole role)
    {
        var canonical = semanticIds
            .Select(value => value?.Trim() ?? string.Empty)
            .Order(StringComparer.Ordinal)
            .ToArray();
        if (shapeId <= 0 || canonical.Length == 0 || canonical.Any(string.IsNullOrWhiteSpace)
            || canonical.Distinct(StringComparer.Ordinal).Count() != canonical.Length
            || !_entries.TryAdd(shapeId, new SelectedPageShapeCreationEntry(shapeId, canonical, role)))
            throw new WorkerProtocolException("Selected-page renderer reported an invalid shape creation manifest entry.");
    }
}
```

Return `SelectedPagePromotedRegionManifest` only after staging and promotion verification succeed. If old-ID cleanup fails after promotion, preserve the existing typed promoted failure behavior.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 command. Expected: all replacement tests pass, including external ID `40`, zero-shape, draw failure, staging failure, promotion failure, target switch, and partial deletion.

- [x] **Step 5: Commit Task 1**

```powershell
git add workers/visio-worker/src/VisioWorker.Live/SelectedPageOwnedRegionReplacement.cs workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageOwnedRegionReplacementTests.cs
git commit -m "feat: record exact selected-page shape semantics"
```

---

### Task 2: Make every native creation path report exact semantic context

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs`
- Modify: `workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageRenderingContractTests.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComBackendTests.cs`

**Interfaces:**
- Changes: `DrawPreparedSelectedPageRegion(page, preparedRegion, Action<int, IReadOnlyList<string>, SelectedPageShapeRole> onShapeCreated)`.
- Adds: `ShapeTrackingPage.WithCreationContext(semanticIds, role, draw)` so semantic authority exists before native creation.
- Consumes: exact journal from Task 1.
- Removes: `SourceMappingSemanticIds(shape, plan)` name inference and all-node fallback.

- [x] **Step 1: Write failing renderer-contract tests**

Extend the existing source contract test to require the three-argument creation callback and to reject any selected-page drawing call that lacks an explicit creation context. Add behavior tests asserting:

```csharp
Assert.All(created, entry => Assert.NotEmpty(entry.SemanticIds));
Assert.Contains(created, entry => entry.Role == SelectedPageShapeRole.Primary);
Assert.Contains(created, entry => entry.Role == SelectedPageShapeRole.Label);
Assert.Contains(created, entry => entry.Role == SelectedPageShapeRole.Connector);
Assert.DoesNotContain(source, "return plan.Nodes");
Assert.DoesNotContain(source, "SourceMappingSemanticIds(object shape, DiagramDocument plan)");
```

Use an anonymous formal figure-plan fixture with a primitive group, group label, connector, and title. Assert every returned native Shape ID has one exact deterministic semantic mapping.

- [x] **Step 2: Run renderer/backend tests and verify RED**

Run:

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj -c Release --filter "FullyQualifiedName~SelectedPageRenderingContractTests|FullyQualifiedName~SelectedPageVisioComBackendTests"
```

Expected: compilation or contract failures because the callback carries only an ID and source mapping still uses name inference/fallback.

- [x] **Step 3: Add scoped semantic creation context**

Implement one creation method that binds semantic context before invoking native Visio:

```csharp
internal dynamic Draw(
    IReadOnlyList<string> semanticIds,
    SelectedPageShapeRole role,
    Func<dynamic, dynamic> create)
{
    var canonical = CanonicalSemanticIds(semanticIds);
    dynamic shape = create(_nativePage);
    _onShapeCreated(Convert.ToInt32(shape.ID, CultureInfo.InvariantCulture), canonical, role);
    return shape;
}
```

Route `DrawRectangle`, `DrawOval`, `DrawLine`, and `DrawPolyline` through this method. Update every selected-page creation call with explicit semantics:

- primitive body/faces/planes/units: the group's required `pvp.componentId`, role `Primary` for the main primitive and `Auxiliary` for supporting geometry;
- group label: the referenced group's `pvp.componentId`, role `Label`;
- connector: the canonical source and target group component IDs, role `Connector`;
- figure title: the unique required `pvp.planId`, role `Title`;
- legacy node path: node `pvp.componentId` or node ID, with exact label/auxiliary roles;
- legacy stage label: canonical semantic IDs of nodes in that stage, role `Annotation`;
- legacy legend: do not execute in the selected-page formal-PVP path; retain legacy export behavior with the no-op callback only.

Do not derive semantic authority from `NameU`. Names remain diagnostic only.

- [x] **Step 4: Write Shape Data from the manifest**

Change `TagAndVerifyShapes` to consume exact manifest entries and write:

```text
synapse.sourceMappingSemanticIds=<canonical comma-separated entry.SemanticIds>
synapse.rendererRole=<entry.Role>
```

Verify both values immediately. Reject a drawn Shape ID that is absent from the manifest, and reject a manifest ID that is absent from the page.

- [x] **Step 5: Run renderer/backend tests and verify GREEN**

Run the Task 2 command. Expected: all renderer and backend tests pass and every native creation path is covered by exact semantic reporting.

- [x] **Step 6: Commit Task 2**

```powershell
git add workers/visio-worker/src/VisioWorker.Live/VisioComEngine.cs workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageRenderingContractTests.cs workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComBackendTests.cs
git commit -m "fix: bind selected-page shapes to exact semantics"
```

---

### Task 3: Enforce exact promoted-region readback and pre-save authorization

**Files:**
- Modify: `workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComBackendTests.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageWorkerReadbackContractTests.cs`
- Modify: `workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageSessionManagerTests.cs`

**Interfaces:**
- Consumes: `SelectedPagePromotedRegionManifest` from Task 1.
- Adds internal session state: expected promoted manifest, pre-save verified hash, saved flag.
- Preserves: public `SelectedPageReadback` DTO and v3 JSON schema.
- Changes: `SaveSelectedDocument` requires a current successful pre-save verification.

- [x] **Step 1: Write failing exact-readback tests**

Add separate tests for:

```text
empty final namespace -> failure
one expected ID missing -> failure
unexpected extra final-owned ID -> failure
duplicate native ID -> failure
empty semantic mapping -> failure
wrong semantic mapping -> failure
wrong renderer role -> failure
unrelated user Shape -> ignored and counted
all exact entries present -> valid readback
```

Add a save-gate test:

```csharp
Assert.Throws<WorkerProtocolException>(() => native.SaveSelectedDocument(target));
native.ReadSelectedPage(target, ownershipNamespace);
native.SaveSelectedDocument(target);
```

The first call must fail before the fake document's `Save()` counter increments.

- [x] **Step 2: Run readback/backend tests and verify RED**

Run:

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj -c Release --filter "FullyQualifiedName~SelectedPageVisioComBackendTests|FullyQualifiedName~SelectedPageWorkerReadbackContractTests|FullyQualifiedName~SelectedPageSessionManagerTests"
```

Expected: failures because readback accepts a schema-valid subset and save has no pre-save verification gate.

- [x] **Step 3: Store and validate the expected manifest**

After successful apply, store the immutable manifest in `SelectedPageVisioComNative`. In `ReadSelectedPage`, build the actual manifest only from Shapes carrying the exact final ownership namespace. Compare expected and actual by Shape ID, semantic IDs, and renderer role. Throw `WorkerProtocolException` on any missing, extra, duplicate, empty, or mismatched entry.

Compute an internal canonical SHA-256 from target identity, namespace, and sorted manifest entries:

```text
shapeId|role|semanticId1,semanticId2\n
```

The first successful read after apply sets `_preSaveVerifiedHash`. `SaveSelectedDocument` requires that hash and clears it after save while storing `_savedManifestHash`. A read after save must reproduce `_savedManifestHash`.

- [x] **Step 4: Preserve failure truth**

Reset verification state on attach, apply start, failed apply, target mismatch, and session release. A failed pre-save read never authorizes save. A failed save never authorizes terminal verification. A failed post-save read returns failure and does not erase the fact that save may have occurred.

- [x] **Step 5: Run readback/backend tests and verify GREEN**

Run the Task 3 command. Expected: all exact readback, save-gate, session, and protocol tests pass.

- [x] **Step 6: Commit Task 3**

```powershell
git add workers/visio-worker/src/VisioWorker.Live/SelectedPageVisioComBackend.cs workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageVisioComBackendTests.cs workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageWorkerReadbackContractTests.cs workers/visio-worker/tests/VisioWorker.Core.Tests/SelectedPageSessionManagerTests.cs
git commit -m "fix: verify selected-page shapes before save"
```

---

### Task 4: Change TypeScript orchestration to read-save-read

**Files:**
- Modify: `apps/api/src/visio-worker-client.ts`
- Modify: `apps/api/src/current-page-visio-adapter.ts`
- Modify: `apps/api/tests/current-page-visio-adapter.test.ts`
- Modify: `apps/api/tests/visio-worker-client.test.ts`
- Modify: `apps/api/tests/selected-page-routes.test.ts`

**Interfaces:**
- Changes command order to `attach`, `apply`, `read-before-save`, `save`, `read-after-save`, `close`.
- Produces: two unique read request IDs.
- Preserves: `CurrentPageVisioDrawResult` public shape; successful result returns the post-save readback.

- [x] **Step 1: Write failing command-order and failure tests**

Change the expected order to:

```ts
expect(commands.map((command) => command.command)).toEqual([
  "attachSelectedPage",
  "applyOwnedRegion",
  "readSelectedPage",
  "saveSelectedDocument",
  "readSelectedPage",
  "closeSession",
]);
expect(commands.map((command) => command.requestId)).toEqual([
  "request-attach",
  "request-apply",
  "request-read-before-save",
  "request-save",
  "request-read-after-save",
  "request-close",
]);
```

Add tests proving:

- a failed pre-save read does not send save;
- a pre/post readback mismatch returns failure;
- a failed save does not send post-save read;
- a failed post-save read returns failure;
- close runs exactly once on every attached path;
- success returns only the post-save readback.

- [x] **Step 2: Run TypeScript selected-page tests and verify RED**

Run:

```powershell
npx.cmd vitest run apps/api/tests/current-page-visio-adapter.test.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/selected-page-routes.test.ts
```

Expected: order and failure tests fail because the current sequence saves before its only read and returns on the first read.

- [x] **Step 3: Build two read commands with unique identities**

In `buildSelectedPageVisioSessionCommands`, create `read-before-save` and `read-after-save` commands and return the six-command sequence. Do not add a new command kind or protocol field.

- [x] **Step 4: Enforce orchestration state**

In `CurrentPageVisioAdapter.draw`, track `attached`, `closed`, `preSaveReadback`, and `postSaveReadback`. Do not return on the first read. Before executing save, require a successful pre-save readback. Compare canonical public readback fields before accepting the second read:

```ts
function sameSelectedPageReadback(left: Readback, right: Readback): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
```

Return the post-save readback only after the close command succeeds. In `finally`, send close only when attach succeeded and the normal close command did not complete.

- [x] **Step 5: Run TypeScript selected-page tests and verify GREEN**

Run the Task 4 command. Expected: all selected-page command-order, lifecycle, route, timeout, and projection tests pass.

- [x] **Step 6: Commit Task 4**

```powershell
git add apps/api/src/visio-worker-client.ts apps/api/src/current-page-visio-adapter.ts apps/api/tests/current-page-visio-adapter.test.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/selected-page-routes.test.ts
git commit -m "fix: verify selected page before and after save"
```

---

### Task 5: Cross-layer verification, review, and implementation record

**Files:**
- Modify: `docs/agent-governance/implementation-records/operation-history.md`
- Modify: `docs/superpowers/plans/2026-08-26-selected-page-verification-a1.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: exact verification evidence and remaining-boundary record.

- [x] **Step 1: Run the complete A1 focused matrix**

Run C# and TypeScript tests sequentially where they share build outputs:

```powershell
dotnet test workers/visio-worker/tests/VisioWorker.Core.Tests/VisioWorker.Core.Tests.csproj -c Release --filter "FullyQualifiedName~SelectedPageOwnedRegionReplacementTests|FullyQualifiedName~SelectedPageRenderingContractTests|FullyQualifiedName~SelectedPageVisioComBackendTests|FullyQualifiedName~SelectedPageWorkerReadbackContractTests|FullyQualifiedName~SelectedPageSessionManagerTests"
npx.cmd vitest run apps/api/tests/current-page-visio-adapter.test.ts apps/api/tests/visio-worker-client.test.ts apps/api/tests/selected-page-routes.test.ts apps/api/tests/visio-session-protocol.test.ts
```

Expected: zero failures and zero unexpected skips.

- [x] **Step 2: Run repository gates**

Completed with the known baseline exception: the full API suite remains non-green at `1,226 passed / 5 failed` across three A1-base-unchanged files. This step records execution and classification, not a full-suite pass.

Run:

```powershell
dotnet test workers/visio-worker/VisioWorker.sln -c Release
dotnet build workers/visio-worker/VisioWorker.sln -c Release --no-restore
npx.cmd tsc --noEmit
npm.cmd run api:check
npm.cmd run api:test
git diff --check
```

Release test and build must run sequentially. Record the two installed-Visio skips separately. If the known baseline roadmap/CRLF failures remain, prove their files are unchanged from the A1 base and do not report the complete API suite as passing.

- [x] **Step 3: Request independent review**

Final whole-branch result at `b89bcf4`: **Approved / Ready to merge for the stated A1 scope**, with `0 Critical`, `0 Important`, and `0 Minor` code findings.

Require explicit review of:

- exact semantic context before every native creation;
- no name/all-node mapping authority;
- exact expected/actual ID partition;
- unrelated external Shape isolation;
- save impossible before successful pre-save verification;
- equal post-save verification before API success;
- close exactly once;
- no public protocol or model-specific expansion;
- truthful A2/process-crash/real-Visio exclusions.

Fix every Critical and Important finding, rerun its covering tests, and request re-review.

- [x] **Step 4: Record evidence and boundaries**

Append the exact RED/GREEN commands, test counts, review result, and commits to operation history. State explicitly that A1 does not implement cancellation during native apply, durable leases, process-termination recovery, save/close/reopen acceptance, or publication-aesthetic improvement.

- [x] **Step 5: Commit the record**

```powershell
git add docs/agent-governance/implementation-records/operation-history.md docs/superpowers/plans/2026-08-26-selected-page-verification-a1.md
git commit -m "docs: record selected-page verification gate"
```

- [ ] **Step 6: Push only when requested**

Not requested in this phase; no push was performed.

Before push, require a clean worktree and verify the remote SHA after a normal non-force push.
