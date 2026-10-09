import { normalizeNetworkIR, validateNetworkIR } from "./network-ir.mjs";
import { upgradeNeuralBlocks } from "./neural-block-ir.mjs";

export const MODEL_WORKSPACE_VERSION = "model-workspace/v1";

export function createModelWorkspace(input = {}) {
  const ir = normalizeNetworkIR(input.ir || input);
  const groupMembership = membershipIndex(ir.groups || []);
  const visualIndex = visualNodeIndex(input);
  const blockOverrides = clone(ir.blockOverrides || input.blockOverrides || {});
  const blockIr = upgradeNeuralBlocks(input.blockIr || { blocks: [] });
  const blocks = (blockIr.blocks || []).map((block) => ({
    id: String(block.id),
    kind: String(block.kind),
    nodeIds: (block.nodeIds || []).map(String),
    expanded: blockOverrides[block.id]?.expanded === true,
    locked: blockOverrides[block.id]?.locked === true,
    conflicted: blockOverrides[block.id]?.expanded === true && blockOverrides[block.id]?.locked === true,
  }));
  return {
    version: MODEL_WORKSPACE_VERSION,
    modelId: String(input.id || input.modelId || "model-workspace"),
    revision: Number.isFinite(input.revision) ? Number(input.revision) : 1,
    figure: { ...(ir.figure || {}) },
    nodes: (ir.nodes || []).map((node) => ({
      id: String(node.id),
      op: String(node.op || ""),
      family: String(node.family || "custom"),
      label: String(node.label || node.op || node.id),
      subtitle: String(node.subtitle || ""),
      shape: node.shape ? { ...node.shape, output: [...(node.shape.output || [])] } : undefined,
      groupIds: [...(groupMembership.get(String(node.id)) || [])],
      visible: true,
      locked: false,
      confidence: Number.isFinite(node.confidence) ? node.confidence : 1,
      status: String(node.status || "confirmed"),
      evidence: clone(node.evidence || []),
      ui: visualIndex.get(String(node.id)) ? { ...visualIndex.get(String(node.id)) } : undefined,
    })),
    edges: (ir.edges || []).map((edge) => ({
      id: String(edge.id),
      source: String(edge.source),
      target: String(edge.target),
      type: String(edge.type || "signal"),
      label: String(edge.label || ""),
      visible: true,
      confidence: Number.isFinite(edge.confidence) ? edge.confidence : 1,
      evidence: clone(edge.evidence || []),
    })),
    groups: (ir.groups || []).map((group) => ({
      id: String(group.id),
      label: String(group.label || group.id),
      kind: String(group.kind || "module"),
      nodeIds: (group.nodeIds || []).map(String),
      expandable: group.expandable !== false,
    })),
    containers: clone(ir.containers || []),
    lanes: clone(ir.lanes || []),
    constraints: clone(ir.constraints || []),
    blocks,
    blockOverrides,
    visualQuality: input.visioDiagramPlan?.scene?.visualQuality || input.visualQuality || null,
    visualDiagnostics: clone(input.visioDiagramPlan?.scene?.diagnostics || input.visualDiagnostics || input.diagnostics || []),
    capabilities: {
      editableModelGraph: true,
      renderPlanAvailable: Boolean(input.visioDiagramPlan),
      blockEditingAvailable: blocks.length > 0,
      visualQaAvailable: Boolean(input.visioDiagramPlan?.scene?.visualQuality || input.visualQuality),
    },
    diagnostics: [],
  };
}

export function validateModelWorkspace(workspace = {}) {
  const issues = [];
  if (workspace.version !== MODEL_WORKSPACE_VERSION) issues.push({ code: "invalid-model-workspace-version", value: workspace.version });
  const nodeIds = new Set();
  for (const node of workspace.nodes || []) {
    const id = String(node.id || "");
    if (!id) issues.push({ code: "missing-workspace-node-id" });
    else if (nodeIds.has(id)) issues.push({ code: "duplicate-workspace-node-id", nodeId: id });
    else nodeIds.add(id);
  }
  for (const block of workspace.blocks || []) {
    if (!String(block.id || "")) issues.push({ code: "missing-workspace-block-id" });
  }
  for (const edge of workspace.edges || []) {
    if (!nodeIds.has(String(edge.source || ""))) issues.push({ code: "workspace-edge-missing-source", edgeId: edge.id, nodeId: edge.source });
    if (!nodeIds.has(String(edge.target || ""))) issues.push({ code: "workspace-edge-missing-target", edgeId: edge.id, nodeId: edge.target });
  }
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      nodeCount: workspace.nodes?.length || 0,
      edgeCount: workspace.edges?.length || 0,
      groupCount: workspace.groups?.length || 0,
    },
  };
}

