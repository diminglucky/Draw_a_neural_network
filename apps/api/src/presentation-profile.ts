import type { GeneralPublicationGraph } from "./general-publication-graph.js";
import type { PublicationVisualPlan } from "./publication-visual-plan.js";
import type { UniversalGraphSpec } from "./universal-graph-spec.js";

export interface PresentationProfileInput {
  readonly ugs: UniversalGraphSpec;
  readonly graph: GeneralPublicationGraph;
  readonly plan: PublicationVisualPlan;
}

export interface PresentationProfileMatch {
  readonly componentIds: readonly string[];
  readonly relationIds: readonly string[];
}

export interface PresentationStyleToken {
  readonly tokenId: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface PresentationProfileOverlay {
  readonly primitiveStyleTokenIds: readonly { readonly primitiveId: string; readonly styleTokenIds: readonly string[] }[];
  readonly connectorStyleTokenIds: readonly { readonly connectorId: string; readonly styleTokenIds: readonly string[] }[];
  readonly styleTokens: readonly PresentationStyleToken[];
  readonly affectedIds: readonly string[];
}

export interface PresentationProfile {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly match: (input: PresentationProfileInput) => PresentationProfileMatch | null;
  readonly apply: (input: PresentationProfileInput, match: PresentationProfileMatch) => PresentationProfileOverlay;
}

export interface PresentationProfileApplication {
  readonly applicationId: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly affectedIds: readonly string[];
}

export interface PresentationProfileResult {
  readonly plan: PublicationVisualPlan;
  readonly applications: readonly PresentationProfileApplication[];
}
