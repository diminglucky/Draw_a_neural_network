import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const cli = resolve(root, "scripts", "agent-roadmap-cli.mjs");

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
});
