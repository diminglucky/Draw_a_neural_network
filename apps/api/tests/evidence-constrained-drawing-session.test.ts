import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { digestGenericPlanSnapshotValue } from "../src/generic-plan-snapshot.js";
import {
  confirmEvidenceConstrainedDrawingSession,
  openEvidenceConstrainedDrawingSession,
  type EvidenceConstrainedDrawingSessionOpenRequest,
} from "../src/evidence-constrained-drawing-session.js";

function completeUnknownOperatorPrompt(): string {
  return JSON.stringify({
    graphId: "spectral-fusion-net",
    topology: "complete",
    nodes: [
      { nodeId: "input", kind: "input", label: "Image", inputPorts: [], outputPorts: [{ portId: "out" }] },
      { nodeId: "mixer", kind: "operator", label: "Spectral Mixer", operation: "spectral_mixer", inputPorts: [{ portId: "in" }], outputPorts: [{ portId: "out" }] },
      { nodeId: "output", kind: "output", label: "Prediction", inputPorts: [{ portId: "in" }], outputPorts: [] },
    ],
    edges: [
      { edgeId: "input-mixer", sourcePortId: "input:out", targetPortId: "mixer:in" },
      { edgeId: "mixer-output", sourcePortId: "mixer:out", targetPortId: "output:in" },
    ],
  });
}

function formalPromptRequest(): EvidenceConstrainedDrawingSessionOpenRequest {
  return {
    owner: { ownerId: "owner-1", deviceId: "device-1" },
    input: { kind: "typed-prompt", sourceId: "prompt-source", prompt: completeUnknownOperatorPrompt() },
    detail: "architecture",
    updateTarget: { workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 },
  };
}

function staticSourceRequest(): EvidenceConstrainedDrawingSessionOpenRequest {
  const code = [
    'raise RuntimeError("static source must not execute")',
    "class Chain(nn.Module):",
    " def __init__(self):",
    "  self.projection = nn.Conv2d(3, 8, 1)",
    " def forward(self, x):",
    "  return self.projection(x)",
  ].join("\n");
  return {
    owner: { ownerId: "owner-1", deviceId: "device-1" },
    input: {
      kind: "static-pytorch",
      sourceId: "static-source",
      sourceSha256: sha256(code),
      code,
    },
    detail: "architecture",
    updateTarget: { workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 },
  };
}

