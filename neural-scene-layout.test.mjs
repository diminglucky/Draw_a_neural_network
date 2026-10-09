import assert from "node:assert/strict";
import test from "node:test";
import { layoutNeuralScene, scoreLayout, validateLaidOutScene } from "./neural-scene-layout.mjs";

function scene() {
  return {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "input", role: "body", category: "data", form: "plane", sourceNodeIds: ["input"], projectionId: "p-input", semanticTags: ["input"], data: { scale: "s1" } },
      { id: "branch", role: "body", category: "operator", form: "band", sourceNodeIds: ["branch"], projectionId: "p-branch", semanticTags: ["branch"], data: { scale: "s1" } },
      { id: "left", role: "body", category: "operator", form: "volume", sourceNodeIds: ["left"], projectionId: "p-left", semanticTags: ["spatial"], data: { scale: "s1" } },
      { id: "right", role: "body", category: "operator", form: "volume", sourceNodeIds: ["right"], projectionId: "p-right", semanticTags: ["spatial"], data: { scale: "s2" } },
      { id: "merge", role: "body", category: "structure", form: "glyph", sourceNodeIds: ["merge"], projectionId: "p-merge", semanticTags: ["merge"], data: { scale: "s1" } },
      { id: "label", role: "decoration", category: "annotation", form: "text", sourceNodeIds: ["branch"], projectionId: "p-branch", semanticTags: ["label"], labels: ["branch"] },
    ],
    relations: [
      { id: "e0", sourcePrimitiveId: "input", targetPrimitiveId: "branch", relationTags: ["data"], sourceEdgeIds: ["e0"] },
      { id: "e1", sourcePrimitiveId: "branch", targetPrimitiveId: "left", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "branch", targetPrimitiveId: "right", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "left", targetPrimitiveId: "merge", relationTags: ["data"], sourceEdgeIds: ["e3"] },
      { id: "e4", sourcePrimitiveId: "right", targetPrimitiveId: "merge", relationTags: ["crossScale"], sourceEdgeIds: ["e4"] },
      { id: "skip", sourcePrimitiveId: "branch", targetPrimitiveId: "merge", relationTags: ["bypass"], sourceEdgeIds: ["skip"] },
    ],
    constraints: [],
  };
}

test("lays out primitives in abstract units with stable bounds, anchors, and page", () => {
  const result = layoutNeuralScene(scene());
  assert.equal(result.version, "laid-out-neural-scene/v1");
  assert.equal(result.units, "layout-unit");
  assert.ok(result.page.width > 0 && result.page.height > 0);
  assert.ok(result.primitives.every((primitive) => primitive.bounds.w > 0 && primitive.bounds.h > 0 && Number.isInteger(primitive.zIndex)));
  assert.ok(result.primitives.find((primitive) => primitive.id === "input").anchors.outputs.length > 0);
  assert.ok(result.connectors.find((connector) => connector.id === "skip").routeClass === "bypass");
  assert.equal(result.connectors.find((connector) => connector.id === "e4").routeClass, "cross-scale");
  assert.equal(result.visualQuality.connectorBodyIntersectionCount, 0);
  assert.ok(result.visualQuality.whitespaceRatio >= 0 && result.visualQuality.whitespaceRatio <= 1);
});

test("preserves production-style body and decoration primitives", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      {
        id: "primitive:projection:direct:a:body",
        role: "body",
        category: "operator",
        form: "band",
        projectionId: "projection:direct:a",
        sourceNodeIds: ["a"],
        semanticTags: ["operator"],
      },
      {
        id: "primitive:projection:direct:a:decoration:1",
        role: "decoration",
        category: "annotation",
        form: "text",
        projectionId: "projection:direct:a",
        sourceNodeIds: ["a"],
        semanticTags: ["label"],
        labels: ["Conv"],
      },
      {
        id: "primitive:projection:direct:b:body",
        role: "body",
        category: "operator",
        form: "band",
        projectionId: "projection:direct:b",
        sourceNodeIds: ["b"],
        semanticTags: ["operator"],
      },
    ],
    relations: [{
      id: "relation:ab",
      sourcePrimitiveId: "primitive:projection:direct:a:body",
      targetPrimitiveId: "primitive:projection:direct:b:body",
      relationTags: ["data"],
      sourceEdgeIds: ["ab"],
    }],
    groups: [],
  };

  const result = layoutNeuralScene(input);
  const decoration = result.primitives.find((primitive) => primitive.id === input.primitives[1].id);
  const owner = result.primitives.find((primitive) => primitive.id === input.primitives[0].id);

  assert.ok(decoration);
  assert.equal(decoration.bounds.x, owner.bounds.x);
  assert.equal(decoration.bounds.y, owner.bounds.y + owner.bounds.h + 12);
  assert.equal(validateLaidOutScene(result, input).ok, true);
});

