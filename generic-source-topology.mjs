import { classifyOperation } from "./universal-ir.mjs";

const GENERIC_SOURCE_VERSION = "generic-source-topology/v1";
const IGNORED_IDENTIFIERS = new Set([
  "self", "True", "False", "None", "and", "or", "not", "in", "as",
  "training", "dim", "axis", "keepdims", "dtype", "device", "shape",
  "width", "height", "depth", "heads", "channels", "filters", "units",
  "kernel", "kernel_size", "stride", "strides", "padding", "batch_size",
  "range", "enumerate", "_",
]);
const NAMESPACE_IDENTIFIERS = new Set(["torch", "tf", "nn", "F", "ops", "layers", "keras"]);

/**
 * Extract a framework-neutral graph from common source-level assignment and
 * call syntax. It intentionally does not execute Python or assume a model
 * family. Unknown constructors remain custom operators in Universal IR.
 */
export function extractGenericSourceTopology(source = "", framework = "auto") {
  const text = String(source || "");
  const inferredFramework = framework === "auto" ? inferFramework(text) : framework;
  const definitions = collectModuleDefinitions(text);
  const statements = inferredFramework === "pytorch"
    ? extractForwardStatements(text)
    : text.split(/\r?\n/).map((line, index) => ({ text: line, line: index + 1 }));
  const parameters = inferredFramework === "pytorch" ? extractForwardParameters(text) : [];
  const nodes = [];
  const edges = [];
  const variableProducers = new Map();
  const knownVariables = new Set(parameters);
  const outputVariables = [];
  const controlStack = [];
  const controlDiagnostics = [];
  let operationIndex = 0;

  parameters.forEach((name, index) => addInputNode(name, index + 1));

  statements.forEach(({ text: rawText, line }) => {
    const textLine = rawText.replace(/#.*$/, "").trim();
    if (!textLine) return;
    const indent = indentationWidth(rawText);
    while (controlStack.length && indent <= controlStack[controlStack.length - 1].indent) controlStack.pop();

    const control = parseControlStatement(textLine);
    if (control) {
      addControlNode({ ...control, indent }, line);
      return;
    }

    const returnMatch = textLine.match(/^return\s+(.+)$/);
    if (returnMatch) {
      const call = parseCallExpression(returnMatch[1], definitions);
      if (call) {
        const outputs = [`return-${operationIndex + 1}`];
        addOperation(call, outputs, line, returnMatch[1]);
        outputVariables.push(...outputs);
      } else {
        outputVariables.push(...extractVariableNames(returnMatch[1], knownVariables));
      }
      return;
    }

    const assignment = parseAssignment(textLine);
    if (!assignment) return;
    if (/^(?:model|network)\s*=\s*(?:keras\.)?Model\b/i.test(textLine)) return;

    const call = parseCallExpression(assignment.expression, definitions);
    if (!call) return;
    const outputs = assignment.outputs.length ? assignment.outputs : [`anonymous-${operationIndex + 1}`];

    if (call.op === "Input") {
      outputs.forEach((name, index) => addInputNode(name, operationIndex + index + 1, line));
      return;
    }

    addOperation(call, outputs, line, assignment.expression);
    if (/^outputs?$|^prediction$|^logits$|^mask$/i.test(assignment.outputs[0] || "")) {
      outputVariables.push(...assignment.outputs);
    }
  });

  if (!nodes.some((node) => node.family !== "input" && node.family !== "output")) return null;

  const outputNames = [...new Set(outputVariables.filter(Boolean))];
  if (outputNames.length) addOutputNode(outputNames, statements.length + 1);

  return {
    version: GENERIC_SOURCE_VERSION,
    source: {
      kind: inferredFramework,
      parser: "generic-static-source",
      textLength: text.length,
    },
    figure: {
      title: `${titleCase(inferredFramework)} architecture extracted from source`,
      subtitle: "Framework-neutral topology; unresolved operators retain evidence and confidence",
      stages: [
        "Input",
        ...nodes.filter((node) => node.family !== "input" && node.family !== "output").map((node) => node.label),
        "Output",
      ],
    },
    nodes,
    edges,
    diagnostics: controlDiagnostics,
    meta: {
      framework: inferredFramework,
      generatedFrom: "generic-source-topology",
      operationCount: nodes.filter((node) => node.family !== "input" && node.family !== "output").length,
      branchCount: nodes.filter((node) => node.ports.inputs.length > 1).length,
      multiOutputCount: nodes.filter((node) => node.ports.outputs.length > 1).length,
      controlFlowCount: controlDiagnostics.length,
    },
  };

  function addInputNode(name, index, line = undefined) {
    const variable = String(name || "").trim();
    if (!variable || variableProducers.has(variable)) return variableProducers.get(variable);
    const node = {
      id: `source-input-${slug(variable)}-${index}`,
      op: "Input",
      family: "input",
      semanticRole: "input",
      label: variable,
      subtitle: "source tensor",
      stage: 0,
      order: -1,
      inputs: [],
      outputs: [variable],
      ports: { inputs: [], outputs: [variable] },
      attributes: { variable, role: "source-input" },
      source: line ? { line } : undefined,
      evidence: [{ kind: "source-variable", variable, line }],
      confidence: 0.88,
    };
    nodes.push(node);
    variableProducers.set(variable, node.id);
    knownVariables.add(variable);
    return node.id;
  }

  function addOperation(call, outputs, line, expression) {
    const inputVariables = extractVariableNames(call.inputText, knownVariables);
    inputVariables.forEach((variable, index) => {
      knownVariables.add(variable);
      if (!variableProducers.has(variable)) addInputNode(variable, operationIndex + index + 1, line);
    });

    const op = call.op || "UnknownOperator";
    const family = classifyOperation(op);
    const node = {
      id: `source-op-${operationIndex + 1}-${slug(op)}`,
      op,
      family,
      semanticRole: family === "custom" ? "unresolved_operator" : undefined,
      label: op,
      subtitle: call.constructorArgs ? call.constructorArgs.slice(0, 80) : "",
      stage: operationIndex + 1,
      order: operationIndex,
      inputs: inputVariables,
      outputs: outputs.map(String),
      ports: { inputs: inputVariables, outputs: outputs.map(String) },
      attributes: {
        framework: inferredFramework,
        expression,
        constructorArgs: call.constructorArgs || "",
      },
      source: { line, expression },
      evidence: [{ kind: "source-call", line, expression }],
      confidence: family === "custom" ? 0.72 : 0.88,
    };
    nodes.push(node);

    inputVariables.forEach((variable, inputIndex) => {
      connect(variableProducers.get(variable), node.id, variable, inputIndex);
    });
    controlStack.forEach((activeControl) => {
      connect(activeControl.id, node.id, activeControl.kind, 0, "control");
    });
    outputs.forEach((variable) => {
      variableProducers.set(String(variable), node.id);
      knownVariables.add(String(variable));
    });
    operationIndex += 1;
  }

  function addControlNode(control, line) {
    const inputVariables = extractVariableNames(control.inputText, knownVariables);
    inputVariables.forEach((variable, index) => {
      if (!variableProducers.has(variable)) addInputNode(variable, operationIndex + index + 1, line);
    });
    const node = {
      id: `source-control-${operationIndex + 1}-${slug(control.op)}`,
      op: control.op,
      family: "custom",
      semanticRole: "control_flow",
      label: control.op,
      subtitle: control.header,
      stage: operationIndex + 1,
      order: operationIndex,
      inputs: inputVariables,
      outputs: [`control-${operationIndex + 1}`],
      ports: { inputs: inputVariables, outputs: [`control-${operationIndex + 1}`] },
      attributes: { controlKind: control.kind, header: control.header },
      source: { line, expression: control.header },
      evidence: [{ kind: "dynamic-control-flow", line, header: control.header }],
      confidence: 0.38,
    };
    nodes.push(node);
    inputVariables.forEach((variable, index) => {
      connect(variableProducers.get(variable), node.id, variable, index, "control");
    });
    controlDiagnostics.push({
      kind: "dynamic-control-flow",
      severity: "warning",
      message: `${control.op} was preserved as an unresolved control-flow compound; runtime tracing is required for exact expansion.`,
      sourceLine: line,
      header: control.header,
      nodeId: node.id,
    });
    controlStack.push({ indent: control.indent, id: node.id, kind: control.kind });
    operationIndex += 1;
  }

  function addOutputNode(inputs, line) {
    const uniqueInputs = [...new Set(inputs.map(String))];
    const node = {
      id: `source-output-${operationIndex + 1}`,
      op: "Output",
      family: "output",
      semanticRole: "output",
      label: "Output",
      subtitle: uniqueInputs.join(" · "),
      stage: operationIndex + 1,
      order: operationIndex + 1,
      inputs: uniqueInputs,
      outputs: ["output"],
      ports: { inputs: uniqueInputs, outputs: ["output"] },
      attributes: { variables: uniqueInputs },
      source: { line },
      evidence: [{ kind: "source-output", variables: uniqueInputs, line }],
      confidence: 0.9,
    };
    nodes.push(node);
    uniqueInputs.forEach((variable, index) => {
      if (!variableProducers.has(variable)) addInputNode(variable, operationIndex + index + 1, line);
      connect(variableProducers.get(variable), node.id, variable, index);
    });
  }

  function connect(sourceId, targetId, variable, targetIndex, edgeType = "signal") {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const id = `source-edge-${sourceId}-${targetId}-${slug(variable)}`;
    if (edges.some((edge) => edge.id === id)) return;
    edges.push({
      id,
      source: sourceId,
      target: targetId,
      type: edgeType === "signal" && targetId.includes("output") ? "output" : edgeType,
      label: variable,
      ports: { source: variable, target: variable, targetIndex },
      evidence: [{ kind: "variable-flow", variable }],
      confidence: 0.82,
    });
  }
}

function collectModuleDefinitions(source) {
  const definitions = new Map();
  const pattern = /(?:self\.)?([A-Za-z_]\w*)\s*=\s*(?:(?:nn|layers|keras|tf)\.)?([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  let match;
  while ((match = pattern.exec(source))) {
    const [, attribute, constructor, args] = match;
    if (attribute === "inputs" || attribute === "outputs" || attribute === "model") continue;
    definitions.set(attribute, { constructor, args });
  }
  return definitions;
}

function extractForwardParameters(source) {
  const match = /def\s+forward\s*\(([^)]*)\)\s*:/m.exec(source);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/\s*=.*$/, "").replace(/\s*:\s*.*$/, ""))
    .filter((item) => item && item !== "self" && /^[A-Za-z_]\w*$/.test(item));
}

