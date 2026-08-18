import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createAnalysisPlanSnapshot,
  type CreateAnalysisPlanSnapshotInput,
} from "../src/analysis-plan-snapshot.js";
import { buildComposableDagPublicationPlan } from "../src/composable-dag-publication-plan.js";
import type { PublicComposableDagPublicationPlan } from "../src/figure-analysis-preview-service.js";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { cnnGoldIr } from "./fixtures/figure-component-gold-ir.js";

function publicationPlan(): PublicComposableDagPublicationPlan {
  const built = buildComposableDagPublicationPlan({
    architectureIr: cnnGoldIr(),
    intent: defaultFigureIntent(),
    layoutSeed: "seed-1",
  });
  if (built.status !== "ready") throw new Error("test fixture must produce a publication plan");
  return {
    version: 1,
    graphId: built.publicationPlan.dagPlan.graphId,
    compilerVersion: built.publicationPlan.dagPlan.compilerVersion,
    layoutVersion: built.publicationPlan.dagPlan.layoutVersion,
    intent: structuredClone(built.publicationPlan.dagPlan.intent),
    pageBounds: structuredClone(built.publicationPlan.dagPlan.pageBounds),
    components: built.publicationPlan.dagPlan.components.map(({ evidenceIds: _evidenceIds, ...component }) => structuredClone(component)),
    connections: built.publicationPlan.dagPlan.connections.map(({ evidenceIds: _evidenceIds, ...connection }) => structuredClone(connection)),
    visualSpec: structuredClone(built.publicationPlan.visualSpec),
    qaVersion: built.publicationPlan.qaVersion,
  };
}

