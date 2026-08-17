import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export interface VisioReadback {
  valid: boolean;
  shapeCount: number;
  connectorCount: number;
  expectedPrimitiveIds: string[];
  actualPrimitiveIds: string[];
  missingPrimitiveIds: string[];
  expectedConnectorIds: string[];
  actualConnectorIds: string[];
  missingConnectorIds: string[];
  shapeDataFailures: string[];
}

export const visioReadbackSchema = z.object({
  valid: z.literal(true),
  shapeCount: z.number().int().nonnegative(),
  connectorCount: z.number().int().nonnegative(),
  expectedPrimitiveIds: z.array(identifierSchema),
  actualPrimitiveIds: z.array(identifierSchema),
  missingPrimitiveIds: z.array(identifierSchema),
  expectedConnectorIds: z.array(identifierSchema),
  actualConnectorIds: z.array(identifierSchema),
  missingConnectorIds: z.array(identifierSchema),
  shapeDataFailures: z.array(z.string().trim().min(1).max(2000)),
}).strict();

export function parseVisioReadback(value: unknown): VisioReadback {
  return visioReadbackSchema.parse(value);
}
