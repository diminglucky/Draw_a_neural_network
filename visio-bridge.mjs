import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compileSemanticVisualNode } from "./semantic-visual-grammar.mjs";
import { getCompoundLayout } from "./compound-module.mjs";
import { figurePlanForVisio } from "./figure-plan.mjs";

const BRIDGE_VERSION = "visio-native-bridge/v1";

export function buildVisioRenderPlan(inputLayout = {}, options = {}) {
  const documentPath = String(options.documentPath || "").trim();
  if (!documentPath) throw new Error("documentPath is required; Visio rendering never creates an implicit document.");
  const layout = String(inputLayout?.version || "").startsWith("figure-plan/")
    ? figurePlanForVisio(inputLayout, options)
    : inputLayout;
  const pageName = String(options.pageName || "Page-1");
  const renderId = String(options.renderId || stableRenderId(documentPath, pageName));
  const grammarId = String(layout.grammar?.id || "generic-dag");
  const shapes = [];
  const innerShapeIds = new Map();
  const outerShapeIds = new Map();
  const recurrentRailConnectors = [];

  for (const node of Array.isArray(layout.nodes) ? layout.nodes : []) {
    const shapeId = `outer::${node.id}`;
    outerShapeIds.set(String(node.id || ""), shapeId);
    if (node.sourceNodeId) outerShapeIds.set(String(node.sourceNodeId), shapeId);
    const recurrentLayout = node.recurrentLayout;
    if (!recurrentLayout) {
      shapes.push(shapePlan(node, {
        id: shapeId,
        parentNodeId: "",
        grammarId,
        renderId,
        shapeKind: node.shapeKind || node.representation || node.family || "operator",
      }));
    }
    if (recurrentLayout) {
      for (const instance of Array.isArray(recurrentLayout.instances) ? recurrentLayout.instances : []) {
        const recurrentUnresolved = Boolean(instance.expanded && recurrentLayout.uncertainty?.unresolved);
        shapes.push(shapePlan({
          ...node,
          id: `${node.id}::${instance.id}`,
          x: Number.isFinite(instance.x) ? Number(instance.x) : Number(node.x || 0),
          y: Number.isFinite(instance.y) ? Number(instance.y) : Number(node.y || 0),
          w: Number(instance.w || node.w || 120),
          h: Number(instance.h || node.h || 80),
          label: instance.role === "expanded" ? node.label : "shared step",
          subtitle: instance.role === "expanded" ? node.subtitle : instance.role,
          sourceNodeId: node.sourceNodeId || node.id,
          recurrentInstanceRole: instance.role,
          recurrentExpanded: Boolean(instance.expanded),
          ...(recurrentUnresolved ? { visualRole: "unresolved-module", shapeKind: "unresolved-module" } : {}),
          unresolvedReason: instance.expanded && recurrentLayout.uncertainty?.unresolved
            ? recurrentLayout.uncertainty.reason
            : "",
        }, {
          id: `recurrent-instance::${node.id}::${instance.role}`,
          parentNodeId: node.id,
          grammarId,
          renderId,
          shapeKind: recurrentUnresolved ? "unresolved-module" : "recurrent-instance",
        }));
      }
      for (const rail of Array.isArray(recurrentLayout.stateRails) ? recurrentLayout.stateRails : []) {
        recurrentRailConnectors.push({
          id: `recurrent-rail::${node.id}::${rail.id}`,
          source: String(node.sourceNodeId || node.id),
          target: String(node.sourceNodeId || node.id),
          type: "state",
          label: rail.kind || "carry",
          points: Array.isArray(rail.points) ? rail.points.map((point) => ({
            x: Number.isFinite(point.x) ? Number(point.x) : Number(node.x || 0),
            y: Number.isFinite(point.y) ? Number(point.y) : Number(node.y || 0),
          })) : [],
          renderId,
          sourceEdgeId: String(rail.sourceEdgeId || rail.id),
          sourceEndpointIds: normalizeEndpointIds(rail.sourceEndpointIds),
          sourceNodeId: String(node.sourceNodeId || node.id),
          targetNodeId: String(node.sourceNodeId || node.id),
          sourceShapeId: `recurrent-instance::${node.id}::previous`,
          targetShapeId: `recurrent-instance::${node.id}::next`,
          sourceInstanceId: `recurrent-instance::${node.id}::previous`,
          targetInstanceId: `recurrent-instance::${node.id}::next`,
          recurrentRailKind: String(rail.kind || "carry"),
        });
      }
    }
    const compoundLayout = node.recurrentLayout ? getCompoundLayout(node) : null;
    const innerNodes = node.renderInternalGraph === false || recurrentLayout?.uncertainty?.unresolved
      ? []
      : Array.isArray(node.inner?.nodes) ? node.inner.nodes
        : compoundLayout?.kind === "recurrent" ? compoundLayout.children : [];
    for (const child of innerNodes) {
      const innerId = `inner::${node.id}::${child.id}`;
      innerShapeIds.set(`${node.id}::${child.id}`, innerId);
      shapes.push(shapePlan({
        ...child,
        x: node.x + 20 + child.x,
        y: node.y + 36 + child.y,
        parentNodeId: node.id,
        semanticRole: child.semanticRole || "internal_operator",
        confidence: child.confidence ?? node.confidence,
        evidence: child.evidence || node.evidence,
      }, {
        id: innerId,
        parentNodeId: node.id,
        grammarId,
        renderId,
        shapeKind: "inner-operator",
      }));
    }
  }

  const connectors = [...recurrentRailConnectors];
  const recurrentExpandedShapeIds = new Map();
  for (const node of Array.isArray(layout.nodes) ? layout.nodes : []) {
    if (node.recurrentLayout) recurrentExpandedShapeIds.set(String(node.id), `recurrent-instance::${node.id}::expanded`);
  }
  for (const edge of Array.isArray(layout.edges) ? layout.edges : []) {
    const points = Array.isArray(edge.route?.points) ? edge.route.points : [];
    connectors.push({
      id: `outer-edge::${edge.id}`,
      source: String(edge.sourceNodeId || edge.source),
      target: String(edge.targetNodeId || edge.target),
      type: edge.type || "signal",
      label: edge.label || "",
      points,
      renderId,
      sourceEdgeId: String(edge.sourceEdgeId || edge.id),
      sourceNodeId: String(edge.sourceNodeId || edge.source),
      targetNodeId: String(edge.targetNodeId || edge.target),
      sourceEndpointIds: normalizeEndpointIds(edge.sourceEndpointIds),
      sourceShapeId: recurrentExpandedShapeIds.get(String(edge.source || edge.sourceNodeId))
        || outerShapeIds.get(String(edge.source || edge.sourceNodeId))
        || `outer::${String(edge.source || edge.sourceNodeId)}`,
      targetShapeId: recurrentExpandedShapeIds.get(String(edge.target || edge.targetNodeId))
        || outerShapeIds.get(String(edge.target || edge.targetNodeId))
        || `outer::${String(edge.target || edge.targetNodeId)}`,
      evidenceCount: Array.isArray(edge.evidence) ? edge.evidence.length : 0,
    });
  }
  for (const node of Array.isArray(layout.nodes) ? layout.nodes : []) {
    const innerEdges = Array.isArray(node.inner?.edges) ? node.inner.edges : [];
    const recurrentInnerEdges = node.recurrentLayout ? getCompoundLayout(node).edges : [];
    for (const edge of [...innerEdges, ...recurrentInnerEdges]) {
      const source = innerShapeIds.get(`${node.id}::${edge.source}`);
      const target = innerShapeIds.get(`${node.id}::${edge.target}`);
      if (!source || !target) continue;
      const sourceShape = shapes.find((shape) => shape.id === source);
      const targetShape = shapes.find((shape) => shape.id === target);
      connectors.push({
        id: `inner-edge::${node.id}::${edge.id}`,
        source,
        target,
        type: edge.type || "signal",
        label: edge.label || "",
        points: [
          { x: sourceShape.x + sourceShape.w, y: sourceShape.y + sourceShape.h / 2 },
          { x: targetShape.x, y: targetShape.y + targetShape.h / 2 },
        ],
        renderId,
        sourceNodeId: node.id,
        targetNodeId: node.id,
        sourceShapeId: source,
        targetShapeId: target,
        sourceEdgeId: String(edge.sourceEdgeId || edge.id),
        sourceEndpointIds: normalizeEndpointIds(edge.sourceEndpointIds || edge.ports),
        evidence: Array.isArray(edge.evidence) ? edge.evidence : [],
        confidence: Number.isFinite(edge.confidence) ? edge.confidence : 1,
        evidenceCount: Array.isArray(edge.evidence) ? edge.evidence.length : 0,
      });
    }
  }

  return {
    version: BRIDGE_VERSION,
    documentPath,
    pageName,
    createDocument: false,
    preserveExisting: true,
    replaceScope: String(options.replaceLegacyPrefix || "").trim() ? "agent-owned+legacy-prefix" : "agent-owned",
    replaceLegacyPrefix: String(options.replaceLegacyPrefix || "").trim() || undefined,
    openMode: String(options.openMode || "attach"),
    previewPath: String(options.previewPath || "").trim() || undefined,
    renderId,
    unitScale: Number.isFinite(options.unitScale) ? options.unitScale : 0.0065,
    artboard: layout.artboard || { x: 0, y: 0, width: 2260, height: 1060 },
    grammarId,
    figure: layout.figure || {},
    groups: (Array.isArray(layout.groups) ? layout.groups : []).map((group) => ({ ...group, renderId })),
    shapes,
    connectors,
  };
}