function extractForwardStatements(source) {
  const match = /^([ \t]*)def\s+forward\s*\([^)]*\)\s*:/m.exec(source);
  if (!match) return [];
  const baseIndent = indentationWidth(match[1]);
  const start = source.indexOf("\n", match.index);
  if (start < 0) return [];
  const statements = [];
  let cursor = start + 1;
  let line = source.slice(0, start + 1).split(/\r?\n/).length;
  while (cursor < source.length) {
    const end = source.indexOf("\n", cursor);
    const text = source.slice(cursor, end < 0 ? source.length : end);
    const trimmed = text.trim();
    const indent = indentationWidth(text);
    if (trimmed && indent <= baseIndent && /^(?:def|class)\b/.test(trimmed)) break;
    if (trimmed) statements.push({ text, line });
    if (end < 0) break;
    cursor = end + 1;
    line += 1;
  }
  return statements;
}

function parseAssignment(line) {
  const match = line.match(/^(.+?)\s*=\s*(.+)$/);
  if (!match || /^(?:if|for|while|assert)\b/.test(match[1].trim())) return null;
  const outputs = match[1]
    .replace(/^\s*\(|\)\s*$/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[A-Za-z_]\w*$/.test(item));
  return outputs.length ? { outputs, expression: match[2].trim() } : null;
}

