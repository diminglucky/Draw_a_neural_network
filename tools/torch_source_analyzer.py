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
    if re.search(r"linear|dense|fc", value):
        return "dense"
    if re.search(r"batch.?norm|layer.?norm|group.?norm", value):
        return "norm"
    if re.search(r"relu|gelu|silu|sigmoid|tanh|softmax|activation", value):
        return "activation"
    if re.search(r"attention|transformer|multihead", value):
        return "attention"
    if re.search(r"lstm|gru|rnn|recurrent", value):
        return "recurrent"
    if re.search(r"interpolate|upsample|pixel.?shuffle", value):
        return "upsample"
    if re.search(r"flatten|reshape|view", value):
        return "flatten"
    if re.search(r"\badd\b|\bcat\b|concat|merge|sum", value):
        return "merge"
    return "custom"


def op_label(name):
    return name.split(".")[-1] if name else "UnknownOperator"


def constructor_args(call):
    if not isinstance(call, ast.Call):
        return ""
    args = [unparse(arg) for arg in call.args]
    kwargs = [f"{kw.arg}={unparse(kw.value)}" for kw in call.keywords if kw.arg]
    return ", ".join(args + kwargs)


def constructor_base_name(call):
    return call_name(call.func) if isinstance(call, ast.Call) else ""


def class_is_module(node):
    for base in node.bases:
        name = call_name(base)
        if name.endswith("Module") or ".Module" in name:
            return True
    return False


def find_entry_class(tree, entry_point):
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and class_is_module(node)]
    if entry_point:
        for node in classes:
            if node.name == entry_point:
                return node
    return classes[0] if classes else None


def index_init_layers(class_node):
    layers = {}
    init = next((node for node in class_node.body if isinstance(node, ast.FunctionDef) and node.name == "__init__"), None)
    if init:
        for node in ast.walk(init):
            if not isinstance(node, ast.Assign) or len(node.targets) != 1:
                continue
            target = node.targets[0]
            if not isinstance(target, ast.Attribute) or not isinstance(target.value, ast.Name) or target.value.id != "self":
                continue
            layers[target.attr] = node.value
    return layers


def module_list_children(declaration):
    if not isinstance(declaration, ast.Call) or not constructor_base_name(declaration).endswith("ModuleList"):
        return []
    if not declaration.args:
        return []
    value = declaration.args[0]
    if isinstance(value, (ast.List, ast.Tuple)):
        return [child for child in value.elts if isinstance(child, ast.Call)]
    if isinstance(value, ast.ListComp) and isinstance(value.elt, ast.Call):
        count = range_literal_count(value.generators[0].iter if value.generators else None)
        return [value.elt for _ in range(count)] if count > 0 else []
    return []


def range_literal_count(node):
    if not isinstance(node, ast.Call) or call_name(node) != "range" or not node.args:
        return 0
    try:
        if len(node.args) == 1:
            return max(0, int(ast.literal_eval(node.args[0])))
        if len(node.args) >= 2:
            return max(0, len(range(int(ast.literal_eval(node.args[0])), int(ast.literal_eval(node.args[1])))))
    except Exception:
        return 0
    return 0


def input_shape_value(raw):
    if isinstance(raw, list) and raw and all(isinstance(v, int) for v in raw):
        return raw
    return None


def tensor_name(value):
    return getattr(value, "name", None)


def collect_names(value):
    if isinstance(value, (list, tuple)):
        result = []
        for item in value:
            result.extend(collect_names(item))
        return result
    if isinstance(value, dict):
        result = []
        for item in value.values():
            result.extend(collect_names(item))
        return result
    name = tensor_name(value)
    return [name] if name else []


def tensor_shape(value):
    try:
        shape = getattr(value, "shape", None)
        return [int(item) for item in shape] if shape is not None else None
    except Exception:
        return None


