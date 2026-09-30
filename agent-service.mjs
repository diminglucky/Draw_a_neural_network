import { createAgentRun, persistAgentRun, resumeAgentRun, runAgentPipeline } from "./agent-orchestrator.mjs";
import { createMemoryRunStore } from "./run-store.mjs";
import { extractArchitectureEvidence, normalizeArchitectureEvidence, planArchitectureFigure } from "./agent-pipeline.mjs";
import { validateVisioDiagramPlan } from "./visio-diagram-plan.mjs";
import { buildVisioRenderPlan, renderUniversalFigureToVisio } from "./visio-bridge.mjs";
import { inferShapes, diagnoseShapes, buildShapeFeedback } from "./shape-inference.mjs";
import { createVisioWorkerClient } from "./visio-worker-client.mjs";
import { analyzeTorchSource } from "./torch-code-analyzer.mjs";
import { analyzeKerasSource } from "./keras-code-analyzer.mjs";
import { validateNeuralFigureProgram } from "./neural-figure-dsl.mjs";
import { compileNeuralFigureDslToVisioLayout } from "./visio-dsl-bridge.mjs";
import { applyModelWorkspaceOperation, createModelWorkspace, modelWorkspaceToIR, validateModelWorkspace } from "./model-workspace.mjs";
import { buildCanonicalModelGraph } from "./canonical-model-graph.mjs";
import { planNeuralFigure, validateNeuralFigurePlan } from "./figure-planner.mjs";
import { evaluatePublicationFigure } from "./figure-qa.mjs";

// The LLM analyzer is injected by server.js and updated on config change. We
// keep a module-level mutable reference (not a captured argument) so an updated
// config is picked up by in-flight stage dependencies without recreating the
// service route.
let analyzer = null;
let visioWorker = null;

export function setLLMAnalyzer(next) {
  analyzer = next;
}

export function closeVisioWorker() {
  const current = visioWorker;
  visioWorker = null;
  return current?.close();
}

export function createAgentService({ dependencies = {}, runStore: configuredRunStore } = {}) {
  const runs = new Map();
  const runStore = configuredRunStore || createMemoryRunStore();
  const stageDependencies = {
    ...createDefaultAgentDependencies(dependencies),
    ...dependencies,
  };
  return async function route(request) {
    const url = new URL(request.url || "/", "http://agent.test");
    if (request.method !== "POST") return jsonResponse(404, { status: "not_found", code: "route-not-found", message: "Agent route not found." });
    try {
      const body = await request.json();
      if (url.pathname === "/api/model-workspace/apply") {
        return applyWorkspaceEdit(body);
      }
      if (url.pathname === "/api/model-workspace/plan") {
        return planWorkspaceEdit(body);
      }
      if (url.pathname === "/api/render-visio") {
        return renderVisioThroughAgent(body, stageDependencies, runs, runStore);
      }
      if (url.pathname === "/api/agent-run") {
        const documentPath = String(body?.documentPath || "").trim();
        const runDependencies = documentPath
          ? withVisioExecution(stageDependencies, {
              documentPath,
              pageName: body?.pageName || "Page-1",
              renderId: body?.renderId,
              unitScale: body?.unitScale,
              previewPath: body?.previewPath,
              scriptPath: process.env.VISIO_BRIDGE_SCRIPT,
            })
          : stageDependencies;
        let run;
        try {
          run = createAgentRun(body, runDependencies, { runStore });
        } catch (error) {
          return jsonResponse(422, { status: "invalid_input", code: "invalid-input", message: error.message });
        }
        runs.set(run.id, run);
        const result = await runAgentPipeline(run);
        return jsonResponse(200, { ...result, status: agentRunStatus(result) });
      }
      const match = url.pathname.match(/^\/api\/agent-run\/([^/]+)\/resume$/);
      if (!match) return jsonResponse(404, { status: "not_found", code: "route-not-found", message: "Agent route not found." });
      const storedRun = await runStore.get(match[1]);
      const run = runs.get(match[1]) || (storedRun ? { ...storedRun, dependencies: stageDependencies, runStore } : undefined);
      if (!run) return jsonResponse(404, { status: "not_found", code: "run-not-found", message: `Agent run ${match[1]} was not found.` });
      const event = body && typeof body === "object" ? body : {};
      if (!["confirm", "repair", "render-result", "readback-result"].includes(event.type)) {
        return jsonResponse(400, { status: "invalid_event", code: "invalid-event", message: "Event type must be confirm, repair, render-result, or readback-result." });
      }
      const next = resumeAgentRun(run, event);
      await persistAgentRun(next);
      const resumed = ["repair", "confirm"].includes(event.type) && ["repair-pending", "confirmed"].includes(next.status)
        ? await runAgentPipeline(next)
        : next;
      runs.set(resumed.id, resumed);
      const statusCode = resumed.status === "repair-failed" ? 409 : 200;
      return jsonResponse(statusCode, resumed.status === "repair-failed"
        ? { ...nextResult(resumed), code: "repair-limit-exceeded" }
        : nextResult(resumed));
    } catch (error) {
      return jsonResponse(400, { status: "invalid_request", code: "invalid-json", message: error.message });
    }
  };
}

