# Graph Message Passing Grammar Implementation Plan

**Goal:** Implement the first `graph-coordinate-process` subset: an evidence-backed message-passing GNN preview grammar, without treating NeRF or Diffusion as graph diagrams.

**Architecture:** Extend Canonical NetworkIR with explicit `graph` connectivity tensors and `message_passing` / `graph_readout` operators. Accept only `input(node features + edge index) → repeated message_passing → graph_readout → classifier/dense → output`; emit a graph-topology inset, a repeated propagation block, and a readout/head flow using deterministic Plan v2 primitives.

## Constraints

- Grammar input is validated Canonical NetworkIR plus FigureIntent only; no Provider, Canvas, Worker, Visio, COM/VSDX, filesystem, shell, SVG/XML, or model coordinates.
- The first subset is one static graph: node-feature tensor axes exactly `node,feature`; connectivity tensor role `graph`, axes exactly `edge,index`; both originate from the sole input and are evidence-backed.
- Message passing requires validated repeat/group evidence and one data spine. NeRF/SDF coordinates, diffusion timesteps, query decoders, heterogeneous graphs, multiple graph inputs, residual-expanded message passing, and Visio export/readback remain separate work.

## Tasks

1. Write RED fixture/tests for `input → message_passing ×K → graph_readout → classifier → output`, graph connectivity, selection, source mappings and QA; reject missing graph tensor, invalid axes/repeat evidence, multiple graphs, side inputs, feedback/iteration, coordinate tensors, and missing evidence.
2. Add only the required NetworkIR literals, register `graph-coordinate-process`, and implement exact topology validation plus deterministic semantic/Plan compilation. Add a bounded browser graph-inset primitive only if current Plan primitives cannot truthfully render topology.
3. Run focused IR/grammar/browser tests, full API regression, foundation check, isolated TypeScript, capability scan, diff check, and independent read-only review.
