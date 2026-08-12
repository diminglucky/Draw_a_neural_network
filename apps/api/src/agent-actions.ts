import { z } from "zod";

const MAX_CANVAS_NODES = 80;
const MAX_CANVAS_EDGES = 160;
const MAX_CANVAS_ACTIONS = 24;
const MAX_CANVAS_SNAPSHOT_BYTES = 64 * 1024;
const MAX_CANVAS_ACTION_BYTES = 32 * 1024;

const idSchema = z.string().trim().min(1).max(128);
const safeText = (max: number) => z.string().max(max);
const stagesSchema = z.array(z.string().trim().min(1).max(128)).max(64);
const figureSchema = z.object({
  title: safeText(256).optional(),
  subtitle: safeText(512).optional(),
  stages: stagesSchema.optional(),
  caption: safeText(4096).optional(),
}).strict();

export const canvasNodeSchema = z.object({
  id: idSchema,
  type: z.string().trim().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
  label: z.string().trim().min(1).max(256),
  subtitle: z.string().max(512),
  stage: z.number().int().nonnegative(),
  color: z.string().trim().min(1).max(32),
  depth: z.number().finite().positive().optional(),
  z: z.number().finite().positive().optional(),
  layers: z.number().int().positive().max(256).optional(),
  note: safeText(512).optional(),
  badge: safeText(128).optional(),
  channels: safeText(128).optional(),
  stageKey: safeText(128).optional(),
  columnX: z.number().finite().optional(),
}).strict();

export const canvasEdgeSchema = z.object({
  id: idSchema,
  source: idSchema,
  target: idSchema,
  label: z.string().max(256),
  type: z.string().trim().min(1).max(64),
  color: z.string().trim().min(1).max(32),
}).strict();

export const canvasDocumentSchema = z.object({
  figure: figureSchema.optional(),
  paletteName: z.string().trim().min(1).max(64).optional(),
  nodes: z.array(canvasNodeSchema).max(MAX_CANVAS_NODES),
  edges: z.array(canvasEdgeSchema).max(MAX_CANVAS_EDGES),
}).strict();

export const canvasSnapshotSchema = canvasDocumentSchema;
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;
export type CanvasSnapshot = z.infer<typeof canvasSnapshotSchema>;

