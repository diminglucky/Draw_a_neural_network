# Agent Product Roadmap and Cross-Device Continuity Design

**Status:** Proposed for review
**Date:** 2026-08-17
**Scope:** Product-development roadmap and continuity for the `agent` branch. This does not track individual user figure-analysis or export jobs.

## 1. Decision

The repository will use a **roadmap-as-code** model. A versioned, machine-readable state ledger is the single source of truth for the Agent product roadmap. Human-readable roadmap pages are deterministic projections of that ledger. Git commits provide immutable history for state transitions and evidence changes.

This solves the operating problem of changing computers: an engineer or coding agent can identify the active milestone, accepted predecessors, blockers, next executable node, and required acceptance evidence without relying on earlier chat history or files stored only on one machine.

The first delivery adds the state ledger, a read-only status command, deterministic roadmap rendering, and CI validation. It does not change the user-facing drawing flow, execute user code, run a Provider, or replace existing v2/v3 product boundaries.

## 2. Goals and Non-Goals

### Goals

1. Give `agent` one canonical answer to: "where is product development now, what is next, and what blocks it?"
2. Make the answer recoverable on a new computer with `git fetch`, `git switch agent`, `git pull --ff-only`, and one local command.
3. Model delivery as a dependency graph of independently acceptable capability nodes, rather than a flat task list.
4. Require evidence before acceptance: implementation commit, applicable validation command, result summary, and a repository artifact reference.
5. Keep the universal-compiler design authoritative for product architecture while adding a narrow delivery-state layer.
6. Prevent documentation drift by rendering the current roadmap view from the ledger and checking parity in CI.

### Non-Goals

1. This does not replace `FigureAnalysis`, `FigureDraft`, `PlanSnapshot`, export jobs, or any per-user runtime record.
2. This does not claim M2, M3, M4, Keras, ONNX, sketch understanding, GNN, or real Visio validation is complete.
3. This does not require GitHub Projects, Notion, Jira, a cloud database, credentials, or a running API service.
4. This does not infer acceptance from source diffs or test logs. A reviewed ledger transition must record evidence explicitly.
5. This does not store source code, API keys, user identifiers, request contents, private hostnames, or local paths outside the repository.

## 3. Existing Baseline

The architecture authority is `docs/superpowers/specs/2026-08-17-universal-compiler-repair-and-migration-design.md`.

```text
SourcePack -> Analyzer -> EvidenceGraph -> Architecture IR v3
  -> Figure Components -> PlanSnapshot -> sealed export
  -> restricted Visio Worker -> native readback and renderer QA
```

| Product node | State | Evidence baseline |
| --- | --- | --- |
| M0: engineering truth | accepted | strict TypeScript, full API tests, legacy readback fixture repair |
| M1 / P0.0: static-linear PyTorch analysis | accepted | authenticated v3 route, static analyzer, owner-scoped persistence, evidence and IR tests |
| M2: v3 compiler and publication preview | planned | no accepted implementation evidence yet |
| M3: sealed universal export and real Visio acceptance | planned | depends on M2 |
| M4: production delivery and controlled modality expansion | planned | depends on M3 |

M0/M1 acceptance detail remains in `docs/evidence/2026-08-17-m0-m1-static-pytorch.md`. The ledger links to evidence; it does not duplicate logs.

The initial ledger creates accepted terminal nodes `M0.9` and `M1.9` for the two baselines above. The `.9` node is the milestone acceptance gate and provides a concrete dependency target for successor work.

## 4. Architecture and File Ownership

| File | Role | Authority |
| --- | --- | --- |
| `docs/agent-program-state.json` | Canonical state ledger | Sole source for status, dependencies, blockers, next action, and evidence links |
| `docs/ROADMAP.md` | Rendered human roadmap | Derived from the JSON ledger; never manually edited |
| `docs/START_HERE.md` | New-computer entry point | Curated operating steps and links to authority documents |
| `docs/superpowers/specs/*.md` | Product/subsystem decisions | Architecture authority within declared scope |
| `docs/superpowers/plans/*.md` | Executable implementation plans | Task-level instructions for an approved node |
| `docs/evidence/*.md` | Acceptance record | Detail referenced by the ledger |

