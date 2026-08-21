import { createHash } from "node:crypto";
import { digestGenericPlanSnapshotValue } from "./generic-plan-snapshot.js";
import { PublicationVisualPreviewService, type PublicationVisualPreview } from "./publication-visual-preview-service.js";
import type { PublicationVisualPlanUpdateIdentity } from "./publication-visual-plan-compiler.js";
import type { PublicationVisualPlan } from "./publication-visual-plan.js";
import { compareCodeUnits } from "./stable-string-order.js";
import { compileUniversalInputToPublicationPreview, type UniversalPreviewInput } from "./universal-input-compilation-service.js";
import { parseUniversalGraphSpec, type UniversalGraphSpec, type UniversalUnresolved } from "./universal-graph-spec.js";

const SESSION_VERSION = "evidence-constrained-drawing-session-1";
const CONFIRM_TOPOLOGY_COMPLETE = "confirm-topology-complete";
const identifier = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const sessionIdentifier = /^session:[a-f0-9]{64}$/;
const clarificationIdentifier = /^clarification:[A-Za-z][A-Za-z0-9:._-]{0,255}$/;
const semanticIdentifier = /^[A-Za-z][A-Za-z0-9:._-]{0,255}$/;

export interface EvidenceConstrainedDrawingSessionOwner {
  readonly ownerId: string;
  readonly deviceId: string;
}

export interface EvidenceConstrainedDrawingSessionUpdateTarget {
  readonly workflowId: string;
  readonly documentId: string;
  readonly pageId: string;
  readonly expectedRevision: number;
}

export interface EvidenceConstrainedDrawingSessionOpenRequest {
  readonly owner: EvidenceConstrainedDrawingSessionOwner;
  readonly input: UniversalPreviewInput;
  readonly detail: "overview" | "architecture" | "operator_detail";
  readonly updateTarget: EvidenceConstrainedDrawingSessionUpdateTarget;
}

export interface EvidenceConstrainedDrawingSessionConfirmation {
  readonly owner: EvidenceConstrainedDrawingSessionOwner;
  readonly sessionId: string;
  readonly expectedRevision: number;
  readonly questionId: string;
  readonly value: typeof CONFIRM_TOPOLOGY_COMPLETE;
}

export interface EvidenceConstrainedDrawingSessionSource {
  readonly kind: UniversalPreviewInput["kind"];
  readonly sourceId: string;
  readonly sourceHash: string;
}

export interface EvidenceConstrainedDrawingSessionClarification {
  readonly questionId: string;
  readonly question: string;
  readonly candidateValues: readonly [typeof CONFIRM_TOPOLOGY_COMPLETE];
  readonly affectedUgsIds: readonly string[];
}

export interface EvidenceConstrainedDrawingSessionPreview {
  readonly kind: "formal" | "candidate";
  readonly exportEligible: false;
  readonly graph: PublicationVisualPreview["graph"];
  readonly pvp: PublicationVisualPlan;
}

export interface EvidenceConstrainedDrawingSessionDelta {
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly affectedUgsIds: readonly string[];
  readonly addedRegionIds: readonly string[];
  readonly removedRegionIds: readonly string[];
  readonly changedRegionIds: readonly string[];
  readonly addedPrimitiveIds: readonly string[];
  readonly removedPrimitiveIds: readonly string[];
  readonly changedPrimitiveIds: readonly string[];
  readonly addedConnectorIds: readonly string[];
  readonly removedConnectorIds: readonly string[];
  readonly changedConnectorIds: readonly string[];
  readonly addedAnnotationIds: readonly string[];
  readonly removedAnnotationIds: readonly string[];
  readonly changedAnnotationIds: readonly string[];
}

