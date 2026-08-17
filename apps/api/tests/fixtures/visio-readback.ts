import type { VisioReadback } from "../../src/adapters.js";

export function completeVisioReadback(overrides: Partial<VisioReadback> = {}): VisioReadback {
  return {
    valid: true,
    shapeCount: 0,
    connectorCount: 0,
    expectedPrimitiveIds: [],
    actualPrimitiveIds: [],
    missingPrimitiveIds: [],
    expectedConnectorIds: [],
    actualConnectorIds: [],
    missingConnectorIds: [],
    shapeDataFailures: [],
    ...overrides,
  };
}
