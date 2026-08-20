import { describe, expect, it } from "vitest";
import { projectArchitectureIrV3ToUniversalGraphSpec } from "../src/universal-graph-spec-adapter.js";
import { parseArchitectureIRv3 } from "../src/network-ir-v3.js";
import { cnnGoldIr, tokenTransformerGoldIr } from "./fixtures/figure-component-gold-ir.js";

describe("ArchitectureIRv3 to UniversalGraphSpec adapter", () => {
  it("preserves ports and evidence while drawing an unknown operation as a custom operator", () => {
    const source = cnnGoldIr();
    source.nodes[1] = { ...source.nodes[1], semanticRole: "spectral_mixer" };

    const ugs = projectArchitectureIrV3ToUniversalGraphSpec(parseArchitectureIRv3(source));

    expect(ugs.nodes.find((node) => node.nodeId === "operator")).toMatchObject({
      kind: "custom_operator",
      operationKnowledge: "custom",
      evidenceIds: ["evidence-main"],
    });
    expect(ugs.ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ portId: "operator:in", direction: "input" }),
      expect.objectContaining({ portId: "operator:out", direction: "output" }),
    ]));
    expect(ugs.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePortId: "input:out", targetPortId: "operator:in", relation: "data", knowledge: "proven" }),
    ]));
    expect(ugs.evidence.find((item) => item.evidenceId === "evidence-main")).toMatchObject({ sourceId: "fixture-source", sourceHash: "0".repeat(64) });
  });

  it("projects a repeated unit into an explicit group that a general renderer can trace", () => {
    const ugs = projectArchitectureIrV3ToUniversalGraphSpec(parseArchitectureIRv3(tokenTransformerGoldIr()));

    expect(ugs.nodes.find((node) => node.nodeId === "repeat")).toMatchObject({
      kind: "container",
      attributes: { repeatCount: 12, repeatGroupId: "repeat-unit:repeat" },
    });
    expect(ugs.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        groupId: "repeat-unit:repeat",
        memberNodeIds: ["attention"],
        evidenceIds: ["evidence-repeat"],
      }),
    ]));
  });

  it("retains every source reference behind a shared v3 evidence fact", () => {
    const source = cnnGoldIr();
    source.evidenceIndex["evidence-main"]!.push({
      sourceId: "second-fixture-source",
      sourceSha256: "a".repeat(64),
      locator: { kind: "code", startLine: 9, startColumn: 1, endLine: 9, endColumn: 9 },
      excerptDigest: "b".repeat(64),
    });

    const ugs = projectArchitectureIrV3ToUniversalGraphSpec(parseArchitectureIRv3(source));

    expect(ugs.nodes.find((node) => node.nodeId === "operator")?.evidenceIds).toEqual(["evidence-main", "evidence-main:source-2"]);
    expect(ugs.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceId: "evidence-main", sourceId: "fixture-source" }),
      expect.objectContaining({ evidenceId: "evidence-main:source-2", sourceId: "second-fixture-source" }),
    ]));
  });

  it("allocates collision-free derived evidence IDs when source facts use a ref-like suffix", () => {
    const source = cnnGoldIr();
    source.evidenceIndex["evidence-main"]!.push({
      sourceId: "second-fixture-source",
      sourceSha256: "a".repeat(64),
      locator: { kind: "code", startLine: 9, startColumn: 1, endLine: 9, endColumn: 9 },
      excerptDigest: "b".repeat(64),
    });
    source.evidenceIndex["evidence-main:ref-2"] = [{
      sourceId: "independent-fixture-source",
      sourceSha256: "c".repeat(64),
      locator: { kind: "code", startLine: 10, startColumn: 1, endLine: 10, endColumn: 10 },
      excerptDigest: "d".repeat(64),
    }];

    const ugs = projectArchitectureIrV3ToUniversalGraphSpec(parseArchitectureIRv3(source));

    expect(ugs.nodes.find((node) => node.nodeId === "operator")?.evidenceIds).toEqual(["evidence-main", "evidence-main:source-2"]);
    expect(ugs.evidence.map((item) => item.evidenceId)).toEqual(expect.arrayContaining([
      "evidence-main",
      "evidence-main:source-2",
      "evidence-main:ref-2",
    ]));
  });

  it("uses code-unit ordering for projected evidence keys", () => {
    const source = cnnGoldIr();
    source.evidenceIndex.I = [{ ...source.evidenceIndex["evidence-main"]![0]! }];
    source.evidenceIndex.i = [{ ...source.evidenceIndex["evidence-main"]![0]! }];

    const ugs = projectArchitectureIrV3ToUniversalGraphSpec(parseArchitectureIRv3(source));
    const evidenceIds = ugs.evidence.map((item) => item.evidenceId);

    expect(evidenceIds.indexOf("I")).toBeLessThan(evidenceIds.indexOf("i"));
  });
});