export interface EvidenceConstrainedDrawingSession {
  readonly version: typeof SESSION_VERSION;
  readonly sessionId: string;
  readonly revision: number;
  readonly owner: EvidenceConstrainedDrawingSessionOwner;
  readonly detail: EvidenceConstrainedDrawingSessionOpenRequest["detail"];
  readonly updateTarget: EvidenceConstrainedDrawingSessionUpdateTarget;
  readonly sources: readonly EvidenceConstrainedDrawingSessionSource[];
  readonly ugs: UniversalGraphSpec;
  readonly ugsHash: string;
  readonly state: "formal_preview" | "candidate_preview" | "clarification";
  readonly preview?: EvidenceConstrainedDrawingSessionPreview;
  readonly clarification?: EvidenceConstrainedDrawingSessionClarification;
  readonly delta?: EvidenceConstrainedDrawingSessionDelta;
}

/**
 * Opens a deterministic, renderer-neutral Agent drawing session. User input is
 * compiled only through the existing bounded UGS path; no raw source is kept
 * in the returned session and no Snapshot/export/renderer authority is made.
 */
export function openEvidenceConstrainedDrawingSession(input: EvidenceConstrainedDrawingSessionOpenRequest): EvidenceConstrainedDrawingSession {
  assertOpenRequest(input);
  const previewResult = compileUniversalInputToPublicationPreview(input.input, {
    detail: input.detail,
    updateIdentity: updateIdentityFor(input.owner, input.updateTarget),
  });
  const ugs = parseUniversalGraphSpec(previewResult.ugs);
  const ugsHash = digestGenericPlanSnapshotValue(ugs);
  const sources = sourcesFor(input.input, ugs);
  const sessionId = sessionIdentity(input.owner, input.detail, input.updateTarget, ugsHash);
  const blocking = firstBlockingTopologyUnresolved(ugs);

  if (blocking) {
    return freezeSession({
      version: SESSION_VERSION,
      sessionId,
      revision: 1,
      owner: copyOwner(input.owner),
      detail: input.detail,
      updateTarget: copyTarget(input.updateTarget),
      sources,
      ugs,
      ugsHash,
      state: "clarification",
      clarification: clarificationFor(ugs, blocking),
    });
  }

  return freezeSession({
    version: SESSION_VERSION,
    sessionId,
    revision: 1,
    owner: copyOwner(input.owner),
    detail: input.detail,
    updateTarget: copyTarget(input.updateTarget),
    sources,
    ugs,
    ugsHash,
    ...previewState(previewResult),
  });
}

/**
 * Resolves exactly the current session's one blocking topology assertion. The
 * resulting revision remains a renderer-neutral preview with semantic delta.
 */
