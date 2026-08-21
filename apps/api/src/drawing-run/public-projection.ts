import {
  type DrawingRun,
  type DrawingRunCommand,
  type PublicDrawingRun,
  isDrawingRunArtifactHash,
  isDrawingRunId,
  isDrawingRunStatus,
} from "./contracts.js";
import { failDrawingRun } from "./errors.js";

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

export function projectPublicDrawingRun(state: DrawingRun): PublicDrawingRun {
  if (typeof state !== "object" || state === null
    || !isDrawingRunId(state.runId)
    || !isDrawingRunStatus(state.status)
    || !Number.isSafeInteger(state.revision)
    || state.revision < 0) {
    failDrawingRun("validation");
  }

  let clarification: PublicDrawingRun["clarification"] = null;
  if (state.clarification !== null) {
    if (typeof state.clarification !== "object" || !isDrawingRunArtifactHash(state.clarification.hash)) failDrawingRun("validation");
    clarification = { id: `clarification:${state.clarification.hash}`, prompt: publicClarificationPrompt };
  }
  let preview: PublicDrawingRun["preview"] = null;
  if (state.preview !== null) {
    if (typeof state.preview !== "object" || !isDrawingRunArtifactHash(state.preview.hash)) failDrawingRun("validation");
    preview = { artifactId: `preview:${state.preview.hash}`, hash: state.preview.hash };
  }

  return {
    runId: state.runId,
    revision: state.revision,
    status: state.status,
    allowedActions: [...allowedActionsByStatus[state.status]],
    clarification,
    preview,
  };
}
