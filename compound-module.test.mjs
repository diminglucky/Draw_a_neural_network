import assert from "node:assert/strict";
import test from "node:test";
import {
  compoundKindForNode,
  getCompoundLayout,
  normalizeCompoundNode,
} from "./compound-module.mjs";

test("legacy encoder becomes a transformer compound with internal topology", () => {
  const node = normalizeCompoundNode({
    id: "encoder-1",
    type: "encoder",
    label: "Transformer",
    subtitle: "MHSA + MLP",
    layers: 12,
    badge: "x12",
    w: 190,
    h: 150,
  });

  assert.equal(compoundKindForNode(node), "transformer");
  assert.equal(node.type, "compound");
  assert.ok(node.w >= 300);
  assert.ok(node.h >= 230);

  const layout = getCompoundLayout(node);
  assert.deepEqual(
    layout.children.map((child) => child.kind),
    ["norm", "qkv", "attention", "projection", "add", "norm", "mlp", "add"],
  );
  assert.ok(layout.edges.length >= 9);
  const childIds = new Set(layout.children.map((child) => child.id));
  for (const edge of layout.edges) {
    assert.ok(childIds.has(edge.source), `missing source ${edge.source}`);
    assert.ok(childIds.has(edge.target), `missing target ${edge.target}`);
  }
});

test("legacy attention becomes a compact attention compound", () => {
  const node = normalizeCompoundNode({
    id: "cross-attn",
    type: "attention",
    label: "Cross-Attn",
    subtitle: "Q image · K/V text",
    w: 205,
    h: 140,
  });

  assert.equal(compoundKindForNode(node), "attention");
  const layout = getCompoundLayout(node);
  assert.ok(layout.children.some((child) => child.kind === "attention"));
  assert.ok(layout.children.some((child) => child.kind === "qkv"));
  assert.ok(layout.edges.some((edge) => edge.kind === "attention"));
});

test("unknown compound kinds remain explicit instead of silently becoming blocks", () => {
  const node = normalizeCompoundNode({
    id: "future-module",
    type: "compound",
    compoundKind: "future_operator",
    label: "Future Module",
    w: 160,
    h: 110,
  });

  assert.equal(node.type, "compound");
  assert.equal(compoundKindForNode(node), "unresolved");
  const layout = getCompoundLayout(node);
  assert.equal(layout.children[0].kind, "unresolved");
  assert.match(layout.children[0].label, /Future Module/);
  assert.equal(layout.children.length, 1);
});

test("custom compounds render their evidenced internal graph instead of a fixed template", () => {
  const layout = getCompoundLayout({
    id: "wavelet",
    type: "compound",
    compoundKind: "unresolved",
    label: "Wavelet Encoder",
    subtitle: "runtime-traced internals",
    inner: {
      kind: "topology",
      nodes: [
        { id: "analysis", family: "conv", label: "Analysis Conv", subtitle: "stride 2" },
        { id: "attention", family: "attention", label: "Cross Attention" },
        { id: "merge", family: "merge", label: "Residual Add" },
      ],
      edges: [
        { id: "signal", source: "analysis", target: "attention", type: "signal" },
        { id: "context", source: "attention", target: "merge", type: "attention" },
        { id: "shortcut", source: "analysis", target: "merge", type: "residual" },
      ],
    },
  });

  assert.deepEqual(layout.children.map((child) => child.id), ["analysis", "attention", "merge"]);
  assert.deepEqual(layout.children.map((child) => child.kind), ["conv", "attention", "add"]);
  assert.deepEqual(layout.edges.map((edge) => edge.kind), ["signal", "attention", "residual"]);
  assert.equal(layout.edges.every((edge) => layout.children.some((child) => child.id === edge.source)), true);
  assert.equal(layout.edges.every((edge) => layout.children.some((child) => child.id === edge.target)), true);
});

