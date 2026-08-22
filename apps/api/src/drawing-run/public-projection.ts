import type { DrawingRun, DrawingRunCommand, PublicDrawingRun } from "./contracts.js";

const actionsByStatus: Record<DrawingRun["status"], DrawingRunCommand["type"][]> = {
  received: ["accept_input", "cancel"],
  input_accepted: ["begin_analysis", "cancel"],
  analyzing: ["request_interpreter", "record_candidate", "cancel"],
  awaiting_interpreter: ["record_candidate", "cancel"],
  candidate_structure: ["formalize_ugs", "request_clarification", "cancel"],
  awaiting_clarification: ["answer_clarification", "cancel"],
  formal_ugs: ["compose_pvp", "cancel"],
  composing_pvp: ["publish_preview", "cancel"],
  preview_ready: ["discover_page_target", "cancel"],
  awaiting_page_binding: ["bind_page", "cancel"],
  page_bound: ["request_apply", "cancel"],
  awaiting_apply_confirmation: ["request_apply", "cancel"],
  applying: ["verify_readback", "cancel"],
  readback_verified: [],
  cancelled: [],
  rejected: [],
  failed: [],
  conflicted: [],
};

export function projectPublicDrawingRun(state: DrawingRun): PublicDrawingRun {
  return {
    runId: state.runId,
    revision: state.revision,
    status: state.status,
    allowedActions: [...actionsByStatus[state.status]],
    clarification: state.clarification
      ? { id: state.clarification.id, prompt: state.clarification.prompt }
      : null,
    preview: state.preview ? { ...state.preview } : null,
  };
}