function createDefaultAgentDependencies(configuration = {}) {
  return {
    inspect: async (input) => input,
    extract: async (input) => {
      if (shouldAutoFuseEvidence(input)) {
        return extractArchitectureEvidence(input, {
          autoFuseEvidence: true,
          torchAnalyzer: analyzeTorchSourceWithShapes,
          kerasAnalyzer: analyzeKerasSourceWithShapes,
          resolver: configuration.resolver,
        });
      }
      if (input?.kind === "image") return extractImageEvidenceThroughProvider(input);
      if (input?.kind === "repository" || (input?.kind === "prompt" && configuration.resolver)) {
        return extractArchitectureEvidence(input, { resolver: configuration.resolver });
      }
      if (analyzer?.available && (input?.kind === "source" || input?.kind === "prompt")) {
        return extractThroughLLM(input);
      }
      if (input?.kind === "source" && (!input.framework || input.framework === "auto" || input.framework === "pytorch")) {
        return extractArchitectureEvidence(input, { codeAnalyzer: analyzeTorchSourceWithShapes });
      }
      if (input?.kind === "source" && ["keras", "tensorflow", "tf"].includes(String(input.framework || "").toLowerCase())) {
        return extractArchitectureEvidence(input, { codeAnalyzer: analyzeKerasSourceWithShapes });
      }
      return extractArchitectureEvidence(input);
    },
    normalize: (evidence) => normalizeArchitectureEvidence(evidence),
    plan: (normalized) => planWithOptionalLLMFigure(normalized),
  };
}

function applyWorkspaceEdit(body = {}) {
  const workspace = body.workspace;
  const validation = validateModelWorkspace(workspace);
  if (!validation.ok) {
    return jsonResponse(422, {
      status: "invalid_workspace",
      error: "The model workspace is invalid.",
      validation,
    });
  }
  const result = applyModelWorkspaceOperation(workspace, body.operation || {});
  return jsonResponse(200, {
    status: result.diagnostics.length ? "operation_rejected" : "applied",
    workspace: result.workspace,
    diagnostics: result.diagnostics,
    ir: result.diagnostics.length ? undefined : modelWorkspaceToIR(result.workspace),
  });
}

async function planWorkspaceEdit(body = {}) {
  const workspace = body.workspace;
  const validation = validateModelWorkspace(workspace);
  if (!validation.ok) {
    return jsonResponse(422, {
      status: "invalid_workspace",
      error: "The model workspace is invalid.",
      validation,
    });
  }
  const ir = modelWorkspaceToIR(workspace);
  const planned = await planWithOptionalLLMFigure({ ir });
  const publicationFallback = planned.publicationVisioDiagramPlan
    ? {
      program: planned.neuralFigureProgram,
      plan: planned.publicationVisioDiagramPlan,
      validation: planned.publicationVisioDiagramPlanValidation,
      qa: planned.publicationFigureQa,
    }
    : buildWorkspacePublicationFallback(ir);
  const nextWorkspace = createModelWorkspace({
    id: workspace.modelId,
    revision: Number(workspace.revision || 0) + 1,
    ir: planned.ir || ir,
    visioDiagramPlan: planned.visioDiagramPlan,
    publicationVisioDiagramPlan: publicationFallback.plan,
    publicationFigureQa: publicationFallback.qa,
  });
  return jsonResponse(200, {
    status: publicationFallback.plan ? "planned" : "invalid_layout",
    workspace: nextWorkspace,
    ir: planned.ir || ir,
    visioDiagramPlan: planned.visioDiagramPlan,
    visioDiagramPlanValidation: planned.visioDiagramPlanValidation,
    publicationVisioDiagramPlan: publicationFallback.plan,
    publicationVisioDiagramPlanValidation: publicationFallback.validation,
    publicationFigureQa: publicationFallback.qa,
    neuralFigureProgram: publicationFallback.program,
    neuralFigurePlanValidation: publicationFallback.program
      ? validateNeuralFigurePlan(publicationFallback.program, buildCanonicalModelGraph(planned.ir || ir))
      : undefined,
    diagnostics: planned.diagnostics || [],
  });
}