function input(overrides: Partial<CreateAnalysisPlanSnapshotInput> = {}): CreateAnalysisPlanSnapshotInput {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    analysisId: "analysis-1",
    analysisStatus: "ready_for_preview",
    architectureIrHash: "a".repeat(64),
    figureIntentHash: "b".repeat(64),
    publicationPlan: publicationPlan(),
    compilerManifest: {
      canonicalization: "RFC-8785-JCS",
      architectureIrHash: "a".repeat(64),
      figureIntentHash: "b".repeat(64),
      componentCompilerVersion: "component-v1",
      layoutCompilerVersion: "layout-v1",
      styleTokenVersion: "style-v1",
      layoutSeed: "seed-1",
    },
    visualQa: {
      status: "pass",
      checks: [{ id: "bounds", severity: "blocking", passed: true, message: "all content fits" }],
    },
    previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "c".repeat(64) }],
    createdAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("AnalysisPlanSnapshot", () => {
  it("canonicalizes architecture identities without treating their evidence fields as snapshot payload", () => {
    expect(canonicalJson({ evidenceIds: ["fact-1"], evidenceIndex: { "fact-1": [{ locator: { line: 1 } }] } }))
      .toBe('{"evidenceIds":["fact-1"],"evidenceIndex":{"fact-1":[{"locator":{"line":1}}]}}');
  });

  it("serializes integer-like object keys in lexical order", () => {
    expect(canonicalJson({ "2": "two", "10": "ten" })).toBe('{"10":"ten","2":"two"}');
    expect(canonicalJson({ outer: { "2": 2, "10": 10 } })).toBe('{"outer":{"10":10,"2":2}}');
  });

  it("rejects non-finite numbers and lone surrogate Unicode in values or keys", () => {
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/i);
    expect(() => canonicalJson("\ud800")).toThrow(/surrogate|unicode/i);
    expect(() => canonicalJson({ ["bad\udc00"]: true })).toThrow(/surrogate|unicode/i);
  });

  it("uses canonical JSON and every required identity input to produce a deterministic snapshot ID", () => {
    const first = createAnalysisPlanSnapshot(input());
    const plan = publicationPlan();
    const reordered = createAnalysisPlanSnapshot(input({
      publicationPlan: {
        qaVersion: plan.qaVersion,
        visualSpec: plan.visualSpec,
        connections: plan.connections,
        components: plan.components,
        pageBounds: plan.pageBounds,
        intent: plan.intent,
        layoutVersion: plan.layoutVersion,
        compilerVersion: plan.compilerVersion,
        graphId: plan.graphId,
        version: plan.version,
      },
    }));

    expect(canonicalJson({ z: [2, 1], a: { second: 2, first: 1 } })).toBe('{"a":{"first":1,"second":2},"z":[2,1]}');
    expect(reordered.snapshotId).toBe(first.snapshotId);

    const changedInputs: Array<Partial<CreateAnalysisPlanSnapshotInput>> = [
      { tenantId: "tenant-2" },
      { userId: "user-2" },
      { analysisId: "analysis-2" },
      { architectureIrHash: "d".repeat(64), compilerManifest: { ...input().compilerManifest, architectureIrHash: "d".repeat(64) } },
      { figureIntentHash: "e".repeat(64), compilerManifest: { ...input().compilerManifest, figureIntentHash: "e".repeat(64) } },
      { publicationPlan: { ...publicationPlan(), graphId: "graph-2" } },
      { compilerManifest: { ...input().compilerManifest, componentCompilerVersion: "component-v2" } },
      { compilerManifest: { ...input().compilerManifest, layoutCompilerVersion: "layout-v2" } },
      { compilerManifest: { ...input().compilerManifest, styleTokenVersion: "style-v2" } },
      { compilerManifest: { ...input().compilerManifest, layoutSeed: "seed-2" } },
      { visualQa: { status: "pass", checks: [{ id: "bounds", severity: "blocking", passed: true, message: "different proof" }] } },
      { previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "f".repeat(64) }] },
    ];

    for (const changed of changedInputs) expect(createAnalysisPlanSnapshot(input(changed)).snapshotId).not.toBe(first.snapshotId);
  });

  it("accepts only a ready analysis with passing blocking QA", () => {
    expect(() => createAnalysisPlanSnapshot(input({ analysisStatus: "candidate_structure" }))).toThrow(/ready/i);
    expect(() => createAnalysisPlanSnapshot(input({ analysisStatus: "failed" }))).toThrow(/ready/i);
    expect(() => createAnalysisPlanSnapshot(input({ visualQa: { status: "fail", checks: [] } }))).toThrow();
    expect(() => createAnalysisPlanSnapshot(input({ visualQa: { status: "pass", checks: [{ id: "bounds", severity: "blocking", passed: false, message: "overflow" }] } }))).toThrow(/QA|blocking/i);
  });

  it("rejects unknown runtime fields from every persisted manifest, QA, and artifact payload", () => {
    expect(() => createAnalysisPlanSnapshot(input({
      compilerManifest: { ...input().compilerManifest, apiKey: "secret" } as never,
    }))).toThrow(/unrecognized|invalid/i);
    expect(() => createAnalysisPlanSnapshot(input({
      visualQa: { ...input().visualQa, checks: [{ ...input().visualQa.checks[0]!, headers: { authorization: "secret" } }] } as never,
    }))).toThrow(/unrecognized|invalid/i);
    expect(() => createAnalysisPlanSnapshot(input({
      previewArtifactHashes: [{ ...input().previewArtifactHashes[0]!, url: "https://private.example/artifact" }] as never,
    }))).toThrow(/unrecognized|invalid/i);
    expect(() => createAnalysisPlanSnapshot(input({ createdAt: "08/18/2026 00:00:00" }))).toThrow(/datetime|timestamp|invalid/i);
  });

  it("allows the semantic connector source required by a publication plan while rejecting raw source payload fields", () => {
    const plan = publicationPlan();
    const snapshot = createAnalysisPlanSnapshot(input({ publicationPlan: plan }));

    expect(JSON.stringify(snapshot.publicationPlan)).toContain('"source"');
    expect(() => createAnalysisPlanSnapshot(input({ publicationPlan: { ...plan, source: "raw model source" } as never }))).toThrow(/publication plan|source/i);
    expect(() => createAnalysisPlanSnapshot(input({
      publicationPlan: {
        ...plan,
        components: [{ ...plan.components[0], metadata: { source: "raw model source" } }, ...plan.components.slice(1)],
      } as never,
    }))).toThrow(/publication plan|source/i);
  });

  it("deep-clones and freezes a safe snapshot without forbidden execution or evidence fields", () => {
    const source = input();
    const snapshot = createAnalysisPlanSnapshot(source);
    const originalRole = snapshot.publicationPlan.components[0]!.semanticRole;

    source.publicationPlan.components[0]!.semanticRole = "changed outside";

    expect(snapshot.publicationPlan.components[0]!.semanticRole).toBe(originalRole);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.publicationPlan)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/sourceBytes|sourceSha256|sourceRecordId|provider|evidence|locator|worker|path|command/i);
    expect(() => createAnalysisPlanSnapshot(input({ publicationPlan: { ...publicationPlan(), evidenceLocator: "private" } as never }))).toThrow(/publication plan|evidence/i);
  });
});
