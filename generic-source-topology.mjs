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

// --- Shape inference -----------------------------------------------------
// Publication-grade architecture diagrams (PlotNeuralNet style) need the
// per-layer feature-map dimensions so tensor boxes shrink 224 → 112 → 56 →
// 28 → 14 → 7 while channels grow 3 → 64 → 128 → 256 → 512.  The static
// extractor never executes Python, so it propagates shapes analytically from
// constructor arguments plus a standard image input size.  Shapes use a
// channels-last [H, W, C] convention to match semantic-visual-grammar's
// spatialDimension/channelDimension heuristics.

const DEFAULT_INPUT_SHAPE = [224, 224, 3];

// LLM 可能输出带 batch 维的 shape（[1, 224, 224, 3] 或 [null, 224, 224, 3]），
// 而 shape 传播约定是 channels-last 无 batch 的 [H, W, C]。剥掉显式的 batch 维。
function normalizeInputShape(shape) {
  if (shape.length === 4 && (shape[0] === null || shape[0] === undefined || shape[0] === 1 || shape[0] === -1)) {
    return shape.slice(1);
  }
  return shape;
}

export function inferShapes(nodes, edges, options = {}) {
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (incoming.has(edge.target)) incoming.get(edge.target).push(edge.source);
  }
  // The extractor emits nodes in execution order (input stage 0 first), so a
  // stage/order sort is already a topological order for these graphs.
  const ordered = [...nodes].sort((left, right) => (
    (Number(left.stage) - Number(right.stage)) || (Number(left.order) - Number(right.order))
  ));
  const shapeByNode = new Map();
  for (const node of ordered) {
    if (node.family === "input") {
      const explicit = node.shape?.output || node.attributes?.inputShape || node.attributes?.shape;
      const raw = Array.isArray(explicit) && explicit.length ? explicit : DEFAULT_INPUT_SHAPE;
      const seed = normalizeInputShape(raw);
      shapeByNode.set(node.id, [...seed]);
      continue;
    }
    const predecessors = (incoming.get(node.id) || []).map((id) => shapeByNode.get(id)).filter(Boolean);
    const inputShape = predecessors[0];
    if (!inputShape) continue;
    const outputShape = computeOutputShape(node, inputShape, predecessors);
    if (outputShape && outputShape.length) shapeByNode.set(node.id, outputShape);
  }
  for (const node of nodes) {
    const shape = shapeByNode.get(node.id);
    if (shape && shape.length) node.shape = { output: shape };
  }
}

// 与 inferShapes 相同的传播逻辑，但记录每个「算不出 shape」节点的原因，
// 供闭环反馈使用——这是「验证」环节，让 LLM 输出的 IR 被规则验算并暴露矛盾。
export function diagnoseShapes(nodes, edges, options = {}) {
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (incoming.has(edge.target)) incoming.get(edge.target).push(edge.source);
  }
  const ordered = [...nodes].sort((left, right) => (
    (Number(left.stage) - Number(right.stage)) || (Number(left.order) - Number(right.order))
  ));
  const shapeByNode = new Map();
  const issues = [];
  for (const node of ordered) {
    if (node.family === "input") {
      const explicit = node.shape?.output || node.attributes?.inputShape || node.attributes?.shape;
      const raw = Array.isArray(explicit) && explicit.length ? explicit : DEFAULT_INPUT_SHAPE;
      const seed = normalizeInputShape(raw);
      shapeByNode.set(node.id, [...seed]);
      continue;
    }
    const predecessors = (incoming.get(node.id) || []).map((id) => shapeByNode.get(id)).filter(Boolean);
    const inputShape = predecessors[0];
    if (!inputShape) {
      if ((incoming.get(node.id) || []).length > 0) {
        issues.push({ kind: "no-input-shape", nodeId: node.id, op: node.op, family: node.family });
      }
      continue;
    }
    const outputShape = computeOutputShape(node, inputShape, predecessors);
    if (outputShape && outputShape.length) {
      shapeByNode.set(node.id, outputShape);
    } else {
      issues.push({
        kind: "shape-gap",
        nodeId: node.id,
        op: node.op,
        family: node.family,
        reason: classifyShapeGap(node, inputShape, predecessors),
      });
    }
  }
  for (const node of nodes) {
    const shape = shapeByNode.get(node.id);
    if (shape && shape.length) node.shape = { output: shape };
  }
  return { ok: issues.length === 0, issues, shapeByNode: Object.fromEntries(shapeByNode) };
}

