const MAX_CANVAS_NODES = 80;
const MAX_CANVAS_EDGES = 160;
const MAX_CANVAS_ACTIONS = 24;

const ACTION_TYPES = new Set([
  "replace_document",
  "add_node",
  "update_node",
  "remove_node",
  "add_edge",
  "update_edge",
  "remove_edge",
  "update_figure",
]);

const NODE_PATCH_FIELDS = new Set([
  "type", "x", "y", "w", "h", "label", "subtitle", "stage", "color",
  "depth", "z", "layers", "note", "badge", "channels", "stageKey", "columnX",
]);
const EDGE_PATCH_FIELDS = new Set(["source", "target", "label", "type", "color"]);
const FIGURE_PATCH_FIELDS = new Set(["title", "subtitle", "stages", "caption"]);

export function cloneCanvasValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function projectCanvasSnapshot(document) {
  if (!isRecord(document) || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error("Agent canvas document is invalid");
  const projected = {
    ...(isRecord(document.figure) ? { figure: pickFigure(document.figure) } : {}),
    ...(typeof document.paletteName === "string" ? { paletteName: document.paletteName } : {}),
    nodes: document.nodes.map((node) => pickNode(node)),
    edges: document.edges.map((edge) => pickEdge(edge)),
  };
  assertDocumentIntegrity(projected);
  return projected;
}

export function assertCanvasActionSet(actionSet) {
  if (!actionSet || !Array.isArray(actionSet.actions) || actionSet.actions.length > MAX_CANVAS_ACTIONS) {
    throw new Error("Agent canvas actions are invalid");
  }

  for (const action of actionSet.actions) {
    if (!isRecord(action) || !ACTION_TYPES.has(action.type)) throw new Error("Agent returned an unsupported canvas action");
    if (action.type === "replace_document") {
      assertDocumentIntegrity(action.document);
      continue;
    }
    if (action.type === "add_node") {
      assertNode(action.node);
      continue;
    }
    if (action.type === "add_edge") {
      assertEdge(action.edge);
      continue;
    }
    if (action.type === "update_figure") {
      assertPatch(action.patch, FIGURE_PATCH_FIELDS, "figure");
      continue;
    }
    if (action.type === "update_node" || action.type === "update_edge") {
      if (typeof action.id !== "string" || !action.id.trim()) throw new Error("Agent action id is missing");
      assertPatch(action.patch, action.type === "update_node" ? NODE_PATCH_FIELDS : EDGE_PATCH_FIELDS, action.type === "update_node" ? "node" : "edge");
      continue;
    }
    if (typeof action.id !== "string" || !action.id.trim()) throw new Error("Agent action id is missing");
  }
}

export function applyCanvasActions(document, actionSet, options = {}) {
  assertCanvasActionSet(actionSet);
  const normalizeDocument = options.normalizeDocument || defaultNormalizeDocument;
  const next = cloneCanvasValue(document);
  assertDocumentIntegrity(next);

  for (const action of actionSet.actions) {
    if (action.type === "replace_document") {
      const normalized = normalizeDocument(action.document);
      if (!normalized) throw new Error("Agent replacement document is invalid");
      next.figure = normalized.figure || next.figure;
      next.paletteName = normalized.paletteName || next.paletteName;
      next.nodes = cloneCanvasValue(normalized.nodes);
      next.edges = cloneCanvasValue(normalized.edges);
    } else if (action.type === "add_node") {
      if (next.nodes.some((node) => node.id === action.node.id)) throw new Error(`Agent node ${action.node.id} already exists`);
      next.nodes.push(cloneCanvasValue(action.node));
    } else if (action.type === "update_node") {
      const node = next.nodes.find((item) => item.id === action.id);
      if (!node) throw new Error(`Agent node ${action.id} does not exist`);
      Object.assign(node, cloneCanvasValue(action.patch));
    } else if (action.type === "remove_node") {
      if (!next.nodes.some((node) => node.id === action.id)) throw new Error(`Agent node ${action.id} does not exist`);
      next.nodes = next.nodes.filter((node) => node.id !== action.id);
      next.edges = next.edges.filter((edge) => edge.source !== action.id && edge.target !== action.id);
    } else if (action.type === "add_edge") {
      if (next.edges.some((edge) => edge.id === action.edge.id)) throw new Error(`Agent edge ${action.edge.id} already exists`);
      next.edges.push(cloneCanvasValue(action.edge));
    } else if (action.type === "update_edge") {
      const edge = next.edges.find((item) => item.id === action.id);
      if (!edge) throw new Error(`Agent edge ${action.id} does not exist`);
      Object.assign(edge, cloneCanvasValue(action.patch));
    } else if (action.type === "remove_edge") {
      if (!next.edges.some((edge) => edge.id === action.id)) throw new Error(`Agent edge ${action.id} does not exist`);
      next.edges = next.edges.filter((edge) => edge.id !== action.id);
    } else if (action.type === "update_figure") {
      next.figure = { ...(next.figure || {}), ...cloneCanvasValue(action.patch) };
    }
    assertDocumentIntegrity(next);
  }

  return next;
}

export function previewCanvasActions(document, actionSet, options = {}) {
  const preview = applyCanvasActions(document, actionSet, options);
  const count = Array.isArray(actionSet?.actions) ? actionSet.actions.length : 0;
  return {
    document: preview,
    summary: `${count} structured canvas action(s) validated; the current canvas is unchanged`,
  };
}

export function assertFreshCanvasPreview(pendingPreview, value, token) {
  if (!pendingPreview || typeof token !== "string" || token !== pendingPreview.token || JSON.stringify(value) !== pendingPreview.fingerprint) {
    throw new Error("Agent canvas changes require a fresh preview confirmation");
  }
}

function assertDocumentIntegrity(document) {
  if (!isRecord(document) || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error("Agent canvas document is invalid");
  assertKeys(document, new Set(["figure", "paletteName", "nodes", "edges"]), "Agent canvas document contains an unsupported field");
  if (document.figure !== undefined) assertFigure(document.figure);
  if (document.paletteName !== undefined && (typeof document.paletteName !== "string" || document.paletteName.length > 64)) throw new Error("Agent canvas palette is invalid");
  if (document.nodes.length > MAX_CANVAS_NODES || document.edges.length > MAX_CANVAS_EDGES) throw new Error("Agent canvas exceeds the safe size limit");

  const nodeIds = new Set();
  for (const node of document.nodes) {
    assertNode(node);
    if (nodeIds.has(node.id)) throw new Error(`Agent canvas contains duplicate node ${node.id}`);
    nodeIds.add(node.id);
    if (node.type !== undefined && typeof node.type !== "string") throw new Error("Agent canvas node type is invalid");
    if (node.x !== undefined && !Number.isFinite(node.x)) throw new Error("Agent canvas node x is invalid");
    if (node.y !== undefined && !Number.isFinite(node.y)) throw new Error("Agent canvas node y is invalid");
    if (node.w !== undefined && (!Number.isFinite(node.w) || node.w <= 0)) throw new Error("Agent canvas node width is invalid");
    if (node.h !== undefined && (!Number.isFinite(node.h) || node.h <= 0)) throw new Error("Agent canvas node height is invalid");
  }

  const edgeIds = new Set();
  for (const edge of document.edges) {
    assertEdge(edge);
    if (edgeIds.has(edge.id)) throw new Error(`Agent canvas contains duplicate edge ${edge.id}`);
    if (typeof edge.source !== "string" || typeof edge.target !== "string" || !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
      throw new Error("Agent canvas contains an invalid edge endpoint");
    }
    edgeIds.add(edge.id);
  }
}

function assertPatch(patch, allowedFields, kind) {
  if (!isRecord(patch) || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !allowedFields.has(key))) {
    throw new Error("Agent canvas patch contains an unsupported field");
  }
  for (const [key, value] of Object.entries(patch)) assertPatchValue(key, value, kind);
}

function assertRecordWithId(value, message) {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) throw new Error(message);
}

