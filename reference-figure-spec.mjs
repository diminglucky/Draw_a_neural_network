export const REFERENCE_FIGURE_SPEC_VERSION = "reference-figure-spec/v1";

export function createPlotNeuralNetStyleSpec() {
  return {
    version: REFERENCE_FIGURE_SPEC_VERSION,
    id: "plot-neural-net-tensor-flow",
    label: "PlotNeuralNet-style tensor flow",
    tensorGrammar: {
      depthRatio: 0.28,
      faceOpacity: 0.72,
      drawEastFace: true,
      labelMode: "outside-below",
      showShapes: true,
    },
    layout: {
      direction: "left-to-right",
      alignment: "centerline",
      branchGap: 64,
      stageGap: 108,
      margin: 56,
      whitespaceTarget: [0.72, 0.92],
    },
    palette: {
      data: "#FFC47A",
      operator: "#E7EEF5",
      structure: "#E2F3E7",
      boundary: "#F5F0E7",
      attention: "#E8DDF5",
      state: "#E8DDF5",
    },
    typography: {
      titlePt: 14,
      labelPt: 8,
      subtitlePt: 7,
    },
    connectors: {
      main: { color: "#3F5470", pattern: "solid" },
      bypass: { color: "#318470", pattern: "dashed" },
      state: { color: "#467EA6", pattern: "dashed" },
      conditional: { color: "#7E5CA4", pattern: "dashed" },
      scaleTransfer: { color: "#52709E", pattern: "dashed" },
    },
    comparatorTargets: {
      maxLabelOverlaps: 0,
      maxLabelBodyOverlaps: 0,
      maxConnectorBodyIntersections: 0,
    },
  };
}

export function validateReferenceFigureSpec(spec = {}) {
  const issues = [];
  if (spec.version !== REFERENCE_FIGURE_SPEC_VERSION) issues.push({ code: "invalid-reference-figure-spec-version", value: spec.version });
  if (!String(spec.id || "").trim()) issues.push({ code: "missing-reference-figure-id" });
  if (spec.layout?.direction !== "left-to-right") issues.push({ code: "invalid-reference-layout-direction", value: spec.layout?.direction });
  if (!Array.isArray(spec.layout?.whitespaceTarget) || spec.layout.whitespaceTarget.length !== 2) {
    issues.push({ code: "invalid-reference-whitespace-target" });
  }
  for (const key of ["main", "bypass", "state", "conditional", "scaleTransfer"]) {
    if (!spec.connectors?.[key]?.color || !spec.connectors?.[key]?.pattern) {
      issues.push({ code: "missing-reference-connector-style", connector: key });
    }
  }
  return { ok: issues.length === 0, issues };
}
