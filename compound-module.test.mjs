import assert from "node:assert/strict";
import test from "node:test";
import {
  getCompoundLayout,
} from "./compound-module.mjs";

test("modules without internal evidence stay unresolved blocks instead of inventing structure", () => {
  const layout = getCompoundLayout({
    id: "future-module",
    type: "compound",
    compoundKind: "future_operator",
    label: "Future Module",
    w: 160,
    h: 110,
  });

  assert.equal(layout.kind, "unresolved");
  assert.equal(layout.children[0].kind, "unresolved");
  assert.match(layout.children[0].label, /Future Module/);
  assert.equal(layout.children.length, 1);
});

test("custom compounds render their evidenced internal graph instead of invented children", () => {
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

test("recurrent compounds render three time instances and expand only the evidenced current step", () => {
  const layout = getCompoundLayout({
    id: "cell",
    sourceNodeId: "source-cell",
    type: "compound",
    compoundKind: "operator",
    label: "Recurrent Cell",
    recurrentLayout: {
      instances: [
        { id: "source-cell:previous", role: "previous", expanded: false },
        { id: "source-cell:expanded", role: "expanded", expanded: true },
        { id: "source-cell:next", role: "next", expanded: false },
      ],
      expandedInstanceId: "source-cell:expanded",
      stateRails: [{ id: "source-cell:state-rail:carry", kind: "carry", sourceEdgeId: "carry" }],
      expandedInternalGraph: {
        status: "resolved",
        nodes: [
          { id: "input", family: "input", label: "xₜ" },
          { id: "mix", family: "operator", label: "Evidence operator" },
          { id: "output", family: "projection", label: "hₜ" },
        ],
        edges: [{ id: "inner-flow", source: "input", target: "mix", type: "signal" }, { id: "inner-out", source: "mix", target: "output", type: "signal" }],
      },
    },
  });

  assert.equal(layout.kind, "recurrent");
  assert.deepEqual(layout.instances.map((instance) => instance.role), ["previous", "expanded", "next"]);
  assert.equal(layout.instances.filter((instance) => instance.expanded).length, 1);
  assert.equal(layout.expandedInstanceId, "source-cell:expanded");
  assert.equal(layout.stateRails[0].kind, "carry");
  assert.deepEqual(layout.children.map((child) => child.label), ["xₜ", "Evidence operator", "hₜ"]);
  assert.equal(layout.edges.length, 2);
  assert.equal(layout.uncertainty.unresolved, false);
});

test("recurrent compounds keep an unresolved current-step marker when internal evidence is absent", () => {
  const layout = getCompoundLayout({
    id: "opaque-cell",
    type: "compound",
    compoundKind: "operator",
    label: "Opaque Cell",
    recurrentLayout: {
      instances: [
        { id: "opaque-cell:previous", role: "previous", expanded: false },
        { id: "opaque-cell:expanded", role: "expanded", expanded: true },
        { id: "opaque-cell:next", role: "next", expanded: false },
      ],
      expandedInstanceId: "opaque-cell:expanded",
      stateRails: [],
      expandedInternalGraph: { status: "unresolved", nodes: [], edges: [], diagnostics: [], reason: "internal topology evidence is absent" },
      uncertainty: { unresolved: true, reason: "internal topology evidence is absent" },
    },
  });

  assert.equal(layout.kind, "recurrent");
  assert.equal(layout.uncertainty.unresolved, true);
  assert.ok(layout.children.some((child) => child.kind === "unresolved"));
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
