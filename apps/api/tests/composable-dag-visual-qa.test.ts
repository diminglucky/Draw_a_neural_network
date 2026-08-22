import { describe, expect, it } from "vitest";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { buildComposableDagPublicationPlan } from "../src/composable-dag-publication-plan.js";
import { runComposableDagVisualQa } from "../src/composable-dag-visual-qa.js";
import type { ComposableDagPublicationPlan } from "../src/composable-dag-publication-plan.js";
import {
  cnnGoldIr,
  encoderDecoderGoldIr,
  residualGoldIr,
  tokenTransformerGoldIr,
} from "./fixtures/figure-component-gold-ir.js";

function publicationPlan(createIr: typeof cnnGoldIr) {
  const result = buildComposableDagPublicationPlan({
    architectureIr: createIr(),
    intent: defaultFigureIntent(),
    layoutSeed: "m2-3-qa",
  });
  if (result.status !== "ready") throw new Error("gold fixture should compile to a ready publication plan");
  return result.publicationPlan;
}

function expectBlockingFailure(
  source: ComposableDagPublicationPlan,
  checkId: string,
  mutate: (plan: ComposableDagPublicationPlan) => void,
): void {
  const plan = structuredClone(source);
  mutate(plan);
  const result = runComposableDagVisualQa(plan);
  expect(result.status).toBe("fail");
  expect(result.checks.find((check) => check.id === checkId)?.passed).toBe(false);
}