export function applyModelWorkspaceOperation(workspace = {}, operation = {}) {
  const next = clone(workspace);
  const diagnostics = [];
  const type = String(operation.type || "");
  if (type === "rename-node") {
    const node = findNode(next, operation.nodeId, diagnostics);
    if (node) node.label = String(operation.label || node.label);
  } else if (type === "update-node") {
    const node = findNode(next, operation.nodeId, diagnostics);
    if (node) {
      const patch = operation.patch && typeof operation.patch === "object" ? operation.patch : {};
      for (const key of ["op", "family", "label", "subtitle", "status"]) {
        if (patch[key] !== undefined) node[key] = String(patch[key]);
      }
      if (patch.shape !== undefined) node.shape = normalizeShape(patch.shape);
    }
  } else if (type === "set-node-visibility") {
    const node = findNode(next, operation.nodeId, diagnostics);
    if (node) node.visible = operation.visible !== false;
  } else if (type === "move-node") {
    const node = findNode(next, operation.nodeId, diagnostics);
    if (node) {
      const ui = operation.ui || {};
      const current = node.ui || {};
      const x = Number(ui.x);
      const y = Number(ui.y);
      const w = Number.isFinite(Number(ui.w)) ? Number(ui.w) : Number(current.w);
      const h = Number.isFinite(Number(ui.h)) ? Number(ui.h) : Number(current.h);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        diagnostics.push({ code: "workspace-node-move-invalid", nodeId: node.id });
      } else {
        node.ui = {
          ...current,
          x,
          y,
          ...(Number.isFinite(w) ? { w } : {}),
          ...(Number.isFinite(h) ? { h } : {}),
        };
      }
    }
  } else if (type === "add-edge") {
    const edge = {
      id: String(operation.edge?.id || `edge-${next.edges.length + 1}`),
      source: String(operation.edge?.source || ""),
      target: String(operation.edge?.target || ""),
      type: String(operation.edge?.type || "signal"),
      label: String(operation.edge?.label || ""),
      visible: operation.edge?.visible !== false,
      confidence: Number.isFinite(operation.edge?.confidence) ? operation.edge.confidence : 1,
      evidence: clone(operation.edge?.evidence || []),
    };
    if (!nodeIdSet(next).has(edge.source) || !nodeIdSet(next).has(edge.target)) {
      diagnostics.push({ code: "workspace-edge-endpoint-missing", edgeId: edge.id, source: edge.source, target: edge.target });
    } else {
      next.edges.push(edge);
    }
  } else if (type === "remove-edge") {
    const before = next.edges.length;
    next.edges = next.edges.filter((edge) => String(edge.id) !== String(operation.edgeId || ""));
    if (next.edges.length === before) diagnostics.push({ code: "workspace-edge-not-found", edgeId: operation.edgeId });
  } else if (type === "set-figure") {
    next.figure = { ...(next.figure || {}), ...(operation.figure || {}) };
  } else if (type === "set-node-group") {
    setNodeGroup(next, operation, diagnostics);
  } else if (type === "set-block-expanded" || type === "set-block-locked") {
    setBlockPreference(next, operation, diagnostics);
  } else {
    diagnostics.push({ code: "unsupported-workspace-operation", operationType: type });
  }
  next.revision = Number(next.revision || 0) + 1;
  next.diagnostics = diagnostics;
  return { workspace: next, diagnostics };
}

