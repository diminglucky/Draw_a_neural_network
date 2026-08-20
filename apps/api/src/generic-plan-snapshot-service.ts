import { composeGeneralPublicationGraph, type GeneralPublicationGraph } from "./general-publication-graph.js";
import { createGenericPlanSnapshot, digestGenericPlanSnapshotValue, type GenericPlanSnapshot, type GenericPlanSnapshotOwner } from "./generic-plan-snapshot.js";
import type { GenericPlanSnapshotStore } from "./generic-plan-snapshot-store.js";
import { createPublicationVisualPlan, parsePublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import { isPublicationVisualPlanQaPromotionReason } from "./publication-visual-plan-qa-promotion.js";
import { evaluatePublicationVisualPlanQa } from "./publication-visual-plan-qa.js";
import { compareCodeUnits } from "./stable-string-order.js";
import { getUniversalGraphEligibility, parseUniversalGraphSpec } from "./universal-graph-spec.js";

export interface GenericPlanSnapshotServiceOptions {
  store: GenericPlanSnapshotStore;
}

export class GenericPlanSnapshotService {
  constructor(private readonly options: GenericPlanSnapshotServiceOptions) {}

  async create(input: {
    owner: GenericPlanSnapshotOwner;
    ugsRevision: number;
    ugs: unknown;
    graph: GeneralPublicationGraph;
    publicationVisualPlan: unknown;
    createdAt: string;
  }): Promise<GenericPlanSnapshot> {
    const copied = structuredClone(input);
    const ugs = parseUniversalGraphSpec(copied.ugs);
    if (!Number.isSafeInteger(copied.ugsRevision) || copied.ugsRevision < 1) throw new Error("UGS revision is invalid");
    const graph = composeGeneralPublicationGraph(ugs, { detail: copied.graph.detail });
    if (digestGenericPlanSnapshotValue(copied.graph) !== digestGenericPlanSnapshotValue(graph)) throw new Error("General Publication Graph does not match canonical UGS projection");
    if (getUniversalGraphEligibility(ugs).preview !== "renderable" || graph.exportEligibility !== "eligible") throw new Error("UGS/GPG is not eligible for Snapshot");
    const pvp = parsePublicationVisualPlan(copied.publicationVisualPlan);
    assertEligiblePvp(pvp);
    assertPvpLineage(pvp, ugs, graph);
    assertPvpUpdateIdentity(pvp, copied.owner, copied.ugsRevision);
    const snapshot = createGenericPlanSnapshot({
      tenantId: copied.owner.tenantId,
      userId: copied.owner.userId,
      deviceId: copied.owner.deviceId,
      graphId: ugs.graphId,
      ugsRevision: copied.ugsRevision,
      ugsCanonicalHash: digestGenericPlanSnapshotValue(ugs),
      generalPublicationGraphHash: digestGenericPlanSnapshotValue(graph),
      publicationVisualPlan: pvp,
      createdAt: copied.createdAt,
    });
    return this.options.store.insert(copied.owner, snapshot);
  }
}

function assertEligiblePvp(plan: PublicationVisualPlan): void {
  if (plan.eligibility.kind !== "formal" || plan.eligibility.qaStatus !== "passed" || plan.eligibility.blockingReasons.length !== 0) throw new Error("PVP is not eligible for Snapshot");
  if (evaluatePublicationVisualPlanQa(plan).status !== "passed") throw new Error("PVP structural QA is not eligible for Snapshot");
  assertQaPromotionBinding(plan);
  if ((plan.connectors as Array<Record<string, unknown>>).some((connector) => connector.relation === "feedback")) throw new Error("Feedback PVP is not eligible for Snapshot");
  if ((plan.primitives as Array<Record<string, unknown>>).some((primitive) => primitive.kind === "CandidateRegion")) throw new Error("Candidate PVP is not eligible for Snapshot");
}

function assertQaPromotionBinding(plan: PublicationVisualPlan): void {
  const promotionReasons = plan.eligibility.formalReasons.filter(isPublicationVisualPlanQaPromotionReason);
  if (promotionReasons.length !== 1) throw new Error("PVP is missing an unambiguous trusted QA promotion binding");
  const promotionReason = promotionReasons[0]!;
  const sourcePlanHash = promotionReason.slice("visual-qa:pvp-qa-1:".length);
  const pending = createPublicationVisualPlan({
    ...structuredClone(plan),
    eligibility: {
      kind: "formal",
      formalReasons: plan.eligibility.formalReasons.filter((reason) => reason !== promotionReason),
      blockingReasons: [],
      qaStatus: "pending",
    },
  });
  if (pending.identity.canonicalHash !== sourcePlanHash) throw new Error("PVP trusted QA promotion binding does not match its pending projection");
}

function assertPvpLineage(plan: PublicationVisualPlan, ugs: ReturnType<typeof parseUniversalGraphSpec>, graph: GeneralPublicationGraph): void {
  const lineage = record(plan.lineage, "PVP lineage is invalid");
  if (lineage.ugsHash !== digestGenericPlanSnapshotValue(ugs) || lineage.gpgHash !== digestGenericPlanSnapshotValue(graph)) throw new Error("PVP lineage does not match canonical UGS/GPG");
  const sourceHashes = stringArray(lineage.sourceHashes, "PVP lineage sourceHashes").sort(compareCodeUnits);
  const expected = [...ugs.sourceHashes].sort(compareCodeUnits);
  if (sourceHashes.length !== expected.length || sourceHashes.some((item, index) => item !== expected[index])) throw new Error("PVP lineage source hashes do not match UGS");
}

function assertPvpUpdateIdentity(plan: PublicationVisualPlan, owner: GenericPlanSnapshotOwner, revision: number): void {
  const identity = record(plan.updateIdentity, "PVP update identity is invalid");
  if (identity.ownerId !== owner.userId || identity.deviceId !== owner.deviceId || identity.expectedRevision !== revision) throw new Error("PVP update identity does not match Snapshot owner/device/revision");
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(message);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))) throw new Error(`${label} is invalid`);
  return [...value];
}