const nodePatchSchema = z.object({
  type: z.string().trim().min(1).max(64).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  w: z.number().finite().positive().optional(),
  h: z.number().finite().positive().optional(),
  label: z.string().trim().min(1).max(256).optional(),
  subtitle: z.string().max(512).optional(),
  stage: z.number().int().nonnegative().optional(),
  color: z.string().trim().min(1).max(32).optional(),
  depth: z.number().finite().positive().optional(),
  z: z.number().finite().positive().optional(),
  layers: z.number().int().positive().max(256).optional(),
  note: safeText(512).optional(),
  badge: safeText(128).optional(),
  channels: safeText(128).optional(),
  stageKey: safeText(128).optional(),
  columnX: z.number().finite().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "patch must not be empty");
const edgePatchSchema = z.object({
  source: idSchema.optional(),
  target: idSchema.optional(),
  label: safeText(256).optional(),
  type: z.string().trim().min(1).max(64).optional(),
  color: z.string().trim().min(1).max(32).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "patch must not be empty");
const figurePatchSchema = z.object({
  title: safeText(256).optional(),
  subtitle: safeText(512).optional(),
  stages: stagesSchema.optional(),
  caption: safeText(4096).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "patch must not be empty");

const canvasActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replace_document"), document: canvasDocumentSchema }).strict(),
  z.object({ type: z.literal("add_node"), node: canvasNodeSchema }).strict(),
  z.object({ type: z.literal("update_node"), id: idSchema, patch: nodePatchSchema }).strict(),
  z.object({ type: z.literal("remove_node"), id: idSchema }).strict(),
  z.object({ type: z.literal("add_edge"), edge: canvasEdgeSchema }).strict(),
  z.object({ type: z.literal("update_edge"), id: idSchema, patch: edgePatchSchema }).strict(),
  z.object({ type: z.literal("remove_edge"), id: idSchema }).strict(),
  z.object({ type: z.literal("update_figure"), patch: figurePatchSchema }).strict(),
]);

export const canvasActionSetSchema = z.object({
  actions: z.array(canvasActionSchema).max(MAX_CANVAS_ACTIONS),
}).strict();

export type CanvasAction = z.infer<typeof canvasActionSchema>;
export type CanvasActionSet = z.infer<typeof canvasActionSetSchema>;

export function parseCanvasSnapshot(value: unknown): CanvasSnapshot {
  const result = canvasSnapshotSchema.safeParse(value);
  if (!result.success) throw schemaError("canvas snapshot", result.error);
  if (serializedBytes(result.data) > MAX_CANVAS_SNAPSHOT_BYTES) throw new Error("Canvas snapshot size limit exceeded");
  assertDocumentIntegrity(result.data);
  return result.data;
}

export function parseCanvasActionSet(value: unknown): CanvasActionSet {
  const result = canvasActionSetSchema.safeParse(value);
  if (!result.success) throw schemaError("canvas action set", result.error);
  if (serializedBytes(result.data) > MAX_CANVAS_ACTION_BYTES) throw new Error("Canvas action set size limit exceeded");
  for (const action of result.data.actions) {
    if (action.type === "replace_document") assertDocumentIntegrity(action.document);
  }
  return result.data;
}

export function applyCanvasActions(document: CanvasDocument, value: unknown): CanvasDocument {
  let next = cloneDocument(parseCanvasSnapshot(document));
  const actionSet = parseCanvasActionSet(value);

  for (const action of actionSet.actions) {
    switch (action.type) {
      case "replace_document":
        next = cloneDocument(action.document);
        break;
      case "add_node":
        if (next.nodes.some((node) => node.id === action.node.id)) throw new Error(`Duplicate node id "${action.node.id}"`);
        next.nodes.push(cloneValue(action.node));
        break;
      case "update_node": {
        const node = next.nodes.find((item) => item.id === action.id);
        if (!node) throw new Error(`Node "${action.id}" is missing`);
        Object.assign(node, cloneValue(action.patch));
        break;
      }
      case "remove_node": {
        const before = next.nodes.length;
        next.nodes = next.nodes.filter((node) => node.id !== action.id);
        if (next.nodes.length === before) throw new Error(`Node "${action.id}" is missing`);
        next.edges = next.edges.filter((edge) => edge.source !== action.id && edge.target !== action.id);
        break;
      }
      case "add_edge":
        if (next.edges.some((edge) => edge.id === action.edge.id)) throw new Error(`Duplicate edge id "${action.edge.id}"`);
        assertEdgeEndpoints(next, action.edge.source, action.edge.target);
        next.edges.push(cloneValue(action.edge));
        break;
      case "update_edge": {
        const edge = next.edges.find((item) => item.id === action.id);
        if (!edge) throw new Error(`Edge "${action.id}" is missing`);
        const candidate = { ...edge, ...cloneValue(action.patch) };
        assertEdgeEndpoints(next, String(candidate.source), String(candidate.target));
        Object.assign(edge, candidate);
        break;
      }
      case "remove_edge": {
        const before = next.edges.length;
        next.edges = next.edges.filter((edge) => edge.id !== action.id);
        if (next.edges.length === before) throw new Error(`Edge "${action.id}" is missing`);
        break;
      }
      case "update_figure":
        next.figure = { ...(next.figure || {}), ...cloneValue(action.patch) };
        break;
    }
    assertDocumentIntegrity(next);
  }

  return next;
}

function assertDocumentIntegrity(document: CanvasDocument): void {
  const nodeIds = new Set<string>();
  for (const node of document.nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Duplicate node id "${node.id}"`);
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of document.edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate edge id "${edge.id}"`);
    edgeIds.add(edge.id);
    assertEdgeEndpoints(document, edge.source, edge.target);
  }
}

function assertEdgeEndpoints(document: CanvasDocument, source: string, target: string): void {
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error(`Edge endpoint is missing: ${source} -> ${target}`);
  if (source === target) throw new Error(`Edge cannot connect a node to itself: ${source}`);
}

function cloneDocument(document: CanvasDocument): CanvasDocument {
  return cloneValue(document);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function formatIssuePath(path: (string | number)[] | undefined): string {
  return path && path.length > 0 ? path.map((part) => typeof part === "number" ? `[${part}]` : part).join(".") : "root";
}

function schemaError(label: string, error: z.ZodError): Error {
  const issue = error.issues[0];
  const reason = issue?.code === "too_big" ? "size limit exceeded" : issue?.message || "schema mismatch";
  return new Error(`Invalid ${label} at ${formatIssuePath(issue?.path)}: ${reason}`);
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