def analyze_with_torch(payload, source):
    try:
        import torch
    except Exception:
        return None, {"torchAvailable": False}
    if not payload.get("allowExecution"):
        return None, {"torchAvailable": True, "executionAllowed": False}
    shape = input_shape_value(payload.get("inputShape"))
    if not shape:
        return None, {"torchAvailable": True, "executionAllowed": True, "reason": "inputShape is required for runtime analysis"}
    try:
        namespace = {}
        exec(source, namespace)
        class_node = find_entry_class(ast.parse(source), payload.get("entryPoint"))
        if not class_node:
            return None, {"torchAvailable": True, "executionAllowed": True, "reason": "No nn.Module class found"}
        model_class = namespace.get(class_node.name)
        model = model_class()
        model.eval()
        dummy = torch.randn(*shape)
        if hasattr(torch, "export"):
            exported = torch.export.export(model, (dummy,))
            graph = exported.graph_module.graph
            analyzer = "torch-export"
        else:
            graph = torch.fx.symbolic_trace(model).graph
            analyzer = "torch-fx"
        nodes = []
        edges = []
        value_to_node = {}
        counter = 0

        def add_node(op, family, shape_value=None, line=0):
            nonlocal counter
            counter += 1
            node_id = f"torch-op-{counter}-{stable_id(op)}"
            node = {
                "id": node_id,
                "op": op,
                "family": family,
                "label": op,
                "stage": counter,
                "confidence": 0.98,
                "evidence": [{"kind": "runtime-graph", "line": int(line or 0)}],
            }
            if shape_value:
                node["shape"] = {"output": shape_value}
            nodes.append(node)
            return node

        def add_edge(source, target):
            if not source or not target or source == target:
                return
            edges.append({
                "id": f"torch-edge-{len(edges) + 1}-{stable_id(source)}-{stable_id(target)}",
                "source": source,
                "target": target,
                "type": "signal",
                "confidence": 0.98,
                "evidence": [{"kind": "runtime-graph"}],
            })

        for fx_node in graph.nodes:
            op_type = str(fx_node.op)
            incoming = []
            for name in collect_names(fx_node.args) + collect_names(fx_node.kwargs):
                incoming.extend(value_to_node.get(name, []))
            if op_type == "placeholder":
                created = add_node("Input", "input", tensor_shape(fx_node.meta.get("val")))
                value_to_node[fx_node.name] = [created["id"]]
                continue
            if op_type in {"call_module", "call_function", "call_method"}:
                target = fx_node.target
                if op_type == "call_module":
                    try:
                        target_name = model.get_submodule(str(target)).__class__.__name__
                    except Exception:
                        target_name = str(target)
                elif op_type == "call_function":
                    target_name = getattr(target, "__name__", str(target).split(".")[-1])
                else:
                    target_name = str(target)
                created = add_node(target_name or "UnknownOperator", family_for(target_name), tensor_shape(fx_node.meta.get("val")))
                for source_id in incoming:
                    add_edge(source_id, created["id"])
                value_to_node[fx_node.name] = [created["id"]]
                continue
            if op_type == "output":
                output_node = add_node("Output", "output")
                for source_id in incoming:
                    add_edge(source_id, output_node["id"])
                value_to_node[fx_node.name] = [output_node["id"]]
        return {
            "status": "grounded",
            "ir": {
                "version": "universal-neural-ir/v1",
                "source": {
                    "kind": "source",
                    "language": "python",
                    "analyzer": analyzer,
                    "name": class_node.name,
                },
                "nodes": nodes,
                "edges": edges,
            },
            "diagnostics": [],
            "capabilities": {"framework": "pytorch", "torchAvailable": True, "executionAllowed": True},
        }, {"torchAvailable": True, "executionAllowed": True}
    except Exception as error:
        return None, {
            "torchAvailable": True,
            "executionAllowed": True,
            "torchError": f"{type(error).__name__}: {error}",
        }


