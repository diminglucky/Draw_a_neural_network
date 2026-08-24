import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const revisionSchema = z.number().int().nonnegative();

export interface VisioReadback {
  valid: true;
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

export interface SelectedPageVisioReadback {
  valid: true;
  documentId: string;
  pageId: string;
  documentFingerprint: string;
  pageFingerprint: string;
  expectedRevision: number;
  ownershipNamespace: string;
  userOwnedShapeCount: number;
  agentOwnedShapes: Array<{
    nativeShapeId: string;
    ownershipNamespace: string;
    sourceMappingSemanticIds: string[];
  }>;
  unclassifiedShapeCount: 0;
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

export const selectedPageVisioReadbackSchema = z.object({
  valid: z.literal(true),
  documentId: identifierSchema,
  pageId: identifierSchema,
  documentFingerprint: fingerprintSchema,
  pageFingerprint: fingerprintSchema,
  expectedRevision: revisionSchema,
  ownershipNamespace: identifierSchema,
  userOwnedShapeCount: z.number().int().nonnegative(),
  agentOwnedShapes: z.array(z.object({
    nativeShapeId: identifierSchema,
    ownershipNamespace: identifierSchema,
    sourceMappingSemanticIds: z.array(identifierSchema).min(1),
  }).strict()),
  unclassifiedShapeCount: z.literal(0),
}).strict().superRefine((value, context) => {
  const nativeIds = new Set<string>();
  for (const shape of value.agentOwnedShapes) {
    if (shape.ownershipNamespace !== value.ownershipNamespace) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["agentOwnedShapes"], message: "Agent-owned shape namespace must match readback ownershipNamespace" });
    }
    if (nativeIds.has(shape.nativeShapeId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["agentOwnedShapes"], message: "Agent-owned native shape IDs must be unique" });
    }
    nativeIds.add(shape.nativeShapeId);
  }
});

export function parseVisioReadback(value: unknown): VisioReadback {
  return visioReadbackSchema.parse(value);
}

export function parseSelectedPageVisioReadback(value: unknown): SelectedPageVisioReadback {
  return selectedPageVisioReadbackSchema.parse(value);
}
