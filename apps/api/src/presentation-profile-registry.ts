import { digestGenericPlanSnapshotValue } from "./generic-plan-snapshot.js";
import type { GeneralPublicationComponent, GeneralPublicationGraph } from "./general-publication-graph.js";
import { createPublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import type { PresentationProfile, PresentationProfileApplication, PresentationProfileInput, PresentationProfileMatch, PresentationProfileOverlay, PresentationProfileResult, PresentationStyleToken } from "./presentation-profile.js";
import { compareCodeUnits } from "./stable-string-order.js";

const ID = /^[A-Za-z][A-Za-z0-9._:-]*$/;

export function applyPresentationProfiles(input: PresentationProfileInput & { readonly profiles?: readonly PresentationProfile[] }): PresentationProfileResult {
  const profiles = input.profiles ?? builtInPresentationProfiles;
  try {
    assertProfiles(profiles);
    const matches = profiles
      .map((profile) => ({ profile, match: profile.match(input) }))
      .filter((item): item is { profile: PresentationProfile; match: PresentationProfileMatch } => item.match !== null)
      .sort((left, right) => compareCodeUnits(left.profile.profileId, right.profile.profileId));
    if (matches.length === 0) return Object.freeze({ plan: input.plan, applications: Object.freeze([]) });

    const draft = structuredClone(input.plan) as Record<string, unknown>;
    const applications: PresentationProfileApplication[] = [];
    const claimedVisualIds = new Set<string>();
    for (const { profile, match } of matches) {
      const overlay = profile.apply(input, match);
      validateOverlay(input.plan, overlay);
      assertUnclaimedVisualTargets(overlay, claimedVisualIds);
      mergeOverlay(draft, overlay);
      const inputHash = digestGenericPlanSnapshotValue({
        profileId: profile.profileId,
        profileVersion: profile.profileVersion,
        ugs: input.ugs,
        graph: input.graph,
        match,
      });
      const outputHash = digestGenericPlanSnapshotValue({ profileId: profile.profileId, profileVersion: profile.profileVersion, overlay });
      applications.push({
        applicationId: `profile-application:${profile.profileId}`,
        profileId: profile.profileId,
        profileVersion: profile.profileVersion,
        inputHash,
        outputHash,
        affectedIds: [...overlay.affectedIds].sort(compareCodeUnits),
      });
    }
    applications.sort((left, right) => compareCodeUnits(left.applicationId, right.applicationId));
    draft.profileApplications = applications;
    const lineage = asRecord(draft.lineage, "PVP profile lineage is invalid");
    lineage.profileSetHash = digestGenericPlanSnapshotValue(applications);
    return Object.freeze({ plan: createPublicationVisualPlan(draft), applications: Object.freeze(applications.map((item) => Object.freeze({ ...item, affectedIds: Object.freeze([...item.affectedIds]) }))) });
  } catch {
    return Object.freeze({ plan: input.plan, applications: Object.freeze([]) });
  }
}

export const builtInPresentationProfiles: readonly PresentationProfile[] = Object.freeze([
  semanticProfile("dual-tower-fusion", matchesDualTowerFusion, "#6d28d9", "#7c3aed"),
  semanticProfile("encoder-decoder", matchesEncoderDecoder, "#0f766e", "#0d9488"),
  semanticProfile("repeat-collapse", matchesRepeatCollapse, "#a16207", "#ca8a04"),
  semanticProfile("residual-branch", matchesResidualBranch, "#1d4ed8", "#2563eb"),
  semanticProfile("spatial-scale", matchesSpatialScale, "#0f766e", "#14b8a6"),
]);

function semanticProfile(profileId: string, matcher: (graph: GeneralPublicationGraph) => PresentationProfileMatch | null, stroke: string, connector: string): PresentationProfile {
  return Object.freeze({
    profileId,
    profileVersion: "u3-1",
    match: (input: PresentationProfileInput) => matcher(input.graph),
    apply: (_input: PresentationProfileInput, match: PresentationProfileMatch) => {
      const primitiveTokenId = `profile:${profileId}:primitive`;
      const connectorTokenId = `profile:${profileId}:connector`;
      const styleTokens: PresentationStyleToken[] = [
        { tokenId: primitiveTokenId, values: { stroke, fill: "#ffffff", strokeWidth: "3" } },
        { tokenId: connectorTokenId, values: { stroke: connector, strokeWidth: "3" } },
      ];
      return {
        primitiveStyleTokenIds: match.componentIds.map((componentId) => ({ primitiveId: `primitive:${componentId}`, styleTokenIds: [primitiveTokenId] })),
        connectorStyleTokenIds: match.relationIds.map((relationId) => ({ connectorId: `connector:${relationId}`, styleTokenIds: [connectorTokenId] })),
        styleTokens,
        affectedIds: [...match.componentIds, ...match.relationIds].sort(compareCodeUnits),
      };
    },
  });
}

function matchesResidualBranch(graph: GeneralPublicationGraph): PresentationProfileMatch | null {
  const components = graph.components.filter((component) => component.role === "split" || component.role === "merge_add");
  const relations = graph.relations.filter((relation) => relation.role === "skip" || relation.role === "merge");
  return components.some((component) => component.role === "split") && components.some((component) => component.role === "merge_add") && relations.some((relation) => relation.role === "skip")
    ? match(components, relations)
    : null;
}

function matchesEncoderDecoder(graph: GeneralPublicationGraph): PresentationProfileMatch | null {
  const components = graph.components.filter((component) => component.role === "merge_concat" || component.role === "custom_module");
  const relations = graph.relations.filter((relation) => relation.role === "skip" || relation.role === "merge");
  return components.some((component) => component.role === "merge_concat") && relations.some((relation) => relation.role === "skip")
    ? match(components, relations)
    : null;
}

function matchesDualTowerFusion(graph: GeneralPublicationGraph): PresentationProfileMatch | null {
  const inputComponents = graph.components.filter((component) => component.role === "input");
  const fusionComponents = graph.components.filter((component) => component.role === "custom_fusion" || graph.relations.filter((relation) => relation.targetComponentId === component.componentId).length >= 2);
  if (inputComponents.length < 2 || fusionComponents.length === 0) return null;
  const fusionIds = new Set(fusionComponents.map((component) => component.componentId));
  return match([...inputComponents, ...fusionComponents], graph.relations.filter((relation) => fusionIds.has(relation.targetComponentId)));
}

function matchesRepeatCollapse(graph: GeneralPublicationGraph): PresentationProfileMatch | null {
  const components = graph.components.filter((component) => component.role === "repeat_badge");
  return components.length > 0 ? match(components, []) : null;
}

function matchesSpatialScale(graph: GeneralPublicationGraph): PresentationProfileMatch | null {
  const custom = graph.components.filter((component) => component.role === "custom_operator" || component.role === "custom_module");
  const hasStructuralBranching = graph.relations.some((relation) => relation.role === "skip" || relation.role === "merge") || graph.components.some((component) => component.role === "split" || component.role === "merge_add" || component.role === "merge_concat" || component.role === "repeat_badge");
  return custom.length >= 2 && !hasStructuralBranching && graph.components.filter((component) => component.role === "input").length === 1 && graph.components.filter((component) => component.role === "output").length === 1
    ? match(custom, graph.relations.filter((relation) => custom.some((component) => component.componentId === relation.sourceComponentId || component.componentId === relation.targetComponentId)))
    : null;
}

function match(components: readonly GeneralPublicationComponent[], relations: GeneralPublicationGraph["relations"]): PresentationProfileMatch {
  return Object.freeze({
    componentIds: Object.freeze(components.map((component) => component.componentId).sort(compareCodeUnits)),
    relationIds: Object.freeze(relations.map((relation) => relation.relationId).sort(compareCodeUnits)),
  });
}

function validateOverlay(plan: PublicationVisualPlan, overlay: PresentationProfileOverlay): void {
  const primitiveIds = new Set((plan.primitives as Array<Record<string, unknown>>).map((item) => item.primitiveId));
  const connectorIds = new Set((plan.connectors as Array<Record<string, unknown>>).map((item) => item.connectorId));
  const affectedIds = [...overlay.affectedIds];
  if (!Array.isArray(overlay.primitiveStyleTokenIds) || !Array.isArray(overlay.connectorStyleTokenIds) || !Array.isArray(overlay.styleTokens) || affectedIds.length === 0 || new Set(affectedIds).size !== affectedIds.length || affectedIds.some((id) => !ID.test(id))) throw new Error("Presentation Profile overlay is invalid");
  for (const item of overlay.primitiveStyleTokenIds) if (!primitiveIds.has(item.primitiveId) || !validTokenIds(item.styleTokenIds)) throw new Error("Presentation Profile primitive overlay is invalid");
  for (const item of overlay.connectorStyleTokenIds) if (!connectorIds.has(item.connectorId) || !validTokenIds(item.styleTokenIds)) throw new Error("Presentation Profile connector overlay is invalid");
  const tokenIds = overlay.styleTokens.map((token) => token.tokenId);
  if (!validTokenIds(tokenIds) || new Set(tokenIds).size !== tokenIds.length || overlay.styleTokens.some((token) => !isStyleToken(token))) throw new Error("Presentation Profile style token is invalid");
  const allReferencedTokenIds = [...overlay.primitiveStyleTokenIds, ...overlay.connectorStyleTokenIds].flatMap((item) => item.styleTokenIds);
  if (allReferencedTokenIds.some((tokenId) => !tokenIds.includes(tokenId))) throw new Error("Presentation Profile references an undeclared token");
}

function assertUnclaimedVisualTargets(overlay: PresentationProfileOverlay, claimedVisualIds: Set<string>): void {
  const targets = [
    ...overlay.primitiveStyleTokenIds.map((item) => item.primitiveId),
    ...overlay.connectorStyleTokenIds.map((item) => item.connectorId),
  ];
  if (targets.some((target) => claimedVisualIds.has(target))) throw new Error("Presentation Profile overlays conflict");
  for (const target of targets) claimedVisualIds.add(target);
}

function mergeOverlay(draft: Record<string, unknown>, overlay: PresentationProfileOverlay): void {
  const tokens = asRecord(draft.styleTokens, "PVP style tokens are invalid");
  const currentTokens = Array.isArray(tokens.tokens) ? tokens.tokens : [];
  const currentTokenIds = new Set(currentTokens.map((item) => asRecord(item, "PVP style token is invalid").tokenId));
  for (const token of overlay.styleTokens) {
    if (currentTokenIds.has(token.tokenId)) throw new Error("Presentation Profile token conflicts with the General PVP");
    currentTokens.push({ tokenId: token.tokenId, values: { ...token.values } });
  }
  tokens.tokens = currentTokens;
  mergeStyleReferences(draft.primitives, "primitiveId", overlay.primitiveStyleTokenIds);
  mergeStyleReferences(draft.connectors, "connectorId", overlay.connectorStyleTokenIds);
}

function mergeStyleReferences(values: unknown, idKey: "primitiveId" | "connectorId", additions: readonly { readonly styleTokenIds: readonly string[] }[]): void {
  if (!Array.isArray(values)) throw new Error("PVP visual collection is invalid");
  for (const addition of additions) {
    const id = idKey === "primitiveId" ? (addition as { primitiveId?: string }).primitiveId : (addition as { connectorId?: string }).connectorId;
    const value = values.find((item) => asRecord(item, "PVP visual item is invalid")[idKey] === id);
    const record = asRecord(value, "PVP Profile visual target is invalid");
    const current = Array.isArray(record.styleTokenIds) ? record.styleTokenIds : [];
    record.styleTokenIds = [...new Set([...current, ...addition.styleTokenIds])].sort(compareCodeUnits);
  }
}

function assertProfiles(profiles: readonly PresentationProfile[]): void {
  if (!Array.isArray(profiles) || profiles.length > 16) throw new Error("Presentation Profile registry is invalid");
  const ids = profiles.map((profile) => profile.profileId);
  if (ids.some((id) => !ID.test(id)) || new Set(ids).size !== ids.length || profiles.some((profile) => typeof profile.profileVersion !== "string" || profile.profileVersion.length === 0 || typeof profile.match !== "function" || typeof profile.apply !== "function")) throw new Error("Presentation Profile registry is invalid");
}

function validTokenIds(value: readonly string[]): boolean { return Array.isArray(value) && value.length > 0 && value.every((item) => ID.test(item)); }
function isStyleToken(value: PresentationStyleToken): boolean { return ID.test(value.tokenId) && value.values !== null && typeof value.values === "object" && !Array.isArray(value.values) && Object.keys(value.values).length > 0 && Object.values(value.values).every((item) => typeof item === "string" && item.length > 0 && item.length <= 64); }
function asRecord(value: unknown, message: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message); return value as Record<string, unknown>; }
