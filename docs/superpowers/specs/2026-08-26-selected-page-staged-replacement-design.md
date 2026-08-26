# Selected-Page Staged Owned-Region Replacement Design

**Status:** approved continuation of the selected-page safety work

## Goal

Keep the last verified Agent-owned Visio region intact until a complete replacement has been drawn, source-mapped, ownership-tagged, and verified on the same selected page.

## Problem boundary

Preflight-before-mutation prevents deterministic page-fit and readability failures from deleting the old region. After preflight succeeds, however, the current native path still deletes the old ownership namespace before drawing and tagging the replacement. A COM draw failure, shape-data failure, or source-mapping failure can therefore leave the user with no complete Agent figure.

This slice addresses failures through replacement preparation and promotion. It does not claim that Visio exposes an atomic multi-shape transaction or that save/readback failures can be rolled back across process crashes.

## Considered approaches

1. **Visio undo scope:** wrap deletion and drawing in a COM undo scope. This depends on application/version-specific undo behavior, is difficult to verify without a real host, and does not provide a strong process-crash boundary.
2. **Delete and reconstruct on failure:** retain the old behavior and redraw the previous plan after an error. This requires another complete rendering operation in an already failing COM session and can lose user state twice.
3. **Staged replacement by exact shape IDs:** draw the replacement while the old region remains, classify every newly created shape by ID, attach a temporary ownership namespace and source mappings, verify and promote those exact shapes, then delete only the captured old shape IDs. This is the selected approach.

## Review revision: exact render identity, final target check, and observable cleanup

The first implementation draft discovered new shapes by subtracting a pre-draw page-wide Shape ID snapshot from a post-draw snapshot. Independent review rejected that as an ownership proof: a user, add-in, or other automation could create a shape during the same interval and have that unrelated shape staged, promoted, or deleted by the Agent.

The accepted revision makes the renderer authoritative for creation identity. `DrawPrepared` receives an operation-scoped creation journal. Every native shape creation path records the returned Visio Shape ID immediately, before styling or any later fallible operation. The coordinator may tag, promote, or clean only IDs present in that journal. Page-wide ID difference remains forbidden as an ownership decision.

The revision also adds two final safety boundaries:

- immediately before old final-owned IDs are deleted, the live adapter must re-read `Application.ActiveWindow.Page` and prove that the selected target still matches the prepared document, page, fingerprints, and revision;
- exact-ID deletion returns a structured outcome containing requested, deleted, missing, and failed IDs. A partially completed old-region cleanup raises a typed internal failure that records `replacementPromoted=true` and the cleanup outcome, so callers and tests can distinguish an intact old region from a partially removed one.

The existing API lease is an authorization and one-use binding; it is not treated as a UI mutex. Exact renderer-created IDs prevent concurrent external shapes from being claimed. A selected-page operation remains serialized by the single Worker command loop, while external Visio interaction is handled by exact creation identity plus target revalidation.

## State machine

```text
prepared target-bound plan
  -> remove stale shapes from this operation's deterministic staging namespace
  -> capture old final-owned shape IDs
  -> draw replacement without deleting old shapes
  -> record every renderer-created shape ID in the operation journal
  -> reject an empty replacement
  -> tag and verify every new shape under the staging namespace
  -> promote and verify every staged shape to the final namespace
  -> re-read and verify the active document/page target
  -> delete only the previously captured old shape IDs
  -> inspect the structured deletion outcome
  -> return
```

If drawing, staging, source mapping, or promotion fails, delete only IDs recorded by the renderer's operation journal and rethrow. The old final-owned shape IDs are not touched. If the selected target changes after promotion, retain both the promoted replacement and old region and report failure. If final old-shape deletion is partial, retain the promoted replacement and report the structured deleted/missing/failed state; a later in-process retry can remove remaining old IDs. Availability is preferred over silently leaving an empty page.

## Components

### Pure replacement coordinator

`SelectedPageOwnedRegionReplacement` owns ordering and failure semantics. It depends on a narrow `ISelectedPageShapeMutation` interface and contains no COM objects, topology logic, or rendering logic. Unit tests drive it with an in-memory fake and cover every transition, including external shape insertion, target change, and partial exact-ID deletion.

### COM shape mutation adapter

`SelectedPageVisioComNative` implements the mutation interface against its already-attached `_page`. Existing helpers are narrowed from namespace-wide implicit scans to exact shape-ID operations:

- read IDs carrying one exact ownership marker;
- draw the already-prepared region while recording exact returned Shape IDs;
- tag and verify one exact set of new IDs;
- promote and verify one exact staged set;
- revalidate the active selected-page target immediately before destructive cleanup;
- delete one exact set of IDs and return a structured outcome.

The deterministic staging namespace is a SHA-256 value derived from a fixed version label, the final namespace, and the target document/page fingerprints. It is not geometry input and is never returned through the public protocol.

## Invariants

- The previous final-owned shapes remain present until every new shape has a verified staging marker, non-empty source mapping, and verified final marker.
- User shapes, foreign ownership namespaces, and unrelated stale shapes are never selected by broad deletion during final replacement.
- Cleanup after a pre-promotion failure targets only IDs explicitly recorded by this renderer invocation.
- A shape created concurrently by the user, an add-in, or another automation is never selected merely because its ID appeared during rendering.
- A successful replacement cannot delete newly promoted shapes because final cleanup uses the old ID snapshot rather than the ownership namespace.
- Old-region deletion cannot start after the user switches the active document or page.
- Partial old-region deletion is observable as a typed result and cannot be reported as an undifferentiated failure.
- The current-page target is still revalidated before native apply, and the prepared token remains required.
- The public selected-page command, response, PVP, and native-intent schemas do not change.

## Acceptance

- Success ordering is proven by a pure test.
- Draw, staging, source-mapping, and promotion failures clean only renderer-recorded IDs and leave old IDs untouched.
- An externally inserted Shape ID is never staged, promoted, or cleaned.
- Zero created shapes fails before old-shape deletion.
- An active-target change after promotion fails before old-shape deletion and retains both regions.
- Final cleanup deletes captured old IDs only after successful promotion.
- A partial final cleanup failure reports deleted, missing, and failed old IDs and does not delete the promoted replacement.
- Focused replacement and selected-page tests pass, followed by the full Release Worker suite and build.
- Real Visio live acceptance, save/reopen, process-crash recovery, and screenshot review remain separate gates.

## Deferred work

- Persisted recovery for a Worker/process crash at any point in native drawing, including the irreducible interval between a COM shape creation returning and the first operation-journal/Shape Data write. This slice makes no claim that a retry after process termination converges.
- API-visible page-layout observation and page-layout hash sealing.
- User-shape obstacle avoidance and pre-preview page-aware reflow.
- Real-host verification that Visio preserves expected shape IDs and Shape Data through save/reopen.
