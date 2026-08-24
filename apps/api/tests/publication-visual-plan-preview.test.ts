import { describe, expect, it } from "vitest";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { createPublicationVisualPlan } from "../src/publication-visual-plan.js";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { projectPublicationVisualPlanPreview } from "../src/publication-visual-plan-preview.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs, unknownHybridSemanticRegionsCandidateUgs, unknownHybridSemanticRegionsUgs } from "./fixtures/universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };

function compiledPlan(kind: "formal" | "candidate") {
  const source = unknownDualStreamFusionUgs();
  if (kind === "candidate") source.edges[1] = { ...source.edges[1], relation: "candidate", knowledge: "candidate" };
  const ugs = parseUniversalGraphSpec(source);
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  const pvp = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
  return { graph, pvp };
}

function compiledSemanticPlan(kind: "formal" | "candidate") {
  const source = kind === "formal" ? unknownHybridSemanticRegionsUgs() : unknownHybridSemanticRegionsCandidateUgs();
  const ugs = parseUniversalGraphSpec(source);
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  const pvp = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
  return { graph, pvp };
}

function withCandidateVisual(
  pvp: unknown,
  options: { kind?: "CandidateCallout" | "TensorStage"; nativeSupport?: "supported" | "restricted"; eligibilityKind?: "formal" | "candidate"; qaStatus?: "pending" | "passed" } = {},
) {
  const draft = structuredClone(pvp) as any;
  draft.primitives[0] = {
    ...draft.primitives[0],
    kind: options.kind ?? "CandidateCallout",
    visual: {
      regionRole: "candidate_feedback",
      nativeSupport: options.nativeSupport ?? "restricted",
      geometry: { kind: "none" },
    },
  };
  draft.eligibility = options.eligibilityKind === "candidate"
    ? { kind: "candidate", formalReasons: [], blockingReasons: ["topology-candidate"], qaStatus: options.qaStatus ?? "pending" }
    : { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: options.qaStatus ?? "pending" };
  return draft;
}

function withLegacyCandidateRegion(
  pvp: unknown,
  options: { kind?: "formal" | "candidate"; qaStatus?: "pending" | "passed" } = {},
) {
  const draft = structuredClone(pvp) as any;
  draft.primitives[0] = {
    ...draft.primitives[0],
    kind: "CandidateRegion",
  };
  delete draft.primitives[0].visual;
  draft.eligibility = options.kind === "candidate"
    ? { kind: "candidate", formalReasons: [], blockingReasons: ["topology-candidate"], qaStatus: options.qaStatus ?? "pending" }
    : { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: options.qaStatus ?? "passed" };
  return draft;
}