export function confirmEvidenceConstrainedDrawingSession(
  current: EvidenceConstrainedDrawingSession,
  confirmation: EvidenceConstrainedDrawingSessionConfirmation,
): EvidenceConstrainedDrawingSession {
  assertSessionIntegrity(current);
  assertConfirmation(confirmation);
  if (current.state !== "clarification" || !current.clarification) throw new Error("Drawing session has no clarification to confirm");
  if (!sameOwner(current.owner, confirmation.owner)) throw new Error("Drawing session confirmation owner/device does not match");
  if (current.sessionId !== confirmation.sessionId) throw new Error("Drawing session confirmation session ID does not match");
  if (current.revision !== confirmation.expectedRevision) throw new Error("Drawing session confirmation revision is stale");
  if (current.clarification.questionId !== confirmation.questionId || confirmation.value !== CONFIRM_TOPOLOGY_COMPLETE) {
    throw new Error("Drawing session confirmation does not match the current clarification");
  }

  const blocking = firstBlockingTopologyUnresolved(current.ugs);
  if (!blocking || confirmation.questionId !== clarificationQuestionId(blocking)) throw new Error("Drawing session clarification is not canonical");
  const nextUgs = parseUniversalGraphSpec({
    ...current.ugs,
    revision: current.ugs.revision + 1,
    unresolved: current.ugs.unresolved.filter((item) => item.id !== blocking.id),
  });
  const previewResult = new PublicationVisualPreviewService().preview({
    ugs: nextUgs,
    detail: current.detail,
    updateIdentity: updateIdentityFor(current.owner, current.updateTarget),
  });
  const nextBlocking = firstBlockingTopologyUnresolved(nextUgs);
  const nextSessionId = sessionIdentity(current.owner, current.detail, current.updateTarget, digestGenericPlanSnapshotValue(nextUgs));
  if (nextBlocking) {
    return freezeSession({
      version: SESSION_VERSION,
      sessionId: nextSessionId,
      revision: current.revision + 1,
      owner: copyOwner(current.owner),
      detail: current.detail,
      updateTarget: copyTarget(current.updateTarget),
      sources: copySources(current.sources),
      ugs: nextUgs,
      ugsHash: digestGenericPlanSnapshotValue(nextUgs),
      state: "clarification",
      clarification: clarificationFor(nextUgs, nextBlocking),
    });
  }
  const nextPreview = previewState(previewResult);
  const nextRevision = current.revision + 1;
  return freezeSession({
    version: SESSION_VERSION,
    sessionId: nextSessionId,
    revision: nextRevision,
    owner: copyOwner(current.owner),
    detail: current.detail,
    updateTarget: copyTarget(current.updateTarget),
    sources: copySources(current.sources),
    ugs: nextUgs,
    ugsHash: digestGenericPlanSnapshotValue(nextUgs),
    ...nextPreview,
    delta: deltaFor(current.preview?.pvp, nextPreview.preview.pvp, current.revision, nextRevision, current.clarification.affectedUgsIds),
  });
}

function previewState(preview: PublicationVisualPreview): { state: "formal_preview" | "candidate_preview"; preview: EvidenceConstrainedDrawingSessionPreview } {
  return {
    state: preview.kind === "formal" ? "formal_preview" : "candidate_preview",
    preview: {
      kind: preview.kind,
      exportEligible: false,
      graph: preview.graph,
      pvp: preview.pvp,
    },
  };
}

function clarificationFor(ugs: UniversalGraphSpec, unresolved: UniversalUnresolved): EvidenceConstrainedDrawingSessionClarification {
  return {
    questionId: clarificationQuestionId(unresolved),
    question: "Please confirm that the submitted topology is complete before the Agent draws this region.",
    candidateValues: [CONFIRM_TOPOLOGY_COMPLETE],
    affectedUgsIds: affectedUgsIds(ugs, unresolved),
  };
}

function clarificationQuestionId(unresolved: UniversalUnresolved): string {
  return `clarification:${unresolved.id}`;
}

function firstBlockingTopologyUnresolved(ugs: UniversalGraphSpec): UniversalUnresolved | undefined {
  return [...ugs.unresolved]
    .filter((item) => item.scope === "topology" && item.severity === "blocking")
    .sort((left, right) => compareCodeUnits(left.id, right.id))[0];
}

function affectedUgsIds(ugs: UniversalGraphSpec, unresolved: UniversalUnresolved): string[] {
  const evidenceIds = new Set(unresolved.evidenceIds);
  const portById = new Map(ugs.ports.map((port) => [port.portId, port]));
  const ids = new Set<string>();
  for (const node of ugs.nodes) if (node.evidenceIds.some((id) => evidenceIds.has(id))) ids.add(node.nodeId);
  for (const edge of ugs.edges) {
    if (!edge.evidenceIds.some((id) => evidenceIds.has(id))) continue;
    const source = portById.get(edge.sourcePortId);
    const target = portById.get(edge.targetPortId);
    if (source) ids.add(source.nodeId);
    if (target) ids.add(target.nodeId);
  }
  if (ids.size === 0) for (const node of ugs.nodes) ids.add(node.nodeId);
  return [...ids].sort(compareCodeUnits);
}

