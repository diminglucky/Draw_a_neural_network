import { describe, expect, it } from "vitest";
import { createEvidencePack } from "../../src/drawing-input/evidence-pack.js";
import { createProviderContextReference, providerContextPayload } from "../../src/drawing-input/provider-context.js";

describe("Coordinator-owned provider context", () => {
  it("separates internal identity from the transmitted redacted payload", () => {
    const pack = createEvidencePack({ facts: [{ sourceKind: "typed_declaration", sourceHash: "a".repeat(64), locatorKind: "section", locatorOrdinal: 1, excerptDigest: "b".repeat(64), summary: "node input", confidence: 1, semanticKey: "node:input" }] });
    const reference = createProviderContextReference({ runId: "run-1", ownerId: "owner-1", deviceId: "device-1", expectedRevision: 2, evidencePackHash: pack.hash, allowedPurpose: "architecture_interpretation" });
    const payload = providerContextPayload(reference, pack);
    expect(reference).toHaveProperty("ownerId", "owner-1");
    expect(payload).not.toHaveProperty("runId");
    expect(payload).not.toHaveProperty("contextId");
    expect(payload).not.toHaveProperty("evidencePackHash");
    expect(JSON.stringify(payload)).not.toContain("owner-1");
    expect(payload.facts[0]).toMatchObject({ localFactRef: "fact:f:1", summary: "node input" });
  });
});