export function modelWorkspaceToIR(workspace = {}) {
  const groupById = new Map((workspace.groups || []).map((group) => [String(group.id), group]));
  const firstGroupByNode = new Map();
  for (const group of workspace.groups || []) {
    for (const nodeId of group.nodeIds || []) {
      if (!firstGroupByNode.has(String(nodeId))) firstGroupByNode.set(String(nodeId), String(group.id));
    }
  }
  return normalizeNetworkIR({
    version: "universal-neural-ir/v1",
    figure: workspace.figure,
    nodes: (workspace.nodes || []).map((node) => ({
      id: node.id,
      op: node.op,
      family: node.family,
      label: node.label,
      subtitle: node.subtitle,
      shape: node.shape,
      confidence: node.confidence,
      status: node.status,
      evidence: node.evidence,
      containerId: firstGroupByNode.get(String(node.id)),
      attributes: {
        workspaceVisible: node.visible !== false,
        workspaceLocked: node.locked === true,
        ...(normalizeWorkspaceUi(node.ui) ? { workspaceUi: normalizeWorkspaceUi(node.ui) } : {}),
      },
    })),
    edges: (workspace.edges || []).filter((edge) => edge.visible !== false).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      label: edge.label,
      confidence: edge.confidence,
      ...(Array.isArray(edge.evidence) && edge.evidence.length ? { evidence: clone(edge.evidence) } : {}),
    })),
    groups: (workspace.groups || []).map((group) => ({
      id: group.id,
      label: group.label,
      kind: group.kind,
      nodeIds: group.nodeIds,
      expandable: group.expandable,
    })),
    containers: clone(workspace.containers || []),
    lanes: clone(workspace.lanes || []),
    constraints: clone(workspace.constraints || []),
    diagnostics: clone(workspace.diagnostics || []),
    blockOverrides: clone(workspace.blockOverrides || Object.fromEntries((workspace.blocks || []).map((block) => [
      String(block.id),
      { expanded: block.expanded === true, locked: block.locked === true },
    ]))),
  });
}

export function validateModelWorkspaceIRRoundtrip(workspace = {}) {
  const ir = modelWorkspaceToIR(workspace);
  const validation = validateNetworkIR(ir);
  return { ok: validation.ok, ir, validation };
}

function setNodeGroup(workspace, operation, diagnostics) {
  const node = findNode(workspace, operation.nodeId, diagnostics);
  if (!node) return;
  const groupId = String(operation.groupId || "");
  if (groupId && !(workspace.groups || []).some((group) => String(group.id) === groupId)) {
    diagnostics.push({ code: "workspace-group-not-found", groupId });
    return;
  }
  node.groupIds = groupId ? [groupId] : [];
  for (const group of workspace.groups || []) {
    const ids = new Set(group.nodeIds || []);
    if (String(group.id) === groupId) ids.add(String(node.id));
    else ids.delete(String(node.id));
    group.nodeIds = [...ids];
  }
}

function setBlockPreference(workspace, operation, diagnostics) {
  const block = (workspace.blocks || []).find((item) => String(item.id) === String(operation.blockId || ""));
  if (!block) {
    diagnostics.push({ code: "workspace-block-not-found", blockId: operation.blockId });
    return;
  }
  if (operation.type === "set-block-expanded") block.expanded = operation.expanded === true;
  if (operation.type === "set-block-locked") {
    block.locked = operation.locked === true;
    if (block.locked) block.expanded = false;
  }
  workspace.blockOverrides = Object.fromEntries((workspace.blocks || []).map((item) => [
    String(item.id),
    { expanded: item.expanded === true, locked: item.locked === true },
  ]));
}

function findNode(workspace, nodeId, diagnostics) {
  const node = (workspace.nodes || []).find((item) => String(item.id) === String(nodeId || ""));
  if (!node) diagnostics.push({ code: "workspace-node-not-found", nodeId });
  return node;
}

function membershipIndex(groups = []) {
  const index = new Map();
  for (const group of groups) {
    for (const nodeId of group.nodeIds || []) {
      const id = String(nodeId);
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(String(group.id));
    }
  }
  return index;
}

function visualNodeIndex(input = {}) {
  const index = new Map();
  const plan = input.visioDiagramPlan;
  for (const node of plan?.nodes || []) {
    const id = String(node.sourceNodeId || node.id || "");
    if (!id || String(node.id || "").startsWith("label:")) continue;
    const x = Number(node.x);
    const y = Number(node.y);
    const w = Number(node.w);
    const h = Number(node.h);
    if ([x, y, w, h].every(Number.isFinite)) {
      index.set(id, { x, y, w, h, shapeKind: String(node.shapeKind || "") });
    }
  }
  return index;
}

function nodeIdSet(workspace) {
  return new Set((workspace.nodes || []).map((node) => String(node.id)));
}

function normalizeShape(shape) {
  if (Array.isArray(shape)) return { output: shape.map(String) };
  if (!shape || typeof shape !== "object") return { output: [String(shape)] };
  return { ...shape, ...(shape.output ? { output: shape.output.map(String) } : {}) };
}

function normalizeWorkspaceUi(ui) {
  if (!ui || typeof ui !== "object") return null;
  const x = Number(ui.x);
  const y = Number(ui.y);
  const w = Number(ui.w);
  const h = Number(ui.h);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
