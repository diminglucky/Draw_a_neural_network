import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");

describe("project onboarding", () => {
  it("provides the mandatory cross-computer entry points", () => {
    const readme = readFileSync(resolve(projectRoot, "README.md"), "utf8");
    const startHere = readFileSync(
      resolve(projectRoot, "docs/START_HERE.md"),
      "utf8",
    );
    const agents = readFileSync(resolve(projectRoot, "AGENTS.md"), "utf8");

    expect(readme).toContain("docs/START_HERE.md");
    expect(startHere).toContain("agent");
    expect(startHere).toContain("P0");
    expect(startHere).toContain("authenticated static-linear PyTorch analysis");
    expect(startHere).toContain("does not execute user Python");
    expect(startHere).toContain("2026-08-17-universal-compiler-repair-and-migration-design.md");
    expect(readme).toContain("P0.0");
    expect(readme).toContain("real Windows/Visio acceptance remains separate");
    expect(startHere).toContain("不得将五个 grammar 宣称为通用支持");
    expect(agents).toContain("docs/START_HERE.md");
    expect(agents).toContain("真实 Windows/Visio");
  });
});