test("uses blockKind-specific dimensions for block-aware projections", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "residual", role: "body", category: "structure", form: "band", blockKind: "residual-block", projectionId: "p-residual", sourceNodeIds: ["a", "b", "add"] },
      { id: "attention", role: "body", category: "operator", form: "stack", blockKind: "attention-block", projectionId: "p-attention", sourceNodeIds: ["attn", "norm"] },
    ],
    relations: [],
    groups: [],
    constraints: [],
  };
  const result = layoutNeuralScene(input);
  const residual = result.primitives.find((primitive) => primitive.id === "residual");
  const attention = result.primitives.find((primitive) => primitive.id === "attention");
  assert.deepEqual({ w: residual.bounds.w, h: residual.bounds.h }, { w: 154, h: 108 });
  assert.deepEqual({ w: attention.bounds.w, h: attention.bounds.h }, { w: 138, h: 116 });
});

test("arranges encoder and decoder block stages into a U-shaped layout", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "encoder", role: "body", category: "structure", form: "band", blockKind: "encoder-stage", projectionId: "p-encoder", sourceNodeIds: ["enc1", "pool1"] },
      { id: "bottleneck", role: "body", category: "operator", form: "band", blockKind: "attention-block", projectionId: "p-bottleneck", sourceNodeIds: ["attn"] },
      { id: "decoder", role: "body", category: "structure", form: "band", blockKind: "decoder-stage", projectionId: "p-decoder", sourceNodeIds: ["up1", "dec1"] },
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "encoder", targetPrimitiveId: "bottleneck", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "bottleneck", targetPrimitiveId: "decoder", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "skip", sourcePrimitiveId: "encoder", targetPrimitiveId: "decoder", relationTags: ["bypass"], sourceEdgeIds: ["skip"] },
    ],
    groups: [],
    constraints: [],
  };
  const result = layoutNeuralScene(input);
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  assert.ok(byId.get("bottleneck").bounds.y > byId.get("encoder").bounds.y);
  assert.ok(byId.get("bottleneck").bounds.x > byId.get("encoder").bounds.x);
  assert.ok(byId.get("decoder").bounds.x > byId.get("bottleneck").bounds.x);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("stacks attention and FFN blocks vertically for transformer-style layout", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "input", role: "body", category: "data", form: "plane", sourceFamilies: ["input"], projectionId: "p-input", sourceNodeIds: ["input"] },
      { id: "attn", role: "body", category: "operator", form: "stack", blockKind: "attention-block", projectionId: "p-attn", sourceNodeIds: ["attn", "norm"] },
      { id: "ffn", role: "body", category: "operator", form: "stack", blockKind: "ffn-block", projectionId: "p-ffn", sourceNodeIds: ["ffn1", "ffn2"] },
      { id: "output", role: "body", category: "data", form: "band", sourceFamilies: ["output"], projectionId: "p-output", sourceNodeIds: ["output"] },
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "input", targetPrimitiveId: "attn", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "attn", targetPrimitiveId: "ffn", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "ffn", targetPrimitiveId: "output", relationTags: ["data"], sourceEdgeIds: ["e3"] },
    ],
    groups: [],
    constraints: [],
  };
  const result = layoutNeuralScene(input);
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  assert.equal(byId.get("attn").bounds.x, byId.get("ffn").bounds.x);
  assert.ok(byId.get("ffn").bounds.y > byId.get("attn").bounds.y);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("aligns multi-scale fusion and MoE source branches around the target block", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "p3", role: "body", category: "operator", form: "band", projectionId: "p-p3", sourceNodeIds: ["p3"] },
      { id: "p4", role: "body", category: "operator", form: "band", projectionId: "p-p4", sourceNodeIds: ["p4"] },
      { id: "fusion", role: "body", category: "structure", form: "glyph", blockKind: "multi-scale-fusion", projectionId: "p-fusion", sourceNodeIds: ["p3", "p4", "cat"] },
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "p3", targetPrimitiveId: "fusion", relationTags: ["data", "crossScale"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "p4", targetPrimitiveId: "fusion", relationTags: ["data", "crossScale"], sourceEdgeIds: ["e2"] },
    ],
    groups: [],
    constraints: [],
  };
  const result = layoutNeuralScene(input);
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  const p3Center = byId.get("p3").bounds.y + byId.get("p3").bounds.h / 2;
  const p4Center = byId.get("p4").bounds.y + byId.get("p4").bounds.h / 2;
  const fusionCenter = byId.get("fusion").bounds.y + byId.get("fusion").bounds.h / 2;
  assert.notEqual(p3Center, p4Center);
  assert.ok(Math.abs((p3Center + p4Center) / 2 - fusionCenter) < 0.001);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("uses declared ports when routing vertical container flow", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      {
        id: "source",
        role: "body",
        category: "operator",
        form: "band",
        projectionId: "p-source",
        sourceNodeIds: ["source"],
        ports: { inputs: [{ portId: "top" }], outputs: [{ portId: "bottom" }] },
      },
      {
        id: "target",
        role: "body",
        category: "operator",
        form: "band",
        projectionId: "p-target",
        sourceNodeIds: ["target"],
        ports: { inputs: [{ portId: "top" }], outputs: [{ portId: "bottom" }] },
      },
    ],
    relations: [{
      id: "relation:flow",
      sourcePrimitiveId: "source",
      targetPrimitiveId: "target",
      sourcePortId: "bottom",
      targetPortId: "top",
      relationTags: ["data"],
      sourceEdgeIds: ["flow"],
    }],
    groups: [{ id: "stack", primitiveIds: ["source", "target"], direction: "vertical" }],
  };

  const result = layoutNeuralScene(input);
  const source = result.primitives.find((primitive) => primitive.id === "source");
  const target = result.primitives.find((primitive) => primitive.id === "target");
  const connector = result.connectors.find((item) => item.id === "relation:flow");
  const sourceAnchor = source.anchors.outputs.find((anchor) => anchor.id === "bottom");
  const targetAnchor = target.anchors.inputs.find((anchor) => anchor.id === "top");

  assert.deepEqual(connector.points[0], { x: sourceAnchor.x, y: sourceAnchor.y });
  assert.deepEqual(connector.points.at(-1), { x: targetAnchor.x, y: targetAnchor.y });
});