function deltaFor(
  previous: PublicationVisualPlan | undefined,
  next: PublicationVisualPlan,
  fromRevision: number,
  toRevision: number,
  affectedUgsIds: readonly string[],
): EvidenceConstrainedDrawingSessionDelta {
  const regions = collectionDelta(previous, next, "regions", "regionId");
  const primitives = collectionDelta(previous, next, "primitives", "primitiveId");
  const connectors = collectionDelta(previous, next, "connectors", "connectorId");
  const annotations = collectionDelta(previous, next, "annotations", "annotationId");
  return {
    fromRevision,
    toRevision,
    affectedUgsIds: [...affectedUgsIds].sort(compareCodeUnits),
    addedRegionIds: regions.added,
    removedRegionIds: regions.removed,
    changedRegionIds: regions.changed,
    addedPrimitiveIds: primitives.added,
    removedPrimitiveIds: primitives.removed,
    changedPrimitiveIds: primitives.changed,
    addedConnectorIds: connectors.added,
    removedConnectorIds: connectors.removed,
    changedConnectorIds: connectors.changed,
    addedAnnotationIds: annotations.added,
    removedAnnotationIds: annotations.removed,
    changedAnnotationIds: annotations.changed,
  };
}

function collectionDelta(
  previous: PublicationVisualPlan | undefined,
  next: PublicationVisualPlan,
  collection: "regions" | "primitives" | "connectors" | "annotations",
  idKey: string,
): { added: string[]; removed: string[]; changed: string[] } {
  const before = valuesById(planCollection(previous, collection), idKey);
  const after = valuesById(planCollection(next, collection), idKey);
  const added = [...after.keys()].filter((id) => !before.has(id)).sort(compareCodeUnits);
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort(compareCodeUnits);
  const changed = [...after.keys()]
    .filter((id) => before.has(id) && digestGenericPlanSnapshotValue(before.get(id)) !== digestGenericPlanSnapshotValue(after.get(id)))
    .sort(compareCodeUnits);
  return { added, removed, changed };
}

function planCollection(plan: PublicationVisualPlan | undefined, collection: "regions" | "primitives" | "connectors" | "annotations"): readonly unknown[] | undefined {
  if (!plan) return undefined;
  const value = (plan as unknown as Record<string, unknown>)[collection];
  if (!Array.isArray(value)) throw new Error("PVP semantic collection is invalid");
  return value;
}

function valuesById(values: readonly unknown[] | undefined, idKey: string): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const value of values ?? []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PVP semantic collection is invalid");
    const id = (value as Record<string, unknown>)[idKey];
    if (typeof id !== "string" || !semanticIdentifier.test(id) || result.has(id)) throw new Error("PVP semantic collection identity is invalid");
    result.set(id, value);
  }
  return result;
}

function sourcesFor(input: UniversalPreviewInput, ugs: UniversalGraphSpec): EvidenceConstrainedDrawingSessionSource[] {
  const sourceHash = input.kind === "static-pytorch" ? input.sourceSha256 : onlyMatchingHash(input.sourceId, ugs);
  if (!ugs.sourceIds.includes(input.sourceId) || !ugs.sourceHashes.includes(sourceHash)) throw new Error("Drawing session input is not represented by canonical UGS provenance");
  return [{ kind: input.kind, sourceId: input.sourceId, sourceHash }];
}

function onlyMatchingHash(sourceId: string, ugs: UniversalGraphSpec): string {
  const hashes = [...new Set(ugs.evidence.filter((item) => item.sourceId === sourceId).map((item) => item.sourceHash))];
  if (hashes.length !== 1) throw new Error("Drawing session source hash is not uniquely bound to its UGS evidence");
  return hashes[0]!;
}

function updateIdentityFor(owner: EvidenceConstrainedDrawingSessionOwner, target: EvidenceConstrainedDrawingSessionUpdateTarget): PublicationVisualPlanUpdateIdentity {
  return { ownerId: owner.ownerId, deviceId: owner.deviceId, ...target };
}

