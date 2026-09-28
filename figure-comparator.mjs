export const FIGURE_COMPARISON_VERSION = "figure-comparison/v1";

export function compareFigureMetrics(reference = {}, candidate = {}, tolerances = {}) {
  const rules = {
    whitespaceRatio: tolerances.whitespaceRatio ?? 0.12,
    labelOverlapCount: tolerances.labelOverlapCount ?? 0,
    labelBodyOverlapCount: tolerances.labelBodyOverlapCount ?? 0,
    connectorBodyIntersectionCount: tolerances.connectorBodyIntersectionCount ?? 0,
  };
  const issues = [];
  for (const [metric, tolerance] of Object.entries(rules)) {
    const expected = reference[metric];
    const actual = candidate[metric];
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) continue;
    if (Math.abs(expected - actual) > tolerance) {
      issues.push({ code: "figure-metric-mismatch", metric, expected, actual, tolerance });
    }
  }
  return {
    version: FIGURE_COMPARISON_VERSION,
    ok: issues.length === 0,
    issues,
    summary: { metricCount: Object.keys(rules).length, issueCount: issues.length },
  };
}

export function compareShapeProgression(reference = [], candidate = []) {
  const issues = [];
  const referenceLength = Array.isArray(reference) ? reference.length : 0;
  const candidateLength = Array.isArray(candidate) ? candidate.length : 0;
  if (referenceLength !== candidateLength) {
    issues.push({ code: "shape-progression-length-mismatch", expected: referenceLength, actual: candidateLength });
  }
  const length = Math.min(referenceLength, candidateLength);
  for (let index = 0; index < length; index += 1) {
    if (String(reference[index]) !== String(candidate[index])) {
      issues.push({ code: "shape-progression-value-mismatch", index, expected: String(reference[index]), actual: String(candidate[index]) });
    }
  }
  return { version: FIGURE_COMPARISON_VERSION, ok: issues.length === 0, issues };
}
