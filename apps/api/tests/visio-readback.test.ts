import { describe, expect, it } from "vitest";
import { parseVisioReadback } from "../src/visio-readback.js";

const completeReadback = {
  valid: true,
  shapeCount: 2,
  connectorCount: 1,
  expectedPrimitiveIds: ["input", "output"],
  actualPrimitiveIds: ["input", "output"],
  missingPrimitiveIds: [],
  expectedConnectorIds: ["edge-1"],
  actualConnectorIds: ["edge-1"],
  missingConnectorIds: [],
  shapeDataFailures: [],
};

describe("Visio readback contract", () => {
  it("accepts complete native readback evidence", () => {
    expect(parseVisioReadback(completeReadback)).toEqual(completeReadback);
  });

  it("rejects evidence missing a required array", () => {
    const { missingConnectorIds: _missingConnectorIds, ...incompleteReadback } = completeReadback;

    expect(() => parseVisioReadback(incompleteReadback)).toThrow(/missingConnectorIds/);
  });
});
