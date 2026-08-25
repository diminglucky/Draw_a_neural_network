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
const sequentialDeclarationPattern = /^\s*self\.([A-Za-z][A-Za-z0-9_]*)\s*=\s*nn\.Sequential\s*\(/;
const staticListPattern = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*\[/;
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
  const staticLists = collectStaticLists(lines);
  const staticContainers = collectStaticSequentialContainers(input, lines, staticLists, unresolved);
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
  const consumedStaticForwardLoopBodyLines = new Set<number>();

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
    const staticContainer = staticContainers.byStartLine.get(lineNumber);
    if (staticContainer) {
      if (initializerIndentation == null || initializerControlIndentations.length > 0) {
        addUnresolved(input, unresolved, "conditional-module-declaration", line, codeLocator(line, lineNumber), `Sequential ${staticContainer.alias} is not declared on an unconditional __init__ path.`);
      }
      for (const module of staticContainer.modules) {
        if (modules.some((candidate) => candidate.id === module.id)) {
          addUnresolved(input, unresolved, "module-redeclaration", line, codeLocator(line, lineNumber), `Module ${module.id} is declared more than once; confirm which constructor is authoritative.`);
        }
        modules.push(module);
      }
    }
    const declaration = line.match(declarationPattern);
    if (declaration && !sequentialDeclarationPattern.test(line)) {
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

    if (consumedStaticForwardLoopBodyLines.has(lineNumber)) continue;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const locator = codeLocator(line, lineNumber);
    lastForwardBodyLocator = locator;
    lastForwardBodyLine = line;
    if (forwardHasReturn) {
      addUnresolved(input, unresolved, "unsupported-forward-statement", line, locator, "Static analysis does not support statements after the forward return.");
      continue;
    }

    const staticForwardLoop = parseStaticForwardLoop(lines, index, staticContainers.membersByAlias);
    if (staticForwardLoop) {
      for (const bodyLineNumber of staticForwardLoop.bodyLineNumbers) consumedStaticForwardLoopBodyLines.add(bodyLineNumber);
      if (!staticForwardLoop.supported) {
        addUnresolved(input, unresolved, "unsupported-static-loop", line, locator, staticForwardLoop.message);
        continue;
      }
      if (currentValue !== staticForwardLoop.inputValue) {
        addUnresolved(input, unresolved, "unsupported-forward-data-flow", line, locator, `Static analysis cannot prove that ${staticForwardLoop.inputValue} is the current forward value.`);
        continue;
      }
      appendForwardCall(calls, staticContainers.membersByAlias, staticForwardLoop.containerAlias, locator);
      currentValue = staticForwardLoop.targetValue;
      continue;
    }

    addDynamicUnresolveds(input, unresolved, line, lineNumber, line);

    const assignmentCall = line.match(assignmentCallPattern);
    if (assignmentCall) {
      const [, target, moduleId, inputValue] = assignmentCall;
      if (currentValue !== inputValue) {
        addUnresolved(input, unresolved, "unsupported-forward-data-flow", line, locator, `Static analysis cannot prove that ${inputValue} is the current forward value.`);
        continue;
      }
      appendForwardCall(calls, staticContainers.membersByAlias, moduleId, locator);
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
      appendForwardCall(calls, staticContainers.membersByAlias, moduleId, locator);
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

interface StaticSequentialContainers {
  byStartLine: Map<number, { alias: string; modules: DeclaredModuleObservation[] }>;
  membersByAlias: Map<string, string[]>;
}

function collectStaticLists(lines: string[]): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  for (const [index, line] of lines.entries()) {
    const match = line.match(staticListPattern);
    if (!match) continue;
    if (hasRuntimeControlAncestor(lines, index)) continue;
    const expression = collectBalancedDelimitedExpression(lines, index, line.indexOf("["), "[", "]");
    if (!expression) continue;
    const values = splitTopLevelArguments(expression.slice(1, -1));
    if (values.length > 0 && values.every(isStaticScalar)) lists.set(match[1], values);
  }
  return lists;
}

function collectStaticSequentialContainers(
  input: { sourceId: string; sourceSha256: string },
  lines: string[],
  staticLists: Map<string, string[]>,
  unresolved: StaticPyTorchUnresolved[],
): StaticSequentialContainers {
  const byStartLine = new Map<number, { alias: string; modules: DeclaredModuleObservation[] }>();
  const modulesByAlias = new Map<string, DeclaredModuleObservation[]>();
  for (const [index, line] of lines.entries()) {
    const declaration = line.match(sequentialDeclarationPattern);
    if (!declaration) continue;
    const alias = declaration[1];
    const locator = codeLocator(line, index + 1);
    const expression = collectBalancedDelimitedExpression(lines, index, line.indexOf("(", line.indexOf("nn.Sequential")), "(", ")");
    if (!expression) {
      addUnresolved(input, unresolved, "unsupported-static-container", line, locator, "Static analysis requires a balanced literal nn.Sequential declaration.");
      continue;
    }

    const modules = parseStaticSequentialExpression(input, expression, alias, line, locator, staticLists, unresolved);
    byStartLine.set(index + 1, { alias, modules });
    modulesByAlias.set(alias, modules);
  }
  expandStaticConstructionLoops(input, lines, staticLists, modulesByAlias, unresolved);
  const membersByAlias = new Map([...modulesByAlias.entries()].map(([alias, modules]) => [alias, modules.map((module) => module.id)]));
  return { byStartLine, membersByAlias };
}

function expandStaticConstructionLoops(
  input: { sourceId: string; sourceSha256: string },
  lines: string[],
  staticLists: Map<string, string[]>,
  modulesByAlias: Map<string, DeclaredModuleObservation[]>,
  unresolved: StaticPyTorchUnresolved[],
): void {
  for (const [index, line] of lines.entries()) {
    const loop = line.match(/^\s*for\s+([A-Za-z][A-Za-z0-9_]*)\s+in\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(?:#.*)?$/);
    if (!loop) {
      if (!/^\s*for\b/.test(line)) continue;
      const loopIndentation = indentation(line);
      let modifiesKnownContainer = false;
      for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
        const bodyLine = lines[bodyIndex];
        if (bodyLine.trim() && indentation(bodyLine) <= loopIndentation) break;
        const append = bodyLine.match(/^\s*self\.([A-Za-z][A-Za-z0-9_]*)\.append\(/);
        if (append && modulesByAlias.has(append[1])) modifiesKnownContainer = true;
      }
      if (modifiesKnownContainer) {
        addUnresolved(input, unresolved, "unsupported-static-loop", line, codeLocator(line, index + 1), "Static analysis only unrolls construction loops over a previously declared constant list.");
      }
      continue;
    }
    const loopIndentation = indentation(line);
    const body: Array<{ line: string; lineNumber: number }> = [];
    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const bodyLine = lines[bodyIndex];
      if (bodyLine.trim() && indentation(bodyLine) <= loopIndentation) break;
      if (bodyLine.trim() && !bodyLine.trimStart().startsWith("#")) body.push({ line: bodyLine, lineNumber: bodyIndex + 1 });
    }
    const appendInstructions = body.map((entry) => ({
      entry,
      match: entry.line.match(/^\s*self\.([A-Za-z][A-Za-z0-9_]*)\.append\(nn\.([A-Za-z][A-Za-z0-9_]*)\(([\s\S]*)\)\)\s*(?:#.*)?$/),
    }));
    const touchesKnownContainer = appendInstructions.some((instruction) => instruction.match && modulesByAlias.has(instruction.match[1]));
    if (!touchesKnownContainer) continue;
    const values = staticLists.get(loop[2]);
    const locator = codeLocator(line, index + 1);
    if (hasRuntimeControlAncestor(lines, index)) {
      addUnresolved(input, unresolved, "unsupported-static-loop", line, locator, "Static construction loops must be on the unconditional __init__ path.");
      continue;
    }
    if (!values || body.length === 0 || appendInstructions.some((instruction) => !instruction.match)) {
      addUnresolved(input, unresolved, "unsupported-static-loop", line, locator, "Static analysis only unrolls append-only construction loops over a previously declared constant list.");
      continue;
    }
    if (appendInstructions.some((instruction) => !modulesByAlias.has(instruction.match![1]) || !hasOnlyStaticListIndexes(instruction.match![3], staticLists))) {
      addUnresolved(input, unresolved, "unsupported-static-loop", line, locator, "Static construction loops may append only literal nn.<Module>(...) values into known Sequential containers.");
      continue;
    }
    for (const _value of values) {
      for (const instruction of appendInstructions) {
        const [, alias, constructor] = instruction.match!;
        const modules = modulesByAlias.get(alias)!;
        modules.push({ id: `${alias}.${modules.length}`, constructor, locator: codeLocator(instruction.entry.line, instruction.entry.lineNumber) });
      }
    }
  }
}

function hasRuntimeControlAncestor(lines: string[], lineIndex: number): boolean {
  const currentIndentation = indentation(lines[lineIndex]);
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index];
    if (!candidate.trim() || candidate.trimStart().startsWith("#")) continue;
    const candidateIndentation = indentation(candidate);
    if (candidateIndentation >= currentIndentation) continue;
    const statement = candidate.trimStart();
    if (/^def\s+__init__\b/.test(statement)) return false;
    if (/^(?:if|elif|else|for|while|try|except|finally|with|match)\b/.test(statement)) return true;
    return false;
  }
  return true;
}

function parseStaticSequentialExpression(
  input: { sourceId: string; sourceSha256: string },
  expression: string,
  prefix: string,
  sourceLineValue: string,
  locator: EvidenceLocator,
  staticLists: Map<string, string[]>,
  unresolved: StaticPyTorchUnresolved[],
): DeclaredModuleObservation[] {
  const match = expression.trim().match(/^\(([\s\S]*)\)$/);
  if (!match) return [];
  const modules: DeclaredModuleObservation[] = [];
  for (const [index, argument] of splitTopLevelArguments(match[1]).entries()) {
    const memberId = `${prefix}.${index}`;
    const nested = argument.match(/^nn\.Sequential\s*(\([\s\S]*\))$/);
    if (nested) {
      modules.push(...parseStaticSequentialExpression(input, nested[1], memberId, sourceLineValue, locator, staticLists, unresolved));
      continue;
    }
    const module = argument.match(/^nn\.([A-Za-z][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/);
    if (!module || !hasOnlyStaticListIndexes(module[2], staticLists)) {
      addUnresolved(input, unresolved, "unsupported-static-container", sourceLineValue, locator, "Static analysis only expands literal nn.<Module>(...) members with statically known configuration indexes.");
      continue;
    }
    modules.push({ id: memberId, constructor: module[1], locator });
  }
  return modules;
}

function collectBalancedDelimitedExpression(lines: string[], startIndex: number, startColumn: number, opening: "(" | "[", closing: ")" | "]"): string | null {
  if (startColumn < 0) return null;
  const source = lines.slice(startIndex).join("\n").slice(startColumn);
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (!escaped && character === quote) quote = null;
      escaped = !escaped && character === "\\";
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(0, index + 1);
    }
  }
  return null;
}

function splitTopLevelArguments(source: string): string[] {
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (!escaped && character === quote) quote = null;
      escaped = !escaped && character === "\\";
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) depth -= 1;
    if (character === "," && depth === 0) {
      const value = source.slice(start, index).trim();
      if (value) values.push(value);
      start = index + 1;
    }
  }
  const value = source.slice(start).trim();
  if (value) values.push(value);
  return values;
}

function isStaticScalar(value: string): boolean {
  return /^(?:None|True|False|[-+]?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.test(value.trim());
}

function hasOnlyStaticListIndexes(source: string, lists: Map<string, string[]>): boolean {
  for (const match of source.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*\[\s*([^\]]+)\s*\]/g)) {
    const values = lists.get(match[1]);
    const index = Number(match[2]);
    if (!values || !Number.isInteger(index) || index < 0 || index >= values.length) return false;
  }
  return true;
}

function appendForwardCall(calls: ForwardCallObservation[], membersByAlias: Map<string, string[]>, moduleId: string, locator: EvidenceLocator): void {
  for (const resolvedModuleId of membersByAlias.get(moduleId) ?? [moduleId]) {
    calls.push({ id: `forward:${calls.length + 1}`, moduleId: resolvedModuleId, locator });
  }
}

interface StaticForwardLoop {
  bodyLineNumbers: number[];
  containerAlias: string;
  inputValue: string;
  targetValue: string;
  supported: boolean;
  message: string;
}

function parseStaticForwardLoop(lines: string[], startIndex: number, membersByAlias: Map<string, string[]>): StaticForwardLoop | null {
  const line = lines[startIndex];
  const loop = line.match(/^\s*for\s+([A-Za-z][A-Za-z0-9_]*)\s+in\s+self\.([A-Za-z][A-Za-z0-9_]*)\s*:\s*(?:#.*)?$/);
  if (!loop) return null;
  const loopIndentation = indentation(line);
  const body: string[] = [];
  const bodyLineNumbers: number[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const bodyLine = lines[index];
    if (bodyLine.trim() && indentation(bodyLine) <= loopIndentation) break;
    bodyLineNumbers.push(index + 1);
    if (bodyLine.trim() && !bodyLine.trimStart().startsWith("#")) body.push(bodyLine);
  }
  const [, iterationValue, containerAlias] = loop;
  const assignment = body.length === 1
    ? body[0].match(new RegExp(`^\\s*([A-Za-z][A-Za-z0-9_]*)\\s*=\\s*${iterationValue}\\(([A-Za-z][A-Za-z0-9_]*)\\)\\s*(?:#.*)?$`))
    : null;
  if (!membersByAlias.has(containerAlias) || !assignment) {
    return { bodyLineNumbers, containerAlias, inputValue: "", targetValue: "", supported: false, message: "Static analysis only unrolls a forward loop over a known Sequential with one linear value = layer(currentValue) statement." };
  }
  return { bodyLineNumbers, containerAlias, inputValue: assignment[2], targetValue: assignment[1], supported: true, message: "" };
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
