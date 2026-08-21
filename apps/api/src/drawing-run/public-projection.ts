import {
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunTrustedScope,
  type PublicDrawingRun,
} from "./contracts.js";
import { reconstructDrawingRunState } from "./reducer.js";

const publicClarificationPrompt = "A clarification is required before continuing.";

const allowedActionsByStatus: Readonly<Record<DrawingRun["status"], readonly DrawingRunCommand["type"][]>> = {
  received: ["accept_input", "cancel", "reject", "fail", "conflict"],
  input_accepted: ["begin_analysis", "cancel", "reject", "fail", "conflict"],
  analyzing: ["request_interpreter", "record_candidate", "cancel", "reject", "fail", "conflict"],
  awaiting_interpreter: ["record_candidate", "cancel", "reject", "fail", "conflict"],
  candidate_structure: ["formalize_ugs", "request_clarification", "cancel", "reject", "fail", "conflict"],
  awaiting_clarification: ["answer_clarification", "cancel", "reject", "fail", "conflict"],
  formal_ugs: ["compose_pvp", "cancel", "reject", "fail", "conflict"],
  composing_pvp: ["publish_preview", "cancel", "reject", "fail", "conflict"],
  preview_ready: ["discover_page_target", "cancel", "reject", "fail", "conflict"],
  awaiting_page_binding: ["bind_page", "cancel", "reject", "fail", "conflict"],
  page_bound: ["request_apply", "cancel", "reject", "fail", "conflict"],
  applying: ["verify_readback", "cancel", "reject", "fail", "conflict"],
  readback_verified: [],
  cancelled: [],
  rejected: [],
  failed: [],
  conflicted: [],
};

export function projectPublicDrawingRun(state: DrawingRun, trustedScope: DrawingRunTrustedScope): PublicDrawingRun {
  const safeState = reconstructDrawingRunState(state, trustedScope);

  let clarification: PublicDrawingRun["clarification"] = null;
  if (safeState.clarification !== null) {
    clarification = { id: `clarification:${safeState.clarification.hash}`, prompt: publicClarificationPrompt };
  }
  let preview: PublicDrawingRun["preview"] = null;
  if (safeState.preview !== null) {
    preview = { artifactId: `preview:${safeState.preview.hash}`, hash: safeState.preview.hash };
  }

  return {
    runId: safeState.runId,
    revision: safeState.revision,
    status: safeState.status,
    allowedActions: [...allowedActionsByStatus[safeState.status]],
    clarification,
    preview,
  };
}
