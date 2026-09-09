import { inferShapes } from "./shape-inference.mjs";

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
export function extractGenericSourceTopology(source = "", framework = "auto", options = {}) {
  const text = String(source || "");
  const extractionDepth = Number.isFinite(options.depth) ? options.depth : 0;
  const inferredFramework = framework === "auto" ? inferFramework(text) : framework;
  const classDefinitions = collectClassDefinitions(text);
  const entryClass = selectEntryClass(classDefinitions);
  const definitions = collectModuleDefinitions(text, entryClass?.name);
  const statements = inferredFramework === "pytorch"
    ? (entryClass?.forward?.statements?.length
      ? entryClass.forward.statements
      : extractForwardStatements(text, entryClass?.name))
    : collapseMultilineStatements(text).map((line, index) => ({ text: line, line: index + 1 }));
  const parameters = inferredFramework === "pytorch"
    ? (entryClass?.forward?.parameters || extractForwardParameters(text, entryClass?.name))
    : [];
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
        if (!expandSequential(call, outputs, line, returnMatch[1])) addOperation(call, outputs, line, returnMatch[1]);
        outputVariables.push(...outputs);
      } else {
        const variables = extractVariableNames(returnMatch[1], knownVariables);
        if (isSimpleVariableExpression(returnMatch[1], variables)) outputVariables.push(...variables);
        else outputVariables.push(...addUnresolvedStatement(`return ${returnMatch[1]}`, line, [], returnMatch[1]));
      }
      return;
    }

    const assignment = parseAssignment(textLine);
    if (!assignment) {
      if (!isIgnorableSourceStatement(textLine)) addUnresolvedStatement(textLine, line);
      return;
    }
    if (/^(?:model|network)\s*=\s*(?:keras\.)?Model\b/i.test(textLine)) return;

    const call = parseCallExpression(assignment.expression, definitions);
    if (!call) {
      addUnresolvedStatement(textLine, line, assignment.outputs, assignment.expression);
      return;
    }
    const outputs = assignment.outputs.length ? assignment.outputs : [`anonymous-${operationIndex + 1}`];

    if (call.op === "Input") {
      outputs.forEach((name, index) => addInputNode(name, operationIndex + index + 1, line));
      return;
    }

    if (expandSequential(call, outputs, line, assignment.expression)) return;

    addOperation(call, outputs, line, assignment.expression);
    if (/^outputs?$|^prediction$|^logits$|^mask$/i.test(assignment.outputs[0] || "")) {
      outputVariables.push(...assignment.outputs);
    }
  });

  if (!nodes.some((node) => node.family !== "input" && node.family !== "output")) return null;

  const outputNames = [...new Set(outputVariables.filter(Boolean))];
  if (outputNames.length) addOutputNode(outputNames, statements.length + 1);

  inferShapes(nodes, edges);

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
    const internalGraph = buildInternalGraph(call, line);
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
        ...(call.moduleAttribute ? { moduleAttribute: call.moduleAttribute } : {}),
        ...(internalGraph ? { internalGraph } : {}),
      },
      source: { line, expression },
      evidence: [{ kind: "source-call", line, expression, operation: op }],
      confidence: family === "custom" ? 0.72 : 0.88,
    };
    if (node.attributes.internalGraph?.status === "resolved") node.compoundKind = "module";
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

  function addUnresolvedStatement(statement, line, outputs = [], expression = statement) {
    const inputVariables = extractVariableNames(expression, knownVariables);
    inputVariables.forEach((variable, index) => {
      if (!variableProducers.has(variable)) addInputNode(variable, operationIndex + index + 1, line);
    });
    const outputNames = outputs.length ? outputs.map(String) : [`unresolved-${operationIndex + 1}`];
    const node = {
      id: `source-unresolved-${operationIndex + 1}`,
      op: "UnresolvedSourceStatement",
      family: "custom",
      compoundKind: "unresolved",
      semanticRole: "unresolved_operator",
      label: "Unresolved source statement",
      subtitle: String(statement).slice(0, 120),
      stage: operationIndex + 1,
      order: operationIndex,
      inputs: inputVariables,
      outputs: outputNames,
      ports: { inputs: inputVariables, outputs: outputNames },
      attributes: { statement: String(statement), expression: String(expression) },
      source: { line, expression: String(expression) },
      evidence: [{ kind: "unresolved-source-statement", line, statement: String(statement) }],
      confidence: 0.2,
      status: "unresolved",
    };
    nodes.push(node);
    inputVariables.forEach((variable, index) => connect(variableProducers.get(variable), node.id, variable, index));
    outputNames.forEach((variable) => {
      variableProducers.set(variable, node.id);
      knownVariables.add(variable);
    });
    controlStack.forEach((activeControl) => connect(activeControl.id, node.id, activeControl.kind, 0, "control"));
    controlDiagnostics.push({
      kind: "unresolved-source-statement",
      severity: "warning",
      message: "A non-empty source statement could not be mapped to a known topology operation.",
      sourceLine: line,
      statement: String(statement),
      nodeId: node.id,
    });
    operationIndex += 1;
    return outputNames;
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

  function expandSequential(call, outputs, line, expression) {
    if (call?.op !== "Sequential" || !call.constructorArgs) return false;
    const listText = String(call.constructorArgs).trim().replace(/^\[|\]$/g, "").trim();
    const sequence = splitTopLevelCalls(listText);
    if (!sequence.length) return false;
    let upstream = call.inputText;
    sequence.forEach((nestedExpression, index) => {
      const nested = parseSequentialLayer(nestedExpression, definitions);
      if (!nested) return;
      // 首层的 input_shape 定义输入张量：显式生成 Input 节点，让 shape 从输入维度传播。
      if (index === 0 && !upstream) {
        const inputName = `input_${operationIndex + 1}`;
        const inputNodeId = addInputNode(inputName, operationIndex + 1, line);
        const shape = extractInputShape(nested.constructorArgs);
        if (shape) {
          const inputNode = nodes.find((node) => node.id === inputNodeId);
          if (inputNode) inputNode.attributes = { ...(inputNode.attributes || {}), inputShape: shape };
        }
        upstream = inputName;
      }
      const nestedOutputs = index === sequence.length - 1
        ? outputs
        : [`sequence_${operationIndex + 1}_${index + 1}`];
      addOperation({ ...nested, inputText: upstream }, nestedOutputs, line, nestedExpression);
      upstream = nestedOutputs[0];
    });
    return true;
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
      confidence: 0.9,
    });
  }

  function buildInternalGraph(call, line) {
    if (!call?.moduleClassName || extractionDepth >= 4) return null;
    const definition = classDefinitions.get(call.moduleClassName);
    if (!definition?.forward?.statements?.length) return null;
    const parameters = definition.forward.parameters.length ? definition.forward.parameters : ["x"];
    const initLines = definition.initText
      ? definition.initText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
      : [];
    const forwardLines = definition.forward.statements
      .map((item) => item.text.trim())
      .filter(Boolean);
    const nestedSource = [
      "class NestedEvidenceModule(nn.Module):",
      "    def __init__(self):",
      "        super().__init__()",
      ...initLines.map((item) => `        ${item}`),
      `    def forward(self, ${parameters.join(", ")}):`,
      ...forwardLines.map((item) => `        ${item}`),
    ].join("\n");
    const nested = extractGenericSourceTopology(nestedSource, inferredFramework, { depth: extractionDepth + 1 });
    if (!nested || !Array.isArray(nested.nodes) || nested.nodes.length === 0) return null;
    return {
      nodes: nested.nodes,
      edges: nested.edges,
      ports: {
        inputs: parameters,
        outputs: nested.nodes.filter((item) => item.family === "output").flatMap((item) => item.inputs || []),
      },
      status: "resolved",
      evidence: [{ kind: "nested-module-forward", className: call.moduleClassName, line }],
    };
  }
}