describe("projectPublicationVisualPlanPreview", () => {
  it("rejects a legacy CandidateRegion that forges formal passed eligibility", () => {
    const { pvp } = compiledPlan("formal");

    expect(() => createPublicationVisualPlan(withLegacyCandidateRegion(pvp))).toThrow(/candidate|eligibility|PVP/i);
  });

  it("projects a legacy CandidateRegion as candidate and never export-eligible", () => {
    const { graph, pvp } = compiledPlan("candidate");
    const candidatePvp = createPublicationVisualPlan(withLegacyCandidateRegion(pvp, { kind: "candidate" }));

    expect(projectPublicationVisualPlanPreview({ graph, pvp: candidatePvp })).toMatchObject({ kind: "candidate", exportEligible: false });
  });

  it.each([
    ["legacy CandidateRegion", "CandidateRegion" as const],
    ["CandidateCallout", "CandidateCallout" as const],
    ["candidate_feedback role", "TensorStage" as const],
  ])("rejects a formal PVP containing every candidate visual semantic through %s", (_name, kind) => {
    const { pvp } = compiledSemanticPlan("formal");

    const candidate = kind === "CandidateRegion"
      ? withLegacyCandidateRegion(pvp)
      : withCandidateVisual(pvp, { kind });
    expect(() => createPublicationVisualPlan(candidate)).toThrow(/candidate|eligibility|PVP/i);
  });

  it("rejects a CandidateCallout whose native support is not restricted", () => {
    const { pvp } = compiledSemanticPlan("formal");

    expect(() => createPublicationVisualPlan(withCandidateVisual(pvp, { nativeSupport: "supported" }))).toThrow(/candidate|native|PVP/i);
  });

  it("rejects candidate_feedback on a non-CandidateCallout with supported native support", () => {
    const { pvp } = compiledSemanticPlan("formal");

    expect(() => createPublicationVisualPlan(withCandidateVisual(pvp, { kind: "TensorStage", eligibilityKind: "candidate", nativeSupport: "supported" }))).toThrow(/candidate|native|PVP/i);
  });

  it("rejects candidate visual semantics that claim a passed QA state", () => {
    const { pvp } = compiledSemanticPlan("formal");

    expect(() => createPublicationVisualPlan(withCandidateVisual(pvp, { qaStatus: "passed" }))).toThrow(/candidate|QA|eligibility|PVP/i);
  });

  it("never projects forged candidate visual semantics as export-eligible", () => {
    const { graph, pvp } = compiledSemanticPlan("formal");

    expect(() => projectPublicationVisualPlanPreview({
      graph,
      pvp: createPublicationVisualPlan(withCandidateVisual(pvp, { qaStatus: "passed" })),
    })).toThrow(/candidate|eligibility|PVP|preview/i);
  });

  it("projects a parsed, QA-passed formal PVP and GPG through nested allowlists without mutating either input", () => {
    const { graph, pvp } = compiledPlan("formal");
    const planDraft = structuredClone(pvp) as any;
    planDraft.eligibility.qaStatus = "passed";
    const inputPvp = createPublicationVisualPlan(planDraft);
    const inputGraph = structuredClone(graph);
    const originalPvp = structuredClone(inputPvp);
    const originalGraph = structuredClone(inputGraph);

    const preview = projectPublicationVisualPlanPreview({ graph: inputGraph, pvp: inputPvp });

    expect(preview).toMatchObject({ schemaVersion: 1, kind: "formal", exportEligible: true });
    expect(Object.keys(preview.plan).sort()).toEqual([
      "annotations", "connectors", "coordinateSpace", "eligibility", "identity", "legend", "ports", "primitiveGroups", "primitives", "profileApplications", "regions", "styleTokens",
    ]);
    expect(Object.keys(preview.graph).sort()).toEqual([
      "components", "detail", "exportEligibility", "graphId", "layoutOrder", "relations", "semanticRegions", "version",
    ]);
    expect(JSON.stringify(preview)).not.toContain("prompt text");
    expect(JSON.stringify(preview)).not.toContain("workerControl");
    expect(preview).not.toHaveProperty("updateIdentity");
    expect(preview).not.toHaveProperty("sourceMappings");
    expect(preview.graph.components[0]).not.toHaveProperty("sourceNodeIds");
    expect(preview.graph.components[0]).not.toHaveProperty("evidenceIds");
    expect(preview.graph.relations[0]).not.toHaveProperty("sourceEdgeIds");
    expect(preview.graph.relations[0]).not.toHaveProperty("evidenceIds");
    expect(preview.graph.semanticRegions.every((region) => Object.keys(region).sort().join(",") === "kind,label,regionId,state")).toBe(true);
    expect(inputPvp).toEqual(originalPvp);
    expect(inputGraph).toEqual(originalGraph);

    (preview.plan.primitives[0] as any).label = "changed only in preview";
    preview.graph.components[0]!.label = "changed only in preview";
    expect((inputPvp.primitives[0] as any).label).not.toBe("changed only in preview");
    expect(inputGraph.components[0]!.label).not.toBe("changed only in preview");
  });

  it("keeps candidate component and connector preview data bounded and always export-ineligible", () => {
    const { graph, pvp } = compiledPlan("candidate");

    const preview = projectPublicationVisualPlanPreview({ graph, pvp });

    expect(preview).toMatchObject({ schemaVersion: 1, kind: "candidate", exportEligible: false });
    expect(preview.plan.primitives).toHaveLength((pvp.primitives as unknown[]).length);
    expect(preview.plan.connectors).toHaveLength((pvp.connectors as unknown[]).length);
    expect(preview.graph.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentId: expect.any(String), role: expect.any(String), label: expect.any(String), layoutOrder: expect.any(Object) }),
    ]));
    expect(preview.graph.components.every((component) => !Object.hasOwn(component, "sourceNodeIds") && !Object.hasOwn(component, "sourceEdgeIds") && !Object.hasOwn(component, "evidenceIds"))).toBe(true);
    expect(preview.graph.relations.every((relation) => !Object.hasOwn(relation, "sourceEdgeIds") && !Object.hasOwn(relation, "evidenceIds"))).toBe(true);
  });

  it("projects semantic regions to safe public summaries and preserves candidate ineligibility", () => {
    const { graph, pvp } = compiledSemanticPlan("candidate");
    const preview = projectPublicationVisualPlanPreview({ graph, pvp });

    expect(preview).toMatchObject({ kind: "candidate", exportEligible: false });
    expect(preview.graph.semanticRegions).toEqual([
      expect.objectContaining({ kind: "candidate_feedback", label: "Candidate topology pending confirmation", state: "candidate" }),
    ]);
    expect(preview.graph.semanticRegions.every((region) => Object.keys(region).sort().join(",") === "kind,label,regionId,state")).toBe(true);
    expect(JSON.stringify(preview.graph.semanticRegions)).not.toMatch(/sourceNodeIds|sourceEdgeIds|sourceGroupIds|evidenceIds|worker|visio|native/i);
  });

  it("projects only approved visual grammar fields and rejects an unknown primitive kind", () => {
    const { graph, pvp } = compiledSemanticPlan("formal");
    const preview = projectPublicationVisualPlanPreview({ graph, pvp });
    const tensorVolume = preview.plan.primitives.find((primitive) => primitive.kind === "TensorVolume") as any;

    expect(tensorVolume).toMatchObject({
      visual: { regionRole: "scale_transition", geometry: { kind: "tensor_volume" } },
    });
    expect(JSON.stringify(preview.plan.primitives)).not.toMatch(/sourceNodeIds|sourceEdgeIds|evidenceIds|worker|visio/i);

    const draft = structuredClone(pvp) as any;
    draft.primitives[0].kind = "UnapprovedPrimitive";
    expect(() => createPublicationVisualPlan(draft)).toThrow(/primitive|kind|PVP/i);
  });

  it("fails closed when semantic-region input contains unknown fields or public-shape provenance arrays", () => {
    const { graph, pvp } = compiledSemanticPlan("formal");
    const publicSummary = graph.semanticRegions[0]!;
    const invalidGraphs = [
      { ...graph, semanticRegions: graph.semanticRegions.map((region) => ({ ...region, workerControl: "run" })) },
      {
        ...graph,
        semanticRegions: [{
          regionId: publicSummary.regionId,
          kind: publicSummary.kind,
          label: publicSummary.label,
          state: publicSummary.state,
          sourceNodeIds: publicSummary.sourceNodeIds,
        }],
      },
    ];

    for (const invalidGraph of invalidGraphs) {
      expect(() => projectPublicationVisualPlanPreview({ graph: invalidGraph as any, pvp })).toThrow(/semantic|graph|preview/i);
    }
  });

  it("keeps a formal pending plan non-exportable and rejects contradictory formal graph eligibility", () => {
    const { graph, pvp } = compiledPlan("formal");

    expect(projectPublicationVisualPlanPreview({ graph, pvp }).exportEligible).toBe(false);
    expect(() => projectPublicationVisualPlanPreview({ graph: { ...graph, exportEligibility: "ineligible" }, pvp })).toThrow(/eligibility|graph/i);
  });

  it("rejects a candidate plan paired with an eligible graph", () => {
    const { graph, pvp } = compiledPlan("candidate");

    expect(() => projectPublicationVisualPlanPreview({ graph: { ...graph, exportEligibility: "eligible" }, pvp })).toThrow(/eligibility|graph/i);
  });

  it("rejects unsafe retained PVP labels and text rather than copying or coercing them", () => {
    const cases: Array<[string, (draft: any) => void]> = [
      ["primitive prompt label", (draft) => { draft.primitives[0].label = { prompt: "raw prompt" }; }],
      ["primitive-group path label", (draft) => { draft.primitiveGroups = [{ groupId: "group:unsafe", regionId: "region:main", label: { path: "C:\\secret" }, zIndex: 0, primitiveIds: [], styleTokenIds: [] }]; }],
      ["annotation control text", (draft) => { draft.annotations = [{ annotationId: "annotation:unsafe", targetIds: [draft.primitives[0].primitiveId], bounds: { x: 100, y: 100, width: 100, height: 50 }, text: { workerControl: "run" }, role: "note", styleTokenIds: [] }]; }],
      ["legend object label", (draft) => { draft.legend = { entries: [{ legendId: "legend:unsafe", label: { path: "C:\\secret" }, kind: "swatch", targetIds: [], styleTokenIds: [] }], styleTokenIds: [] }; }],
      ["newline label", (draft) => { draft.primitives[0].label = "unsafe\nlabel"; }],
      ["oversized annotation text", (draft) => { draft.annotations = [{ annotationId: "annotation:long", targetIds: [draft.primitives[0].primitiveId], bounds: { x: 100, y: 100, width: 100, height: 50 }, text: "x".repeat(513), role: "note", styleTokenIds: [] }]; }],
    ];

    for (const [name, mutate] of cases) {
      const { graph, pvp } = compiledPlan("formal");
      const draft = structuredClone(pvp) as any;
      mutate(draft);
      expect(() => {
        const unsafePlan = createPublicationVisualPlan(draft);
        projectPublicationVisualPlanPreview({ graph, pvp: unsafePlan });
      }).toThrow(/PVP|display|preview|primitive/i);
    }
  });

  it("rejects unsafe style values instead of retaining arbitrary objects", () => {
    const { graph, pvp } = compiledPlan("formal");
    const draft = structuredClone(pvp) as any;
    draft.styleTokens = { tokenSetVersion: "pvp-style-1", tokens: [{ tokenId: "style:unsafe", values: { stroke: { prompt: "raw prompt" } } }] };
    const unsafePlan = createPublicationVisualPlan(draft);

    expect(() => projectPublicationVisualPlanPreview({ graph, pvp: unsafePlan })).toThrow(/style|PVP|preview/i);
  });

  it("rejects invalid graph version, path-shaped graph ID, and non-string component label", () => {
    const { graph, pvp } = compiledPlan("formal");
    const invalidGraphs = [
      { ...graph, version: 2 },
      { ...graph, graphId: "C:\\private\\model.py" },
      { ...graph, components: [{ ...graph.components[0], label: { prompt: "raw prompt" } }, ...graph.components.slice(1)] },
    ];

    for (const invalidGraph of invalidGraphs) {
      expect(() => projectPublicationVisualPlanPreview({ graph: invalidGraph as any, pvp })).toThrow(/graph|component|preview/i);
    }
  });

  it("detaches every retained nested result value", () => {
    const { graph, pvp } = compiledPlan("formal");
    const draft = structuredClone(pvp) as any;
    draft.styleTokens = { tokenSetVersion: "pvp-style-1", tokens: [{ tokenId: "style:one", values: { stroke: "#000000", fill: "#ffffff", strokeWidth: "3" } }] };
    const inputPvp = createPublicationVisualPlan(draft);
    const inputGraph = structuredClone(graph);

    const preview = projectPublicationVisualPlanPreview({ graph: inputGraph, pvp: inputPvp });
    const styleToken = ((preview.plan.styleTokens.tokens as any[])[0]);
    styleToken.values.stroke = "#ff0000";
    (preview.plan.primitives[0] as any).bounds.x = 999;
    preview.graph.components[0]!.layoutOrder.rank = 999;

    expect((((inputPvp.styleTokens as any).tokens[0]).values.stroke)).toBe("#000000");
    expect(((inputPvp.primitives[0] as any).bounds.x)).not.toBe(999);
    expect(inputGraph.components[0]!.layoutOrder.rank).not.toBe(999);
  });
});
