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
  const analysis = analyzeStaticPyTorchSource(input);
  const ir = compileStaticPyTorchToArchitectureIR(analysis);
  return addTopologyCandidateForBlockingAnalysis(projectArchitectureIrV3ToUniversalGraphSpec(ir), analysis);
}

function addTopologyCandidateForBlockingAnalysis(ugs: UniversalGraphSpec, analysis: StaticPyTorchAnalysis): UniversalGraphSpec {
  if (!analysis.unresolved.some((item) => item.severity === "blocking")) return ugs;

  const blockingUnresolved = ugs.unresolved.find((item) => item.severity === "blocking");
  if (!blockingUnresolved || blockingUnresolved.evidenceIds.some((evidenceId) => !ugs.evidence.some((evidence) => evidence.evidenceId === evidenceId))) {
    throw new Error("Cannot mark static PyTorch candidate topology without existing unresolved evidence");
  }

  return {
    ...ugs,
    topologyConfidence: Math.min(ugs.topologyConfidence, 0.5),
    unresolved: [
      ...ugs.unresolved,
      {
        id: "static-pytorch-blocking-analysis",
        scope: "topology",
        severity: "blocking",
        evidenceIds: [...blockingUnresolved.evidenceIds],
      },
    ],
  };
}