describe("Composable DAG Visual QA", () => {
  it.each([
    ["cnn", cnnGoldIr],
    ["residual", residualGoldIr],
    ["encoder-decoder", encoderDecoderGoldIr],
    ["token-transformer", tokenTransformerGoldIr],
  ])("accepts a valid %s publication plan", (_name, createIr) => {
    const plan = publicationPlan(createIr);

    const result = runComposableDagVisualQa(plan);

    expect(result.status).toBe("pass");
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it("rejects a component that overflows the page", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "component-bounds", (plan) => {
      plan.dagPlan.components[0]!.bounds.x = plan.dagPlan.pageBounds.width;
    });
  });

  it("rejects overlapping components", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "component-overlap", (plan) => {
      plan.dagPlan.components[1]!.bounds = structuredClone(plan.dagPlan.components[0]!.bounds);
    });
  });

  it("rejects a label that overflows the page", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "label-bounds", (plan) => {
      plan.visualSpec.labels[0]!.bounds.x = plan.dagPlan.pageBounds.width;
    });
  });

  it("rejects overlapping labels", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "label-overlap", (plan) => {
      plan.visualSpec.labels[1]!.bounds = structuredClone(plan.visualSpec.labels[0]!.bounds);
    });
  });

  it("rejects non-finite geometry", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "component-bounds", (plan) => {
      plan.dagPlan.components[0]!.bounds.width = Number.NaN;
    });
  });

  it("rejects zero and negative dimensions", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "component-bounds", (plan) => {
      plan.dagPlan.components[0]!.bounds.width = 0;
    });
    expectBlockingFailure(publicationPlan(cnnGoldIr), "label-bounds", (plan) => {
      plan.visualSpec.labels[0]!.bounds.height = -1;
    });
  });

  it("rejects a route with a detached source endpoint", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "connection-route-endpoints", (plan) => {
      plan.dagPlan.connections[0]!.route[0]!.x -= 10;
    });
  });

  it("rejects a route with a detached target endpoint", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "connection-route-endpoints", (plan) => {
      const route = plan.dagPlan.connections[0]!.route;
      route[route.length - 1]!.x += 10;
    });
  });

  it("rejects a route outside the page", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "connection-route-bounds", (plan) => {
      plan.dagPlan.connections[0]!.route[0]!.x = -1;
    });
  });

  it("rejects a connection with a missing component", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "connection-components", (plan) => {
      plan.dagPlan.connections[0]!.target.nodeId = "missing-component";
    });
  });

  it("rejects a connection with a missing port", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "connection-ports", (plan) => {
      plan.dagPlan.connections[0]!.target.portId = "missing-port";
    });
  });

  it("rejects a component with an unknown evidence ID", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "component-evidence", (plan) => {
      plan.dagPlan.components[0]!.evidenceIds = ["missing-evidence"];
    });
  });

  it("rejects a source mapping with an unknown evidence ID", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "source-mappings", (plan) => {
      plan.dagPlan.sourceMappings[0]!.evidenceIds = ["missing-evidence"];
    });
  });

  it("rejects a source mapping for an unknown semantic ID", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "source-mappings", (plan) => {
      plan.dagPlan.sourceMappings[0]!.semanticId = "missing-semantic-id";
    });
  });

  it("rejects duplicate source mappings", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "source-mappings", (plan) => {
      plan.dagPlan.sourceMappings[1]!.semanticId = plan.dagPlan.sourceMappings[0]!.semanticId;
    });
  });

  it("rejects invalid page thresholds", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "page-constraints", (plan) => {
      plan.visualSpec.page.minMargin = -1;
    });
    expectBlockingFailure(publicationPlan(cnnGoldIr), "page-constraints", (plan) => {
      plan.visualSpec.page.minFontSizePt = 0;
    });
  });

  it("rejects incomplete label coverage", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "label-identity", (plan) => {
      plan.visualSpec.labels.pop();
    });
  });

  it("reports equivalent plans with deterministic checks", () => {
    const first = publicationPlan(residualGoldIr);
    const second = structuredClone(first);

    expect(runComposableDagVisualQa(first)).toEqual(runComposableDagVisualQa(second));
  });

  it("does not mutate the publication plan", () => {
    const plan = publicationPlan(residualGoldIr);
    const before = JSON.stringify(plan);

    runComposableDagVisualQa(plan);

    expect(JSON.stringify(plan)).toBe(before);
  });

  it("rejects a non-hex visual color", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "style-colors", (plan) => {
      plan.visualSpec.page.background = "white";
    });
  });

  it("rejects a missing component style", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "component-styles", (plan) => {
      delete plan.visualSpec.componentStyles.terminal;
    });
  });

  it("rejects a missing connection style", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "connection-styles", (plan) => {
      delete plan.visualSpec.connectionStyles.data;
    });
  });

  it("rejects an invalid grayscale pattern", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "style-grayscale", (plan) => {
      plan.visualSpec.componentStyles.terminal.grayscalePattern = "gradient" as never;
    });
  });

  it("rejects non-positive connection thickness", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "connection-style-thickness", (plan) => {
      plan.visualSpec.connectionStyles.data.thickness = 0;
    });
  });

  it("rejects insufficient visual contrast", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "style-contrast", (plan) => {
      plan.visualSpec.componentStyles.terminal.fill = "#111111";
      plan.visualSpec.componentStyles.terminal.stroke = "#222222";
    });
  });

  it("rejects grayscale-colliding connection relations", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "grayscale-collision", (plan) => {
      plan.visualSpec.componentStyles.operator.grayscalePattern = "solid";
    });
  });

  it("rejects duplicate label IDs", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "label-identity", (plan) => {
      plan.visualSpec.labels[1]!.id = plan.visualSpec.labels[0]!.id;
    });
  });

  it("rejects empty, multiline, and overlong label text", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "label-text", (plan) => {
      plan.visualSpec.labels[0]!.text = "";
    });
    expectBlockingFailure(publicationPlan(cnnGoldIr), "label-text", (plan) => {
      plan.visualSpec.labels[0]!.text = "line 1\nline 2";
    });
    expectBlockingFailure(publicationPlan(cnnGoldIr), "label-text", (plan) => {
      plan.visualSpec.labels[0]!.text = "x".repeat(129);
    });
  });

  it("rejects an unsupported style token", () => {
    expectBlockingFailure(publicationPlan(cnnGoldIr), "style-tokens", (plan) => {
      plan.visualSpec.componentStyles.unsupported = {
        fill: "#FFFFFF",
        stroke: "#000000",
        grayscalePattern: "solid",
      };
    });
  });
});
