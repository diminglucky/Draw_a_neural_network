import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { projectPublicationVisualPlanPreview } from "../src/publication-visual-plan-preview.js";
import { evaluatePublicationVisualPlanQa } from "../src/publication-visual-plan-qa.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { getUniversalGraphEligibility, parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { publicationVisualCorpus } from "./fixtures/publication-visual-corpus.js";
import { renderPublicationVisualPlanPreview } from "../../../publication-visual-plan-preview.js";

const updateIdentity = {
  ownerId: "corpus-owner",
  deviceId: "corpus-device",
  workflowId: "corpus-workflow",
  documentId: "corpus-document",
  pageId: "corpus-page",
  expectedRevision: 1,
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compileCase(corpusCase: (typeof publicationVisualCorpus)[number]) {
  const ugs = parseUniversalGraphSpec(corpusCase.createUgs());
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  const pvp = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
  const preview = projectPublicationVisualPlanPreview({ graph, pvp });
  const svg = renderPublicationVisualPlanPreview({
    ...preview,
    draft: { id: `draft-${corpusCase.corpusCaseId}`, revision: 1 },
  });
  return { ugs, graph, pvp, preview, svg };
}

describe("anonymous PublicationVisual SVG corpus", () => {
  it("contains eight structurally distinct anonymous cases with one candidate", () => {
    expect(publicationVisualCorpus).toHaveLength(8);
    expect(new Set(publicationVisualCorpus.map((item) => item.corpusCaseId)).size).toBe(8);
    expect(publicationVisualCorpus.filter((item) => item.expected.kind === "candidate")).toHaveLength(1);
    expect(publicationVisualCorpus.every((item) => !/(vgg|resnet|unet|transformer)/i.test(item.corpusCaseId))).toBe(true);
  });

  it.each(publicationVisualCorpus.filter((item) => item.expected.kind === "formal"))(
    "compiles formal anonymous case $corpusCaseId deterministically into a QA-passing public SVG",
    (corpusCase) => {
      const first = compileCase(corpusCase);
      const second = compileCase(corpusCase);

      expect(first.ugs.nodes.length).toBeGreaterThanOrEqual(corpusCase.expected.minimumUgsNodes);
      expect(first.graph.components.length).toBeGreaterThanOrEqual(first.ugs.nodes.length);
      expect(first.graph.sourceMappings).toHaveLength(first.graph.components.length);
      expect(first.graph.components.map((component) => component.role)).toEqual(expect.arrayContaining([...corpusCase.expected.requiredComponentRoles]));
      expect(first.pvp.identity.canonicalHash).toBe(second.pvp.identity.canonicalHash);
      expect(sha256(first.svg)).toBe(sha256(second.svg));
      expect(evaluatePublicationVisualPlanQa(first.pvp).status).toBe("passed");
      expect(first.pvp.sourceMappings).toHaveLength(first.pvp.primitives.length);
      expect(first.pvp.sourceMappings.every((mapping: any) => Array.isArray(mapping.ugsIds) && mapping.ugsIds.length > 0)).toBe(true);
      expect(first.pvp.primitives.map((primitive: any) => primitive.kind)).toEqual(expect.arrayContaining([...corpusCase.expected.requiredPrimitiveKinds]));
      expect(evaluatePublicationVisualPlanQa(first.pvp).checks).toContainEqual(expect.objectContaining({ code: "grayscale-role-collision", status: "passed" }));
      expect(first.preview).toMatchObject({ kind: "formal", exportEligible: false });
      expect(first.svg).toContain("publication-visual-plan-svg");

      const page = (first.pvp.coordinateSpace as any).page;
      const primitives = first.pvp.primitives as any[];
      expect(primitives.every((primitive) => contains(page, primitive.bounds))).toBe(true);
      expect(primitives.every((primitive, index) => primitives.slice(index + 1).every((other) => !overlap(primitive.bounds, other.bounds)))).toBe(true);
      expect(new Set(primitives.map((primitive) => `${primitive.bounds.width}x${primitive.bounds.height}`)).size).toBeGreaterThan(1);

      const moduleWidth = Math.max(0, ...primitives.filter((primitive) => primitive.kind === "ModuleFrame").map((primitive) => primitive.bounds.width));
      const markers = primitives.filter((primitive) => ["SplitMarker", "AddMarker", "ConcatMarker"].includes(primitive.kind));
      if (moduleWidth > 0 && markers.length > 0) expect(markers.every((marker) => marker.bounds.width < moduleWidth)).toBe(true);
    },
  );

  it("keeps the ambiguous anonymous case visible, candidate-only, and outside formal export paths", () => {
    const corpusCase = publicationVisualCorpus.find((item) => item.expected.kind === "candidate");
    if (!corpusCase) throw new Error("candidate corpus case is required");
    const result = compileCase(corpusCase);

    expect(getUniversalGraphEligibility(result.ugs)).toMatchObject({ preview: "candidate", export: "ineligible" });
    expect(result.graph.exportEligibility).toBe("ineligible");
    expect(result.graph.components.map((component) => component.role)).toEqual(expect.arrayContaining([...corpusCase.expected.requiredComponentRoles]));
    expect(result.pvp.eligibility.kind).toBe("candidate");
    expect(result.pvp.eligibility.qaStatus).toBe("pending");
    expect(result.preview).toMatchObject({ kind: "candidate", exportEligible: false });
    expect(result.pvp.primitives.filter((primitive: any) => primitive.kind === "CandidateCallout")).toHaveLength(1);
    expect(result.svg).toContain("CANDIDATE • REVIEW REQUIRED");
    expect(evaluatePublicationVisualPlanQa(result.pvp).status).toBe("failed");
    expect(Object.keys(result.preview.plan)).not.toEqual(expect.arrayContaining(["sourceMappings", "updateIdentity", "rendererRequirements", "nativeSupport"]));
  });
});

function overlap(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function contains(outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}