function isIgnorableSourceStatement(line) {
  return /^(?:pass|break|continue|raise\s+NotImplementedError\b)/i.test(String(line || "").trim());
}

function isSimpleVariableExpression(expression, variables) {
  const value = String(expression || "").trim();
  return Array.isArray(variables) && variables.length === 1 && value === String(variables[0]);
}

function collectModuleDefinitions(source, className = undefined) {
  const definitions = new Map();
  const selected = className ? collectClassDefinitions(source).get(className) : undefined;
  const text = selected?.initText || source;
  const pattern = /(?:self\.)?([A-Za-z_]\w*)\s*=\s*(?:(?:nn|layers|keras|tf)\.)?([A-Za-z_]\w*)\s*\(/g;
  let match;
  while ((match = pattern.exec(text))) {
    const [, attribute, constructor] = match;
    if (attribute === "inputs" || attribute === "outputs" || attribute === "model") continue;
    const open = text.indexOf("(", match.index);
    const close = matchingParen(text, open);
    if (close < 0) continue;
    definitions.set(attribute, { constructor, args: text.slice(open + 1, close) });
  }
  return definitions;
}

function collectClassDefinitions(source) {
  const text = String(source || "");
  const classes = new Map();
  const matches = [...text.matchAll(/^class\s+([A-Za-z_]\w*)\s*(?:\([^\n]*\))?\s*:\s*$/gm)];
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const body = text.slice(start, end);
    const forwardMatch = /(?:^|\n)([ \t]*)def\s+forward\s*\(([^)]*)\)\s*:/m.exec(body);
    const initMatch = /(?:^|\n)([ \t]*)def\s+__init__\s*\([^)]*\)\s*:/m.exec(body);
    const indent = forwardMatch?.[1] || initMatch?.[1] || "    ";
    const forwardBodyStart = forwardMatch ? start + forwardMatch.index + forwardMatch[0].lastIndexOf("def") : -1;
    const forwardStatements = forwardMatch
      ? extractForwardStatementsFromBlock(body, forwardMatch.index + forwardMatch[0].indexOf("def"), forwardMatch[1], text, start)
      : [];
    const parameters = forwardMatch
      ? forwardMatch[2].split(",").map((item) => item.trim().replace(/\s*=.*$/, "").replace(/\s*:\s*.*$/, ""))
        .filter((item) => item && item !== "self" && /^[A-Za-z_]\w*$/.test(item))
      : [];
    const initText = initMatch ? extractMethodBody(body, initMatch.index + initMatch[0].indexOf("def"), initMatch[1]) : "";
    classes.set(match[1], {
      name: match[1],
      initText,
      forward: { parameters, statements: forwardStatements },
      sourceLine: text.slice(0, match.index).split(/\r?\n/).length,
      indent,
      forwardBodyStart,
    });
  });
  return classes;
}

