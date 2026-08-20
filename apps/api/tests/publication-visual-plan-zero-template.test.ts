import { describe, expect, it } from "vitest";
import { renderPublicationVisualPlanPreview } from "../../../publication-visual-plan-preview.js";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { evaluatePublicationVisualPlanQa } from "../src/publication-visual-plan-qa.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import {
  unknownCustomSpatialBackboneUgs,
  unknownDualTowerCrossModalFusionUgs,
  unknownMultiScaleEncoderDecoderUgs,
  unknownResidualMultiBranchUgs,
} from "./fixtures/universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };
const fixtureFamilies = [
  ["custom spatial backbone", unknownCustomSpatialBackboneUgs],
  ["residual multi-branch network", unknownResidualMultiBranchUgs],
  ["multi-scale encoder-decoder", unknownMultiScaleEncoderDecoderUgs],
  ["dual-tower cross-modal fusion", unknownDualTowerCrossModalFusionUgs],
] as const;

function compile(creator: () => any) {
  const ugs = parseUniversalGraphSpec(creator());
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  return compilePublicationVisualPlan({ ugs, graph, updateIdentity });
}

function pointForPort(plan: any, portId: string) {
  const port = plan.ports.find((item: any) => item.portId === portId);
  const primitive = plan.primitives.find((item: any) => item.primitiveId === port.primitiveId);
  const { x, y, width, height } = primitive.bounds;
  if (port.anchor.side === "left") return { x, y: y + height * port.anchor.offset / 1000 };
  if (port.anchor.side === "right") return { x: x + width, y: y + height * port.anchor.offset / 1000 };
  if (port.anchor.side === "top") return { x: x + width * port.anchor.offset / 1000, y };
  return { x: x + width * port.anchor.offset / 1000, y: y + height };
}

function assertPvpGeometry(plan: any) {
  const page = plan.coordinateSpace.page;
  for (const primitive of plan.primitives) {
    for (const value of Object.values(primitive.bounds)) expect(Number.isSafeInteger(value)).toBe(true);
    expect(primitive.bounds.x).toBeGreaterThanOrEqual(0);
    expect(primitive.bounds.y).toBeGreaterThanOrEqual(0);
    expect(primitive.bounds.x + primitive.bounds.width).toBeLessThanOrEqual(page.width);
    expect(primitive.bounds.y + primitive.bounds.height).toBeLessThanOrEqual(page.height);
  }
  for (const connector of plan.connectors) {
    expect(connector.route[0]).toEqual(pointForPort(plan, connector.sourcePortId));
    expect(connector.route.at(-1)).toEqual(pointForPort(plan, connector.targetPortId));
    for (let index = 1; index < connector.route.length; index += 1) {
      const previous = connector.route[index - 1];
      const current = connector.route[index];
      expect(current.x === previous.x || current.y === previous.y).toBe(true);
      expect(Number.isSafeInteger(current.x) && Number.isSafeInteger(current.y)).toBe(true);
    }
  }
}

describe("zero-template universal PVP fixture matrix", () => {
  it.each(fixtureFamilies)("renders %s through the same deterministic UGS to SVG path", (_name, creator) => {
    const first = compile(creator);
    const second = compile(creator);
    const qa = evaluatePublicationVisualPlanQa(first);
    const svg = renderPublicationVisualPlanPreview({
      kind: "formal",
      exportEligible: false,
      draft: { id: "draft-zero-template", revision: 1 },
      pvp: first,
    });

    expect(first.identity.canonicalHash).toBe(second.identity.canonicalHash);
    expect(first.eligibility).toMatchObject({ kind: "formal", qaStatus: "pending" });
    expect(qa).toMatchObject({ status: "passed", planHash: first.identity.canonicalHash });
    expect(first.sourceMappings).toHaveLength(first.primitives.length);
    assertPvpGeometry(first);
    const coordinateSpace = first.coordinateSpace as any;
    expect(svg).toContain(`viewBox="0 0 ${coordinateSpace.page.width} ${coordinateSpace.page.height}"`);
    for (const primitive of first.primitives as any[]) expect(svg).toContain(`data-pvp-primitive="${primitive.primitiveId}"`);
    expect(svg).not.toMatch(/vgg|resnet|unet|transformer/i);
  });

  it.each(fixtureFamilies)("keeps ambiguous %s topology preview-only without a QA pass", (_name, creator) => {
    const source = creator();
    source.edges[0] = { ...source.edges[0], relation: "candidate", knowledge: "candidate" };
    const plan = compile(() => source);
    const qa = evaluatePublicationVisualPlanQa(plan);
    const svg = renderPublicationVisualPlanPreview({
      kind: "candidate",
      exportEligible: false,
      draft: { id: "draft-zero-template-candidate", revision: 1 },
      pvp: plan,
    });

    expect(plan.eligibility.kind).toBe("candidate");
    expect(qa.status).toBe("failed");
    expect(svg).toContain("Candidate preview");
  });
});
