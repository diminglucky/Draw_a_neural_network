import { describe, expect, it } from "vitest";
import { compileUniversalInputToPublicationPreview } from "../src/universal-input-compilation-service.js";
import { projectPublicationVisualPlanPreview } from "../src/publication-visual-plan-preview.js";

const options = {
  detail: "architecture" as const,
  updateIdentity: {
    ownerId: "owner-1",
    deviceId: "device-1",
    workflowId: "workflow-1",
    documentId: "document-1",
    pageId: "page-1",
    expectedRevision: 1,
  },
};

function unknownOperatorDeclaration(topology: "complete" | "ambiguous"): string {
  return JSON.stringify({
    graphId: `unknown-operator-${topology}`,
    topology,
    nodes: [
      { nodeId: "input", kind: "input", label: "Input", inputPorts: [], outputPorts: [{ portId: "out" }] },
      { nodeId: "operator", kind: "operator", label: "Unseen Fusion", operation: "unseen_fusion", inputPorts: [{ portId: "in" }], outputPorts: [{ portId: "out" }] },
      { nodeId: "output", kind: "output", label: "Output", inputPorts: [{ portId: "in" }], outputPorts: [] },
    ],
    edges: topology === "complete"
      ? [
        { edgeId: "input-operator", sourcePortId: "input:out", targetPortId: "operator:in" },
        { edgeId: "operator-output", sourcePortId: "operator:out", targetPortId: "output:in" },
      ]
      : [],
  });
}

describe("universal PVP preview convergence", () => {
  it("renders a formal unknown operator through the shared input-to-public-preview path", () => {
    const compiled = compileUniversalInputToPublicationPreview({
      kind: "typed-prompt",
      sourceId: "formal-unknown-source",
      prompt: unknownOperatorDeclaration("complete"),
    }, options);
    const preview = projectPublicationVisualPlanPreview(compiled);

    expect(preview).toMatchObject({ schemaVersion: 1, kind: "formal", exportEligible: false });
    expect(preview.plan.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "OperatorFrame", label: "Unseen Fusion" }),
    ]));
    expect(preview.plan).not.toHaveProperty("updateIdentity");
    expect(preview.plan).not.toHaveProperty("sourceMappings");
  });

  it("keeps unresolved topology candidate-only throughout the same path", () => {
    const compiled = compileUniversalInputToPublicationPreview({
      kind: "typed-prompt",
      sourceId: "ambiguous-unknown-source",
      prompt: unknownOperatorDeclaration("ambiguous"),
    }, options);
    const preview = projectPublicationVisualPlanPreview(compiled);

    expect(compiled.kind).toBe("candidate");
    expect(preview).toMatchObject({ schemaVersion: 1, kind: "candidate", exportEligible: false });
    expect(preview.plan.eligibility.blockingReasons).toEqual(expect.arrayContaining(["topology-candidate"]));
  });
});