function selectEntryClass(classes) {
  const values = [...classes.values()];
  return values.find((item) => /(?:net|model|network|module)$/i.test(item.name)) || values.at(-1);
}

function extractMethodBody(body, methodOffset, methodIndent) {
  const start = body.indexOf("\n", methodOffset);
  if (start < 0) return "";
  const baseIndent = indentationWidth(methodIndent);
  const lines = body.slice(start + 1).split(/\r?\n/);
  return lines
    .filter((line) => !line.trim() || indentationWidth(line) > baseIndent)
    .join("\n");
}

function extractForwardStatementsFromBlock(body, methodOffset, methodIndent, fullSource, bodyOffset) {
  const start = body.indexOf("\n", methodOffset);
  if (start < 0) return [];
  const baseIndent = indentationWidth(methodIndent);
  const statements = [];
  let line = fullSource.slice(0, bodyOffset + start + 1).split(/\r?\n/).length;
  for (const rawLine of body.slice(start + 1).split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const indent = indentationWidth(rawLine);
    if (trimmed && indent <= baseIndent) break;
    if (trimmed) statements.push({ text: rawLine, line });
    line += 1;
  }
  return statements;
}

function splitTopLevelCalls(text) {
  const calls = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < String(text || "").length; index += 1) {
    const character = text[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      const part = text.slice(start, index).trim();
      if (part) calls.push(part);
      start = index + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) calls.push(last);
  return calls;
}

