import assert from "node:assert/strict";
import test from "node:test";
import { buildPlotNeuralNetSource } from "./plotneuralnet-export.mjs";

function vggLikeIR() {
  return {
    figure: { title: "Universal CNN" },
    nodes: [
      {
        id: "input",
        family: "input",
        visualRole: "input-tensor",
        label: "Input",
        subtitle: "224×224×3",
        stage: 0,
        shape: { dimensions: [1, 3, 224, 224] },
      },
      {
        id: "conv-stage",
        family: "conv",
        visualRole: "feature-map-stage",
        label: "CONV 1",
        subtitle: "3×3 · 64×2\n112×112×64",
        stage: 1,
        repeatCount: 2,
        shape: { dimensions: [1, 64, 112, 112] },
        attributes: {
          internalGraph: {
            nodes: [
              { id: "conv-a", family: "conv", label: "Conv 64" },
              { id: "conv-b", family: "conv", label: "Conv 64" },
            ],
            edges: [{ id: "inner", source: "conv-a", target: "conv-b" }],
          },
        },
      },
      {
        id: "pool",
        family: "pool",
        visualRole: "pool-downsample",
        label: "MaxPool",
        subtitle: "2×2 / 2",
        stage: 2,
        shape: { dimensions: [1, 64, 56, 56] },
      },
      {
        id: "output",
        family: "output",
        visualRole: "output-distribution",
        label: "Output",
        subtitle: "1000 classes",
        stage: 3,
        shape: { dimensions: [1, 1000] },
      },
    ],
    edges: [
      { id: "e1", source: "input", target: "conv-stage", type: "signal" },
      { id: "e2", source: "conv-stage", target: "pool", type: "signal" },
      { id: "e3", source: "pool", target: "output", type: "signal" },
    ],
  };
}

