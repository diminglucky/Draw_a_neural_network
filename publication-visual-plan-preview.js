const RESPONSE_FIELDS = Object.freeze({
  formal: ["kind", "exportEligible", "draft", "pvp"],
  candidate: ["kind", "exportEligible", "draft", "pvp"],
  clarification: ["kind", "draft", "question", "affectedRegionIds", "evidenceIds"],
});
const PVP_FIELDS = Object.freeze([
  "identity", "eligibility", "lineage", "coordinateSpace", "regions", "primitiveGroups", "primitives", "ports", "connectors", "annotations", "legend", "styleTokens", "profileApplications", "sourceMappings", "rendererRequirements", "updateIdentity",
]);
const PRIMITIVE_KINDS = new Set(["Input", "Output", "GenericModule", "CustomOperator", "CustomModule", "Split", "MergeAdd", "MergeConcat", "CustomFusion", "RepeatBadge", "CandidateRegion"]);
const PORT_SIDES = new Set(["left", "right", "top", "bottom"]);
const REQUIRED_CAPABILITIES = new Set(["native-text", "orthogonal-route", "shape-data"]);
const MAX_ITEMS = 500;
const MAX_TEXT_LENGTH = 500;

export function renderPublicationVisualPlanPreview(response) {
  const preview = parsePvpResponse(response);
  if (preview.kind === "clarification") throw new Error("PVP clarification response has no visual plan");
  const { pvp } = preview;
  const page = pvp.coordinateSpace.page;
  const candidate = preview.kind === "candidate";
  const connectors = pvp.connectors.map(renderConnector).join("");
  const primitives = pvp.primitives.map(renderPrimitive).join("");
  const annotations = pvp.annotations.map(renderAnnotation).join("");
  const candidateMark = candidate
    ? `<g class="publication-visual-plan-candidate" aria-label="Candidate preview"><rect x="${page.x}" y="${page.y}" width="${page.width}" height="${page.height}"/><text x="${page.x + 24}" y="${page.y + 38}">Candidate preview</text></g>`
    : "";

  return `<svg class="publication-visual-plan-svg${candidate ? " publication-visual-plan-svg--candidate" : ""}" viewBox="${page.x} ${page.y} ${page.width} ${page.height}" role="img" aria-label="Publication visual plan preview" xmlns="http://www.w3.org/2000/svg"><rect class="publication-visual-plan-page" x="${page.x}" y="${page.y}" width="${page.width}" height="${page.height}"/>${connectors}${primitives}${annotations}${candidateMark}</svg>`;
}

export function publicationVisualPreviewSummary(response) {
  const preview = parsePvpResponse(response);
  if (preview.kind === "clarification") {
    return Object.freeze({ kind: "clarification", draftId: preview.draft.id, revision: preview.draft.revision, questionId: preview.question.id });
  }
  return Object.freeze({
    kind: preview.kind,
    exportEligible: preview.exportEligible,
    draftId: preview.draft.id,
    revision: preview.draft.revision,
    planId: preview.pvp.identity.planId,
    primitiveCount: preview.pvp.primitives.length,
    connectorCount: preview.pvp.connectors.length,
  });
}

export function renderPublicationVisualClarification(response) {
  const preview = parsePvpResponse(response);
  if (preview.kind !== "clarification") throw new Error("PVP clarification response is required");
  const values = preview.question.candidateValues.map((value) => `<li>${escapeHtml(value)}</li>`).join("");
  return `<section class="publication-visual-plan-clarification" data-pvp-question="${escapeAttribute(preview.question.id)}"><p>${escapeHtml(preview.question.question)}</p><ul>${values}</ul></section>`;
}

export function parsePublicationVisualPreview(response) {
  return parsePvpResponse(response);
}

export function assertPublicationVisualPreview(response) {
  parsePvpResponse(response);
}

function parsePvpResponse(value) {
  const response = plainRecord(value, "PVP preview response is invalid");
  const kind = response.kind;
  if (kind !== "formal" && kind !== "candidate" && kind !== "clarification") throw new Error("PVP preview kind is invalid");
  assertExactKeys(response, RESPONSE_FIELDS[kind], "PVP preview response");
  const draft = parseDraft(response.draft);
  if (kind === "clarification") {
    return Object.freeze({ kind, draft, question: parseQuestion(response.question), affectedRegionIds: parseIdentifierArray(response.affectedRegionIds, "affectedRegionIds"), evidenceIds: parseIdentifierArray(response.evidenceIds, "evidenceIds") });
  }
  if (response.exportEligible !== (kind === "formal")) throw new Error("PVP preview export eligibility is invalid");
  const pvp = parsePvp(response.pvp, kind);
  return Object.freeze({ kind, exportEligible: response.exportEligible, draft, pvp });
}

