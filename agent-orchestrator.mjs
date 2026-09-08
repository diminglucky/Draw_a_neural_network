import { normalizeArchitectureInput } from "./input-adapters.mjs";
import { createMemoryRunStore } from "./run-store.mjs";

const MAX_REPAIR_ATTEMPTS = 2;
const CORE_STAGES = ["inspect", "extract", "normalize", "plan"];
let nextRunId = 1;
const runtimeByRun = new WeakMap();

export function createAgentRun(input, dependencies = {}, options = {}) {
  const run = {
    id: `agent-run-${Date.now().toString(36)}-${nextRunId++}`,
    input: clone(normalizeArchitectureInput(input)),
    dependencies: { ...dependencies },
    status: "ready",
    stage: "inspect",
    snapshots: freezeSnapshots([]),
    diagnostics: [],
    attempts: { repair: 0 },
    inspect: undefined, extract: undefined, normalize: undefined, ir: undefined,
    plan: undefined, planOutput: undefined, figurePlan: undefined,
    renderResult: undefined, readback: undefined,
  };
  runtimeByRun.set(run, {
    dependencies: { ...dependencies },
    runStore: options.runStore || dependencies.runStore || createMemoryRunStore(),
    rootRun: run,
    state: run,
  });
  return run;
}

export async function runAgentPipeline(run, options = {}) {
  const runtime = runtimeFor(run, options);
  const stored = await readStoredRun(runtime.runStore, run.id);
  const preferred = runtime.state && runtime.state !== run
    && ["confirmed", "repair-pending"].includes(runtime.state.status)
    ? runtime.state
    : (runtime.state || stored || run);
  const current = workingRun(preferred, runtime);
  if (current.status === "completed" && !options.force) return rememberResult(current, runtime);
  await saveRun(current, runtime.runStore);

  if (current.status === "repair-pending") return rememberResult(await continueRepair(current, runtime), runtime);

  for (let index = nextCoreStageIndex(current); index < CORE_STAGES.length; index += 1) {
    const stage = CORE_STAGES[index];
    current.stage = stage;
    try {
      const value = await invoke(runtime.dependencies?.[stage], stageInput(current, stage), current);
      current[stage] = value;
      if (stage === "normalize") current.ir = current.normalize?.ir || current.normalize;
      if (stage === "plan") {
        current.planOutput = current.plan;
        current.figurePlan = current.plan?.figurePlan || current.plan;
        if (current.plan?.ir) current.ir = current.plan.ir;
      }
      await appendSnapshot(current, stage, value, runtime.runStore);
    } catch (error) {
      return rememberResult(await failAt(current, stage, error), runtime);
    }
    if (stage === "extract" && current.extract?.status === "needs_external_vision") {
      current.status = "needs_external_vision";
      current.diagnostics = uniqueDiagnostics([
        ...current.diagnostics,
        ...(Array.isArray(current.extract.diagnostics) ? current.extract.diagnostics : []),
      ]);
      await saveRun(current, runtime.runStore);
      return rememberResult(current, runtime);
    }
    if (stage === "extract" && containsUnresolved(current.extract)) {
      const unresolvedNodes = collectUnresolvedNodes(current.extract);
      current.status = "needs-confirmation";
      current.diagnostics = uniqueDiagnostics([...current.diagnostics, {
        kind: "needs-confirmation", code: "unresolved-evidence", severity: "warning",
        message: unresolvedNodes.length
          ? `Evidence contains unresolved architecture structure: ${unresolvedNodes.join(", ")}.`
          : "Evidence contains unresolved architecture structure.",
      }]);
      await saveRun(current, runtime.runStore);
      return rememberResult(current, runtime);
    }
  }
  return rememberResult(await runPostPlan(current, runtime), runtime);
}

