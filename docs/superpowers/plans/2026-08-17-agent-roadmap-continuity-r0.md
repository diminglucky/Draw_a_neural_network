# Agent Roadmap Continuity R0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the product-development location of the `agent` branch recoverable on any computer from a versioned ledger, deterministic roadmap, and local read-only status and verification commands.

**Architecture:** One ESM module, `scripts/agent-roadmap.mjs`, owns strict parsing, semantic validation, deterministic Markdown rendering, Git inspection, human/JSON status projection, and CLI dispatch. `docs/agent-program-state.json` is the only current-state source; `docs/ROADMAP.md` is regenerated from it. Vitest tests import the module directly, while package scripts call its three explicit subcommands.

**Tech Stack:** Node.js ESM, built-in `node:fs`, `node:path`, `node:child_process`, `node:url`, Vitest, npm scripts, Markdown/JSON, existing Foundation quality check.

## Global Constraints

- Work only on `agent`; preserve unrelated changes, especially `docs/superpowers/plans/2026-08-14-graph-message-passing-grammar.md`.
- Status and verify are local and read-only. They require no API, database, Provider, Visio, Electron, Python, or network access.
- `docs/agent-program-state.json` is canonical. `docs/ROADMAP.md` is generated and never manually maintained.
- State contains no API keys, Provider credentials, raw user content, user IDs, private machine names, or absolute external paths.
- Existing `api:test`, TypeScript, and `api:check` gates remain mandatory. The new checker augments them only.
- Generated Markdown/JSON uses LF, stable ordering, no local timestamps, no absolute paths, and no Git-user configuration.

---

### Task 1: Define and Test the Ledger Contract

**Files:**
- Create: `scripts/agent-roadmap.mjs`
- Create: `apps/api/tests/agent-roadmap.test.ts`
- Modify: `docs/superpowers/specs/2026-08-17-agent-product-roadmap-and-cross-device-continuity-design.md`

**Interfaces:**
- Produces: `loadProgramState(root)`, `validateProgramState(value, options)`, `RoadmapValidationError`, `renderRoadmap(state)`, `buildStatus(state, git)`, and `verifyRoadmap(root, options)`.
- Contract correction: replace string-only `acceptance` entries with `{ id, text, requiredEvidenceKinds }`; add `satisfies: string[]` to evidence. This makes the design rule that every acceptance item has evidence mechanically verifiable.

- [ ] **Step 1: Write failing contract tests**

Create `apps/api/tests/agent-roadmap.test.ts` with temporary fixture roots and direct module imports:

```ts
import { describe, expect, it } from "vitest";
import { validateProgramState, RoadmapValidationError } from "../../../scripts/agent-roadmap.mjs";

describe("agent roadmap ledger", () => {
  it("requires matching evidence for each accepted acceptance item", () => {
    const state = validState();
    state.nodes[0].evidence = [];
    expect(() => validateProgramState(state, fixtures())).toThrow(RoadmapValidationError);
  });
});
```

Add tests for dependency cycles, duplicate/invalid IDs, unknown fields, absent dependencies, invalid focus, bad SHA, escaping paths, secret-like values, blocker mismatch, illegal state transition, and missing required evidence kind.

- [ ] **Step 2: Prove the test is red**

Run: `npx.cmd vitest run apps/api/tests/agent-roadmap.test.ts`

Expected: FAIL because the module and exports do not exist.

- [ ] **Step 3: Implement strict parsing and semantic validation**

Create `scripts/agent-roadmap.mjs` using only runtime checks and built-in Node modules:

```js
export const NODE_STATUSES = new Set([
  "planned", "active", "blocked", "awaiting_acceptance", "accepted", "deferred", "superseded",
]);

export class RoadmapValidationError extends Error {
  constructor(message) { super(message); this.name = "RoadmapValidationError"; }
}

export function validateProgramState(value, options) {
  // Validate shape, graph, status, blockers, evidence, path containment, and sensitive values.
  // Return normalized immutable state or throw RoadmapValidationError.
}
```

