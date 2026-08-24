import {
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunEvent,
  type DrawingRunTrustedScope,
  type PublicDrawingRun,
  type PublicDrawingRunEvent,
} from "./contracts.js";
import { snapshotDrawingRunEvent } from "./event-log.js";
import { reconstructDrawingRunState } from "./reducer.js";

const publicClarificationPrompt = "A clarification is required before continuing.";

const actionsByStatus: Readonly<Record<DrawingRun["status"], readonly DrawingRunCommand["type"][]>> = {
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
  awaiting_apply_confirmation: [],
  applying: ["verify_readback", "cancel"],
  readback_verified: [],
  cancelled: [],
  rejected: [],
  failed: [],
  conflicted: [],
};

export function projectPublicDrawingRun(state: DrawingRun): PublicDrawingRun;
export function projectPublicDrawingRun(state: DrawingRun, trustedScope: DrawingRunTrustedScope): PublicDrawingRun;
export function projectPublicDrawingRun(
  state: DrawingRun,
  trustedScopeOrIndex?: DrawingRunTrustedScope | number,
): PublicDrawingRun {
  const trustedScope = typeof trustedScopeOrIndex === "object" && trustedScopeOrIndex !== null
    ? trustedScopeOrIndex
    : undefined;
  const safe = reconstructDrawingRunState(state, trustedScope);
  return {
    runId: safe.runId,
    revision: safe.revision,
    status: safe.status,
    errorCategory: safe.errorCategory,
    allowedActions: [...actionsByStatus[safe.status]],
    clarification: safe.clarification
      ? { id: safe.clarification.id, prompt: publicClarificationPrompt }
      : null,
    preview: safe.preview
      ? { artifactId: safe.preview.artifactId, hash: safe.preview.hash }
      : null,
  };
}

export function projectPublicDrawingRunEvent(event: DrawingRunEvent): PublicDrawingRunEvent {
  const safe = snapshotDrawingRunEvent(event);
  return {
    eventId: safe.eventId,
    runId: safe.runId,
    revision: safe.revision,
    status: safe.status,
    action: safe.action,
    errorCategory: safe.errorCategory,
    occurredAt: safe.occurredAt,
  };
}