export function resumeAgentRun(run, event = {}) {
  const runtime = runtimeFor(run);
  const next = workingRun(runtime.state || run, runtime);
  if (event.type === "confirm") {
    next.confirmation = clone(event.value);
    next.status = event.value?.accepted === true ? "confirmed" : "confirmation-rejected";
  } else if (event.type === "repair") {
    if (next.attempts.repair >= MAX_REPAIR_ATTEMPTS) next.status = "repair-failed";
    else {
      next.attempts.repair += 1;
      next.status = "repair-pending";
      next.repair = clone(event.value);
      next.repairReason = event.value?.reason ?? event.reason ?? "unspecified";
    }
  } else if (event.type === "render-result") {
    next.renderResult = clone(event.value);
    next.status = "rendered";
    next.stage = "render";
    next.snapshots = upsertSnapshot(next.snapshots, "render", event.value);
  } else if (event.type === "readback-result") {
    next.readback = clone(event.value);
    const issues = diagnoseReadback(next.renderResult?.figurePlan || next.figurePlan, next.readback);
    next.diagnostics = uniqueDiagnostics([...next.diagnostics, ...issues]);
    next.status = issues.length ? "readback-mismatch" : "completed";
    next.stage = "readback";
    next.snapshots = upsertSnapshot(next.snapshots, "readback", event.value);
  }
  runtimeByRun.set(next, { ...runtime, state: next });
  return next;
}

export async function continueAgentRun(run, options = {}) {
  return runAgentPipeline(run, { ...options, force: true });
}

export async function persistAgentRun(run) {
  const runtime = runtimeFor(run);
  const next = workingRun(run, runtime);
  const latestStage = next.stage;
  const value = latestStage === "render" ? next.renderResult : latestStage === "readback" ? next.readback : undefined;
  if (value !== undefined && !next.snapshots.some((snapshot) => snapshot.stage === latestStage)) {
    next.snapshots = freezeSnapshots([...next.snapshots, { stage: latestStage, value: clone(value) }]);
  }
  await saveRun(next, runtime.runStore);
  runtimeByRun.set(run, { ...runtime, state: next });
  return resultOf(next);
}

export function diagnoseReadback(expected = {}, actual = {}) {
  const diagnostics = [];
  const expectedNodes = Array.isArray(expected.nodes) ? expected.nodes : [];
  const actualNodes = Array.isArray(actual.nodes) ? actual.nodes : (Array.isArray(actual.sourceNodeIds) ? actual.sourceNodeIds.map((sourceNodeId) => ({ sourceNodeId })) : []);
  const expectedNodeIds = expectedNodes.map((node) => String(node.sourceNodeId || node.id || "")).filter(Boolean);
  const actualNodeIds = new Set(actualNodes.map((node) => String(node.sourceNodeId || node.id || node || "")).filter(Boolean));
  for (const sourceNodeId of expectedNodeIds) {
    if (!actualNodeIds.has(sourceNodeId)) diagnostics.push(mismatch("missing-source-node-id", `Readback is missing source node ${sourceNodeId}.`, { sourceNodeId }));
  }
  const expectedEdges = Array.isArray(expected.edges) ? expected.edges : [];
  // 内部 Visio 桥的 readback 用 connectorEndpoints（键为无前缀 sourceEdgeId）；
  // 外部 readback-result 事件用 connectors 数组；旧格式退化为 edgeIds（带 outer-edge:: 前缀）。
  const actualEdges = collectReadbackConnectors(actual);
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
  if (expected.renderId && String(expected.renderId) !== String(actual.renderId || "")) diagnostics.push(mismatch("render-id-mismatch", "Readback render identity does not match the requested render.", { expected: expected.renderId, actual: actual.renderId || "" }));
  return diagnostics;
}

function collectReadbackConnectors(actual = {}) {
  if (Array.isArray(actual.connectors)) return actual.connectors;
  if (actual.connectorEndpoints && typeof actual.connectorEndpoints === "object" && !Array.isArray(actual.connectorEndpoints)) {
    return Object.values(actual.connectorEndpoints);
  }
  if (Array.isArray(actual.edgeIds)) return actual.edgeIds.map((id) => ({ sourceEdgeId: id }));
  return [];
}

