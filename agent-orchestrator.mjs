import { normalizeArchitectureInput } from "./input-adapters.mjs";

const MAX_REPAIR_ATTEMPTS = 2;
let nextRunId = 1;

export function createAgentRun(input, dependencies = {}) {
  const normalizedInput = normalizeArchitectureInput(input);
  return {
    id: `agent-run-${Date.now().toString(36)}-${nextRunId++}`,
    input: clone(normalizedInput),
    dependencies: { ...dependencies },
    status: "ready",
    stage: "inspect",
    snapshots: freezeSnapshots([]),
    diagnostics: [],
    attempts: { repair: 0 },
    inspect: undefined,
    extract: undefined,
    normalize: undefined,
    ir: undefined,
    figurePlan: undefined,
    renderResult: undefined,
    readback: undefined,
  };
}

export async function runAgentPipeline(run) {
  let current = run;
  const stages = [
    ["inspect", current.input],
    ["extract", () => current.inspect],
    ["normalize", () => current.extract],
    ["plan", () => current.ir],
  ];

  for (const [stage, input] of stages) {
    current.stage = stage;
    const dependency = current.dependencies?.[stage];
    try {
      const value = await invoke(dependency, typeof input === "function" ? input() : input, current);
      current[stage] = value;
      appendSnapshot(current, stage, value);
    } catch (error) {
      return failAt(current, stage, error);
    }

    if (stage === "extract" && containsUnresolved(current.extract)) {
      current.status = "needs-confirmation";
      current.diagnostics = uniqueDiagnostics([
        ...current.diagnostics,
        { kind: "needs-confirmation", code: "unresolved-evidence", severity: "warning", message: "Evidence contains unresolved architecture structure." },
      ]);
      return resultOf(current);
    }

    if (stage === "normalize") {
      current.ir = current.normalize?.ir || current.normalize;
    }
    if (stage === "plan") {
      current.planOutput = current.plan;
      current.figurePlan = current.plan?.figurePlan || current.plan;
      if (current.plan?.ir) current.ir = current.plan.ir;
    }
  }

  const render = current.dependencies?.render;
  if (typeof render === "function") {
    current.stage = "render";
    try {
      current.renderResult = await render(current.figurePlan, current);
      appendSnapshot(current, "render", current.renderResult);
    } catch (error) {
      return failAt(current, "render", error, "render-failed");
    }
  }

  const readback = current.dependencies?.readback;
  if (typeof readback === "function") {
    current.stage = "readback";
    try {
      current.readback = await readback(current.figurePlan, current.renderResult, current);
      appendSnapshot(current, "readback", current.readback);
    } catch (error) {
      return failAt(current, "readback", error, "readback-mismatch");
    }
    const readbackDiagnostics = diagnoseReadback(current.renderResult?.figurePlan || current.figurePlan, current.readback);
    if (readbackDiagnostics.length) {
      current.diagnostics = uniqueDiagnostics([...current.diagnostics, ...readbackDiagnostics]);
      current.status = "readback-mismatch";
      return resultOf(current);
    }
  }

  current.status = "completed";
  current.stage = current.snapshots.at(-1)?.stage || "plan";
  return resultOf(current);
}

export function resumeAgentRun(run, event = {}) {
  const next = {
    ...run,
    input: clone(run.input),
    dependencies: { ...(run.dependencies || {}) },
    snapshots: freezeSnapshots(run.snapshots || []),
    diagnostics: clone(run.diagnostics || []),
    attempts: { repair: Number(run.attempts?.repair || 0) },
  };
  if (event.type === "confirm") {
    next.status = "confirmed";
    next.confirmation = clone(event.value);
    return next;
  }
  if (event.type === "repair") {
    if (next.attempts.repair >= MAX_REPAIR_ATTEMPTS) {
      next.status = "repair-failed";
      return next;
    }
    next.attempts.repair += 1;
    next.status = "repair-pending";
    next.repair = clone(event.value);
    return next;
  }
  if (event.type === "render-result") {
    next.renderResult = clone(event.value);
    next.status = "rendered";
    return next;
  }
  if (event.type === "readback-result") {
    next.readback = clone(event.value);
    const issues = diagnoseReadback(next.renderResult?.figurePlan || next.figurePlan, next.readback);
    next.diagnostics = uniqueDiagnostics([...next.diagnostics, ...issues]);
    next.status = issues.length ? "readback-mismatch" : "completed";
    return next;
  }
  return next;
}

