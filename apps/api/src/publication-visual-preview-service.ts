import { compilePublicationVisualPlan, type PublicationVisualPlanUpdateIdentity } from "./publication-visual-plan-compiler.js";
import { composeGeneralPublicationGraph, type GeneralPublicationGraph } from "./general-publication-graph.js";
import { parseUniversalGraphSpec, type UniversalGraphSpec } from "./universal-graph-spec.js";
import type { PublicationVisualPlan } from "./publication-visual-plan.js";

export type PublicationVisualPreview =
  | { kind: "formal"; exportEligible: true; graph: GeneralPublicationGraph; pvp: PublicationVisualPlan }
  | { kind: "candidate"; exportEligible: false; graph: GeneralPublicationGraph; pvp: PublicationVisualPlan };

export class PublicationVisualPreviewService {
  preview(input: { ugs: UniversalGraphSpec; detail: "overview" | "architecture" | "operator_detail"; updateIdentity: PublicationVisualPlanUpdateIdentity }): PublicationVisualPreview {
    const ugs = parseUniversalGraphSpec(input.ugs);
    const graph = composeGeneralPublicationGraph(ugs, { detail: input.detail });
    const pvp = compilePublicationVisualPlan({ ugs, graph, updateIdentity: input.updateIdentity });
    return pvp.eligibility.kind === "formal"
      ? { kind: "formal", exportEligible: true, graph, pvp }
      : { kind: "candidate", exportEligible: false, graph, pvp };
  }
}
