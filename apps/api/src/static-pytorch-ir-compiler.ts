import type { StructuralFact } from "./evidence-graph.js";
import type { ArchitectureIRv3 } from "./network-ir-v3.js";
import { parseArchitectureIRv3 } from "./network-ir-v3.js";
import type { StaticPyTorchAnalysis } from "./static-pytorch-source-analyzer.js";

const vectorDataPort = { representation: "vector" as const, semanticType: "data" as const };

export function compileStaticPyTorchToArchitectureIR(
  analysis: StaticPyTorchAnalysis,
  options?: { renderReady?: boolean },
): ArchitectureIRv3 {
  const renderReady = options?.renderReady ?? false;
  const blocking = analysis.unresolved.find((item) => item.severity === "blocking");
  if (blocking) {
    if (renderReady) throw new Error(`Cannot compile static PyTorch analysis with blocking unresolved item: ${blocking.code}: ${blocking.message}`);
    return compileCandidate(analysis, [candidateQuestion(blocking.code, blocking.message, blocking.locator)]);
  }

  const declarations = new Map(analysis.modules.map((module) => [module.id, module]));
  const calledModuleIds = analysis.calls.map((call) => {
    if (!declarations.has(call.moduleId)) {
      if (renderReady) throw new Error(`Cannot compile call ${call.id}: declared module ${call.moduleId} is missing`);
      return call.moduleId;
    }
    return call.moduleId;
  });
  if (new Set(calledModuleIds).size !== calledModuleIds.length) {
    if (renderReady) throw new Error("Cannot compile repeated module calls without guessing reuse semantics");
    const repeated = calledModuleIds.find((moduleId, index) => calledModuleIds.indexOf(moduleId) !== index) ?? "module";
    return compileCandidate(analysis, [candidateQuestion("module-reuse", `Module ${repeated} is called more than once; confirm whether it is reused or expanded.`, analysis.calls.find((call) => call.moduleId === repeated)?.locator ?? firstLocator(analysis))]);
  }
  if (calledModuleIds.length === 0) {
    if (renderReady) throw new Error("Cannot compile static PyTorch analysis without a supported forward call");
    return compileCandidate(analysis, [candidateQuestion("unsupported-forward", "No supported static forward call was identified; confirm the forward path.", firstLocator(analysis))]);
  }

  const inputId = terminalId(analysis, "input");
  const outputId = terminalId(analysis, "output");
  const path = [inputId, ...calledModuleIds, outputId];
  const nodeEvidence = (nodeId: string, operatorKind: "input" | "output" | "module", semanticRole: string) => [
    requiredNodeFact(analysis, nodeId, "node_exists", operatorKind).id,
    requiredNodeFact(analysis, nodeId, "node_kind", semanticRole).id,
  ];

  const ir: ArchitectureIRv3 = {
    version: 3,
    graphId: `pytorch:${analysis.sourceId}`,
    inputs: [{ nodeId: inputId, portId: "out" }],
    outputs: [{ nodeId: outputId, portId: "out" }],
    modules: [],
    nodes: [
      { id: inputId, kind: "input", semanticRole: "input", inputPorts: [], outputPorts: [{ id: "out", ...vectorDataPort }], evidenceIds: nodeEvidence(inputId, "input", "input") },
      ...analysis.calls.map((call) => {
        const declaration = declarations.get(call.moduleId)!;
        return {
          id: declaration.id,
          kind: "operator" as const,
          semanticRole: declaration.constructor,
          inputPorts: [{ id: "in", ...vectorDataPort }],
          outputPorts: [{ id: "out", ...vectorDataPort }],
          evidenceIds: nodeEvidence(declaration.id, "module", declaration.constructor),
        };
      }),
      { id: outputId, kind: "output", semanticRole: "output", inputPorts: [{ id: "in", ...vectorDataPort }], outputPorts: [{ id: "out", representation: "vector", semanticType: "prediction" }], evidenceIds: nodeEvidence(outputId, "output", "output") },
    ],
    edges: path.slice(0, -1).map((sourceNodeId, index) => {
      const targetNodeId = path[index + 1];
      return {
        id: `edge:${sourceNodeId}:${targetNodeId}`,
        source: { nodeId: sourceNodeId, portId: "out" },
        target: { nodeId: targetNodeId, portId: "in" },
        transport: "data" as const,
        evidenceIds: [requiredEdgeFact(analysis, sourceNodeId, targetNodeId).id],
      };
    }),
    processes: [],
    evidenceIndex: evidenceIndexFor(analysis),
    unresolved: [],
  };

  return parseArchitectureIRv3(ir, analysis.evidence, { renderReady });
}