export function buildVisioPowerShellCommand(plan, options = {}) {
  const scriptPath = String(options.scriptPath || "").trim();
  if (!scriptPath) throw new Error("scriptPath is required.");
  const encodedPlan = Buffer.from(JSON.stringify(plan), "utf8").toString("base64");
  return {
    file: "powershell.exe",
    // Keep the stable -PlanBase64 contract while transporting the payload over
    // stdin. Windows command lines are too small for a real VGG/Transformer
    // Universal IR once Shape Data and internal topology are included.
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-PlanBase64", "__STDIN__"],
    stdin: encodedPlan,
  };
}

export async function renderUniversalFigureToVisio(layout, options = {}) {
  const plan = buildVisioRenderPlan(layout, options);
  const command = buildVisioPowerShellCommand(plan, {
    scriptPath: options.scriptPath || fileURLToPath(new URL("./visio-bridge.ps1", import.meta.url)),
  });
  const runner = options.runner || runPowerShell;
  const result = await runner(command);
  const readbackValidation = validateVisioReadback(plan, result.readback || result);
  return {
    plan,
    ...result,
    status: result.status === "rendered" && !readbackValidation.ok ? "readback_failed" : result.status,
    readbackValidation,
  };
}

export function validateVisioReadback(plan = {}, readback = {}) {
  const expected = [...new Set((plan.shapes || []).map((shape) => String(shape.shapeData?.sourceNodeId || "")).filter(Boolean))].sort();
  const actual = [...new Set((readback.sourceNodeIds || []).map(String))].sort();
  const actualSet = new Set(actual);
  const missingSourceNodeIds = expected.filter((id) => !actualSet.has(id));
  const expectedEdgeIds = [...new Set((plan.connectors || []).map((edge) => String(edge.id || "")).filter(Boolean))].sort();
  const actualEdgeIds = [...new Set((readback.edgeIds || []).map(String))].sort();
  const actualEdgeSet = new Set(actualEdgeIds);
  const missingEdgeIds = expectedEdgeIds.filter((id) => !actualEdgeSet.has(id));
  const glueReported = Array.isArray(readback.gluedBeginEdgeIds) || Array.isArray(readback.gluedEndEdgeIds);
  const gluedBegin = new Set((readback.gluedBeginEdgeIds || []).map(String));
  const gluedEnd = new Set((readback.gluedEndEdgeIds || []).map(String));
  const missingGluedBeginEdgeIds = glueReported ? expectedEdgeIds.filter((id) => !gluedBegin.has(id)) : [];
  const missingGluedEndEdgeIds = glueReported ? expectedEdgeIds.filter((id) => !gluedEnd.has(id)) : [];
  const actualConnectors = Array.isArray(readback.connectors)
    ? readback.connectors
    : Object.values(readback.connectorEndpoints || {});
  const actualConnectorBySourceEdgeId = new Map();
  for (const connector of actualConnectors) {
    const sourceEdgeId = String(connector?.sourceEdgeId || "");
    if (sourceEdgeId && !actualConnectorBySourceEdgeId.has(sourceEdgeId)) {
      actualConnectorBySourceEdgeId.set(sourceEdgeId, connector);
    }
  }
  const endpointMismatches = [];
  for (const edge of plan.connectors || []) {
    const expectedEndpoints = edge.sourceEndpointIds || {};
    if (!expectedEndpoints.source && !expectedEndpoints.target) continue;
    const sourceEdgeId = String(edge.sourceEdgeId || "");
    const actualConnector = actualConnectorBySourceEdgeId.get(sourceEdgeId);
    if (!actualConnector) {
      endpointMismatches.push({ sourceEdgeId, reason: "missing-connector-endpoint-readback" });
      continue;
    }
    for (const [side, property] of [["source", "sourceEndpointId"], ["target", "targetEndpointId"]]) {
      if (expectedEndpoints[side] && String(actualConnector[property] || "") !== String(expectedEndpoints[side])) {
        endpointMismatches.push({
          sourceEdgeId,
          side,
          expected: String(expectedEndpoints[side]),
          actual: String(actualConnector[property] || ""),
          reason: "endpoint-identity-mismatch",
        });
      }
    }
  }
  const renderIdMatches = String(readback.renderId || "") === String(plan.renderId || "");
  return {
    ok: renderIdMatches && missingSourceNodeIds.length === 0 && missingEdgeIds.length === 0
      && missingGluedBeginEdgeIds.length === 0 && missingGluedEndEdgeIds.length === 0
      && endpointMismatches.length === 0,
    renderIdMatches,
    expectedSourceNodeIds: expected,
    actualSourceNodeIds: actual,
    missingSourceNodeIds,
    expectedEdgeIds,
    actualEdgeIds,
    missingEdgeIds,
    connectivityValidated: glueReported,
    missingGluedBeginEdgeIds,
    missingGluedEndEdgeIds,
    endpointMismatches,
  };
}

