import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentRun,
  diagnoseReadback,
  resumeAgentRun,
  runAgentPipeline,
} from "./agent-orchestrator.mjs";

const input = { kind: "source", source: "class Net: pass", framework: "pytorch" };

function dependencies(overrides = {}) {
  return {
    inspect: async (value) => ({ source: value.source, evidence: [{ status: "confirmed" }] }),
    extract: (value) => ({ ...value, nodes: [{ id: "input", family: "input" }] }),
    normalize: (value) => ({ ...value, nodes: [{ id: "input", family: "input" }] }),
    plan: (value) => ({ nodes: [{ id: "n1", sourceNodeId: "input" }], edges: [], ir: value }),
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
  assert.deepEqual(run.snapshots.map((snapshot) => snapshot.stage), ["inspect", "extract", "normalize", "plan", "render", "readback"]);
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
  assert.deepEqual(run.snapshots, originalSnapshots);
  assert.equal(confirmed.status, "confirmed");
  const repaired = resumeAgentRun(confirmed, { type: "repair", value: { reason: "glue" } });
  const repairedAgain = resumeAgentRun(repaired, { type: "repair", value: { reason: "route" } });
  const exhausted = resumeAgentRun(repairedAgain, { type: "repair", value: { reason: "third" } });
  assert.equal(repairedAgain.attempts.repair, 2);
  assert.equal(exhausted.status, "repair-failed");
  assert.equal(exhausted.attempts.repair, 2);
  assert.deepEqual(exhausted.ir, result.ir);
});

test("diagnoses missing IDs, render ID changes, and connector glue changes", () => {
  const diagnostics = diagnoseReadback(
    { renderId: "r1", nodes: [{ sourceNodeId: "n1" }, { sourceNodeId: "n2" }], edges: [{ sourceEdgeId: "e1", sourceNodeId: "n1", targetNodeId: "n2" }] },
    { renderId: "r2", nodes: [{ sourceNodeId: "n1" }], connectors: [{ sourceEdgeId: "e1", sourceNodeId: "n1", targetNodeId: "wrong" }] },
  );
  assert.deepEqual(diagnostics.map((item) => item.code).sort(), ["glue-mismatch", "missing-connector-id", "missing-source-node-id", "render-id-mismatch"]);
  assert.ok(diagnostics.every((item) => item.kind === "readback-mismatch"));
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