class GraphBuilder:
    def __init__(self, class_node, layers, input_shape):
        self.class_node = class_node
        self.layers = layers
        self.nodes = []
        self.edges = []
        self.current_var = "x"
        self.var_node = {}
        self.counter = 0

    def add_node(self, op, family, line, shape=None, confidence=0.85, compound_kind=None):
        self.counter += 1
        node_id = f"source-op-{self.counter}-{stable_id(op)}"
        node = {
            "id": node_id,
            "op": op,
            "family": family,
            "label": op,
            "stage": self.counter,
            "confidence": confidence,
            "evidence": [{"kind": "source", "line": int(line or 0)}],
        }
        if shape:
            node["shape"] = {"output": shape}
        if compound_kind:
            node["compoundKind"] = compound_kind
        self.nodes.append(node)
        return node

    def add_edge(self, source, target, edge_type="signal", line=0):
        if not source or not target:
            return
        edge_id = f"source-edge-{len(self.edges) + 1}-{stable_id(source)}-{stable_id(target)}"
        self.edges.append({
            "id": edge_id,
            "source": source,
            "target": target,
            "type": edge_type,
            "confidence": 0.85,
            "evidence": [{"kind": "source", "line": int(line or 0)}],
        })

    def node_for_call(self, call, line):
        name = call_name(call)
        last = name.split(".")[-1]
        layer_name = name[5:] if name.startswith("self.") else name
        if layer_name in self.layers:
            declaration = self.layers[layer_name]
            declared_name = call_name(declaration) or last
            family = family_for(declared_name)
            op = op_label(declared_name)
            args = constructor_args(declaration)
            node = self.add_node(op, family, line)
            if args:
                node["attributes"] = {"constructorArgs": args}
            return node

        if name.startswith("self.") or last:
            if last in {"cat", "concat"}:
                return self.add_node("Concat", "merge", line, confidence=0.9)
            if last in {"add", "__add__"}:
                return self.add_node("Add", "merge", line, confidence=0.9)
            if last in {"relu", "gelu", "silu", "sigmoid", "tanh", "softmax"}:
                return self.add_node(last, family_for(last), line, confidence=0.9)
            if last in {"flatten", "reshape", "view"}:
                return self.add_node(last, "flatten", line, confidence=0.9)
            if last in {"interpolate", "upsample"}:
                return self.add_node(last, "upsample", line, confidence=0.9)
            family = family_for(last)
            return self.add_node(op_label(last), family, line, confidence=0.55, compound_kind="unresolved" if family == "custom" else None)
        return self.add_node("UnknownOperator", "custom", line, confidence=0.3, compound_kind="unresolved")

    def node_for_constructor(self, declaration, line):
        declared_name = constructor_base_name(declaration)
        family = family_for(declared_name)
        op = op_label(declared_name)
        node = self.add_node(op, family, line, confidence=0.85, compound_kind="unresolved" if family == "custom" else None)
        args = constructor_args(declaration)
        if args:
            node["attributes"] = {"constructorArgs": args}
        return node

    def expand_sequential(self, declaration, call, line):
        incoming = []
        for arg in call.args:
            incoming.extend(self.process_value(arg, line))
        previous = incoming[-1] if incoming else self.var_node.get(self.current_var)
        last_id = previous
        for child in declaration.args:
            if not isinstance(child, ast.Call):
                continue
            node = self.node_for_constructor(child, line)
            self.add_edge(last_id, node["id"], "signal", line)
            last_id = node["id"]
        return last_id

    def process_forward(self):
        forward = next((node for node in self.class_node.body if isinstance(node, ast.FunctionDef) and node.name == "forward"), None)
        if not forward:
            return []
        input_node = self.add_node("Input", "input", forward.lineno, confidence=0.95)
        self.var_node["x"] = input_node["id"]
        if forward.args.args:
            self.var_node[forward.args.args[0].arg] = input_node["id"]
        output_ids = []
        for statement in forward.body:
            node_ids = self.process_statement(statement)
            if isinstance(statement, ast.Return):
                output_ids = node_ids
        if not any(node["family"] == "output" for node in self.nodes):
            output_node = self.add_node("Output", "output", forward.lineno, confidence=0.95)
            for source in output_ids or ([self.var_node.get("x")] if self.var_node.get("x") else []):
                self.add_edge(source, output_node["id"], "output", forward.lineno)
        return self.nodes

    def process_statement(self, statement):
        if isinstance(statement, ast.For):
            expanded = self.expand_module_list_loop(statement)
            if expanded:
                return expanded
        if isinstance(statement, ast.Assign):
            node_ids = self.process_value(statement.value, statement.lineno)
            for target in statement.targets:
                names = [target.id] if isinstance(target, ast.Name) else []
                if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == "self":
                    names = [f"self.{target.attr}"]
                for name in names:
                    if node_ids:
                        self.var_node[name] = node_ids[-1]
            return node_ids
        if isinstance(statement, ast.Return):
            return self.process_value(statement.value, statement.lineno)
        return []

    def expand_module_list_loop(self, statement):
        if not isinstance(statement.target, ast.Name):
            return []
        if not isinstance(statement.iter, ast.Attribute) or not isinstance(statement.iter.value, ast.Name) or statement.iter.value.id != "self":
            return []
        children = module_list_children(self.layers.get(statement.iter.attr))
        if not children or len(statement.body) != 1:
            return []
        body = statement.body[0]
        if not isinstance(body, ast.Assign) or len(body.targets) != 1:
            return []
        target = body.targets[0]
        if not isinstance(target, ast.Name) or not isinstance(body.value, ast.Call):
            return []
        if call_name(body.value) != statement.target.id:
            return []
        previous = self.var_node.get(self.current_var)
        created = []
        for child in children:
            node = self.node_for_constructor(child, statement.lineno)
            self.add_edge(previous, node["id"], "signal", statement.lineno)
            previous = node["id"]
            created.append(node["id"])
        if created:
            self.var_node[target.id] = created[-1]
            self.current_var = target.id
        return created

    def process_value(self, value, line):
        if value is None:
            return []
        if isinstance(value, ast.Name):
            return [self.var_node.get(value.id)] if self.var_node.get(value.id) else []
        if isinstance(value, ast.Attribute) and isinstance(value.value, ast.Name) and value.value.id == "self":
            name = f"self.{value.attr}"
            return [self.var_node.get(name)] if self.var_node.get(name) else []
        if isinstance(value, ast.Call):
            return [self.process_call(value, line)]
        if isinstance(value, ast.IfExp):
            left_nodes = self.process_value(value.body, line)
            right_nodes = self.process_value(value.orelse, line)
            merge = self.add_node("ConditionalMerge", "merge", line, confidence=0.7, compound_kind="unresolved")
            for source in left_nodes + right_nodes:
                self.add_edge(source, merge["id"], "conditional", line)
            return [merge["id"]]
        if isinstance(value, ast.BinOp):
            left_nodes = self.process_value(value.left, line)
            right_nodes = self.process_value(value.right, line)
            op = "Add" if isinstance(value.op, ast.Add) else "Merge"
            merge = self.add_node(op, "merge", line, confidence=0.9)
            for source in left_nodes + right_nodes:
                self.add_edge(source, merge["id"], "residual" if op == "Add" else "merge", line)
            return [merge["id"]]
        return []

    def process_call(self, call, line):
        name = call_name(call)
        layer_name = name[5:] if name.startswith("self.") else name
        declaration = self.layers.get(layer_name)
        if isinstance(declaration, ast.Call) and constructor_base_name(declaration).endswith("Sequential"):
            return self.expand_sequential(declaration, call, line)
        if name.endswith("cat") or name.endswith("concat"):
            merge = self.add_node("Concat", "merge", line, confidence=0.9)
            for arg in call.args:
                values = arg.elts if isinstance(arg, (ast.List, ast.Tuple)) else [arg]
                for item in values:
                    for source in self.process_value(item, line):
                        self.add_edge(source, merge["id"], "merge", line)
            return merge["id"]
        node = self.node_for_call(call, line)
        incoming = []
        if call.args:
            for arg in call.args:
                incoming.extend(self.process_value(arg, line))
        for source in incoming:
            self.add_edge(source, node["id"], "signal", line)
        return node["id"]