function parsePvp(value, responseKind) {
  const pvp = plainRecord(value, "PVP is invalid");
  assertExactKeys(pvp, PVP_FIELDS, "PVP");
  const identity = plainRecord(pvp.identity, "PVP identity is invalid");
  assertExactKeys(identity, ["schemaVersion", "planId", "canonicalHash"], "PVP identity");
  if (identity.schemaVersion !== 1 || !identifier(identity.planId) || !/^[a-f0-9]{64}$/.test(String(identity.canonicalHash ?? ""))) throw new Error("PVP identity is invalid");
  const eligibility = plainRecord(pvp.eligibility, "PVP eligibility is invalid");
  assertExactKeys(eligibility, ["kind", "formalReasons", "blockingReasons", "qaStatus"], "PVP eligibility");
  if (eligibility.kind !== responseKind || !["pending", "passed"].includes(eligibility.qaStatus) || !stringArray(eligibility.formalReasons) || !stringArray(eligibility.blockingReasons)) throw new Error("PVP eligibility is invalid");
  if (responseKind === "candidate" && (eligibility.qaStatus === "passed" || eligibility.formalReasons.length !== 0)) throw new Error("Candidate PVP eligibility is invalid");
  const coordinateSpace = parseCoordinateSpace(pvp.coordinateSpace);
  const primitives = parsePrimitives(pvp.primitives, coordinateSpace.page);
  const ports = parsePorts(pvp.ports, primitives, coordinateSpace.page);
  const connectors = parseConnectors(pvp.connectors, ports, coordinateSpace.page);
  const annotations = parseAnnotations(pvp.annotations, primitives, coordinateSpace.page);
  parseRendererRequirements(pvp.rendererRequirements);
  assertDenseArray(pvp.regions, "PVP regions");
  assertDenseArray(pvp.primitiveGroups, "PVP primitiveGroups");
  assertDenseArray(pvp.profileApplications, "PVP profileApplications");
  assertDenseArray(pvp.sourceMappings, "PVP sourceMappings");
  plainRecord(pvp.lineage, "PVP lineage is invalid");
  plainRecord(pvp.legend, "PVP legend is invalid");
  plainRecord(pvp.styleTokens, "PVP styleTokens are invalid");
  plainRecord(pvp.updateIdentity, "PVP update identity is invalid");
  return Object.freeze({ identity: Object.freeze({ planId: identity.planId }), coordinateSpace, primitives, ports, connectors, annotations });
}

function parseDraft(value) {
  const draft = plainRecord(value, "PVP preview draft is invalid");
  assertExactKeys(draft, ["id", "revision"], "PVP preview draft");
  if (!identifier(draft.id) || !positiveInteger(draft.revision)) throw new Error("PVP preview draft is invalid");
  return Object.freeze({ id: draft.id, revision: draft.revision });
}

function parseQuestion(value) {
  const question = plainRecord(value, "PVP clarification question is invalid");
  assertExactKeys(question, ["id", "question", "candidateValues"], "PVP clarification question");
  if (!identifier(question.id) || !displayText(question.question) || !stringArray(question.candidateValues) || question.candidateValues.length === 0) throw new Error("PVP clarification question is invalid");
  return Object.freeze({ id: question.id, question: question.question, candidateValues: Object.freeze([...question.candidateValues]) });
}

function parseCoordinateSpace(value) {
  const coordinateSpace = plainRecord(value, "PVP coordinate space is invalid");
  assertExactKeys(coordinateSpace, ["id", "origin", "axes", "unit", "duPerInch", "page", "safeMargins"], "PVP coordinate space");
  if (coordinateSpace.id !== "pvp-du-1" || coordinateSpace.origin !== "top_left" || coordinateSpace.axes !== "x_right_y_down" || coordinateSpace.unit !== "du" || coordinateSpace.duPerInch !== 1000) throw new Error("PVP coordinate space is invalid");
  const page = parseBounds(coordinateSpace.page, "PVP page", true);
  const safeMargins = parseBounds(coordinateSpace.safeMargins, "PVP safe margins", false);
  if (page.x !== 0 || page.y !== 0 || page.width > 1_000_000 || page.height > 1_000_000 || !contains(page, safeMargins)) throw new Error("PVP coordinate space is invalid");
  return Object.freeze({ page, safeMargins });
}