export function diagnoseReadback(expected = {}, actual = {}) {
  const diagnostics = [];
  const expectedNodes = Array.isArray(expected.nodes) ? expected.nodes : [];
  const actualNodes = Array.isArray(actual.nodes)
    ? actual.nodes
    : (Array.isArray(actual.sourceNodeIds) ? actual.sourceNodeIds.map((sourceNodeId) => ({ sourceNodeId })) : []);
  const expectedNodeIds = expectedNodes.map((node) => String(node.sourceNodeId || node.id || "")).filter(Boolean);
  const actualNodeIds = new Set(actualNodes.map((node) => String(node.sourceNodeId || node.id || node || "")).filter(Boolean));
  for (const sourceNodeId of expectedNodeIds) {
    if (!actualNodeIds.has(sourceNodeId)) diagnostics.push(mismatch("missing-source-node-id", `Readback is missing source node ${sourceNodeId}.`, { sourceNodeId }));
  }

  const expectedEdges = Array.isArray(expected.edges) ? expected.edges : [];
  const actualEdges = Array.isArray(actual.connectors)
    ? actual.connectors
    : (Array.isArray(actual.edgeIds) ? actual.edgeIds.map((id) => ({ sourceEdgeId: id })) : []);
  const actualEdgeById = new Map(actualEdges.map((edge) => [String(edge.sourceEdgeId || edge.id || ""), edge]));
  for (const expectedEdge of expectedEdges) {
    const sourceEdgeId = String(expectedEdge.sourceEdgeId || expectedEdge.id || "");
    const actualEdge = actualEdgeById.get(sourceEdgeId);
    if (!actualEdge) {
      diagnostics.push(mismatch("missing-connector-id", `Readback is missing connector ${sourceEdgeId}.`, { sourceEdgeId }));
      continue;
    }
    const expectedSource = String(expectedEdge.sourceNodeId || expectedEdge.source || "");
    const expectedTarget = String(expectedEdge.targetNodeId || expectedEdge.target || "");
    const actualSource = String(actualEdge.sourceNodeId || actualEdge.source || "");
    const actualTarget = String(actualEdge.targetNodeId || actualEdge.target || "");
    if ((expectedSource && actualSource && expectedSource !== actualSource) || (expectedTarget && actualTarget && expectedTarget !== actualTarget)) {
      diagnostics.push(mismatch("missing-connector-id", `Connector ${sourceEdgeId} does not match the planned endpoint identity.`, { sourceEdgeId }));
      diagnostics.push(mismatch("glue-mismatch", `Connector ${sourceEdgeId} is glued to the wrong endpoint.`, { sourceEdgeId }));
    }
  }
  if (expected.renderId && String(expected.renderId) !== String(actual.renderId || "")) {
    diagnostics.push(mismatch("render-id-mismatch", "Readback render identity does not match the requested render.", { expected: expected.renderId, actual: actual.renderId || "" }));
  }
  return diagnostics;
}

function appendSnapshot(run, stage, value) {
  run.snapshots = freezeSnapshots([...run.snapshots, { stage, value: clone(value) }]);
}

function failAt(run, stage, error, kind = `${stage}-failed`) {
  run.status = kind;
  run.stage = stage;
  run.diagnostics = uniqueDiagnostics([...run.diagnostics, {
    kind,
    code: kind,
    severity: "error",
    message: error instanceof Error ? error.message : String(error),
    stage,
  }]);
  return resultOf(run);
}

function resultOf(run) {
  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    snapshots: run.snapshots,
    diagnostics: clone(run.diagnostics),
    attempts: { ...run.attempts },
    input: clone(run.input),
    ir: clone(run.ir),
    figurePlan: clone(run.figurePlan),
    planOutput: clone(run.planOutput),
    renderResult: clone(run.renderResult),
    readback: clone(run.readback),
  };
}

async function invoke(dependency, value, run) {
  if (typeof dependency !== "function") return value;
  return dependency(value, run);
}

function containsUnresolved(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsUnresolved);
  if (value.status === "unresolved" || value.kind === "unresolved-operator" || value.code === "unresolved-operator") return true;
  if (value.family === "custom" || value.compoundKind === "unresolved") return true;
  return Array.isArray(value.diagnostics) && value.diagnostics.some(containsUnresolved)
    || Array.isArray(value.nodes) && value.nodes.some(containsUnresolved);
}

function mismatch(code, message, extra) {
  return { kind: "readback-mismatch", code, severity: "error", message, ...extra };
}

function uniqueDiagnostics(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind}:${item.code || ""}:${item.sourceNodeId || item.sourceEdgeId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function freezeSnapshots(value) {
  return Object.freeze(value.map((item) => Object.freeze(clone(item))));
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}
