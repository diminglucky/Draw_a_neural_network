import { describe, expect, it } from "vitest";
import { parseNetworkIR, validateNetworkIR } from "../src/network-ir.js";

function createValidIR(): any {
  return {
    figure: {
      id: "figure-cnn",
      title: "Simple CNN",
    },
    nodes: [
      {
        id: "input-1",
        kind: "input",
        label: "Input",
        stage: 0,
        confidence: 1,
        sourceEvidence: [{ type: "text", value: "input tensor" }],
      },
      {
        id: "conv-1",
        kind: "conv",
        label: "Conv 3x3",
        stage: 1,
        tensor: { shape: [224, 224, 64], dtype: "float32" },
        confidence: 0.92,
        sourceEvidence: [{ type: "code", value: "nn.Conv2d(3, 64, 3)" }],
      },
      {
        id: "pool-1",
        kind: "pool",
        label: "MaxPool",
        stage: 2,
        confidence: 0.87,
      },
      {
        id: "output-1",
        kind: "output",
        label: "Classifier",
        stage: 3,
        confidence: 0,
      },
    ],
    edges: [
      { source: "input-1", target: "conv-1", kind: "data", confidence: 1 },
      { source: "conv-1", target: "pool-1", kind: "data", confidence: 0.91 },
      { source: "pool-1", target: "output-1", kind: "data", confidence: 0.88 },
    ],
  };
}

describe("Network IR schema and validation", () => {
  it("accepts a valid IR and returns no validation issues", () => {
    const ir = createValidIR();

    const parsed = parseNetworkIR(ir);
    const validation = validateNetworkIR(ir);

    expect(parsed.figure.title).toBe("Simple CNN");
    expect(parsed.nodes).toHaveLength(4);
    expect(parsed.edges).toHaveLength(3);
    expect(parsed.nodes[3].confidence).toBe(0);
    expect(validation).toMatchObject({
      valid: true,
      issues: [],
    });
  });

  it("normalizes omitted optional fields", () => {
    const parsed = parseNetworkIR({
      figure: {
        id: "figure-minimal",
        title: "Minimal graph",
      },
      nodes: [
        { id: "input-1", kind: "input", label: "Input", stage: 0 },
        { id: "output-1", kind: "output", label: "Output", stage: 1 },
      ],
      edges: [{ source: "input-1", target: "output-1", kind: "data" }],
    });

    expect(parsed.groups).toEqual([]);
    expect(parsed.annotations).toEqual([]);
    expect(parsed.style).toEqual({});
    expect(parsed.layout).toEqual({});
    expect(parsed.nodes[0]).toMatchObject({
      tensor: null,
      confidence: null,
      sourceEvidence: [],
    });
    expect(parsed.edges[0]).toMatchObject({
      label: null,
      shape: null,
      skip: false,
      confidence: null,
      sourceEvidence: [],
    });
  });

  it("accepts a publication subtitle on nodes for tensor-shape captions", () => {
    const ir = createValidIR();
    ir.nodes[1].subtitle = "64 channels / stride 2";

    const parsed = parseNetworkIR(ir);

    expect(parsed.nodes[1].subtitle).toBe("64 channels / stride 2");
  });

  it("reports duplicate node ids", () => {
    const ir = createValidIR();
    ir.nodes[2].id = "conv-1";

    const validation = validateNetworkIR(ir);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate-node-id",
          path: "nodes[2].id",
          message: expect.stringContaining("conv-1"),
        }),
      ]),
    );
  });

  it("reports missing edge endpoints", () => {
    const ir = createValidIR();
    ir.edges[1].target = "missing-node";

    const validation = validateNetworkIR(ir);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-edge-endpoint",
          path: "edges[1].target",
          message: expect.stringContaining("missing-node"),
        }),
      ]),
    );
  });

  it("reports unreachable outputs", () => {
    const ir = createValidIR();
    ir.edges = [{ source: "input-1", target: "conv-1", kind: "data" }];

    const validation = validateNetworkIR(ir);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unreachable-output",
          path: "nodes[3]",
          message: expect.stringContaining("output-1"),
        }),
      ]),
    );
  });

  it("reports illegal self-loops", () => {
    const ir = createValidIR();
    ir.edges.push({ source: "conv-1", target: "conv-1", kind: "skip" });

    const validation = validateNetworkIR(ir);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "illegal-self-loop",
          path: "edges[3]",
          message: expect.stringContaining("conv-1"),
        }),
      ]),
    );
  });

  it("accepts confidence values at the boundaries", () => {
    const ir = createValidIR();
    ir.nodes[0].confidence = 0;
    ir.nodes[3].confidence = 1;
    ir.edges[0].confidence = 0;
    ir.edges[2].confidence = 1;

    const validation = validateNetworkIR(ir);

    expect(validation).toMatchObject({
      valid: true,
      issues: [],
    });
  });

  it("rejects confidence values outside the inclusive range", () => {
    const ir = createValidIR();
    ir.nodes[1].confidence = 1.01;

    const validation = validateNetworkIR(ir);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "nodes[1].confidence",
        }),
      ]),
    );
    expect(validation.issues.some((issue) => issue.code.startsWith("schema:"))).toBe(true);
  });
});
