import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePyTorchSourcePack } from "../src/source-pack.js";

function encodedSource(code: string): { data: string; sourceSha256: string } {
  const bytes = Buffer.from(code, "utf8");
  return {
    data: bytes.toString("base64"),
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function inputFor(code: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "source-1",
    name: "model.py",
    mimeType: "text/x-python",
    ...encodedSource(code),
    ...overrides,
  };
}

describe("parsePyTorchSourcePack", () => {
  it("decodes valid bounded Python source and returns only transient source metadata", () => {
    const result = parsePyTorchSourcePack(inputFor("class Model:\n    pass\n"));

    expect(result).toMatchObject({
      sourceId: "source-1",
      name: "model.py",
      kind: "pytorch-source",
      mimeType: "text/x-python",
      code: "class Model:\n    pass\n",
      bytes: 22,
    });
    expect(result).not.toHaveProperty("outputPath");
    expect(result).not.toHaveProperty("command");
  });

  it("accepts an uppercase SHA-256 supplied by a client", () => {
    const source = encodedSource("x = 1");

    expect(parsePyTorchSourcePack(inputFor("x = 1", { sourceSha256: source.sourceSha256.toUpperCase() })).sourceSha256)
      .toBe(source.sourceSha256.toUpperCase());
  });

  it("rejects a hash that does not match the decoded UTF-8 bytes", () => {
    expect(() => parsePyTorchSourcePack(inputFor("x = 1", { sourceSha256: "a".repeat(64) })))
      .toThrow(/sha-256|hash/i);
  });

  it("rejects unsupported MIME types and malformed base64", () => {
    expect(() => parsePyTorchSourcePack(inputFor("x = 1", { mimeType: "application/json" })))
      .toThrow(/mime/i);
    expect(() => parsePyTorchSourcePack({
      sourceId: "source-1",
      name: "model.py",
      mimeType: "text/x-python",
      data: "%%%not-base64%%%",
      sourceSha256: "a".repeat(64),
    })).toThrow(/base64/i);
  });

  it("rejects empty source and source over the UTF-8 byte budget", () => {
    expect(() => parsePyTorchSourcePack(inputFor(""))).toThrow(/empty/i);
    const oversized = "x".repeat(200_001);
    expect(() => parsePyTorchSourcePack(inputFor(oversized))).toThrow(/200000|size|large/i);
  });

  it("treats executable-looking source as data without executing it", () => {
    const code = "import os\nos.system('touch SHOULD_NOT_EXIST')\nreturn eval('x')\n";
    const result = parsePyTorchSourcePack(inputFor(code));

    expect(result.code).toBe(code);
  });
});
