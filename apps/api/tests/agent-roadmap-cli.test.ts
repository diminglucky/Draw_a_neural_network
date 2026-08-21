import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const cli = resolve(root, "scripts", "agent-roadmap-cli.mjs");
const programStatePath = resolve(root, "docs", "agent-program-state.json");

function run(...args: string[]): string {
  return execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

describe("agent roadmap CLI", () => {
  it("reports the repository-bound current focus as stable JSON", () => {
    const status = JSON.parse(run("status", "--json")) as {
      currentFocus: { id: string };
      executableNodes: Array<{ id: string }>;
      git: { branch: string; ahead: number; behind: number };
      strictFailures: string[];
    };
    expect(status.currentFocus.id).toBe("M2.11");
    expect(status.currentFocus).toMatchObject({ status: "awaiting_acceptance" });
    expect(status.executableNodes.map((node) => node.id)).toEqual([]);
    expect(status.git).toMatchObject({ branch: "agent", behind: 0 });
    expect(status.strictFailures).toEqual(status.git.ahead > 0 ? ["branch diverges from upstream"] : []);
    expect(JSON.stringify(status)).not.toMatch(/[A-Za-z]:\\/);
  });

  it("verifies the generated roadmap while reporting branch divergence separately", () => {
    expect(run("verify")).toBe("");
    expect(run("verify", "--ci")).toBe("");
    expect(run("status")).toContain("Roadmap parity: ok");
  }, 15_000);

  it("reserves the Core Drawing V1 nodes without advancing the awaiting-acceptance focus", () => {
    const state = JSON.parse(readFileSync(programStatePath, "utf8")) as {
      currentFocus: string;
      nodes: Array<{ id: string; title: string; status: string; dependsOn: string[]; acceptance: unknown[]; nextAction: string }>;
    };

    expect(state.currentFocus).toBe("M2.11");
    const interpretation = state.nodes.find((node) => node.id === "M2.12");
    expect(interpretation).toMatchObject({
      title: "Evidence-augmented architecture interpretation",
      status: "planned",
      dependsOn: ["M2.8", "M2.10", "M2.11"],
    });
    expect(interpretation?.acceptance).toHaveLength(1);
    expect(interpretation?.nextAction).toMatch(/M2\.8.*M2\.10.*M2\.11/i);

    const visualGrammar = state.nodes.find((node) => node.id === "M2.13");
    expect(visualGrammar).toMatchObject({
      title: "Publication visual grammar and acceptance corpus",
      status: "planned",
      dependsOn: ["M2.12"],
    });
    expect(visualGrammar?.acceptance).toHaveLength(1);
    expect(visualGrammar?.nextAction).toMatch(/M2\.12/i);
  });
});
