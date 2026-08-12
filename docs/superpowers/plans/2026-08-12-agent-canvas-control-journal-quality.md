# Agent Canvas Control and Journal-Quality Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Make the authorized Agent able to understand the current editable canvas, generate publication-quality neural-network diagrams, and return safe, reviewable canvas operations for user-approved edits.

**Architecture:** The client sends a bounded canvas snapshot with the user's request. The server-side Agent provider returns a structured `NetworkIR`, an optional full replacement diagram, and a restricted `CanvasActionSet`; no raw SVG, arbitrary JavaScript, filesystem command, or desktop command crosses the Agent boundary. The existing deterministic publication layout remains the only path from IR to the editable SVG canvas, and action application is validated and performed by the client bridge after explicit user confirmation.

**Tech Stack:** Fastify/TypeScript/Zod/Vitest for the Agent contract, vanilla JavaScript and the existing SVG state model for canvas actions, deterministic JavaScript publication layout, OpenAI Responses structured output when configured, and the existing local deterministic provider for offline tests.

## Global Constraints

- The Agent API remains authenticated and provider credentials remain outside client payloads and audit records.
- Canvas snapshots are bounded metadata only; raw image/code attachments are not persisted by this feature.
- Agent output must pass Network IR validation and action validation before the client can preview or apply it.
- Only allowlisted canvas operations are supported: replace document, add node, update node, remove node, add edge, remove edge, and update figure metadata.
- The model cannot execute arbitrary tools, JavaScript, Python, Shell, COM, or Visio commands.
- The fixed relay URL/provider boundary remains server-controlled; this plan does not expose URL override fields.
- Manual editing, JSON import/export, SVG/PNG export, and Visio Job export remain available as separate actions.

---

### Task 1: Define the canvas snapshot and action contract

**Files:**
- Create: `apps/api/src/agent-actions.ts`
- Test: `apps/api/tests/agent-actions.test.ts`
- Modify: `apps/api/src/domain.ts` only if a stable API error code is required

**Interfaces:**
- `canvasSnapshotSchema` accepts a bounded `{ figure?, paletteName?, nodes, edges }` canvas document with maximum node/edge counts and only the fields needed for Agent reasoning.
- `canvasActionSchema` accepts the allowlisted operations and strict payloads.
- `parseCanvasSnapshot(value): CanvasSnapshot` rejects unsupported fields and over-limit snapshots.
- `parseCanvasActionSet(value): CanvasActionSet` rejects unknown operations, missing IDs, invalid references, and oversized action lists.
- `applyCanvasActions(document, actionSet): CanvasDocument` is a pure server/client-shared-shape helper used by tests to prove operation semantics without DOM access.

- [ ] Write failing tests for replace, add/update/remove node, add/remove edge, figure update, unknown operation rejection, missing endpoint rejection, duplicate IDs, and action/count limits.
- [ ] Run `npx vitest run apps/api/tests/agent-actions.test.ts` and verify it fails because the module and schemas do not exist.
- [ ] Implement strict Zod schemas and the pure action application helper. Preserve unknown canvas rendering fields while preventing unknown operation types.
- [ ] Run the focused test until all action-contract tests pass.
- [ ] Run `npx tsc --noEmit` to verify the new shared types compile.

### Task 2: Extend Agent input/output with canvas context and actions

**Files:**
- Modify: `apps/api/src/adapters.ts`
- Modify: `apps/api/src/agent-service.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/src/agent-runtime.ts`
- Tests: `apps/api/tests/agent-service.test.ts`, `apps/api/tests/agent-routes.test.ts`

**Interfaces:**
- `AgentDraftInput` gains optional `canvas: CanvasSnapshot`.
- `AgentDraftOutput` gains `actions: CanvasActionSet` and `diagramIntent: "replace" | "modify" | "explain"`.
- `AgentChatInput` gains optional `canvas`.
- `AgentChatResult` returns `actions` and `diagramIntent`.
- `POST /api/agent/chat` accepts a bounded `canvas` field and returns the new action fields.

