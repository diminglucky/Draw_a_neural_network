import { type DrawingRun, type DrawingRunCommand, type PublicDrawingRun } from "./contracts.js";

const hashPattern = /^[a-f0-9]{64}$/;
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
  awaiting_apply_confirmation: ["request_apply", "cancel", "reject", "fail", "conflict"],
  applying: ["verify_readback", "cancel", "reject", "fail", "conflict"],
  readback_verified: [],
  cancelled: [],
  rejected: [],
  failed: [],
  conflicted: [],
};

export function projectPublicDrawingRun(state: DrawingRun): PublicDrawingRun {
  const clarification = state.clarification !== null && hashPattern.test(state.clarification.hash)
    ? { id: `clarification:${state.clarification.hash}`, prompt: publicClarificationPrompt }
    : null;
  const preview = state.preview !== null && hashPattern.test(state.preview.hash)
    ? { artifactId: `preview:${state.preview.hash}`, hash: state.preview.hash }
    : null;

  return {
    runId: state.runId,
    revision: state.revision,
    status: state.status,
    allowedActions: [...allowedActionsByStatus[state.status]],
    clarification,
    preview,
  };
}
