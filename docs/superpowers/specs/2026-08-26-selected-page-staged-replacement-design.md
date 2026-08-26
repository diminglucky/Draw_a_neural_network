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

## State machine

```text
prepared target-bound plan
  -> remove stale shapes from this operation's deterministic staging namespace
  -> capture old final-owned shape IDs
  -> capture all pre-existing shape IDs
  -> draw replacement without deleting old shapes
  -> compute exact newly created shape IDs
  -> reject an empty replacement
  -> tag and verify every new shape under the staging namespace
  -> promote and verify every staged shape to the final namespace
  -> delete only the previously captured old shape IDs
  -> return
```

If drawing, new-shape discovery, staging, source mapping, or promotion fails, delete only shape IDs created after the baseline capture and rethrow. The old final-owned shape IDs are not touched. If final old-shape deletion fails, retain the promoted replacement and report failure; a later retry may remove the remaining captured old shapes. Availability is preferred over silently leaving an empty page.

## Components

### Pure replacement coordinator

`SelectedPageOwnedRegionReplacement` owns ordering and failure semantics. It depends on a narrow `ISelectedPageShapeMutation` interface and contains no COM objects, page discovery, topology logic, or rendering logic. Unit tests drive it with an in-memory fake and cover every transition.

### COM shape mutation adapter

`SelectedPageVisioComNative` implements the mutation interface against its already-attached `_page`. Existing helpers are narrowed from namespace-wide implicit scans to exact shape-ID operations:

- read all shape IDs;
- read IDs carrying one exact ownership marker;
- draw the already-prepared region;
- tag and verify one exact set of new IDs;
- promote and verify one exact staged set;
- delete one exact set of IDs.

The deterministic staging namespace is a SHA-256 value derived from a fixed version label, the final namespace, and the target document/page fingerprints. It is not geometry input and is never returned through the public protocol.

## Invariants

- The previous final-owned shapes remain present until every new shape has a verified staging marker, non-empty source mapping, and verified final marker.
- User shapes, foreign ownership namespaces, and unrelated stale shapes are never selected by broad deletion during final replacement.
- Cleanup after a pre-promotion failure targets only IDs absent from the pre-draw baseline.
- A successful replacement cannot delete newly promoted shapes because final cleanup uses the old ID snapshot rather than the ownership namespace.
- The current-page target is still revalidated before native apply, and the prepared token remains required.
- The public selected-page command, response, PVP, and native-intent schemas do not change.

## Acceptance

- Success ordering is proven by a pure test.
- Draw, staging, source-mapping, and promotion failures clean only new IDs and leave old IDs untouched.
- Zero created shapes fails before old-shape deletion.
- Final cleanup deletes captured old IDs only after successful promotion.
- A final cleanup failure does not delete the promoted replacement.
- Focused replacement and selected-page tests pass, followed by the full Release Worker suite and build.
- Real Visio live acceptance, save/reopen, process-crash recovery, and screenshot review remain separate gates.

## Deferred work

- Persisted recovery for a Worker/process crash between promotion and old-shape cleanup.
- API-visible page-layout observation and page-layout hash sealing.
- User-shape obstacle avoidance and pre-preview page-aware reflow.
- Real-host verification that Visio preserves expected shape IDs and Shape Data through save/reopen.
