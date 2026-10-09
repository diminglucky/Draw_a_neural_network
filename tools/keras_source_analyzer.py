#!/usr/bin/env python3
import ast
import json
import re
import sys


def stable_id(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-") or "node"


def unparse(node):
    try:
        return ast.unparse(node)
    except Exception:
        return ""


def call_name(node):
    if isinstance(node, ast.Call):
        return call_name(node.func)
    if isinstance(node, ast.Attribute):
        parent = call_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    if isinstance(node, ast.Name):
        return node.id
    return ""


def family_for(name):
    value = name.lower()
    if re.search(r"conv", value):
        return "conv"
    if re.search(r"pool|downsample", value):
        return "pool"
    if re.search(r"dense|linear", value):
        return "dense"
    if re.search(r"norm|normalization", value):
        return "norm"
    if re.search(r"relu|gelu|sigmoid|softmax|activation", value):
        return "activation"
    if re.search(r"attention|transformer|multihead", value):
        return "attention"
    if re.search(r"lstm|gru|rnn", value):
        return "recurrent"
    if re.search(r"upsample|up.?sampling|conv2dtranspose", value):
        return "upsample"
    if re.search(r"flatten|reshape", value):
        return "flatten"
    if re.search(r"concatenate|add|average|merge", value):
        return "merge"
    return "custom"


def op_label(name):
    return name.split(".")[-1] if name else "UnknownOperator"


def args_string(call):
    if not isinstance(call, ast.Call):
        return ""
    args = [unparse(arg) for arg in call.args]
    kwargs = [f"{kw.arg}={unparse(kw.value)}" for kw in call.keywords if kw.arg]
    return ", ".join(args + kwargs)


class KerasGraphBuilder:
    def __init__(self):
        self.nodes = []
        self.edges = []
        self.counter = 0

    def add_node(self, op, family, line=0, confidence=0.85, compound_kind=None):
        self.counter += 1
        node = {
            "id": f"keras-op-{self.counter}-{stable_id(op)}",
            "op": op,
            "family": family,
            "label": op,
            "stage": self.counter,
            "confidence": confidence,
            "evidence": [{"kind": "source", "line": int(line or 0)}],
        }
        if compound_kind:
            node["compoundKind"] = compound_kind
        self.nodes.append(node)
        return node

    def add_edge(self, source, target, edge_type="signal", line=0):
        if not source or not target or source == target:
            return
        self.edges.append({
            "id": f"keras-edge-{len(self.edges) + 1}-{stable_id(source)}-{stable_id(target)}",
            "source": source,
            "target": target,
            "type": edge_type,
            "confidence": 0.85,
            "evidence": [{"kind": "source", "line": int(line or 0)}],
        })

    def layer_node(self, call, line, confidence=0.85):
        name = call_name(call)
        family = family_for(name)
        node = self.add_node(op_label(name), family, line, confidence=confidence, compound_kind="unresolved" if family == "custom" else None)
        args = args_string(call)
        if args:
            node["attributes"] = {"constructorArgs": args}
        return node


def find_sequential_calls(tree):
    assignments = {}
    adds = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            value = node.value
            if isinstance(value, ast.Call) and call_name(value).endswith("Sequential"):
                assignments[name] = value
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            name = call_name(call)
            if name.endswith(".add") and call.args:
                owner = name.rsplit(".", 1)[0].split(".")[-1]
                adds.setdefault(owner, []).append(call.args[0])
    return assignments, adds


def analyze_sequential(tree):
    assignments, adds = find_sequential_calls(tree)
    if not assignments and not adds:
        return None
    builder = KerasGraphBuilder()
    input_node = builder.add_node("Input", "input", 1, confidence=0.95)
    previous = input_node["id"]
    models = list(assignments.items()) or [(name, None) for name in adds]
    for _, sequential in models:
        layers = []
        if sequential is not None and sequential.args and isinstance(sequential.args[0], (ast.List, ast.Tuple)):
            layers.extend(sequential.args[0].elts)
        layers.extend(adds.get(_ if _ else "", []))
        if not layers and adds:
            layers.extend(next(iter(adds.values())))
        for layer in layers:
            if call_name(layer).endswith("Input") or call_name(layer).endswith("InputLayer"):
                continue
            node = builder.layer_node(layer, getattr(layer, "lineno", 0))
            builder.add_edge(previous, node["id"], "signal", getattr(layer, "lineno", 0))
            previous = node["id"]
    output = builder.add_node("Output", "output", getattr(tree, "lineno", 0), confidence=0.95)
    builder.add_edge(previous, output["id"], "output", getattr(tree, "lineno", 0))
    return builder


def analyze_functional(tree):
    variables = {}
    builder = KerasGraphBuilder()
    input_nodes = []
    output_names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target = node.targets[0].id
            value = node.value
            if isinstance(value, ast.Call) and call_name(value).endswith("Input"):
                created = builder.add_node("Input", "input", node.lineno, confidence=0.95)
                variables[target] = created["id"]
                input_nodes.append(created["id"])
                continue
            if isinstance(value, ast.Call) and isinstance(value.func, ast.Call):
                layer_call = value.func
                layer = builder.layer_node(layer_call, node.lineno)
                for arg in value.args:
                    if isinstance(arg, ast.Name) and arg.id in variables:
                        builder.add_edge(variables[arg.id], layer["id"], "signal", node.lineno)
                variables[target] = layer["id"]
                continue
            if isinstance(value, ast.Name) and value.id in variables:
                variables[target] = variables[value.id]
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and call_name(node.value).endswith("Model"):
            for kw in node.value.keywords:
                if kw.arg == "outputs":
                    output_names.extend([item.id for item in ast.walk(kw.value) if isinstance(item, ast.Name)])
    if not input_nodes and not output_names:
        return None
    output_node = builder.add_node("Output", "output", getattr(tree, "lineno", 0), confidence=0.95)
    for name in output_names:
        builder.add_edge(variables.get(name), output_node["id"], "output")
    if output_names and not any(edge["target"] == output_node["id"] for edge in builder.edges):
        for value in variables.values():
            builder.add_edge(value, output_node["id"], "output")
    return builder


def analyze(payload):
    source = str(payload.get("source") or "")
    if not source.strip():
        return {"status": "error", "message": "source is required"}
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return {"status": "error", "message": f"Python syntax error: {error}"}
    builder = analyze_sequential(tree) or analyze_functional(tree)
    if not builder:
        return {
            "status": "unresolved",
            "ir": {
                "version": "universal-neural-ir/v1",
                "source": {"kind": "source", "language": "python", "framework": "keras", "analyzer": "keras-ast"},
                "nodes": [{"id": "unresolved-source", "op": "UnresolvedSourceGraph", "family": "custom", "compoundKind": "unresolved", "confidence": 0.2}],
                "edges": [],
            },
            "diagnostics": [{"kind": "unresolved-source", "severity": "warning", "message": "No Keras Sequential or Functional graph was found."}],
        }
    return {
        "status": "grounded",
        "ir": {
            "version": "universal-neural-ir/v1",
            "source": {"kind": "source", "language": "python", "framework": "keras", "analyzer": "keras-ast"},
            "nodes": builder.nodes,
            "edges": builder.edges,
        },
        "diagnostics": [],
        "capabilities": {"framework": "keras", "backend": "python-ast"},
    }


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = analyze(payload)
    except Exception as error:
        result = {"status": "error", "message": f"{type(error).__name__}: {error}"}
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
