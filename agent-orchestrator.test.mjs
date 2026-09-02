import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentRun,
  continueAgentRun,
  diagnoseReadback,
  persistAgentRun,
  resumeAgentRun,
  runAgentPipeline,
} from "./agent-orchestrator.mjs";
import { createMemoryRunStore } from "./run-store.mjs";

const input = { kind: "source", source: "class Net: pass", framework: "pytorch" };

function dependencies(overrides = {}) {
  return {
    inspect: async (value) => ({ source: value.source, evidence: [{ status: "confirmed" }] }),
    extract: (value) => ({ ...value, nodes: [{ id: "input", family: "input" }] }),
    normalize: (value) => ({ ...value, nodes: [{ id: "input", family: "input" }] }),
    plan: (value) => ({ figurePlan: { nodes: [{ id: "n1", sourceNodeId: "input" }], edges: [] }, ir: value }),
    render: async (value) => ({ renderId: "render-1", figurePlan: value }),
    readback: async (_plan, rendered) => ({ renderId: rendered.renderId, nodes: [{ sourceNodeId: "input" }], connectors: [] }),
    ...overrides,
  };
}

test("creates a normalized run with frozen snapshots and independent identity", () => {
  const run = createAgentRun(input, dependencies());
  assert.match(run.id, /^agent-run-/);
  assert.equal(run.status, "ready");
  assert.equal(run.stage, "inspect");
  assert.equal(run.input.kind, "source");
  assert.notEqual(run.input, input);
  assert.deepEqual(run.snapshots, []);
  assert.ok(Object.isFrozen(run.snapshots));
  assert.throws(() => run.snapshots.push({}), TypeError);
});

test("runs injected stages, retains outputs, and reports a successful readback", async () => {
  const run = createAgentRun(input, dependencies());
  const result = await runAgentPipeline(run);
  assert.equal(result.status, "completed");
  assert.equal(result.stage, "readback");
  assert.equal(result.renderResult.renderId, "render-1");
  assert.equal(result.ir.nodes[0].id, "input");
  assert.equal(result.figurePlan.nodes[0].sourceNodeId, "input");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.snapshots.map((snapshot) => snapshot.stage), ["inspect", "extract", "normalize", "plan", "render", "readback"]);
  assert.deepEqual(run.snapshots, []);
  assert.equal(run.status, "ready");
});

test("resumes after confirmation from the latest valid snapshot without rerunning earlier stages", async () => {
  const calls = [];
  const run = createAgentRun(input, dependencies({
    inspect: async (value) => { calls.push("inspect"); return { source: value.source }; },
    extract: (value) => { calls.push("extract"); return { ...value, nodes: [{ id: "opaque", family: "custom" }] }; },
    normalize: (value) => { calls.push("normalize"); return { ...value, nodes: [{ id: "confirmed", family: "input" }] }; },
    plan: (value) => { calls.push("plan"); return { figurePlan: { nodes: [{ id: "confirmed", sourceNodeId: "confirmed" }], edges: [] }, ir: value }; },
    render: undefined,
    readback: undefined,
  }));
  const paused = await runAgentPipeline(run);
  assert.equal(paused.status, "needs-confirmation");

  const confirmed = resumeAgentRun(paused, { type: "confirm", value: { accepted: true } });
  assert.equal(confirmed.status, "confirmed");
  const resumed = await continueAgentRun(confirmed);

  assert.equal(resumed.status, "completed");
  assert.deepEqual(calls, ["inspect", "extract", "normalize", "plan"]);
  assert.deepEqual(resumed.snapshots.map((snapshot) => snapshot.stage), ["inspect", "extract", "normalize", "plan"]);
  assert.equal(resumed.ir.nodes[0].id, "confirmed");
});

test("rejecting confirmation does not continue the pipeline", async () => {
  const run = createAgentRun(input, dependencies({
    extract: () => ({ nodes: [{ id: "opaque", family: "custom" }] }),
    plan: () => { throw new Error("plan must not run after rejection"); },
  }));
  const paused = await runAgentPipeline(run);
  const rejected = resumeAgentRun(paused, { type: "confirm", value: { accepted: false } });

  assert.equal(rejected.status, "confirmation-rejected");
  assert.equal(rejected.stage, "extract");
  assert.equal(rejected.figurePlan, undefined);
});