- [ ] Add a failing service test proving a request with a current canvas can return a modify intent and a typed update action.
- [ ] Add a failing route test proving the API rejects an oversized/invalid canvas snapshot and returns actions on success.
- [ ] Run only the new focused tests and confirm the expected contract failures.
- [ ] Extend the local provider with deterministic intent detection for phrases such as “修改/替换/删除/增加/连接/布局” and emit safe actions against existing IDs; default to `replace` for a new diagram request.
- [ ] Extend the OpenAI structured-output schema and prompt to require `diagramIntent` and `actions`, explicitly treating the canvas snapshot as untrusted state and never emitting arbitrary commands.
- [ ] Update `AgentService` to parse/validate the provider actions, run deterministic layout for replacement IR, and include action warnings without allowing invalid actions to escape.
- [ ] Update `parseAgentBody` and the route response while preserving existing idempotency, quota, audit, and provider boundaries.
- [ ] Run `agent-service.test.ts`, `agent-routes.test.ts`, and `agent-actions.test.ts` until green.

### Task 3: Produce richer journal-quality deterministic IR and layout metadata

**Files:**
- Modify: `apps/api/src/adapters.ts`
- Modify: `publication-layout.js`
- Tests: `apps/api/tests/agent-service.test.ts`, `publication-layout.test.js`

**Interfaces:**
- The local provider emits semantic node kinds, tensor subtitles, stage ordering, groups, source evidence, and skip/concat/add edges for common CNN/U-Net/Transformer patterns.
- The layout output keeps canvas compatibility and adds bounded journal metadata such as `figure.caption`, `figure.style`, and `validation` without changing existing renderer-required fields.

- [ ] Add failing fixtures for a ResNet-like CNN, U-Net encoder/decoder with skip lanes, and ViT/Transformer token-attention flow. Assert semantic nodes, stage order, and skip edges rather than exact incidental coordinates.
- [ ] Run the focused fixtures and verify the local provider currently fails to produce the expected topology.
- [ ] Implement deterministic pattern extraction for Conv/Norm/Activation/Pool/Upsample/Concat/Add/Attention/Token/Linear and infer stage labels from code/text boundaries.
- [ ] Implement publication metadata defaults: concise figure title/subtitle, stage labels, source-confidence annotations, color-safe node semantics, black-and-white styles, and reserved skip lanes.
- [ ] Run layout and provider tests and verify deterministic output for repeated input.

### Task 4: Send the current canvas and apply reviewed Agent actions in the client

**Files:**
- Modify: `app.js`
- Modify: `chat-agent.js`
- Modify: `index.html`
- Modify: `styles.css`
- Tests: `apps/client/chat-agent.test.js`

**Interfaces:**
- `window.synapseGetCanvasDocument()` returns a bounded deep-cloned canvas snapshot.
- `window.synapsePreviewAgentActions(actionSet)` returns a human-readable preview summary without mutating state.
- `window.synapseApplyAgentActions(actionSet)` applies validated operations through the existing state/persist/render path.
- Agent result UI displays intent, action summary, “预览修改”, “应用修改”, and “应用完整图” as separate user actions.

- [ ] Add failing client tests proving the request payload includes the current canvas, action previews do not mutate the document, and applying actions updates nodes/edges/figure through the canvas bridge.
- [ ] Run the focused client test and confirm the bridge functions are missing.
- [ ] Add the app bridge over the existing private state and reuse `normalizeDiagramDocument`, ID generation, persistence, render, palette, and focus behavior.
- [ ] Extend the chat payload builder with an optional canvas snapshot and render safe action summaries using escaped text.
- [ ] Add explicit UI buttons for action preview/application and full diagram application; keep Visio export independent.
- [ ] Run client tests and `node --check app.js` / `node --check chat-agent.js`.

### Task 5: End-to-end verification and documentation

**Files:**
- Modify: `README.md`
- Test/verification: existing Agent, layout, client, TypeScript, and publication tests

- [ ] Document natural-language examples for generating a CNN/U-Net/ViT and modifying the current canvas.
- [ ] Document that local mode is deterministic and image understanding requires a configured server-side provider/relay.
- [ ] Run `npm run api:test`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `node --check chat-agent.js`, `node --check publication-layout.js`, and `node --check app.js`.
- [ ] Run `git diff --check` and inspect the final diff for unrelated changes.
- [ ] Report Agent code readiness, focused proof, full test proof, real Electron acceptance, live relay/model acceptance, and live Visio acceptance as separate gates.