function classifyShapeGap(node, inputShape, inputs) {
  const family = String(node.family || "");
  const op = String(node.op || "").toLowerCase();
  if (family === "merge") {
    const shapes = (inputs || []).filter(Boolean);
    if (!/concat|concatenate|cat|join/.test(op) && shapes.length > 1) {
      const first = shapes[0];
      if (shapes.some((shape) => !sameShape(shape, first))) return "mismatched-merge";
    }
  }
  if (family === "conv" || family === "dense" || family === "recurrent" || family === "graph") {
    const args = parseLayerArgs(node.attributes?.constructorArgs || node.subtitle || "");
    const missing = [];
    if (family === "conv") {
      if (!Number.isFinite(numericArg(args, 1))) missing.push("out_channels");
      const kernel = firstFinite(numericArg(args, 2), kwargNumber(args, "kernel_size"));
      if (!Number.isFinite(kernel)) missing.push("kernel_size");
    } else if (family === "dense") {
      const out = firstFinite(
        numericArg(args, 1), kwargNumber(args, "out_features"),
        numericArg(args, 0), kwargNumber(args, "units"),
      );
      if (!Number.isFinite(out)) missing.push("out_features");
    } else if (family === "recurrent") {
      const hidden = firstFinite(
        numericArg(args, 1), kwargNumber(args, "hidden_size"), kwargNumber(args, "hidden"),
        numericArg(args, 0), kwargNumber(args, "units"),
      );
      if (!Number.isFinite(hidden)) missing.push("hidden_size");
    } else if (family === "graph") {
      const out = firstFinite(
        numericArg(args, 1), kwargNumber(args, "out_features"), kwargNumber(args, "out_channels"),
        numericArg(args, 0), kwargNumber(args, "units"),
      );
      if (!Number.isFinite(out)) missing.push("out_features");
    }
    if (missing.length) return "missing-parameter";
  }
  return "unsupported-operator";
}

// 把诊断结果转成一段可供 LLM 自纠的自然语言反馈。
export function buildShapeFeedback(issues, shapeByNode = {}) {
  if (!issues || !issues.length) return "";
  const lines = ["Shape inference found the following inconsistencies in your IR:"];
  for (const issue of issues) {
    const where = `node "${issue.nodeId}" (${issue.op || issue.family})`;
    switch (issue.reason) {
      case "mismatched-merge":
        lines.push(`- ${where}: an element-wise merge (add/sum) receives branch shapes that do not match. Fix the branch tensors so both sides have identical dimensions, or mark the merge as concat if it is channel concatenation.`);
        break;
      case "missing-parameter":
        lines.push(`- ${where}: missing layer parameters (channels/kernel/out_features/hidden_size). Provide explicit numeric constructor arguments.`);
        break;
      case "unsupported-operator":
        lines.push(`- ${where}: the operator could not be shaped. Decompose it into primitive layers (conv/pool/dense/flatten/norm/activation/attention/merge) with explicit parameters.`);
        break;
      case "no-input-shape":
        lines.push(`- ${where}: no incoming tensor shape could be resolved (an upstream node is unresolved). Fix the upstream operator first.`);
        break;
      default:
        lines.push(`- ${where}: could not be shaped (${issue.reason || "unknown"}).`);
    }
  }
  lines.push("Return the corrected full IR JSON with the same figure/nodes/edges structure.");
  return lines.join("\n");
}