function buildWorkspacePublicationFallback(ir) {
  try {
    const canonicalModel = buildCanonicalModelGraph(ir);
    const program = planNeuralFigure(canonicalModel);
    const validation = validateNeuralFigurePlan(program, canonicalModel);
    const plan = validation.ok
      ? compileNeuralFigureDslToVisioLayout(program, {
        title: ir.figure?.title,
        subtitle: ir.figure?.subtitle,
      })
      : null;
    return {
      program,
      plan,
      validation: plan ? validateVisioDiagramPlan(plan) : validation,
      qa: plan ? evaluatePublicationFigure(plan, { canonicalModel, neuralFigureProgram: program }) : null,
    };
  } catch (error) {
    return {
      program: undefined,
      plan: null,
      validation: { ok: false, issues: [{ code: "workspace-publication-plan-failed", message: error.message }] },
      qa: null,
    };
  }
}

async function planWithOptionalLLMFigure(normalized) {
  const deterministic = planArchitectureFigure(normalized);
  if (!analyzer?.available || typeof analyzer.planFigure !== "function" || !deterministic?.neuralFigureProgram) {
    return deterministic;
  }
  const planned = await analyzer.planFigure({
    ir: deterministic.ir,
    deterministicProgram: deterministic.neuralFigureProgram,
    semanticFacts: deterministic.semanticFacts,
    motifs: deterministic.motifs,
  });
  if (planned?.status || !planned?.program) {
    return {
      ...deterministic,
      diagnostics: [...(deterministic.diagnostics || []), ...(planned?.diagnostics || [])],
    };
  }
  const validation = validateNeuralFigureProgram(planned.program);
  if (!validation.ok) {
    return {
      ...deterministic,
      diagnostics: [...(deterministic.diagnostics || []), ...validation.issues],
    };
  }
  const publicationVisioDiagramPlan = compileNeuralFigureDslToVisioLayout(planned.program, {
    title: deterministic.ir?.figure?.title,
    subtitle: deterministic.ir?.figure?.subtitle,
  });
  return {
    ...deterministic,
    neuralFigureProgram: planned.program,
    neuralFigurePlanValidation: validation,
    publicationVisioDiagramPlan,
    publicationVisioDiagramPlanValidation: validateVisioDiagramPlan(publicationVisioDiagramPlan),
  };
}

async function analyzeTorchSourceWithShapes(input = {}, options = {}) {
  return withShapeInference(await analyzeTorchSource(input, options));
}

async function analyzeKerasSourceWithShapes(input = {}, options = {}) {
  return withShapeInference(await analyzeKerasSource(input, options));
}

function withShapeInference(result = {}) {
  if (!result?.ir) return result;
  return { ...result, ir: applyShapeInference(result.ir) };
}

function shouldAutoFuseEvidence(input = {}) {
  if (input?.kind === "evidence") return true;
  const evidenceFields = ["ir", "source", "config", "artifact", "repository"].filter((field) => input?.[field] !== undefined);
  return evidenceFields.length > 1;
}

async function extractImageEvidenceThroughProvider(input) {
  const result = await analyzer?.analyze(input);
  if (!result || result.status) {
    return {
      kind: "image",
      status: "needs_external_vision",
      diagnostics: result?.diagnostics || [{ kind: "vision-analyzer-required", message: "Image input requires a configured vision analyzer." }],
      input,
    };
  }
  return extractArchitectureEvidence({
    kind: "ir",
    ir: applyShapeInference(result.ir),
    diagnostics: result.diagnostics,
  });
}

const MAX_SHAPE_CORRECTION_ROUNDS = 3;

