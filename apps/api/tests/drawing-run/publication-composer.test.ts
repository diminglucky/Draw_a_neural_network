import { describe, expect, it } from "vitest";
import { createPublicationDrawingWorkflowComposer } from "../../src/drawing-run/publication-composer.js";
import { digestDrawingArtifact, InMemoryDrawingArtifactStore } from "../../src/drawing-input/drawing-artifacts.js";
import type { UniversalGraphSpec } from "../../src/universal-graph-spec.js";

const ugs: UniversalGraphSpec = {
  version: 1,
  graphId: "graph:linear",
  revision: 1,
  sourceIds: ["source:typed-declaration"],
  sourceHashes: ["a".repeat(64)],
  nodes: [
    { nodeId: "node:n:1", kind: "input", label: "Input", semanticHints: [], inputPortIds: [], outputPortIds: ["port:p:1"], attributes: {}, shapeClaim: "unknown", operationKnowledge: "known", evidenceIds: ["evidence:e:1"] },
    { nodeId: "node:n:2", kind: "output", label: "Output", semanticHints: [], inputPortIds: ["port:p:2"], outputPortIds: [], attributes: {}, shapeClaim: "unknown", operationKnowledge: "known", evidenceIds: ["evidence:e:2"] },
  ],
  ports: [
    { portId: "port:p:1", nodeId: "node:n:1", direction: "output", label: null, representation: null, semanticType: null, evidenceIds: ["evidence:e:1"] },
    { portId: "port:p:2", nodeId: "node:n:2", direction: "input", label: null, representation: null, semanticType: null, evidenceIds: ["evidence:e:2"] },
  ],
  edges: [{ edgeId: "edge:e:1", sourcePortId: "port:p:1", targetPortId: "port:p:2", relation: "data", knowledge: "proven", evidenceIds: ["evidence:e:1"] }],
  groups: [],
  evidence: [
    { evidenceId: "evidence:e:1", sourceId: "source:typed-declaration", sourceHash: "a".repeat(64), locator: "section:1", excerptDigest: "1".repeat(64) },
    { evidenceId: "evidence:e:2", sourceId: "source:typed-declaration", sourceHash: "a".repeat(64), locator: "section:2", excerptDigest: "2".repeat(64) },
  ],
  topologyConfidence: 1,
  unresolved: [],
};

describe("Drawing Run publication composer", () => {
  it("compiles and stores a real formal PVP and QA result", async () => {
    const artifacts = new InMemoryDrawingArtifactStore();
    const ugsHash = digestDrawingArtifact(ugs);
    await artifacts.putUgs("owner-1", ugsHash, ugs);
    const result = await createPublicationDrawingWorkflowComposer(artifacts).compose({ runId: "run-1", ownerId: "owner-1", deviceId: "device-1", revision: 4, ugsHash });

    expect(result.pvpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.qaHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await artifacts.getPvp("owner-1", result.pvpHash))?.eligibility).toMatchObject({ kind: "formal", qaStatus: "pending" });
    expect(await artifacts.getQa("owner-1", result.qaHash)).toMatchObject({ status: "passed", planHash: result.pvpHash });
    expect(await artifacts.getPvp("owner-2", result.pvpHash)).toBeNull();
  });
});
