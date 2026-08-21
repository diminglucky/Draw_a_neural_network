import { compilePromptToUniversalGraphSpec } from "./prompt-universal-graph-spec.js";
import { PublicationVisualPreviewService, type PublicationVisualPreview } from "./publication-visual-preview-service.js";
import { compileStaticPyTorchSourceToUniversalGraphSpec } from "./static-pytorch-universal-graph-spec.js";
import { digestGenericPlanSnapshotValue } from "./generic-plan-snapshot.js";
import type { BoundedInterpretationRequest } from "./architecture-interpretation-contract.js";
import { architectureInputSourceId } from "./evidence-augmented-ugs-harness.js";
import { interpretEvidenceAugmentedInput } from "./evidence-augmented-ugs-interpreter.js";
import type { PublicationVisualPlanUpdateIdentity } from "./publication-visual-plan-compiler.js";
import type { UniversalGraphSpec } from "./universal-graph-spec.js";

export type UniversalPreviewInput =
  | { kind: "typed-prompt"; sourceId: string; prompt: string; revision?: number }
  | { kind: "static-pytorch"; sourceId: string; sourceSha256: string; code: string };

/**
 * The architecture-description branch is intentionally not routable through
 * the legacy source-bearing preview body. It contains only bounded public
 * evidence and an already-returned proposal, never source or image bytes.
 */
export interface EvidenceBoundArchitectureDescriptionInput {
  readonly kind: "architecture-description";
  readonly request: BoundedInterpretationRequest;
  readonly proposal?: unknown;
  readonly interpreterStatus?: "unavailable" | "timeout" | "invalid";
}

export type UniversalInputCompilationInput = UniversalPreviewInput | EvidenceBoundArchitectureDescriptionInput;

export type UniversalInputPublicationPreview = PublicationVisualPreview & {
  readonly ugs: UniversalGraphSpec;
  readonly interpretation?: {
    readonly requestHash: string;
    readonly proposalHash: string;
    readonly evidenceDigest: string;
    readonly errorCategory: "none" | "unavailable" | "timeout" | "invalid";
  };
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
  input: UniversalInputCompilationInput,
  options: UniversalInputPublicationPreviewOptions,
): UniversalInputPublicationPreview {
  const interpreted = input.kind === "architecture-description" ? interpretationFor(input) : undefined;
  const ugs = input.kind === "typed-prompt"
    ? compilePromptToUniversalGraphSpec({
      sourceId: input.sourceId,
      prompt: input.prompt,
      ...(input.revision === undefined ? {} : { revision: input.revision }),
    })
    : input.kind === "static-pytorch" ? compileStaticPyTorchSourceToUniversalGraphSpec({
      sourceId: input.sourceId,
      sourceSha256: input.sourceSha256,
      code: input.code,
    }) : interpreted!.interpretation.ugs;
  const preview = new PublicationVisualPreviewService().preview({
    ugs,
    detail: options.detail,
    updateIdentity: options.updateIdentity,
  });

  if (!interpreted || input.kind !== "architecture-description") return { ...preview, ugs };
  return {
    ...preview,
    ugs: interpreted!.interpretation.ugs,
    interpretation: {
      requestHash: digestGenericPlanSnapshotValue(input.request),
      proposalHash: interpreted.interpretation.proposalHash,
      evidenceDigest: evidenceDigestFor(input.request, interpreted.interpretation.ugs),
      errorCategory: interpreted.errorCategory,
    },
  };
}

function interpretationFor(input: EvidenceBoundArchitectureDescriptionInput): {
  readonly interpretation: ReturnType<typeof interpretEvidenceAugmentedInput>;
  readonly errorCategory: "none" | "unavailable" | "timeout" | "invalid";
} {
  assertArchitectureDescriptionInput(input);
  const fallback = interpretEvidenceAugmentedInput(input.request, undefined);
  if (input.proposal === undefined || input.interpreterStatus !== undefined) {
    return { interpretation: fallback, errorCategory: input.interpreterStatus ?? "unavailable" };
  }
  try {
    return { interpretation: interpretEvidenceAugmentedInput(input.request, input.proposal), errorCategory: "none" };
  } catch {
    return { interpretation: fallback, errorCategory: "invalid" };
  }
}

function evidenceDigestFor(request: BoundedInterpretationRequest, ugs: UniversalGraphSpec): string {
  const sourceHash = ugs.evidence.find((item) => item.sourceId === architectureInputSourceId(request.requestId))?.sourceHash;
  if (!sourceHash) throw new Error("Architecture interpretation lineage is invalid");
  return sourceHash;
}

function assertArchitectureDescriptionInput(input: EvidenceBoundArchitectureDescriptionInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Architecture description input is invalid");
  for (const key of Object.keys(input)) if (!( ["kind", "request", "proposal", "interpreterStatus"] as const).includes(key as never)) throw new Error("Architecture description input contains an unknown field");
  if (input.interpreterStatus !== undefined && input.interpreterStatus !== "unavailable" && input.interpreterStatus !== "timeout" && input.interpreterStatus !== "invalid") throw new Error("Architecture description interpreter status is invalid");
}