function sessionIdentity(
  owner: EvidenceConstrainedDrawingSessionOwner,
  detail: EvidenceConstrainedDrawingSessionOpenRequest["detail"],
  target: EvidenceConstrainedDrawingSessionUpdateTarget,
  ugsHash: string,
): string {
  return `session:${sha256(JSON.stringify({ version: SESSION_VERSION, ownerId: owner.ownerId, deviceId: owner.deviceId, detail, target, ugsHash }))}`;
}

function assertOpenRequest(input: EvidenceConstrainedDrawingSessionOpenRequest): void {
  assertExactKeys(input, ["owner", "input", "detail", "updateTarget"], "drawing session request");
  assertOwner(input.owner, "drawing session owner");
  assertTarget(input.updateTarget);
  if (!( ["overview", "architecture", "operator_detail"] as const).includes(input.detail)) throw new Error("Drawing session detail is invalid");
  assertInput(input.input);
}

function assertConfirmation(input: EvidenceConstrainedDrawingSessionConfirmation): void {
  assertExactKeys(input, ["owner", "sessionId", "expectedRevision", "questionId", "value"], "drawing session confirmation");
  assertOwner(input.owner, "drawing session confirmation owner");
  assertSessionId(input.sessionId, "drawing session confirmation sessionId");
  assertClarificationId(input.questionId, "drawing session confirmation questionId");
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision <= 0) throw new Error("Drawing session confirmation revision is invalid");
  if (input.value !== CONFIRM_TOPOLOGY_COMPLETE) throw new Error("Drawing session confirmation value is invalid");
}

function assertSessionIntegrity(session: EvidenceConstrainedDrawingSession): void {
  assertExactKeys(session, ["version", "sessionId", "revision", "owner", "detail", "updateTarget", "sources", "ugs", "ugsHash", "state", "preview", "clarification", "delta"], "drawing session");
  if (session.version !== SESSION_VERSION || !sessionIdentifier.test(session.sessionId) || !Number.isInteger(session.revision) || session.revision <= 0) throw new Error("Drawing session identity is invalid");
  assertOwner(session.owner, "drawing session owner");
  assertTarget(session.updateTarget);
  if (!( ["overview", "architecture", "operator_detail"] as const).includes(session.detail)) throw new Error("Drawing session detail is invalid");
  if (!( ["formal_preview", "candidate_preview", "clarification"] as const).includes(session.state)) throw new Error("Drawing session state is invalid");
  const ugs = parseUniversalGraphSpec(session.ugs);
  if (session.ugsHash !== digestGenericPlanSnapshotValue(ugs)) throw new Error("Drawing session UGS hash is invalid");
  if (session.sessionId !== sessionIdentity(session.owner, session.detail, session.updateTarget, session.ugsHash)) throw new Error("Drawing session identity does not match its canonical UGS");
  assertSources(session.sources, ugs);
  if (session.state === "clarification") {
    if (session.preview !== undefined || !session.clarification) throw new Error("Drawing session clarification state is invalid");
  } else if (!session.preview || session.clarification !== undefined || session.preview.kind !== (session.state === "formal_preview" ? "formal" : "candidate")) {
    throw new Error("Drawing session preview state is invalid");
  }
}

function assertInput(input: UniversalPreviewInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Drawing session input is invalid");
  if (input.kind === "typed-prompt") {
    assertExactKeys(input, ["kind", "sourceId", "prompt", "revision"], "typed prompt input");
    assertIdentifier(input.sourceId, "typed prompt sourceId");
    if (typeof input.prompt !== "string" || input.prompt.length === 0) throw new Error("Typed prompt is invalid");
    return;
  }
  if (input.kind === "static-pytorch") {
    assertExactKeys(input, ["kind", "sourceId", "sourceSha256", "code"], "static source input");
    assertIdentifier(input.sourceId, "static source sourceId");
    if (!/^[a-f0-9]{64}$/i.test(input.sourceSha256) || typeof input.code !== "string" || input.code.length === 0) throw new Error("Static source input is invalid");
    if (input.sourceSha256.toLowerCase() !== sha256(input.code)) throw new Error("Static source digest does not match submitted bytes");
    return;
  }
  throw new Error("Drawing session input kind is invalid");
}

