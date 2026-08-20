import { describe, expect, it } from "vitest";
import { createPublicationVisualPlan } from "../src/publication-visual-plan.js";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { evaluatePublicationVisualPlanQa } from "../src/publication-visual-plan-qa.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs } from "./fixtures/universal-graph-spec.js";

function pendingPlan() {
  const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  return compilePublicationVisualPlan({
    ugs,
    graph,
    updateIdentity: { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 },
  });
}

function changed(mutator: (draft: any) => void) {
  const draft = structuredClone(pendingPlan()) as any;
  mutator(draft);
  return createPublicationVisualPlan(draft);
}

function reanchorRoutes(draft: any) {
  const primitives = new Map<string, any>(draft.primitives.map((primitive: any) => [primitive.primitiveId, primitive]));
  const ports = new Map<string, any>(draft.ports.map((port: any) => [port.portId, port]));
  const anchor = (port: any) => {
    const bounds = primitives.get(port.primitiveId).bounds;
    const offset = port.anchor.offset / 1000;
    if (port.anchor.side === "left") return { x: bounds.x, y: bounds.y + bounds.height * offset };
    if (port.anchor.side === "right") return { x: bounds.x + bounds.width, y: bounds.y + bounds.height * offset };
    if (port.anchor.side === "top") return { x: bounds.x + bounds.width * offset, y: bounds.y };
    return { x: bounds.x + bounds.width * offset, y: bounds.y + bounds.height };
  };
  for (const connector of draft.connectors) {
    const source = anchor(ports.get(connector.sourcePortId));
    const target = anchor(ports.get(connector.targetPortId));
    const middleX = Math.floor((source.x + target.x) / 2);
    connector.route = [source, { x: middleX, y: source.y }, { x: middleX, y: target.y }, target];
  }
}

describe("PublicationVisualPlan QA", () => {
  it("records a stable passing audit for a formal PVP without mutating its pending eligibility", () => {
    const plan = pendingPlan();
    const result = evaluatePublicationVisualPlanQa(plan);

    expect(result).toMatchObject({
      qaVersion: "pvp-qa-1",
      status: "passed",
      planHash: plan.identity.canonicalHash,
    });
    expect(result.checks.every((check) => check.status === "passed")).toBe(true);
    expect(plan.eligibility.qaStatus).toBe("pending");
  });

  it("fails a candidate PVP instead of granting it formal QA", () => {
    const candidate = changed((draft) => {
      draft.eligibility = { kind: "candidate", formalReasons: [], blockingReasons: ["topology-candidate"], qaStatus: "pending" };
    });

    const result = evaluatePublicationVisualPlanQa(candidate);

    expect(result.status).toBe("failed");
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "eligibility-formal", status: "failed" }));
  });

  it("fails colliding primitives even when the PVP schema itself is valid", () => {
    const plan = changed((draft) => {
      draft.primitives[1].bounds = structuredClone(draft.primitives[0].bounds);
      reanchorRoutes(draft);
    });

    const result = evaluatePublicationVisualPlanQa(plan);

    expect(result.status).toBe("failed");
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "primitive-collision", status: "failed" }));
  });

  it("fails a diagonal connector route even when its endpoints stay anchored", () => {
    const plan = changed((draft) => {
      const route = draft.connectors[0].route;
      route.splice(1, 2, { x: route[0].x + 100, y: route[0].y + 100 }, { x: route.at(-1).x - 100, y: route.at(-1).y - 100 });
    });

    const result = evaluatePublicationVisualPlanQa(plan);

    expect(result.status).toBe("failed");
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "connector-orthogonal", status: "failed" }));
  });

  it("fails source mappings with no UGS coverage", () => {
    const plan = changed((draft) => {
      draft.sourceMappings[0].ugsIds = [];
      draft.sourceMappings[0].evidenceIds = [];
    });

    const result = evaluatePublicationVisualPlanQa(plan);

    expect(result.status).toBe("failed");
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "source-mapping-coverage", status: "failed" }));
  });

  it("fails overlapping annotation bounds", () => {
    const plan = changed((draft) => {
      draft.annotations = [
        { annotationId: "annotation:a", targetIds: [draft.primitives[0].primitiveId], bounds: { x: 150, y: 150, width: 120, height: 80 }, text: "A", role: "note", styleTokenIds: [] },
        { annotationId: "annotation:b", targetIds: [draft.primitives[1].primitiveId], bounds: { x: 200, y: 190, width: 120, height: 80 }, text: "B", role: "note", styleTokenIds: [] },
      ];
    });

    const result = evaluatePublicationVisualPlanQa(plan);

    expect(result.status).toBe("failed");
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "annotation-overlap", status: "failed" }));
  });

  it("fails a style reference that is absent from the PVP token set", () => {
    const plan = changed((draft) => {
      draft.primitives[0].styleTokenIds = ["style:missing"];
    });

    const result = evaluatePublicationVisualPlanQa(plan);

    expect(result.status).toBe("failed");
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "style-token-reference", status: "failed" }));
  });
});
