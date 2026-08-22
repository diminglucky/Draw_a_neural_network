# Visible, Persistent Visio Session Design

## Goal

After the user confirms a neural-network figure, the Worker must keep one editable Visio VSDX and one native Page visibly open while it applies the approved plan and later diffs.  The user, not a background test, controls when that visible session ends.

## Scope

This design changes only the Windows Visio Worker lifecycle.  It does not add API-to-Worker transport, UI streaming, billing, providers, or unrestricted desktop control.

## Modes

The existing `Visible` option is a lifecycle boundary, not merely a UI preference.

| Mode | Options | Window/document after `apply` or `applyDiff` | Exit contract |
| --- | --- | --- | --- |
| controlled acceptance | `Visible=false`, `AttachToRunning=false` | hidden; Worker owns the application | close documents, request `Quit`, then prove the owned Windows process has exited |
| user-visible Worker session | `Visible=true`, `AttachToRunning=false` | the original VSDX and its identified Page remain visible and fitted | retain the application until explicit `close` or Worker disposal; cleanup applies only to the owned application |
| attached user session | `AttachToRunning=true` | existing user application is never treated as Worker-owned | never issue process termination, whether close succeeds or fails |

`apply` and `applyDiff` remain serialized on the existing STA runner.  They reconcile only shapes bearing the session ownership marker, preserving unmarked user shapes and the same native document/page identity.

## Owned application identity and exit

`Visio.Application.ProcessID` is not the Windows OS PID on the installed Visio build, so it must never be supplied to process APIs.  When the Worker creates an application (`AttachToRunning=false`), it obtains `Application.WindowHandle32`, resolves the actual PID with `GetWindowThreadProcessId`, and records that PID as an owned lease.  A hidden application was verified to expose a nonzero handle, so PID capture does not require toggling it visible.

Cleanup proceeds in this exact order on the COM STA:

1. Close/release Worker-opened documents and their page RCWs.
2. Release document collection references, request `Application.Quit`, and release the application RCW.
3. Await bounded process exit only for the recorded owned PID.
4. If the PID remains alive after the bounded wait, terminate only that PID after confirming it is still `VISIO.EXE` with the Worker-created start identity.
5. If PID capture, identity validation, or termination cannot be proven, fail closed and report the lifecycle failure.  Never search for or terminate arbitrary Visio processes.

The forced final step is a recovery boundary for an owned automation server only.  It is forbidden for `AttachToRunning=true` and for instances without a verified lease.

## Verification

Unit tests must prove lease rules independently of installed Visio: visible mode keeps its document/application through ordinary drawing, hidden mode requests owned cleanup, attached mode has no cleanup lease, and an unverified lease cannot terminate a process.

The opt-in installed-Visio acceptance test must prove:

1. hidden mode produces/recoveries the same VSDX/page and terminates its exact owned process;
2. visible mode creates and saves an editable VSDX, keeps it open while an `applyDiff` updates the same Page, preserves a user shape, and leaves the visible document open until explicit close;
3. an independent COM readback validates shapes, connector, text, ownership data, native document/page identities, and removal of replaced Agent shapes;
4. no Worker-owned `VISIO.EXE` remains after explicit close, while a separately started user Visio instance is never targeted.

## Non-goals

This task initially did not claim that a browser/API could stream drawing progress into the Worker. That limitation has been superseded by the confirmed API transport extension below.

## Confirmed API transport extension

The previous one-shot API client is incompatible with a visible session: it writes a single v1 request, closes stdin, then waits for the Worker process to exit. EOF is therefore an implicit `close`, which causes a visible Visio document to flash and disappear even when the Worker lifecycle is correct.

The API will own a bounded v2 JSON-lines child process per authenticated `(tenantId, userId, deviceId, workflowId)` session. It keeps stdin open after the first response and serializes commands for that session:

| Product action | Worker command sequence | Window behavior |
| --- | --- | --- |
| first confirmed render | `open`, `apply`, `save` | create one VSDX/Page and keep it visible |
| confirmed revision | `applyDiff`, `save` | update the same VSDX/Page; no new blank document |
| user ends session or API shutdown | `close(save)`, then close child stdin | save and close only the Worker-owned application |
| API restart before a revision | start a fresh child, `recover`, then `applyDiff` | recover the durable Worker-owned manifest without guessing a document |

Each accepted `apply` and `applyDiff` must return actual native readback from the currently open page. API code must not manufacture successful readback from the requested diagram. The legacy v1 one-shot protocol remains supported for existing non-visible integrations. No generic COM, Shell, VBA, process, or filesystem-control field is added to either protocol.

The API must not reimplement the .NET canonical plan digest. For v2 `apply` and `applyDiff`, the Worker derives the digest after parsing and mapping its typed diagram. A caller may provide a `planHash` only as an optional consistency assertion; if provided and it differs from the Worker-derived digest, the command fails closed. The Worker uses its own derived digest for operation replay and durable identity.