function computeOutputShape(node, inputShape, inputs = [inputShape]) {
  const family = String(node.family || "");
  const op = String(node.op || "").toLowerCase();
  const args = parseLayerArgs(node.attributes?.constructorArgs || node.subtitle || "");

  if (family === "activation" || family === "norm" || family === "dropout"
    || op === "relu" || op === "gelu" || op === "silu" || op === "sigmoid"
    || op === "tanh" || op === "softmax" || op === "batchnorm" || op === "batchnorm2d"
    || op === "layernorm" || op === "identity") {
    return inputShape;
  }

  if (family === "conv") return convShape(op, args, inputShape, node.attributes?.framework);

  if (family === "upsample") return upsampleShape(op, args, inputShape);

  if (family === "pool") return poolShape(op, args, inputShape);

  if (family === "merge") return mergeShape(op, inputs);

  if (family === "recurrent") return recurrentShape(op, args, inputShape);

  if (family === "graph") return graphShape(op, args, inputShape);

  if (family === "attention") {
    // Transformer 注意力：QKV 头拆分后再拼接回 d_model，输出保持输入形状（seq_len × d_model）。
    return inputShape;
  }

  if (family === "flatten" || op === "flatten" || op === "view" || op === "reshape") {
    if (op === "view" || op === "reshape") {
      const target = reshapeTarget(args, inputShape);
      if (target) return target;
    }
    const total = productOf(inputShape);
    return Number.isFinite(total) ? [total] : null;
  }

  if (family === "dense") {
    // PyTorch Linear(in, out) -> 位置 1；Keras Dense(units) -> 位置 0 或 units kwarg。
    const outFeatures = firstFinite(
      numericArg(args, 1),
      kwargNumber(args, "out_features"),
      numericArg(args, 0),
      kwargNumber(args, "units"),
    );
    return Number.isFinite(outFeatures) ? [Math.round(outFeatures)] : null;
  }

  if (family === "output") return inputShape;

  if (family === "custom" || node.compoundKind) {
    const inner = compoundShape(node, inputShape);
    if (inner && inner.length) return inner;
  }

  return null;
}

// 复合模块（C2f / SPPF / Bottleneck 等）：穿透 internalGraph，用模块输入 shape 作为
// 内部入口的 seed，在内部图上做一次拓扑 shape 传播，返回内部输出节点的 shape。
function compoundShape(node, inputShape) {
  const graph = node.attributes?.internalGraph || node.internalGraph;
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return null;
  const innerNodes = graph.nodes.map((child, index) => ({
    ...child,
    id: String(child.id || child.sourceNodeId || `inner-${index + 1}`),
    family: String(child.family || child.type || "custom").toLowerCase(),
    op: String(child.op || child.label || ""),
    attributes: child.attributes && typeof child.attributes === "object" ? child.attributes : {},
  }));
  const incoming = new Map(innerNodes.map((child) => [child.id, []]));
  const outgoing = new Map(innerNodes.map((child) => [child.id, []]));
  for (const edge of (Array.isArray(graph.edges) ? graph.edges : [])) {
    const source = String(edge.source || "");
    const target = String(edge.target || "");
    if (incoming.has(target)) incoming.get(target).push(source);
    if (outgoing.has(source)) outgoing.get(source).push(target);
  }
  const indegree = new Map(innerNodes.map((child) => [child.id, (incoming.get(child.id) || []).length]));
  const byId = new Map(innerNodes.map((child) => [child.id, child]));
  const queue = innerNodes.filter((child) => indegree.get(child.id) === 0);
  const shapeByNode = new Map();
  const visited = new Set();
  while (queue.length) {
    const child = queue.shift();
    if (visited.has(child.id)) continue;
    visited.add(child.id);
    const predecessors = (incoming.get(child.id) || []).map((id) => shapeByNode.get(id)).filter(Boolean);
    const childInput = predecessors[0] || (predecessors.length === 0 ? inputShape : undefined);
    if (childInput) {
      const output = computeOutputShape(child, childInput, predecessors);
      if (output && output.length) shapeByNode.set(child.id, output);
    }
    for (const target of (outgoing.get(child.id) || [])) {
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if (indegree.get(target) === 0) queue.push(byId.get(target));
    }
  }
  const sinks = innerNodes.filter((child) => (outgoing.get(child.id) || []).length === 0);
  const sinkShapes = sinks.map((child) => shapeByNode.get(child.id)).filter(Boolean);
  return sinkShapes.length ? sinkShapes[0] : null;
}