def analyze(payload):
    source = str(payload.get("source") or "")
    framework = str(payload.get("framework") or "auto").lower()
    if not source.strip():
        return {"status": "error", "message": "source is required"}
    runtime_result, runtime_capabilities = analyze_with_torch(payload, source)
    if runtime_result:
        return runtime_result
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return {"status": "error", "message": f"Python syntax error: {error}"}
    class_node = find_entry_class(tree, payload.get("entryPoint"))
    if not class_node:
        return {
            "status": "unresolved",
            "ir": {
                "version": "universal-neural-ir/v1",
                "source": {"kind": "source", "language": "python", "analyzer": "python-ast"},
                "nodes": [{"id": "unresolved-source", "op": "UnresolvedSourceGraph", "family": "custom", "compoundKind": "unresolved", "confidence": 0.2}],
                "edges": [],
            },
            "diagnostics": [{"kind": "unresolved-source", "severity": "warning", "message": "No nn.Module class was found."}],
        }
    layers = index_init_layers(class_node)
    builder = GraphBuilder(class_node, layers, input_shape_value(payload.get("inputShape")))
    nodes = builder.process_forward()
    return {
        "status": "grounded",
        "ir": {
            "version": "universal-neural-ir/v1",
            "source": {"kind": "source", "language": "python", "analyzer": "python-ast", "name": class_node.name},
            "nodes": nodes,
            "edges": builder.edges,
        },
        "diagnostics": [],
        "capabilities": {
            "framework": framework or "auto",
            **runtime_capabilities,
            "fallback": "python-ast",
        },
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