function parsePrimitives(value, page) {
  assertDenseArray(value, "PVP primitives");
  if (value.length > MAX_ITEMS) throw new Error("PVP has too many primitives");
  const ids = new Set();
  return Object.freeze(value.map((item) => {
    const primitive = plainRecord(item, "PVP primitive is invalid");
    assertExactKeys(primitive, ["primitiveId", "componentId", "kind", "regionId", "bounds", "zIndex", "styleTokenIds", "label"], "PVP primitive");
    if (!identifier(primitive.primitiveId) || ids.has(primitive.primitiveId) || !identifier(primitive.componentId) || !identifier(primitive.regionId) || !PRIMITIVE_KINDS.has(primitive.kind) || !integer(primitive.zIndex) || !stringArray(primitive.styleTokenIds)) throw new Error("PVP primitive is invalid");
    if (primitive.label !== undefined && !displayText(primitive.label)) throw new Error("PVP primitive label is invalid");
    const bounds = parseBounds(primitive.bounds, "PVP primitive bounds", false);
    if (!contains(page, bounds)) throw new Error("PVP primitive is outside page bounds");
    ids.add(primitive.primitiveId);
    return Object.freeze({ primitiveId: primitive.primitiveId, kind: primitive.kind, bounds, label: primitive.label || "" });
  }));
}

function parsePorts(value, primitives, page) {
  assertDenseArray(value, "PVP ports");
  if (value.length > MAX_ITEMS * 4) throw new Error("PVP has too many ports");
  const primitiveById = new Map(primitives.map((primitive) => [primitive.primitiveId, primitive]));
  const ids = new Set();
  const ports = value.map((item) => {
    const port = plainRecord(item, "PVP port is invalid");
    assertExactKeys(port, ["portId", "primitiveId", "role", "anchor", "order", "semanticPortId"], "PVP port");
    const primitive = primitiveById.get(port.primitiveId);
    const anchor = plainRecord(port.anchor, "PVP port anchor is invalid");
    assertExactKeys(anchor, ["side", "offset"], "PVP port anchor");
    if (!identifier(port.portId) || ids.has(port.portId) || !primitive || !["input", "output"].includes(port.role) || !PORT_SIDES.has(anchor.side) || !integer(anchor.offset) || anchor.offset < 0 || anchor.offset > 1000 || !integer(port.order) || !identifier(port.semanticPortId)) throw new Error("PVP port is invalid");
    const point = anchorPoint(primitive.bounds, anchor.side, anchor.offset);
    if (!contains(page, { x: point.x, y: point.y, width: 0, height: 0 })) throw new Error("PVP port anchor is outside page bounds");
    ids.add(port.portId);
    return Object.freeze({ portId: port.portId, primitiveId: port.primitiveId, point });
  });
  return Object.freeze(ports);
}

function parseConnectors(value, ports, page) {
  assertDenseArray(value, "PVP connectors");
  if (value.length > MAX_ITEMS * 4) throw new Error("PVP has too many connectors");
  const portById = new Map(ports.map((port) => [port.portId, port]));
  const ids = new Set();
  return Object.freeze(value.map((item) => {
    const connector = plainRecord(item, "PVP connector is invalid");
    assertExactKeys(connector, ["connectorId", "sourcePortId", "targetPortId", "relation", "route", "styleTokenIds", "zIndex"], "PVP connector");
    const source = portById.get(connector.sourcePortId);
    const target = portById.get(connector.targetPortId);
    if (!identifier(connector.connectorId) || ids.has(connector.connectorId) || !source || !target || source.primitiveId === target.primitiveId || !displayText(connector.relation) || !stringArray(connector.styleTokenIds) || !integer(connector.zIndex)) throw new Error("PVP connector is invalid");
    const route = parseRoute(connector.route, page);
    if (!samePoint(route[0], source.point) || !samePoint(route.at(-1), target.point)) throw new Error("PVP connector route endpoint is invalid");
    ids.add(connector.connectorId);
    return Object.freeze({ connectorId: connector.connectorId, route });
  }));
}

function parseAnnotations(value, primitives, page) {
  assertDenseArray(value, "PVP annotations");
  if (value.length > MAX_ITEMS) throw new Error("PVP has too many annotations");
  const primitiveIds = new Set(primitives.map((primitive) => primitive.primitiveId));
  const ids = new Set();
  return Object.freeze(value.map((item) => {
    const annotation = plainRecord(item, "PVP annotation is invalid");
    assertExactKeys(annotation, ["annotationId", "targetIds", "bounds", "text", "role", "styleTokenIds"], "PVP annotation");
    if (!identifier(annotation.annotationId) || ids.has(annotation.annotationId) || !parseIdentifierArray(annotation.targetIds, "PVP annotation targets").every((target) => primitiveIds.has(target)) || !displayText(annotation.text) || !displayText(annotation.role) || !stringArray(annotation.styleTokenIds)) throw new Error("PVP annotation is invalid");
    const bounds = parseBounds(annotation.bounds, "PVP annotation bounds", false);
    if (!contains(page, bounds)) throw new Error("PVP annotation is outside page bounds");
    ids.add(annotation.annotationId);
    return Object.freeze({ annotationId: annotation.annotationId, bounds, text: annotation.text });
  }));
}

