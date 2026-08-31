import { layoutUniversalFigure } from "./universal-figure.mjs";

const DEFAULT_PROJECT_PATH = "./PlotNeuralNet";

/**
 * Build a PlotNeuralNet/TikZ source file from Universal IR.
 *
 * This is an exporter, not a model template. The only architecture decisions
 * here come from the semantic roles and geometry evidence in the IR. The
 * generated source uses PlotNeuralNet's native Box, Ball, and connection
 * primitives so it can be compiled by the upstream project when a TeX
 * distribution is available.
 */
export function buildPlotNeuralNetSource(ir = {}, options = {}) {
  const layout = layoutUniversalFigure(ir, options.layoutOptions || {});
  const projectPath = texPath(options.projectPath || DEFAULT_PROJECT_PATH);
  const nodes = [...layout.nodes].sort(compareNodes);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of layout.edges) {
    incoming.get(edge.target)?.push(edge);
    outgoing.get(edge.source)?.push(edge);
  }
  const nonLinearTopology = hasNonLinearTopology(layout.edges);

  const lines = [
    "\\documentclass[border=8pt, multi, tikz]{standalone}",
    "\\usepackage{import}",
    ...layerImportLines(projectPath),
    "\\usetikzlibrary{positioning}",
    "\\usetikzlibrary{3d}",
    "\\usetikzlibrary{shapes.geometric}",
    "\\def\\ConvColor{rgb:yellow,5;red,2.5;white,5}",
    "\\def\\ConvReluColor{rgb:yellow,5;red,5;white,5}",
    "\\def\\PoolColor{rgb:red,1;black,0.3}",
    "\\def\\FcColor{rgb:blue,5;red,2.5;white,5}",
    "\\def\\SoftmaxColor{rgb:magenta,5;black,7}",
    "\\def\\MergeColor{rgb:blue,5;green,15}",
    "\\def\\TokenColor{rgb:cyan,4;blue,2;white,7}",
    "\\def\\AttentionColor{rgb:green,4;blue,2;white,7}",
    "\\def\\OperatorColor{rgb:gray,2;blue,1;white,8}",
    "\\newcommand{\\NNAnchors}[1]{%",
    "  \\coordinate (#1-west) at (#1.west);%",
    "  \\coordinate (#1-east) at (#1.east);%",
    "  \\coordinate (#1-north) at (#1.north);%",
    "  \\coordinate (#1-south) at (#1.south);%",
    "  \\coordinate (#1-top) at (#1.north);%",
    "  \\coordinate (#1-northeast) at (#1.north east);%",
    "  \\coordinate (#1-northwest) at (#1.north west);%",
    "  \\coordinate (#1-southeast) at (#1.south east);%",
    "  \\coordinate (#1-southwest) at (#1.south west);%",
    "}",
    "\\newcommand{\\NNFlatten}[6]{%",
    "  \\pgfmathsetlengthmacro{\\NNFlattenHalfWidth}{#2/2}%",
    "  \\pgfmathsetlengthmacro{\\NNFlattenHalfHeight}{#3/2}%",
    "  \\pgfmathsetlengthmacro{\\NNFlattenTipHalfHeight}{#3/7}%",
    "  \\coordinate (#1-west) at #5;%",
    "  \\coordinate (#1-east) at ([xshift=#2]#1-west);%",
    "  \\coordinate (#1-center) at ([xshift=\\NNFlattenHalfWidth]#1-west);%",
    "  \\coordinate (#1-north) at ([yshift=\\NNFlattenHalfHeight]#1-west);%",
    "  \\coordinate (#1-south) at ([yshift=-\\NNFlattenHalfHeight]#1-west);%",
    "  \\coordinate (#1-top) at (#1-north);%",
    "  \\coordinate (#1-northwest) at (#1-north);%",
    "  \\coordinate (#1-southwest) at (#1-south);%",
    "  \\coordinate (#1-northeast) at ([yshift=\\NNFlattenTipHalfHeight]#1-east);%",
    "  \\coordinate (#1-southeast) at ([yshift=-\\NNFlattenTipHalfHeight]#1-east);%",
    "  \\filldraw[draw, thick, fill=#4] (#1-northwest) -- (#1-northeast) -- (#1-southeast) -- (#1-southwest) -- cycle;%",
    "  \\node[anchor=north, inner sep=1pt, font=\\tiny] at ([yshift=-3pt]#1-south) {#6};%",
    "}",
    "\\newcommand{\\NNUnresolved}[5]{%",
    "  \\node[anchor=west, draw, dashed, rounded corners, minimum width=#2, minimum height=#3, fill=#4, align=center] (#1) at #5 {#1};%",
    "  \\NNAnchors{#1}%",
    "}",
    "\\newcommand{\\NNDense}[6]{%",
    "  \\node[anchor=west, draw, thick, fill=#4, minimum width=#2, minimum height=#3, inner sep=1pt] (#1) at #5 {}; %",
    "  \\foreach \\y in {-0.9,-0.45,0,0.45,0.9} {\\fill ([yshift=\\y cm]#1.center) circle (1.5pt);}%",
    "  \\node[anchor=north, inner sep=1pt] at ([yshift=-3pt]#1.south) {\\scriptsize #6};%",
    "  \\NNAnchors{#1}%",
    "}",
    "\\newcommand{\\NNSequence}[6]{%",
    "  \\node[anchor=west, draw, thick, rounded corners=2pt, fill=#4, minimum width=#2, minimum height=#3, inner sep=1pt] (#1) at #5 {}; %",
    "  \\foreach \\x in {0.35,0.75,1.15,1.55,1.95} {\\fill ([xshift=\\x cm]#1.west) circle (1.7pt);}%",
    "  \\node[anchor=north, inner sep=1pt] at ([yshift=-3pt]#1.south) {\\scriptsize #6};%",
    "  \\NNAnchors{#1}%",
    "}",
    "\\newcommand{\\NNAttention}[6]{%",
    "  \\node[anchor=west, draw, thick, rounded corners=2pt, fill=#4, minimum width=#2, minimum height=#3, inner sep=1pt] (#1) at #5 {}; %",
    "  \\foreach \\x in {0.35,0.75,1.15,1.55,1.95} {\\fill ([xshift=\\x cm,yshift=0.22cm]#1.west) circle (1.5pt); \\fill ([xshift=\\x cm,yshift=-0.22cm]#1.west) circle (1.5pt); \\draw[->, opacity=.5] ([xshift=\\x cm,yshift=0.16cm]#1.west) -- ([xshift=\\x cm,yshift=-0.16cm]#1.west);}%",
    "  \\node[anchor=north, inner sep=1pt] at ([yshift=-3pt]#1.south) {\\scriptsize #6};%",
    "  \\NNAnchors{#1}%",
    "}",
    "\\newcommand{\\NNOperator}[6]{%",
    "  \\node[anchor=west, draw, thick, rounded corners=2pt, fill=#4, minimum width=#2, minimum height=#3, align=center, inner sep=2pt] (#1) at #5 {#6};%",
    "  \\NNAnchors{#1}%",
    "}",
    "\\tikzset{connection/.style={ultra thick, draw=black!55, opacity=.72}, copyconnection/.style={ultra thick, draw=black!45, opacity=.62, dashed}}",
    "\\begin{document}",
    "\\begin{tikzpicture}",
  ];

  let previous = null;
  for (const node of nodes) {
    const predecessor = choosePredecessor(node, incoming.get(node.id), previous, nodeMap);
    const to = predecessor ? `(${texName(predecessor.id)}-east)` : "(0,0,0)";
    lines.push(renderNode(node, to, placementFor(node, predecessor, nonLinearTopology)));
    previous = node;
  }

  for (const edge of layout.edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;
    lines.push(renderEdge(edge, source, target));
  }

  lines.push(
    "\\end{tikzpicture}",
    "\\end{document}",
  );
  return lines.filter(Boolean).join("\n");
}

