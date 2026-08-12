import { describe, expect, it } from "vitest";
import { parseVisioWorkerRequest, parseVisioWorkerResponse } from "../src/visio-protocol.js";

describe("Visio Worker protocol", () => {
  it("accepts a version-one mock request and preserves the diagram payload", () => {
    const request = parseVisioWorkerRequest({
      protocolVersion: 1,
      requestId: "request-1",
      jobId: "job-1",
      mode: "mock",
      outputPath: "C:\\exports\\job-1.vsdx",
      diagram: { figure: { title: "CNN", stages: ["Input", "Output"] }, nodes: [], edges: [] },
    });

    expect(request.protocolVersion).toBe(1);
    expect(request.diagram.figure?.title).toBe("CNN");
  });

  it("rejects an unsupported protocol version and a non-vsdx output", () => {
    expect(() => parseVisioWorkerRequest({ protocolVersion: 2 })).toThrow(/protocolVersion/);
    expect(() => parseVisioWorkerRequest({
      protocolVersion: 1,
      requestId: "r",
      jobId: "j",
      mode: "mock",
      outputPath: "C:\\exports\\job-1.json",
      diagram: { nodes: [], edges: [] },
    })).toThrow(/outputPath/);
  });

  it("accepts only succeeded responses with a valid readback or failed responses with an error", () => {
    expect(parseVisioWorkerResponse({
      protocolVersion: 1,
      requestId: "r",
      jobId: "j",
      status: "succeeded",
      path: "C:\\x.vsdx",
      readback: { valid: true, shapeCount: 2, connectorCount: 1 },
      error: null,
    }).status).toBe("succeeded");

    expect(parseVisioWorkerResponse({
      protocolVersion: 1,
      requestId: "r",
      jobId: "j",
      status: "failed",
      path: null,
      readback: null,
      error: { code: "VISIO_UNAVAILABLE", message: "not installed" },
    }).status).toBe("failed");
  });
});