function defaultNormalizeDocument(document) {
  if (!isRecord(document) || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) return null;
  return document;
}

function assertFigure(figure) {
  if (!isRecord(figure)) throw new Error("Agent canvas figure is invalid");
  assertKeys(figure, new Set(["title", "subtitle", "stages", "caption"]), "Agent canvas figure contains an unsupported field");
  if (figure.title !== undefined && !isSafeText(figure.title, 256)) throw new Error("Agent canvas figure title is invalid");
  if (figure.subtitle !== undefined && !isSafeText(figure.subtitle, 512)) throw new Error("Agent canvas figure subtitle is invalid");
  if (figure.caption !== undefined && !isSafeText(figure.caption, 4096)) throw new Error("Agent canvas figure caption is invalid");
  if (figure.stages !== undefined && (!Array.isArray(figure.stages) || figure.stages.length > 64 || figure.stages.some((stage) => !isSafeText(stage, 128)))) throw new Error("Agent canvas figure stages are invalid");
}

function assertNode(node) {
  assertRecordWithId(node, "Agent canvas node id is missing");
  assertKeys(node, new Set(["id", "type", "x", "y", "w", "h", "label", "subtitle", "stage", "color", "depth", "z", "layers", "note", "badge", "channels", "stageKey", "columnX"]), "Agent canvas node contains an unsupported field");
  if (!isSafeText(node.type, 64) || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.w) || node.w <= 0 || !Number.isFinite(node.h) || node.h <= 0 || !isSafeText(node.label, 256) || !isSafeText(node.subtitle, 512) || !Number.isInteger(node.stage) || node.stage < 0 || !isSafeText(node.color, 32)) throw new Error("Agent canvas node fields are invalid");
  if (node.depth !== undefined && (!Number.isFinite(node.depth) || node.depth <= 0)) throw new Error("Agent canvas node depth is invalid");
  if (node.z !== undefined && (!Number.isFinite(node.z) || node.z <= 0)) throw new Error("Agent canvas node z is invalid");
  if (node.layers !== undefined && (!Number.isInteger(node.layers) || node.layers <= 0 || node.layers > 256)) throw new Error("Agent canvas node layers are invalid");
  for (const key of ["note", "badge", "channels", "stageKey"]) if (node[key] !== undefined && !isSafeText(node[key], key === "note" ? 512 : 128)) throw new Error(`Agent canvas node ${key} is invalid`);
  if (node.columnX !== undefined && !Number.isFinite(node.columnX)) throw new Error("Agent canvas node column is invalid");
}