function renderNode(node, to, placement = { x: 0, y: 0 }) {
  const name = texName(node.id);
  const role = String(node.visualRole || "").toLowerCase();
  const family = String(node.family || "").toLowerCase();
  const dimensions = dimensionsFor(node);
  const height = tensorSize(dimensions.spatial);
  const depth = tensorSize(dimensions.spatial);
  const caption = texText(figureCaption(node));
  const captionText = compactCaption(node, caption);

  if (role === "vectorize" || family === "flatten") {
    return [
      `\\NNFlatten{${name}}{0.65cm}{1.2cm}{\\SoftmaxColor}{${offsetCoordinate(to, placement)}}{${caption}}`,
    ].join("\n");
  }
  if (role === "merge-symbol" || family === "merge") {
    return [
      `\\pic[shift={${formatShift(placement)}}] at ${to} {Ball={name=${name}, fill=\\MergeColor, opacity=0.75, radius=2.5, logo=$+$}};`,
    ].join("\n");
  }
  if (role === "unresolved-module" || role === "compound-module" || family === "custom") {
    return [
      `\\node[anchor=west, draw, dashed, rounded corners, minimum width=1.45cm, minimum height=2.4cm, fill=yellow!12, align=center] (${name}) at ${offsetCoordinate(to, placement)} {${caption}};`,
      `\\NNAnchors{${name}}`,
    ].join("\n");
  }
  if (role === "pool-downsample" || family === "pool") {
    return [
      `\\pic[shift={${formatShift(placement)}}] at ${to} {Box={name=${name}, caption={${captionText}}, xlabel={{"${texText(dimensions.channels || "")}"}}, zlabel=${dimensions.spatial || ""}, fill=\\PoolColor, opacity=0.58, height=${Math.max(10, height * 0.72).toFixed(2)}, width=1, depth=${Math.max(10, depth * 0.72).toFixed(2)}}};`,
    ].join("\n");
  }
  if (role === "output-distribution" || family === "output") {
    return [
      `\\pic[shift={${formatShift(placement)}}] at ${to} {Box={name=${name}, caption={${captionText}}, xlabel={{" ","dummy"}}, zlabel=${dimensions.channels || "output"}, fill=\\SoftmaxColor, opacity=0.82, height=10, width=1.5, depth=25}};`,
    ].join("\n");
  }
  if (role === "neuron-layer" || family === "dense") {
    return [
      `\\NNDense{${name}}{1.35cm}{2.9cm}{\\FcColor}{${offsetCoordinate(to, placement)}}{${caption}}`,
    ].join("\n");
  }
  if (role === "token-sequence" || role === "recurrent-state" || family === "token" || family === "sequence" || family === "recurrent") {
    return `\\NNSequence{${name}}{2.4cm}{1.5cm}{\\TokenColor}{${offsetCoordinate(to, placement)}}{${caption}}`;
  }
  if (role === "attention" || family === "attention" || family === "cross-attention") {
    return `\\NNAttention{${name}}{2.4cm}{1.5cm}{\\AttentionColor}{${offsetCoordinate(to, placement)}}{${caption}}`;
  }
  if (role === "operator") {
    return `\\NNOperator{${name}}{2.0cm}{1.25cm}{\\OperatorColor}{${offsetCoordinate(to, placement)}}{${caption}}`;
  }
  const fill = "\\ConvColor";
  const repeated = Math.max(1, Math.min(8, Number(node.geometryData?.repeatCount) || 1));
  const widthParts = Array.from({ length: repeated }, () => "2");
  const operatorLabels = repeatedLabels(node, repeated, dimensions.channels);
  const banded = role === "feature-map-stage" || family === "conv" || family === "volume";
  const primitive = banded ? "RightBandedBox" : "Box";
  const band = banded
    ? `, bandfill=\\ConvReluColor, bandopacity=0.58, width={${widthParts.join(",")}}, xlabel={{${operatorLabels.map((label) => `\"${texText(label)}\"`).join(",")}}}`
    : `, width=${role === "input-tensor" || family === "input" ? 1 : 1.5}, xlabel={{${operatorLabels.map((label) => `\"${texText(label)}\"`).join(",")}}}`;
  return [
    `\\pic[shift={${formatShift(placement)}}] at ${to} {${primitive}={name=${name}, caption={${captionText}}, zlabel=${dimensions.spatial || ""}, fill=${fill}, height=${height.toFixed(2)}, depth=${depth.toFixed(2)}${band}}};`,
  ].join("\n");
}

