import { compilePromptToUniversalGraphSpec } from "./prompt-universal-graph-spec.js";
import { PublicationVisualPreviewService, type PublicationVisualPreview } from "./publication-visual-preview-service.js";
import { compileStaticPyTorchSourceToUniversalGraphSpec } from "./static-pytorch-universal-graph-spec.js";
import { digestGenericPlanSnapshotValue } from "./generic-plan-snapshot.js";
import type { ArchitectureInterpreter, BoundedInterpretationRequest } from "./architecture-interpretation-contract.js";
import { interpretEvidenceAugmentedInput, requestEvidenceAugmentedProposal } from "./evidence-augmented-ugs-interpreter.js";
import type { PublicationVisualPlanUpdateIdentity } from "./publication-visual-plan-compiler.js";
import type { UniversalGraphSpec } from "./universal-graph-spec.js";

export type UniversalPreviewInput =
  | { kind: "typed-prompt"; sourceId: string; prompt: string; revision?: number }
  | { kind: "static-pytorch"; sourceId: string; sourceSha256: string; code: string }
  | EvidenceBoundArchitectureDescriptionInput;

/** The existing v4 HTTP route deliberately admits only source-bearing inputs. */
export type LegacyUniversalPreviewInput = Exclude<UniversalPreviewInput, EvidenceBoundArchitectureDescriptionInput>;

/**
 * The architecture-description branch is intentionally not routable through
 * the legacy source-bearing preview body. It contains only bounded public
 * evidence and an already-returned proposal, never source or image bytes.
 */
export interface EvidenceBoundArchitectureDescriptionInput {
  readonly kind: "architecture-description";
  readonly request: BoundedInterpretationRequest;
  readonly proposal?: unknown;
}

export type UniversalInputCompilationInput = UniversalPreviewInput;

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
  if (input.kind === "architecture-description") return compileArchitectureDescription(input, options);
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
  const preview = new PublicationVisualPreviewService().preview({ ugs, detail: options.detail, updateIdentity: options.updateIdentity });
  return { ...preview, ugs };
}

/** Invokes an optional interpreter only through the Harness-validated request boundary. */
export async function compileArchitectureDescriptionWithInterpreter(
  input: { readonly request: BoundedInterpretationRequest; readonly interpreter?: ArchitectureInterpreter; readonly timeoutMilliseconds?: number },
  options: UniversalInputPublicationPreviewOptions,
): Promise<UniversalInputPublicationPreview> {
  const attempt = await requestEvidenceAugmentedProposal(input.request, input.interpreter, input.timeoutMilliseconds);
  return compileArchitectureDescription(
    attempt.status === "available" ? { kind: "architecture-description", request: input.request, proposal: attempt.proposal } : { kind: "architecture-description", request: input.request },
    options,
    attempt.status === "available" ? undefined : attempt.status,
  );
}

function compileArchitectureDescription(
  input: EvidenceBoundArchitectureDescriptionInput,
  options: UniversalInputPublicationPreviewOptions,
  failureCategory?: "unavailable" | "timeout" | "invalid",
): UniversalInputPublicationPreview {
  const interpreted = interpretationFor(input, failureCategory);
  const ugs = interpreted.interpretation.ugs;
  const preview = new PublicationVisualPreviewService().preview({ ugs, detail: options.detail, updateIdentity: options.updateIdentity });
  return {
    ...preview,
    ugs,
    interpretation: {
      requestHash: digestGenericPlanSnapshotValue(input.request),
      proposalHash: interpreted.interpretation.proposalHash,
      evidenceDigest: interpreted.interpretation.evidenceDigest,
      errorCategory: interpreted.errorCategory,
    },
  };
}

function interpretationFor(
  input: EvidenceBoundArchitectureDescriptionInput,
  failureCategory?: "unavailable" | "timeout" | "invalid",
): {
  readonly interpretation: ReturnType<typeof interpretEvidenceAugmentedInput>;
  readonly errorCategory: "none" | "unavailable" | "timeout" | "invalid";
} {
  assertArchitectureDescriptionInput(input);
  const fallback = interpretEvidenceAugmentedInput(input.request, undefined);
  if (input.proposal === undefined) return { interpretation: fallback, errorCategory: failureCategory ?? "unavailable" };
  try {
    return { interpretation: interpretEvidenceAugmentedInput(input.request, input.proposal), errorCategory: "none" };
  } catch {
    return { interpretation: fallback, errorCategory: "invalid" };
  }
}

function assertArchitectureDescriptionInput(input: EvidenceBoundArchitectureDescriptionInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Architecture description input is invalid");
  for (const key of Object.keys(input)) if (!( ["kind", "request", "proposal"] as const).includes(key as never)) throw new Error("Architecture description input contains an unknown field");
}
