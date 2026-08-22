import { createHash } from "node:crypto";
import { compileStaticPyTorchToArchitectureIR } from "./static-pytorch-ir-compiler.js";
import { analyzeStaticPyTorchSource, type StaticPyTorchAnalysis } from "./static-pytorch-source-analyzer.js";
import { projectArchitectureIrV3ToUniversalGraphSpec } from "./universal-graph-spec-adapter.js";
import type { UniversalGraphSpec } from "./universal-graph-spec.js";

/**
 * Compiles a bounded static PyTorch source descriptor to a UniversalGraphSpec.
 *
 * The analyzer owns source inspection; the static compiler owns candidate
 * handling; and the canonical UGS adapter owns topology and evidence
 * projection. No user source is imported, evaluated, or executed.
 */
export function compileStaticPyTorchSourceToUniversalGraphSpec(input: {
  sourceId: string;
  sourceSha256: string;
  code: string;
}): UniversalGraphSpec {
  if (createHash("sha256").update(input.code, "utf8").digest("hex") !== input.sourceSha256.toLowerCase()) {
    throw new Error("Static PyTorch source digest does not match submitted bytes");
  }
  const analysis = analyzeStaticPyTorchSource(input);
  const ir = compileStaticPyTorchToArchitectureIR(analysis);
  return addTopologyCandidateForBlockingAnalysis(projectArchitectureIrV3ToUniversalGraphSpec(ir), analysis);
}

function addTopologyCandidateForBlockingAnalysis(ugs: UniversalGraphSpec, analysis: StaticPyTorchAnalysis): UniversalGraphSpec {
  if (!analysis.unresolved.some((item) => item.severity === "blocking")) return ugs;

  const blockingUnresolved = ugs.unresolved.filter((item) => item.severity === "blocking");
  if (blockingUnresolved.length === 0 || blockingUnresolved.some((item) => item.evidenceIds.some((evidenceId) => !ugs.evidence.some((evidence) => evidence.evidenceId === evidenceId)))) {
    throw new Error("Cannot mark static PyTorch candidate topology without existing unresolved evidence");
  }

  return {
    ...ugs,
    topologyConfidence: Math.min(ugs.topologyConfidence, 0.5),
    unresolved: [
      ...ugs.unresolved,
      ...blockingUnresolved.map((item) => ({
        id: `static-pytorch-blocking-analysis:${item.id}`,
        scope: "topology" as const,
        severity: "blocking" as const,
        evidenceIds: [...item.evidenceIds],
      })),
    ],
  };
}
