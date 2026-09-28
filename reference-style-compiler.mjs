import { validateReferenceFigureSpec } from "./reference-figure-spec.mjs";

export const REFERENCE_STYLE_COMPILATION_VERSION = "reference-style-compilation/v1";

export function compileReferenceStyle({ style = {}, canonicalModel = {} } = {}) {
  const validation = validateReferenceFigureSpec(style);
  if (!validation.ok) throw new TypeError(`Invalid Reference Figure Spec: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  const constraints = [
    {
      id: `constraint:reference:${style.id}:align-scale-centerlines`,
      kind: "align-scale-centerlines",
      priority: 100,
      styleId: style.id,
    },
    {
      id: `constraint:reference:${style.id}:label-density`,
      kind: "limit-label-density",
      maxLabelsPerNode: style.tensorGrammar?.showShapes ? 2 : 1,
      priority: 60,
      styleId: style.id,
    },
  ];
  return {
    version: REFERENCE_STYLE_COMPILATION_VERSION,
    styleId: style.id,
    constraints,
    styleTokens: {
      palette: { ...(style.palette || {}) },
      typography: { ...(style.typography || {}) },
      tensorGrammar: { ...(style.tensorGrammar || {}) },
      connectorStyles: clone(style.connectors || {}),
      whitespaceTarget: [...(style.layout?.whitespaceTarget || [])],
    },
    diagnostics: [],
    summary: {
      nodeCount: canonicalModel.nodes?.length || 0,
      edgeCount: canonicalModel.edges?.length || 0,
      constraintCount: constraints.length,
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}
