import { describe, expect, it } from "vitest";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { buildComposableDagPublicationPlan } from "../src/composable-dag-publication-plan.js";
import {
  cnnGoldIr,
  encoderDecoderGoldIr,
  residualGoldIr,
  tokenTransformerGoldIr,
} from "./fixtures/figure-component-gold-ir.js";

describe("Composable DAG publication plan", () => {
  it("builds a versioned deterministic publication plan from a ready CNN IR", () => {
    const architectureIr = cnnGoldIr();
    const result = buildComposableDagPublicationPlan({
      architectureIr,
      intent: defaultFigureIntent(),
      layoutSeed: "m2-3-cnn",
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.publicationPlan.version).toBe(1);
    expect(result.publicationPlan.dagPlan.graphId).toBe(architectureIr.graphId);
    expect(result.publicationPlan.qaVersion).toBe("composable-dag-visual-qa-v1");
    expect(result.publicationPlan.visualSpec.labels).toHaveLength(result.publicationPlan.dagPlan.components.length);
    expect(Object.keys(result.publicationPlan.visualSpec.componentStyles).length).toBeGreaterThan(0);
    expect(result.publicationPlan.evidenceIndex).toEqual(architectureIr.evidenceIndex);
  });

  it.each([
    ["residual", residualGoldIr],
    ["encoder-decoder", encoderDecoderGoldIr],
    ["token-transformer", tokenTransformerGoldIr],
  ])("uses the same publication boundary for %s gold IR", (_name, createIr) => {
    const result = buildComposableDagPublicationPlan({
      architectureIr: createIr(),
      intent: defaultFigureIntent(),
      layoutSeed: "m2-3-gold",
    });

    expect(result.status).toBe("ready");
  });

  it("preserves unresolved compiler results instead of creating a publication plan", () => {
    const architectureIr = cnnGoldIr();
    architectureIr.unresolved = [{
      id: "question-1",
      severity: "blocking",
      conflictKey: "dynamic-control-flow",
      candidateValues: ["linear", "branched"],
      evidenceFactIds: [],
      dependencyQuestionIds: [],
    }];

    const result = buildComposableDagPublicationPlan({
      architectureIr,
      intent: defaultFigureIntent(),
      layoutSeed: "m2-3-unresolved",
    });

    expect(result.status).toBe("unresolved");
    if (result.status === "unresolved") {
      expect("publicationPlan" in result).toBe(false);
      expect(result.unresolved).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "component-contract" }),
      ]));
    }
  });

  it("produces byte-equivalent output and does not share mutable input objects", () => {
    const firstInput = cnnGoldIr();
    const secondInput = cnnGoldIr();
    const first = buildComposableDagPublicationPlan({
      architectureIr: firstInput,
      intent: defaultFigureIntent(),
      layoutSeed: "m2-3-deterministic",
    });
    const second = buildComposableDagPublicationPlan({
      architectureIr: secondInput,
      intent: defaultFigureIntent(),
      layoutSeed: "m2-3-deterministic",
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (first.status === "ready") {
      first.publicationPlan.visualSpec.labels[0]!.text = "changed";
      expect(firstInput.nodes[0]!.semanticRole).toBe("input");
    }
  });
});
