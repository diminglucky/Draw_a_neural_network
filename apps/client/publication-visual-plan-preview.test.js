import { describe, expect, it } from "vitest";
import {
  publicationVisualPreviewSummary,
  renderPublicationVisualClarification,
  renderPublicationVisualPlanPreview,
} from "../../publication-visual-plan-preview.js";

function planResponse(kind = "formal", qaStatus = "pending") {
  const candidate = kind === "candidate";
  return {
    kind,
    exportEligible: !candidate && qaStatus === "passed",
    draft: { id: "draft-dual-stream", revision: 3 },
    pvp: {
      identity: { schemaVersion: 1, planId: "pvp:dual-stream", canonicalHash: "a".repeat(64) },
      eligibility: { kind, formalReasons: candidate ? [] : ["topology-complete"], blockingReasons: candidate ? ["topology-candidate"] : [], qaStatus },
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

function visual(kind, regionRole, geometry = { kind: "none" }, nativeSupport = "supported") {
  return { regionRole, nativeSupport, geometry };
}

function grammarResponse(kind = "formal") {
  const response = planResponse(kind, kind === "formal" ? "passed" : "pending");
  response.pvp.ports = [];
  response.pvp.connectors = [];
  response.pvp.annotations = [];
  response.pvp.primitives = [
    { primitiveId: "primitive:input", componentId: "input", kind: "InputTerminal", regionId: "region:main", bounds: { x: 40, y: 80, width: 120, height: 72 }, zIndex: 1, styleTokenIds: [], label: "Input <tensor>", visual: visual("InputTerminal", "base") },
    { primitiveId: "primitive:custom", componentId: "custom", kind: "OperatorFrame", regionId: "region:main", bounds: { x: 220, y: 80, width: 130, height: 72 }, zIndex: 1, styleTokenIds: [], label: "Operator & gate", visual: visual("OperatorFrame", "base") },
    { primitiveId: "primitive:module", componentId: "module", kind: "ModuleFrame", regionId: "region:main", bounds: { x: 390, y: 80, width: 140, height: 72 }, zIndex: 1, styleTokenIds: [], label: "Module", visual: visual("ModuleFrame", "custom_module") },
    { primitiveId: "primitive:merge", componentId: "merge", kind: "ConcatMarker", regionId: "region:main", bounds: { x: 570, y: 80, width: 72, height: 72 }, zIndex: 1, styleTokenIds: [], label: "Concat", visual: visual("ConcatMarker", "concat_fusion") },
    { primitiveId: "primitive:output", componentId: "output", kind: "OutputTerminal", regionId: "region:main", bounds: { x: 1020, y: 80, width: 120, height: 72 }, zIndex: 1, styleTokenIds: [], label: "Output", visual: visual("OutputTerminal", "base") },
    { primitiveId: "primitive:stage", componentId: "stage", kind: "TensorStage", regionId: "region:scale", bounds: { x: 40, y: 220, width: 130, height: 80 }, zIndex: 1, styleTokenIds: [], label: "Stage", visual: visual("TensorStage", "scale_transition") },
    { primitiveId: "primitive:volume", componentId: "volume", kind: "TensorVolume", regionId: "region:scale", bounds: { x: 220, y: 210, width: 160, height: 120 }, zIndex: 1, styleTokenIds: [], label: "Volume", visual: visual("TensorVolume", "scale_transition", { kind: "tensor_volume", frontFace: [{ x: 230, y: 230 }, { x: 330, y: 230 }, { x: 330, y: 310 }, { x: 230, y: 310 }], depthFace: [{ x: 260, y: 210 }, { x: 360, y: 210 }, { x: 360, y: 290 }, { x: 260, y: 290 }] }) },
    { primitiveId: "primitive:repeat", componentId: "repeat", kind: "RepeatBadge", regionId: "region:repeat", bounds: { x: 420, y: 220, width: 88, height: 44 }, zIndex: 1, styleTokenIds: [], label: "×3", visual: visual("RepeatBadge", "repeat_group") },
    { primitiveId: "primitive:split", componentId: "split", kind: "SplitMarker", regionId: "region:branch", bounds: { x: 550, y: 210, width: 72, height: 72 }, zIndex: 1, styleTokenIds: [], label: "Split", visual: visual("SplitMarker", "multi_branch") },
    { primitiveId: "primitive:add", componentId: "add", kind: "AddMarker", regionId: "region:add", bounds: { x: 660, y: 210, width: 72, height: 72 }, zIndex: 1, styleTokenIds: [], label: "Add", visual: visual("AddMarker", "add_merge") },
    { primitiveId: "primitive:tokens", componentId: "tokens", kind: "AttentionTokenStrip", regionId: "region:attention", bounds: { x: 780, y: 210, width: 210, height: 80 }, zIndex: 1, styleTokenIds: [], label: "Tokens", visual: visual("AttentionTokenStrip", "token_attention", { kind: "ordered_cells", orderedCells: [{ cellId: "cell:0", order: 0, bounds: { x: 790, y: 225, width: 45, height: 48 } }, { cellId: "cell:1", order: 1, bounds: { x: 850, y: 225, width: 45, height: 48 } }, { cellId: "cell:2", order: 2, bounds: { x: 910, y: 225, width: 45, height: 48 } }] }) },
    { primitiveId: "primitive:attention", componentId: "attention", kind: "AttentionRelation", regionId: "region:attention", bounds: { x: 1020, y: 210, width: 120, height: 80 }, zIndex: 1, styleTokenIds: [], label: "Attention", visual: visual("AttentionRelation", "token_attention") },
  ];
  if (kind === "candidate") {
    response.pvp.primitives.push({ primitiveId: "primitive:candidate", componentId: "candidate", kind: "CandidateCallout", regionId: "region:candidate", bounds: { x: 40, y: 400, width: 420, height: 90 }, zIndex: 1, styleTokenIds: [], label: "Review <uncertain>", visual: visual("CandidateCallout", "candidate_feedback", { kind: "none" }, "restricted") });
  }
  return response;
}

function publicPreview(raw) {
  const { pvp, ...response } = raw;
  const { lineage, sourceMappings, rendererRequirements, updateIdentity, ...plan } = pvp;
  plan.primitives = plan.primitives.map((primitive) => {
    if (!primitive.visual) return primitive;
    const { nativeSupport, ...visual } = primitive.visual;
    return { ...primitive, visual };
  });
  return {
    schemaVersion: 1,
    ...response,
    plan,
    graph: {
      version: 1,
      graphId: "dual-stream",
      detail: "architecture",
      exportEligibility: raw.kind === "candidate" ? "ineligible" : "eligible",
      components: [],
      relations: [],
      semanticRegions: [],
      layoutOrder: [],
    },
  };
}

function publicGrammarResponse(kind = "formal") {
  return publicPreview(grammarResponse(kind));
}

describe("PublicationVisualPlan browser preview", () => {
  it("accepts only the server-projected public preview and rejects a raw internal PVP", () => {
    const publicPreview = publicGrammarResponse();

    expect(renderPublicationVisualPlanPreview(publicPreview)).toContain("publication-visual-plan-svg");
    expect(() => renderPublicationVisualPlanPreview(grammarResponse())).toThrow(/public|preview|fields/i);
  });

  it("fails closed when public visual geometry cannot produce an in-bounds readable SVG family", () => {
    const cases = [
      (preview) => { const item = preview.plan.primitives.find((primitive) => primitive.kind === "TensorStage"); item.bounds = { x: 0, y: 0, width: 1, height: 1000 }; },
      (preview) => { const item = preview.plan.primitives.find((primitive) => primitive.kind === "AttentionRelation"); item.bounds = { x: 5, y: 0, width: 20, height: 8 }; },
      (preview) => { const item = preview.plan.primitives.find((primitive) => primitive.kind === "TensorVolume"); item.visual.geometry.frontFace = Array.from({ length: 4 }, () => ({ x: 230, y: 230 })); },
      (preview) => { const item = preview.plan.primitives.find((primitive) => primitive.kind === "TensorVolume"); item.visual.geometry.depthFace = [...item.visual.geometry.frontFace.slice(2), ...item.visual.geometry.frontFace.slice(0, 2)]; },
      (preview) => { const item = preview.plan.primitives.find((primitive) => primitive.kind === "TensorVolume"); item.visual.geometry.depthFace = [...item.visual.geometry.frontFace].reverse(); },
      (preview) => { const item = preview.plan.primitives.find((primitive) => primitive.kind === "TensorVolume"); item.visual.geometry.frontFace = [{ x: 230, y: 230 }, { x: 280, y: 230 }, { x: 330, y: 230 }, { x: 230, y: 310 }]; },
      (preview) => { const item = preview.plan.primitives.find((primitive) => primitive.kind === "AttentionTokenStrip"); item.visual.geometry.orderedCells[1].bounds = { ...item.visual.geometry.orderedCells[0].bounds }; },
    ];

    for (const mutate of cases) {
      const preview = publicGrammarResponse();
      mutate(preview);
      expect(() => renderPublicationVisualPlanPreview(preview)).toThrow(/geometry|bounds|visual|tensor|token|attention|stage/i);
    }
  });

  it("fails closed when public plan and graph eligibility disagree", () => {
    const contradictoryCandidate = publicGrammarResponse("candidate");
    contradictoryCandidate.graph.exportEligibility = "eligible";
    const contradictoryFormal = publicGrammarResponse("formal");
    contradictoryFormal.graph.exportEligibility = "ineligible";

    expect(() => renderPublicationVisualPlanPreview(contradictoryCandidate)).toThrow(/eligibility|candidate|graph/i);
    expect(() => renderPublicationVisualPlanPreview(contradictoryFormal)).toThrow(/eligibility|formal|graph/i);
  });

  it("renders a formal QA-pending PVP without advertising export", () => {
    const response = publicPreview(planResponse("formal", "pending"));

    expect(renderPublicationVisualPlanPreview(response)).toContain("publication-visual-plan-svg");
    expect(publicationVisualPreviewSummary(response)).toMatchObject({ kind: "formal", exportEligible: false });
  });

  it("renders PVP page geometry, generic primitives, stored routes, and escaped text", () => {
    const svg = renderPublicationVisualPlanPreview(publicPreview(planResponse()));

    expect(svg).toMatch(/<svg class="publication-visual-plan-svg(?:\s|")/);
    expect(svg).toContain('viewBox="0 0 1200 600"');
    expect(svg).toContain('data-pvp-primitive="primitive:custom"');
    expect(svg).toContain("publication-visual-plan-primitive--custom-operator");
    expect(svg).toContain('d="M 210 290 L 300 290 L 300 170 L 410 170"');
    expect(svg).toContain("Input &lt;tensor&gt;");
    expect(svg).toContain("Unseen &amp; Operator");
    expect(svg).toContain("No source is rendered");
  });

  it("renders every public visual grammar family with deterministic, kind-specific SVG", () => {
    const response = publicGrammarResponse();
    const first = renderPublicationVisualPlanPreview(response);
    const second = renderPublicationVisualPlanPreview(response);

    expect(first).toBe(second);
    expect(first).toContain(`data-pvp-plan="pvp:dual-stream"`);
    expect(first).toContain(`data-pvp-hash="${"a".repeat(64)}"`);
    expect(first).toContain('class="publication-visual-plan-tensor-volume-front"');
    expect(first).toContain('class="publication-visual-plan-tensor-volume-depth"');
    expect(first).toContain('class="publication-visual-plan-merge-symbol"');
    expect(first).toContain(">+</text>");
    expect(first).toContain(">∥</text>");
    expect(first).toContain('class="publication-visual-plan-repeat-badge"');
    expect(first).toContain('aria-label="Token 1 of 3"');
    expect(first).toContain('aria-label="Token 2 of 3"');
    expect(first).toContain('aria-label="Token 3 of 3"');
    expect(first).toContain('class="publication-visual-plan-attention-relation"');
    expect(first).toContain("Input &lt;tensor&gt;");
    expect(first).toContain("Operator &amp; gate");
    expect(first).not.toMatch(/sourceMappings|evidenceIds|worker|visio|nativeSupport|exportEligible/i);
    expect(first).not.toMatch(/data-pvp-(?:connector|annotation|geometry|merge|repeat-badge|token-cell|token-order|attention-relation)/);
  });

  it("renders candidate grammar with a visible watermark and no export or native controls", () => {
    const svg = renderPublicationVisualPlanPreview(publicGrammarResponse("candidate"));

    expect(svg).toContain('class="publication-visual-plan-candidate"');
    expect(svg).toContain("CANDIDATE • REVIEW REQUIRED");
    expect(svg).toContain("Review &lt;uncertain&gt;");
    expect(svg).not.toMatch(/export|snapshot|visio|worker|native/i);
  });

  it("projects stored Profile style tokens without inferring new topology or geometry", () => {
    const raw = planResponse();
    raw.pvp.styleTokens = {
      tokenSetVersion: "pvp-style-1",
      tokens: [
        { tokenId: "profile:test:primitive", values: { stroke: "#1d4ed8", fill: "#eff6ff", strokeWidth: "3" } },
        { tokenId: "profile:test:connector", values: { stroke: "#2563eb", strokeWidth: "3" } },
      ],
    };
    raw.pvp.primitives[1].styleTokenIds = ["profile:test:primitive"];
    raw.pvp.connectors[0].styleTokenIds = ["profile:test:connector"];
    const response = publicPreview(raw);

    const svg = renderPublicationVisualPlanPreview(response);

    expect(svg).toContain('data-pvp-primitive="primitive:custom"');
    expect(svg).toContain('stroke="#1d4ed8"');
    expect(svg).toContain('fill="#eff6ff"');
    expect(svg).toContain('class="publication-visual-plan-connector"');
    expect(svg).toContain('stroke="#2563eb"');
    expect(svg).toContain('stroke-width="3"');
  });

  it("makes candidate state visible and never advertises export", () => {
    const response = publicPreview(planResponse("candidate"));
    const svg = renderPublicationVisualPlanPreview(response);

    expect(svg).toContain("publication-visual-plan-svg--candidate");
    expect(svg).toContain("Candidate preview");
    expect(publicationVisualPreviewSummary(response)).toEqual({ kind: "candidate", exportEligible: false, draftId: "draft-dual-stream", revision: 3, planId: "pvp:dual-stream", primitiveCount: 4, connectorCount: 4 });
    expect(svg).not.toMatch(/export|snapshot|visio/i);
  });

  it("renders clarification without constructing an SVG preview", () => {
    const clarification = {
      schemaVersion: 1,
      kind: "clarification",
      draft: { id: "draft-question", revision: 2 },
      question: { id: "branch-direction", question: "Which direction is the branch?", candidateValues: ["forward", "reverse"] },
      affectedRegionIds: [],
    };

    expect(renderPublicationVisualClarification(clarification)).toContain("Which direction is the branch?");
    expect(renderPublicationVisualClarification(clarification)).not.toContain("<svg");
    expect(() => renderPublicationVisualPlanPreview(clarification)).toThrow(/clarification/i);
  });

  it.each([
    ["unsupported primitive", (response) => { response.plan.primitives[0].kind = "UnsupportedPrimitive"; }],
    ["non-integer bounds", (response) => { response.plan.primitives[0].bounds.x = 80.5; }],
    ["route endpoint mismatch", (response) => { response.plan.connectors[0].route[0].x = 211; }],
    ["unsupported protocol", (response) => { response.schemaVersion = 2; }],
    ["leaked source locator", (response) => { response.locator = "C:/private/model.py"; }],
    ["leaked semantic region provenance", (response) => {
      response.graph = {
        version: 1,
        graphId: "dual-stream",
        detail: "architecture",
        exportEligibility: "eligible",
        components: [],
        relations: [],
        semanticRegions: [{
          regionId: "region:private",
          kind: "custom_module",
          label: "Private region",
          state: "formal",
          sourceNodeIds: ["internal-node"],
          sourceEdgeIds: ["internal-edge"],
          sourceGroupIds: [],
          evidenceIds: ["internal-evidence"],
        }],
        layoutOrder: [],
      };
    }],
  ])("fails closed for %s", (_name, mutate) => {
    const response = publicPreview(planResponse());
    mutate(response);
    expect(() => renderPublicationVisualPlanPreview(response)).toThrow();
  });
});