test("external vision waits without normalizing or planning a placeholder", async () => {
  const run = createAgentRun({ kind: "image", images: [{ name: "paper.png" }] }, {
    inspect: (value) => value,
    extract: () => ({ status: "needs_external_vision", diagnostics: [{ kind: "vision-analyzer-required" }] }),
    normalize: () => { throw new Error("normalize must not run while vision is pending"); },
    plan: () => { throw new Error("plan must not run while vision is pending"); },
  });
  const result = await runAgentPipeline(run);

  assert.equal(result.status, "needs_external_vision");
  assert.equal(result.stage, "extract");
  assert.equal(result.figurePlan, undefined);
  assert.deepEqual(result.snapshots.map((snapshot) => snapshot.stage), ["inspect", "extract"]);
});

test("stops with structured diagnostics when extraction or normalization fails", async () => {
  const extractRun = createAgentRun(input, dependencies({ extract: () => { throw new Error("bad evidence"); } }));
  const extractResult = await runAgentPipeline(extractRun);
  assert.equal(extractResult.status, "extract-failed");
  assert.equal(extractResult.stage, "extract");
  assert.equal(extractResult.diagnostics[0].kind, "extract-failed");

  const normalizeRun = createAgentRun(input, dependencies({ normalize: () => Promise.reject(new Error("bad IR")) }));
  const normalizeResult = await runAgentPipeline(normalizeRun);
  assert.equal(normalizeResult.status, "normalize-failed");
  assert.equal(normalizeResult.stage, "normalize");
  assert.equal(normalizeResult.diagnostics[0].kind, "normalize-failed");
});

test("unresolved evidence stops before rendering and asks for confirmation", async () => {
  let rendered = false;
  const run = createAgentRun(input, dependencies({
    extract: () => ({ nodes: [{ id: "opaque", family: "custom" }], diagnostics: [{ kind: "unresolved-operator" }] }),
    render: () => { rendered = true; return {}; },
  }));
  const result = await runAgentPipeline(run);
  assert.equal(result.status, "needs-confirmation");
  assert.equal(result.stage, "extract");
  assert.equal(rendered, false);
});

test("resume creates a new run and bounds repair attempts without changing source IR", async () => {
  const run = createAgentRun(input, dependencies());
  const result = await runAgentPipeline(run);
  const originalSnapshots = result.snapshots;
  const confirmed = resumeAgentRun(run, { type: "confirm", value: { accepted: true } });
  assert.notEqual(confirmed, run);
  assert.deepEqual(run.snapshots, []);
  assert.notEqual(confirmed.snapshots, originalSnapshots);
  assert.equal(confirmed.status, "confirmed");
  const repaired = resumeAgentRun(confirmed, { type: "repair", value: { reason: "glue" } });
  const repairedAgain = resumeAgentRun(repaired, { type: "repair", value: { reason: "route" } });
  const exhausted = resumeAgentRun(repairedAgain, { type: "repair", value: { reason: "third" } });
  assert.equal(repairedAgain.attempts.repair, 2);
  assert.equal(exhausted.status, "repair-failed");
  assert.equal(exhausted.attempts.repair, 2);
  assert.deepEqual(exhausted.ir, result.ir);
});

test("repair continuation injects a reason-specific Figure Plan and stops after two repairs", async () => {
  const repairedReasons = [];
  let renderCount = 0;
  const run = createAgentRun(input, dependencies({
    repairFigurePlan: (plan, reason) => {
      repairedReasons.push(reason);
      return { ...plan, revision: reason, nodes: plan.nodes.map((node) => ({ ...node, label: reason })) };
    },
    render: (plan) => ({ renderId: `render-${++renderCount}`, figurePlan: plan }),
    readback: (_plan, rendered) => ({ renderId: rendered.renderId, nodes: [{ sourceNodeId: "input" }], connectors: [] }),
  }));
  const first = await runAgentPipeline(run);
  const requested = resumeAgentRun(first, { type: "repair", value: { reason: "glue-mismatch" } });
  const repaired = await continueAgentRun(requested);

  assert.equal(repaired.status, "completed");
  assert.deepEqual(repairedReasons, ["glue-mismatch"]);
  assert.equal(repaired.figurePlan.revision, "glue-mismatch");
  assert.equal(repaired.attempts.repair, 1);

  const second = resumeAgentRun(repaired, { type: "repair", value: { reason: "route-overlap" } });
  const repairedAgain = await continueAgentRun(second);
  assert.equal(repairedAgain.status, "completed");
  assert.deepEqual(repairedReasons, ["glue-mismatch", "route-overlap"]);

  const exhausted = resumeAgentRun(repairedAgain, { type: "repair", value: { reason: "third" } });
  assert.equal(exhausted.status, "repair-failed");
  assert.equal(exhausted.attempts.repair, 2);
});