function renderEdge(edge, source, target) {
  const type = String(edge.type || "signal").toLowerCase();
  const sourceName = texName(source.id);
  const targetName = texName(target.id);
  if (/skip|residual|shortcut/.test(type)) {
    return [
      `% skip/residual edge ${texName(edge.id)}`,
      `\\path (${sourceName}-southeast) -- (${sourceName}-northeast) coordinate[pos=1.25] (${sourceName}-top-${targetName});`,
      `\\path (${targetName}-south) -- (${targetName}-north) coordinate[pos=1.25] (${targetName}-top-${sourceName});`,
      `\\draw [copyconnection] (${sourceName}-northeast) -- node {\\midarrow} (${sourceName}-top-${targetName}) -- node {\\midarrow} (${targetName}-top-${sourceName}) -- node {\\midarrow} (${targetName}-north);`,
    ].join("\n");
  }
  return `\\draw [connection] (${sourceName}-east) -- node {\\midarrow} (${targetName}-west);`;
}

function choosePredecessor(node, edges = [], previous, nodeMap) {
  const direct = edges
    .filter((edge) => edge.target === node.id && !/skip|residual|shortcut/i.test(String(edge.type || "")))
    .map((edge) => nodeMap.get(edge.source))
    .find(Boolean);
  return direct || (previous && node.id !== previous.id ? previous : null);
}