test("aligns same-scale branch centers within one layer", () => {
  const input = scene();
  input.primitives.find((primitive) => primitive.id === "right").data.scale = "s1";
  const result = layoutNeuralScene(input);
  const left = result.primitives.find((primitive) => primitive.id === "left");
  const right = result.primitives.find((primitive) => primitive.id === "right");
  assert.equal(left.bounds.y + left.bounds.h / 2, right.bounds.y + right.bounds.h / 2);
});

test("rendering profile controls reserved route corridors", () => {
  const input = scene();
  const result = layoutNeuralScene(input, {
    renderingProfile: {
      version: "neural-rendering-profile/v1",
      constraints: [{ id: "route:e1", kind: "reserve-route-corridor", edgeId: "e1", routeClass: "conditional" }],
    },
  });
  assert.equal(result.connectors.find((connector) => connector.id === "e1").routeClass, "conditional");
});

test("rendering profile owns scale centerline alignment", () => {
  const input = scene();
  const withoutAlignment = layoutNeuralScene(input, {
    renderingProfile: { version: "neural-rendering-profile/v1", constraints: [] },
  });
  const inputNode = withoutAlignment.primitives.find((primitive) => primitive.id === "input");
  const left = withoutAlignment.primitives.find((primitive) => primitive.id === "left");
  assert.notEqual(inputNode.bounds.y + inputNode.bounds.h / 2, left.bounds.y + left.bounds.h / 2);
});