test("continues from a run restored from the Run Store", async () => {
  const store = createMemoryRunStore();
  const calls = [];
  const stageDependencies = dependencies({
    extract: (value) => { calls.push("extract"); return { ...value, nodes: [{ id: "opaque", family: "custom" }] }; },
    normalize: (value) => { calls.push("normalize"); return { ...value, nodes: [{ id: "restored", family: "input" }] }; },
    plan: (value) => { calls.push("plan"); return { figurePlan: { nodes: [{ id: "restored", sourceNodeId: "restored" }], edges: [] }, ir: value }; },
    render: undefined,
    readback: undefined,
  });
  const original = createAgentRun(input, stageDependencies, { runStore: store });
  const paused = await runAgentPipeline(original);
  const persisted = await store.get(paused.id);
  const restored = { ...persisted, dependencies: stageDependencies };
  const confirmed = resumeAgentRun(restored, { type: "confirm", value: { accepted: true } });
  const resumed = await continueAgentRun(confirmed, { runStore: store });

  assert.equal(resumed.status, "completed");
  assert.deepEqual(calls, ["extract", "normalize", "plan"]);
  assert.equal(resumed.figurePlan.nodes[0].sourceNodeId, "restored");
});

test("diagnoses missing IDs, render ID changes, and connector glue changes", () => {
  const diagnostics = diagnoseReadback(
    { renderId: "r1", nodes: [{ sourceNodeId: "n1" }, { sourceNodeId: "n2" }], edges: [{ sourceEdgeId: "e1", sourceNodeId: "n1", targetNodeId: "n2" }] },
    { renderId: "r2", nodes: [{ sourceNodeId: "n1" }], connectors: [{ sourceEdgeId: "e1", sourceNodeId: "n1", targetNodeId: "wrong" }] },
  );
  assert.deepEqual(diagnostics.map((item) => item.code).sort(), ["glue-mismatch", "missing-connector-id", "missing-source-node-id", "render-id-mismatch"]);
  assert.ok(diagnostics.every((item) => item.kind === "readback-mismatch"));
});

test("persists externally supplied render and readback events", async () => {
  const { createMemoryRunStore } = await import("./run-store.mjs");
  const runStore = createMemoryRunStore();
  const run = createAgentRun(input, dependencies(), { runStore });
  const rendered = resumeAgentRun(run, { type: "render-result", value: { renderId: "r1" } });
  await persistAgentRun(rendered);
  const readback = resumeAgentRun(rendered, { type: "readback-result", value: { renderId: "r1", nodes: [], connectors: [] } });
  await persistAgentRun(readback);
  const stored = await runStore.get(run.id);

  assert.equal(stored.status, "completed");
  assert.equal(stored.stage, "readback");
  assert.deepEqual(stored.snapshots.map((snapshot) => snapshot.stage), ["render", "readback"]);
});

test("render failures and readback mismatches use explicit statuses", async () => {
  const renderRun = createAgentRun(input, dependencies({ render: () => { throw new Error("renderer down"); } }));
  const renderResult = await runAgentPipeline(renderRun);
  assert.equal(renderResult.status, "render-failed");

  const readbackRun = createAgentRun(input, dependencies({
    readback: () => ({ renderId: "wrong", nodes: [], connectors: [] }),
  }));
  const readbackResult = await runAgentPipeline(readbackRun);
  assert.equal(readbackResult.status, "readback-mismatch");
  assert.ok(readbackResult.diagnostics.length > 0);
});
