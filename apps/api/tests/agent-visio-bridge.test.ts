import { describe, expect, it } from "vitest";
import { compileAgentCnnVisioDiagram } from "../src/agent-visio-bridge.js";
import { vgg16CanonicalIr } from "./fixtures/vgg16-canonical-ir.js";

describe("compileAgentCnnVisioDiagram", () => {
  it("compiles the server-owned canonical VGG16 IR into the restricted Worker figure-plan contract", () => {
    const result = compileAgentCnnVisioDiagram({
      draftId: "draft-vgg16",
      revision: 1,
      canonicalNetworkIR: vgg16CanonicalIr(),
    });

    expect(Object.keys(result.diagram).sort()).toEqual(["edges", "figure", "figurePlan", "nodes"]);
    expect(result.diagram.figure).toMatchObject({ title: "VGG-16" });
    expect(result.diagram.nodes).toEqual([]);
    expect(result.diagram.edges).toEqual([]);
    expect(Object.keys(result.diagram.figurePlan).sort()).toEqual(["connectors", "coordinateSpace", "labels", "primitiveGroups"]);
    expect(result.diagram.figurePlan.coordinateSpace).toEqual({
      unit: "figure-unit",
      figureUnitInches: 0.01,
      origin: "top-left",
      width: 1800,
      height: 720,
    });

    const groups = result.diagram.figurePlan.primitiveGroups;
    expect(groups.filter((group) => group.kind === "feature-map-stack")).toHaveLength(5);
    expect(groups.filter((group) => group.kind === "downsample-transition")).toHaveLength(5);
    expect(groups.filter((group) => group.kind === "flatten-ribbon")).toHaveLength(1);
    expect(groups.filter((group) => group.kind === "dense-vector-layer")).toHaveLength(2);
    expect(groups.filter((group) => group.kind === "score-vector-layer")).toHaveLength(1);
    expect(groups.find((group) => group.id === "conv-1")?.semantic.repeatCount).toBe(2);
    expect(groups.find((group) => group.id === "conv-5")?.semantic.repeatCount).toBe(3);
    expect(groups.find((group) => group.id === "conv-1")?.bounds.x).toBe(210);
    expect(groups.find((group) => group.id === "conv-5")?.bounds.x).toBe(970);
    expect(groups.find((group) => group.id === "classifier")?.bounds.x).toBe(1590);
    expect(result.diagram.figurePlan.labels.find((label) => label.id === "conv-1.heading")?.text).toBe("Block 1");
    expect(groups.find((group) => group.id === "classifier")?.semantic.channelCount).toBe(1000);
    expect(result.planDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic and fails closed when the stored IR remains unresolved", () => {
    const input = { draftId: "draft-vgg16", revision: 1, canonicalNetworkIR: vgg16CanonicalIr() };
    expect(compileAgentCnnVisioDiagram(input)).toEqual(compileAgentCnnVisioDiagram(input));
    expect(() => compileAgentCnnVisioDiagram({
      ...input,
      canonicalNetworkIR: { ...input.canonicalNetworkIR, unresolved: [{ id: "pool-kind", question: "Which pooling operator?", severity: "blocking", candidateValues: ["max", "average"] }] },
    })).toThrow(/unresolved|render ready/i);
  });

  it("accepts a server-generated UUID draft identity that begins with a digit", () => {
    expect(() => compileAgentCnnVisioDiagram({
      draftId: "4a4774cc-56e4-46db-9cae-2e29e529ee35",
      revision: 1,
      canonicalNetworkIR: vgg16CanonicalIr(),
    })).not.toThrow();
  });
});
