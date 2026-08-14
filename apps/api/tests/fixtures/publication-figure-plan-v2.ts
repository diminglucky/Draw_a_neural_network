export function createPlanFixture() {
  return {
    version: 2,
    target: "preview",
    renderIntent: { density: "standard", printMode: "color" },
    grammar: { id: "cnn-classifier", version: 1 },
    coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: 1000, height: 600 },
    regions: [{ id: "network", label: "Network", role: "network", bounds: { x: 20, y: 20, width: 900, height: 400 } }],
    primitives: [
      { id: "input", kind: "tensor_volume", bounds: { x: 40, y: 120, width: 120, height: 180 }, semantic: { stage: 0 }, sourceDisplayId: "input-stage" },
      { id: "classifier", kind: "block_frame", bounds: { x: 760, y: 160, width: 100, height: 100 }, semantic: { stage: 1 }, sourceDisplayId: "classifier-head" },
    ],
    relations: [{ id: "flow", kind: "flow_arrow", sourcePrimitiveId: "input", targetPrimitiveId: "classifier", route: [{ x: 160, y: 210 }, { x: 760, y: 210 }], semantic: {}, sourceDisplayId: "input-stage", style: { stroke: "solid", tone: "dark", thickness: 1 } }],
    annotations: [{ id: "input-label", targetId: "input", role: "detail", text: "224 × 224 × 3", bounds: { x: 40, y: 320, width: 120, height: 20 }, fontSizePt: 9 }],
    sourceMappings: [
      { mappingId: "map-input", displayId: "input-stage", networkNodeIds: ["input"], tensorIds: ["input-tensor"], edgeIds: [], evidenceIds: ["fact-input"] },
      { mappingId: "map-classifier", displayId: "classifier-head", networkNodeIds: ["classifier"], tensorIds: ["class-tensor"], edgeIds: [], evidenceIds: ["fact-output"] },
    ],
    qaContract: { minFontSizePt: 7, printMode: "color", maxPrimitiveCount: 600 },
  };
}
