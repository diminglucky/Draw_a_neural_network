import { composeGeneralPublicationGraph } from "../general-publication-graph.js";
import { compilePublicationVisualPlan } from "../publication-visual-plan-compiler.js";
import { evaluatePublicationVisualPlanQa } from "../publication-visual-plan-qa.js";
import type { DrawingWorkflowComposer } from "./langgraph-workflow.js";
import { digestDrawingArtifact, type DrawingArtifactStore } from "../drawing-input/drawing-artifacts.js";

/**
 * Composes only from a Harness-persisted formal UGS. The browser preview has
 * no Visio page binding; the update identity is an artifact scope, not a
 * native document target.
 */
export function createPublicationDrawingWorkflowComposer(artifacts: DrawingArtifactStore): DrawingWorkflowComposer {
  return {
    async compose(input) {
      const ugs = await artifacts.getUgs(input.ownerId, input.ugsHash);
      if (!ugs) throw new Error("Formal UGS is unavailable for composition");
      if (digestDrawingArtifact(ugs) !== input.ugsHash.toLowerCase()) throw new Error("Formal UGS hash does not match its contents");

      const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
      const pvp = compilePublicationVisualPlan({
        ugs,
        graph,
        updateIdentity: {
          ownerId: input.ownerId,
          deviceId: input.deviceId,
          workflowId: input.runId,
          documentId: "browser-preview",
          pageId: "browser-preview",
          expectedRevision: input.revision,
        },
      });
      const qa = evaluatePublicationVisualPlanQa(pvp);
      if (qa.status !== "passed") throw new Error("Formal PVP failed deterministic structural QA");
      await artifacts.putPvp(input.ownerId, pvp.identity.canonicalHash, pvp);
      const qaHash = digestDrawingArtifact(qa);
      await artifacts.putQa(input.ownerId, qaHash, qa);
      return { pvpHash: pvp.identity.canonicalHash, qaHash };
    },
  };
}