test("encoder-decoder-u layout archetype separates encoder, bottleneck, and decoder columns", () => {
  const input = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "input", role: "body", category: "data", form: "plane", sourceNodeIds: ["input"], projectionId: "p-input", semanticTags: ["input"], data: { scale: "s1" } },
      { id: "down", role: "body", category: "operator", form: "wedge", sourceNodeIds: ["down"], projectionId: "p-down", semanticTags: ["reduce"], data: { scale: "s2" } },
      { id: "core", role: "body", category: "operator", form: "volume", sourceNodeIds: ["core"], projectionId: "p-core", semanticTags: ["spatial"], data: { scale: "s3" } },
      { id: "up", role: "body", category: "operator", form: "wedge", sourceNodeIds: ["up"], projectionId: "p-up", semanticTags: ["expand"], data: { scale: "s2" } },
      { id: "output", role: "body", category: "data", form: "plane", sourceNodeIds: ["output"], projectionId: "p-output", semanticTags: ["output"], data: { scale: "s1" } },
    ],
    relations: [
      { id: "e1", sourcePrimitiveId: "input", targetPrimitiveId: "down", relationTags: ["data"], sourceEdgeIds: ["e1"] },
      { id: "e2", sourcePrimitiveId: "down", targetPrimitiveId: "core", relationTags: ["data"], sourceEdgeIds: ["e2"] },
      { id: "e3", sourcePrimitiveId: "core", targetPrimitiveId: "up", relationTags: ["data"], sourceEdgeIds: ["e3"] },
      { id: "e4", sourcePrimitiveId: "up", targetPrimitiveId: "output", relationTags: ["data"], sourceEdgeIds: ["e4"] },
      { id: "skip", sourcePrimitiveId: "input", targetPrimitiveId: "output", relationTags: ["bypass"], sourceEdgeIds: ["skip"] },
    ],
    constraints: [],
  };
  const result = layoutNeuralScene(input, {
    renderingProfile: {
      version: "neural-rendering-profile/v1",
      constraints: [{ id: "u", kind: "layout-archetype", archetype: "encoder-decoder-u" }],
    },
  });
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  assert.ok(byId.get("down").bounds.y > byId.get("input").bounds.y);
  assert.ok(byId.get("core").bounds.x > byId.get("down").bounds.x);
  assert.ok(byId.get("output").bounds.x > byId.get("core").bounds.x);
  assert.ok(byId.get("output").bounds.y < byId.get("up").bounds.y);
});

test("applies motif center-y constraints without introducing overlaps", () => {
  const constrained = {
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "source-a", role: "body", category: "data", form: "plane", projectionId: "p-a", sourceNodeIds: ["a"], data: { scale: "s1" } },
      { id: "source-b", role: "body", category: "data", form: "plane", projectionId: "p-b", sourceNodeIds: ["b"], data: { scale: "s2" } },
      { id: "target", role: "body", category: "structure", form: "glyph", projectionId: "p-target", sourceNodeIds: ["target"], data: { scale: "s1" } },
    ],
    relations: [
      { id: "a-target", sourcePrimitiveId: "source-a", targetPrimitiveId: "target", relationTags: ["data"], sourceEdgeIds: ["a-target"] },
      { id: "b-target", sourcePrimitiveId: "source-b", targetPrimitiveId: "target", relationTags: ["data"], sourceEdgeIds: ["b-target"] },
    ],
    constraints: [{ id: "center", kind: "center-y-between", targetPrimitiveId: "target", memberPrimitiveIds: ["source-a", "source-b"] }],
    groups: [],
  };
  const result = layoutNeuralScene(constrained);
  const byId = new Map(result.primitives.map((primitive) => [primitive.id, primitive]));
  const centers = [byId.get("source-a"), byId.get("source-b")].map((primitive) => primitive.bounds.y + primitive.bounds.h / 2);
  const targetCenter = byId.get("target").bounds.y + byId.get("target").bounds.h / 2;

  assert.ok(Math.abs(targetCenter - (Math.min(...centers) + Math.max(...centers)) / 2) < 1e-9);
  assert.equal(validateLaidOutScene(result, constrained).ok, true);
});

