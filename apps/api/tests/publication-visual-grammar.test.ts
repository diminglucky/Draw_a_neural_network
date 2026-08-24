import { describe, expect, it } from "vitest";
import {
  getPublicationVisualGrammar,
  isPublicationVisualPrimitiveKind,
} from "../src/publication-visual-grammar.js";

describe("publication visual grammar", () => {
  it("defines renderer-neutral descriptors for every publication primitive", () => {
    const grammar = getPublicationVisualGrammar();

    expect(grammar.map((descriptor) => descriptor.kind)).toEqual([
      "InputTerminal",
      "OutputTerminal",
      "TensorStage",
      "TensorVolume",
      "OperatorFrame",
      "ModuleFrame",
      "RepeatBadge",
      "SplitMarker",
      "AddMarker",
      "ConcatMarker",
      "AttentionTokenStrip",
      "AttentionRelation",
      "CandidateCallout",
    ]);
    expect(grammar.find((descriptor) => descriptor.kind === "TensorVolume")).toMatchObject({
      regionRole: "scale_transition",
      requiredPorts: ["input", "output"],
      geometry: { frontFace: "required", depthFace: "required" },
      nativeSupport: "supported",
    });
    expect(grammar.find((descriptor) => descriptor.kind === "AddMarker")).toMatchObject({
      requiredPorts: ["input-0", "input-1", "output"],
    });
    expect(grammar.find((descriptor) => descriptor.kind === "AttentionTokenStrip")).toMatchObject({
      geometry: { orderedCells: "required" },
    });
    expect(isPublicationVisualPrimitiveKind("UnknownBox")).toBe(false);
  });
});
