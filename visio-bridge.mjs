import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import { join, normalize, dirname, basename } from "node:path";
import {
  VISIO_OPERATION_PLAN_VERSION,
  validateVisioOperationPlan,
} from "./visio-operation-plan.mjs";

export { VISIO_OPERATION_PLAN_VERSION };
const BRIDGE_VERSION = VISIO_OPERATION_PLAN_VERSION;

// 解析 PowerShell 脚本路径：开发模式在模块同目录；electron-builder 打包后
// （模块在 app.asar 内）脚本通过 extraResources 复制到 resources/ 下，因为
// PowerShell 无法直接执行 asar 内的文件。
function resolveScriptPath(relativeName) {
  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  if (moduleDir.includes(".asar")) {
    const resourcesPath = process.resourcesPath || dirname(moduleDir.split(".asar")[0]);
    return join(resourcesPath, relativeName);
  }
  return fileURLToPath(new URL(`./${relativeName}`, import.meta.url));
}

export function buildVisioRenderPlan(inputLayout = {}, options = {}) {
  if (inputLayout.version && inputLayout.version !== "visio-diagram-plan/v1") {
    throw new Error(`Visio bridge accepts only Scene-backed Visio Diagram Plan input; received ${inputLayout.version}.`);
  }
  const documentPath = String(options.documentPath || "").trim();
  if (!documentPath) throw new Error("documentPath is required; Visio rendering never creates an implicit document.");
  const layout = inputLayout;
  const pageName = String(options.pageName || "Page-1");
  const renderId = String(options.renderId || stableRenderId(documentPath, pageName));
  const grammarId = String(layout.grammar?.id || "generic-dag");
  const registry = {
    shapes: [],
    innerShapeIds: new Map(),
    outerShapeIds: new Map(),
    recurrentRailConnectors: [],
  };

  const hasScene = layout.scene?.version === "laid-out-neural-scene/v1";
  if (!hasScene) throw new Error("Visio Diagram Plan must contain a laid-out neural scene.");
  projectScene(layout.scene, registry, renderId);
  const connectors = projectSceneConnectors(layout.scene, registry, renderId);

  const plan = {
    version: BRIDGE_VERSION,
    documentPath,
    pageName,
    createDocument: false,
    preserveExisting: true,
    replaceScope: String(options.replaceLegacyPrefix || "").trim() ? "agent-owned+legacy-prefix" : "agent-owned",
    replaceLegacyPrefix: String(options.replaceLegacyPrefix || "").trim() || undefined,
    openMode: String(options.openMode || "attach"),
    readbackMode: options.readbackMode === "reopen" ? "reopen" : "in-place",
    previewPath: String(options.previewPath || "").trim() || undefined,
    renderId,
    unitScale: Number.isFinite(options.unitScale) ? options.unitScale : 0.0065,
    artboard: sceneArtboard(layout.scene.page),
    grammarId,
    figure: layout.figure || {},
    groups: (layout.scene.groups || []).map((group) => ({ ...group, renderId })),
    shapes: registry.shapes,
    connectors,
  };
  const validation = validateVisioOperationPlan(plan);
  if (!validation.ok) {
    throw new Error(`Invalid Visio Operation Plan: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }
  return plan;
}

function projectScene(scene, registry, renderId) {
  const primitives = [...(scene.primitives || [])].sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0) || String(a.id).localeCompare(String(b.id)));
  for (const primitive of primitives) {
    const sourceNodeIds = (primitive.sourceNodeIds || []).map(String);
    registry.shapes.push({
      id: String(primitive.id),
      sourceNodeId: sourceNodeIds[0] || "",
      sourceNodeIds,
      x: Number(primitive.bounds?.x) || 0,
      y: Number(primitive.bounds?.y) || 0,
      w: Number(primitive.bounds?.w) || 1,
      h: Number(primitive.bounds?.h) || 1,
      label: (primitive.labels || []).map(String).join("\n"),
      subtitle: "",
      shapeKind: `scene-${String(primitive.form || "band")}`,
      sceneForm: String(primitive.form || "band"),
      sceneRole: String(primitive.role || "body"),
      semanticTags: (primitive.semanticTags || []).map(String),
      category: String(primitive.category || "operator"),
      anchors: structuredClone(primitive.anchors || { inputs: [], outputs: [] }),
      zIndex: Number(primitive.zIndex || 0),
      ports: structuredClone(primitive.ports || { inputs: [], outputs: [] }),
      geometryData: structuredClone(primitive.data || {}),
      visualRole: "scene-primitive",
      styleProfile: sceneStyleProfile(primitive),
      labelOutside: false,
      parentNodeId: "",
      fill: sceneFill(primitive),
      line: "#3F5D78",
      shapeData: {
        renderId,
        sourceNodeId: sourceNodeIds[0] || "",
        sourceNodeIds,
        sourceEdgeIds: (primitive.sourceEdgeIds || []).map(String).join("|"),
        projectionId: String(primitive.projectionId || ""),
        primitiveId: String(primitive.id),
        sceneForm: String(primitive.form || "band"),
        sceneRole: String(primitive.role || "body"),
        scaleChange: String(primitive.data?.scaleChange || ""),
        semanticTags: (primitive.semanticTags || []).map(String).join("|"),
        blockKind: String(primitive.blockKind || primitive.data?.blockKind || ""),
        blockLayoutHint: primitive.layoutHint ? JSON.stringify(primitive.layoutHint) : "",
        blockBadge: String(primitive.blockBadge || ""),
        blockDetails: primitive.blockDetails ? JSON.stringify(primitive.blockDetails) : "",
        inputPorts: portLabels(primitive.ports?.inputs),
        outputPorts: portLabels(primitive.ports?.outputs),
        blockEntryPorts: portLabels(primitive.ports?.inputs),
        blockExitPorts: portLabels(primitive.ports?.outputs),
        derivedFrom: (primitive.derivedFrom || []).map(String).join("|"),
        planVersion: BRIDGE_VERSION,
      },
    });
  }
}

function portLabels(ports = []) {
  return (Array.isArray(ports) ? ports : [])
    .map((port) => String(port?.portId || port?.id || (typeof port === "string" ? port : "") || ""))
    .filter(Boolean)
    .join("|");
}

function projectSceneConnectors(scene, registry, renderId) {
  const primitiveById = new Map(registry.shapes.map((shape) => [shape.id, shape]));
  return (scene.connectors || []).map((connector) => {
    const sourceShape = primitiveById.get(String(connector.sourcePrimitiveId));
    const targetShape = primitiveById.get(String(connector.targetPrimitiveId));
    return {
      id: String(connector.id),
      source: sourceShape?.sourceNodeId || "",
      target: targetShape?.sourceNodeId || "",
      type: (connector.relationTags || []).includes("state") ? "state" : "signal",
      label: "",
      points: structuredClone(connector.points || []),
      renderId,
      sourceEdgeId: String(connector.sourceEdgeIds?.[0] || connector.id || ""),
      sourceEdgeIds: (connector.sourceEdgeIds || []).map(String),
      sourceNodeId: sourceShape?.sourceNodeId || "",
      targetNodeId: targetShape?.sourceNodeId || "",
      sourceEndpointIds: normalizeEndpointIds({ source: connector.sourcePortId, target: connector.targetPortId }),
      routeClass: String(connector.routeClass || "main-flow"),
      sourceShapeId: String(connector.sourcePrimitiveId || ""),
      targetShapeId: String(connector.targetPrimitiveId || ""),
      relationTags: (connector.relationTags || []).map(String),
      evidenceCount: Array.isArray(connector.derivedFrom) ? connector.derivedFrom.length : 0,
    };
  });
}

function sceneArtboard(page = {}) {
  return { x: Number(page.x) || 0, y: Number(page.y) || 0, width: Number(page.width) || 1, height: Number(page.height) || 1 };
}

function sceneStyleProfile(primitive) {
  if (primitive.blockKind) return String(primitive.blockKind);
  const tags = new Set((primitive.semanticTags || []).map((tag) => String(tag).toLowerCase()));
  if (primitive.category === "data") {
    if (tags.has("input") && tags.has("spatial")) return "image-input";
    if (tags.has("input") && tags.has("sequence")) return "sequence-input";
    if (tags.has("input") && tags.has("state")) return "state-input";
    if (tags.has("input") && tags.has("vector")) return "vector-input";
    return primitive.form === "strip" ? "token" : "feature-map";
  }
  if (primitive.category === "boundary") return "unresolved";
  if (primitive.category === "annotation") return "annotation";
  if (tags.has("attention")) return "attention";
  if (tags.has("stateful") || tags.has("graph")) return "compound";
  if (tags.has("merge")) return "merge";
  return "operator";
}

function sceneFill(primitive) {
  if (primitive.category === "data") return "#DCEAF4";
  if (primitive.category === "structure") return "#E2F3E7";
  if (primitive.category === "boundary") return "#F5F0E7";
  if (primitive.category === "annotation") return "#FFFFFF";
  return "#E7EEF5";
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
    scriptPath: options.scriptPath || resolveScriptPath("visio-bridge.ps1"),
  });
  const runner = options.runner || runPowerShell;
  const maxAttempts = Number.isInteger(options.comRetryAttempts) && options.comRetryAttempts > 0
    ? options.comRetryAttempts
    : 2;
  let result;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      result = await runner(command);
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableVisioComFailure(error)) throw error;
      await delay(250 * attempt);
    }
  }
  if (!result) throw lastError || new Error("Visio bridge failed without an error.");
  const readbackValidation = validateVisioReadback(plan, result.readback || result);
  return {
    plan,
    ...result,
    status: result.status === "rendered" && !readbackValidation.ok ? "readback_failed" : result.status,
    readbackValidation,
  };
}

function isRetryableVisioComFailure(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /RPC_E_SERVERFAULT|0x80010105|服务器出现意外情况|serverfault|不能对 Null 值表达式调用方法|call method on a null/i.test(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function validateVisioReadback(plan = {}, readback = {}) {
  const expected = [...new Set((plan.shapes || []).flatMap((shape) => {
    const sourceNodeIds = shape.shapeData?.sourceNodeIds;
    if (Array.isArray(sourceNodeIds) && sourceNodeIds.length > 0) {
      return sourceNodeIds.map(String).filter(Boolean);
    }
    return [String(shape.shapeData?.sourceNodeId || "")].filter(Boolean);
  }))].sort();
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
  const glueExpectedEdgeIds = (plan.connectors || [])
    .filter((edge) => edge.avoidGlue !== true)
    .map((edge) => String(edge.id || ""))
    .filter(Boolean);
  const missingGluedBeginEdgeIds = glueReported ? glueExpectedEdgeIds.filter((id) => !gluedBegin.has(id)) : [];
  const missingGluedEndEdgeIds = glueReported ? glueExpectedEdgeIds.filter((id) => !gluedEnd.has(id)) : [];
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

// 把用户填的 Visio 路径规范化为一个完整的 .vsdx 文件路径：
// 目录 -> 目录\model.vsdx；无后缀 -> 补 .vsdx；已存在 -> model1.vsdx / model2.vsdx …。
export function resolveVisioDocumentPath(rawPath) {
  let p = String(rawPath || "").trim();
  if (!p) return { error: "请输入 Visio 文档路径。" };
  let isDir = false;
  try { isDir = statSync(p).isDirectory(); } catch { /* 不存在或非目录 */ }
  if (isDir) {
    p = join(p, "model.vsdx");
  } else if (!/\.vsdx$/i.test(p)) {
    p += ".vsdx";
  }
  if (existsSync(p)) {
    const dir = dirname(p);
    const stem = basename(p).replace(/\.vsdx$/i, "");
    let i = 1;
    let candidate;
    do {
      candidate = join(dir, `${stem}${i}.vsdx`);
      i += 1;
    } while (existsSync(candidate));
    p = candidate;
  }
  // 统一为 Windows 原生反斜杠：Visio 的 SaveAsEx 不接受正斜杠路径。
  return { path: normalize(p) };
}

export async function createEmptyVisioDocument(targetPath, options = {}) {
  const scriptPath = String(options.scriptPath || resolveScriptPath("visio-create-empty.ps1")).trim();
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

function stableRenderId(documentPath, pageName) {
  let hash = 2166136261;
  for (const character of `${documentPath}\n${pageName}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `agent-scope-${(hash >>> 0).toString(16)}`;
}
