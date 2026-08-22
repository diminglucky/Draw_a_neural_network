# Reusable Visio Document Session Design

## Goal

Keep one editable Visio document and one page alive for the lifetime of a drawing workflow, and apply later plans as idempotent increments instead of opening a new canvas for every node, edge, or update.

## Session identity and state

Every session is addressed by the tuple `(tenantId, userId, deviceId, workflowId)`. The manager rejects invalid identifiers and never allows one owner/device/workflow key to observe another key.

The state machine is:

```text
Created -> Open -> Dirty -> Saving -> Open
Open/Dirty -> Closed
Open/Dirty -> Recovering -> Open | Closed
```

`Created` means a manager record exists but no native document is attached. `Open` means exactly one native document and one page are attached. `Dirty` means at least one accepted operation has not been saved. `Saving` serializes all COM work. `Closed` releases the document/page handles. `Recovering` is entered after a lost native handle or worker restart and can reopen the last safe VSDX only after validating the session manifest.

## Backend boundary

The Core project owns the pure session key, state, operation identity, and manager semantics. A small backend interface owns native operations:

```text
CreateOrOpenDocument(sessionKey, targetPath)
ApplyPlan(document, page, plan)
SaveAs(document, temporaryPath, finalPath)
Close(document)
Recover(sessionKey, path)
```

The Live project supplies the COM backend. All backend calls execute through the existing `ComStaRunner`; no API code, browser code, shell, VBA, or arbitrary COM command is accepted. The first implementation can use a test backend to prove semantics, but mock evidence must not be reported as real Visio acceptance.

## Idempotent increment rules

Each plan has a required `planHash`; each operation has a required stable `operationId`. The session records applied plan/operation identities and the resulting semantic shape IDs. Replaying an already applied identity returns the previous result and performs no backend mutation. A new plan updates existing semantic shapes/connectors by ID, creates only missing items, and removes only items explicitly marked as deleted by the plan diff. It never creates a second document or page for the same session key.

## Lifecycle rules

- `OpenOrReuse` returns the existing session when the exact key is already open.
- `ApplyPlan` and `ApplyPlanDiff` reuse the same document/page.
- `SaveAs` writes to a validated temporary path and atomically publishes the VSDX.
- `Close` is explicit and idempotent; completion and cancellation call it once.
- Timeout or worker loss marks the session `Recovering` or safely `Closed`; it does not silently create a second live canvas.
- Recovery is allowed only from a session manifest containing owner/device/workflow identity, last applied plan hash, page identity, and VSDX path under the configured output root.

## Acceptance evidence

- RED tests prove one document/page for repeated `OpenOrReuse`, no duplicate Shapes on plan replay, state transitions, owner isolation, close, and recovery.
- GREEN Core/Live focused tests pass and the Worker solution builds.
- A later real-host gate must use Windows plus Microsoft Visio and independently verify the same document/page across multiple increments, VSDX save, close/reopen, native shape/connector/text/shape-data readback, and renderer QA. Core tests alone cannot claim that gate.
