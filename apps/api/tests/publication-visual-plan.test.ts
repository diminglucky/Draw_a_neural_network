import { describe, expect, it } from "vitest";
import { createPublicationVisualPlan, parsePublicationVisualPlan } from "../src/publication-visual-plan.js";

const digest = (letter: string) => letter.repeat(64);

function formalDraft(): Record<string, unknown> {
  return {
    identity: { schemaVersion: 1, planId: "pvp:graph-1:architecture" },
    eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "pending" },
    lineage: { ugsHash: digest("a"), gpgHash: digest("b"), sourceHashes: [digest("c")], composerHash: digest("d"), profileSetHash: digest("e") },
    coordinateSpace: {
      id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000,
      page: { x: 0, y: 0, width: 4000, height: 2000 }, safeMargins: { x: 100, y: 100, width: 3800, height: 1800 },
    },
    regions: [{ regionId: "region:main", bounds: { x: 100, y: 100, width: 3600, height: 1200 }, role: "main", zIndex: 0 }],
    primitiveGroups: [],
    primitives: [
      { primitiveId: "primitive:input", componentId: "node:input", kind: "Input", regionId: "region:main", bounds: { x: 200, y: 400, width: 900, height: 400 }, zIndex: 1, styleTokenIds: [], label: "Input" },
      { primitiveId: "primitive:custom", componentId: "node:custom", kind: "CustomOperator", regionId: "region:main", bounds: { x: 2200, y: 400, width: 900, height: 400 }, zIndex: 1, styleTokenIds: [], label: "Spectral mixer" },
    ],
    ports: [
      { portId: "port:input:out", primitiveId: "primitive:input", role: "output", anchor: { side: "right", offset: 500 }, order: 0, semanticPortId: "input:out" },
      { portId: "port:custom:in", primitiveId: "primitive:custom", role: "input", anchor: { side: "left", offset: 500 }, order: 0, semanticPortId: "custom:in" },
    ],
    connectors: [{ connectorId: "connector:flow", sourcePortId: "port:input:out", targetPortId: "port:custom:in", relation: "data", route: [{ x: 1100, y: 600 }, { x: 1650, y: 600 }, { x: 2200, y: 600 }], styleTokenIds: [], zIndex: 0 }],
    annotations: [],
    legend: { entries: [], styleTokenIds: [] },
    styleTokens: { tokenSetVersion: "pvp-style-1", tokens: [] },
    profileApplications: [],
    sourceMappings: [
      { visualId: "primitive:input", ugsIds: ["input"], evidenceIds: ["e-input"] },
      { visualId: "primitive:custom", ugsIds: ["custom"], evidenceIds: ["e-custom"] },
    ],
    rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] },
    updateIdentity: { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 },
  };
}

describe("PublicationVisualPlan v1", () => {
  it("creates and parses one deterministic formal PVP with anchored ports and canonical hash", () => {
    const first = createPublicationVisualPlan(formalDraft());
    const second = createPublicationVisualPlan(formalDraft());

    expect(first).toEqual(second);
    expect(first.identity.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsePublicationVisualPlan(first)).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it.each(["unknownField", "duplicatePort", "nonFinite", "endpointMismatch"])("rejects %s before a PVP can be accepted", (kind) => {
    const plan = structuredClone(createPublicationVisualPlan(formalDraft())) as any;
    if (kind === "unknownField") plan.unknownField = true;
    if (kind === "duplicatePort") plan.ports.push(structuredClone(plan.ports[0]));
    if (kind === "nonFinite") plan.connectors[0].route[1].x = Number.POSITIVE_INFINITY;
    if (kind === "endpointMismatch") plan.connectors[0].route[0].x += 1;

    expect(() => parsePublicationVisualPlan(plan)).toThrow();
  });
});