async function extractThroughLLM(input) {
  const result = await analyzer.analyze(input);
  if (result.status) {
    if (input?.kind === "prompt") {
      // prompt 没有正则回退，LLM 失败必须明确报错，否则会 fallback 成「假设节点」。
      throw new Error(`LLM 分析失败：${result.message || result.status}。请检查设置里的 Base URL / API Key / 模型，以及网络连接。`);
    }
    // source 输入：回退到正则提取（正则能处理简单代码拓扑）。
    return extractArchitectureEvidence(input);
  }
  let ir = applyShapeInference(result.ir);
  const diagnostics = Array.isArray(result.diagnostics) ? [...result.diagnostics] : [];
  // 自纠闭环：语义校验 + shape 验算 → 发现结构/尺寸问题 → 带反馈重问 LLM → 修正，直到自洽或达上限。
  for (let round = 0; round < MAX_SHAPE_CORRECTION_ROUNDS; round += 1) {
    const semanticIssues = validateIRSemantics(ir);
    const diagnosis = diagnoseShapes(ir?.nodes || [], ir?.edges || []);
    if (!semanticIssues.length && diagnosis.ok) break;
    const feedback = [
      buildSemanticFeedback(semanticIssues),
      buildShapeFeedback(diagnosis.issues, diagnosis.shapeByNode),
    ].filter(Boolean).join("\n\n");
    const correction = await analyzer.refine(input, ir, feedback);
    if (!correction?.ir) {
      diagnostics.push({ kind: "ir-correction-failed", message: "Self-correction round did not return a revised IR." });
      break;
    }
    ir = applyShapeInference(correction.ir);
    diagnostics.push({ kind: "ir-corrected", round: round + 1, semanticIssueCount: semanticIssues.length, shapeIssueCount: diagnosis.issues.length });
  }
  // 兜底：三轮后仍有「元节点」残留，宽容清理并桥接（能画就画）。
  ir = applyShapeInference(sanitizeIR(ir));
  return extractArchitectureEvidence({
    kind: "ir",
    ir,
    diagnostics,
  });
}

export function applyShapeInference(ir) {
  const nodes = Array.isArray(ir?.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir?.edges) ? ir.edges : [];
  if (!nodes.length) return ir;
  inferShapes(nodes, edges);
  return { ...ir, nodes, edges };
}

// 清理 LLM 偶尔输出的「元节点」（如 hypothesis/assumption/placeholder）。
// 它们不是真实网络层，会误触发 needs-confirmation；过滤后把前后节点桥接。
export function sanitizeIR(ir) {
  if (!ir || !Array.isArray(ir.nodes) || !ir.nodes.length) return ir;
  const metaPattern = /hypothesis|assumption|placeholder|^architecture$/i;
  const isMeta = (node) => {
    const op = String(node.op || "");
    const label = String(node.label || "");
    const id = String(node.id || "");
    return metaPattern.test(op) || metaPattern.test(label) || metaPattern.test(id);
  };
  const metaIds = new Set(ir.nodes.filter(isMeta).map((node) => String(node.id)));
  if (!metaIds.size) return ir;
  const keptNodes = ir.nodes.filter((node) => !metaIds.has(String(node.id)));
  const keptIds = new Set(keptNodes.map((node) => String(node.id)));
  const edges = [];
  const metaEdges = [];
  for (const edge of ir.edges || []) {
    const src = String(edge.source);
    const dst = String(edge.target);
    if (metaIds.has(src) || metaIds.has(dst)) metaEdges.push(edge);
    else if (keptIds.has(src) && keptIds.has(dst)) edges.push(edge);
  }
  // 桥接：每个元节点的入边源 → 每个元节点的出边目标
  for (const metaId of metaIds) {
    const incoming = metaEdges.filter((edge) => String(edge.target) === metaId).map((edge) => String(edge.source));
    const outgoing = metaEdges.filter((edge) => String(edge.source) === metaId).map((edge) => String(edge.target));
    for (const src of incoming) {
      for (const dst of outgoing) {
        if (keptIds.has(src) && keptIds.has(dst) && src !== dst) {
          edges.push({ id: `bridge-${src}-${dst}`, source: src, target: dst, type: "signal", confidence: 1 });
        }
      }
    }
  }
  return { ...ir, nodes: keptNodes, edges };
}