function placementFor(node, predecessor, nonLinearTopology = false) {
  if (!predecessor) return { x: 0, y: 0 };
  const targetRole = String(node.visualRole || node.family || "").toLowerCase();
  const x = targetRole === "pool-downsample" || targetRole === "merge-symbol"
    ? 0.2
    : targetRole === "vectorize"
      ? 0.8
      : targetRole === "output-distribution"
        ? 0.9
        : targetRole === "unresolved-module" || targetRole === "compound-module"
          ? 1.2
          : 1.6;
  const sourceY = Number(predecessor.y);
  const targetY = Number(node.y);
  const y = nonLinearTopology && Number.isFinite(sourceY) && Number.isFinite(targetY)
    ? clamp(round((sourceY - targetY) / 120), -3.5, 3.5)
    : 0;
  return { x, y };
}

function hasNonLinearTopology(edges = []) {
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const source = String(edge?.source || "");
    const target = String(edge?.target || "");
    outgoing.set(source, (outgoing.get(source) || 0) + 1);
    incoming.set(target, (incoming.get(target) || 0) + 1);
    if (/skip|residual|shortcut/i.test(String(edge?.type || ""))) return true;
  }
  return [...incoming.values()].some((count) => count > 1)
    || [...outgoing.values()].some((count) => count > 1);
}

function repeatedLabels(node, count, channels) {
  const labels = Array.isArray(node.geometryData?.internalOperatorLabels)
    ? node.geometryData.internalOperatorLabels.filter(Boolean).slice(0, count).map(compactOperatorLabel)
    : [];
  const family = String(node.family || "").toLowerCase();
  const role = String(node.visualRole || "").toLowerCase();
  const fallback = family === "conv" || family === "volume" || role === "feature-map-stage"
    ? compactOperatorLabel("Conv " + (channels || ""))
    : channels || "";
  while (labels.length < count) labels.push(fallback);
  let previous = "";
  return labels.map((label) => {
    if (label && label === previous) return "";
    if (label) previous = label;
    return label;
  });
}

function compactCaption(node, caption) {
  const role = String(node.visualRole || "").toLowerCase();
  const family = String(node.family || "").toLowerCase();
  if (role === "input-tensor" || family === "input") return "\\scriptsize IN";
  if (role === "pool-downsample" || family === "pool") return "\\scriptsize MP";
  if (role === "output-distribution" || family === "output") return "\\scriptsize OUT";
  return caption;
}