function multipleDynamicStaticSourceRequest(): EvidenceConstrainedDrawingSessionOpenRequest {
  const code = [
    "class Dynamic(nn.Module):",
    " def forward(self, x):",
    "  if x.sum() > 0:",
    "   return x",
    "  while x.sum() > 0:",
    "   return x",
    "  return -x",
  ].join("\n");
  return {
    ...formalPromptRequest(),
    input: {
      kind: "static-pytorch",
      sourceId: "multiple-dynamic-static-source",
      sourceSha256: sha256(code),
      code,
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sessionIdentity(
  owner: EvidenceConstrainedDrawingSessionOpenRequest["owner"],
  detail: EvidenceConstrainedDrawingSessionOpenRequest["detail"],
  target: EvidenceConstrainedDrawingSessionOpenRequest["updateTarget"],
  ugsHash: string,
): string {
  return `session:${sha256(JSON.stringify({ version: "evidence-constrained-drawing-session-1", ownerId: owner.ownerId, deviceId: owner.deviceId, detail, target, ugsHash }))}`;
}

function ambiguousPromptRequest(): EvidenceConstrainedDrawingSessionOpenRequest {
  return {
    ...formalPromptRequest(),
    input: {
      kind: "typed-prompt",
      sourceId: "ambiguous-source",
      prompt: JSON.stringify({
        graphId: "unresolved-fusion-net",
        topology: "ambiguous",
        nodes: [
          { nodeId: "input", kind: "input", label: "Input", inputPorts: [], outputPorts: [{ portId: "out" }] },
          { nodeId: "output", kind: "output", label: "Output", inputPorts: [{ portId: "in" }], outputPorts: [] },
        ],
        edges: [{ edgeId: "input-output", sourcePortId: "input:out", targetPortId: "output:in" }],
      }),
    },
  };
}

function architectureDescriptionRequest(proposal: unknown = architectureDescriptionProposal()): EvidenceConstrainedDrawingSessionOpenRequest {
  return {
    ...formalPromptRequest(),
    input: {
      kind: "architecture-description",
      request: {
        requestId: "session-description-request",
        evidence: [{
          evidenceId: "e-description",
          sourceId: "session-public-description",
          sourceHash: sha256("session public description"),
          locator: "section:architecture",
          excerptDigest: sha256("custom spectral module"),
        }],
        detail: "architecture",
        maxNodes: 8,
        maxEdges: 8,
      },
      proposal,
    },
  };
}

function architectureDescriptionProposal() {
  return {
    version: 1,
    nodes: [
      { nodeId: "input", kind: "input", label: "Image", inputPortIds: [], outputPortIds: ["input:out"], evidenceIds: ["e-description"] },
      { nodeId: "spectral", kind: "operator", label: "Spectral mixer", operation: "spectral_mixer", inputPortIds: ["spectral:in"], outputPortIds: ["spectral:out"], evidenceIds: ["e-description"] },
      { nodeId: "output", kind: "output", label: "Prediction", inputPortIds: ["output:in"], outputPortIds: [], evidenceIds: ["e-description"] },
    ],
    ports: [
      { portId: "input:out", nodeId: "input", direction: "output", evidenceIds: ["e-description"] },
      { portId: "spectral:in", nodeId: "spectral", direction: "input", evidenceIds: ["e-description"] },
      { portId: "spectral:out", nodeId: "spectral", direction: "output", evidenceIds: ["e-description"] },
      { portId: "output:in", nodeId: "output", direction: "input", evidenceIds: ["e-description"] },
    ],
    edges: [
      { edgeId: "input-spectral", sourcePortId: "input:out", targetPortId: "spectral:in", evidenceIds: ["e-description"] },
      { edgeId: "spectral-output", sourcePortId: "spectral:out", targetPortId: "output:in", evidenceIds: ["e-description"] },
    ],
    unresolved: [],
  };
}

describe("EvidenceConstrainedDrawingSession", () => {
  it("opens a stable formal renderer-neutral session for a complete prompt with an unknown operator", () => {
    const first = openEvidenceConstrainedDrawingSession(formalPromptRequest());
    const second = openEvidenceConstrainedDrawingSession(formalPromptRequest());

    expect(first).toMatchObject({ state: "formal_preview", revision: 1, preview: { kind: "formal", exportEligible: false } });
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.ugsHash).toBe(second.ugsHash);
    expect(first.preview?.pvp.eligibility.kind).toBe("formal");
    expect(first.ugs.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "mixer", kind: "custom_operator", operationKnowledge: "custom" }),
    ]));
    expect(first).not.toHaveProperty("rawSource");
    expect(first).not.toHaveProperty("prompt");
    expect(first).not.toHaveProperty("code");
  });

  it("opens a static-source formal session without executing submitted code", () => {
    const request = staticSourceRequest();
    const sourceHash = request.input.kind === "static-pytorch" ? request.input.sourceSha256 : "";
    const session = openEvidenceConstrainedDrawingSession(request);

    expect(session).toMatchObject({ state: "formal_preview", revision: 1, preview: { kind: "formal", exportEligible: false } });
    expect(session.sources).toEqual([{ kind: "static-pytorch", sourceId: "static-source", sourceHash }]);
  });

  it("threads only proposal and evidence digests from an unfamiliar architecture description into the session", () => {
    const session = openEvidenceConstrainedDrawingSession(architectureDescriptionRequest());

    expect(session).toMatchObject({ state: "formal_preview", interpretation: {
      proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    } });
    expect(session.sources).toEqual([expect.objectContaining({ kind: "architecture-description", sourceId: "architecture-input:session-description-request" })]);
    expect(session).not.toHaveProperty("proposal");
    expect(session).not.toHaveProperty("rawSource");
  });

  it("opens an invalid unfamiliar architecture proposal as one clarification without a preview", () => {
    const session = openEvidenceConstrainedDrawingSession(architectureDescriptionRequest({ ...architectureDescriptionProposal(), comCommand: "x" }));

    expect(session).toMatchObject({ state: "clarification" });
    expect(session.preview).toBeUndefined();
    expect(session.clarification?.questionId).toBe("clarification:session-description-request:interpreter-unavailable");
  });

  it("does not convert an unavailable architecture interpreter into a formal preview through generic confirmation", () => {
    const pending = openEvidenceConstrainedDrawingSession(architectureDescriptionRequest({ ...architectureDescriptionProposal(), comCommand: "x" }));

    expect(() => confirmEvidenceConstrainedDrawingSession(pending, {
      owner: { ownerId: "owner-1", deviceId: "device-1" },
      sessionId: pending.sessionId,
      expectedRevision: pending.revision,
      questionId: pending.clarification!.questionId,
      value: "confirm-topology-complete",
    })).toThrow(/interpreter|proposal/i);
  });

  it("returns exactly one clarification and no PVP for blocking topology", () => {
    const session = openEvidenceConstrainedDrawingSession(ambiguousPromptRequest());

    expect(session).toMatchObject({ state: "clarification", revision: 1 });
    expect(session.preview).toBeUndefined();
    expect(session.clarification).toMatchObject({
      questionId: "clarification:prompt-topology-unresolved",
      candidateValues: ["confirm-topology-complete"],
    });
    expect(session.clarification?.affectedUgsIds).toEqual(["input", "output"]);
  });

  it("keeps every static topology uncertainty and advances through one deterministic clarification at a time", () => {
    const pending = openEvidenceConstrainedDrawingSession(multipleDynamicStaticSourceRequest());
    const initialTopologyBlockers = pending.ugs.unresolved.filter((item) => item.scope === "topology" && item.severity === "blocking");

    expect(pending).toMatchObject({ state: "clarification", revision: 1 });
    expect(initialTopologyBlockers.length).toBeGreaterThan(1);

    const next = confirmEvidenceConstrainedDrawingSession(pending, {
      owner: { ownerId: "owner-1", deviceId: "device-1" },
      sessionId: pending.sessionId,
      expectedRevision: pending.revision,
      questionId: pending.clarification!.questionId,
      value: "confirm-topology-complete",
    });

    expect(next).toMatchObject({ state: "clarification", revision: 2 });
    expect(next.clarification?.questionId).not.toBe(pending.clarification?.questionId);
    expect(next.ugs.unresolved.filter((item) => item.scope === "topology" && item.severity === "blocking")).toHaveLength(initialTopologyBlockers.length - 1);
  });

  it("recomputes a formal revision and semantic local delta after the matching confirmation", () => {
    const pending = openEvidenceConstrainedDrawingSession(ambiguousPromptRequest());
    const resolved = confirmEvidenceConstrainedDrawingSession(pending, {
      owner: { ownerId: "owner-1", deviceId: "device-1" },
      sessionId: pending.sessionId,
      expectedRevision: 1,
      questionId: pending.clarification!.questionId,
      value: "confirm-topology-complete",
    });

    expect(resolved).toMatchObject({ state: "formal_preview", revision: 2, preview: { kind: "formal", exportEligible: false } });
    expect(resolved.ugs.revision).toBe(2);
    expect(resolved.delta).toMatchObject({ fromRevision: 1, toRevision: 2, affectedUgsIds: ["input", "output"] });
    expect(resolved.delta!.addedPrimitiveIds.length).toBeGreaterThan(0);
    expect(resolved.delta!.changedPrimitiveIds).toEqual([]);
  });

  it.each([
    ["foreign owner", { owner: { ownerId: "owner-2", deviceId: "device-1" } }],
    ["foreign device", { owner: { ownerId: "owner-1", deviceId: "device-2" } }],
    ["stale revision", { expectedRevision: 0 }],
    ["wrong answer", { value: "infer-a-topology" }],
    ["wrong question", { questionId: "clarification:other" }],
  ])("rejects a %s confirmation", (_label, override) => {
    const pending = openEvidenceConstrainedDrawingSession(ambiguousPromptRequest());
    expect(() => confirmEvidenceConstrainedDrawingSession(pending, {
      owner: { ownerId: "owner-1", deviceId: "device-1" },
      sessionId: pending.sessionId,
      expectedRevision: pending.revision,
      questionId: pending.clarification!.questionId,
      value: "confirm-topology-complete",
      ...override,
    } as never)).toThrow();
  });

  it("rejects source input that tries to provide renderer control", () => {
    expect(() => openEvidenceConstrainedDrawingSession({
      ...formalPromptRequest(),
      input: { kind: "typed-prompt", sourceId: "unsafe-source", prompt: "Visio geometry command" },
    })).toThrow();
  });

  it("rejects a static source digest that does not match its submitted bytes", () => {
    const request = staticSourceRequest();
    expect(() => openEvidenceConstrainedDrawingSession({
      ...request,
      input: { ...request.input, sourceSha256: "b".repeat(64) } as typeof request.input,
    })).toThrow();
  });

  it("rejects a resumed source whose ID and digest come from different UGS evidence records", () => {
    const pending = openEvidenceConstrainedDrawingSession(ambiguousPromptRequest());
    const forged = structuredClone(pending) as typeof pending & {
      sources: Array<{ kind: "typed-prompt" | "static-pytorch"; sourceId: string; sourceHash: string }>;
      ugs: typeof pending.ugs;
      ugsHash: string;
      sessionId: string;
    };
    const secondarySourceId = "secondary-source";
    const secondarySourceHash = "a".repeat(64);

    forged.ugs.sourceIds.push(secondarySourceId);
    forged.ugs.sourceHashes.push(secondarySourceHash);
    forged.ugs.evidence.push({
      evidenceId: "e:secondary-provenance",
      sourceId: secondarySourceId,
      sourceHash: secondarySourceHash,
      locator: "test:secondary-provenance",
      excerptDigest: "b".repeat(64),
    });
    forged.sources[0] = { ...forged.sources[0]!, sourceHash: secondarySourceHash };
    forged.ugsHash = digestGenericPlanSnapshotValue(forged.ugs);
    forged.sessionId = sessionIdentity(forged.owner, forged.detail, forged.updateTarget, forged.ugsHash);

    expect(() => confirmEvidenceConstrainedDrawingSession(forged, {
      owner: { ownerId: "owner-1", deviceId: "device-1" },
      sessionId: forged.sessionId,
      expectedRevision: forged.revision,
      questionId: forged.clarification!.questionId,
      value: "confirm-topology-complete",
    })).toThrow(/provenance/i);
  });

  it.each(["code", "rawSource", "workerCommand", "comCommand"])("rejects a forged %s field inside a resumed source projection", (field) => {
    const pending = openEvidenceConstrainedDrawingSession(ambiguousPromptRequest());
    const forged = structuredClone(pending) as typeof pending & { sources: Array<Record<string, unknown>> };
    forged.sources[0]![field] = "forged-control";

    expect(() => confirmEvidenceConstrainedDrawingSession(forged, {
      owner: { ownerId: "owner-1", deviceId: "device-1" },
      sessionId: pending.sessionId,
      expectedRevision: pending.revision,
      questionId: pending.clarification!.questionId,
      value: "confirm-topology-complete",
    })).toThrow();
  });

  it("rejects a resumed session whose update target no longer matches its deterministic identity", () => {
    const pending = openEvidenceConstrainedDrawingSession(ambiguousPromptRequest());
    const forged = structuredClone(pending) as typeof pending & { updateTarget: { pageId: string } };
    forged.updateTarget.pageId = "page-2";

    expect(() => confirmEvidenceConstrainedDrawingSession(forged, {
      owner: { ownerId: "owner-1", deviceId: "device-1" },
      sessionId: pending.sessionId,
      expectedRevision: pending.revision,
      questionId: pending.clarification!.questionId,
      value: "confirm-topology-complete",
    })).toThrow();
  });
});
