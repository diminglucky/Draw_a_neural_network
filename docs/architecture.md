# Visio-only architecture

## Boundary

The web page is an input and execution control surface. It does not render,
layout, edit, persist, or export neural-network figures.

Microsoft Visio is the only figure renderer. The bridge opens a user-selected
existing `.vsdx` document, writes native Shapes and connectors, stores source
identities in Shape Data, saves the document, and reads the identities back.

## Pipeline

```text
source / image / IR
  -> evidence extraction
  -> Universal IR
  -> semantic visual grammar
  -> renderer-neutral Figure Plan
  -> PowerShell / COM bridge
  -> native Visio objects
  -> identity and endpoint readback
```

The Agent never selects topology from a named-model registry. Known operators
are classified from evidence. Custom or incomplete structures remain explicit
and unresolved until evidence or confirmation is available.

## Modules

- `input-adapters.mjs`: normalizes source, image, prompt, and IR requests.
- `evidence-graph.mjs`: records provenance, confidence, conflicts, and
  unresolved observations.
- `universal-ir.mjs`: canonical nodes, edges, ports, shapes, and validation.
- `semantic-visual-grammar.mjs`: role-aware visual semantics for spatial,
  vector, attention, recurrent, volume, and compound structures.
- `universal-figure.mjs`: topology-driven geometry and Figure Plan input.
- `figure-plan.mjs`: stable source identity and route contract.
- `visio-bridge.mjs`: Visio render plan, execution, and readback validation.
- `visio-bridge.ps1`: native Visio Shape, connector, Shape Data, and page
  operations.
- `agent-orchestrator.mjs`: resumable inspect, extract, normalize, plan,
  render, and readback state machine.

## Verification

Run `node --test` for the complete automated suite. This proves contracts and
dry-run behavior. Native Visio acceptance additionally requires an installed
Visio automation instance and a real existing `.vsdx` document.
