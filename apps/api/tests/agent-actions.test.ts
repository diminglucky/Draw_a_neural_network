import { describe, expect, it } from "vitest";
import {
  applyCanvasActions,
  parseCanvasActionSet,
  parseCanvasSnapshot,
  type CanvasDocument,
} from "../src/agent-actions.js";

const baseDocument: CanvasDocument = {
  figure: { title: "Structural network", subtitle: "publication draft", stages: ["Input", "Backbone", "Head"] },
  paletteName: "dopamine",
  nodes: [
    { id: "input", type: "tensor", x: 100, y: 200, w: 120, h: 180, label: "Input", subtitle: "224 x 224 x 3", stage: 0, color: "#00e5ff" },
    { id: "conv1", type: "conv", x: 360, y: 180, w: 120, h: 220, label: "Conv 1", subtitle: "64 channels", stage: 1, color: "#ff2aa3" },
    { id: "head", type: "dense-layer", x: 700, y: 200, w: 140, h: 180, label: "Classifier", subtitle: "1000 classes", stage: 2, color: "#ff4fd8" },
  ],
  edges: [
    { id: "edge-input-conv1", source: "input", target: "conv1", label: "features", type: "signal", color: "#2846d8" },
    { id: "edge-conv1-head", source: "conv1", target: "head", label: "logits", type: "signal", color: "#2846d8" },
  ],
};

describe("Agent canvas action contract", () => {
  it("applies safe node and edge mutations without changing unrelated fields", () => {
    const result = applyCanvasActions(baseDocument, {
      actions: [
        { type: "update_node", id: "conv1", patch: { label: "Conv 3x3", subtitle: "128 channels" } },
        { type: "add_node", node: { id: "skip-merge", type: "concat", x: 540, y: 260, w: 82, h: 82, label: "Concat", subtitle: "skip", stage: 2, color: "#00d4aa" } },
        { type: "add_edge", edge: { id: "edge-conv1-skip", source: "conv1", target: "skip-merge", label: "skip", type: "skip", color: "#00d4aa" } },
      ],
    });

    expect(result.figure).toEqual(baseDocument.figure);
    expect(result.nodes.find((node) => node.id === "conv1")).toMatchObject({ label: "Conv 3x3", subtitle: "128 channels" });
    expect(result.nodes.some((node) => node.id === "skip-merge")).toBe(true);
    expect(result.edges.some((edge) => edge.id === "edge-conv1-skip")).toBe(true);
  });

  it("removes a node together with its incident edges", () => {
    const result = applyCanvasActions(baseDocument, {
      actions: [{ type: "remove_node", id: "conv1" }],
    });

    expect(result.nodes.map((node) => node.id)).toEqual(["input", "head"]);
    expect(result.edges).toEqual([]);
  });

  it("supports an explicit full replacement and figure metadata update", () => {
    const replacement: CanvasDocument = {
      figure: { title: "Encoder-decoder topology", subtitle: "high-resolution segmentation", stages: ["Encoder", "Bottleneck", "Decoder"] },
      paletteName: "aurora",
      nodes: [{ id: "u-input", type: "volume", x: 200, y: 300, w: 150, h: 210, label: "MRI", subtitle: "128 x 128 x 96", stage: 0, color: "#22f7d0" }],
      edges: [],
    };
    const result = applyCanvasActions(baseDocument, {
      actions: [
        { type: "replace_document", document: replacement },
        { type: "update_figure", patch: { subtitle: "review-ready figure" } },
      ],
    });

    expect(result.nodes).toEqual(replacement.nodes);
    expect(result.paletteName).toBe("aurora");
    expect(result.figure).toEqual({ title: "Encoder-decoder topology", subtitle: "review-ready figure", stages: ["Encoder", "Bottleneck", "Decoder"] });
  });

  it("rejects unknown actions, missing node references, duplicate IDs, and invalid edge endpoints", () => {
    expect(() => parseCanvasActionSet({ actions: [{ type: "run_shell", command: "whoami" }] })).toThrow();
    expect(() => parseCanvasActionSet({ actions: [{ type: "add_node", node: { ...baseDocument.nodes[0], command: "python -c whoami" } }] })).toThrow();
    expect(() => parseCanvasSnapshot({ ...baseDocument, figure: { title: "Current", apiKey: "secret" } })).toThrow();
    expect(() => applyCanvasActions(baseDocument, { actions: [{ type: "update_node", id: "missing", patch: { label: "x" } }] })).toThrow(/missing/i);
    expect(() => applyCanvasActions(baseDocument, { actions: [{ type: "add_node", node: baseDocument.nodes[0] }] })).toThrow(/duplicate/i);
    expect(() => applyCanvasActions(baseDocument, { actions: [{ type: "add_edge", edge: { id: "bad", source: "missing", target: "head", label: "", type: "signal", color: "#000" } }] })).toThrow(/endpoint/i);
  });

  it("bounds the canvas snapshot before it reaches the Agent", () => {
    expect(() => parseCanvasSnapshot({
      nodes: Array.from({ length: 81 }, (_, index) => ({ ...baseDocument.nodes[0], id: `node-${index}` })),
      edges: [],
    })).toThrow(/nodes/i);
  });

  it("bounds the serialized canvas snapshot and action set", () => {
    expect(() => parseCanvasSnapshot({ ...baseDocument, figure: { caption: "x".repeat(70_000) } })).toThrow(/size/i);
    expect(() => parseCanvasActionSet({ actions: Array.from({ length: 25 }, () => ({ type: "update_figure", patch: { title: "x" } })) })).toThrow();
  });
});
