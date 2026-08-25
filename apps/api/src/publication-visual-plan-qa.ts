import { parsePublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";

const QA_VERSION = "pvp-qa-1" as const;

export interface PublicationVisualPlanQaCheck {
  readonly code: string;
  readonly status: "passed" | "failed";
  readonly objectIds: readonly string[];
}

export interface PublicationVisualPlanQaResult {
  readonly qaVersion: typeof QA_VERSION;
  readonly status: "passed" | "failed";
  readonly planHash: string;
  readonly checks: readonly PublicationVisualPlanQaCheck[];
}

/**
 * Performs deterministic structural checks on the canonical PVP. This does
 * not alter `qaStatus`: a later trusted review/binding step owns promotion to
 * an immutable formal artifact.
 */
export function evaluatePublicationVisualPlanQa(input: PublicationVisualPlan): PublicationVisualPlanQaResult {
  const plan = parsePublicationVisualPlan(input);
  const primitives = plan.primitives.map((value) => asRecord(value));
  const connectors = plan.connectors.map((value) => asRecord(value));
  const ports = plan.ports.map((value) => asRecord(value));
  const groups = (plan.primitiveGroups as unknown[]).map((value) => asRecordOrNull(value));
  const mappings = plan.sourceMappings.map((value) => asRecord(value));
  const annotations = (plan.annotations as unknown[]).map((value) => asRecordOrNull(value));
  const page = asBounds((plan.coordinateSpace as Record<string, unknown>).page);
  const primitiveById = new Map(primitives.map((primitive) => [String(primitive.primitiveId), primitive]));
  const checks: PublicationVisualPlanQaCheck[] = [];
  const candidateVisualPrimitiveIds = primitives.filter(hasCandidateVisualSemantics).map((primitive) => String(primitive.primitiveId));
  const legacyCandidatePrimitiveIds = primitives.filter((primitive) => primitive.kind === "CandidateRegion").map((primitive) => String(primitive.primitiveId));
  const candidateSemanticsPresent = candidateVisualPrimitiveIds.length > 0;

  checks.push(check("eligibility-formal", plan.eligibility.kind === "formal" && plan.eligibility.blockingReasons.length === 0 && !candidateSemanticsPresent, candidateSemanticsPresent ? candidateVisualPrimitiveIds : []));
  checks.push(check("candidate-export-eligibility", !candidateSemanticsPresent && plan.eligibility.kind !== "candidate", candidateSemanticsPresent ? candidateVisualPrimitiveIds : plan.eligibility.kind === "candidate" ? [plan.identity.planId] : []));
  checks.push(check("candidate-region", legacyCandidatePrimitiveIds.length === 0, legacyCandidatePrimitiveIds));
  checks.push(check("candidate-visual-semantics", candidateVisualPrimitiveIds.length === 0, candidateVisualPrimitiveIds));
  checks.push(check("duplicate-ids", uniqueIds(primitives, "primitiveId") && uniqueIds(ports, "portId") && uniqueIds(connectors, "connectorId"), []));
  checks.push(check("feedback-connector", !connectors.some((connector) => connector.relation === "feedback"), connectors.filter((connector) => connector.relation === "feedback").map((connector) => String(connector.connectorId))));

  const collidingPrimitiveIds: string[] = [];
  for (let left = 0; left < primitives.length; left += 1) {
    for (let right = left + 1; right < primitives.length; right += 1) {
      const first = primitives[left]!;
      const second = primitives[right]!;
      if (overlaps(asBounds(first.bounds), asBounds(second.bounds))) collidingPrimitiveIds.push(String(first.primitiveId), String(second.primitiveId));
    }
  }
  checks.push(check("primitive-collision", collidingPrimitiveIds.length === 0, collidingPrimitiveIds));

  const semanticPrimitives = primitives.filter((primitive) => visualRole(primitive) !== "base");
  const semanticOverlapIds: string[] = [];
  for (let left = 0; left < semanticPrimitives.length; left += 1) {
    for (let right = left + 1; right < semanticPrimitives.length; right += 1) {
      if (overlaps(asBounds(semanticPrimitives[left]!.bounds), asBounds(semanticPrimitives[right]!.bounds))) semanticOverlapIds.push(String(semanticPrimitives[left]!.primitiveId), String(semanticPrimitives[right]!.primitiveId));
    }
  }
  checks.push(check("semantic-overlap", semanticOverlapIds.length === 0, semanticOverlapIds));

  const containmentIds: string[] = [];
  for (const group of groups) {
    if (!group || typeof group.groupId !== "string") { containmentIds.push("unknown"); continue; }
    if (!Array.isArray(group.primitiveIds) || group.primitiveIds.length === 0 || group.primitiveIds.some((id) => typeof id !== "string" || !primitiveById.has(id))) containmentIds.push(group.groupId);
  }
  checks.push(check("semantic-containment", containmentIds.length === 0, containmentIds));

  const invalidTensorIds = primitives.filter((primitive) => primitive.kind === "TensorVolume" && !validTensorGeometry(primitive)).map((primitive) => String(primitive.primitiveId));
  checks.push(check("tensor-volume-depth-geometry", invalidTensorIds.length === 0, invalidTensorIds));
  const invalidTokenIds = primitives.filter((primitive) => primitive.kind === "AttentionTokenStrip" && !validTokenCells(primitive)).map((primitive) => String(primitive.primitiveId));
  checks.push(check("token-cell-order", invalidTokenIds.length === 0, invalidTokenIds));

  const invalidMergeIds = primitives.filter((primitive) => (primitive.kind === "AddMarker" || primitive.kind === "ConcatMarker") && !hasDistinctMergeInputs(primitive, ports)).map((primitive) => String(primitive.primitiveId));
  checks.push(check("merge-distinct-input-ports", invalidMergeIds.length === 0, invalidMergeIds));

  const nonOrthogonalConnectorIds: string[] = [];
  const escapedConnectorIds: string[] = [];
  for (const connector of connectors) {
    const connectorId = String(connector.connectorId);
    const route = Array.isArray(connector.route) ? connector.route.map(asPointOrNull) : [];
    if (route.length < 2 || route.some((point) => point === null || !contains(page, { x: point!.x, y: point!.y, width: 0, height: 0 }))) escapedConnectorIds.push(connectorId);
    if (route.some((point, index) => index > 0 && point && route[index - 1] && point.x !== route[index - 1]!.x && point.y !== route[index - 1]!.y)) nonOrthogonalConnectorIds.push(connectorId);
  }
  checks.push(check("connector-page-bounds", escapedConnectorIds.length === 0, escapedConnectorIds));
  checks.push(check("connector-orthogonal", nonOrthogonalConnectorIds.length === 0, nonOrthogonalConnectorIds));
  checks.push(check("connector-route-failure", escapedConnectorIds.length === 0 && nonOrthogonalConnectorIds.length === 0, [...escapedConnectorIds, ...nonOrthogonalConnectorIds]));

  const uncoveredPrimitiveIds = primitives
    .filter((primitive) => {
      const mapping = mappings.find((item) => item.visualId === primitive.primitiveId);
      return !mapping || !nonEmptyStringArray(mapping.ugsIds);
    })
    .map((primitive) => String(primitive.primitiveId));
  checks.push(check("source-mapping-coverage", uncoveredPrimitiveIds.length === 0, uncoveredPrimitiveIds));
  checks.push(check("unmapped-primitive", uncoveredPrimitiveIds.length === 0, uncoveredPrimitiveIds));

  const symbolOnlyKinds = new Set(["SplitMarker", "AddMarker", "ConcatMarker", "AttentionRelation"]);
  const clippedPrimitiveIds = primitives
    .filter((primitive) => !symbolOnlyKinds.has(String(primitive.kind)))
    .filter((primitive) => typeof primitive.label !== "string" || primitive.label.length * 12 > asBounds(primitive.bounds).width)
    .map((primitive) => String(primitive.primitiveId));
  checks.push(check("label-clipping", clippedPrimitiveIds.length === 0, clippedPrimitiveIds));

  const invalidAnnotationIds: string[] = [];
  const validAnnotations: Array<{ id: string; bounds: Bounds }> = [];
  for (const annotation of annotations) {
    if (!annotation || typeof annotation.annotationId !== "string" || typeof annotation.text !== "string") {
      invalidAnnotationIds.push(annotation && typeof annotation.annotationId === "string" ? annotation.annotationId : "unknown");
      continue;
    }
    const annotationBounds = tryBounds(annotation.bounds);
    if (!annotationBounds || !contains(page, annotationBounds)) {
      invalidAnnotationIds.push(annotation.annotationId);
      continue;
    }
    validAnnotations.push({ id: annotation.annotationId, bounds: annotationBounds });
  }
  checks.push(check("annotation-bounds", invalidAnnotationIds.length === 0, invalidAnnotationIds));

  const overlappingAnnotationIds: string[] = [];
  for (let left = 0; left < validAnnotations.length; left += 1) {
    for (let right = left + 1; right < validAnnotations.length; right += 1) {
      const first = validAnnotations[left]!;
      const second = validAnnotations[right]!;
      if (overlaps(first.bounds, second.bounds)) overlappingAnnotationIds.push(first.id, second.id);
    }
  }
  checks.push(check("annotation-overlap", overlappingAnnotationIds.length === 0, overlappingAnnotationIds));

  const annotationPrimitiveCollisionIds = validAnnotations.flatMap((annotation) => [...primitiveById.values()]
    .filter((primitive) => overlaps(annotation.bounds, asBounds(primitive.bounds)))
    .flatMap((primitive) => [annotation.id, String(primitive.primitiveId)]));
  checks.push(check("annotation-primitive-collision", annotationPrimitiveCollisionIds.length === 0, annotationPrimitiveCollisionIds));

  const knownStyleTokenIds = styleTokenIds(plan.styleTokens);
  const unknownStyleReferences = [
    ...primitives,
    ...connectors,
    ...annotations.filter((value): value is Record<string, unknown> => value !== null),
  ].flatMap((item) => styleReferences(item)
    .filter((tokenId) => !knownStyleTokenIds.has(tokenId))
    .map((tokenId) => `${String(item.primitiveId ?? item.connectorId ?? item.annotationId)}:${tokenId}`));
  checks.push(check("style-token-reference", unknownStyleReferences.length === 0, unknownStyleReferences));

  const styleById = styleTokenValues(plan.styleTokens);
  const grayscaleByRole = new Map<string, string>();
  const grayscaleCollisionIds: string[] = [];
  for (const primitive of primitives) {
    const role = visualRole(primitive);
    if (role === "base") continue;
    for (const tokenId of styleReferences(primitive)) {
      const fill = styleById.get(tokenId)?.fill;
      if (!isGrayscale(fill)) continue;
      const existing = grayscaleByRole.get(fill!);
      if (existing && existing !== role) grayscaleCollisionIds.push(String(primitive.primitiveId));
      grayscaleByRole.set(fill!, role);
    }
  }
  checks.push(check("grayscale-role-collision", grayscaleCollisionIds.length === 0, grayscaleCollisionIds));

  return deepFreeze({
    qaVersion: QA_VERSION,
    status: checks.every((item) => item.status === "passed") ? "passed" : "failed",
    planHash: plan.identity.canonicalHash,
    checks,
  });
}

interface Bounds { x: number; y: number; width: number; height: number; }
interface Point { x: number; y: number; }

function check(code: string, passed: boolean, objectIds: readonly string[]): PublicationVisualPlanQaCheck {
  return { code, status: passed ? "passed" : "failed", objectIds: [...new Set(objectIds)].sort() };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PVP QA requires parsed PVP records");
  return value as Record<string, unknown>;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asBounds(value: unknown): Bounds {
  const bounds = tryBounds(value);
  if (!bounds) throw new Error("PVP QA requires integer bounds");
  return bounds;
}

function tryBounds(value: unknown): Bounds | null {
  const bounds = asRecordOrNull(value);
  return bounds && isInteger(bounds.x) && isInteger(bounds.y) && isInteger(bounds.width) && isInteger(bounds.height) && bounds.x >= 0 && bounds.y >= 0 && bounds.width >= 0 && bounds.height >= 0
    ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    : null;
}

function asPointOrNull(value: unknown): Point | null {
  const point = asRecordOrNull(value);
  return point && isInteger(point.x) && isInteger(point.y) ? { x: point.x, y: point.y } : null;
}

function isInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function contains(outer: Bounds, inner: Bounds): boolean { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height; }
function overlaps(left: Bounds, right: Bounds): boolean { return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y; }
function nonEmptyStringArray(value: unknown): boolean { return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0); }

function styleTokenIds(value: unknown): Set<string> {
  const tokens = asRecordOrNull(value)?.tokens;
  if (!Array.isArray(tokens)) return new Set();
  return new Set(tokens.flatMap((token) => {
    const record = asRecordOrNull(token);
    return record && typeof record.tokenId === "string" ? [record.tokenId] : [];
  }));
}

function styleReferences(value: Record<string, unknown>): string[] {
  return Array.isArray(value.styleTokenIds) && value.styleTokenIds.every((item) => typeof item === "string") ? value.styleTokenIds as string[] : ["invalid-style-token-reference"];
}

function uniqueIds(values: readonly Record<string, unknown>[], field: string): boolean {
  const ids = values.map((value) => value[field]);
  return ids.every((id) => typeof id === "string") && new Set(ids).size === ids.length;
}

function visualRole(primitive: Record<string, unknown>): string {
  const visual = asRecordOrNull(primitive.visual);
  return visual && typeof visual.regionRole === "string" ? visual.regionRole : "base";
}

function hasCandidateVisualSemantics(primitive: Record<string, unknown>): boolean {
  return primitive.kind === "CandidateRegion" || primitive.kind === "CandidateCallout" || visualRole(primitive) === "candidate_feedback";
}

function validTensorGeometry(primitive: Record<string, unknown>): boolean {
  const visual = asRecordOrNull(primitive.visual);
  const geometry = visual && asRecordOrNull(visual.geometry);
  if (!geometry || geometry.kind !== "tensor_volume" || !Array.isArray(geometry.frontFace) || !Array.isArray(geometry.depthFace) || geometry.frontFace.length !== 4 || geometry.depthFace.length !== 4) return false;
  const front = geometry.frontFace.map(asPointOrNull);
  const depth = geometry.depthFace.map(asPointOrNull);
  return front.every((point): point is Point => point !== null) && depth.every((point): point is Point => point !== null) && JSON.stringify(front) !== JSON.stringify(depth);
}

function validTokenCells(primitive: Record<string, unknown>): boolean {
  const visual = asRecordOrNull(primitive.visual);
  const geometry = visual && asRecordOrNull(visual.geometry);
  if (!geometry || geometry.kind !== "ordered_cells" || !Array.isArray(geometry.orderedCells) || geometry.orderedCells.length < 2) return false;
  const cells = geometry.orderedCells.map(asRecordOrNull);
  if (cells.some((cell) => !cell) || cells.some((cell, index) => cell!.order !== index)) return false;
  const bounds = cells.map((cell) => tryBounds(cell!.bounds));
  return bounds.every((item): item is Bounds => item !== null) && bounds.every((left, index) => bounds.slice(index + 1).every((right) => !overlaps(left, right)));
}

function hasDistinctMergeInputs(primitive: Record<string, unknown>, ports: readonly Record<string, unknown>[]): boolean {
  const inputs = ports.filter((port) => port.primitiveId === primitive.primitiveId && port.role === "input" && typeof port.semanticPortId === "string");
  return inputs.length >= 2 && new Set(inputs.map((port) => port.semanticPortId)).size === inputs.length;
}

function styleTokenValues(value: unknown): Map<string, { fill?: string }> {
  const tokens = asRecordOrNull(value)?.tokens;
  if (!Array.isArray(tokens)) return new Map();
  return new Map(tokens.flatMap((token) => {
    const record = asRecordOrNull(token);
    const values = record && asRecordOrNull(record.values);
    return record && typeof record.tokenId === "string" ? [[record.tokenId, { fill: typeof values?.fill === "string" ? values.fill : undefined }] as const] : [];
  }));
}

function isGrayscale(value: string | undefined): boolean {
  if (!value || !/^#[a-fA-F0-9]{6}$/.test(value)) return false;
  return value.slice(1, 3).toLowerCase() === value.slice(3, 5).toLowerCase() && value.slice(3, 5).toLowerCase() === value.slice(5, 7).toLowerCase();
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