async function continueRepair(current, runtime) {
  current.stage = "repair";
  const reason = current.repairReason || current.repair?.reason || "unspecified";
  try {
    const repair = runtime.dependencies?.repairFigurePlan;
    const nextPlan = typeof repair === "function" ? await repair(clone(current.figurePlan), reason, current) : clone(current.figurePlan);
    if (nextPlan === undefined) throw new Error("repairFigurePlan must return a Figure Plan.");
    current.figurePlan = clone(nextPlan);
    current.planOutput = current.planOutput?.figurePlan ? { ...clone(current.planOutput), figurePlan: clone(nextPlan) } : clone(nextPlan);
    current.plan = current.planOutput;
    await appendSnapshot(current, "repair", { reason, figurePlan: nextPlan }, runtime.runStore);
    return runPostPlan(current, runtime);
  } catch (error) {
    return failAt(current, "repair", error, "repair-failed");
  }
}

async function runPostPlan(current, runtime) {
  if (typeof runtime.dependencies?.render === "function") {
    current.stage = "render";
    try {
      current.renderResult = await runtime.dependencies.render(clone(current.figurePlan), current);
      await appendSnapshot(current, "render", current.renderResult, runtime.runStore);
    } catch (error) { return failAt(current, "render", error, "render-failed"); }
  }
  if (typeof runtime.dependencies?.readback === "function") {
    current.stage = "readback";
    try {
      current.readback = await runtime.dependencies.readback(clone(current.figurePlan), current.renderResult, current);
      await appendSnapshot(current, "readback", current.readback, runtime.runStore);
    } catch (error) { return failAt(current, "readback", error, "readback-mismatch"); }
    const issues = diagnoseReadback(current.renderResult?.figurePlan || current.figurePlan, current.readback);
    if (issues.length) {
      current.diagnostics = uniqueDiagnostics([...current.diagnostics, ...issues]);
      current.status = "readback-mismatch";
      await saveRun(current, runtime.runStore);
      return current;
    }
  }
  current.status = "completed";
  current.stage = current.snapshots.at(-1)?.stage || "plan";
  await saveRun(current, runtime.runStore);
  return current;
}

function nextCoreStageIndex(run) {
  const indexes = run.snapshots.map((snapshot) => CORE_STAGES.indexOf(snapshot.stage)).filter((index) => index >= 0);
  return indexes.length ? indexes.at(-1) + 1 : 0;
}

function stageInput(run, stage) {
  if (stage === "inspect") return run.input;
  if (stage === "extract") return run.inspect;
  if (stage === "normalize") return run.extract;
  return run.ir;
}

async function appendSnapshot(run, stage, value, store) {
  const snapshot = { stage, value: clone(value) };
  run.snapshots = freezeSnapshots([...run.snapshots, snapshot]);
  if (store) {
    await store.appendSnapshot(run.id, snapshot);
    await saveRun(run, store);
  }
}

async function failAt(run, stage, error, kind = `${stage}-failed`) {
  run.status = kind;
  run.stage = stage;
  run.diagnostics = uniqueDiagnostics([...run.diagnostics, { kind, code: kind, severity: "error", message: error instanceof Error ? error.message : String(error), stage }]);
  await saveRun(run, runtimeByRun.get(run)?.runStore);
  return run;
}

function runtimeFor(run, options = {}) {
  const existing = runtimeByRun.get(run);
  if (existing) return { ...existing, runStore: options.runStore || existing.runStore };
  return { dependencies: { ...(run.dependencies || {}) }, runStore: options.runStore || run.runStore, state: run };
}

async function readStoredRun(store, id) { return store?.get ? store.get(id) : undefined; }
async function saveRun(run, store) { if (store?.set) await store.set(run.id, persistedRun(run)); }
function persistedRun(run) { const copy = publicState(run); delete copy.dependencies; return copy; }

function workingRun(source, runtime) {
  const run = { ...source, input: clone(source.input), dependencies: { ...runtime.dependencies }, snapshots: freezeSnapshots(source.snapshots || []), diagnostics: clone(source.diagnostics || []), attempts: { repair: Number(source.attempts?.repair || 0) }, repair: clone(source.repair), confirmation: clone(source.confirmation), repairReason: source.repairReason };
  restoreSnapshots(run);
  return run;
}