test("enforces non-overlap, left-to-right DAG direction, and bypass obstacle avoidance", () => {
  const result = layoutNeuralScene(scene());
  const bodies = result.primitives.filter((primitive) => primitive.role === "body");
  for (let i = 0; i < bodies.length; i += 1) for (let j = i + 1; j < bodies.length; j += 1) assert.equal(overlaps(bodies[i].bounds, bodies[j].bounds), false);
  const branch = result.primitives.find((primitive) => primitive.id === "branch");
  const merge = result.primitives.find((primitive) => primitive.id === "merge");
  assert.ok(merge.bounds.x > branch.bounds.x);
  assert.ok(result.connectors.every((connector) => connector.points.length >= 2));
  for (const connector of result.connectors) {
    for (const body of bodies) {
      if (body.id === connector.sourcePrimitiveId || body.id === connector.targetPrimitiveId) continue;
      assert.equal(pathIntersects(connector.points, body.bounds), false, `${connector.id} crosses ${body.id}`);
    }
  }
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("lays out declared scene groups as containing bounds", () => {
  const grouped = { ...scene(), groups: [{ id: "branch-group", role: "module", primitiveIds: ["branch", "left", "right"] }] };
  const result = layoutNeuralScene(grouped);
  const group = result.groups.find((item) => item.id === "branch-group");
  assert.ok(group);
  for (const id of group.primitiveIds) {
    const primitive = result.primitives.find((item) => item.id === id);
    assert.ok(contains(group.bounds, primitive.bounds));
  }
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("aligns equal scales and reports cross-scale transfers as soft diagnostics", () => {
  const result = layoutNeuralScene(scene());
  const left = result.primitives.find((primitive) => primitive.id === "left");
  const input = result.primitives.find((primitive) => primitive.id === "input");
  assert.equal(left.bounds.y + left.bounds.h / 2, input.bounds.y + input.bounds.h / 2);
  assert.ok(result.diagnostics.some((item) => item.code === "cross-scale-transfer"));
  assert.equal(result.softScore.crossScaleAlignment >= 0, true);
});

test("layout is deterministic and budget overflow is explicit", () => {
  const first = layoutNeuralScene(scene(), { maxPrimitives: 2 });
  const second = layoutNeuralScene(scene(), { maxPrimitives: 2 });
  assert.deepEqual(first, second);
  assert.ok(first.diagnostics.some((item) => item.code === "layout-budget-exceeded"));
});

test("validation reports containment, anchor, page, and route hard violations", () => {
  const result = layoutNeuralScene(scene());
  result.primitives.find((primitive) => primitive.id === "branch").bounds.x = -1;
  result.connectors[0].points = [];
  const validation = validateLaidOutScene(result);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "primitive-out-of-page"));
  assert.ok(validation.issues.some((issue) => issue.code === "invalid-connector-route"));
});

test("validation reports relations that were not laid out", () => {
  const input = scene();
  const result = layoutNeuralScene(input);
  result.connectors = result.connectors.filter((connector) => connector.id !== "e0");

  const validation = validateLaidOutScene(result, input);
  assert.ok(validation.issues.some((issue) => issue.code === "missing-laid-out-connector" && issue.relationId === "e0"));
});

test("validation rejects connectors that reference missing block port anchors", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      {
        id: "block",
        role: "body",
        category: "structure",
        form: "band",
        blockKind: "residual-block",
        projectionId: "p-block",
        sourceNodeIds: ["a", "b"],
        ports: { inputs: [{ portId: "image" }], outputs: [{ portId: "features" }] },
      },
    ],
    relations: [],
    groups: [],
    constraints: [],
  });
  result.connectors.push({
    id: "bad-port",
    sourcePrimitiveId: "block",
    targetPrimitiveId: "block",
    sourcePortId: "missing-output",
    targetPortId: "image",
    relationTags: ["data"],
    points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
  });
  const validation = validateLaidOutScene(result);
  assert.ok(validation.issues.some((issue) =>
    issue.code === "missing-block-port-anchor"
    && issue.relationId === "bad-port"
    && issue.side === "source"
    && issue.portId === "missing-output"));
});

