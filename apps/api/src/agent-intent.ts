export type AgentAction =
  | "analyze_network"
  | "create_figure"
  | "revise_figure"
  | "explain_structure"
  | "render_to_visio"
  | "export_preview";

export type ArtifactKind =
  | "structure_only"
  | "paper_overview"
  | "architecture_detail"
  | "module_detail"
  | "visio_document";

export interface AgentTaskIntent {
  action: AgentAction;
  sourceMode: "text" | "code" | "model" | "sketch" | "reference_image" | "mixed";
  requestedArtifact: ArtifactKind;
  referencesDraftId: string | null;
  userConstraints: {
    orientation: "auto" | "landscape" | "portrait";
    density: "compact" | "standard" | "detailed";
    printMode: "auto" | "color" | "grayscale";
    requiresNativeVisio: boolean;
  };
}

type Attachment = {
  kind: "code" | "image";
  name?: string;
  mimeType?: string;
  data?: string;
};
type IntentInput = {
  message: string;
  attachments: Attachment[];
  draftRef: { draftId: string; revision: number } | null;
};

const explicitConstraints = Symbol("explicitConstraints");

type ExplicitConstraints = {
  orientation: boolean;
  density: boolean;
  printMode: boolean;
  requiresNativeVisio: boolean;
};

type IntentWithMetadata = AgentTaskIntent & { [explicitConstraints]?: ExplicitConstraints };

const hasAny = (message: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(message));

function sourceMode(input: IntentInput): AgentTaskIntent["sourceMode"] {
  const hasCode = input.attachments.some((attachment) => attachment.kind === "code");
  const hasImage = input.attachments.some((attachment) => attachment.kind === "image");
  if (hasCode && hasImage) return "mixed";
  if (hasCode) return "code";
  if (hasImage) return /草图|sketch/i.test(input.message) ? "sketch" : "reference_image";
  return "text";
}

export function parseAgentTaskIntent(input: IntentInput): AgentTaskIntent {
  const message = input.message;
  const asksToDraw = hasAny(message, [/绘制/, /画/, /draw/i, /figure/i]);
  const asksToRenderToVisio = hasAny(message, [/绘制到\s*Visio/i, /渲染到\s*Visio/i, /render\s+(?:it\s+)?to\s+Visio/i, /render_to_visio/i]);
  const asksToExport = hasAny(message, [/导出/, /export/i]);
  const asksToRevise = hasAny(message, [/展开/, /折叠/, /黑白/, /期刊版/, /detail/i, /细节/]);
  const asksToExplain = hasAny(message, [/解释/, /explain/i]);
  const asksToAnalyze = hasAny(message, [/分析/, /analy[sz]e/i]);
  const wantsVisio = hasAny(message, [/Visio/i, /新建文档/]);
  const hasDraft = input.draftRef !== null;

  let action: AgentAction;
  if (asksToRenderToVisio) action = "render_to_visio";
  else if (hasDraft) action = "revise_figure";
  else if (asksToExport) action = "export_preview";
  else if (asksToDraw || wantsVisio) action = "create_figure";
  else if (asksToExplain) action = "explain_structure";
  else if (asksToAnalyze) action = "analyze_network";
  else action = "analyze_network";

  const requiresNativeVisio = wantsVisio;
  const orientation = hasAny(message, [/横向/, /landscape/i])
    ? "landscape"
    : hasAny(message, [/纵向/, /portrait/i]) ? "portrait" : "auto";
  const density = hasAny(message, [/展开/, /detail/i, /细节/])
    ? "detailed"
    : hasAny(message, [/紧凑/, /compact/i]) ? "compact" : "standard";
  const printMode = hasAny(message, [/黑白/, /grayscale/i, /monochrome/i])
    ? "grayscale"
    : hasAny(message, [/彩色/, /color/i]) ? "color" : "auto";
  const requestedArtifact: ArtifactKind = requiresNativeVisio
    ? "visio_document"
    : hasAny(message, [/展开/, /detail/i, /细节/]) ? "architecture_detail"
      : asksToDraw ? "paper_overview" : "structure_only";

  const intent: IntentWithMetadata = {
    action,
    sourceMode: sourceMode(input),
    requestedArtifact,
    referencesDraftId: input.draftRef?.draftId ?? null,
    userConstraints: { orientation, density, printMode, requiresNativeVisio },
  };
  intent[explicitConstraints] = {
    orientation: orientation !== "auto",
    density: density !== "standard",
    printMode: printMode !== "auto",
    requiresNativeVisio,
  };
  return intent;
}

export function mergeAgentTaskIntent(
  userIntent: AgentTaskIntent,
  providerSuggestion: (
    Omit<Partial<AgentTaskIntent>, "action" | "referencesDraftId" | "userConstraints">
    & { userConstraints?: Partial<AgentTaskIntent["userConstraints"]> }
  ) | null | undefined,
): AgentTaskIntent {
  if (!providerSuggestion) return userIntent;

  const user = userIntent as IntentWithMetadata;
  const explicit = user[explicitConstraints] ?? {
    orientation: user.userConstraints.orientation !== "auto",
    density: user.userConstraints.density !== "standard",
    printMode: user.userConstraints.printMode !== "auto",
    requiresNativeVisio: user.userConstraints.requiresNativeVisio,
  };
  const suggestion = providerSuggestion.userConstraints;
  const merged: IntentWithMetadata = {
    ...userIntent,
    sourceMode: providerSuggestion.sourceMode ?? userIntent.sourceMode,
    requestedArtifact: userIntent.userConstraints.requiresNativeVisio
      ? "visio_document"
      : providerSuggestion.requestedArtifact ?? userIntent.requestedArtifact,
    referencesDraftId: userIntent.referencesDraftId,
    userConstraints: {
      orientation: !explicit.orientation && suggestion?.orientation !== undefined
        ? suggestion.orientation : userIntent.userConstraints.orientation,
      density: !explicit.density && suggestion?.density !== undefined
        ? suggestion.density : userIntent.userConstraints.density,
      printMode: !explicit.printMode && suggestion?.printMode !== undefined
        ? suggestion.printMode : userIntent.userConstraints.printMode,
      requiresNativeVisio: userIntent.userConstraints.requiresNativeVisio,
    },
  };
  merged[explicitConstraints] = explicit;
  return merged;
}
