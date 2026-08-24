import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compilePromptToUniversalGraphSpec, type PromptGraphDeclaration } from "../src/prompt-universal-graph-spec.js";
import { getUniversalGraphEligibility, parseUniversalGraphSpec } from "../src/universal-graph-spec.js";

describe("Prompt-to-UniversalGraphSpec adapter", () => {
  it("projects an explicit formal declaration with prompt-derived evidence", () => {
    const declaration = promptInput(formalDeclaration()); const ugs = compilePromptToUniversalGraphSpec(declaration);
    expect(parseUniversalGraphSpec(ugs)).toEqual(ugs); expect(ugs.sourceIds).toEqual(["prompt-source"]); expect(ugs.sourceHashes).toEqual([sha256(declaration.prompt)]);
    expect(ugs.nodes.find((node) => node.nodeId === "stem")).toMatchObject({ kind: "operator", operationKnowledge: "known", inputPortIds: ["stem:in"], outputPortIds: ["stem:out"] });
    expect(ugs.nodes.find((node) => node.nodeId === "image")?.tensorFacts).toBeNull();
    expect(ugs.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "prompt-source", sourceHash: sha256(declaration.prompt), locator: "prompt:node:stem" }), expect.objectContaining({ sourceId: "prompt-source", sourceHash: sha256(declaration.prompt), locator: "prompt:edge:image-to-stem" })]));
    expect(ugs.ports).toHaveLength(4);
    for (const port of ugs.ports) {
      expect(port.evidenceIds).toHaveLength(1);
      expect(ugs.evidence.some((item) => item.evidenceId === port.evidenceIds[0])).toBe(true);
    }
    expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "renderable", export: "eligible" });
  });
  it("retains explicitly wired unknown operators and modules as custom structure", () => {
    const ugs = compilePromptToUniversalGraphSpec(promptInput({ graphId: "unknown-fusion", topology: "complete", nodes: [node("left", "input", "Left input", [], ["out"]), node("right", "input", "Right input", [], ["out"]), node("texture", "operator", "Texture mixer", ["in"], ["out"], "texture_mixer"), node("fusion", "module", "Spectral fusion", ["left", "right"], ["out"], "spectral_fusion"), node("result", "output", "Result", ["in"], [])], edges: [edge("left-texture", "left:out", "texture:in"), edge("texture-fusion", "texture:out", "fusion:left", "merge"), edge("right-fusion", "right:out", "fusion:right", "merge"), edge("fusion-result", "fusion:out", "result:in")] }));
    expect(ugs.nodes.find((node) => node.nodeId === "texture")).toMatchObject({ kind: "custom_operator", operationKnowledge: "custom" }); expect(ugs.nodes.find((node) => node.nodeId === "fusion")).toMatchObject({ kind: "custom_module", operationKnowledge: "custom" }); expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "renderable", export: "eligible" });
  });
  it("emits a candidate UGS with blocking topology evidence when topology is missing or ambiguous", () => { const ugs = compilePromptToUniversalGraphSpec(promptInput({ graphId: "missing-topology", nodes: [node("encoder", "operator", "Encoder", ["in"], ["out"], "conv2d"), node("decoder", "operator", "Decoder", ["in"], ["out"], "conv2d")], edges: [] })); expect(ugs.edges).toEqual([]); expect(ugs.unresolved).toEqual([expect.objectContaining({ scope: "topology", severity: "blocking", evidenceIds: [expect.any(String)] })]); expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "candidate", export: "ineligible" }); });
  it("rejects prompt declarations containing forbidden control text", () => { const declaration = promptInput({ ...formalDeclaration(), nodes: [node("image", "input", "Worker image", [], ["out"])], edges: [] }); expect(() => compilePromptToUniversalGraphSpec(declaration)).toThrow(/forbidden.*control/i); });
  it("produces byte-for-byte equivalent typed tensor facts for equivalent declaration order", () => {
    const declared = formalDeclaration();
    declared.nodes.find((item) => item.nodeId === "stem")!.tensorFacts = { axes: ["channels", "height", "width"], dimensions: { channels: 48, height: 32, width: 32 } };
    const declaration = promptInput(declared);

    expect(compilePromptToUniversalGraphSpec({ ...declaration })).toEqual(compilePromptToUniversalGraphSpec(declaration));
  });
  it("projects explicit typed prompt tensor facts with compiler-owned evidence", () => {
    const declaration = formalDeclaration();
    declaration.nodes.find((item) => item.nodeId === "stem")!.tensorFacts = { axes: ["channels", "height", "width"], dimensions: { channels: 48, height: 32, width: 32 } };

    const ugs = compilePromptToUniversalGraphSpec(promptInput(declaration));
    const stem = ugs.nodes.find((item) => item.nodeId === "stem");

    expect(stem?.tensorFacts).toMatchObject({ axes: ["channels", "height", "width"], dimensions: { channels: 48, height: 32, width: 32 }, evidenceIds: [expect.any(String)] });
    expect(stem?.tensorFacts?.evidenceIds.every((id) => ugs.evidence.some((item) => item.evidenceId === id && item.locator === "prompt:node:stem:tensor-facts"))).toBe(true);
  });
  it("preserves declared symbolic and unknown prompt tensor facts", () => {
    const declaration = formalDeclaration();
    declaration.nodes.find((item) => item.nodeId === "stem")!.tensorFacts = { axes: ["tokens", "embedding"], dimensions: { tokens: "symbolic", embedding: "unknown" } };

    expect(compilePromptToUniversalGraphSpec(promptInput(declaration)).nodes.find((item) => item.nodeId === "stem")?.tensorFacts).toMatchObject({ axes: ["tokens", "embedding"], dimensions: { tokens: "symbolic", embedding: "unknown" } });
  });
  it.each([
    [{ axes: ["width", "channels"], dimensions: { channels: 48, width: 32 } }, /axis.*order|order.*axis/i],
    [{ axes: ["channels"], dimensions: { channels: 48, width: 32 } }, /declared.*axis|axis.*declared/i],
    [{ axes: ["channels"], dimensions: { channels: 48 }, evidenceIds: ["untrusted"] }, /control field|evidenceIds/i],
  ])("rejects malformed prompt tensor facts %#", (tensorFacts, message) => {
    const declaration = formalDeclaration();
    const prompt = JSON.stringify({
      ...declaration,
      nodes: declaration.nodes.map((node) => node.nodeId === "stem" ? { ...node, tensorFacts } : node),
    });

    expect(() => compilePromptToUniversalGraphSpec({ sourceId: "prompt-source", prompt })).toThrow(message);
  });
});
function formalDeclaration(): PromptGraphDeclaration { return { graphId: "prompt-segmentation", topology: "complete", nodes: [node("image", "input", "Image", [], ["out"]), node("stem", "operator", "Convolutional stem", ["in"], ["out"], "conv2d"), node("mask", "output", "Segmentation mask", ["in"], [])], edges: [edge("image-to-stem", "image:out", "stem:in"), edge("stem-to-mask", "stem:out", "mask:in")] }; }
function promptInput(declaration: PromptGraphDeclaration, revision = 1) { return { sourceId: "prompt-source", prompt: JSON.stringify(declaration), revision }; }
function node(nodeId: string, kind: "input" | "output" | "operator" | "module", label: string, inputPortIds: string[], outputPortIds: string[], operation?: string): PromptGraphDeclaration["nodes"][number] { return { nodeId, kind, label, operation, inputPorts: inputPortIds.map((portId) => ({ portId })), outputPorts: outputPortIds.map((portId) => ({ portId })) }; }
function edge(edgeId: string, sourcePortId: string, targetPortId: string, relation: "data" | "merge" = "data"): PromptGraphDeclaration["edges"][number] { return { edgeId, sourcePortId, targetPortId, relation }; }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