function convShape(op, args, inputShape, framework = "unknown") {
  // 支持 2D [H,W,C]（3 维）与 3D [D,H,W,C]（4 维）；其它秩安全失败。
  if (inputShape.length !== 3 && inputShape.length !== 4) return null;
  const isKeras = framework === "keras" || framework === "tensorflow";
  const isTranspose = /transpose|transposed|deconv/i.test(op);
  // Keras Conv2D(filters, kernel_size, ...)；PyTorch Conv2d(in_channels, out_channels, kernel_size, ...)。
  const outChannels = isKeras
    ? firstFinite(numericArg(args, 0), kwargNumber(args, "filters"), kwargNumber(args, "out_channels"))
    : numericArg(args, 1);
  const kernel = isKeras
    ? layerArg(args, 1, "kernel_size", null)
    : layerArg(args, 2, "kernel_size", null);
  const stride = layerArg(args, isKeras ? 2 : 3, "stride", 1);
  const padding = resolvePadding(args.kwargs.padding ?? args.positional[isKeras ? 3 : 4] ?? 0, kernel);
  const dilation = layerArg(args, -1, "dilation", 1);
  const outputPadding = layerArg(args, -1, "output_padding", 0);
  if (!Number.isFinite(outChannels) || kernel == null) return null;
  const spatial = inputShape.slice(0, -1); // [H,W] 或 [D,H,W]
  const dims = spatial.length;
  const kernels = expandKernel(kernel, dims);
  const strides = expandKernel(stride, dims);
  const paddings = expandKernel(padding, dims);
  const dilations = expandKernel(dilation, dims);
  const outputPaddings = expandKernel(outputPadding, dims);
  const result = [];
  for (let index = 0; index < dims; index += 1) {
    result.push(isTranspose
      ? transposedDimension(spatial[index], kernels[index], paddings[index], dilations[index], outputPaddings[index], strides[index])
      : convDimension(spatial[index], kernels[index], paddings[index], strides[index], dilations[index]));
  }
  result.push(Math.round(outChannels));
  return result;
}

function upsampleShape(op, args, inputShape) {
  // 上采样（nn.Upsample / F.interpolate / PixelShuffle）：2D [H,W,C] 与 3D [D,H,W,C]；其它秩安全失败。
  if (inputShape.length !== 3 && inputShape.length !== 4) return null;
  const channels = channelsOf(inputShape);
  const spatial = inputShape.slice(0, -1); // [H,W] 或 [D,H,W]
  const dims = spatial.length;
  const sizeTuple = tupleArg(args, 0) || kwargTuple(args, "size");
  if (sizeTuple && sizeTuple.length >= dims) return [...sizeTuple.slice(0, dims), channels];
  const size = firstFinite(numericArg(args, 0), kwargNumber(args, "size"));
  const scale = firstFinite(kwargNumber(args, "scale_factor"), 1);
  if (Number.isFinite(size)) return [...new Array(dims).fill(size), channels];
  return [...spatial.map((dim) => Math.round(dim * scale)), channels];
}

function poolShape(op, args, inputShape) {
  // 下采样（MaxPool/AvgPool/AdaptivePool/GlobalPool）：2D [H,W,C] 与 3D [D,H,W,C]；其它秩安全失败。
  if (inputShape.length !== 3 && inputShape.length !== 4) return null;
  // 兜底：旧 IR 可能仍把 upsample 归入 pool family，按上采样公式处理。
  if (/upsample|interpolate/i.test(op)) return upsampleShape(op, args, inputShape);
  const channels = channelsOf(inputShape);
  const spatial = inputShape.slice(0, -1); // [H,W] 或 [D,H,W]
  const dims = spatial.length;
  if (/adaptive|global/.test(op)) {
    const target = numericArg(args, 0);
    if (Number.isFinite(target)) return [...new Array(dims).fill(target), channels];
    const tuple = tupleArg(args, 0);
    if (tuple && tuple.length >= dims) return [...tuple.slice(0, dims), channels];
    return [...new Array(dims).fill(1), channels];
  }
  const kernel = layerArg(args, 0, "kernel_size", null);
  const stride = layerArg(args, 1, "stride", kernel ?? 1);
  const padding = resolvePadding(args.kwargs.padding ?? args.positional[2] ?? 0, kernel);
  if (kernel == null) return null;
  const kernels = expandKernel(kernel, dims);
  const strides = expandKernel(stride, dims);
  const paddings = expandKernel(padding, dims);
  const result = [];
  for (let index = 0; index < dims; index += 1) {
    result.push(poolDimension(spatial[index], kernels[index], strides[index], paddings[index]));
  }
  result.push(channels);
  return result;
}