function restoreSnapshots(run) {
  for (const snapshot of run.snapshots) {
    const value = clone(snapshot.value);
    if (snapshot.stage === "inspect") run.inspect = value;
    if (snapshot.stage === "extract") run.extract = value;
    if (snapshot.stage === "normalize") { run.normalize = value; run.ir = value?.ir || value; }
    if (snapshot.stage === "plan") { run.plan = value; run.planOutput = value; run.figurePlan = value?.figurePlan || value; if (value?.ir) run.ir = value.ir; }
    if (snapshot.stage === "render") run.renderResult = value;
    if (snapshot.stage === "readback") run.readback = value;
  }
}

function rememberResult(current, runtime) {
  const result = resultOf(current);
  const metadata = { ...runtime, state: current };
  runtimeByRun.set(current, metadata);
  runtimeByRun.set(result, metadata);
  if (runtime.rootRun) runtimeByRun.set(runtime.rootRun, metadata);
  return result;
}

function resultOf(run) {
  return publicState(run);
}

function publicState(run) {
  return { id: run.id, status: run.status, stage: run.stage, snapshots: run.snapshots, diagnostics: clone(run.diagnostics), attempts: { ...run.attempts }, input: clone(run.input), inspect: clone(run.inspect), extract: clone(run.extract), normalize: clone(run.normalize), ir: clone(run.ir), plan: clone(run.plan), figurePlan: clone(run.figurePlan), planOutput: clone(run.planOutput), renderResult: clone(run.renderResult), readback: clone(run.readback), confirmation: clone(run.confirmation), repair: clone(run.repair), repairReason: run.repairReason };
}

async function invoke(dependency, value, run) { return typeof dependency === "function" ? dependency(value, run) : value; }

function containsUnresolved(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsUnresolved);
  if (value.status === "unresolved" || value.kind === "unresolved-operator" || value.code === "unresolved-operator") return true;
  if (value.family === "custom" || value.compoundKind === "unresolved") return true;
  if (["recurrent", "rnn", "lstm", "gru"].includes(String(value.family || "").toLowerCase())) {
    const graph = value.attributes?.internalGraph || value.internalGraph;
    if (!graph || graph.status === "unresolved" || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return true;
  }
  return Array.isArray(value.diagnostics) && value.diagnostics.some(containsUnresolved) || Array.isArray(value.nodes) && value.nodes.some(containsUnresolved);
}

function collectUnresolvedNodes(value, acc = []) {
  if (!value || typeof value !== "object") return acc;
  if (Array.isArray(value)) { value.forEach((item) => collectUnresolvedNodes(item, acc)); return acc; }
  if (value.family === "custom" || value.compoundKind === "unresolved") {
    acc.push(String(value.op || value.label || value.id || "custom"));
  }
  if (["recurrent", "rnn", "lstm", "gru"].includes(String(value.family || "").toLowerCase())) {
    const graph = value.attributes?.internalGraph || value.internalGraph;
    if (!graph || graph.status === "unresolved" || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
      acc.push(String(value.op || value.label || value.id || value.family));
    }
  }
  if (Array.isArray(value.nodes)) value.nodes.forEach((node) => collectUnresolvedNodes(node, acc));
  if (Array.isArray(value.diagnostics)) value.diagnostics.forEach((diag) => collectUnresolvedNodes(diag, acc));
  return acc;
}

function mismatch(code, message, extra) { return { kind: "readback-mismatch", code, severity: "error", message, ...extra }; }
function uniqueDiagnostics(items) {
  const seen = new Set();
  return items.filter((item) => { const key = `${item.kind}:${item.code || ""}:${item.sourceNodeId || item.sourceEdgeId || ""}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function freezeSnapshots(value) { return Object.freeze(value.map((item) => Object.freeze(clone(item)))); }
function upsertSnapshot(snapshots, stage, value) {
  return freezeSnapshots([...snapshots.filter((snapshot) => snapshot.stage !== stage), { stage, value: clone(value) }]);
}
function clone(value) { return value === undefined ? undefined : structuredClone(value); }