// 语义校验：检查 IR 是否「合法」——元节点、缺失 input/output、悬空边。
// 这些是结构性问题，优先反馈给 LLM 重问（而非静默清理）。
export function validateIRSemantics(ir) {
  const issues = [];
  const nodes = Array.isArray(ir?.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir?.edges) ? ir.edges : [];
  if (!nodes.length) return [{ kind: "empty-graph", message: "The IR has no nodes at all." }];
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const metaPattern = /hypothesis|assumption|placeholder|^architecture$/i;
  for (const node of nodes) {
    const op = String(node.op || "");
    const label = String(node.label || "");
    const id = String(node.id || "");
    if (metaPattern.test(op) || metaPattern.test(label) || metaPattern.test(id)) {
      issues.push({ kind: "meta-node", nodeId: id, message: `Node "${op || label || id}" is a meta/placeholder node, not a concrete layer. Replace it with real layers (conv/pool/dense/...) or remove it.` });
    }
  }
  if (!nodes.some((node) => String(node.family || "").toLowerCase() === "input")) {
    issues.push({ kind: "missing-input", message: "There is no input node (family \"input\")." });
  }
  if (!nodes.some((node) => String(node.family || "").toLowerCase() === "output")) {
    issues.push({ kind: "missing-output", message: "There is no output node (family \"output\")." });
  }
  for (const edge of edges) {
    if (!nodeIds.has(String(edge.source))) issues.push({ kind: "dangling-edge", edgeId: edge.id, message: `Edge references a missing source "${edge.source}".` });
    if (!nodeIds.has(String(edge.target))) issues.push({ kind: "dangling-edge", edgeId: edge.id, message: `Edge references a missing target "${edge.target}".` });
  }
  return issues;
}

export function buildSemanticFeedback(issues) {
  if (!issues || !issues.length) return "";
  return [
    "Your IR has semantic problems that must be fixed:",
    ...issues.map((issue) => `- ${issue.message}`),
    "Return the corrected full IR JSON containing ONLY concrete network layers.",
  ].join("\n");
}

async function renderVisioThroughAgent(body = {}, stageDependencies, runs, runStore) {
  const documentPath = String(body.documentPath || "").trim();
  if (!documentPath) {
    return jsonResponse(400, { error: "documentPath is required; rendering never creates an implicit Visio document." });
  }

  if (body.figurePlan) {
    return jsonResponse(422, {
      status: "invalid_input",
      code: "figure-plan-not-accepted",
      error: "Client-supplied Figure Plans are not accepted; render must start from source, image, or Universal IR through Agent Run.",
    });
  }

  const input = body.images
    ? { kind: "image", images: body.images, prompt: body.prompt, metadata: body.metadata }
    : body.workspace
    ? { kind: "ir", ir: modelWorkspaceToIR(body.workspace), diagnostics: body.diagnostics }
    : body.ir
    ? { kind: "ir", ir: body.ir, diagnostics: body.diagnostics }
    : body.prompt
    ? { kind: "prompt", prompt: body.prompt, metadata: body.metadata }
    : { kind: "source", source: body.source, framework: body.framework };
  let options;
  try {
    options = {
      documentPath,
      pageName: body.pageName || "Page-1",
      renderId: body.renderId,
      unitScale: body.unitScale,
      previewPath: body.previewPath,
      scriptPath: process.env.VISIO_BRIDGE_SCRIPT,
    };
    const render = stageDependencies.render || defaultVisioRender;
    const readback = process.env.VISIO_DRY_RUN === "1"
      ? undefined
      : (stageDependencies.readback || defaultVisioReadback);
    let run;
    try {
      run = createAgentRun(input, {
      ...stageDependencies,
      render: (visioDiagramPlan, current) => render(visioDiagramPlan, { ...current, visioOptions: options }),
      ...(readback ? {
        readback: (visioDiagramPlan, renderResult, current) => readback(visioDiagramPlan, renderResult, { ...current, visioOptions: options }),
      } : {}),
      }, { runStore });
    } catch (error) {
      return jsonResponse(422, { status: "invalid_input", code: "invalid-input", message: error.message });
    }
    runs.set(run.id, run);
    const result = await runAgentPipeline(run);
    if (result.status === "needs-confirmation" || result.status === "needs_confirmation") {
      return jsonResponse(409, {
        error: "Architecture evidence requires confirmation; Visio was not modified.",
        diagnostics: result.diagnostics,
        ...nextResult(result),
        status: "needs_confirmation",
      });
    }
    if (result.status === "needs_external_vision") {
      return jsonResponse(409, {
        error: "Image evidence requires an available vision analyzer; Visio was not modified.",
        diagnostics: result.diagnostics,
        ...nextResult(result),
        status: "needs_external_vision",
      });
    }
    const selectedPlan = result.publicationVisioDiagramPlan || result.visioDiagramPlan;
    if (!selectedPlan) {
      const firstError = (result.diagnostics || []).find((d) => d.severity === "error");
      return jsonResponse(422, {
        error: firstError?.message || "Architecture input did not produce a renderable publication plan; Visio was not modified.",
        diagnostics: result.diagnostics,
        ...nextResult(result),
        status: "invalid_layout",
      });
    }
    const renderPlan = result.renderResult?.plan || buildVisioRenderPlan(selectedPlan, options);
    const validation = result.publicationVisioDiagramPlan
      ? (result.publicationVisioDiagramPlanValidation || selectedPlan.validation || validateVisioDiagramPlan(selectedPlan))
      : (result.visioDiagramPlan.validation || validateVisioDiagramPlan(selectedPlan));
    if (!validation.ok) {
      return jsonResponse(422, {
        status: "invalid_layout",
        error: "Publication figure validation failed; Visio was not modified.",
        validation,
        diagnostics: result.diagnostics,
        ...nextResult(result),
      });
    }
    const responseStatus = result.renderResult?.status === "dry_run"
      ? "dry_run"
      : result.renderResult?.status === "readback_failed"
        ? "readback_failed"
      : result.status === "completed" ? "rendered" : result.status;
    const response = {
      ...nextResult(result),
      status: responseStatus,
      analysisStatus: result.status,
      diagnostics: result.diagnostics,
      validation,
      figureQa: result.publicationFigureQa,
      plan: renderPlan,
    };
    runs.set(result.id, result);
    return jsonResponse(200, response);
  } catch (error) {
    return jsonResponse(503, { status: "visio_unavailable", error: error.message });
  }
}

