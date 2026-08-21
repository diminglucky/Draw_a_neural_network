import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  interpretEvidenceAugmentedInput,
  requestEvidenceAugmentedProposal,
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

function mergeProposal(operation: "add" | "concat" | "residual" | "cross_attention", relation: "data" | "skip" = "data"): InterpreterProposal {
  return {
    version: 1,
    nodes: [
      node("left", "operator", "Left", [], ["left:out"], "identity"),
      node("right", "operator", "Right", [], ["right:out"], "identity"),
      node("merge", "operator", "Merge", ["merge:left", "merge:right"], [], operation),
    ],
    ports: [
      port("left:out", "left", "output"), port("right:out", "right", "output"),
      port("merge:left", "merge", "input"), port("merge:right", "merge", "input"),
    ],
    edges: [
      edge("left-merge", "left:out", "merge:left"),
      { ...edge("right-merge", "right:out", "merge:right"), relation },
    ],
    unresolved: [],
  };
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

  it.each(["C:\\Users\\private\\model.py", "/private/project/model.py"])("rejects a filesystem-path evidence locator", (locator) => {
    const unsafeRequest = {
      ...request(),
      evidence: [{ ...request().evidence[0]!, locator }],
    };

    expect(() => interpretEvidenceAugmentedInput(unsafeRequest, customModuleProposal())).toThrow(/locator|invalid/i);
  });

  it.each(["models/private/model.py", "..\\private\\model.py", "\\\\server\\share\\model.py"])("rejects a relative or UNC evidence locator", (locator) => {
    const unsafeRequest = { ...request(), evidence: [{ ...request().evidence[0]!, locator }] };

    expect(() => interpretEvidenceAugmentedInput(unsafeRequest, customModuleProposal())).toThrow(/locator|invalid/i);
  });

  it.each([
    ["node label", () => ({ ...customModuleProposal(), nodes: [{ ...customModuleProposal().nodes[0]!, label: "C:\\Users\\private\\model.py" }, ...customModuleProposal().nodes.slice(1)] })],
    ["source snippet", () => ({ ...customModuleProposal(), nodes: [{ ...customModuleProposal().nodes[0]!, label: "def forward(self, x):" }, ...customModuleProposal().nodes.slice(1)] })],
  ])("rejects %s from proposal public text", (_label, proposal) => {
    expect(() => interpretEvidenceAugmentedInput(request(), proposal())).toThrow(/invalid/i);
  });

  it("rejects an unbounded request before it reaches an interpreter", async () => {
    const propose = vi.fn(async () => customModuleProposal());
    const result = await requestEvidenceAugmentedProposal({ ...request(), rawSource: "unsafe" } as never, { propose });

    expect(result).toEqual({ status: "invalid" });
    expect(propose).not.toHaveBeenCalled();
  });

  it("rejects a public-evidence collision with the reserved architecture-input namespace", () => {
    const colliding = request({ evidence: [{ ...request().evidence[0]!, sourceId: "architecture-input:architecture-request" }] });

    expect(() => interpretEvidenceAugmentedInput(colliding, customModuleProposal())).toThrow(/reserved|sourceId/i);
  });

  it("returns clarification instead of accepting an input node with an inbound data edge", () => {
    const base = customModuleProposal();
    const proposal: InterpreterProposal = {
      ...base,
      nodes: [node("source", "operator", "Source", [], ["source:out"], "identity"), node("image", "input", "Image", ["image:in"], ["image:out"]), ...base.nodes.slice(1)],
      ports: [port("source:out", "source", "output"), port("image:in", "image", "input"), ...base.ports],
      edges: [edge("source-image", "source:out", "image:in"), ...base.edges],
    };

    const result = interpretEvidenceAugmentedInput(request(), proposal);

    expect(result.state).toBe("clarification");
    expect(result.ugs.unresolved).toEqual([expect.objectContaining({ id: "topology-input-direction:image" })]);
  });

  it.each([
    ["input without a connected output", () => ({ version: 1, nodes: [node("input", "input", "Input", [], [])], ports: [], edges: [], unresolved: [] })],
    ["output without a connected input", () => ({ version: 1, nodes: [node("output", "output", "Output", [], [])], ports: [], edges: [], unresolved: [] })],
    ["add without an output", () => mergeProposal("add")],
    ["concat without an output", () => mergeProposal("concat")],
    ["residual without an output", () => mergeProposal("residual", "skip")],
    ["cross attention without query/context semantics", () => mergeProposal("cross_attention")],
  ])("returns clarification for %s", (_label, proposal) => {
    expect(interpretEvidenceAugmentedInput(request(), proposal()).state).toBe("clarification");
  });

  it("does not classify an interpreter-thrown timeout message as a Harness timeout", async () => {
    const result = await requestEvidenceAugmentedProposal(request(), { propose: async () => { throw new Error("interpreter timeout"); } });

    expect(result).toEqual({ status: "invalid" });
  });

  it("returns a evidence-only clarification when the interpreter is absent", () => {
    const result = interpretEvidenceAugmentedInput(request(), undefined);

    expect(result.state).toBe("clarification");
    expect(result.ugs.nodes).toEqual([expect.objectContaining({ nodeId: "architecture-request", kind: "container" })]);
    expect(result.ugs.edges).toEqual([]);
    expect(result.ugs.unresolved).toEqual([expect.objectContaining({ id: "architecture-request:interpreter-unavailable", scope: "topology", severity: "blocking" })]);
  });
});
