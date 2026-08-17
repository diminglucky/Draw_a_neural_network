import { createHash } from "node:crypto";
import { type EvidenceGraph, type EvidenceLocator, type EvidenceRef, parseEvidenceGraph } from "./evidence-graph.js";

export interface DeclaredModuleObservation {
  id: string;
  constructor: string;
  locator: EvidenceLocator;
}

export interface ForwardCallObservation {
  id: string;
  moduleId: string;
  locator: EvidenceLocator;
}

export interface StaticPyTorchUnresolved {
  code: string;
  severity: "blocking" | "warning";
  locator: EvidenceLocator;
  evidenceRefs: EvidenceRef[];
  message: string;
}

export interface StaticPyTorchAnalysis {
  sourceId: string;
  sourceSha256: string;
  modules: DeclaredModuleObservation[];
  calls: ForwardCallObservation[];
  evidence: EvidenceGraph;
  unresolved: StaticPyTorchUnresolved[];
}

const declarationPattern = /^\s*self\.([A-Za-z][A-Za-z0-9_]*)\s*=\s*nn\.([A-Za-z][A-Za-z0-9_]*)\([^\r\n]*\)\s*(?:#.*)?$/;
const forwardPattern = /^(\s*)def\s+forward\s*\([^\r\n]*\)\s*:\s*(.*)$/;
const assignmentCallPattern = /^\s*x\s*=\s*self\.([A-Za-z][A-Za-z0-9_]*)\(x\)\s*(?:#.*)?$/;
const returnCallPattern = /^\s*return\s+self\.([A-Za-z][A-Za-z0-9_]*)\(x\)\s*(?:#.*)?$/;
const dynamicSourcePattern = /\b(if|for|while|try|with|match|lambda|getattr|setattr|eval|exec)\b/g;
const controlFlowTerms = new Set(["if", "for", "while", "try", "with", "match"]);
const syntheticInputId = "terminal:input";
const syntheticOutputId = "terminal:output";

function codeLocator(line: string, lineNumber: number): EvidenceLocator {
  const startColumn = line.search(/\S/) + 1;
  return {
    kind: "code",
    startLine: lineNumber,
    startColumn: startColumn > 0 ? startColumn : 1,
    endLine: lineNumber,
    endColumn: line.length + 1,
  };
}

function lineDigest(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

function evidenceRef(sourceId: string, sourceSha256: string, line: string, locator: EvidenceLocator): EvidenceRef {
  return { sourceId, sourceSha256, locator, excerptDigest: lineDigest(line) };
}

function sourceLine(lines: string[], locator: EvidenceLocator): string {
  if (locator.kind !== "code") throw new Error("Static PyTorch observations require code locators");
  return lines[locator.startLine - 1];
}

function codeWithoutCommentsOrQuotedLiterals(line: string): string {
  let code = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let fString = false;
  let replacementDepth = 0;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (fString && replacementDepth > 0) {
        code += character;
        if (character === "{") replacementDepth += 1;
        if (character === "}") replacementDepth -= 1;
        continue;
      }
      code += " ";
      if (fString && character === "{") {
        code = `${code.slice(0, -1)}${character}`;
        replacementDepth = 1;
        continue;
      }
      if (!escaped && character === quote) quote = null;
      if (!quote) fString = false;
      escaped = !escaped && character === "\\";
      continue;
    }
    if (character === "#") break;
    if (character === "'" || character === '"') {
      quote = character;
      fString = index > 0 && (line[index - 1] === "f" || line[index - 1] === "F");
      code += " ";
      continue;
    }
    code += character;
  }

  return code;
}

export function analyzeStaticPyTorchSource(input: { sourceId: string; sourceSha256: string; code: string }): StaticPyTorchAnalysis {
  const lines = input.code.split(/\r?\n/);
  const modules: DeclaredModuleObservation[] = [];
  const calls: ForwardCallObservation[] = [];
  const unresolved: StaticPyTorchUnresolved[] = [];
  let forwardIndentation: number | null = null;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const declaration = line.match(declarationPattern);
    if (declaration) {
      modules.push({ id: declaration[1], constructor: declaration[2], locator: codeLocator(line, lineNumber) });
    }

    const forward = line.match(forwardPattern);
    if (forward) {
      forwardIndentation = forward[1].length;
      addDynamicUnresolveds(input, unresolved, line, lineNumber, forward[2]);
      continue;
    }

    if (forwardIndentation != null && line.trim() && indentation(line) <= forwardIndentation) forwardIndentation = null;
    if (forwardIndentation == null) continue;

    addDynamicUnresolveds(input, unresolved, line, lineNumber, line);

    const call = line.match(assignmentCallPattern) ?? line.match(returnCallPattern);
    if (call) calls.push({ id: `forward:${calls.length + 1}`, moduleId: call[1], locator: codeLocator(line, lineNumber) });
  }

  const declarations = new Map(modules.map((module) => [module.id, module]));
  const calledModuleIds = new Set(calls.map((call) => call.moduleId));
  const observedModuleIds = [...new Set([...modules.map((module) => module.id), ...calledModuleIds])];
  const facts: unknown[] = [];

  for (const moduleId of observedModuleIds) {
    const declaration = declarations.get(moduleId);
    const call = calls.find((candidate) => candidate.moduleId === moduleId);
    const observation = declaration ?? call!;
    const line = sourceLine(lines, observation.locator);
    const reference = evidenceRef(input.sourceId, input.sourceSha256, line, observation.locator);
    const semanticRole = declaration?.constructor ?? "module";

    facts.push(
      acceptedFact(`node-exists:${moduleId}`, "node_exists", { kind: "node", nodeId: moduleId }, { kind: "node_exists", operatorKind: "module" }, reference, `node:${moduleId}:exists`),
      acceptedFact(`node-kind:${moduleId}`, "node_kind", { kind: "node", nodeId: moduleId }, { kind: "node_kind", semanticRole }, reference, `node:${moduleId}:kind`),
    );
  }

  const completeLinearPath = unresolved.every((item) => item.severity !== "blocking")
    && calls.length > 0
    && calls.every((call) => declarations.has(call.moduleId));
  if (completeLinearPath) {
    const firstCall = calls[0];
    const finalCall = calls[calls.length - 1];
    const inputReference = evidenceRef(input.sourceId, input.sourceSha256, sourceLine(lines, firstCall.locator), firstCall.locator);
    const outputReference = evidenceRef(input.sourceId, input.sourceSha256, sourceLine(lines, finalCall.locator), finalCall.locator);

    facts.push(
      acceptedFact(`node-exists:${syntheticInputId}`, "node_exists", { kind: "node", nodeId: syntheticInputId }, { kind: "node_exists", operatorKind: "input" }, inputReference, `node:${syntheticInputId}:exists`),
      acceptedFact(`node-kind:${syntheticInputId}`, "node_kind", { kind: "node", nodeId: syntheticInputId }, { kind: "node_kind", semanticRole: "input" }, inputReference, `node:${syntheticInputId}:kind`),
      acceptedFact(`node-exists:${syntheticOutputId}`, "node_exists", { kind: "node", nodeId: syntheticOutputId }, { kind: "node_exists", operatorKind: "output" }, outputReference, `node:${syntheticOutputId}:exists`),
      acceptedFact(`node-kind:${syntheticOutputId}`, "node_kind", { kind: "node", nodeId: syntheticOutputId }, { kind: "node_kind", semanticRole: "output" }, outputReference, `node:${syntheticOutputId}:kind`),
    );

    const path = [syntheticInputId, ...calls.map((call) => call.moduleId), syntheticOutputId];
    for (let index = 0; index < path.length - 1; index += 1) {
      const call = index === 0 ? firstCall : calls[index - 1];
      const reference = evidenceRef(input.sourceId, input.sourceSha256, sourceLine(lines, call.locator), call.locator);
      facts.push(acceptedFact(
        `edge-exists:${index + 1}:${path[index]}:${path[index + 1]}`,
        "edge_exists",
        { kind: "edge", sourcePortId: `${path[index]}:out`, targetPortId: `${path[index + 1]}:in` },
        { kind: "edge_exists", transport: "data" },
        reference,
        `edge:${path[index]}:${path[index + 1]}`,
      ));
    }
  }

  return {
    sourceId: input.sourceId,
    sourceSha256: input.sourceSha256,
    modules,
    calls,
    evidence: parseEvidenceGraph({ version: 2, facts, relations: [] }),
    unresolved,
  };
}

function addDynamicUnresolveds(
  input: { sourceId: string; sourceSha256: string },
  unresolved: StaticPyTorchUnresolved[],
  sourceLine: string,
  lineNumber: number,
  code: string,
): void {
  for (const match of codeWithoutCommentsOrQuotedLiterals(code).matchAll(dynamicSourcePattern)) {
    const term = match[1];
    const locator = codeLocator(sourceLine, lineNumber);
    const isControlFlow = controlFlowTerms.has(term);
    unresolved.push({
      severity: "blocking",
      code: isControlFlow ? "dynamic-control-flow" : "dynamic-runtime-call",
      locator,
      evidenceRefs: [evidenceRef(input.sourceId, input.sourceSha256, sourceLine, locator)],
      message: isControlFlow
        ? `Static analysis does not support ${term} in forward.`
        : `Static analysis does not support dynamic runtime call ${term} in forward.`,
    });
  }
}

function acceptedFact(
  id: string,
  kind: "node_exists" | "node_kind" | "edge_exists",
  subject: unknown,
  payload: unknown,
  reference: unknown,
  conflictKey: string,
) {
  return {
    id,
    kind,
    subject,
    payload,
    evidenceRefs: [reference],
    extractionConfidence: 1,
    decisionConfidence: 1,
    sourceRole: "code",
    scope: "architecture",
    status: "accepted",
    analyzer: { id: "pytorch-static", version: "1.0.0", policy: "static" },
    conflictGroupId: null,
    conflictKey,
  };
}