function mergeShape(op, inputs) {
  const shapes = (inputs || []).filter(Boolean);
  if (!shapes.length) return null;
  if (/concat|concatenate|cat|join/.test(op)) {
    // 拼接在通道（最后一）维；空间维取第一个输入。
    const rank = Math.max(...shapes.map((shape) => shape.length));
    const spatial = rank >= 2 ? shapes[0].slice(0, rank - 1) : [];
    const totalChannels = shapes.reduce((acc, shape) => acc + (shape[shape.length - 1] ?? 1), 0);
    return rank >= 2 ? [...spatial, totalChannels] : [totalChannels];
  }
  // add / sum / merge（逐元素）：要求所有输入形状一致，否则保持未解决。
  const first = shapes[0];
  const consistent = shapes.every((shape) => sameShape(shape, first));
  return consistent ? first : null;
}

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  return /^(?:true|yes|1)$/i.test(String(value));
}

function recurrentShape(op, args, inputShape) {
  // RNN 输入是序列 [seq_len, input_size]；空间维公式不适用，需 2 维否则安全失败。
  if (!Array.isArray(inputShape) || inputShape.length !== 2) return null;
  const seqLen = inputShape[0];
  const bidirectional = /bidirectional/i.test(op) || isTruthy(args.kwargs.bidirectional);
  // hidden_size：PyTorch LSTM(in, hidden) 位置 1；Keras LSTM(units) 位置 0 或 units kwarg。
  const hidden = firstFinite(
    numericArg(args, 1),
    kwargNumber(args, "hidden_size"),
    kwargNumber(args, "hidden"),
    numericArg(args, 0),
    kwargNumber(args, "units"),
  );
  if (!Number.isFinite(hidden)) return null;
  const hiddenOut = Math.round(hidden) * (bidirectional ? 2 : 1);
  // return_sequences 默认 true（PyTorch 语义：返回整序列）；显式 false（Keras 默认）才缩短。
  // op 名无法区分框架（两边都叫 LSTM/GRU），故只信显式声明。
  const returnSequences = !/^(?:false|no|0)$/i.test(String(args.kwargs.return_sequences));
  if (returnSequences && Number.isFinite(seqLen)) return [Math.round(seqLen), hiddenOut];
  return [hiddenOut];
}

function graphShape(op, args, inputShape) {
  // GCN/GAT 输入 [num_nodes, in_features]；节点数不变，只换特征维。
  if (!Array.isArray(inputShape) || inputShape.length !== 2) return null;
  const numNodes = inputShape[0];
  const outFeatures = firstFinite(
    numericArg(args, 1),
    kwargNumber(args, "out_features"),
    kwargNumber(args, "out_channels"),
    numericArg(args, 0),
    kwargNumber(args, "units"),
  );
  if (!Number.isFinite(outFeatures) || !Number.isFinite(numNodes)) return null;
  return [Math.round(numNodes), Math.round(outFeatures)];
}

function convDimension(size, kernel, padding, stride, dilation = 1) {
  const effective = kernel + (kernel - 1) * (dilation - 1);
  return Math.floor((size + 2 * padding - effective) / stride) + 1;
}

function poolDimension(size, kernel, stride, padding = 0) {
  return Math.floor((size + 2 * padding - kernel) / stride) + 1;
}

// Keras/TF 常用 padding='same'（输出 = ceil(size/stride)，等价 padding=(kernel-1)/2）
// 或 'valid'（padding=0）。PyTorch 用显式整数 padding。
function resolvePadding(paddingValue, kernel) {
  if (Array.isArray(paddingValue)) return paddingValue; // 元组 padding 直接透传（expandKernel 会补齐维度）。
  if (typeof paddingValue === "string" && /same/i.test(paddingValue)) {
    const k = Array.isArray(kernel) ? kernel[0] : kernel;
    return Number.isFinite(k) ? (k - 1) / 2 : 0;
  }
  return Number.isFinite(paddingValue) ? paddingValue : 0;
}

function transposedDimension(size, kernel, padding, dilation, outputPadding, stride) {
  return (size - 1) * stride - 2 * padding + (kernel - 1) * dilation + 1 + outputPadding;
}

