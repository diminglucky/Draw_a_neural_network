import { createHash } from "node:crypto";

export interface PreviewArtifactHash { panelId: string; kind: "svg" | "png"; sha256: string; }
export interface CompilerManifest {
  canonicalization: "RFC-8785-JCS";
  architectureIrHash: string;
  figureIntentHash: string;
  componentCompilerVersion: string;
  layoutCompilerVersion: string;
  styleTokenVersion: string;
  layoutSeed: string;
}
export interface VisualQaCheck { id: string; severity: "blocking" | "warning"; passed: boolean; message: string; }
export interface VisualQaResult { status: "pass" | "fail"; checks: VisualQaCheck[]; }
export interface PublicationFigurePanel { panelId: string; title: string; primitives: Array<{ id: string; kind: "shape" | "text" | "line" | "bracket" | "marker"; semanticIds: string[] }>; }
export interface PublicationFigureSet {
  version: 1;
  figureSetId: string;
  draftId: string;
  revision: number;
  panels: PublicationFigurePanel[];
  crossPanelMappings: Array<{ semanticId: string; fromPanelId: string; toPanelId: string }>;
  intentHash: string;
}
export interface PlanSnapshot {
  planId: string;
  draftId: string;
  revision: number;
  figureSet: PublicationFigureSet;
  canonicalPlanBytesSha256: string;
  previewArtifactHashes: PreviewArtifactHash[];
  compilerManifest: CompilerManifest;
  visualQa: VisualQaResult;
  createdAt: string;
  immutable: true;
}
export interface CreatePlanSnapshotInput {
  draftId: string;
  revision: number;
  figureSet: PublicationFigureSet;
  previewArtifactHashes: PreviewArtifactHash[];
  compilerManifest: CompilerManifest;
  visualQa: VisualQaResult;
  createdAt: string;
}

export function createPlanSnapshot(input: CreatePlanSnapshotInput): PlanSnapshot {
  validateInput(input);
  const canonicalPlanBytes = canonicalJson({ figureSet: input.figureSet, compilerManifest: input.compilerManifest });
  const canonicalPlanBytesSha256 = sha256(canonicalPlanBytes);
  const previewIdentitySha256 = sha256(canonicalJson({ canonicalPlanBytesSha256, previewArtifactHashes: input.previewArtifactHashes, visualQa: input.visualQa }));
  const snapshot: PlanSnapshot = {
    planId: `plan-${previewIdentitySha256.slice(0, 32)}`,
    draftId: input.draftId,
    revision: input.revision,
    figureSet: structuredClone(input.figureSet),
    canonicalPlanBytesSha256,
    previewArtifactHashes: structuredClone(input.previewArtifactHashes),
    compilerManifest: structuredClone(input.compilerManifest),
    visualQa: structuredClone(input.visualQa),
    createdAt: input.createdAt,
    immutable: true,
  };
  return deepFreeze(snapshot);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function validateInput(input: CreatePlanSnapshotInput): void {
  requireId(input.draftId, "draftId");
  if (!Number.isSafeInteger(input.revision) || input.revision <= 0) throw new Error("revision must be a positive safe integer");
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("createdAt must be an ISO timestamp");
  if (input.figureSet.version !== 1 || input.figureSet.draftId !== input.draftId || input.figureSet.revision !== input.revision) throw new Error("FigureSet must match snapshot draft and revision");
  requireId(input.figureSet.figureSetId, "figureSet.figureSetId");
  requireDigest(input.figureSet.intentHash, "figureSet.intentHash");
  if (input.figureSet.panels.length === 0) throw new Error("FigureSet requires at least one panel");
  const panelIds = new Set<string>();
  for (const panel of input.figureSet.panels) {
    requireId(panel.panelId, "panel.panelId");
    if (panelIds.has(panel.panelId)) throw new Error("FigureSet panel IDs must be unique");
    panelIds.add(panel.panelId);
    if (!panel.title.trim() || panel.title.length > 256) throw new Error("panel title is invalid");
    const primitiveIds = new Set<string>();
    for (const primitive of panel.primitives) {
      requireId(primitive.id, "primitive.id");
      if (primitiveIds.has(primitive.id)) throw new Error("panel primitive IDs must be unique");
      primitiveIds.add(primitive.id);
      if (!primitive.semanticIds.length || primitive.semanticIds.some((semanticId) => !isId(semanticId))) throw new Error("primitive requires stable semantic IDs");
    }
  }
  for (const mapping of input.figureSet.crossPanelMappings) {
    requireId(mapping.semanticId, "crossPanelMapping.semanticId");
    if (!panelIds.has(mapping.fromPanelId) || !panelIds.has(mapping.toPanelId)) throw new Error("crossPanelMapping references an unknown panel");
  }
  if (input.visualQa.status !== "pass" || input.visualQa.checks.some((check) => check.severity === "blocking" && !check.passed)) throw new Error("PlanSnapshot requires passing visual QA");
  const artifactKeys = new Set<string>();
  const artifactPanels = new Set<string>();
  for (const artifact of input.previewArtifactHashes) {
    if (!panelIds.has(artifact.panelId)) throw new Error("preview artifact references an unknown panel");
    requireDigest(artifact.sha256, "previewArtifact.sha256");
    const key = `${artifact.panelId}:${artifact.kind}`;
    if (artifactKeys.has(key)) throw new Error("preview artifact panel/kind pairs must be unique");
    artifactKeys.add(key);
    artifactPanels.add(artifact.panelId);
  }
  for (const panelId of panelIds) if (!artifactPanels.has(panelId)) throw new Error("each FigureSet panel requires a preview artifact");
  const manifest = input.compilerManifest;
  if (manifest.canonicalization !== "RFC-8785-JCS") throw new Error("unsupported plan canonicalization");
  requireDigest(manifest.architectureIrHash, "compilerManifest.architectureIrHash");
  requireDigest(manifest.figureIntentHash, "compilerManifest.figureIntentHash");
  for (const field of [manifest.componentCompilerVersion, manifest.layoutCompilerVersion, manifest.styleTokenVersion, manifest.layoutSeed]) if (!field.trim() || field.length > 128) throw new Error("compiler manifest contains an invalid value");
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON does not permit non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalValue(record[key])]));
  }
  throw new Error("canonical JSON accepts only JSON values");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isId(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._:-]*$/.test(value) && value.length <= 128;
}

function requireId(value: string, field: string): void {
  if (!isId(value)) throw new Error(`${field} must be a stable identifier`);
}

function requireDigest(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${field} must be a SHA-256 digest`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
