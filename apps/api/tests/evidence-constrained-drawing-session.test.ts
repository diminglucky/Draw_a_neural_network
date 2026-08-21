import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
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
