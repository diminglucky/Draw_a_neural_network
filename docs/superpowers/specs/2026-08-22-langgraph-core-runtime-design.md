# LangGraph Core Runtime Design

**Status:** Implemented vertical slice; not an M2.12 acceptance record.

## Decision

LangGraph JS is the orchestration core for a Drawing Run. It routes bounded stages, supports pause/resume through checkpoints, and invokes injected analyzer, interpreter, Harness, and composer services. It does not own domain truth or native authority.

## Authority split

```text
LangGraph workflow
  -> bounded service result
  -> DrawingRunCoordinator
  -> reducer + owner/device/revision CAS + event log
  -> public projection
```

The Coordinator and durable store remain authoritative for state, idempotency, cancellation, stale-result discard, and public status. A graph result is never applied directly to a route response or a Visio Worker.

## State and checkpoint policy

The graph state contains only run identity, revision, phase, artifact hashes, EvidencePack/proposal/UGS/PVP/QA hashes, assessment kind, and pause reason. Raw source, image bytes, prompts, paths, credentials, provider payloads, local graph IDs, COM commands, page targets, and Worker requests are forbidden.

Checkpoint thread IDs are derived from owner/device/run/revision through a SHA-256 digest. Production must inject a durable checkpoint saver with owner/device isolation. `MemorySaver` is test-only; the development memory app is explicitly non-durable and must not be used as restart evidence.

On API startup, the Coordinator scans the Foundation Store for non-terminal Drawing Runs and schedules each owner/device/revision through an in-flight fence. The workflow reads the scoped graph state first: an existing checkpoint with pending work is resumed with an empty graph input, while a run with no resumable task is started from its current domain artifact projection. Graph checkpoints use synchronous durability so a completed node is available to a replacement graph instance before the Coordinator applies the next reducer transition. The Coordinator still owns CAS, stale-result discard, and terminal-state authority.

## Provider boundary

The interpreter receives only a runtime-validated `ProviderContextPayload` containing bounded local fact tokens and summaries. It does not receive receipt IDs, context IDs, run IDs, owner/device IDs, public UGS IDs, raw input, paths, credentials, or native controls. Provider output is a local proposal; only the Structural Harness can mint public evidence and canonical graph IDs.

## Formal-only composition

The workflow routes `formal` assessments to composition. `clarification` pauses, `rejected` terminates, and candidate/blocking/stale/cancelled results do not create PVP, Snapshot, export, Worker, COM, or Visio work.

## Current limitations

The vertical slice has injected workflow services, owner/device/run/revision-scoped PostgreSQL checkpoints, startup recovery scheduling, owner-scoped private receipt/EvidencePack/local-proposal/formal-artifact stores, a real GPG/PVP composer, and local recovery/containment tests. `buildDefaultApp()` wires these services from one Foundation storage handle; PostgreSQL is not silently downgraded to memory. A real temporary PostgreSQL smoke has now passed migrations `001` through `014`, Drawing Run and input-artifact persistence, owner isolation, retention, and cross-connection readback; checkpoint round-trip and restart recovery still require a separate acceptance run. The adapters do not become the domain state authority. The real Provider, trusted visual review, and real Windows/Visio lifecycle evidence remain pending M2.12 and later gates.

The deterministic local lane is intentionally bounded: it can formalize only verified structural facts that the current adapters understand. The typed-declaration lane preserves verified branch, skip, and merge relations and projects only closed Add/Concat-style operation hints from analyzer-owned evidence; unproven multi-input merges, conflicting operation hints, disconnected topology, and invalid merge arity remain clarification or rejection outcomes. A blocking clarification is not a preview/export authorization; only an explicit confirmation answer can remove that blocking state before formal composition.
