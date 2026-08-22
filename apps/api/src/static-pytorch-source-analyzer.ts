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
const initializerPattern = /^(\s*)def\s+__init__\s*\([^\r\n]*\)\s*:\s*(.*)$/;
const forwardPattern = /^(\s*)def\s+forward\s*\(([^\r\n]*)\)\s*:\s*(.*)$/;
const assignmentCallPattern = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*self\.([A-Za-z][A-Za-z0-9_]*)\(([A-Za-z][A-Za-z0-9_]*)\)\s*(?:#.*)?$/;
const returnCallPattern = /^\s*return\s+self\.([A-Za-z][A-Za-z0-9_]*)\(([A-Za-z][A-Za-z0-9_]*)\)\s*(?:#.*)?$/;
const returnValuePattern = /^\s*return\s+([A-Za-z][A-Za-z0-9_]*)\s*(?:#.*)?$/;
const inertLiteralAssignmentPattern = /^\s*[A-Za-z][A-Za-z0-9_]*\s*=\s*(?:None|True|False|[-+]?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?:#.*)?$/;
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
  if (createHash("sha256").update(input.code, "utf8").digest("hex") !== input.sourceSha256.toLowerCase()) {
    throw new Error("Static PyTorch source digest does not match submitted bytes");
  }
  const lines = input.code.split(/\r?\n/);
  const modules: DeclaredModuleObservation[] = [];
  const calls: ForwardCallObservation[] = [];
  const unresolved: StaticPyTorchUnresolved[] = [];
  let forwardIndentation: number | null = null;
  let forwardInput: string | null = null;
  let currentValue: string | null = null;
  let forwardHasReturn = false;
  let hasCompletedForward = false;
  let forwardDefinitionCount = 0;
  let forwardLocator: EvidenceLocator | null = null;
  let forwardSourceLine: string | null = null;
  let lastForwardBodyLocator: EvidenceLocator | null = null;
  let lastForwardBodyLine: string | null = null;
  let initializerIndentation: number | null = null;
  let initializerControlIndentations: number[] = [];

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (initializerIndentation != null && line.trim() && indentation(line) <= initializerIndentation) {
      initializerIndentation = null;
      initializerControlIndentations = [];
    }
    const initializer = line.match(initializerPattern);
    if (initializer) {
      initializerIndentation = initializer[1].length;
      initializerControlIndentations = [];
    } else if (initializerIndentation != null && line.trim() && !line.trimStart().startsWith("#")) {
      const currentIndentation = indentation(line);
      const previousControlIndentations = initializerControlIndentations;
      initializerControlIndentations = initializerControlIndentations.filter((controlIndentation) => currentIndentation > controlIndentation);
      const statement = line.trimStart();
      if (currentIndentation > initializerIndentation && /^(?:if|for|while|try|with|match)\b/.test(statement)) {
        initializerControlIndentations.push(currentIndentation);
      } else if (currentIndentation > initializerIndentation && /^(?:elif|else|except|finally)\b/.test(statement) && previousControlIndentations.includes(currentIndentation)) {
        initializerControlIndentations.push(currentIndentation);
      }
    }
    const declaration = line.match(declarationPattern);
    if (declaration) {
      if (initializerIndentation == null || initializerControlIndentations.length > 0) {
        addUnresolved(
          input,
          unresolved,
          "conditional-module-declaration",
          line,
          codeLocator(line, lineNumber),
          `Module ${declaration[1]} is not declared on an unconditional __init__ path.`,
        );
      }
      if (modules.some((module) => module.id === declaration[1])) {
        addUnresolved(input, unresolved, "module-redeclaration", line, codeLocator(line, lineNumber), `Module ${declaration[1]} is declared more than once; confirm which constructor is authoritative.`);
      }
      modules.push({ id: declaration[1], constructor: declaration[2], locator: codeLocator(line, lineNumber) });
    }

    const forward = line.match(forwardPattern);
    if (forward) {
      if (forwardDefinitionCount > 0) {
        addUnresolved(input, unresolved, "multiple-forward-definitions", line, codeLocator(line, lineNumber), "Static analysis requires exactly one forward definition.");
      }
      forwardDefinitionCount += 1;
      if (forwardIndentation != null) {
        if (forwardHasReturn) hasCompletedForward = true;
        else finalizeForwardIfNeeded(input, unresolved, lastForwardBodyLine ?? forwardSourceLine ?? line, lastForwardBodyLocator ?? forwardLocator ?? codeLocator(line, lineNumber));
      }
      forwardIndentation = forward[1].length;
      forwardInput = forwardInputName(forward[2]);
      currentValue = forwardInput;
      forwardHasReturn = false;
      forwardLocator = codeLocator(line, lineNumber);
      forwardSourceLine = line;
      lastForwardBodyLocator = null;
      lastForwardBodyLine = null;
      if (!forwardInput) {
        addUnresolved(input, unresolved, "unsupported-forward-signature", line, codeLocator(line, lineNumber), "Static analysis requires a forward(self, x) signature with one data input.");
      }
      addDynamicUnresolveds(input, unresolved, line, lineNumber, forward[3]);
      if (forward[3].trim()) addUnresolved(input, unresolved, "unsupported-forward-statement", line, codeLocator(line, lineNumber), "Static analysis does not support inline forward statements.");
      continue;
    }

    if (forwardIndentation != null && line.trim() && indentation(line) <= forwardIndentation) {
      if (forwardHasReturn) hasCompletedForward = true;
      else finalizeForwardIfNeeded(input, unresolved, lastForwardBodyLine ?? forwardSourceLine ?? line, lastForwardBodyLocator ?? forwardLocator ?? codeLocator(line, lineNumber));
      forwardIndentation = null;
      forwardInput = null;
      currentValue = null;
      forwardHasReturn = false;
      forwardLocator = null;
      forwardSourceLine = null;
      lastForwardBodyLocator = null;
      lastForwardBodyLine = null;
    }
    if (forwardIndentation == null) continue;

    addDynamicUnresolveds(input, unresolved, line, lineNumber, line);
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const locator = codeLocator(line, lineNumber);
    lastForwardBodyLocator = locator;
    lastForwardBodyLine = line;
    if (forwardHasReturn) {
      addUnresolved(input, unresolved, "unsupported-forward-statement", line, locator, "Static analysis does not support statements after the forward return.");
      continue;
    }

    const assignmentCall = line.match(assignmentCallPattern);
    if (assignmentCall) {
      const [, target, moduleId, inputValue] = assignmentCall;
      if (currentValue !== inputValue) {
        addUnresolved(input, unresolved, "unsupported-forward-data-flow", line, locator, `Static analysis cannot prove that ${inputValue} is the current forward value.`);
        continue;
      }
      calls.push({ id: `forward:${calls.length + 1}`, moduleId, locator });
      currentValue = target;
      continue;
    }

    const returnCall = line.match(returnCallPattern);
    if (returnCall) {
      const [, moduleId, inputValue] = returnCall;
      if (currentValue !== inputValue) {
        addUnresolved(input, unresolved, "unsupported-forward-data-flow", line, locator, `Static analysis cannot prove that ${inputValue} is the current forward value.`);
        continue;
      }
      calls.push({ id: `forward:${calls.length + 1}`, moduleId, locator });
      forwardHasReturn = true;
      continue;
    }

    const returnValue = line.match(returnValuePattern);
    if (returnValue) {
      if (currentValue !== returnValue[1]) {
        addUnresolved(input, unresolved, "unsupported-forward-data-flow", line, locator, `Static analysis cannot prove that ${returnValue[1]} is the current forward value.`);
        continue;
      }
      forwardHasReturn = true;
      continue;
    }

    if (inertLiteralAssignmentPattern.test(line)) continue;
    addUnresolved(input, unresolved, "unsupported-forward-statement", line, locator, "Static analysis only supports a linear self.<module>(value) forward path.");
  }

  if (forwardIndentation != null) {
    if (forwardHasReturn) hasCompletedForward = true;
    else finalizeForwardIfNeeded(input, unresolved, lastForwardBodyLine ?? forwardSourceLine ?? "", lastForwardBodyLocator ?? forwardLocator ?? codeLocator("", lines.length || 1));
  }

  const declarations = new Map(modules.map((module) => [module.id, module]));
  for (const call of calls) {
    if (!declarations.has(call.moduleId)) {
      addUnresolved(input, unresolved, "unknown-module-call", sourceLine(lines, call.locator), call.locator, `Forward calls undeclared module ${call.moduleId}.`);
    }
  }
  const seenCalls = new Set<string>();
  for (const call of calls) {
    if (seenCalls.has(call.moduleId)) addUnresolved(input, unresolved, "module-reuse", sourceLine(lines, call.locator), call.locator, `Module ${call.moduleId} is called more than once; confirm whether it is reused or expanded.`);
    seenCalls.add(call.moduleId);
  }
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
    && calls.every((call) => declarations.has(call.moduleId))
    && hasCompletedForward;
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

function forwardInputName(parameters: string): string | null {
  const match = parameters.match(/^\s*self\s*,\s*([A-Za-z][A-Za-z0-9_]*)\s*$/);
  return match?.[1] ?? null;
}

function addUnresolved(
  input: { sourceId: string; sourceSha256: string },
  unresolved: StaticPyTorchUnresolved[],
  code: string,
  sourceLine: string,
  locator: EvidenceLocator,
  message: string,
): void {
  unresolved.push({
    severity: "blocking",
    code,
    locator,
    evidenceRefs: [evidenceRef(input.sourceId, input.sourceSha256, sourceLine, locator)],
    message,
  });
}

function finalizeForwardIfNeeded(
  input: { sourceId: string; sourceSha256: string },
  unresolved: StaticPyTorchUnresolved[],
  sourceLine: string,
  locator: EvidenceLocator,
): void {
  addUnresolved(input, unresolved, "unsupported-forward", sourceLine, locator, "Static analysis requires an explicit return from the supported forward path.");
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
