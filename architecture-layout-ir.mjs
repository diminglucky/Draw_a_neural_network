import { compileVisioLayoutTree } from "./visio-layout-tree.mjs";

const SPATIAL_LANE_KIND = "spatial-scale";

export function compileArchitectureLayout(ir = {}) {
  const sourceNodes = Array.isArray(ir.nodes) ? ir.nodes : [];
  const sourceEdges = Array.isArray(ir.edges) ? ir.edges : [];
  const nodes = sourceNodes.map((node, index) => compileNode(node, index));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const lanes = compileLanes(ir, nodes);
  const laneByNodeId = new Map();
  for (const node of nodes) {
    const key = node.laneId || spatialLaneKey(node);
    if (!key) continue;
    const lane = lanes.find((item) => item.key === key || item.id === key);
    if (lane) laneByNodeId.set(node.id, lane.id);
  }
  const containers = compileContainers(ir, nodes);
  const nodeAssignments = nodes.map((node) => ({
    nodeId: node.id,
    containerId: node.containerId || containerForNode(containers, node.id),
    laneId: laneByNodeId.get(node.id) || "",
  }));
  const edges = sourceEdges.map((edge, index) => compileEdge(edge, index, nodeById, laneByNodeId));
  const treeContainers = containersForLayoutTree(containers, nodes, laneByNodeId);
  const rootContainerId = treeContainers.find((container) => !container.parentId)?.id || treeContainers[0]?.id || "root";
  const assignmentByNodeId = new Map(nodeAssignments.map((assignment) => [assignment.nodeId, assignment]));
  const containerTree = compileVisioLayoutTree({
    nodes: nodes.map((node) => ({
      ...node,
      containerId: assignmentByNodeId.get(node.id)?.containerId || node.containerId,
      laneId: assignmentByNodeId.get(node.id)?.laneId || node.laneId,
      laneContainerId: rootContainerId,
    })),
    containers: treeContainers,
    lanes: lanes.map((lane) => ({ ...lane, containerId: rootContainerId })),
    edges,
  });

  return {
    version: "architecture-layout-ir/v1",
    projection: String(ir.projection || ir.layout?.projection || "overview"),
    features: {
      ...compileFeatures(nodes, edges, containers, lanes),
      explicitContainers: Array.isArray(ir.containers) && ir.containers.length > 0,
    },
    containers,
    lanes,
    nodes,
    nodeAssignments,
    edges,
    constraints: compileConstraints(containers, lanes, nodeAssignments),
    containerTree,
  };
}

function containersForLayoutTree(containers, nodes, laneByNodeId) {
  let projected = containers.map((container) => {
    const sourceLaneIds = new Set(container.children.map((nodeId) => laneByNodeId.get(String(nodeId))).filter(Boolean));
    const inferredScaleStack = container.direction === "flow" && sourceLaneIds.size > 1;
    return { ...container, direction: inferredScaleStack ? "vertical" : container.direction };
  });
  const roots = projected.filter((container) => !container.parentId);
  if (roots.length <= 1) return projected;
  const rootId = "__layout_root__";
  projected = projected.map((container) => roots.some((root) => root.id === container.id)
    ? { ...container, parentId: rootId }
    : container);
  return [{
    id: rootId,
    label: "Architecture",
    kind: "root",
    direction: "horizontal",
    children: roots.map((container) => container.id),
    parentId: "",
    padding: 28,
    gap: 48,
    evidence: [],
  }, ...projected];
}

function compileNode(node = {}, index = 0) {
  const id = String(node.id || node.sourceNodeId || `node-${index + 1}`);
  return {
    id,
    label: String(node.label || node.op || id),
    family: String(node.family || "custom"),
    op: String(node.op || node.label || "Operator"),
    containerId: String(node.containerId || node.groupId || node.moduleId || ""),
    laneId: String(node.laneId || ""),
    stage: finiteOr(node.stage, index),
    order: finiteOr(node.order, index),
    ports: clonePorts(node.ports),
    shape: cloneValue(node.shape),
    repeat: cloneValue(node.repeat),
    repeatCount: Math.max(1, finiteOr(node.repeatCount, finiteOr(node.repeat?.count, 1))),
    evidence: cloneValue(node.evidence || []),
  };
}