function compileCandidate(analysis: StaticPyTorchAnalysis, questions: UnresolvedQuestionInput[]): ArchitectureIRv3 {
  const inputId = "terminal:input";
  const outputId = "terminal:output";
  const observedModuleIds = [...new Set([...analysis.modules.map((module) => module.id), ...analysis.calls.map((call) => call.moduleId)])];
  const nodeEvidence = (nodeId: string) => analysis.evidence.facts
    .filter((fact) => fact.subject.kind === "node" && fact.subject.nodeId === nodeId && fact.status === "accepted")
    .map((fact) => fact.id);
  const unresolved = questions.map((question, index) => ({
    id: `candidate-${index + 1}-${question.code}`,
    severity: "blocking" as const,
    conflictKey: question.code,
    candidateValues: [],
    evidenceFactIds: [],
    dependencyQuestionIds: [],
  }));
  const ir: ArchitectureIRv3 = {
    version: 3,
    graphId: `pytorch:${analysis.sourceId}`,
    inputs: [{ nodeId: inputId, portId: "out" }],
    outputs: [{ nodeId: outputId, portId: "out" }],
    modules: [],
    nodes: [
      { id: inputId, kind: "input", semanticRole: "input", inputPorts: [], outputPorts: [{ id: "out", ...vectorDataPort }], evidenceIds: [] },
      ...observedModuleIds.map((moduleId) => ({
        id: moduleId,
        kind: "operator" as const,
        semanticRole: analysis.modules.find((module) => module.id === moduleId)?.constructor ?? "module",
        inputPorts: [{ id: "in", ...vectorDataPort }],
        outputPorts: [{ id: "out", ...vectorDataPort }],
        evidenceIds: nodeEvidence(moduleId),
      })),
      { id: outputId, kind: "output", semanticRole: "output", inputPorts: [{ id: "in", ...vectorDataPort }], outputPorts: [{ id: "out", representation: "vector", semanticType: "prediction" }], evidenceIds: [] },
    ],
    edges: [],
    processes: [],
    evidenceIndex: evidenceIndexFor(analysis),
    unresolved,
  };
  return parseArchitectureIRv3(ir, analysis.evidence, { renderReady: false });
}

interface UnresolvedQuestionInput {
  code: string;
  message: string;
  locator: StaticPyTorchAnalysis["unresolved"][number]["locator"];
}

function candidateQuestion(code: string, message: string, locator: UnresolvedQuestionInput["locator"]): UnresolvedQuestionInput {
  return { code, message, locator };
}

function evidenceIndexFor(analysis: StaticPyTorchAnalysis): ArchitectureIRv3["evidenceIndex"] {
  return Object.fromEntries(
    analysis.evidence.facts
      .filter((fact) => fact.status === "accepted" && fact.evidenceRefs.length > 0)
      .map((fact) => [fact.id, structuredClone(fact.evidenceRefs)]),
  );
}

function firstLocator(analysis: StaticPyTorchAnalysis): UnresolvedQuestionInput["locator"] {
  return analysis.calls[0]?.locator ?? analysis.modules[0]?.locator ?? { kind: "code", startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 };
}

function terminalId(analysis: StaticPyTorchAnalysis, operatorKind: "input" | "output"): string {
  const facts = analysis.evidence.facts.filter((candidate) => candidate.status === "accepted"
    && candidate.kind === "node_exists"
    && candidate.subject.kind === "node"
    && candidate.payload.operatorKind === operatorKind);
  if (facts.length !== 1) {
    throw new Error(`Cannot compile: expected exactly one accepted ${operatorKind} terminal fact`);
  }
  const fact = facts[0];
  if (fact.kind !== "node_exists" || fact.subject.kind !== "node") throw new Error(`Cannot compile: expected exactly one accepted ${operatorKind} terminal fact`);
  return fact.subject.nodeId;
}

function requiredNodeFact(
  analysis: StaticPyTorchAnalysis,
  nodeId: string,
  kind: "node_exists" | "node_kind",
  expected: string,
): StructuralFact {
  const fact = kind === "node_exists"
    ? analysis.evidence.facts.find((candidate) => candidate.status === "accepted"
      && candidate.kind === "node_exists"
      && candidate.subject.kind === "node"
      && candidate.subject.nodeId === nodeId
      && candidate.payload.operatorKind === expected)
    : analysis.evidence.facts.find((candidate) => candidate.status === "accepted"
      && candidate.kind === "node_kind"
      && candidate.subject.kind === "node"
      && candidate.subject.nodeId === nodeId
      && candidate.payload.semanticRole === expected);
  if (!fact) throw new Error(`Cannot compile node ${nodeId}: missing accepted ${kind} evidence`);
  return fact;
}

function requiredEdgeFact(analysis: StaticPyTorchAnalysis, sourceNodeId: string, targetNodeId: string): StructuralFact {
  const fact = analysis.evidence.facts.find((candidate) => candidate.status === "accepted"
    && candidate.kind === "edge_exists"
    && candidate.subject.kind === "edge"
    && candidate.subject.sourcePortId === `${sourceNodeId}:out`
    && candidate.subject.targetPortId === `${targetNodeId}:in`
    && candidate.payload.transport === "data");
  if (!fact) throw new Error(`Cannot compile edge ${sourceNodeId} -> ${targetNodeId}: missing accepted edge_exists evidence`);
  return fact;
}
