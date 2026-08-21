import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  interpretEvidenceAugmentedInput,
  type BoundedInterpretationRequest,
  type InterpreterProposal,
} from "../src/evidence-augmented-ugs-interpreter.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function request(overrides: Partial<BoundedInterpretationRequest> = {}): BoundedInterpretationRequest {
  return {
    requestId: "architecture-request",
    evidence: [{
      evidenceId: "e-description",
      sourceId: "public-architecture-note",
      sourceHash: sha256("public architecture note"),
      locator: "section:architecture",
      excerptDigest: sha256("The spectral module consumes image features."),
    }],
    detail: "architecture",
    maxNodes: 8,
    maxEdges: 8,
    ...overrides,
  };
}

function customModuleProposal(): InterpreterProposal {
  return {
    version: 1,
    nodes: [
      node("image", "input", "Image", [], ["image:out"]),
      node("spectral", "operator", "Spectral fusion", ["spectral:in"], ["spectral:out"], "spectral_fusion"),
      node("prediction", "output", "Prediction", ["prediction:in"], []),
    ],
    ports: [
      port("image:out", "image", "output"),
      port("spectral:in", "spectral", "input"),
      port("spectral:out", "spectral", "output"),
      port("prediction:in", "prediction", "input"),
    ],
    edges: [
      edge("image-spectral", "image:out", "spectral:in"),
      edge("spectral-prediction", "spectral:out", "prediction:in"),
    ],
    unresolved: [],
  };
}

function ambiguousMergeProposal(): InterpreterProposal {
  return {
    ...customModuleProposal(),
    unresolved: [
      { id: "z-merge-direction", scope: "topology", severity: "blocking", evidenceIds: ["e-description"] },
      { id: "a-add-direction", scope: "topology", severity: "blocking", evidenceIds: ["e-description"] },
    ],
  };
}

function node(
  nodeId: string,
  kind: "input" | "output" | "operator" | "module",
  label: string,
  inputPortIds: string[],
  outputPortIds: string[],
  operation?: string,
) {
  return {
    nodeId,
    kind,
    label,
    ...(operation === undefined ? {} : { operation }),
    inputPortIds,
    outputPortIds,
    evidenceIds: ["e-description"],
  };
}

function port(portId: string, nodeId: string, direction: "input" | "output") {
  return { portId, nodeId, direction, evidenceIds: ["e-description"] };
}

function edge(edgeId: string, sourcePortId: string, targetPortId: string) {
  return { edgeId, sourcePortId, targetPortId, evidenceIds: ["e-description"] };
}

describe("evidence-augmented UGS interpreter", () => {
  it("projects explicitly wired unfamiliar modules as custom operators with a canonical proposal hash", () => {
    const result = interpretEvidenceAugmentedInput(request(), customModuleProposal());

    expect(result.state).toBe("formal");
    expect(result.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.ugs.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "spectral", kind: "custom_operator", operationKnowledge: "custom" }),
    ]));
    expect(result.ugs.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "architecture-input:architecture-request" }),
    ]));
  });

  it("returns only the first sorted clarification when topology direction remains ambiguous", () => {
    const result = interpretEvidenceAugmentedInput(request(), ambiguousMergeProposal());

    expect(result.state).toBe("clarification");
    expect(result.ugs.unresolved).toEqual([
      expect.objectContaining({ id: "a-add-direction", scope: "topology", severity: "blocking" }),
    ]);
  });

  it("returns the first sorted clarification instead of guessing an unconnected declared direction", () => {
    const completeProposal = customModuleProposal();
    const proposal: InterpreterProposal = { ...completeProposal, edges: [completeProposal.edges[1]!] };

    const result = interpretEvidenceAugmentedInput(request(), proposal);

    expect(result.state).toBe("clarification");
    expect(result.ugs.unresolved).toEqual([
      expect.objectContaining({ id: "topology-direction:image:out", scope: "topology", severity: "blocking" }),
    ]);
  });

  it.each([
    ["unknown proposal control", { ...customModuleProposal(), comCommand: "x" }],
    ["raw source", { ...customModuleProposal(), rawSource: "print('unsafe')" }],
    ["raw image", { ...customModuleProposal(), imageBytes: "base64" }],
  ])("rejects %s rather than exposing or controlling an unsafe boundary", (_label, proposal) => {
    expect(() => interpretEvidenceAugmentedInput(request(), proposal)).toThrow(/unknown|field|unsupported/i);
  });

  it.each([
    ["unsupported evidence", () => ({ ...customModuleProposal(), nodes: [{ ...customModuleProposal().nodes[0]!, evidenceIds: ["missing"] }, ...customModuleProposal().nodes.slice(1)] })],
    ["duplicate port", () => ({ ...customModuleProposal(), ports: [...customModuleProposal().ports, customModuleProposal().ports[0]] })],
    ["dangling edge", () => ({ ...customModuleProposal(), edges: [{ ...customModuleProposal().edges[0]!, targetPortId: "missing:in" }, customModuleProposal().edges[1]! ] })],
    ["missing edge evidence", () => ({ ...customModuleProposal(), edges: [{ ...customModuleProposal().edges[0]!, evidenceIds: [] }, customModuleProposal().edges[1]! ] })],
    ["invalid confidence", () => ({ ...customModuleProposal(), topologyConfidence: 2 })],
    ["over capacity", () => ({ ...customModuleProposal(), nodes: [...customModuleProposal().nodes, node("extra", "operator", "Extra", [], [], "custom")] })],
  ])("rejects a %s proposal", (_label, makeProposal) => {
    expect(() => interpretEvidenceAugmentedInput(request({ maxNodes: 3 }), makeProposal())).toThrow();
  });

  it("rejects raw source or image fields inside the bounded public evidence request", () => {
    const unsafeRequest = {
      ...request(),
      evidence: [{ ...request().evidence[0]!, rawSource: "unsafe" }],
    };

    expect(() => interpretEvidenceAugmentedInput(unsafeRequest, customModuleProposal())).toThrow(/unknown|field|unsupported/i);
  });

  it("returns a evidence-only clarification when the interpreter is absent", () => {
    const result = interpretEvidenceAugmentedInput(request(), undefined);

    expect(result.state).toBe("clarification");
    expect(result.ugs.nodes).toEqual([expect.objectContaining({ nodeId: "architecture-request", kind: "container" })]);
    expect(result.ugs.edges).toEqual([]);
    expect(result.ugs.unresolved).toEqual([expect.objectContaining({ id: "architecture-request:interpreter-unavailable", scope: "topology", severity: "blocking" })]);
  });
});