Only `docs/agent-program-state.json` is mutable current-state data. Git history records prior state; no second in-file history log is created. The status command is strictly read-only.

```text
agent-program-state.json
        |
        v
state schema validator ----> agent:status (human / --json / --strict)
        |                               |
        v                               v
roadmap renderer ----------------> docs/ROADMAP.md
        |
        v
agent:verify-roadmap (schema, references, rendered parity, Git checks)
        |
        v
CI quality gate
```

All components run only with Node.js, Git, and repository files. They do not require a database, Provider key, Visio, Electron, Python, or network connectivity.

## 5. Canonical State Contract

### 5.1 Ledger Structure

```json
{
  "schemaVersion": 1,
  "program": {
    "id": "universal-neural-figure-agent",
    "name": "Universal Neural Figure Agent",
    "branch": "agent",
    "architectureSpec": "docs/superpowers/specs/2026-08-17-universal-compiler-repair-and-migration-design.md"
  },
  "updatedAt": "2026-08-17T00:00:00.000Z",
  "currentFocus": "M2.1",
  "milestones": [],
  "nodes": [],
  "blockers": []
}
```

Timestamps use UTC ISO-8601. The ledger deliberately has no progress percentage because dependency-gated engineering cannot be represented honestly by a scalar percentage.

### 5.2 Node Contract

A milestone is a product-level acceptance boundary. A node is the smallest independently reviewable and evidence-bearing delivery slice. Milestones use `M<number>` IDs, work nodes use `M<number>.<number>`, and `.9` is reserved for a milestone acceptance gate. Nodes form a directed acyclic graph through `dependsOn`.

```json
{
  "id": "M2.1",
  "milestoneId": "M2",
  "title": "Figure Component contract and semantic compiler boundary",
  "status": "planned",
  "previousStatus": null,
  "dependsOn": ["M1.9"],
  "outcome": "Validated v3 IR becomes semantic Figure Components without model-name templates or browser geometry.",
  "acceptance": [
    {
      "id": "M2.1.gold-fixtures",
      "text": "Gold IR fixtures cover CNN, residual backbone, encoder-decoder, and token transformer.",
      "requiredEvidenceKinds": ["test", "document"]
    },
    {
      "id": "M2.1.explicit-fallback",
      "text": "Unsupported topology returns explicit fallback or unresolved state rather than guessed structure.",
      "requiredEvidenceKinds": ["test"]
    },
    {
      "id": "M2.1.quality-gates",
      "text": "Focused tests, full API tests, strict TypeScript, and diff checks pass.",
      "requiredEvidenceKinds": ["test", "typecheck", "commit", "document"]
    }
  ],
  "evidence": [],
  "nextAction": "Write and approve the M2.1 implementation plan.",
  "blockerIds": []
}
```

Each acceptance item has a stable ID and explicitly names the evidence kinds required to accept it. Every accepted node must have evidence whose `satisfies` list includes every acceptance ID; the evidence records satisfying a specific item must collectively contain every kind named by that item. This relationship prevents a general test log from being used as unreviewed proof for every acceptance statement.

An evidence record is reproducible and repository-bound:

```json
{
  "kind": "test | typecheck | manual-visual-review | real-host | commit | tag | document",
  "satisfies": ["M1.9.evidence"],
  "ref": "docs/evidence/2026-08-17-m0-m1-static-pytorch.md",
  "summary": "84 test files and 466 tests passed for the accepted M0/M1 slice.",
  "verifiedAt": "2026-08-17T00:00:00.000Z",
  "commit": "bc718abd9e323d991c32d759eb9d8f31bb741459"
}
```

`ref` must be repository-relative and tracked. `commit` is a full 40-character SHA that resolves locally. A `real-host` record also names its host class and artifact reference, but never a personal machine name or private absolute path.

For example, an acceptance item requiring test, typecheck, commit, and document proof uses the following contract:

