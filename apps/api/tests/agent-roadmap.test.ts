import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_BASELINE_NODE_IDS,
  RoadmapValidationError,
  buildStatus,
  loadProgramState,
  renderRoadmap,
  validateProgramState,
  verifyRoadmap,
} from "../../../scripts/agent-roadmap.mjs";

const COMMIT = "a".repeat(40);
type LedgerFixture = Record<string, any>;

function fixtureRoot() {
  const root = mkdtempSync(resolve(tmpdir(), "agent-roadmap-"));
  mkdirSync(resolve(root, "docs", "evidence"), { recursive: true });
  writeFileSync(resolve(root, "docs", "evidence", "accepted.md"), "Evidence\n", "utf8");
  return root;
}

function fixtures(root = fixtureRoot()) {
  return {
    root,
    isCommitResolvable: (sha: string) => sha === COMMIT,
  };
}

function validState(): LedgerFixture {
  return {
    schemaVersion: 1,
    program: {
      id: "universal-neural-figure-agent",
      name: "Universal Neural Figure Agent",
      branch: "agent",
      architectureSpec: "docs/evidence/accepted.md",
    },
    updatedAt: "2026-08-17T00:00:00.000Z",
    currentFocus: "M2.1",
    milestones: [
      { id: "M1", title: "Foundation", status: "accepted" },
      { id: "M2", title: "Preview", status: "planned" },
    ],
    nodes: [
      {
        id: "M1.9",
        milestoneId: "M1",
        title: "Foundation acceptance",
        status: "accepted",
        previousStatus: null,
        bootstrapBaseline: true,
        dependsOn: [],
        outcome: "The foundation is accepted.",
        acceptance: [{
          id: "M1.9.checked",
          text: "Required checks are recorded.",
          requiredEvidenceKinds: ["test", "commit", "document"],
        }],
        evidence: [
          {
            kind: "test",
            satisfies: ["M1.9.checked"],
            ref: "docs/evidence/accepted.md",
            summary: "Focused tests passed.",
            verifiedAt: "2026-08-17T00:00:00.000Z",
            commit: COMMIT,
          },
          {
            kind: "commit",
            satisfies: ["M1.9.checked"],
            ref: "docs/evidence/accepted.md",
            summary: "Implementation commit exists.",
            verifiedAt: "2026-08-17T00:00:00.000Z",
            commit: COMMIT,
          },
          {
            kind: "document",
            satisfies: ["M1.9.checked"],
            ref: "docs/evidence/accepted.md",
            summary: "Acceptance record exists.",
            verifiedAt: "2026-08-17T00:00:00.000Z",
            commit: COMMIT,
          },
        ],
        nextAction: "Start M2.1.",
        blockerIds: [],
        successorId: null,
      },
      {
        id: "M2.1",
        milestoneId: "M2",
        title: "Preview contract",
        status: "planned",
        dependsOn: ["M1.9"],
        outcome: "Create a preview contract.",
        acceptance: [{
          id: "M2.1.contract",
          text: "The contract is approved.",
          requiredEvidenceKinds: ["test"],
        }],
        evidence: [],
        nextAction: "Write the implementation plan.",
        blockerIds: [],
        successorId: null,
      },
    ],
    blockers: [],
  };
}

function nonBootstrapState(): LedgerFixture {
  const state = validState();
  state.nodes[0].previousStatus = "awaiting_acceptance";
  state.nodes[1].status = "active";
  state.nodes[1].previousStatus = "planned";
  for (const node of state.nodes) delete node.bootstrapBaseline;
  return state;
}

function blockedState(): LedgerFixture {
  const state = nonBootstrapState();
  state.nodes[1].status = "blocked";
  state.nodes[1].previousStatus = "active";
  state.nodes[1].blockerIds = ["B-M2-003"];
  state.blockers.push({
    id: "B-M2-003",
    nodeId: "M2.1",
    severity: "medium",
    summary: "Review is pending.",
    resolution: "Record the review.",
    openedAt: "2026-08-17T00:00:00.000Z",
    status: "open",
  });
  return state;
}

function expectInvalid(mutator: (state: ReturnType<typeof validState>) => void) {
  const state = nonBootstrapState();
  mutator(state);
  expect(() => validateProgramState(state, fixtures())).toThrow(RoadmapValidationError);
}

function liveRoadmapState(): LedgerFixture {
  return JSON.parse(readFileSync(resolve(process.cwd(), "docs", "agent-program-state.json"), "utf8"));
}

function configuredAcceptanceNode(input: {
  id: string;
  acceptance: LedgerFixture["acceptance"];
}): LedgerFixture {
  return {
    id: input.id,
    milestoneId: "M2",
    title: "Governed platform boundary",
    status: "accepted",
    previousStatus: "awaiting_acceptance",
    dependsOn: ["M1.9"],
    outcome: "Acceptance requires independent evidence.",
    acceptance: input.acceptance,
    evidence: input.acceptance.flatMap((item: { id: string }) => [{
      kind: "test",
      satisfies: [item.id],
      ref: "docs/evidence/accepted.md",
      summary: "Focused tests passed.",
      verifiedAt: "2026-08-21T00:00:00.000Z",
      commit: COMMIT,
    }]),
    nextAction: "Record the remaining evidence.",
    blockerIds: [],
    successorId: null,
  };
}