test("reports block badge and port QA metrics", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "block", role: "body", category: "structure", form: "band", blockKind: "residual-block", projectionId: "p-block", sourceNodeIds: ["a", "b"], ports: { inputs: [], outputs: [] } },
    ],
    relations: [],
    groups: [],
    constraints: [],
  });
  assert.equal(result.visualQuality.blockPrimitiveCount, 1);
  assert.equal(result.visualQuality.blockBadgeMissingCount, 1);
  assert.equal(result.visualQuality.blockPortMissingCount, 1);
  assert.ok(result.diagnostics.some((issue) => issue.code === "block-badge-missing"));
  assert.ok(result.diagnostics.some((issue) => issue.code === "block-port-missing"));
});

test("block QA thresholds are configurable", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "block", role: "body", category: "structure", form: "band", blockKind: "residual-block", projectionId: "p-block", sourceNodeIds: ["a", "b"], ports: { inputs: [], outputs: [] } },
    ],
    relations: [],
    groups: [],
    constraints: [],
  }, {
    visualQualityThresholds: {
      maxBlockBadgeMissingCount: 1,
      maxBlockPortMissingCount: 1,
    },
  });
  assert.equal(result.diagnostics.some((issue) => issue.code === "block-badge-missing"), false);
  assert.equal(result.diagnostics.some((issue) => issue.code === "block-port-missing"), false);
  assert.equal(result.visualQuality.thresholds.maxBlockPortMissingCount, 1);
});

test("residual bypass chooses a bottom corridor when the top edge is too close", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      { id: "source", role: "body", category: "operator", form: "band", blockKind: "residual-block", projectionId: "p-source", sourceNodeIds: ["source"], ports: { inputs: [], outputs: [{ portId: "out" }] } },
      { id: "target", role: "body", category: "operator", form: "band", blockKind: "residual-block", projectionId: "p-target", sourceNodeIds: ["target"], ports: { inputs: [{ portId: "in" }], outputs: [] } },
    ],
    relations: [
      { id: "skip", sourcePrimitiveId: "source", targetPrimitiveId: "target", relationTags: ["bypass"], sourceEdgeIds: ["skip"] },
    ],
    groups: [],
    constraints: [],
  });
  const connector = result.connectors.find((item) => item.id === "skip");
  assert.ok(connector.points.some((point) => point.y > 100));
});

test("scores segment crossings between connectors without shared endpoints", () => {
  const connectors = [
    { id: "down", sourcePrimitiveId: "a", targetPrimitiveId: "d", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    { id: "up", sourcePrimitiveId: "b", targetPrimitiveId: "c", points: [{ x: 0, y: 10 }, { x: 10, y: 0 }] },
    { id: "shared", sourcePrimitiveId: "a", targetPrimitiveId: "e", points: [{ x: 0, y: 10 }, { x: 10, y: 0 }] },
  ];

  assert.equal(scoreLayout([], connectors).crossings, 1);
});

test("validation rejects a connector that passes through an unrelated body", () => {
  const layout = {
    version: "laid-out-neural-scene/v1",
    units: "layout-unit",
    page: { x: 0, y: 0, width: 300, height: 120 },
    primitives: [
      body("source", 10, 40, 40, 40),
      body("obstacle", 120, 30, 60, 60),
      body("target", 240, 40, 40, 40),
    ],
    connectors: [
      { id: "through", sourcePrimitiveId: "source", targetPrimitiveId: "target", relationTags: ["data"], points: [{ x: 50, y: 60 }, { x: 240, y: 60 }] },
    ],
    groups: [],
  };

  const validation = validateLaidOutScene(layout);
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.issues.find((issue) => issue.code === "connector-body-intersection"), {
    code: "connector-body-intersection",
    relationId: "through",
    primitiveId: "obstacle",
  });
});