```json
{
  "acceptance": [{
    "id": "M1.9.evidence",
    "text": "Full checks are recorded.",
    "requiredEvidenceKinds": ["test", "typecheck", "commit", "document"]
  }],
  "evidence": [{
    "kind": "test",
    "satisfies": ["M1.9.evidence"],
    "ref": "docs/evidence/2026-08-17-m0-m1-static-pytorch.md",
    "summary": "466 tests passed.",
    "verifiedAt": "2026-08-17T00:00:00.000Z",
    "commit": "bc718abd9e323d991c32d759eb9d8f31bb741459"
  }]
}
```

The example's remaining typecheck, commit, and document records use the same `satisfies` ID. Each evidence record has a resolvable full commit SHA.

### 5.3 Statuses and Transitions

| Status | Meaning |
| --- | --- |
| `planned` | Scope is approved, implementation has not begun. |
| `active` | Implementation or verification is underway. |
| `blocked` | An explicit unresolved blocker prevents progress. |
| `awaiting_acceptance` | Implementation exists; evidence is being collected or reviewed. |
| `accepted` | Dependencies, criteria, and required evidence are satisfied. |
| `deferred` | Explicitly removed from the current delivery path without completion. |
| `superseded` | Replaced by a named successor node or decision. |

```text
planned -> active -> awaiting_acceptance -> accepted
planned -> deferred | superseded
active -> blocked | awaiting_acceptance | deferred | superseded
blocked -> active | deferred | superseded
awaiting_acceptance -> active | blocked | accepted
```

`previousStatus` is either `null` for a baseline node or the status immediately before the current committed transition. When present, it must follow this table. This small audit field lets validation reject an impossible transition without treating Git history as mutable ledger data.

An accepted node is never reopened; new work uses a successor node. A node may become accepted only when every dependency is accepted, every acceptance statement has matching evidence, and it has a `commit` evidence record. A milestone becomes accepted only when all required child nodes are accepted.

### 5.4 Blocker Contract

```json
{
  "id": "B-M2-001",
  "nodeId": "M2.3",
  "severity": "high",
  "summary": "No publication-figure visual benchmark has been approved.",
  "resolution": "Approve the gold fixture set and human review rubric before visual QA can be accepted.",
  "openedAt": "2026-08-17T00:00:00.000Z",
  "status": "open"
}
```

Every blocked node references one or more open blockers. Nodes in all other states cannot reference open blockers. Closing a blocker permits progress but does not accept its node.

## 6. Product Delivery Graph

### M0: Engineering Truth

**State:** accepted. Restore strict typing and reliable legacy Visio readback contracts before extending the product path.

### M1 / P0.0: Authenticated Static PyTorch Analysis

**State:** accepted. Accept bounded static-linear PyTorch source through an authenticated v3 route, generate retained evidence and Architecture IR v3, and never execute user code.

### M2: Figure Compiler and Publication Preview

**State:** planned and next product milestone.
**Exit:** a user can inspect a deterministic v3 preview that is exactly the object eligible for future export.

| Node | Outcome | Depends on |
| --- | --- | --- |
| M2.1 | Define and validate Figure Component contracts, semantic ports, component manifests, and non-template compiler boundary. | M1 acceptance |
| M2.2 | Implement `ComposableDagFigureCompiler` for supported v3 semantic DAGs with deterministic layout and explicit unsupported-topology behavior. | M2.1 |
| M2.3 | Add publication visual tokens and server-side QA for collision, routing, contrast, grayscale, crop, scale, and source mapping. | M2.1, M2.2 |
| M2.4 | Add an owner-scoped preview route that returns safe artifacts and never compiles a candidate structure. | M2.2, M2.3 |
| M2.5 | Bind passing preview to immutable `PlanSnapshot`; invalidate on changes to IR, intent, manifest, or artifact. | M2.3, M2.4 |
| M2.9 | Review golden fixtures and visual QA; accept only artifact-identical preview and snapshot. | M2.1-M2.5 |

### M3: Sealed Universal Export and Real Visio Acceptance

**State:** planned.
**Exit:** a real Windows/Visio host proves a viewed v3 plan can create a native editable VSDX, save, close, reopen, and pass independent readback.

