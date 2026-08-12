# Agent Chat Vision Network MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Build a first usable Agent loop where an authorized user can chat, attach model code or a sketch, receive a structured neural-network analysis, preview a publication-style diagram, and iterate without granting the model arbitrary desktop control.

**Architecture:** The model produces analysis and a validated Network IR, never raw SVG or unrestricted Visio commands. A deterministic layout/renderer converts IR to the existing editable SVG canvas; a future Visio executor consumes the same IR behind the existing adapter boundary. The API remains tenant/session protected through the commercial foundation, and a deterministic local provider keeps tests and no-key development usable.

**Tech Stack:** Node.js ESM, Fastify, TypeScript, Zod, Vitest, vanilla JavaScript, existing SVG canvas, OpenAI Responses API with image inputs and strict structured JSON output when configured.

## Global Constraints

- The Agent API must require the existing authenticated user session and must not expose provider API keys to the client.
- Inputs are limited to text plus bounded code/image attachments; raw uploads are not persisted in this MVP.
- Model output must pass Network IR validation before it reaches the canvas.
- The local provider must be deterministic and must not claim that it performed real Vision analysis.
- The renderer must be deterministic, editable, exportable, and readable in black-and-white.
- Microsoft Visio COM/.vsdx automation is an adapter follow-up; this MVP only exposes a safe executor boundary and browser preview.
- OpenAI request shape follows the official documentation: https://developers.openai.com/api/docs/guides/images-vision and https://developers.openai.com/api/docs/guides/structured-outputs.

## File Map

- Create `apps/api/src/network-ir.ts`: serializable IR types, Zod schema, validation and normalization.
- Create `apps/api/src/agent-service.ts`: bounded orchestration from chat input to analysis, IR and diagram result.
- Modify `apps/api/src/adapters.ts`: provider contracts and OpenAI/local provider implementations without leaking secrets.
- Modify `apps/api/src/routes.ts`: authenticated `/api/agent/chat` route with request limits and stable errors.
- Modify `apps/api/src/app.ts`: dependency injection for AgentService and provider selection.
- Create `apps/api/tests/network-ir.test.ts`: IR schema, topology and layout validation tests.
- Create `apps/api/tests/agent-service.test.ts`: local deterministic orchestration tests.
- Create `apps/api/tests/agent-routes.test.ts`: authenticated HTTP contract tests.
- Create `chat-agent.js`: client chat state, attachment encoding, API calls and diagram application bridge.
- Modify `index.html`: compact chat drawer/modal and attachment controls.
- Modify `styles.css`: chat drawer, messages, attachment chips and generation state styles.
- Create `publication-layout.js`: deterministic stage layout and collision/overlap checks.
- Create `publication-layout.test.js`: layout stability and validation tests.
- Modify `app.js`: import generated IR/diagram through one explicit bridge, preserving existing manual editing.
- Modify `README.md`: local setup, API contract, provider configuration and current Visio boundary.

## Task 1: Network IR and validation

**Files:**

- Create: `apps/api/src/network-ir.ts`
- Test: `apps/api/tests/network-ir.test.ts`

Define `NetworkIR` with `figure`, `nodes`, `edges`, `groups`, `annotations`, `style`, and `layout`. Each node carries `id`, `kind`, `label`, optional tensor metadata, `stage`, `confidence`, and `sourceEvidence`; each edge carries `source`, `target`, `kind`, optional label/shape, `skip`, confidence, and evidence. Accept the supported kinds `input`, `output`, `conv`, `depthwise-conv`, `pool`, `upsample`, `normalization`, `activation`, `residual`, `concat`, `add`, `flatten`, `dense`, `attention`, `transformer-block`, `embedding`, `token`, `feature-map`, `volume`, `classifier`, and `loss`.

Write tests first for valid IR, duplicate IDs, missing edge endpoints, unreachable output, illegal self-loop, invalid confidence, and normalized missing optional fields. Export `networkIRSchema`, `parseNetworkIR`, `validateNetworkIR`, and `NetworkIR`.

