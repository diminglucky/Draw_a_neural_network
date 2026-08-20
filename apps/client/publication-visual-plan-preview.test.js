import { describe, expect, it } from "vitest";
import {
  publicationVisualPreviewSummary,
  renderPublicationVisualClarification,
  renderPublicationVisualPlanPreview,
} from "../../publication-visual-plan-preview.js";

function planResponse(kind = "formal") {
  const candidate = kind === "candidate";
  return {
    kind,
    exportEligible: !candidate,
    draft: { id: "draft-dual-stream", revision: 3 },
    pvp: {
      identity: { schemaVersion: 1, planId: "pvp:dual-stream", canonicalHash: "a".repeat(64) },
      eligibility: { kind, formalReasons: candidate ? [] : ["topology-complete"], blockingReasons: candidate ? ["topology-candidate"] : [], qaStatus: "pending" },
      lineage: {},
      coordinateSpace: {
        id: "pvp-du-1",
        origin: "top_left",
        axes: "x_right_y_down",
        unit: "du",
        duPerInch: 1000,
        page: { x: 0, y: 0, width: 1200, height: 600 },
        safeMargins: { x: 50, y: 50, width: 1100, height: 500 },
      },
      regions: [],
      primitiveGroups: [],
      primitives: [
        { primitiveId: "primitive:input", componentId: "input", kind: "Input", regionId: "region:main", bounds: { x: 80, y: 240, width: 130, height: 100 }, zIndex: 1, styleTokenIds: [], label: "Input <tensor>" },
        { primitiveId: "primitive:custom", componentId: "custom", kind: "CustomOperator", regionId: "region:main", bounds: { x: 410, y: 120, width: 180, height: 100 }, zIndex: 1, styleTokenIds: [], label: "Unseen & Operator" },
        { primitiveId: "primitive:module", componentId: "module", kind: "CustomModule", regionId: "region:main", bounds: { x: 410, y: 370, width: 180, height: 100 }, zIndex: 1, styleTokenIds: [], label: "Auxiliary path" },
        { primitiveId: "primitive:merge", componentId: "merge", kind: "MergeConcat", regionId: "region:main", bounds: { x: 850, y: 245, width: 180, height: 100 }, zIndex: 1, styleTokenIds: [], label: "Concat" },
      ],
      ports: [
        { portId: "port:custom-in", primitiveId: "primitive:custom", role: "input", anchor: { side: "left", offset: 500 }, order: 0, semanticPortId: "custom:in" },
        { portId: "port:custom-out", primitiveId: "primitive:custom", role: "output", anchor: { side: "right", offset: 500 }, order: 0, semanticPortId: "custom:out" },
        { portId: "port:input-custom", primitiveId: "primitive:input", role: "output", anchor: { side: "right", offset: 500 }, order: 0, semanticPortId: "input:custom" },
        { portId: "port:input-module", primitiveId: "primitive:input", role: "output", anchor: { side: "right", offset: 500 }, order: 1, semanticPortId: "input:module" },
        { portId: "port:merge-custom", primitiveId: "primitive:merge", role: "input", anchor: { side: "left", offset: 250 }, order: 0, semanticPortId: "merge:custom" },
        { portId: "port:merge-module", primitiveId: "primitive:merge", role: "input", anchor: { side: "left", offset: 750 }, order: 1, semanticPortId: "merge:module" },
        { portId: "port:module-in", primitiveId: "primitive:module", role: "input", anchor: { side: "left", offset: 500 }, order: 0, semanticPortId: "module:in" },
        { portId: "port:module-out", primitiveId: "primitive:module", role: "output", anchor: { side: "right", offset: 500 }, order: 0, semanticPortId: "module:out" },
      ],
      connectors: [
        { connectorId: "connector:input-custom", sourcePortId: "port:input-custom", targetPortId: "port:custom-in", relation: "data", route: [{ x: 210, y: 290 }, { x: 300, y: 290 }, { x: 300, y: 170 }, { x: 410, y: 170 }], styleTokenIds: [], zIndex: 0 },
        { connectorId: "connector:input-module", sourcePortId: "port:input-module", targetPortId: "port:module-in", relation: "data", route: [{ x: 210, y: 290 }, { x: 300, y: 290 }, { x: 300, y: 420 }, { x: 410, y: 420 }], styleTokenIds: [], zIndex: 0 },
        { connectorId: "connector:merge-custom", sourcePortId: "port:custom-out", targetPortId: "port:merge-custom", relation: "data", route: [{ x: 590, y: 170 }, { x: 700, y: 170 }, { x: 700, y: 270 }, { x: 850, y: 270 }], styleTokenIds: [], zIndex: 0 },
        { connectorId: "connector:merge-module", sourcePortId: "port:module-out", targetPortId: "port:merge-module", relation: "data", route: [{ x: 590, y: 420 }, { x: 700, y: 420 }, { x: 700, y: 320 }, { x: 850, y: 320 }], styleTokenIds: [], zIndex: 0 },
      ],
      annotations: [{ annotationId: "annotation:overview", targetIds: ["primitive:merge"], bounds: { x: 850, y: 370, width: 180, height: 30 }, text: "No source is rendered", role: "detail", styleTokenIds: [] }],
      legend: {},
      styleTokens: {},
      profileApplications: [],
      sourceMappings: [],
      rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] },
      updateIdentity: {},
    },
  };
}