| Node | Outcome | Depends on |
| --- | --- | --- |
| M3.1 | Assemble production app with universal export service and runner as real dependencies. | M2 acceptance |
| M3.2 | Bind signed export authorization to owner, device, job, exact plan, preview hashes, and revision. | M3.1 |
| M3.3 | Restrict Windows Worker to sealed-plan operations; reject Provider text, browser geometry, arbitrary paths, URLs, COM, or shell input. | M3.2 |
| M3.4 | Implement native shape/connector/metadata readback and renderer QA with cancellation, timeout, recovery, and idempotency. | M3.3 |
| M3.5 | Run real-host create-save-close-reopen suite; record editable VSDX, PDF, PNG, hashes, and readback evidence. | M3.4 |
| M3.9 | Accept preview-to-native-Visio equivalence only after independent real-host review. | M3.1-M3.5 |

### M4: Production Delivery and Controlled Input Expansion

**State:** planned. Capability branches are independent, not an implied single promise.

| Node | Outcome | Depends on |
| --- | --- | --- |
| M4.1 | Add live Provider controls: server-side credentials, redaction, budget, timeout, retry, audit, and usage rules. | M3 acceptance |
| M4.2 | Accept durable PostgreSQL/Redis migration, fencing, recovery, backup, monitoring, and alerting. | M3 acceptance |
| M4.3 | Accept Electron packaging, signing, DPAPI lifecycle, install, update, revocation, offline/reconnect, and multi-device behavior. | M3 acceptance |
| M4.4 | Add Keras and ONNX analyzers as separate evidence-backed capabilities. | M4.1 |
| M4.5 | Add sketch/image understanding as confidence-bounded candidate-structure capability. | M4.1, M2 acceptance |
| M4.6 | Add Graph/Message Passing only after a semantic IR and Figure Component design is accepted. | M2 acceptance |
| M4.9 | Publish release provenance, package hashes, host versions, acceptance evidence, and rollback guidance. | selected M4 nodes |

## 7. Cross-Device Procedure

On a replacement or secondary computer:

```powershell
git fetch origin
git switch agent
git pull --ff-only
npm ci
npm run agent:status
```

The command prints, in order:

1. Program name, schema version, current branch, HEAD, and divergence from `origin/agent`.
2. Current focus title, status, outcome, dependencies, next action, and spec/plan links.
3. Accepted milestones with evidence references.
4. Open blockers ordered by severity and resolution condition.
5. Immediately executable planned nodes with accepted dependencies.
6. Warnings for dirty tracked files, untracked files, detached HEAD, wrong branch, missing evidence, generated-roadmap drift, or unavailable upstream.

`npm run agent:status -- --json` emits a stable machine-readable projection. `npm run agent:status -- --strict` returns non-zero when the expected branch, ledger validity, evidence integrity, or generated-roadmap parity cannot be proven. It reports unrelated drafts but does not fail merely because one exists.

When advancing a node:

```text
1. Read the current-focus node, architecture spec, and implementation plan.
2. Implement and collect required evidence.
3. Run focused and full verification.
4. Update only affected ledger nodes, evidence, blockers, and generated roadmap.
5. Commit implementation and state transition together, or as two explicitly linked commits.
6. Push the branch; create a tag only for an accepted release boundary.
```

The ledger cannot move to `accepted` until its referenced evidence and commit exist locally. A later computer can use `git show <commit>` and the evidence reference to reproduce the rationale.

## 8. Commands and CI

| Command | Behavior |
| --- | --- |
| `npm run agent:status` | Read-only human status; exits zero when ledger parses. |
| `npm run agent:status -- --json` | Stable JSON status projection. |
| `npm run agent:status -- --strict` | Fails for continuity risks: wrong branch, invalid ledger, bad evidence, or render drift. |
| `npm run agent:render-roadmap` | Deterministically writes `docs/ROADMAP.md` from the ledger. |
| `npm run agent:verify-roadmap` | Checks schema, DAG, transitions, evidence, current focus, generated parity, and forbidden data. |

The renderer uses stable milestone/node ordering, LF output, no local timestamps, no absolute paths, and no Git configuration. `updatedAt` changes only for intentionally committed state transitions. The roadmap verifier joins rather than replaces `npm run api:check`, typechecking, and API tests.

## 9. Validation Rules

The verifier rejects the ledger when:

1. JSON is malformed, schema version is unknown, or security-sensitive structures contain unknown fields.
2. IDs are duplicate; node IDs do not match `M<number>` or `M<number>.<number>`; or references point to absent milestones, dependencies, blockers, or successors.
3. The graph has a dependency cycle, or an accepted node depends on a non-accepted node.
4. `currentFocus` refers to a terminal node or a node that cannot execute without an explicit blocked state.
5. A blocked node has no open blocker, or an open blocker lacks a resolution condition.
6. An accepted node lacks required evidence, an existing evidence document, or a resolvable full commit SHA.
7. An evidence reference is absolute, escapes the repository, is untracked/nonexistent, or contains secret-like values.
8. Generated `docs/ROADMAP.md` differs from renderer output.
9. State contains API keys, Provider credentials, raw user source, user IDs, private hostnames, or external filesystem paths.

## 10. Testing and Acceptance

Fixture-driven tests cover:

1. Valid initial state parses and renders a stable roadmap snapshot.
2. Every legal transition is accepted and every illegal transition gets a node-specific error.
3. Cyclic dependencies, missing IDs, invalid focus, duplicate IDs, broken blockers, and invalid evidence are rejected.
4. Accepted nodes require evidence, accepted dependencies, and resolvable full SHAs.
5. Renderer output is stable under input-key order changes and detects manual Markdown edits.
6. Human status prints current node, next action, executable nodes, blockers, branch health, and dirty-tree warnings.
7. JSON status contains no absolute working-directory paths or secrets.
8. Strict mode fails on wrong branch, divergence, detached HEAD, invalid ledger, broken evidence, and generated-file drift.
9. A clean clone can run the status flow without API, database, Provider, Visio, or Electron configuration.

The delivery gate is:

```powershell
npm run agent:verify-roadmap
npm run agent:status -- --strict
npx.cmd tsc --noEmit
npm.cmd run api:test
npm.cmd run api:check
git diff --check
```

## 11. Rollout

### R0: Bootstrap Continuity

1. Add parser/schema and initial ledger: M0/M1 accepted, M2.1 current focus.
2. Add deterministic renderer and `docs/ROADMAP.md`.
3. Add status/verifier commands, package scripts, tests, and CI integration.
4. Update `README.md` and `docs/START_HERE.md` so cross-device recovery is the first development entry point.

### R1: Operate Through the Ledger

1. Every M2+ implementation plan names its ledger node and evidence.
2. Each accepted-node commit updates the ledger and regenerated roadmap.
3. Review checks status, evidence, and next action against the delivered code.

### R2: Operate Through M2-M4

1. New work creates a successor node rather than reopening accepted work.
2. Scope pivots record blockers or supersession before implementation moves elsewhere.
3. Real-host evidence is required only for nodes claiming real Visio or production acceptance.
4. Tags point to an accepted release baseline and its ledger snapshot.

## 12. Risks and Controls

| Risk | Control |
| --- | --- |
| Ledger becomes stale todo list | JSON is canonical, Markdown is generated, acceptance needs evidence in the same reviewed delivery. |
| Milestone is claimed complete after unit tests only | Node acceptance requires node-specific evidence; visual and real-host claims are separate. |
| Current focus hides blocker | Blocked status requires open blockers and status prints them before executable nodes. |
| Replacement computer has stale history | Strict mode reports branch, divergence, detached HEAD, and rendered-state issues. |
| Secrets/user data enter docs | Schema limits fields and verifier rejects sensitive values and unsafe references. |
| M4 becomes an unbounded promise | Each modality is its own independently accepted node. |
| Markdown implies unrecorded progress | Render parity fails until the ledger changes. |

## 13. Design Acceptance

This design is ready to implement once these decisions are accepted:

1. Product status is stored in Git, not chat history or a machine-local tool.
2. `docs/agent-program-state.json` is canonical and `docs/ROADMAP.md` is generated.
3. M0/M1 are accepted and M2.1 becomes the first active product node after R0 bootstraps continuity.
4. M2-M4 remain dependency-gated capability nodes with explicit acceptance evidence.
5. A new computer follows the documented command sequence to recover the exact product-development position.
6. The tools are local, read-only, deterministic, and independent of product runtime services.
7. State is evidence-backed, Git-auditable, and contains no secrets or user content.