function normalizeEndpointIds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const normalized = {};
  for (const key of ["source", "target"]) {
    if (value[key] !== undefined && value[key] !== null && String(value[key])) normalized[key] = String(value[key]);
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    if (typeof command.stdin === "string") {
      child.stdin.end(command.stdin, "utf8");
    } else {
      child.stdin.end();
    }
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Visio bridge failed with exit code ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Visio bridge returned invalid JSON: ${error.message}; output=${stdout}`));
      }
    });
  });
}

export async function createEmptyVisioDocument(targetPath, options = {}) {
  const scriptPath = String(options.scriptPath || fileURLToPath(new URL("./visio-create-empty.ps1", import.meta.url))).trim();
  if (!scriptPath) throw new Error("scriptPath is required.");
  const encoded = Buffer.from(String(targetPath), "utf8").toString("base64");
  const command = {
    file: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-TargetPathBase64", "__STDIN__"],
    stdin: encoded,
  };
  const runner = options.runner || runPowerShell;
  return runner(command);
}

function shapePlan(node, options) {
  const semantic = compileSemanticVisualNode(node);
  const visualRole = String(node.visualRole || semantic.visualRole || options.shapeKind || "operator");
  const styleProfile = String(node.styleProfile || semantic.styleProfile || "operator");
  const labelSlots = node.labelSlots || semantic.labelSlots;
  const geometryData = node.geometryData || node.geometry?.data || semantic.geometryData || {};
  const inputGrammar = node.inputGrammar || semantic.inputGrammar;
  const isInputRole = visualRole.endsWith("-input");
  return {
    id: options.id,
    x: Number(node.x ?? node.geometry?.x) || 0,
    y: Number(node.y ?? node.geometry?.y) || 0,
    w: Number(node.w ?? node.geometry?.width) || 120,
    h: Number(node.h ?? node.geometry?.height) || 80,
    label: String(node.figureLabel || node.label || node.op || "Operator"),
    subtitle: String(node.figureSubtitle || node.subtitle || ""),
    shapeKind: isInputRole ? visualRole : options.shapeKind,
    visualRole,
    styleProfile,
    labelSlots,
    geometryData,
    ...(inputGrammar ? { inputGrammar } : {}),
    labelOutside: options.parentNodeId === "",
    parentNodeId: options.parentNodeId,
    fill: String(node.color || "#A855F7"),
    line: String(node.lineColor || "#263248"),
    ...(node.junctionRole ? { junctionRole: String(node.junctionRole) } : {}),
    shapeData: {
      renderId: options.renderId,
      sourceNodeId: String(node.sourceNodeId || node.id || ""),
      sourceNodeIds: Array.isArray(node.sourceNodeIds) ? node.sourceNodeIds.map(String) : [String(node.sourceNodeId || node.id || "")],
      parentNodeId: options.parentNodeId,
      visualRole: isInputRole ? visualRole : String(node.visualRole || options.shapeKind || node.family || "operator"),
      semanticRole: visualRole,
      styleProfile,
      inputGrammar: inputGrammar?.kind || geometryData.inputGrammar || "",
      modalityReason: inputGrammar?.reason || geometryData.modalityReason || "",
      tensorRank: inputGrammar?.tensorRank ?? geometryData.tensorRank ?? "",
      labelTitleSlot: String(labelSlots.title || "above"),
      labelSubtitleSlot: String(labelSlots.subtitle || "below"),
      labelTensorShapeSlot: String(labelSlots.tensorShape || "below"),
      labelOperatorDetailsSlot: String(labelSlots.operatorDetails || "outside"),
      labelOutside: options.parentNodeId === "",
      layerRole: String(node.semanticRole || "feature_transform"),
      tensorShape: shapeText(node.shape),
      operatorFamily: String(node.family || node.type || node.op || ""),
      inputPorts: Array.isArray(node.ports?.inputs) ? node.ports.inputs.map(String).join("|") : "",
      outputPorts: Array.isArray(node.ports?.outputs) ? node.ports.outputs.map(String).join("|") : "",
      operatorLabels: Array.isArray(geometryData.internalOperatorLabels)
        ? geometryData.internalOperatorLabels.join("|")
        : String(geometryData.operatorLabels || ""),
      repeatCount: geometryData.repeatCount ?? node.repeatCount ?? node.layers ?? "",
      spatialSize: geometryData.spatialSize ?? "",
      channelCount: geometryData.channelCount ?? "",
      preferredWidth: geometryData.preferredWidth ?? "",
      preferredHeight: geometryData.preferredHeight ?? "",
      sourceHeight: geometryData.sourceHeight ?? "",
      targetHeight: geometryData.targetHeight ?? "",
      sourceAnchor: geometryData.sourceAnchor ?? "",
      targetAnchor: geometryData.targetAnchor ?? "",
      geometryProfile: visualRole,
      hasInternalTopology: Boolean(geometryData.hasInternalTopology),
      internalNodeCount: geometryData.internalNodeCount ?? 0,
      confidence: Number.isFinite(node.confidence) ? node.confidence : 1,
      evidenceCount: Array.isArray(node.evidence) ? node.evidence.length : 0,
      recurrentInstanceRole: String(node.recurrentInstanceRole || ""),
      recurrentExpanded: Boolean(node.recurrentExpanded),
      sourceInstanceId: String(node.sourceInstanceId || ""),
      targetInstanceId: String(node.targetInstanceId || ""),
      unresolvedReason: String(node.unresolvedReason || ""),
      grammarId: options.grammarId,
      planVersion: BRIDGE_VERSION,
    },
  };
}

function shapeText(shape) {
  const value = shape?.output || shape?.input;
  return Array.isArray(value) ? value.join("×") : value ? String(value) : "";
}

function stableRenderId(documentPath, pageName) {
  let hash = 2166136261;
  for (const character of `${documentPath}\n${pageName}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `agent-scope-${(hash >>> 0).toString(16)}`;
}