## Task 2: Agent orchestration and providers

**Files:**

- Create: `apps/api/src/agent-service.ts`
- Modify: `apps/api/src/adapters.ts`
- Test: `apps/api/tests/agent-service.test.ts`

Implement `AgentService.chat({ userId, conversationId, message, attachments })` with stages `received`, `analyzing`, `building_ir`, `layouting`, `validating`, `completed`, and `failed`. The local provider must extract obvious Conv/Pool/Linear patterns from text, produce a clearly marked deterministic draft, and merge image evidence as low-confidence reference evidence. The OpenAI provider may call Responses API only server-side, include text and bounded `input_image` items, request structured JSON, parse the result through `parseNetworkIR`, and convert provider failures to stable `FoundationError` values. Keep provider input and output types serializable.

Tests must cover text-only local analysis, mixed code/image attachments, invalid provider output rejection, stage progression, and provider-not-configured behavior. Do not add arbitrary tool execution or filesystem access.

## Task 3: Authenticated Agent HTTP contract

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes.ts`
- Test: `apps/api/tests/agent-routes.test.ts`

Add `POST /api/agent/chat`. Require the existing bearer session. Accept `{ conversationId?, message, attachments?: [{name, mimeType, data, kind}] }`, restrict text to 12,000 characters, attachment count to 6, code to 200,000 characters, and each image to 8 MB base64 payload. Return `{ conversationId, status, stages, response, networkIR, diagram }`. Reject unauthenticated, unsupported MIME, oversized and malformed requests with stable 4xx errors. Do not store raw attachment bytes in the foundation database in this MVP; audit/job integration may record metadata only.

## Task 4: Compact chat UI and canvas bridge

**Files:**

- Create: `chat-agent.js`
- Modify: `index.html`
- Modify: `styles.css`

Add a compact drawer that works after `synapseAuthGate` authorizes the client. It must support message text, `.py/.ipynb/.txt/.md/.json` files, PNG/JPG/WebP images, pasted code, attachment removal, sending state, stage status, assistant explanation, confidence/evidence badges, and an “应用到画布” action. The client sends the existing bearer token to `/api/agent/chat`, never sends provider credentials, and renders server-returned diagram data through the existing canvas bridge. Add browser-independent DOM tests for attachment filtering, payload limits, escaping and locked-state behavior.

## Task 5: Deterministic publication layout

**Files:**

- Create: `publication-layout.js`
- Test: `publication-layout.test.js`

Implement `layoutNetworkIR(ir, options)` and `validatePublicationLayout(layout)`. Use fixed stage columns, stable vertical ordering, reserved routing lanes for skip edges, semantic colors, readable labels, and a black-and-white-safe style. Return the existing canvas-compatible `{ figure, paletteName, nodes, edges }` shape plus a validation report. Tests must prove deterministic output, no node overlap, valid endpoint routing, stable stage ordering, and readable bounds for representative CNN, U-Net and Transformer IR fixtures.

## Task 6: Integrate renderer with existing canvas

**Files:**

- Modify: `app.js`
- Modify: `README.md`

Expose one explicit `window.synapseApplyAgentDiagram(diagram)` bridge used by `chat-agent.js`. Preserve manually authored diagrams, undo-independent import behavior, existing export actions and current code/image workflows. Document that the browser canvas is the first renderer and Microsoft Visio execution remains a separate Windows adapter.

## Verification and handoff

Run from `C:\项目\code\Draw_a_neural_network\.worktrees\commercial-foundation`:

```powershell
npm run api:test
npx tsc --noEmit
node --check chat-agent.js
node --check publication-layout.js
node --check app.js
git diff --check
```

Then run the existing PostgreSQL/Redis durable smoke when Docker is available, plus an HTTP smoke with the local provider proving an authorized request returns a validated IR and a canvas-compatible diagram. Report Agent MVP code, focused tests, durable tests, real Electron, Microsoft Visio and external OpenAI acceptance as separate gates.