function assertEdge(edge) {
  assertRecordWithId(edge, "Agent canvas edge id is missing");
  assertKeys(edge, new Set(["id", "source", "target", "label", "type", "color"]), "Agent canvas edge contains an unsupported field");
  if (!isSafeText(edge.source, 128) || !isSafeText(edge.target, 128) || !isSafeText(edge.label, 256) || !isSafeText(edge.type, 64) || !isSafeText(edge.color, 32)) throw new Error("Agent canvas edge fields are invalid");
}

function assertPatchValue(key, value, kind) {
  if (kind === "figure") {
    const figure = { [key]: value };
    assertFigure(figure);
    return;
  }
  if (kind === "node") {
    const node = { id: "patch", type: "block", x: 0, y: 0, w: 1, h: 1, label: "Patch", subtitle: "", stage: 0, color: "#000", [key]: value };
    assertNode(node);
    return;
  }
  const edge = { id: "patch", source: "source", target: "target", label: "", type: "signal", color: "#000", [key]: value };
  assertEdge(edge);
}

function assertKeys(value, allowed, message) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(message);
}

function isSafeText(value, max) {
  return typeof value === "string" && value.length <= max;
}

function pickFigure(figure) {
  return Object.fromEntries(["title", "subtitle", "stages", "caption"].filter((key) => figure[key] !== undefined).map((key) => [key, cloneCanvasValue(figure[key])]));
}

function pickNode(node) {
  if (!isRecord(node)) throw new Error("Agent canvas node is invalid");
  const keys = ["id", "type", "x", "y", "w", "h", "label", "subtitle", "stage", "color", "depth", "z", "layers", "note", "badge", "channels", "stageKey", "columnX"];
  return Object.fromEntries(keys.filter((key) => node[key] !== undefined).map((key) => [key, cloneCanvasValue(node[key])]));
}

function pickEdge(edge) {
  if (!isRecord(edge)) throw new Error("Agent canvas edge is invalid");
  return Object.fromEntries(["id", "source", "target", "label", "type", "color"].filter((key) => edge[key] !== undefined).map((key) => [key, cloneCanvasValue(edge[key])]));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