describe("agent roadmap ledger", () => {
  it("keeps M2.12 active and design-gated until Phase 0 through Phase 2 prerequisites are documented", () => {
    const live = liveRoadmapState();
    const m212 = live.nodes.find((node: { id: string }) => node.id === "M2.12");
    const m213 = live.nodes.find((node: { id: string }) => node.id === "M2.13");

    expect(live.currentFocus).toBe("M2.12");
    expect(m212).toMatchObject({
      status: "active",
      dependsOn: ["M2.8", "M2.10", "M2.11"],
    });
    expect(m212?.nextAction).toMatch(/Phase 0.*Phase 2/i);
    expect(m212?.acceptance.find((item: { id: string }) => item.id === "M2.12.quality")).toMatchObject({
      requiredEvidenceKinds: expect.arrayContaining(["document", "commit"]),
    });
    expect(m212?.acceptance.find((item: { id: string }) => item.id === "M2.12.quality")?.text).toMatch(/Phase 0.*Phase 2/i);
    expect(m212?.evidence).toEqual([]);
    expect(m213?.status).not.toBe("accepted");

    for (const node of [m212, m213]) {
      expect(node).toBeDefined();
      const state = nonBootstrapState();
      state.nodes.push(configuredAcceptanceNode({ id: node!.id, acceptance: node!.acceptance }));
      expect(() => validateProgramState(state, fixtures())).toThrow(RoadmapValidationError);
    }
  });

  it("requires the complete formal-PVP-to-real-host chain before current-page Visio can be accepted", () => {
    const live = liveRoadmapState();
    const currentPageVisio = live.nodes.find((node: { id: string }) => node.id === "M3.6");

    expect(currentPageVisio).toMatchObject({ status: "planned" });
    expect(currentPageVisio?.dependsOn).toEqual(expect.arrayContaining([
      "M2.13",
      "M3.2",
      "M3.3",
      "M3.4",
      "M3.5",
    ]));

    const state = nonBootstrapState();
    state.nodes.push(configuredAcceptanceNode({ id: currentPageVisio!.id, acceptance: currentPageVisio!.acceptance }));
    expect(() => validateProgramState(state, fixtures())).toThrow(RoadmapValidationError);
  });

  it("requires matching evidence for each accepted acceptance item", () => {
    const state = nonBootstrapState();
    state.nodes[0].acceptance.push({
      id: "M1.9.second-check",
      text: "A separate check is recorded.",
      requiredEvidenceKinds: ["test"],
    });

    expect(() => validateProgramState(state, fixtures())).toThrow(RoadmapValidationError);
  });

  it("rejects dependency cycles", () => {
    expectInvalid((state) => {
      state.nodes[0].dependsOn = ["M2.1"];
      state.nodes[1].status = "active";
      state.nodes[1].previousStatus = "planned";
    });
  });

  it("rejects duplicate and invalid IDs", () => {
    expectInvalid((state) => { state.nodes[1].id = "M1.9"; });
    expectInvalid((state) => { state.nodes[1].id = "preview"; });
  });

  it("rejects unknown fields", () => {
    expectInvalid((state) => { (state.nodes[0] as Record<string, unknown>).extra = true; });
  });

  it("rejects absent dependencies and invalid current focus", () => {
    expectInvalid((state) => { state.nodes[1].dependsOn = ["M9.9"]; });
    expectInvalid((state) => { state.currentFocus = "M9.9"; });
  });

  it("rejects an unresolvable commit SHA", () => {
    expectInvalid((state) => { state.nodes[0].evidence[0]!.commit = "b".repeat(40); });
  });

  it("rejects evidence paths that escape the repository", () => {
    expectInvalid((state) => { state.nodes[0].evidence[0]!.ref = "../outside.md"; });
  });

  it("rejects secret-like values", () => {
    expectInvalid((state) => { state.nodes[0].evidence[0]!.summary = "token sk_1234567890"; });
  });

  it("rejects blocker mismatches", () => {
    expectInvalid((state) => {
      state.nodes[1].blockerIds = ["B-M2-001"];
      state.blockers.push({
        id: "B-M2-001",
        nodeId: "M2.1",
        severity: "high",
        summary: "Needs a decision.",
        resolution: "Approve it.",
        openedAt: "2026-08-17T00:00:00.000Z",
        status: "open",
      });
    });
  });

  it("rejects illegal state transitions", () => {
    expectInvalid((state) => {
      state.nodes[0].previousStatus = "planned";
    });
  });

  it("permits a planned node with recorded evidence to reconcile directly into awaiting acceptance", () => {
    const state = validState();
    const node = state.nodes[1];
    node.status = "awaiting_acceptance";
    node.previousStatus = "planned";
    node.evidence = [{
      kind: "test",
      satisfies: ["M2.1.contract"],
      ref: "docs/evidence/accepted.md",
      summary: "Focused contract tests passed.",
      verifiedAt: "2026-08-17T00:00:00.000Z",
      commit: COMMIT,
    }];

    expect(() => validateProgramState(state, fixtures())).not.toThrow();
  });

  it("permits a null previous status only for fixed schema-v1 bootstrap baseline nodes", () => {
    expectInvalid((state) => {
      state.nodes[0].previousStatus = null;
      state.nodes[0].bootstrapBaseline = false;
    });

    const state = validState();
    expect(() => validateProgramState(state, fixtures())).not.toThrow();
    expect(BOOTSTRAP_BASELINE_NODE_IDS).toEqual(new Set(["M0.9", "M1.9"]));

    const nonBaseline = validState();
    nonBaseline.nodes[0].id = "M2.9";
    expect(() => validateProgramState(nonBaseline, fixtures())).toThrow(RoadmapValidationError);
  });

  it("rejects evidence symlink escapes or asserts that symlinks are unsupported", () => {
    const root = fixtureRoot();
    const outside = mkdtempSync(resolve(tmpdir(), "agent-roadmap-outside-"));
    const outsideEvidence = resolve(outside, "outside.md");
    const link = resolve(root, "docs", "evidence", "escape.md");
    writeFileSync(outsideEvidence, "Outside evidence\n", "utf8");

    try {
      symlinkSync(outsideEvidence, link, "file");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toMatch(/^(EPERM|EACCES|ENOSYS|UNKNOWN)$/);
      return;
    }

    const state = nonBootstrapState();
    state.nodes[0].evidence[0].ref = "docs/evidence/escape.md";
    expect(() => validateProgramState(state, fixtures(root))).toThrow(RoadmapValidationError);
  });

  it("rejects sensitive values in free-text fields while accepting normal technical text", () => {
    expect(() => validateProgramState(nonBootstrapState(), fixtures())).not.toThrow();
    expectInvalid((state) => { state.nodes[1].title = "Investigate user-123 rendering"; });
    expectInvalid((state) => { state.nodes[1].title = "Investigate userId=visitor-alpha rendering"; });
    expectInvalid((state) => { state.nodes[1].outcome = "Review C:\\Users\\Alice\\private.md"; });
    expectInvalid((state) => { state.nodes[1].nextAction = "Open workstation.internal for review"; });
    expectInvalid((state) => { state.nodes[0].evidence[0].summary = "apiKey=sk_1234567890"; });
  });

  it("applies a controlled-summary policy to every free-text ledger field", () => {
    expectInvalid((state) => { state.nodes[1].title = "class Net(nn.Module):\n  def forward(self, x): return x"; });
    expectInvalid((state) => { state.nodes[1].outcome = "class Net(nn.Module): pass"; });
    expectInvalid((state) => { state.nodes[1].nextAction = "def forward(x): return x"; });
    expectInvalid((state) => { state.nodes[1].acceptance[0].text = "import torch"; });
    expectInvalid((state) => { state.nodes[0].evidence[0].summary = "const draw = (x) => x"; });

    const blockedSummary = blockedState();
    blockedSummary.blockers[0].summary = "Use {node};";
    expect(() => validateProgramState(blockedSummary, fixtures())).toThrow(RoadmapValidationError);

    const blockedResolution = blockedState();
    blockedResolution.blockers[0].resolution = "layer = nn.Conv2d(3, 16, 3)";
    expect(() => validateProgramState(blockedResolution, fixtures())).toThrow(RoadmapValidationError);

    expectInvalid((state) => { state.nodes[1].outcome = "x = y"; });

    expectInvalid((state) => { state.nodes[1].title = "a".repeat(501); });
  });

  it("requires every child node to be accepted before its milestone is accepted", () => {
    expectInvalid((state) => { state.milestones[1].status = "accepted"; });
  });

  it("requires every open blocker to appear in its node blocker IDs", () => {
    expectInvalid((state) => {
      state.blockers.push({
        id: "B-M2-002",
        nodeId: "M2.1",
        severity: "medium",
        summary: "An approval is pending.",
        resolution: "Record the approval.",
        openedAt: "2026-08-17T00:00:00.000Z",
        status: "open",
      });
    });
  });

  it("requires every required evidence kind for accepted acceptance items", () => {
    expectInvalid((state) => {
      state.nodes[0].evidence = state.nodes[0].evidence.filter((record: { kind: string }) => record.kind !== "document");
    });
  });

  it("normalizes immutable state and provides the Task 1 public contract", () => {
    const root = fixtureRoot();
    const state = validState();
    writeFileSync(resolve(root, "docs", "agent-program-state.json"), JSON.stringify(state), "utf8");

    const validated = validateProgramState(state, fixtures(root));
    expect(Object.isFrozen(validated)).toBe(true);
    expect(renderRoadmap(validated)).toContain("Universal Neural Figure Agent");
    expect(buildStatus(validated, { branch: "agent" }).currentFocus.id).toBe("M2.1");
    expect(loadProgramState(root, fixtures(root)).currentFocus).toBe("M2.1");
    expect(verifyRoadmap(root, fixtures(root)).currentFocus).toBe("M2.1");
  });
});
