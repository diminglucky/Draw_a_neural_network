import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildStatus, loadProgramState, renderRoadmap } from "./agent-roadmap.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const roadmapPath = resolve(root, "docs", "ROADMAP.md");

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function gitHealth() {
  const branch = git(["branch", "--show-current"]);
  const head = git(["rev-parse", "HEAD"]);
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const divergence = upstream ? git(["rev-list", "--left-right", "--count", `HEAD...${upstream}`]) : null;
  const [ahead = "0", behind = "0"] = divergence?.split(/\s+/) ?? [];
  return {
    branch,
    head,
    upstream,
    ahead: Number(ahead),
    behind: Number(behind),
    dirty: Boolean(git(["status", "--porcelain"])),
    detached: !branch,
  };
}

function load() {
  return loadProgramState(root);
}

function parity(state) {
  const expected = renderRoadmap(state);
  const actual = existsSync(roadmapPath) ? readFileSync(roadmapPath, "utf8") : null;
  return { matches: actual === expected, expected };
}

function strictFailures(status, state, roadmapMatches) {
  const failures = [];
  if (status.git.branch !== state.program.branch) failures.push(`expected branch '${state.program.branch}'`);
  if (status.git.detached) failures.push("detached HEAD");
  if (!status.git.upstream) failures.push("missing upstream branch");
  if (status.git.ahead !== 0 || status.git.behind !== 0) failures.push("branch diverges from upstream");
  if (!roadmapMatches) failures.push("generated roadmap is out of date");
  return failures;
}

function printHuman(status, roadmapMatches) {
  const focus = status.currentFocus;
  const lines = [
    `${status.program.name}`,
    `Branch: ${status.git.branch ?? "detached"}  HEAD: ${status.git.head ?? "unknown"}`,
    `Focus: ${focus.id} - ${focus.title}`,
    `Status: ${focus.status}`,
    `Next action: ${focus.nextAction}`,
    `Executable: ${status.executableNodes.map((node) => node.id).join(", ") || "none"}`,
    `Open blockers: ${status.blockers.map((blocker) => blocker.id).join(", ") || "none"}`,
    `Roadmap parity: ${roadmapMatches ? "ok" : "drift"}`,
  ];
  if (status.warnings.length > 0) lines.push(`Warnings: ${status.warnings.join("; ")}`);
  if (status.strictFailures.length > 0) lines.push(`Strict failures: ${status.strictFailures.join("; ")}`);
  return lines.join("\n");
}

function run(command, args) {
  let state;
  try {
    state = load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
    return;
  }

  if (command === "render") {
    writeFileSync(roadmapPath, renderRoadmap(state), "utf8");
    console.log(`Rendered docs/ROADMAP.md from docs/agent-program-state.json`);
    return;
  }

  const parityResult = parity(state);
  if (command === "verify") {
    const gitState = gitHealth();
    const status = buildStatus(state, gitState);
    const failures = args.includes("--ci")
      ? (parityResult.matches ? [] : ["generated roadmap is out of date"])
      : strictFailures(status, state, parityResult.matches);
    if (failures.length > 0) {
      for (const failure of failures) console.error(`Roadmap verification failed: ${failure}.`);
      process.exitCode = 1;
    }
    return;
  }

  if (command !== "status") {
    console.error("Usage: node scripts/agent-roadmap-cli.mjs <status|render|verify> [--json|--strict]");
    process.exitCode = 1;
    return;
  }

  const gitState = gitHealth();
  const strict = args.includes("--strict");
  const baseStatus = buildStatus(state, gitState);
  const status = {
    ...baseStatus,
    warnings: [...baseStatus.warnings],
    strictFailures: [...baseStatus.strictFailures],
  };
  status.warnings.push(...(gitState.dirty ? ["working tree has changes"] : []));
  status.strictFailures.push(...strictFailures(status, state, parityResult.matches));
  if (args.includes("--json")) {
    console.log(JSON.stringify(status));
  } else {
    console.log(printHuman(status, parityResult.matches));
  }
  if (strict && status.strictFailures.length > 0) process.exitCode = 1;
}

const [command = "status", ...args] = process.argv.slice(2);
run(command, args);