function compactOperatorLabel(value) {
  return String(value || "")
    .replace(/^Conv(?:olution)?\s*/i, "")
    .replace(/^Max(?:imum)?Pool(?:ing)?\s*/i, "")
    .replace(/^AveragePool(?:ing)?\s*/i, "")
    .replace(/^BatchNorm(?:alization)?\s*/i, "")
    .replace(/^Linear\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function figureCaption(node = {}) {
  const explicit = node.figureLabel || node.label || node.op;
  if (explicit && !isGeneratedNodeId(explicit)) return explicit;
  const role = String(node.visualRole || "").toLowerCase();
  const family = String(node.family || "").toLowerCase();
  if (role === "vectorize" || family === "flatten") return "Flatten";
  if (role === "output-distribution" || family === "output") return "Output";
  if (role === "pool-downsample" || family === "pool") return "MaxPool";
  if (role === "neuron-layer" || family === "dense") return "Dense";
  if (role === "input-tensor" || family === "input") return "Input";
  if (role === "feature-map-stage" || family === "conv" || family === "volume") return "Feature map";
  return explicit || node.id || "Node";
}

function isGeneratedNodeId(value) {
  return /^code-\d+(?:-[A-Za-z0-9_-]+)+$/.test(String(value));
}

function offsetCoordinate(anchor, placement) {
  const x = Number(placement?.x) || 0;
  const y = Number(placement?.y) || 0;
  if (x === 0 && y === 0) return anchor;
  const anchorName = String(anchor).replace(/^\((.*)\)$/, "$1");
  return `([xshift=${x}cm,yshift=${y}cm]${anchorName})`;
}

function formatShift(placement) {
  const x = Number(placement?.x) || 0;
  const y = Number(placement?.y) || 0;
  return `(${trimNumber(x)},${trimNumber(y)},0)`;
}

function trimNumber(value) {
  return Number(value.toFixed(2)).toString();
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function dimensionsFor(node) {
  const geometry = node.geometryData || {};
  const shape = node.shape || {};
  const role = String(node.visualRole || "").toLowerCase();
  if (role === "vectorize" || role === "neuron-layer" || role === "output-distribution") {
    return {
      spatial: 1,
      channels: positiveNumber(geometry.channelCount)
        || inferChannels(shape, node.subtitle)
        || inferUnits(node.label, node.subtitle)
        || "",
    };
  }
  return {
    spatial: positiveNumber(geometry.spatialSize) || inferSpatial(shape, node.subtitle) || 32,
    channels: positiveNumber(geometry.channelCount) || inferChannels(shape, node.subtitle) || "",
  };
}

function inferSpatial(shape, subtitle = "") {
  const values = dimensionValues(shape);
  const numbers = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
  if (numbers.length >= 2) return Math.max(...numbers.slice(-2));
  return Number(String(subtitle).match(/(\d+)\s*[×x]\s*\d+/)?.[1]) || 0;
}

function inferChannels(shape, subtitle = "") {
  const values = dimensionValues(shape);
  const numbers = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
  if (numbers.length >= 3) return numbers.at(-3);
  return Number(String(subtitle).match(/[×x]\s*(\d+)(?:\s|$)/)?.[1]) || 0;
}

function dimensionValues(shape = {}) {
  return shape?.dimensions || shape?.dims || shape?.output || shape?.input || [];
}

function inferUnits(label = "", subtitle = "") {
  return Number(`${label} ${subtitle}`.match(/(?:linear|dense|fc|units|classes)\D*(\d+)/i)?.[1]) || 0;
}

function tensorSize(spatial) {
  return Math.max(12, Math.min(40, 10 + 30 * Math.pow(Math.max(1, Number(spatial)) / 224, 0.4)));
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function compareNodes(left, right) {
  return Number(left.stage || 0) - Number(right.stage || 0)
    || Number(left.order || 0) - Number(right.order || 0)
    || String(left.id).localeCompare(String(right.id));
}

function texPath(value) {
  return String(value).replaceAll("\\", "/").replaceAll(" ", "\\ ").replace(/\/$/, "");
}

function layerImportLines(projectPath) {
  if (!isAbsoluteTexPath(projectPath)) {
    return [`\\subimport{${projectPath}/layers/}{init}`];
  }
  return [
    "\\makeatletter",
    `\\def\\input@path{{${projectPath}/layers/}}`,
    "\\makeatother",
    `\\input{${projectPath}/layers/init.tex}`,
  ];
}

function isAbsoluteTexPath(value) {
  return /^\/?[A-Za-z]:\//.test(String(value)) || String(value).startsWith("/");
}

function texName(value) {
  return String(value || "node").replace(/[^A-Za-z0-9:_-]/g, "-");
}

function texText(value) {
  return String(value || "")
    .replaceAll("\\", "")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("&", "\\&")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("×", "\\ensuremath{\\times} ")
    .replaceAll("·", "\\ensuremath{\\cdot} ")
    .replaceAll("\n", " ");
}
