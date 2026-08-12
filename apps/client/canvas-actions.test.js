import { describe, expect, it } from "vitest";
import { applyCanvasActions, assertFreshCanvasPreview, previewCanvasActions } from "../../canvas-actions.js";

const baseDocument = {
  figure: { title: "Current", subtitle: "draft" },
  paletteName: "dopamine",
  nodes: [
    { id: "input", type: "tensor", x: 100, y: 100, w: 120, h: 160, label: "Input", subtitle: "image", stage: 0, color: "#00e5ff" },
    { id: "conv1", type: "conv", x: 320, y: 100, w: 120, h: 160, label: "Conv 1", subtitle: "64 channels", stage: 1, color: "#ff2aa3" },
  ],
  edges: [
    { id: "edge-input-conv1", source: "input", target: "conv1", label: "features", type: "signal", color: "#2846d8" },
  ],
};

describe("client canvas action application", () => {
  it("previews node, edge, and figure changes without mutating the current document", () => {
    const before = structuredClone(baseDocument);
    const preview = previewCanvasActions(baseDocument, {
      actions: [
        { type: "update_node", id: "conv1", patch: { subtitle: "128 channels" } },
        { type: "add_node", node: { id: "head", type: "output", x: 560, y: 100, w: 120, h: 160, label: "Output", subtitle: "10 classes", stage: 2, color: "#ff4fd8" } },
        { type: "add_edge", edge: { id: "edge-conv1-head", source: "conv1", target: "head", label: "logits", type: "signal", color: "#2846d8" } },
        { type: "update_figure", patch: { title: "Updated" } },
      ],
    });

    expect(baseDocument).toEqual(before);
    expect(preview.document.figure.title).toBe("Updated");
    expect(preview.document.nodes.find((node) => node.id === "conv1").subtitle).toBe("128 channels");
    expect(preview.document.edges.some((edge) => edge.id === "edge-conv1-head")).toBe(true);
    expect(preview.summary).toContain("4");
  });

  it("applies validated changes and removes incident edges with a node", () => {
    const result = applyCanvasActions(baseDocument, {
      actions: [{ type: "remove_node", id: "input" }],
    });

    expect(result.nodes.map((node) => node.id)).toEqual(["conv1"]);
    expect(result.edges).toEqual([]);
    expect(baseDocument.nodes).toHaveLength(2);
  });

  it("rejects unsupported operations, unknown patch fields, and invalid edge endpoints", () => {
    expect(() => previewCanvasActions(baseDocument, { actions: [{ type: "run_shell", command: "whoami" }] })).toThrow(/unsupported/i);
    expect(() => previewCanvasActions(baseDocument, { actions: [{ type: "add_node", node: { ...baseDocument.nodes[0], id: "evil", command: "python -c whoami" } }] })).toThrow(/field|node/i);
    expect(() => previewCanvasActions(baseDocument, { actions: [{ type: "update_node", id: "conv1", patch: { onclick: "alert(1)" } }] })).toThrow(/patch/i);
    expect(() => previewCanvasActions(baseDocument, { actions: [{ type: "add_edge", edge: { id: "bad", source: "missing", target: "conv1", label: "", type: "signal", color: "#000" } }] })).toThrow(/endpoint/i);
  });

  it("requires a fresh preview token for every canvas mutation kind", () => {
    const diagram = { nodes: baseDocument.nodes, edges: baseDocument.edges };
    const actionSet = { actions: [{ type: "update_figure", patch: { title: "Updated" } }] };
    const pendingDiagram = { fingerprint: JSON.stringify(diagram), token: "diagram-preview-1" };
    const pendingActions = { fingerprint: JSON.stringify(actionSet), token: "actions-preview-1" };

    expect(() => assertFreshCanvasPreview(pendingDiagram, diagram, "diagram-preview-1")).not.toThrow();
    expect(() => assertFreshCanvasPreview(pendingActions, actionSet, "actions-preview-1")).not.toThrow();
    expect(() => assertFreshCanvasPreview(pendingDiagram, diagram, "wrong-token")).toThrow(/fresh preview/i);
    expect(() => assertFreshCanvasPreview(pendingDiagram, { ...diagram, figure: { title: "changed" } }, "diagram-preview-1")).toThrow(/fresh preview/i);
  });
});