function withVisioExecution(stageDependencies, options) {
  const render = stageDependencies.render || defaultVisioRender;
  const readback = process.env.VISIO_DRY_RUN === "1"
    ? undefined
    : (stageDependencies.readback || defaultVisioReadback);
  return {
    ...stageDependencies,
    render: (visioDiagramPlan, current) => render(visioDiagramPlan, { ...current, visioOptions: options }),
    ...(readback ? {
      readback: (visioDiagramPlan, renderResult, current) => readback(visioDiagramPlan, renderResult, { ...current, visioOptions: options }),
    } : {}),
  };
}

function agentRunStatus(result = {}) {
  if (result.status !== "completed") return result.status;
  if (!result.renderResult) return "plan_ready";
  if (result.renderResult.status === "dry_run") return "dry_run";
  if (!result.readback) return "rendered";
  return "completed";
}

async function defaultVisioRender(visioDiagramPlan, current = {}) {
  const options = current.visioOptions || {};
  const worker = visioWorkerForProcess();
  if (worker) return worker.render(visioDiagramPlan, options);
  const plan = buildVisioRenderPlan(visioDiagramPlan, options);
  if (process.env.VISIO_DRY_RUN === "1") return { status: "dry_run", plan };
  return renderUniversalFigureToVisio(visioDiagramPlan, options);
}

function visioWorkerForProcess() {
  if (process.env.VISIO_WORKER !== "1") return null;
  if (!visioWorker || visioWorker.closed) visioWorker = createVisioWorkerClient();
  return visioWorker;
}

async function defaultVisioReadback(_visioDiagramPlan, renderResult = {}) {
  return renderResult.readback || renderResult;
}

function nextResult(run) {
  const modelWorkspace = run.ir
    ? createModelWorkspace({
      id: run.id,
      ir: run.ir,
      visioDiagramPlan: run.visioDiagramPlan,
      publicationVisioDiagramPlan: run.publicationVisioDiagramPlan,
      publicationFigureQa: run.publicationFigureQa,
    })
    : undefined;
  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    snapshots: run.snapshots,
    diagnostics: run.diagnostics,
    attempts: { ...run.attempts },
    input: run.input,
    ir: run.ir,
    visioDiagramPlan: run.visioDiagramPlan,
    visioDiagramPlanValidation: run.visioDiagramPlanValidation,
    publicationVisioDiagramPlan: run.publicationVisioDiagramPlan,
    publicationVisioDiagramPlanValidation: run.publicationVisioDiagramPlanValidation,
    neuralFigureProgram: run.neuralFigureProgram,
    neuralFigurePlanValidation: run.neuralFigurePlanValidation,
    publicationFigureQa: run.publicationFigureQa,
    modelWorkspace,
    planOutput: run.planOutput,
    renderResult: run.renderResult,
    readback: run.readback,
  };
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