test("routes through one corridor around consecutive obstacles", () => {
  const result = layoutNeuralScene(corridorScene({ blockTop: false }));
  const connector = result.connectors.find((item) => item.id === "long-route");
  const unrelatedBodies = result.primitives.filter((item) => item.role === "body"
    && item.id !== connector.sourcePrimitiveId && item.id !== connector.targetPrimitiveId);

  assert.ok(connector.points.length >= 4);
  assert.ok(unrelatedBodies.every((item) => !pathIntersects(connector.points, item.bounds)));
});

test("uses the bottom corridor when the top corridor is blocked", () => {
  const result = layoutNeuralScene(corridorScene({ blockTop: true }));
  const connector = result.connectors.find((item) => item.id === "long-route");
  const source = result.primitives.find((item) => item.id === "z-source");
  const unrelatedBodies = result.primitives.filter((item) => item.role === "body"
    && item.id !== connector.sourcePrimitiveId && item.id !== connector.targetPrimitiveId);

  assert.ok(connector.points.length >= 4);
  assert.ok(unrelatedBodies.every((item) => !pathIntersects(connector.points, item.bounds)));
  assert.equal(validateLaidOutScene(result).issues.some((issue) => issue.relationId === "long-route"), false);
});

test("multi-corridor obstacle routing is deterministic", () => {
  const input = corridorScene({ blockTop: true });
  const routes = Array.from({ length: 5 }, () => layoutNeuralScene(input).connectors.find((item) => item.id === "long-route").points);

  for (const route of routes.slice(1)) assert.deepEqual(route, routes[0]);
});