For accepted nodes, require each `acceptance[].id` in `evidence[].satisfies`, each listed evidence kind, and one resolvable 40-character `commit` SHA. Resolve evidence paths under the repository root and reject paths that escape it.

- [ ] **Step 4: Amend the design and pass focused tests**

Update the design examples to use:

```json
"acceptance": [{"id":"M1.9.evidence","text":"Full checks are recorded.","requiredEvidenceKinds":["test","typecheck","commit","document"]}],
"evidence": [{"kind":"test","satisfies":["M1.9.evidence"],"ref":"docs/evidence/2026-08-17-m0-m1-static-pytorch.md","summary":"466 tests passed.","verifiedAt":"2026-08-17T00:00:00.000Z","commit":"bc718abd9e323d991c32d759eb9d8f31bb741459"}]
```

Run: `npx.cmd vitest run apps/api/tests/agent-roadmap.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/agent-roadmap.mjs apps/api/tests/agent-roadmap.test.ts docs/superpowers/specs/2026-08-17-agent-product-roadmap-and-cross-device-continuity-design.md
git commit -m "feat: validate agent roadmap ledger"
```

### Task 2: Add Initial Ledger and Deterministic Renderer

**Files:**
- Create: `docs/agent-program-state.json`
- Create: `docs/ROADMAP.md`
- Modify: `scripts/agent-roadmap.mjs`
- Modify: `apps/api/tests/agent-roadmap.test.ts`

**Interfaces:**
- Produces: `renderRoadmap(state): string` and `writeRoadmap(root): string`.
- Initial state: `M0.9`/`M1.9` accepted; `M2.1` planned and current focus; M2-M4 dependencies/outcomes mirror the accepted design.

- [ ] **Step 1: Add a failing renderer test**

```ts
it("renders current focus, executable nodes, blockers, and evidence deterministically", () => {
  const first = renderRoadmap(validState());
  const second = renderRoadmap(JSON.parse(JSON.stringify(validState())));
  expect(first).toBe(second);
  expect(first).toContain("## Current Focus");
  expect(first).toContain("M2.1");
  expect(first).toContain("## Accepted Evidence");
});
```

- [ ] **Step 2: Prove the test is red**

Run: `npx.cmd vitest run apps/api/tests/agent-roadmap.test.ts`

Expected: FAIL because no renderer or initial ledger exists.

- [ ] **Step 3: Implement canonical state and renderer**

Use exact stable section order: title/branch, current focus, executable nodes, open blockers, milestone table, accepted evidence, and cross-device commands. Sort milestones/nodes numerically, emit LF and a final newline.

```js
export function renderRoadmap(state) {
  const lines = ["# Universal Neural Figure Agent Roadmap", "", `Branch: \`${state.program.branch}\``, "", "## Current Focus"];
  return `${lines.join("\n")}\n`;
}