function matchingParen(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
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
    if (trimmed && indent <= baseIndent) break;
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
      moduleAttribute: selfCall[1],
      moduleClassName: definition?.constructor,
    };
  }

  const call = text.match(/^(?:(torch|tf|F|ops|layers|keras|nn)\.)?([A-Za-z_]\w*)\s*\((.*)\)$/);
  if (!call) return null;
  if (["super", "Model"].includes(call[2])) return null;
  if (call[2] === "Sequential") {
    return { op: "Sequential", constructorArgs: call[3], inputText: "" };
  }
  // nn./layers./keras. constructors declare a layer (e.g. nn.Conv2d(3, 64, 3)):
  // their parenthesized text is constructor arguments, not an input tensor.
  // F./torch./tf./ops. calls (e.g. F.relu(x), torch.flatten(x, 1)) are forward
  // applications whose parenthesized text is the input expression.
  const namespace = call[1];
  const isLayerConstructor = namespace === "nn" || namespace === "layers" || namespace === "keras";
  return {
    op: call[2],
    constructorArgs: isLayerConstructor ? call[3] : "",
    inputText: isLayerConstructor ? "" : call[3],
  };
}

// Sequential([ ... ]) 列表里的元素都是 layer 构造函数，即使裸写 Conv2D(...)
// 不带 layers. 前缀，括号内容也是构造参数而非输入张量。
function parseSequentialLayer(expression, definitions) {
  const parsed = parseCallExpression(expression, definitions);
  if (parsed && parsed.constructorArgs) return parsed;
  const match = String(expression || "").trim().match(/^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/);
  if (!match) return parsed;
  return { op: match[1], constructorArgs: match[2], inputText: "" };
}

// 从构造参数里提取 input_shape=(H, W, C) / input_shape=[...]，返回形状数组。
function extractInputShape(args) {
  const match = String(args || "").match(/(?:input_shape|inputShape|input_size)\s*=\s*(?:\(([^)]*)\)|\[([^\]]*)\])/);
  const raw = match ? (match[1] ?? match[2]) : "";
  if (!raw) return null;
  const shape = raw.split(",").map((part) => {
    const value = part.trim();
    if (/^(?:none|null|-1|\?)$/i.test(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  });
  return shape.some((value) => Number.isFinite(value)) ? shape : null;
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

// 把跨多行的括号表达式（最常见的是 Keras 的 Sequential([ ... ]) 列表）合并成
// 单行，使逐行解析器能把它当成一条语句处理。函数式 API 的闭合单行不受影响。
function collapseMultilineStatements(source) {
  const lines = String(source || "").split(/\r?\n/);
  const collapsed = [];
  let buffer = null;
  let depth = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (buffer === null) {
      if (!line) continue;
      const delta = bracketDelta(line);
      if (delta > 0) {
        buffer = line;
        depth = delta;
      } else {
        collapsed.push(line);
      }
    } else {
      buffer += " " + line;
      depth += bracketDelta(line);
      if (depth <= 0) {
        collapsed.push(buffer);
        buffer = null;
        depth = 0;
      }
    }
  }
  if (buffer !== null) collapsed.push(buffer);
  return collapsed;
}

function bracketDelta(text) {
  let delta = 0;
  for (const character of String(text || "")) {
    if (character === "(" || character === "[") delta += 1;
    else if (character === ")" || character === "]") delta -= 1;
  }
  return delta;
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