function assertOwner(owner: EvidenceConstrainedDrawingSessionOwner, location: string): void {
  assertExactKeys(owner, ["ownerId", "deviceId"], location);
  assertIdentifier(owner.ownerId, `${location} ownerId`);
  assertIdentifier(owner.deviceId, `${location} deviceId`);
}

function assertTarget(target: EvidenceConstrainedDrawingSessionUpdateTarget): void {
  assertExactKeys(target, ["workflowId", "documentId", "pageId", "expectedRevision"], "drawing session update target");
  assertIdentifier(target.workflowId, "drawing session workflowId");
  assertIdentifier(target.documentId, "drawing session documentId");
  assertIdentifier(target.pageId, "drawing session pageId");
  if (!Number.isInteger(target.expectedRevision) || target.expectedRevision <= 0) throw new Error("Drawing session expected revision is invalid");
}

function assertExactKeys(value: unknown, allowed: readonly string[], location: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${location} contains an unknown field`);
}

function assertIdentifier(value: unknown, location: string): asserts value is string {
  if (typeof value !== "string" || !identifier.test(value)) throw new Error(`${location} is invalid`);
}

function assertSessionId(value: unknown, location: string): asserts value is string {
  if (typeof value !== "string" || !sessionIdentifier.test(value)) throw new Error(`${location} is invalid`);
}

function assertClarificationId(value: unknown, location: string): asserts value is string {
  if (typeof value !== "string" || !clarificationIdentifier.test(value)) throw new Error(`${location} is invalid`);
}

function copyOwner(owner: EvidenceConstrainedDrawingSessionOwner): EvidenceConstrainedDrawingSessionOwner {
  return { ownerId: owner.ownerId, deviceId: owner.deviceId };
}

function copyTarget(target: EvidenceConstrainedDrawingSessionUpdateTarget): EvidenceConstrainedDrawingSessionUpdateTarget {
  return { workflowId: target.workflowId, documentId: target.documentId, pageId: target.pageId, expectedRevision: target.expectedRevision };
}

function copySources(sources: readonly EvidenceConstrainedDrawingSessionSource[]): EvidenceConstrainedDrawingSessionSource[] {
  return sources.map((source) => ({ kind: source.kind, sourceId: source.sourceId, sourceHash: source.sourceHash }));
}

function assertSources(sources: unknown, ugs: UniversalGraphSpec): asserts sources is readonly EvidenceConstrainedDrawingSessionSource[] {
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > ugs.sourceIds.length) throw new Error("Drawing session sources are invalid");
  const actualSourceIds: string[] = [];
  for (const source of sources) {
    assertExactKeys(source, ["kind", "sourceId", "sourceHash"], "drawing session source");
    if (source.kind !== "typed-prompt" && source.kind !== "static-pytorch") throw new Error("Drawing session source kind is invalid");
    assertIdentifier(source.sourceId, "drawing session sourceId");
    if (typeof source.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(source.sourceHash)) throw new Error("Drawing session source hash is invalid");
    if (!ugs.sourceIds.includes(source.sourceId) || !ugs.sourceHashes.includes(source.sourceHash)) throw new Error("Drawing session source does not match UGS provenance");
    actualSourceIds.push(source.sourceId);
  }
  if (new Set(actualSourceIds).size !== actualSourceIds.length) throw new Error("Drawing session source IDs are duplicated");
}

function sameOwner(left: EvidenceConstrainedDrawingSessionOwner, right: EvidenceConstrainedDrawingSessionOwner): boolean {
  return left.ownerId === right.ownerId && left.deviceId === right.deviceId;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function freezeSession(session: EvidenceConstrainedDrawingSession): EvidenceConstrainedDrawingSession {
  return deepFreeze(structuredClone(session));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