function compileContainers(ir = {}, nodes = []) {
  const explicit = Array.isArray(ir.containers) ? ir.containers : [];
  const fromGroups = Array.isArray(ir.groups)
    ? ir.groups.map((group) => ({
      id: group.id || group.label,
      label: group.label || group.id,
      kind: group.kind || "module",
      direction: group.direction || "vertical",
      children: group.children || group.nodeIds || [],
      evidence: group.evidence || [],
    }))
    : [];
  const containers = [...explicit, ...fromGroups].map((container, index) => normalizeContainer(container, index));
  const known = new Set(containers.map((container) => container.id));
  const missingContainerIds = [...new Set(nodes.map((node) => node.containerId).filter(Boolean))]
    .filter((id) => !known.has(id));
  for (const id of missingContainerIds) {
    containers.push(normalizeContainer({
      id,
      label: titleize(id),
      kind: "module",
      direction: "vertical",
      children: nodes.filter((node) => node.containerId === id).map((node) => node.id),
      evidence: [],
    }, containers.length));
  }
  if (!containers.length) {
    containers.push(normalizeContainer({
      id: "root",
      label: "Architecture",
      kind: "root",
      direction: "horizontal",
      children: nodes.map((node) => node.id),
      evidence: [],
    }, 0));
  }
  return containers;
}

function normalizeContainer(container = {}, index = 0) {
  return {
    id: String(container.id || `container-${index + 1}`),
    label: String(container.label || container.id || `Container ${index + 1}`),
    kind: String(container.kind || "module"),
    direction: normalizeDirection(container.direction),
    children: Array.isArray(container.children) ? container.children.map(String) : [],
    parentId: String(container.parentId || ""),
    padding: finiteOr(container.padding, 28),
    gap: finiteOr(container.gap, 22),
    evidence: cloneValue(container.evidence || []),
  };
}

function compileLanes(ir = {}, nodes = []) {
  const explicit = Array.isArray(ir.lanes) ? ir.lanes : [];
  const keys = [...new Set(nodes.map(spatialLaneKey).filter(Boolean))];
  keys.sort((left, right) => {
    const leftArea = spatialArea(left);
    const rightArea = spatialArea(right);
    return rightArea - leftArea || left.localeCompare(right);
  });
  const inferred = keys.map((key, index) => ({
    id: `lane-${key.toLowerCase().replace(/[^a-z0-9]+/g, "x")}`,
    kind: SPATIAL_LANE_KIND,
    key,
    order: index,
    label: key.replace("x", " x "),
  }));
  const lanes = explicit.map((lane, index) => ({
    id: String(lane.id || `lane-${index + 1}`),
    kind: String(lane.kind || "semantic-lane"),
    key: String(lane.key || lane.id || `lane-${index + 1}`),
    order: finiteOr(lane.order, index),
    label: String(lane.label || lane.key || lane.id || `Lane ${index + 1}`),
  }));
  const existingKeys = new Set(lanes.map((lane) => lane.key));
  return [...lanes, ...inferred.filter((lane) => !existingKeys.has(lane.key))]
    .map((lane, index) => ({ ...lane, order: finiteOr(lane.order, index) }))
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
}

function compileEdge(edge = {}, index = 0, nodeById = new Map(), laneByNodeId = new Map()) {
  const id = String(edge.id || edge.sourceEdgeId || `edge-${index + 1}`);
  const source = String(edge.source || "");
  const target = String(edge.target || "");
  const sourceNode = nodeById.get(source);
  const targetNode = nodeById.get(target);
  const sourceLane = laneByNodeId.get(source) || "";
  const targetLane = laneByNodeId.get(target) || "";
  return {
    id,
    source,
    target,
    type: String(edge.type || "signal"),
    sourcePort: String(edge.sourcePort || edge.ports?.source || ""),
    targetPort: String(edge.targetPort || edge.ports?.target || ""),
    ports: {
      source: String(edge.sourcePort || edge.ports?.source || ""),
      target: String(edge.targetPort || edge.ports?.target || ""),
    },
    sourceContainerId: String(sourceNode?.containerId || ""),
    targetContainerId: String(targetNode?.containerId || ""),
    sourceLaneId: sourceLane,
    targetLaneId: targetLane,
    routeClass: routeClassFor(edge, nodeById.get(source), nodeById.get(target), sourceLane, targetLane),
    evidence: cloneValue(edge.evidence || []),
  };
}

