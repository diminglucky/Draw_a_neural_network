import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
        previousStatus: "awaiting_acceptance",
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
        previousStatus: null,
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

function expectInvalid(mutator: (state: ReturnType<typeof validState>) => void) {
  const state = validState();
  mutator(state);
  expect(() => validateProgramState(state, fixtures())).toThrow(RoadmapValidationError);
}

describe("agent roadmap ledger", () => {
  it("requires matching evidence for each accepted acceptance item", () => {
    const state = validState();
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
