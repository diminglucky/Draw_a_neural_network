import { describe, expect, it } from "vitest";
import { requireRealVisioAcceptance } from "../../../scripts/agent-vgg16-visio-acceptance.js";

describe("Agent VGG16 Visio acceptance guard", () => {
  it("refuses to start a live Visio process without an explicit opt-in switch", () => {
    expect(() => requireRealVisioAcceptance({})).toThrow("SYNAPSE_REAL_VISIO_ACCEPTANCE=1 is required");
    expect(() => requireRealVisioAcceptance({ SYNAPSE_REAL_VISIO_ACCEPTANCE: "0" })).toThrow("SYNAPSE_REAL_VISIO_ACCEPTANCE=1 is required");
  });
});