describe("PublicationVisualPlan browser preview", () => {
  it("renders PVP page geometry, generic primitives, stored routes, and escaped text", () => {
    const svg = renderPublicationVisualPlanPreview(planResponse());

    expect(svg).toMatch(/<svg class="publication-visual-plan-svg(?:\s|")/);
    expect(svg).toContain('viewBox="0 0 1200 600"');
    expect(svg).toContain('data-pvp-primitive="primitive:custom"');
    expect(svg).toContain("publication-visual-plan-primitive--custom-operator");
    expect(svg).toContain('d="M 210 290 L 300 290 L 300 170 L 410 170"');
    expect(svg).toContain("Input &lt;tensor&gt;");
    expect(svg).toContain("Unseen &amp; Operator");
    expect(svg).toContain("No source is rendered");
  });

  it("makes candidate state visible and never advertises export", () => {
    const response = planResponse("candidate");
    const svg = renderPublicationVisualPlanPreview(response);

    expect(svg).toContain("publication-visual-plan-svg--candidate");
    expect(svg).toContain("Candidate preview");
    expect(publicationVisualPreviewSummary(response)).toEqual({ kind: "candidate", exportEligible: false, draftId: "draft-dual-stream", revision: 3, planId: "pvp:dual-stream", primitiveCount: 4, connectorCount: 4 });
    expect(svg).not.toMatch(/export|snapshot|visio/i);
  });

  it("renders clarification without constructing an SVG preview", () => {
    const clarification = {
      kind: "clarification",
      draft: { id: "draft-question", revision: 2 },
      question: { id: "branch-direction", question: "Which direction is the branch?", candidateValues: ["forward", "reverse"] },
      affectedRegionIds: [],
      evidenceIds: [],
    };

    expect(renderPublicationVisualClarification(clarification)).toContain("Which direction is the branch?");
    expect(renderPublicationVisualClarification(clarification)).not.toContain("<svg");
    expect(() => renderPublicationVisualPlanPreview(clarification)).toThrow(/clarification/i);
  });

  it.each([
    ["unsupported primitive", (response) => { response.pvp.primitives[0].kind = "TensorVolume"; }],
    ["non-integer bounds", (response) => { response.pvp.primitives[0].bounds.x = 80.5; }],
    ["route endpoint mismatch", (response) => { response.pvp.connectors[0].route[0].x = 211; }],
    ["unsupported protocol", (response) => { response.pvp.rendererRequirements.protocolVersion = "pvp-renderer-2"; }],
    ["leaked source locator", (response) => { response.locator = "C:/private/model.py"; }],
  ])("fails closed for %s", (_name, mutate) => {
    const response = planResponse();
    mutate(response);
    expect(() => renderPublicationVisualPlanPreview(response)).toThrow();
  });
});
