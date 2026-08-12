# Visio Worker Integration Design

## Goal

Add a standalone Windows Visio export boundary to Draw_a_neural_network so the existing Agent-produced `NetworkIR`/diagram can be rendered into a validated `.vsdx` file without putting Visio COM objects inside the Node API process.

## Scope

This slice covers:

- a versioned request/response protocol between the API-side client and a local Windows Worker;
- a C# `net8.0-windows` Worker process with a headless mock engine and a late-bound Visio COM engine;
- deterministic mapping from the existing browser-compatible diagram JSON to Visio pages, shapes, text, and connectors;
- allowlisted temporary/output paths and atomic publication of successful `.vsdx` files;
- readback validation of the generated file;
- API adapter and tests that fail explicitly when the Worker is unavailable.

This slice does not cover:

- Microsoft Visio installation, licensing, or unattended desktop policy;
- arbitrary model-generated COM scripts;
- third-party circuit stencils from external repositories;
- Visio Add-ins, VSTO Ribbon UI, or `.vsdx` reverse engineering;
- billing changes beyond the existing Job and usage boundaries;
- claiming live Visio acceptance until the Windows COM smoke is run on a machine with Visio.

## Architecture

```text
AgentService
  -> validated NetworkIR and deterministic browser diagram
  -> authenticated visio-export Job
  -> API-side VisioWorkerClient
  -> private child-process JSON-lines protocol
  -> Visio Worker
       -> MockVisioEngine in test/mock mode
       -> single-threaded Visio COM gateway in live mode
  -> temp .vsdx
  -> readback validator
  -> atomic output publication
```

The first Worker transport is private child-process stdin/stdout rather than an unauthenticated TCP listener. The API starts one Worker for one export Job, sends one request, waits for one response, and terminates the Worker after the response or timeout. This keeps the first production boundary isolated and avoids shared COM state between tenants or Jobs. A future persistent Worker pool can reuse the same protocol without changing the IR contract.

## Protocol

Every request is one JSON object on one UTF-8 line:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "jobId": "uuid",
  "mode": "mock|live",
  "outputPath": "C:\\...\\published\\job.vsdx",
  "diagram": {
    "figure": { "title": "...", "stages": [] },
    "nodes": [],
    "edges": []
  }
}
```

The Worker returns exactly one JSON object:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "jobId": "uuid",
  "status": "succeeded|failed",
  "path": "C:\\...\\published\\job.vsdx",
  "readback": {
    "valid": true,
    "shapeCount": 3,
    "connectorCount": 2
  },
  "error": null
}
```

The Worker rejects unknown protocol versions, missing IDs, paths outside the configured root, invalid diagrams, and output paths that are not `.vsdx`. It never returns `succeeded` without a file and a successful readback result.

## Windows Worker

The C# Worker owns all Visio COM access. The live engine uses late-bound COM (`Visio.Application`) to avoid hard-coding a single PIA assembly version in the first slice. It creates or attaches to Visio according to an explicit mode, sets alert handling where supported, creates a new document, renders the supplied diagram, saves to a temporary `.vsdx`, reads the document back, and atomically moves the validated file to the requested output path.

COM calls are serialized through one dedicated worker thread. COM initialization and release happen on that same thread. The Worker only quits a Visio instance it launched itself; it never closes a user-owned instance that it attached to.

The mock engine implements the same render/readback contract and writes a deterministic JSON diagnostic artifact only inside mock mode. Mock success is labeled as mock and cannot be returned from a live export request.

## Diagram mapping

The API sends the deterministic browser diagram, not raw model text. The Worker maps browser canvas coordinates to Visio page inches using one documented scale. Nodes become native basic shapes with stable Shape Data fields:

- `synapse.nodeId`;
- `synapse.kind`;
- `synapse.label`;
- `synapse.stage`;
- optional tensor subtitle.

Edges become dynamic connectors or orthogonal line segments. Skip routes retain their lane points. Stage labels become page text. No external stencil is required for the neural-network renderer; any future custom stencil must be separately licensed and configured.

## API boundary

The existing `VisioExecutor` interface remains the domain boundary, but its execution input becomes an immutable validated diagram payload associated with a Job. `NotConnectedVisioExecutor` remains the default when the Worker is not configured. The API-side client maps process errors, protocol errors, timeout, invalid readback, and missing output to explicit `FoundationError` values.

The existing authenticated Job ownership rules remain in force. The API never accepts a client-provided path outside the configured Worker output root, and a user can only read or cancel their own Job.

## Testing and acceptance gates

Focused tests must cover:

- protocol serialization and rejection of malformed/version-mismatched messages;
- deterministic diagram-to-Worker mapping;
- mock Worker rendering and readback;
- path traversal and extension rejection;
- Worker timeout and non-zero exit handling;
- API adapter failure when the Worker is not configured;
- real COM smoke only on a Windows machine with Visio installed;
- independent inspection of the produced `.vsdx` and readback counts.

The following states remain separate in reporting:

1. source/design implemented;
2. focused tests and mock proof;
3. Worker package/build;
4. live Visio COM acceptance;
5. independent `.vsdx` inspection;
6. Git delivery.
