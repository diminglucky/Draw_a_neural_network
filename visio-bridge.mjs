import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const BRIDGE_VERSION = "visio-native-bridge/v1";

export function buildVisioRenderPlan(layout = {}, options = {}) {
  const documentPath = String(options.documentPath || "").trim();
  if (!documentPath) throw new Error("documentPath is required; Visio rendering never creates an implicit document.");
  const pageName = String(options.pageName || "Page-1");
  const renderId = String(options.renderId || stableRenderId(documentPath, pageName));
  const grammarId = String(layout.grammar?.id || "generic-dag");
  const shapes = [];
  const innerShapeIds = new Map();

  for (const node of Array.isArray(layout.nodes) ? layout.nodes : []) {
    const shapeId = `outer::${node.id}`;
    shapes.push(shapePlan(node, {
      id: shapeId,
      parentNodeId: "",
      grammarId,
      renderId,
      shapeKind: node.representation || node.family || "operator",
    }));
    const innerNodes = node.renderInternalGraph === false
      ? []
      : Array.isArray(node.inner?.nodes) ? node.inner.nodes : [];
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

  const connectors = [];
  for (const edge of Array.isArray(layout.edges) ? layout.edges : []) {
    const points = Array.isArray(edge.route?.points) ? edge.route.points : [];
    connectors.push({
      id: `outer-edge::${edge.id}`,
      source: edge.source,
      target: edge.target,
      type: edge.type || "signal",
      label: edge.label || "",
      points,
      renderId,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      sourceShapeId: `outer::${edge.source}`,
      targetShapeId: `outer::${edge.target}`,
      evidenceCount: Array.isArray(edge.evidence) ? edge.evidence.length : 0,
    });
  }
  for (const node of Array.isArray(layout.nodes) ? layout.nodes : []) {
    const innerEdges = Array.isArray(node.inner?.edges) ? node.inner.edges : [];
    for (const edge of innerEdges) {
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
    renderId,
    unitScale: Number.isFinite(options.unitScale) ? options.unitScale : 0.0065,
    artboard: layout.artboard || { x: 0, y: 0, width: 2260, height: 1060 },
    grammarId,
    figure: layout.figure || {},
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
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-PlanBase64", encodedPlan],
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
  const renderIdMatches = String(readback.renderId || "") === String(plan.renderId || "");
  return {
    ok: renderIdMatches && missingSourceNodeIds.length === 0 && missingEdgeIds.length === 0
      && missingGluedBeginEdgeIds.length === 0 && missingGluedEndEdgeIds.length === 0,
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
  };
}

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
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

function shapePlan(node, options) {
  return {
    id: options.id,
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    w: Number(node.w) || 120,
    h: Number(node.h) || 80,
    label: String(node.label || node.op || "Operator"),
    subtitle: String(node.subtitle || ""),
    shapeKind: options.shapeKind,
    parentNodeId: options.parentNodeId,
    fill: String(node.color || "#A855F7"),
    line: String(node.lineColor || "#263248"),
    shapeData: {
      renderId: options.renderId,
      sourceNodeId: String(node.id || ""),
      parentNodeId: options.parentNodeId,
      visualRole: String(options.shapeKind || node.family || "operator"),
      layerRole: String(node.semanticRole || "feature_transform"),
      tensorShape: shapeText(node.shape),
      repeatCount: node.repeatCount ?? node.layers ?? "",
      confidence: Number.isFinite(node.confidence) ? node.confidence : 1,
      evidenceCount: Array.isArray(node.evidence) ? node.evidence.length : 0,
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