export function writeRoadmap(root) {
  const content = renderRoadmap(loadProgramState(root));
  writeFileSync(resolve(root, "docs/ROADMAP.md"), content, "utf8");
  return content;
}
```

Record M0/M1 evidence against the existing evidence document and full M0/M1 commit SHAs. Do not record unaccepted M2-M4 work as evidence.

- [ ] **Step 4: Generate and verify**

```powershell
node scripts/agent-roadmap.mjs render
npx.cmd vitest run apps/api/tests/agent-roadmap.test.ts
git diff -- docs/agent-program-state.json docs/ROADMAP.md
```

Expected: roadmap has no local path/secret, names `M2.1`, and tests pass.

- [ ] **Step 5: Commit**

```powershell
git add docs/agent-program-state.json docs/ROADMAP.md scripts/agent-roadmap.mjs apps/api/tests/agent-roadmap.test.ts
git commit -m "feat: add canonical agent roadmap state"
```

### Task 3: Implement Cross-Device Status Command

**Files:**
- Modify: `scripts/agent-roadmap.mjs`
- Modify: `package.json`
- Modify: `apps/api/tests/agent-roadmap.test.ts`

**Interfaces:**
- Produces: `inspectGit(root, runGit)`, `buildStatus(state, git)`, `formatHumanStatus(status)`, and `status [--json] [--strict]` CLI behavior.
- Adds: `agent:status` as `node scripts/agent-roadmap.mjs status`.

- [ ] **Step 1: Add failing status tests**

```ts
it("reports focus, executable nodes, blockers, and continuity warnings", () => {
  const status = buildStatus(validState(), {
    branch: "agent", head: "a".repeat(40), upstream: "origin/agent",
    ahead: 1, behind: 0, detached: false, dirtyTracked: ["README.md"], untracked: ["draft.md"],
  });
  expect(status.currentFocus.id).toBe("M2.1");
  expect(status.warnings).toContainEqual(expect.stringMatching(/ahead/i));
  expect(status.warnings).toContainEqual(expect.stringMatching(/untracked/i));
});
```

- [ ] **Step 2: Prove the test is red**

Run: `npx.cmd vitest run apps/api/tests/agent-roadmap.test.ts`

Expected: FAIL because Git inspection and status projection are absent.

- [ ] **Step 3: Implement read-only Git inspection and CLI modes**

Use `execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })`; never invoke a shell. Convert Git inspection failures to warnings only.

```js
const [command, ...flags] = process.argv.slice(2);
if (command === "status") {
  const status = buildStatus(loadProgramState(root), inspectGit(root));
  process.stdout.write(flags.includes("--json") ? `${JSON.stringify(status, null, 2)}\n` : formatHumanStatus(status));
  process.exitCode = flags.includes("--strict") && status.strictFailures.length > 0 ? 1 : 0;
}
```

Strict failures are detached HEAD, wrong branch, unavailable upstream, ahead/behind branch, invalid ledger, broken evidence, and generated-roadmap drift. Dirty and untracked files are warnings, never strict failures by themselves.

- [ ] **Step 4: Verify all status modes**

```powershell
npm run agent:status
npm run agent:status -- --json
npm run agent:status -- --strict
npx.cmd vitest run apps/api/tests/agent-roadmap.test.ts
```

Expected: human output names `M2.1`; JSON contains stable safe fields; strict mode exits zero in a clean synchronized fixture and non-zero for injected failures.

- [ ] **Step 5: Commit**

```powershell
git add scripts/agent-roadmap.mjs package.json apps/api/tests/agent-roadmap.test.ts
git commit -m "feat: report cross-device agent roadmap status"
```

### Task 4: Add Verifier and Existing Quality-Gate Integration

**Files:**
- Modify: `scripts/agent-roadmap.mjs`
- Modify: `scripts/check-foundation.mjs`
- Modify: `package.json`
- Modify: `apps/api/tests/agent-roadmap.test.ts`

**Interfaces:**
- Adds: `agent:render-roadmap` and `agent:verify-roadmap` package scripts.
- Produces: `verifyRoadmap(root, options)` that validates state and projection without modifying files.

- [ ] **Step 1: Add failing drift test**

```ts
it("rejects manual roadmap drift without rewriting the file", () => {
  const root = fixtureRoot();
  writeFileSync(resolve(root, "docs/ROADMAP.md"), "manual edit\n");
  expect(() => verifyRoadmap(root, fixtures())).toThrow(/generated roadmap/i);
  expect(readFileSync(resolve(root, "docs/ROADMAP.md"), "utf8")).toBe("manual edit\n");
});
```

- [ ] **Step 2: Prove the test is red**

Run: `npx.cmd vitest run apps/api/tests/agent-roadmap.test.ts`

Expected: FAIL because verification does not compare the generated projection without writing it.

- [ ] **Step 3: Implement verifier and integrate the Foundation check**

`verify` calls `loadProgramState`, compares `renderRoadmap(state)` with `docs/ROADMAP.md`, and checks references without calling `writeRoadmap`.

Add to `scripts/check-foundation.mjs` after current checks:

```js
import { verifyRoadmap } from "./agent-roadmap.mjs";

