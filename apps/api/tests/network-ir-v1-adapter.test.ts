import { describe, expect, it } from "vitest";
import { adaptNetworkIRv1, adaptNetworkIRv1ToCanonical } from "../src/network-ir-v1-adapter.js";
import { validateCanonicalNetworkIR } from "../src/network-ir-v2.js";

describe("NetworkIR v1 adapter", () => {
  it("selects only structural v1 data while materializing a matching EvidenceBundle", () => {
    const adapted = adaptNetworkIRv1({
      figure: { id: "vgg16", title: "VGG16", description: null },
      nodes: [{
        id: "block-1", kind: "conv", label: "Conv", subtitle: "", stage: 1, confidence: 0.9,
        sourceEvidence: [{ type: "code", value: "model.py", locator: "line:1", excerpt: "Conv2d" }],
        tensor: { shape: [224, 224, 64], dtype: "float32" },
        repeatCount: 2, channelCount: 64, visualRole: "feature-map-stack", color: "not-a-colour",
        perspective: true, depth: 9, visualEncoding: { visiblePlaneCount: 0, extrusionDepthFu: -1, projection: "not-a-projection", spatialShape: [] }, metadata: { contains: [] },
      }],
      edges: [], groups: [], annotations: [], style: { paletteName: "dopamine" }, layout: { algorithm: "legacy" },
    } as any);
    const canonical = adapted.canonical;

    expect(canonical.version).toBe(2);
    expect(JSON.stringify(canonical)).not.toContain("feature-map-stack");
    expect(JSON.stringify(canonical)).not.toContain("#ff00ff");
    expect(JSON.stringify(canonical)).not.toContain("oblique-3d");
    expect(canonical.nodes[0]).toMatchObject({ op: "conv2d", repeats: { count: 2, unitNodeIds: ["block-1"] } });
    expect(adapted.evidenceBundle.sources[0].id).toMatch(/^legacy-source-/);
    expect(adapted.evidenceBundle.facts[0].id).toMatch(/^legacy-fact-/);
    expect(validateCanonicalNetworkIR(canonical, adapted.evidenceBundle)).toMatchObject({ valid: true, issues: [] });
  });

  it("maps structural edges and deterministic legacy evidence IDs only", () => {
    const canonical = adaptNetworkIRv1ToCanonical({
      figure: { id: "resnet", title: "ResNet", description: null },
      nodes: [
        { id: "input-1", kind: "input", label: "Input", stage: 0, tensor: { shape: [3, 32, 32], dtype: "float32" }, sourceEvidence: [{ type: "code", value: "model.py" }] },
        { id: "input-2", kind: "input", label: "Shortcut", stage: 0, tensor: { shape: [3, 32, 32], dtype: "float32" }, sourceEvidence: [{ type: "code", value: "model.py" }] },
        { id: "add-1", kind: "add", label: "Add", stage: 1, sourceEvidence: [{ type: "code", value: "model.py" }] },
      ],
      edges: [
        { source: "input-1", target: "add-1", kind: "skip", skip: true, sourceEvidence: [{ type: "code", value: "model.py" }] },
        { source: "input-2", target: "add-1", kind: "data", sourceEvidence: [{ type: "code", value: "model.py" }] },
      ],
      groups: [{ id: "group-1", label: "Block", nodeIds: ["input-1", "input-2", "add-1"] }], annotations: [], style: {}, layout: {},
    } as any);

    expect(canonical.nodes.map((node) => node.op)).toEqual(["input", "input", "add"]);
    expect(canonical.edges[0]).toMatchObject({ relation: "residual", sourceNodeId: "input-1", targetNodeId: "add-1" });
    expect(canonical.nodes[0].sourceEvidenceIds[0]).toMatch(/^legacy-fact-/);
    expect(canonical.edges[0].evidenceIds[0]).toMatch(/^legacy-fact-/);
    expect(JSON.stringify(canonical)).not.toMatch(/style|layout|annotation|visual|color|perspective|depth|renderer|primitive|outputPath/i);
  });

  it("synthesizes required evidence and warns when a legacy skip is not residual", () => {
    const adapted = adaptNetworkIRv1({
      figure: { id: "legacy", title: "Legacy", description: null },
      nodes: [
        { id: "input-1", kind: "input", label: "Input", stage: 0 },
        { id: "conv-1", kind: "conv", label: "Conv", stage: 1 },
      ],
      edges: [{ source: "input-1", target: "conv-1", kind: "skip", skip: true }],
      groups: [],
    });

    expect(adapted.canonical.edges[0].relation).toBe("data");
    expect(adapted.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "legacy-skip-not-residual", path: "edges[0]" }),
    ]));
    expect(adapted.canonical.nodes[0].sourceEvidenceIds[0]).toMatch(/^legacy-fact-/);
    expect(validateCanonicalNetworkIR(adapted.canonical, adapted.evidenceBundle)).toMatchObject({ valid: true, issues: [] });
  });

  it("rejects an Add whose duplicate parallel edges provide fewer than two distinct inputs", () => {
    expect(() => adaptNetworkIRv1ToCanonical({
      figure: { id: "bad-add", title: "Bad Add", description: null },
      nodes: [
        { id: "input-1", kind: "input", label: "Input", stage: 0 },
        { id: "add-1", kind: "add", label: "Add", stage: 1 },
      ],
      edges: [
        { source: "input-1", target: "add-1", kind: "data" },
        { source: "input-1", target: "add-1", kind: "data" },
      ],
      groups: [],
    })).toThrow(/two distinct upstream tensors/i);
  });
});
