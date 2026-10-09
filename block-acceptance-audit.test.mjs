import assert from "node:assert/strict";
import test from "node:test";

import { blockAcceptanceFixtures } from "./block-acceptance-fixtures.mjs";
import {
  BLOCK_ACCEPTANCE_AUDIT_VERSION,
  evaluateBlockAcceptanceFixture,
  summarizeBlockAcceptanceAudits,
} from "./block-acceptance-audit.mjs";

test("plan-only block acceptance audit validates every fixture", () => {
  const audits = blockAcceptanceFixtures.map((fixture) => evaluateBlockAcceptanceFixture(fixture).audit);
  const summary = summarizeBlockAcceptanceAudits(audits);
  assert.equal(summary.version, BLOCK_ACCEPTANCE_AUDIT_VERSION);
  assert.equal(summary.status, "accepted");
  assert.equal(summary.failed, 0);
  assert.equal(summary.count, blockAcceptanceFixtures.length);
  for (const audit of audits) {
    assert.equal(audit.accepted, true, audit.fixture);
    assert.equal(audit.checks.diagramPlanValid, true, audit.fixture);
    assert.equal(audit.checks.blockIrValid, true, audit.fixture);
    assert.equal(audit.checks.expectedBlocksPresent, true, audit.fixture);
    assert.equal(audit.checks.noErrorDiagnostics, true, audit.fixture);
  }
});

test("plan-only audit hash is stable for the same fixture", () => {
  const fixture = blockAcceptanceFixtures.find((item) => item.name === "graph");
  const first = evaluateBlockAcceptanceFixture(fixture).audit;
  const second = evaluateBlockAcceptanceFixture(fixture).audit;
  assert.equal(first.planHash, second.planHash);
  assert.match(first.planHash, /^[a-f0-9]{16}$/);
});

test("graph fixture keeps the graph input separate from the message-passing block", () => {
  const fixture = blockAcceptanceFixtures.find((item) => item.name === "graph");
  const { audit, result } = evaluateBlockAcceptanceFixture(fixture);
  const graphBlock = result.blockIr.blocks.find((block) => block.kind === "graph-block");
  assert.deepEqual(graphBlock.nodeIds, ["gcn", "gat"]);
  assert.equal(audit.scene.visualQuality.bodyCount, 3);
});
