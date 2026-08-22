import { describe, expect, it } from "vitest";
import { PublicationVisualPreviewService } from "../src/publication-visual-preview-service.js";
import { unknownDualStreamFusionUgs } from "./fixtures/universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };

describe("PublicationVisualPreviewService", () => {
  it("returns a formal PVP preview for an unknown but topology-complete network", () => {
    const preview = new PublicationVisualPreviewService().preview({ ugs: unknownDualStreamFusionUgs(), detail: "architecture", updateIdentity });

    expect(preview.kind).toBe("formal");
    expect(preview.exportEligible).toBe(false);
    expect(preview.pvp.eligibility).toMatchObject({ kind: "formal", qaStatus: "pending" });
  });

  it("returns a candidate PVP preview without export eligibility for ambiguous topology", () => {
    const ugs = unknownDualStreamFusionUgs();
    ugs.edges[1] = { ...ugs.edges[1], relation: "candidate", knowledge: "candidate" };
    const preview = new PublicationVisualPreviewService().preview({ ugs, detail: "architecture", updateIdentity });

    expect(preview.kind).toBe("candidate");
    expect(preview.exportEligible).toBe(false);
    expect(preview.pvp.eligibility.kind).toBe("candidate");
  });
});