function routeClassFor(edge = {}, sourceNode, targetNode, sourceLane = "", targetLane = "") {
  const type = String(edge.routeClass || edge.type || "").toLowerCase();
  if (/feedback|loop|recurrent|state/.test(type)) return "feedback";
  if (/residual|shortcut/.test(type)) return "residual";
  if (/skip/.test(type)) return "skip";
  if (/branch/.test(type)) return "branch";
  if (/merge|concat/.test(type)) return "merge";
  if (sourceLane && targetLane && sourceLane !== targetLane) return "scale-transfer";
  if (sourceNode?.containerId && targetNode?.containerId && sourceNode.containerId !== targetNode.containerId) return "cross-container";
  return "main-flow";
}

function compileFeatures(nodes = [], edges = [], containers = [], lanes = []) {
  const incoming = new Map();
  const outgoing = new Map();
  edges.forEach((edge) => {
    outgoing.set(edge.source, (outgoing.get(edge.source) || 0) + 1);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  });
  return {
    linear: nodes.length > 0 && edges.every((edge) => edge.routeClass === "main-flow") && [...incoming.values(), ...outgoing.values()].every((count) => count <= 1),
    branching: [...outgoing.values()].some((count) => count > 1) || edges.some((edge) => edge.routeClass === "branch"),
    merging: [...incoming.values()].some((count) => count > 1) || edges.some((edge) => ["merge", "skip", "scale-transfer"].includes(edge.routeClass)),
    multiScale: lanes.filter((lane) => lane.kind === SPATIAL_LANE_KIND).length > 1,
    hasMultipleLanes: lanes.length > 1,
    hasSpatialScaleLanes: lanes.some((lane) => lane.kind === SPATIAL_LANE_KIND),
    nestedModules: containers.some((container) => container.parentId),
    repeatedBlocks: nodes.some((node) => node.repeat || finiteOr(node.repeatCount, 1) > 1),
    multipleOutputs: nodes.filter((node) => (outgoing.get(node.id) || 0) === 0).length > 1,
    recurrent: edges.some((edge) => edge.routeClass === "feedback"),
  };
}

function compileConstraints(containers = [], lanes = [], assignments = []) {
  return [
    ...containers.map((container) => ({ type: "contain", priority: "hard", container: container.id, members: [...container.children] })),
    ...lanes.map((lane) => ({
      type: "same-lane",
      priority: "strong",
      lane: lane.id,
      members: assignments.filter((item) => item.laneId === lane.id).map((item) => item.nodeId),
    })).filter((constraint) => constraint.members.length > 0),
  ];
}

function containerForNode(containers = [], nodeId = "") {
  const container = containers.find((item) => item.children.includes(nodeId));
  return container?.id || "";
}

function spatialLaneKey(node = {}) {
  if (node.laneId) return "";
  const dimensions = spatialDimensions(node.shape);
  if (dimensions.length < 2) return "";
  const h = Number(dimensions[0]);
  const w = Number(dimensions[1]);
  if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return "";
  return `${Math.round(h)}x${Math.round(w)}`;
}

function spatialDimensions(shape = {}) {
  if (Array.isArray(shape?.dimensions)) return shape.dimensions;
  if (Array.isArray(shape?.output)) return shape.output;
  return [];
}

function spatialArea(key = "") {
  const [h, w] = key.split("x").map(Number);
  return Number.isFinite(h) && Number.isFinite(w) ? h * w : 0;
}

function normalizeDirection(value) {
  const text = String(value || "").toLowerCase();
  if (["horizontal", "vertical", "grid", "flow", "stack"].includes(text)) return text;
  return "flow";
}

function clonePorts(ports = {}) {
  return {
    inputs: Array.isArray(ports?.inputs) ? ports.inputs.map(String) : [],
    outputs: Array.isArray(ports?.outputs) ? ports.outputs.map(String) : [],
  };
}

function titleize(value = "") {
  return String(value).replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}
