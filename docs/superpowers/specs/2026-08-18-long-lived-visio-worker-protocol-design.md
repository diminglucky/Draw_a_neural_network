# Long-Lived Visio Worker Protocol Design

## Status and scope

This design extends the existing reusable COM document/session implementation into a durable local Worker boundary. It is intentionally limited to the publication-quality neural-network drawing workflow:

```text
authenticated Agent/API -> validated AnalysisPlanSnapshot -> fixed session command -> editable Visio VSDX
```

It does not create a general desktop-control agent. The Worker never accepts COM member names, VBA, shell commands, PowerShell, script text, browser-originated automation, arbitrary paths, or arbitrary document content.

Protocol version 1 remains the existing one-shot `RenderAsync` contract. This design adds a sealed protocol version 2 for persistent sessions.

## Goal

For the exact key `(tenantId, userId, deviceId, workflowId)`, preserve one editable Visio document and one page through iterative Agent changes. The user must never receive a new blank canvas merely because an incremental operation, idle timeout, Worker restart, Visio restart, or machine restart occurred.

The long-lived Worker keeps a live document/page while the session is active. After an idle timeout it safely persists the VSDX and closes native resources. A later valid command restores that same VSDX/page before applying the next update.

## Non-goals

- No generic desktop automation API.
- No direct browser-to-Worker connection.
- No client-supplied recovery manifest.
- No cross-owner session lookup.
- No auto-overwrite of an arbitrary user document.
- No claim that unit or recorder tests prove installed-Visio acceptance.

## Architecture

```text
Browser
  -> authenticated API and device/session fence
  -> validated analysis snapshot and confirmation token
  -> local Worker process supervisor
  -> long-lived JSON-lines Worker v2 runtime
       -> session registry and recovery-manifest store
       -> one ComStaRunner and VisioComEngine
       -> one live Visio document/page per open session
       -> VSDX output root
```

The API remains responsible for authentication, tenant/user/device authorization, confirmation, and approved snapshot projection. It sends only an allowlisted v2 command to the local Worker. The Worker independently validates the command syntax, session identifiers, output-root containment, and operation identity but does not trust a browser to supply native actions.

One `LongLivedWorkerRuntime` owns a single `VisioComEngine`, its session backend, a `VisioSessionManager`, a persistent manifest store, and an idle scheduler. The runtime is created once when the local Worker starts and is disposed only when the Worker shuts down.

## Session identity and resource lifecycle

The exact session key is:

```text
tenantId + userId + deviceId + workflowId
```

Every identifier uses the existing bounded identifier validation. A session state remains private to this key. A request carrying another owner, device, or workflow cannot discover or reuse the document/page handle.

### Open session

An `open` command binds a session to one normalized `.vsdx` output path under the configured output root. If the session is already open, `open` returns its public snapshot and does not create a document or page. If the session was safely closed or the Worker restarted, `open` loads the saved manifest and explicitly recovers the bound VSDX.

### Idle policy

The default idle interval is exactly 15 minutes. The runtime updates last-activity time after every accepted command. A scheduler runs once per minute using an injectable clock.

When a session remains idle for 15 minutes:

1. If it is Dirty, call the fixed `save` path using the previously bound normalized path.
2. Atomically persist the recovery manifest.
3. Explicitly close the native document/page.
4. Retain only durable state and public session metadata.

The timeout never discards an unsaved plan and never creates a replacement document. If save or close is uncertain, mark the session Recovering and report a fail-closed runtime error rather than silently opening another canvas.

### Capacity policy

The runtime has a bounded active-session limit. When the limit is reached, it first applies the same safe idle checkpoint procedure to the least-recently-active open session. A session that cannot be safely checkpointed blocks the new open request; it is never evicted by deleting its document or VSDX.

### Explicit close

`close` has one allowlisted disposition:

- `save`: save to the session-bound output path, persist the manifest, then close.
- `discard`: explicitly discard unsaved changes and close. The last successfully saved VSDX and manifest remain recoverable.

No default close behavior is inferred from a missing field.

## Persistent recovery manifest

The Worker owns the manifest store. Manifests are written atomically beneath a private subdirectory of the configured output root. A client never uploads one.

The persisted model contains only:

- format version;
- exact session key;
- normalized bound VSDX path;
- last successful plan hash;
- bounded operation journal;
- persisted save time and last activity time;
- public page identity needed for recovery diagnostics.

