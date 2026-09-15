const node = (id, family, extra = {}) => ({ id, family, op: family, confidence: 1, evidence: [{ id: `evidence:${id}` }], ...extra });
const edge = (id, source, target, extra = {}) => ({ id, source, target, confidence: 1, evidence: [{ id: `evidence:${id}` }], ...extra });

export const neuralStructureFixtures = [
  {
    capability: "sampling-repeat",
    ir: { nodes: [node("input", "input"), node("sample", "conv", { repeatCount: 3, shape: { output: [64, 64, 32] } }), node("reduced", "pool", { shape: { output: [32, 32, 32] } })], edges: [edge("a", "input", "sample"), edge("b", "sample", "reduced")] },
  },
  {
    capability: "bypass-add",
    ir: { nodes: [node("input", "input"), node("transform", "conv"), node("add", "merge", { semanticRole: "add" }), node("output", "output")], edges: [edge("main-a", "input", "transform"), edge("main-b", "transform", "add"), edge("skip", "input", "add", { type: "skip" }), edge("out", "add", "output")] },
  },
  {
    capability: "encoder-decoder-symmetry",
    ir: { nodes: [node("input", "input"), node("down", "pool", { shape: { output: [32, 32, 64] } }), node("core", "conv"), node("up", "upsample", { shape: { output: [64, 64, 32] } }), node("output", "output")], edges: [edge("e1", "input", "down"), edge("e2", "down", "core"), edge("e3", "core", "up"), edge("e4", "up", "output"), edge("symmetric-skip", "down", "up", { type: "skip" })] },
  },
  {
    capability: "three-scale-fusion",
    ir: { nodes: [node("fine", "conv", { shape: { output: [1, 64, 80, 80] } }), node("medium", "conv", { shape: { output: [1, 128, 40, 40] } }), node("coarse", "conv", { shape: { output: [1, 256, 20, 20] } }), node("fusion", "merge", { semanticRole: "concat", shape: { output: [1, 448, 40, 40] } }), node("output", "output")], edges: [edge("fine-fusion", "fine", "fusion", { type: "cross-scale" }), edge("medium-fusion", "medium", "fusion", { type: "cross-scale" }), edge("coarse-fusion", "coarse", "fusion", { type: "cross-scale" }), edge("fusion-output", "fusion", "output")] },
  },
  {
    capability: "attention",
    ir: { nodes: [node("tokens", "input", { attributes: { dataDomain: "sequence" } }), node("query", "attention", { attributes: { dataDomain: "sequence" } }), node("context", "attention", { attributes: { dataDomain: "sequence" } }), node("output", "output")], edges: [edge("q", "tokens", "query"), edge("kv", "tokens", "context"), edge("attn", "query", "context"), edge("readout", "context", "output")] },
  },
  {
    capability: "state-feedback",
    ir: { nodes: [node("input", "input"), node("state", "recurrent", { ports: { inputs: ["x", "h"], outputs: ["y", "h"] } }), node("output", "output")], edges: [edge("input-state", "input", "state"), edge("feedback", "state", "state", { type: "loop", ports: { source: "h", target: "h" } }), edge("state-output", "state", "output")] },
  },
  {
    capability: "peer-streams",
    ir: { nodes: [node("left", "input"), node("right", "input"), node("left-op", "conv"), node("right-op", "conv"), node("join", "merge")], edges: [edge("l1", "left", "left-op"), edge("r1", "right", "right-op"), edge("l2", "left-op", "join"), edge("r2", "right-op", "join")] },
  },
  {
    capability: "conditional-routing",
    ir: { nodes: [node("input", "input"), node("gate", "control", { attributes: { conditional: true } }), node("path-a", "conv"), node("path-b", "conv"), node("join", "merge")], edges: [edge("to-gate", "input", "gate"), edge("if-a", "gate", "path-a", { type: "conditional" }), edge("if-b", "gate", "path-b", { type: "conditional" }), edge("a-join", "path-a", "join"), edge("b-join", "path-b", "join")] },
  },
  {
    capability: "irregular-graph",
    ir: { nodes: [node("a", "input"), node("b", "graph", { attributes: { dataDomain: "graph" } }), node("c", "conv"), node("d", "merge"), node("e", "output")], edges: [edge("ab", "a", "b"), edge("ac", "a", "c"), edge("bd", "b", "d"), edge("cd", "c", "d"), edge("be", "b", "e"), edge("de", "d", "e")] },
  },
  {
    capability: "unknown-operator",
    ir: { nodes: [node("input", "input"), node("unknown", "custom", { op: "UnknownOperator", compoundKind: "unresolved", confidence: 0.4 }), node("output", "output")], edges: [edge("into-unknown", "input", "unknown"), edge("unknown-output", "unknown", "output")] },
  },
];