test("internalGraph evidence is accepted directly and unknown children stay unresolved", () => {
  const layout = getCompoundLayout({
    id: "custom",
    type: "compound",
    compoundKind: "unresolved",
    label: "Custom Module",
    attributes: {
      internalGraph: {
        nodes: [
          { id: "known", family: "norm", label: "LayerNorm" },
          { id: "opaque", family: "custom", label: "Opaque Kernel" },
        ],
        edges: [{ id: "known-to-opaque", source: "known", target: "opaque", type: "signal" }],
      },
    },
  });

  assert.deepEqual(layout.children.map((child) => child.kind), ["norm", "unresolved"]);
  assert.equal(layout.edges[0].kind, "signal");
  assert.equal(layout.children[1].label, "Opaque Kernel");
});

test("generic internal layout keeps wide parallel graphs inside the compound frame", () => {
  const layout = getCompoundLayout({
    id: "parallel",
    type: "compound",
    compoundKind: "unresolved",
    label: "Parallel Module",
    w: 320,
    h: 250,
    inner: {
      kind: "topology",
      nodes: Array.from({ length: 7 }, (_, index) => ({
        id: `branch-${index + 1}`,
        family: "conv",
        label: `Branch ${index + 1}`,
      })),
      edges: [],
    },
  });

  assert.ok(layout.children.every((child) => child.x >= 0 && child.y >= 0));
  assert.ok(layout.children.every((child) => child.x + child.w <= layout.width));
  assert.ok(layout.children.every((child) => child.y + child.h <= layout.height));
});

test("generic module blocks become operator compounds with an internal chain", () => {
  const node = normalizeCompoundNode({
    id: "generator",
    type: "block",
    label: "Generator",
    subtitle: "MLP / ConvTranspose",
    w: 176,
    h: 128,
  });

  assert.equal(node.type, "compound");
  assert.equal(compoundKindForNode(node), "operator");
  const layout = getCompoundLayout(node);
  assert.deepEqual(layout.children.map((child) => child.kind), ["operator", "activation", "projection"]);
  assert.equal(layout.edges.length, 2);
});

test("residual compounds expose the shortcut and merge topology", () => {
  const node = normalizeCompoundNode({
    id: "res-block",
    type: "compound",
    compoundKind: "residual",
    label: "Bottleneck",
    subtitle: "1x1 · 3x3 · 1x1",
  });

  const layout = getCompoundLayout(node);
  assert.deepEqual(layout.children.map((child) => child.kind), ["norm", "conv", "activation", "conv", "projection", "add"]);
  assert.ok(layout.edges.some((edge) => edge.kind === "residual"));
  assert.ok(layout.edges.some((edge) => edge.target.endsWith("-add")));
});

test("diffusion compounds expose timestep and conditioning paths", () => {
  const node = normalizeCompoundNode({
    id: "diffusion-core",
    type: "compound",
    compoundKind: "diffusion",
    label: "Denoise Core",
    subtitle: "latent + timestep + condition",
  });

  const layout = getCompoundLayout(node);
  assert.deepEqual(layout.children.map((child) => child.kind), ["latent", "timestep", "condition", "attention", "denoise", "add"]);
  assert.ok(layout.edges.some((edge) => edge.kind === "condition"));
  assert.ok(layout.edges.some((edge) => edge.kind === "time"));
});

test("encoder-decoder stages expose their operator chain", () => {
  const node = normalizeCompoundNode({
    id: "encoder-stage",
    type: "compound",
    compoundKind: "stage",
    label: "Encoder Stage",
    subtitle: "feature map stage",
  });

  const layout = getCompoundLayout(node);
  assert.deepEqual(layout.children.map((child) => child.kind), ["conv", "norm", "activation", "projection"]);
  assert.equal(layout.edges.length, 3);
});

test("3D volume stages retain a volume primitive and expose the operator chain", () => {
  const node = normalizeCompoundNode({
    id: "volume-stage",
    type: "compound",
    compoundKind: "volume-stage",
    label: "3D Encoder",
    subtitle: "D × H × W",
  });

  const layout = getCompoundLayout(node);
  assert.deepEqual(layout.children.map((child) => child.kind), ["volume", "conv", "norm", "activation", "projection"]);
  assert.ok(layout.children.find((child) => child.kind === "volume").depth);
  assert.equal(layout.edges.length, 4);
});