It contains no API keys, headers, provider data, free-form COM information, opaque live handles, or raw user input. A Worker restart reads a manifest only after it validates the exact session key and output-root path. Recovery opens only the manifest-bound VSDX.

## Sealed protocol v2

The Host continues reading newline-delimited JSON but no longer exits after the first version-2 request. Every request contains exactly the fields allowed for its command; unknown fields are rejected before a runtime operation occurs.

The common envelope is:

```json
{
  "protocolVersion": 2,
  "requestId": "request-123",
  "command": "applyDiff",
  "session": {
    "tenantId": "tenant-1",
    "userId": "user-1",
    "deviceId": "device-1",
    "workflowId": "workflow-1"
  }
}
```

The command enumeration is exactly:

```text
open | apply | applyDiff | save | snapshot | close | recover
```

### Command fields

| Command | Required fields beyond the common envelope | Result |
| --- | --- | --- |
| `open` | `outputPath` | Existing or recovered public snapshot |
| `apply` | `operationId`, `planHash`, `diagram` | Public snapshot and replay status |
| `applyDiff` | `operationId`, `planHash`, `diagram` | Public snapshot and replay status |
| `save` | none | Public saved snapshot |
| `snapshot` | none | Public snapshot only |
| `close` | `disposition` (`save` or `discard`) | Public closed snapshot |
| `recover` | none | Public recovered snapshot |

`operationId` and `planHash` are required only by `apply` and `applyDiff`. Existing Core semantics reject reuse of an operation ID with another plan hash and treat exact plan replays as no native mutation. The runtime extends command-level replay handling for transport retries of `open`, `save`, and `close` using their stable `requestId` and a bounded per-session command ledger.

Responses expose only public values: request ID, command, status, replay flag, session state, last plan hash, saved path relative to the output root when authorized, and safe diagnostics. They never expose COM pointers, native document handles, private manifest paths, or arbitrary exception detail.

## Error and cancellation rules

- Parse, unknown field, unknown command, invalid identifier, invalid enum, invalid path, and invalid diagram failures occur before native work.
- Cancellation after possible COM admission is uncertain and moves the session to Recovering.
- A missing manifest for `recover` fails; it does not create a document.
- A duplicate `open` returns the existing/recovered state; it does not call document creation again.
- Any ownership-marker, save, close, or recovery uncertainty fails closed and preserves the last known safe manifest for diagnostics.

## Compatibility

Version 1 requests preserve their existing single-render behavior. Version 2 is selected only by `protocolVersion: 2`. A v1 request cannot carry v2 fields, and a v2 request cannot use v1's implicit one-shot rendering field shape.

## Verification and acceptance gates

### Automated protocol/runtime evidence

- Unknown-field rejection for every command shape.
- Command enumeration rejection with no runtime/COM mutation.
- Stable session key and operation identity round trips.
- Same-key `open` and repeated `apply` use one native document/page.
- Cross-owner/device/workflow isolation.
- Command replay does not repeat native work.
- Controlled-clock 15-minute idle checkpoint saves, closes, and retains a recoverable manifest.
- Worker restart recreates the runtime, loads the manifest, and recovers the bound VSDX instead of creating a blank document.
- Capacity pressure checkpoints only safely idle sessions and blocks unsafe eviction.
- Cancellation and manifest/path tampering fail closed.

### Real Windows/Visio acceptance evidence

On a Windows host with Microsoft Visio installed, run a manually gated acceptance test that proves:

1. open -> apply -> applyDiff reuses one document/page;
2. unmarked user shapes survive an Agent update;
3. session-owned shapes are reconciled without duplicates;
4. 15-minute idle checkpoint saves and closes;
5. a fresh Worker runtime recovers the saved VSDX and applies another diff on the same page;
6. independent native readback validates semantic Shape Data, connector IDs, labels, and expected page identity.

The test must report its result separately from unit and build evidence.

## Delivery order

1. Strict v2 request/response data model and parser tests.
2. Runtime ownership, command dispatch, and public snapshot tests using a recording backend.
3. Atomic manifest store and controlled-clock idle scheduler tests.
4. Program JSON-lines loop and v1 compatibility tests.
5. Real Visio acceptance test and host lifecycle proof.
6. Only then bind the authorized Agent/API path to v2 commands.
