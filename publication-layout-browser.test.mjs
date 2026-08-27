import assert from "node:assert/strict";
import test from "node:test";
import { createTemplate } from "./models.js";
import { normalizeCompoundNode } from "./compound-module.mjs";
import { layoutDocumentForCanvas } from "./publication-layout-browser.mjs";

const artboard = { x: 170, y: 160, width: 2260, height: 1060 };

test("browser layout keeps compound frames and routed edges publication-safe", () => {
  const document = {
    figure: {
      title: "Compound fixture",
      subtitle: "Transformer and skip route",
      stages: ["Input", "Transformer", "Output"],
    },
    nodes: [
      {
        id: "input",
        type: "tensor",
        stage: 0,
        w: 122,
        h: 188,
        label: "Image",
        subtitle: "224 x 224 x 3",
      },
      {
        id: "encoder",
        type: "compound",
        compoundKind: "transformer",
        stage: 1,
        w: 320,
        h: 250,
        label: "Transformer",
        subtitle: "LayerNorm · Attention · MLP",
      },
      {
        id: "output",
        type: "output",
        stage: 2,
        w: 110,
        h: 148,
        label: "Prediction",
        subtitle: "classes",
      },
    ],
    edges: [
      { id: "edge-main", source: "input", target: "encoder", type: "signal" },
      { id: "edge-skip", source: "input", target: "output", type: "skip" },
      { id: "edge-out", source: "encoder", target: "output", type: "signal" },
    ],
  };

  const layout = layoutDocumentForCanvas(document, { artboard });
  const encoder = layout.nodes.find((node) => node.id === "encoder");
  const skip = layout.edges.find((edge) => edge.id === "edge-skip");

  assert.equal(encoder.w, 320);
  assert.equal(encoder.h, 250);
  assert.ok(layout.validation.ok, JSON.stringify(layout.validation));
  assert.equal(layout.validation.summary.overlapCount, 0);
  assert.equal(skip.route.kind, "skip-lane");
  assert.equal(skip.route.points.length, 4);
  assert.ok(layout.edges.every((edge) => edge.route?.points?.length >= 2));
});

test("browser layout is deterministic when document insertion order changes", () => {
  const document = {
    figure: { stages: ["Input", "Stage", "Output"] },
    nodes: [
      { id: "a", type: "tensor", stage: 0, label: "A", w: 100, h: 100 },
      { id: "b", type: "compound", compoundKind: "stage", stage: 1, label: "B", w: 250, h: 180 },
      { id: "c", type: "output", stage: 2, label: "C", w: 100, h: 100 },
    ],
    edges: [{ id: "e", source: "a", target: "b", type: "signal" }, { id: "f", source: "b", target: "c", type: "signal" }],
  };
  const baseline = layoutDocumentForCanvas(document, { artboard });
  const reversed = layoutDocumentForCanvas({
    ...document,
    nodes: [...document.nodes].reverse(),
    edges: [...document.edges].reverse(),
  }, { artboard });

  assert.deepEqual(
    reversed.nodes.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })).sort((a, b) => a.id.localeCompare(b.id)),
    baseline.nodes.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })).sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(
    reversed.edges.map(({ id, route }) => ({ id, route })).sort((a, b) => a.id.localeCompare(b.id)),
    baseline.edges.map(({ id, route }) => ({ id, route })).sort((a, b) => a.id.localeCompare(b.id)),
  );
});

test("all shipped templates fit the canvas without collapsing compound modules", () => {
  for (const name of ["hybrid", "cnn", "mlp", "resnet", "unet", "gan", "diffusion", "unet3d"]) {
    const layout = layoutDocumentForCanvas(createTemplate(name), { artboard });
    assert.equal(layout.validation.ok, true, `${name}: ${JSON.stringify(layout.validation)}`);
    assert.ok(layout.nodes.every((node) => node.w >= 48 && node.h >= 40), `${name} has an unreadable node`);
    assert.ok(layout.edges.every((edge) => edge.route?.points?.length >= 2), `${name} has an unrouted edge`);
    const compoundCount = createTemplate(name).nodes.map(normalizeCompoundNode).filter((node) => node.type === "compound").length;
    assert.equal(layout.nodes.filter((node) => node.type === "compound").length, compoundCount, `${name} collapsed a compound module`);
  }
});