function sameShape(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function spatialOf(shape) {
  return shape.length >= 2 ? [shape[0], shape[1]] : [1, 1];
}

function channelsOf(shape) {
  return shape.length >= 3 ? shape[shape.length - 1] : (shape.length ? shape[0] : 1);
}

function productOf(shape) {
  return shape.reduce((acc, value) => acc * (Number.isFinite(value) ? value : 1), 1);
}

function pairOf(value) {
  if (Array.isArray(value)) return [value[0] ?? 1, value[1] ?? value[0] ?? 1];
  return [value, value];
}

// 从位置参数或 kwarg 取一个标量或元组（PyTorch 常用 kernel_size/stride 的元组形式）。
// index 为负表示只取 kwarg（如 dilation 一般不作为位置参数出现）。
function layerArg(args, index, key, fallback) {
  if (index >= 0) {
    const pos = args.positional[index];
    if (Array.isArray(pos) && pos.length) return pos;
    if (Number.isFinite(pos)) return pos;
  }
  const kw = args.kwargs[key];
  if (Array.isArray(kw) && kw.length) return kw;
  if (Number.isFinite(kw)) return kw;
  return fallback;
}

// 把标量或元组扩展成 dims 元组（各向同性标量复制；元组不足时用最后一个元素补齐）。
function expandKernel(value, dims) {
  if (Array.isArray(value)) {
    const out = [];
    for (let index = 0; index < dims; index += 1) {
      out.push(Number.isFinite(value[index]) ? value[index]
        : Number.isFinite(value[value.length - 1]) ? value[value.length - 1] : 1);
    }
    return out;
  }
  const scalar = Number.isFinite(value) ? value : 1;
  return new Array(dims).fill(scalar);
}

function firstFinite(...values) {
  for (const value of values) if (Number.isFinite(value)) return value;
  return values[values.length - 1];
}

function parseLayerArgs(text) {
  const positional = [];
  const kwargs = {};
  const raw = String(text || "").trim();
  if (raw) {
    for (const part of splitArgs(raw)) {
      const keyword = part.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (keyword) kwargs[keyword[1]] = evaluateArg(keyword[2]);
      else positional.push(evaluateArg(part));
    }
  }
  return { positional, kwargs };
}

function splitArgs(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of String(text)) {
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = "";
    } else {
      current += char;
    }
  }
  const trimmed = current.trim();
  if (trimmed) parts.push(trimmed);
  return parts;
}

function evaluateArg(text) {
  const trimmed = String(text).trim();
  if (/^\(.*\)$/.test(trimmed)) {
    const inner = splitArgs(trimmed.slice(1, -1));
    if (inner.length > 1) return inner.map(evaluateArg);
    return evaluateArg(inner[0] || "1");
  }
  if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^[\d+\-*/()\s.]+$/.test(trimmed) && /\d/.test(trimmed)) {
    try {
      const value = Function(`"use strict"; return (${trimmed});`)();
      return typeof value === "number" && Number.isFinite(value) ? value : NaN;
    } catch {
      return NaN;
    }
  }
  return trimmed;
}

function numericArg(args, index) {
  const value = args.positional[index];
  return typeof value === "number" ? value : NaN;
}

function kwargNumber(args, key) {
  const value = args.kwargs[key];
  return typeof value === "number" ? value : NaN;
}

function tupleArg(args, index) {
  const value = args.positional[index];
  return Array.isArray(value) ? value : null;
}

function kwargTuple(args, key) {
  const value = args.kwargs[key];
  return Array.isArray(value) ? value : null;
}

function reshapeTarget(args, inputShape) {
  const first = args.positional[0];
  if (Array.isArray(first)) return resolveReshape(first, inputShape);
  const dims = args.positional.filter((value) => typeof value === "number");
  return dims.length > 1 ? resolveReshape(dims, inputShape) : null;
}

function resolveReshape(dims, inputShape) {
  const total = productOf(inputShape);
  let unknown = -1;
  let known = 1;
  dims.forEach((dim, index) => {
    if (dim === -1) { if (unknown === -1) unknown = index; }
    else known *= dim;
  });
  if (unknown === -1) return dims.map((dim) => Math.round(dim));
  if (known === 0 || total % known !== 0) return null;
  const resolved = dims.slice();
  resolved[unknown] = total / known;
  return resolved.map((dim) => Math.round(dim));
}