function parseControlStatement(line) {
  const conditional = line.match(/^if\s+(.+):$/);
  if (conditional) return { op: "ConditionalBranch", kind: "conditional", header: line, inputText: conditional[1] };
  const alternative = line.match(/^(?:elif\s+(.+)|else)\s*:/);
  if (alternative) return { op: "BranchAlternative", kind: "alternative", header: line, inputText: alternative[1] || "" };
  const loop = line.match(/^(for|while)\s+(.+):$/);
  if (loop) return { op: "Loop", kind: loop[1], header: line, inputText: "" };
  return null;
}

function parseCallExpression(expression, definitions) {
  const text = expression.trim().replace(/;$/, "");
  const chained = text.match(/^(?:layers\.|keras\.|tf\.)?([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\((.*)\)$/);
  if (chained) {
    return { op: chained[1], constructorArgs: chained[2], inputText: chained[3] };
  }

  const selfCall = text.match(/^self\.([A-Za-z_]\w*)\s*\((.*)\)$/);
  if (selfCall) {
    const definition = definitions.get(selfCall[1]);
    return {
      op: definition?.constructor || selfCall[1],
      constructorArgs: definition?.args || "",
      inputText: selfCall[2],
    };
  }

  const call = text.match(/^(?:(?:torch|tf|F|ops|layers|keras)\.)?([A-Za-z_]\w*)\s*\((.*)\)$/);
  if (!call) return null;
  if (["super", "Model", "Sequential"].includes(call[1])) return null;
  return { op: call[1], constructorArgs: "", inputText: call[2] };
}

function extractVariableNames(text, knownVariables) {
  const names = [];
  const value = String(text || "");
  const tokens = [...value.matchAll(/[A-Za-z_]\w*/g)];
  tokens.forEach((match) => {
    const token = match[0];
    const before = value.slice(0, match.index).trimEnd();
    const after = value.slice(match.index + token.length).trimStart();
    if (IGNORED_IDENTIFIERS.has(token)) return;
    if (NAMESPACE_IDENTIFIERS.has(token) || before.endsWith(".")) return;
    if (/^\d/.test(token) || /^(?:float|int|str|list|tuple|dict)$/.test(token)) return;
    if (after.startsWith("=") || after.startsWith("(")) return;
    if (!names.includes(token)) names.push(token);
  });
  return names.filter((name) => knownVariables.has(name) || !IGNORED_IDENTIFIERS.has(name));
}

function inferFramework(source) {
  if (/\b(?:torch|nn\.|forward\s*\()/i.test(source)) return "pytorch";
  if (/\b(?:keras|tensorflow|layers\.)/i.test(source)) return "keras";
  return "unknown";
}

function indentationWidth(text) {
  return (text.match(/^[ \t]*/) || [""])[0].replace(/\t/g, "    ").length;
}

function slug(value) {
  return String(value || "node").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "node";
}

function titleCase(value) {
  return String(value || "unknown").replace(/(^|[-_\s])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}
