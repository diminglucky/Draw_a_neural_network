const sourceHash = "a".repeat(64);

export function unknownDualStreamFusionUgs(): any {
  return {
    version: 1,
    graphId: "novel-dual-stream-fusion",
    revision: 1,
    sourceIds: ["prompt-1"],
    sourceHashes: [sourceHash],
    nodes: [
      node("input", "input", "Input", [], ["input:out"], "known", "proven", ["e-input"]),
      node("texture_mixer", "custom_operator", "Texture mixer", ["texture_mixer:in"], ["texture_mixer:out"], "custom", "unknown", ["e-texture"]),
      node("context_router", "custom_operator", "Context router", ["context_router:in"], ["context_router:out"], "custom", "unknown", ["e-context"]),
      node("spectral_fusion", "custom_module", "Spectral fusion", ["spectral_fusion:left", "spectral_fusion:right"], ["spectral_fusion:out"], "custom", "unknown", ["e-fusion"]),
      node("output", "output", "Prediction", ["output:in"], [], "known", "unknown", ["e-output"]),
    ],
    ports: [
      port("input:out", "input", "output"),
      port("texture_mixer:in", "texture_mixer", "input"),
      port("texture_mixer:out", "texture_mixer", "output"),
      port("context_router:in", "context_router", "input"),
      port("context_router:out", "context_router", "output"),
      port("spectral_fusion:left", "spectral_fusion", "input"),
      port("spectral_fusion:right", "spectral_fusion", "input"),
      port("spectral_fusion:out", "spectral_fusion", "output"),
      port("output:in", "output", "input"),
    ],
    edges: [
      edge("input-to-texture", "input:out", "texture_mixer:in", "e-texture"),
      edge("input-to-context", "input:out", "context_router:in", "e-context"),
      edge("texture-to-fusion", "texture_mixer:out", "spectral_fusion:left", "e-fusion"),
      edge("context-to-fusion", "context_router:out", "spectral_fusion:right", "e-fusion"),
      edge("fusion-to-output", "spectral_fusion:out", "output:in", "e-output"),
    ],
    groups: [],
    evidence: [
      evidence("e-input"),
      evidence("e-texture"),
      evidence("e-context"),
      evidence("e-fusion"),
      evidence("e-output"),
    ],
    topologyConfidence: 0.95,
    unresolved: [],
  };
}

export function unknownRepeatedFusionStackUgs(): any {
  const input = unknownDualStreamFusionUgs();
  input.nodes.splice(input.nodes.length - 1, 0, node(
    "spectral_stack",
    "container",
    "Spectral fusion stack",
    ["spectral_stack:in"],
    ["spectral_stack:out"],
    "custom",
    "unknown",
    ["e-fusion"],
  ));
  input.nodes.find((item: any) => item.nodeId === "spectral_stack").attributes = {
    repeatCount: 3,
    repeatGroupId: "spectral-stack-unit",
  };
  input.ports.push(
    port("spectral_stack:in", "spectral_stack", "input"),
    port("spectral_stack:out", "spectral_stack", "output"),
  );
  input.edges = input.edges.map((item: any) => item.edgeId === "fusion-to-output"
    ? edge("fusion-to-stack", "spectral_fusion:out", "spectral_stack:in", "e-fusion")
    : item,
  );
  input.edges.push(edge("stack-to-output", "spectral_stack:out", "output:in", "e-output"));
  input.groups.push({
    groupId: "spectral-stack-unit",
    label: "Spectral fusion unit",
    memberNodeIds: ["texture_mixer", "context_router", "spectral_fusion"],
    evidenceIds: ["e-fusion"],
  });
  return input;
}

function node(nodeId: string, kind: string, label: string, inputPortIds: string[], outputPortIds: string[], operationKnowledge: string, shapeClaim: string, evidenceIds: string[]) {
  return { nodeId, kind, label, semanticHints: [], inputPortIds, outputPortIds, attributes: {}, shapeClaim, operationKnowledge, evidenceIds };
}

function port(portId: string, nodeId: string, direction: string) {
  return { portId, nodeId, direction, label: null, representation: null, semanticType: "data", evidenceIds: [] };
}

function edge(edgeId: string, sourcePortId: string, targetPortId: string, evidenceId: string) {
  return { edgeId, sourcePortId, targetPortId, relation: "data", knowledge: "declared", evidenceIds: [evidenceId] };
}

function evidence(evidenceId: string) {
  return { evidenceId, sourceId: "prompt-1", sourceHash, locator: "prompt-fragment", excerptDigest: "b".repeat(64) };
}
