import { compilePromptToUniversalGraphSpec } from "./prompt-universal-graph-spec.js";
import { PublicationVisualPreviewService, type PublicationVisualPreview } from "./publication-visual-preview-service.js";
import { compileStaticPyTorchSourceToUniversalGraphSpec } from "./static-pytorch-universal-graph-spec.js";
import type { PublicationVisualPlanUpdateIdentity } from "./publication-visual-plan-compiler.js";
import type { UniversalGraphSpec } from "./universal-graph-spec.js";

export type UniversalPreviewInput =
  | { kind: "typed-prompt"; sourceId: string; prompt: string; revision?: number }
  | { kind: "static-pytorch"; sourceId: string; sourceSha256: string; code: string };

export type UniversalInputPublicationPreview = PublicationVisualPreview & {
  readonly ugs: UniversalGraphSpec;
};

export interface UniversalInputPublicationPreviewOptions {
  readonly detail: "overview" | "architecture" | "operator_detail";
  readonly updateIdentity: PublicationVisualPlanUpdateIdentity;
}

/**
 * Compiles supported untrusted inputs through the one renderer-neutral
 * UGS → GPG → PVP preview path. This service does not create a snapshot,
 * export request, native intent, worker call, COM call, or file artifact.
 */
export function compileUniversalInputToPublicationPreview(
  input: UniversalPreviewInput,
  options: UniversalInputPublicationPreviewOptions,
): UniversalInputPublicationPreview {
  const ugs = input.kind === "typed-prompt"
    ? compilePromptToUniversalGraphSpec({
      sourceId: input.sourceId,
      prompt: input.prompt,
      ...(input.revision === undefined ? {} : { revision: input.revision }),
    })
    : compileStaticPyTorchSourceToUniversalGraphSpec({
      sourceId: input.sourceId,
      sourceSha256: input.sourceSha256,
      code: input.code,
    });
  const preview = new PublicationVisualPreviewService().preview({
    ugs,
    detail: options.detail,
    updateIdentity: options.updateIdentity,
  });

  return { ...preview, ugs };
}