test("nested groups participate in placement without sibling overlap or non-finite bounds", () => {
  const grouped = {
    version: "semantic-neural-scene/v1",
    primitives: [
      sceneBody("left-a", "band", "flow"),
      sceneBody("left-b", "band", "flow"),
      sceneBody("right-a", "band", "flow"),
    ],
    relations: [
      relation("left-flow", "left-a", "left-b"),
      relation("cross", "left-b", "right-a"),
    ],
    groups: [
      { id: "root", parentId: "", primitiveIds: ["left-a", "left-b", "right-a"] },
      { id: "left", parentId: "root", primitiveIds: ["left-a", "left-b"] },
      { id: "right", parentId: "root", primitiveIds: ["right-a"] },
      { id: "empty", parentId: "root", primitiveIds: [] },
    ],
  };

  const result = layoutNeuralScene(grouped);
  const byGroup = new Map(result.groups.map((group) => [group.id, group]));
  assert.equal(contains(byGroup.get("root").bounds, byGroup.get("left").bounds), true);
  assert.equal(contains(byGroup.get("root").bounds, byGroup.get("right").bounds), true);
  assert.equal(overlaps(byGroup.get("left").bounds, byGroup.get("right").bounds), false);
  assert.ok(Object.values(byGroup.get("empty").bounds).every(Number.isFinite));
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("places nested container children according to declared direction, padding, and gap", () => {
  const grouped = {
    version: "semantic-neural-scene/v1",
    primitives: [
      sceneBody("a", "band", "flow"),
      sceneBody("b", "band", "flow"),
      sceneBody("c", "band", "flow"),
      sceneBody("d", "band", "flow"),
    ],
    relations: [],
    groups: [
      { id: "root", parentId: "", primitiveIds: ["a", "b", "c", "d"], direction: "horizontal", padding: 30, gap: 70 },
      { id: "left", parentId: "root", primitiveIds: ["a", "b"], direction: "vertical", padding: 20, gap: 35 },
      { id: "right", parentId: "root", primitiveIds: ["c", "d"], direction: "vertical", padding: 20, gap: 35 },
    ],
  };

  const result = layoutNeuralScene(grouped);
  const bodyById = new Map(result.primitives.filter((item) => item.role === "body").map((item) => [item.id, item]));
  const groupById = new Map(result.groups.map((item) => [item.id, item]));
  assert.equal(bodyById.get("a").bounds.x, bodyById.get("b").bounds.x);
  assert.ok(bodyById.get("b").bounds.y >= bodyById.get("a").bounds.y + bodyById.get("a").bounds.h + 35);
  assert.ok(groupById.get("right").bounds.x >= groupById.get("left").bounds.x + groupById.get("left").bounds.w + 70);
  assert.equal(groupById.get("left").bounds.x - groupById.get("root").bounds.x, 30);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("sizes the page to include container padding and bounds", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [sceneBody("only", "band", "flow")],
    relations: [],
    groups: [{ id: "frame", primitiveIds: ["only"], direction: "horizontal", padding: 120, gap: 32 }],
  });
  const frame = result.groups[0].bounds;

  assert.ok(frame.x + frame.w <= result.page.width);
  assert.ok(frame.y + frame.h <= result.page.height);
  assert.equal(validateLaidOutScene(result).ok, true);
});

test("places grouped and ungrouped top-level bodies without overlap in data-flow order", () => {
  const result = layoutNeuralScene({
    version: "semantic-neural-scene/v1",
    primitives: [
      sceneBody("input", "band", "flow"),
      sceneBody("inside-a", "band", "flow"),
      sceneBody("inside-b", "band", "flow"),
      sceneBody("output", "band", "flow"),
    ],
    relations: [
      relation("enter", "input", "inside-a"),
      relation("internal", "inside-a", "inside-b"),
      relation("leave", "inside-b", "output"),
    ],
    groups: [{ id: "module", primitiveIds: ["inside-a", "inside-b"], direction: "vertical", padding: 24, gap: 30 }],
  });
  const bodies = result.primitives.filter((item) => item.role === "body");
  const byId = new Map(bodies.map((item) => [item.id, item.bounds]));

  assert.ok(byId.get("input").x + byId.get("input").w <= result.groups[0].bounds.x);
  assert.ok(result.groups[0].bounds.x + result.groups[0].bounds.w <= byId.get("output").x);
  for (let left = 0; left < bodies.length; left += 1) {
    for (let right = left + 1; right < bodies.length; right += 1) assert.equal(overlaps(bodies[left].bounds, bodies[right].bounds), false);
  }
  assert.equal(validateLaidOutScene(result).ok, true);
});

function corridorScene({ blockTop }) {
  const primitives = [
    sceneBody("a-top-seed", "plane", "top"),
    sceneBody("z-source", "band", "flow"),
    sceneBody("mid-1", "band", "flow"),
    sceneBody("mid-2", "band", "flow"),
    sceneBody("target", "band", "flow"),
  ];
  const relations = [
    relation("flow-1", "z-source", "mid-1"),
    relation("flow-2", "mid-1", "mid-2"),
    relation("flow-3", "mid-2", "target"),
    relation("long-route", "z-source", "target"),
  ];
  if (blockTop) {
    primitives.push(sceneBody("top-1", "plane", "top"), sceneBody("top-2", "plane", "top"));
    relations.push(relation("top-link-1", "a-top-seed", "top-1"), relation("top-link-2", "top-1", "top-2"));
  }
  return { version: "semantic-neural-scene/v1", primitives, relations, constraints: [] };
}

function sceneBody(id, form, scale) {
  return { id, role: "body", category: "operator", form, sourceNodeIds: [id], projectionId: `p-${id}`, semanticTags: [], data: { scale } };
}

function relation(id, sourcePrimitiveId, targetPrimitiveId) {
  return { id, sourcePrimitiveId, targetPrimitiveId, relationTags: ["data"], sourceEdgeIds: [id] };
}

function body(id, x, y, w, h) {
  return { id, role: "body", bounds: { x, y, w, h }, anchors: { inputs: [], outputs: [] } };
}

function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function contains(outer, inner) { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h; }
function pathIntersects(points, rect) {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a.x === b.x && a.x > rect.x && a.x < rect.x + rect.w && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.h) return true;
    if (a.y === b.y && a.y > rect.y && a.y < rect.y + rect.h && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.w) return true;
  }
  return false;
}