function parseRendererRequirements(value) {
  const requirements = plainRecord(value, "PVP renderer requirements are invalid");
  assertExactKeys(requirements, ["protocolVersion", "requiredCapabilities", "optionalCapabilities"], "PVP renderer requirements");
  if (requirements.protocolVersion !== "pvp-renderer-1" || !stringArray(requirements.requiredCapabilities) || !stringArray(requirements.optionalCapabilities)) throw new Error("PVP renderer requirements are invalid");
  for (const capability of REQUIRED_CAPABILITIES) if (!requirements.requiredCapabilities.includes(capability)) throw new Error("PVP renderer capability is unsupported");
}

function parseRoute(value, page) {
  assertDenseArray(value, "PVP connector route");
  if (value.length < 2 || value.length > 24) throw new Error("PVP connector route is invalid");
  const route = value.map((item) => {
    const point = plainRecord(item, "PVP route point is invalid");
    assertExactKeys(point, ["x", "y"], "PVP route point");
    if (!nonNegativeInteger(point.x) || !nonNegativeInteger(point.y) || !contains(page, { x: point.x, y: point.y, width: 0, height: 0 })) throw new Error("PVP route point is invalid");
    return Object.freeze({ x: point.x, y: point.y });
  });
  for (let index = 1; index < route.length; index += 1) {
    if (route[index - 1].x !== route[index].x && route[index - 1].y !== route[index].y) throw new Error("PVP route must be orthogonal");
  }
  return Object.freeze(route);
}

function parseBounds(value, label, allowPageOrigin) {
  const bounds = plainRecord(value, `${label} is invalid`);
  assertExactKeys(bounds, ["x", "y", "width", "height"], label);
  if (!nonNegativeInteger(bounds.x) || !nonNegativeInteger(bounds.y) || !positiveInteger(bounds.width) || !positiveInteger(bounds.height) || (!allowPageOrigin && (bounds.width > 1_000_000 || bounds.height > 1_000_000))) throw new Error(`${label} is invalid`);
  return Object.freeze({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
}

function renderConnector(connector) {
  const d = connector.route.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  return `<path class="publication-visual-plan-connector" data-pvp-connector="${escapeAttribute(connector.connectorId)}" d="${d}"/>`;
}

function renderPrimitive(primitive) {
  const { bounds } = primitive;
  const className = primitive.kind.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  return `<g class="publication-visual-plan-primitive publication-visual-plan-primitive--${className}" data-pvp-primitive="${escapeAttribute(primitive.primitiveId)}"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="12" ry="12"/><text x="${bounds.x + 12}" y="${bounds.y + Math.floor(bounds.height / 2)}">${escapeHtml(primitive.label || primitive.kind)}</text></g>`;
}

function renderAnnotation(annotation) {
  return `<text class="publication-visual-plan-annotation" data-pvp-annotation="${escapeAttribute(annotation.annotationId)}" x="${annotation.bounds.x}" y="${annotation.bounds.y + Math.floor(annotation.bounds.height / 2)}">${escapeHtml(annotation.text)}</text>`;
}

function plainRecord(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(message);
  return value;
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unsupported fields`);
}

function assertDenseArray(value, label) {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) throw new Error(`${label} must be a dense array`);
}

function stringArray(value) {
  return Array.isArray(value) && Object.keys(value).length === value.length && value.every((item) => displayText(item));
}

function parseIdentifierArray(value, label) {
  assertDenseArray(value, label);
  if (value.length > MAX_ITEMS || !value.every(identifier)) throw new Error(`${label} is invalid`);
  return Object.freeze([...value]);
}

function identifier(value) { return typeof value === "string" && /^[A-Za-z][A-Za-z0-9._:-]{0,239}$/.test(value); }
function integer(value) { return Number.isSafeInteger(value); }
function nonNegativeInteger(value) { return integer(value) && value >= 0; }
function positiveInteger(value) { return integer(value) && value > 0; }
function displayText(value) { return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT_LENGTH; }
function contains(outer, inner) { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height; }
function samePoint(left, right) { return left.x === right.x && left.y === right.y; }

function anchorPoint(bounds, side, offset) {
  if (side === "left") return { x: bounds.x, y: bounds.y + Math.floor((bounds.height * offset) / 1000) };
  if (side === "right") return { x: bounds.x + bounds.width, y: bounds.y + Math.floor((bounds.height * offset) / 1000) };
  if (side === "top") return { x: bounds.x + Math.floor((bounds.width * offset) / 1000), y: bounds.y };
  return { x: bounds.x + Math.floor((bounds.width * offset) / 1000), y: bounds.y + bounds.height };
}

function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
function escapeAttribute(value) { return escapeHtml(value); }
