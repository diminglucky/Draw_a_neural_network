# Real Agent VGG16 → Visio acceptance

Date: 2026-08-19

Scope: controlled local acceptance of the server-owned Agent export path. The command used the opt-in `SYNAPSE_REAL_VISIO_ACCEPTANCE=1` guard and a live, visible Worker v2 session.

Verified chain:

1. The deterministic acceptance Agent created a canonical, render-ready VGG16 Figure Draft through `POST /api/agent/chat`.
2. The authenticated Agent export route created a server-bound immutable execution snapshot and Job; no browser-provided diagram, output path, session identity, or Worker operation was accepted.
3. The live Worker opened one visible Visio document, applied the VGG16 Figure Plan, saved one VSDX, and returned native readback.
4. Native readback was valid with 127 shapes and 15 connectors. The Visio document remained open after the successful response; no automatic close command was sent.

The dynamic job, draft, session, and absolute output-path identifiers are deliberately omitted from this evidence record. They are runtime-specific and are not required to establish the acceptance result.

Separately verified implementation safeguards:

- Worker v2 only correlates a strict, unambiguous normal-protocol failure to its pending request; malformed or ambiguous protocol candidates remain fail-closed.
- A fresh configured output root with no prior recovery manifest is treated as a normal first-run state, while existing-directory/reparse-point checks remain in force.