verifyRoadmap(root);
console.log("Agent roadmap OK: canonical state, evidence references, and rendered roadmap are aligned.");
```

Add package scripts:

```json
"agent:status": "node scripts/agent-roadmap.mjs status",
"agent:render-roadmap": "node scripts/agent-roadmap.mjs render",
"agent:verify-roadmap": "node scripts/agent-roadmap.mjs verify"
```

- [ ] **Step 4: Run focused and integration checks**

```powershell
npx.cmd vitest run apps/api/tests/agent-roadmap.test.ts
npm run agent:verify-roadmap
npm run api:check
```

Expected: all commands exit zero; the Foundation check retains its existing success line and adds the roadmap success line.

- [ ] **Step 5: Commit**

```powershell
git add scripts/agent-roadmap.mjs scripts/check-foundation.mjs package.json apps/api/tests/agent-roadmap.test.ts
git commit -m "feat: verify agent roadmap continuity"
```

### Task 5: Wire Human Entry Points and Run Full Acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/START_HERE.md`
- Modify: `AGENTS.md`
- Modify: `apps/api/tests/project-onboarding.test.ts`
- Modify: `docs/evidence/2026-08-17-m0-m1-static-pytorch.md`

**Interfaces:**
- Entry points must name `agent:status`, `docs/ROADMAP.md`, and `docs/agent-program-state.json`.
- The onboarding test becomes the machine-checked assertion that a fresh agent receives the recovery route.

- [ ] **Step 1: Add failing onboarding assertions**

```ts
expect(readme).toContain("npm run agent:status");
expect(startHere).toContain("docs/ROADMAP.md");
expect(startHere).toContain("docs/agent-program-state.json");
expect(agents).toContain("npm run agent:status");
```

- [ ] **Step 2: Prove documentation is incomplete**

Run: `npx.cmd vitest run apps/api/tests/project-onboarding.test.ts`

Expected: FAIL because the new recovery entry points are absent.

- [ ] **Step 3: Update entry documents and evidence**

In `README.md`, add `git fetch origin`, `git switch agent`, `git pull --ff-only`, and `npm run agent:status` to cross-computer start. In `docs/START_HERE.md`, lead with the same sequence, name the JSON ledger as canonical and Markdown roadmap as derived, then link the authoritative design/current focus. In `AGENTS.md`, require `npm run agent:status` before planning or modifying Agent product work. Extend the evidence document with the R0 commands and exact results only after the commands pass.

- [ ] **Step 4: Run full acceptance gate**

```powershell
npx.cmd vitest run apps/api/tests/project-onboarding.test.ts apps/api/tests/agent-roadmap.test.ts
npm run agent:verify-roadmap
npx.cmd tsc --noEmit
npm.cmd run api:test
npm.cmd run api:check
git diff --check
```

Expected: all listed commands exit zero. The focused status tests prove that strict mode rejects an ahead/behind branch. After the implementation commits are pushed and the local branch is synchronized with `origin/agent`, run `npm run agent:status -- --strict` as the cross-device acceptance command and record that successful output in the evidence document.

- [ ] **Step 5: Commit and inspect status**

```powershell
git add README.md docs/START_HERE.md AGENTS.md docs/evidence/2026-08-17-m0-m1-static-pytorch.md apps/api/tests/project-onboarding.test.ts
git commit -m "docs: add cross-device agent roadmap onboarding"
git status --short --branch
```

Expected: only unrelated pre-existing worktree changes remain; do not stage, remove, reset, or clean them.

## Plan Self-Review

- Spec coverage: Tasks 1-4 implement canonical state, generated roadmap, local commands, strict verification, CI integration, and secret/path controls. Task 5 makes recovery discoverable and records evidence.
- Dependency coverage: Task 1 supplies validation; Task 2 supplies canonical state; Task 3 supplies status; Task 4 supplies verifier; Task 5 consumes all operational commands.
- Test coverage: every behavior has a focused red/green cycle and the final full-suite/type/check/diff gate.
- Scope: R0 does not implement M2 compiler, preview, Visio, Provider, or runtime-data functionality. M2.1 remains next only after R0 acceptance.
- Placeholder scan: every task identifies exact files, interfaces, commands, expected outcomes, and a commit boundary.