test("PlotNeuralNet exporter emits semantic primitives and source-backed repetition", () => {
  const source = buildPlotNeuralNetSource(vggLikeIR(), { projectPath: "./PlotNeuralNet" });
  assert.match(source, /subimport\{\.\/PlotNeuralNet\/layers\/\}\{init\}/);
  assert.match(source, /Box=\{/);
  assert.match(source, /RightBandedBox=\{/);
  assert.match(source, /name=input/);
  assert.match(source, /name=conv-stage/);
  assert.match(source, /width=\{2,2\}/);
  assert.match(source, /xlabel=\{\{\"64\",\"\"\}\}/);
  assert.match(source, /name=pool/);
  assert.match(source, /name=output/);
  assert.match(source, /connection/);
  assert.match(source, /caption=\{\\scriptsize IN\}/);
  assert.match(source, /zlabel=224/);
  assert.doesNotMatch(source, /caption=\{Input\\\\/);
  assert.doesNotMatch(source, /VGG16|ResNet|U-Net|Transformer/);
  assert.doesNotMatch(source, /newcommand\{\\midarrow\}/);
});

test("PlotNeuralNet exporter makes an absolute layer path import-safe", () => {
  const source = buildPlotNeuralNetSource(vggLikeIR(), {
    projectPath: "C:/Temp/PlotNeuralNet-reference/layers-parent",
  });
  assert.match(source, /input@path/);
  assert.match(source, /PlotNeuralNet-reference\/layers-parent\/layers\/init\.tex/);
  assert.doesNotMatch(source, /subimport\{C:\/Temp/);
});

test("PlotNeuralNet exporter gives stages an explicit publication gap", () => {
  const source = buildPlotNeuralNetSource(vggLikeIR());
  const shifts = [...source.matchAll(/\\pic\[shift=\{\(([^,]+),([^,]+),0\)\}\]/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
  assert.ok(shifts.length >= 3, "expected multiple PlotNeuralNet stages");
  assert.equal(shifts[0].x, 0);
  assert.ok(shifts.slice(1).some((value) => value.x > 0), "expected a non-zero stage gap");
  assert.ok(shifts.every((value) => value.y === 0), "linear topology must stay on one lane");
});

test("PlotNeuralNet exporter maps a branch lane to a relative y shift", () => {
  const ir = vggLikeIR();
  ir.nodes.splice(2, 1, {
    id: "branch",
    family: "conv",
    visualRole: "feature-map-stage",
    label: "Branch",
    stage: 2,
    order: 2,
    x: 600,
    y: 120,
    repeatCount: 1,
    shape: { dimensions: [1, 64, 112, 112] },
  });
  ir.nodes.find((node) => node.id === "output").stage = 3;
  ir.nodes.find((node) => node.id === "output").x = 900;
  ir.nodes.find((node) => node.id === "output").y = 340;
  ir.edges = [
    { id: "main", source: "input", target: "conv-stage", type: "signal" },
    { id: "branch", source: "conv-stage", target: "branch", type: "signal" },
    { id: "merge", source: "branch", target: "output", type: "signal" },
    { id: "skip", source: "conv-stage", target: "output", type: "skip" },
  ];
  const source = buildPlotNeuralNetSource(ir);
  assert.match(source, /shift=\{\([^,]+,-?[^,]+,0\)\}/);
  assert.match(source, /copyconnection/);
});

test("PlotNeuralNet exporter prefers normalized publication labels", () => {
  const source = buildPlotNeuralNetSource({
    nodes: [
      {
        id: "input",
        family: "input",
        visualRole: "input-tensor",
        stage: 0,
        label: "raw-input",
        subtitle: "H x W x 3",
        shape: { output: [1, 3, 224, 224] },
      },
      {
        id: "conv",
        family: "conv",
        visualRole: "feature-map-stage",
        stage: 1,
        label: "raw-conv",
        subtitle: "k3 raw text",
        repeatCount: 2,
        shape: { output: [1, 112, 112, 64] },
        geometryData: { repeatCount: 2, internalOperatorLabels: ["Conv 64", "Conv 64"] },
      },
    ],
    edges: [{ id: "e", source: "input", target: "conv" }],
  });
  assert.match(source, /caption=\{CONV 1/);
  assert.match(source, /xlabel=\{\{"64",""\}\}/);
  assert.doesNotMatch(source, /raw-conv|raw text/);
});

test("PlotNeuralNet exporter keeps math symbols valid inside text labels", () => {
  const source = buildPlotNeuralNetSource({
    nodes: [
      { id: "input", family: "input", stage: 0, label: "Input" },
      { id: "op", family: "operator", visualRole: "operator", stage: 1, label: "Kernel 3×3" },
    ],
    edges: [{ id: "e", source: "input", target: "op" }],
  });
  assert.match(source, /\\ensuremath\{\\times\}/);
  assert.doesNotMatch(source, /\\scriptsize[^\n]*\\times(?!\})/);
});

test("PlotNeuralNet exporter keeps long tensor subtitles out of compact captions", () => {
  const source = buildPlotNeuralNetSource(vggLikeIR());
  assert.match(source, /caption=\{CONV 1\}/);
  assert.doesNotMatch(source, /caption=\{CONV 1\\\\/);
});

test("PlotNeuralNet exporter compacts labels to fit narrow native faces", () => {
  const source = buildPlotNeuralNetSource(vggLikeIR());
  assert.match(source, /caption=\{\\scriptsize MP\}/);
  assert.match(source, /caption=\{\\scriptsize OUT\}/);
  assert.match(source, /xlabel=\{\{\"64\",\"\"\}\}/);
});

test("PlotNeuralNet exporter keeps skip edges and non-card geometry explicit", () => {
  const ir = vggLikeIR();
  ir.nodes.splice(2, 1, {
    id: "merge",
    family: "merge",
    visualRole: "merge-symbol",
    label: "+",
    stage: 2,
    shape: { dimensions: [1, 64, 112, 112] },
  });
  ir.nodes.splice(3, 0, {
    id: "flatten",
    family: "flatten",
    visualRole: "vectorize",
    label: "Flatten",
    stage: 3,
    shape: { dimensions: [1, 802816] },
  });
  ir.nodes.find((node) => node.id === "output").stage = 4;
  ir.edges = [
    { id: "main", source: "input", target: "conv-stage", type: "signal" },
    { id: "branch", source: "input", target: "merge", type: "skip" },
    { id: "forward", source: "conv-stage", target: "merge", type: "signal" },
    { id: "flatten-edge", source: "merge", target: "flatten", type: "signal" },
    { id: "tail", source: "flatten", target: "output", type: "signal" },
  ];
  const source = buildPlotNeuralNetSource(ir);
  assert.match(source, /Ball=\{/);
  assert.match(source, /copyconnection|skip/i);
  assert.match(source, /merge-south.*merge-north/);
  assert.doesNotMatch(source, /merge-north\).*merge-north\)/);
  assert.match(source, /NNFlatten[\s\S]*filldraw/);
  assert.doesNotMatch(source, /trapezium/);
});

test("PlotNeuralNet exporter gives dense and flatten roles bounded native primitives", () => {
  const source = buildPlotNeuralNetSource({
    nodes: [
      { id: "x", family: "input", visualRole: "input-tensor", stage: 0, shape: { dimensions: [1, 64, 7, 7] } },
      { id: "flat", family: "flatten", visualRole: "vectorize", stage: 1, label: "Flatten", shape: { dimensions: [1, 3136] } },
      { id: "dense", family: "dense", visualRole: "neuron-layer", stage: 2, label: "FC 4096", subtitle: "4096 units", shape: { dimensions: [1, 4096] } },
      { id: "y", family: "output", visualRole: "output-distribution", stage: 3, label: "Output", shape: { dimensions: [1, 1000] } },
    ],
    edges: [
      { id: "a", source: "x", target: "flat" },
      { id: "b", source: "flat", target: "dense" },
      { id: "c", source: "dense", target: "y" },
    ],
  });
  assert.match(source, /\\NNFlatten\{flat\}\{0\.65cm\}\{1\.2cm\}/);
  assert.match(source, /\\NNFlatten\{flat\}[\s\S]*\{Flatten\}/);
  assert.match(source, /\\filldraw\[draw, thick, fill=#4\]/);
  assert.match(source, /\\coordinate \(#1-east\) at \(\[xshift=#2\]#1-west\)/);
  assert.match(source, /\\pgfmathsetlengthmacro/);
  assert.doesNotMatch(source, /trapezium/);
  assert.match(source, /\[yshift=-3pt\]#1-south/);
  assert.match(source, /font=\\tiny/);
  assert.match(source, /\\NNDense\{dense\}/);
  assert.doesNotMatch(source, /\]\(/);
  assert.doesNotMatch(source, /name=dense, caption=.*fill=\\FcColor/);
});

test("PlotNeuralNet exporter does not collapse token and attention roles into convolution boxes", () => {
  const source = buildPlotNeuralNetSource({
    nodes: [
      { id: "input", family: "input", visualRole: "input-tensor", stage: 0 },
      { id: "tokens", family: "sequence", visualRole: "token-sequence", stage: 1, label: "Tokens", subtitle: "196 tokens" },
      { id: "attention", family: "attention", visualRole: "attention", stage: 2, label: "Self-Attention", subtitle: "8 heads" },
      { id: "output", family: "output", visualRole: "output-distribution", stage: 3, label: "Output" },
    ],
    edges: [
      { id: "a", source: "input", target: "tokens" },
      { id: "b", source: "tokens", target: "attention" },
      { id: "c", source: "attention", target: "output" },
    ],
  });
  assert.match(source, /\\NNSequence\{tokens\}/);
  assert.match(source, /\\NNAttention\{attention\}/);
  assert.doesNotMatch(source, /Box=\{name=tokens/);
  assert.doesNotMatch(source, /Box=\{name=attention/);
});
