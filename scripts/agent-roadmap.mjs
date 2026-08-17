import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const NODE_STATUSES = new Set([
  "planned",
  "active",
  "blocked",
  "awaiting_acceptance",
  "accepted",
  "deferred",
  "superseded",
]);

const EVIDENCE_KINDS = new Set([
  "test",
  "typecheck",
  "manual-visual-review",
  "real-host",
  "commit",
  "tag",
  "document",
]);
const BLOCKER_SEVERITIES = new Set(["low", "medium", "high"]);
const BLOCKER_STATUSES = new Set(["open", "closed"]);
const TRANSITIONS = new Map([
  ["planned", new Set(["active", "deferred", "superseded"])],
  ["active", new Set(["blocked", "awaiting_acceptance", "deferred", "superseded"])],
  ["blocked", new Set(["active", "deferred", "superseded"])],
  ["awaiting_acceptance", new Set(["active", "blocked", "accepted"])],
]);
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const MILESTONE_ID = /^M[1-9]\d*$/;
const NODE_ID = /^M[1-9]\d*\.[1-9]\d*$/;
const ACCEPTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SECRET_KEY = /(?:api[_-]?key|provider[_-]?key|password|secret|token|credential|authorization)/i;
const SECRET_VALUE = /(?:\b(?:sk|pk|rk)_[A-Za-z0-9_-]{8,}\b|\bAIza[A-Za-z0-9_-]{20,}\b|\bBearer\s+\S+)/i;

export class RoadmapValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RoadmapValidationError";
  }
}

function fail(message) {
  throw new RoadmapValidationError(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expectObject(value, label) {
  if (!isObject(value)) fail(`${label} must be an object.`);
  return value;
}

function expectExactKeys(value, allowed, label) {
  const object = expectObject(value, label);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(`${label} contains unknown field '${key}'.`);
  }
  return object;
}

function expectRequiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string.`);
  return value;
}

function expectArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}

function expectTimestamp(value, label) {
  const timestamp = expectRequiredString(value, label);
  if (!ISO_TIMESTAMP.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    fail(`${label} must be a UTC ISO-8601 timestamp.`);
  }
  return timestamp;
}

function assertNoSecretLikeValues(value, label = "state") {
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) fail(`${label} contains a secret-like value.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretLikeValues(entry, `${label}[${index}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) fail(`${label} contains sensitive field '${key}'.`);
      assertNoSecretLikeValues(entry, `${label}.${key}`);
    }
  }
}

function resolveRepositoryFile(root, reference, label) {
  const normalizedRoot = resolve(root);
  if (isAbsolute(reference)) fail(`${label} must be repository-relative.`);
  const candidate = resolve(normalizedRoot, reference);
  const pathFromRoot = relative(normalizedRoot, candidate);
  if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    fail(`${label} escapes the repository root.`);
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) fail(`${label} must resolve to an existing file.`);
  return pathFromRoot.split(sep).join("/");
}

function defaultCommitResolver(root, sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function validateProgram(program, root) {
  expectExactKeys(program, new Set(["id", "name", "branch", "architectureSpec"]), "program");
  expectRequiredString(program.id, "program.id");
  expectRequiredString(program.name, "program.name");
  expectRequiredString(program.branch, "program.branch");
  program.architectureSpec = resolveRepositoryFile(
    root,
    expectRequiredString(program.architectureSpec, "program.architectureSpec"),
    "program.architectureSpec",
  );
}

function validateMilestones(milestones) {
  const ids = new Set();
  for (const [index, milestone] of milestones.entries()) {
    expectExactKeys(milestone, new Set(["id", "title", "status"]), `milestones[${index}]`);
    const id = expectRequiredString(milestone.id, `milestones[${index}].id`);
    if (!MILESTONE_ID.test(id) || ids.has(id)) fail(`milestones[${index}].id must be a unique milestone ID.`);
    if (!NODE_STATUSES.has(milestone.status)) fail(`milestones[${index}].status is invalid.`);
    expectRequiredString(milestone.title, `milestones[${index}].title`);
    ids.add(id);
  }
  return ids;
}

function validateAcceptance(acceptance, label) {
  const ids = new Set();
  for (const [index, item] of acceptance.entries()) {
    expectExactKeys(item, new Set(["id", "text", "requiredEvidenceKinds"]), `${label}[${index}]`);
    const id = expectRequiredString(item.id, `${label}[${index}].id`);
    if (!ACCEPTANCE_ID.test(id) || ids.has(id)) fail(`${label}[${index}].id must be unique and valid.`);
    expectRequiredString(item.text, `${label}[${index}].text`);
    const kinds = expectArray(item.requiredEvidenceKinds, `${label}[${index}].requiredEvidenceKinds`);
    if (kinds.length === 0) fail(`${label}[${index}].requiredEvidenceKinds must not be empty.`);
    for (const kind of kinds) {
      if (typeof kind !== "string" || !EVIDENCE_KINDS.has(kind)) {
        fail(`${label}[${index}].requiredEvidenceKinds contains an invalid evidence kind.`);
      }
    }
    ids.add(id);
  }
  return ids;
}

function validateEvidence(evidence, acceptanceIds, root, resolveCommit, label) {
  for (const [index, record] of evidence.entries()) {
    const recordLabel = `${label}[${index}]`;
    expectExactKeys(record, new Set(["kind", "satisfies", "ref", "summary", "verifiedAt", "commit"]), recordLabel);
    if (typeof record.kind !== "string" || !EVIDENCE_KINDS.has(record.kind)) fail(`${recordLabel}.kind is invalid.`);
    const satisfies = expectArray(record.satisfies, `${recordLabel}.satisfies`);
    if (satisfies.length === 0) fail(`${recordLabel}.satisfies must not be empty.`);
    for (const acceptanceId of satisfies) {
      if (typeof acceptanceId !== "string" || !acceptanceIds.has(acceptanceId)) {
        fail(`${recordLabel}.satisfies references an unknown acceptance item.`);
      }
    }
    record.ref = resolveRepositoryFile(root, expectRequiredString(record.ref, `${recordLabel}.ref`), `${recordLabel}.ref`);
    expectRequiredString(record.summary, `${recordLabel}.summary`);
    expectTimestamp(record.verifiedAt, `${recordLabel}.verifiedAt`);
    const commit = expectRequiredString(record.commit, `${recordLabel}.commit`);
    if (!COMMIT_SHA.test(commit) || !resolveCommit(commit)) {
      fail(`${recordLabel}.commit must be a resolvable full 40-character commit SHA.`);
    }
  }
}

function validateTransition(node, label) {
  if (node.previousStatus === null) return;
  if (typeof node.previousStatus !== "string" || !NODE_STATUSES.has(node.previousStatus)) {
    fail(`${label}.previousStatus is invalid.`);
  }
  if (!TRANSITIONS.get(node.previousStatus)?.has(node.status)) {
    fail(`${label} has an illegal transition from '${node.previousStatus}' to '${node.status}'.`);
  }
}

function validateNodes(nodes, milestoneIds, root, resolveCommit) {
  const nodeIds = new Set();
  const nodeById = new Map();
  for (const [index, node] of nodes.entries()) {
    const label = `nodes[${index}]`;
    expectExactKeys(node, new Set([
      "id", "milestoneId", "title", "status", "previousStatus", "dependsOn", "outcome",
      "acceptance", "evidence", "nextAction", "blockerIds", "successorId",
    ]), label);
    const id = expectRequiredString(node.id, `${label}.id`);
    if (!NODE_ID.test(id) || nodeIds.has(id)) fail(`${label}.id must be a unique node ID.`);
    if (!milestoneIds.has(node.milestoneId)) fail(`${label}.milestoneId must reference a known milestone.`);
    if (!NODE_STATUSES.has(node.status)) fail(`${label}.status is invalid.`);
    validateTransition(node, label);
    expectRequiredString(node.title, `${label}.title`);
    expectRequiredString(node.outcome, `${label}.outcome`);
    expectRequiredString(node.nextAction, `${label}.nextAction`);
    const acceptance = expectArray(node.acceptance, `${label}.acceptance`);
    const acceptanceIds = validateAcceptance(acceptance, `${label}.acceptance`);
    const evidence = expectArray(node.evidence, `${label}.evidence`);
    validateEvidence(evidence, acceptanceIds, root, resolveCommit, `${label}.evidence`);
    const dependsOn = expectArray(node.dependsOn, `${label}.dependsOn`);
    const blockerIds = expectArray(node.blockerIds, `${label}.blockerIds`);
    if (node.successorId !== null && typeof node.successorId !== "string") fail(`${label}.successorId must be a node ID or null.`);
    nodeIds.add(id);
    nodeById.set(id, node);
  }

  for (const [id, node] of nodeById) {
    const dependsOn = new Set();
    for (const dependencyId of node.dependsOn) {
      if (typeof dependencyId !== "string" || !nodeById.has(dependencyId) || dependsOn.has(dependencyId)) {
        fail(`Node '${id}' has an absent or duplicate dependency.`);
      }
      dependsOn.add(dependencyId);
    }
    if (node.successorId !== null && (!nodeById.has(node.successorId) || node.successorId === id)) {
      fail(`Node '${id}' has an invalid successor.`);
    }
    if (node.status === "superseded" && node.successorId === null) fail(`Superseded node '${id}' needs a successor.`);
  }
  return nodeById;
}

function assertAcyclic(nodesById) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) fail(`Dependency cycle includes node '${id}'.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of nodesById.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of nodesById.keys()) visit(id);
}

function validateBlockers(blockers, nodesById) {
  const blockersById = new Map();
  for (const [index, blocker] of blockers.entries()) {
    const label = `blockers[${index}]`;
    expectExactKeys(blocker, new Set(["id", "nodeId", "severity", "summary", "resolution", "openedAt", "status"]), label);
    const id = expectRequiredString(blocker.id, `${label}.id`);
    if (blockersById.has(id)) fail(`${label}.id must be unique.`);
    if (!nodesById.has(blocker.nodeId)) fail(`${label}.nodeId must reference a known node.`);
    if (!BLOCKER_SEVERITIES.has(blocker.severity)) fail(`${label}.severity is invalid.`);
    if (!BLOCKER_STATUSES.has(blocker.status)) fail(`${label}.status is invalid.`);
    expectRequiredString(blocker.summary, `${label}.summary`);
    expectRequiredString(blocker.resolution, `${label}.resolution`);
    expectTimestamp(blocker.openedAt, `${label}.openedAt`);
    blockersById.set(id, blocker);
  }

  for (const [nodeId, node] of nodesById) {
    const seen = new Set();
    const referenced = node.blockerIds.map((blockerId) => {
      if (typeof blockerId !== "string" || !blockersById.has(blockerId) || seen.has(blockerId)) {
        fail(`Node '${nodeId}' has an absent or duplicate blocker.`);
      }
      seen.add(blockerId);
      const blocker = blockersById.get(blockerId);
      if (blocker.nodeId !== nodeId) fail(`Blocker '${blockerId}' does not belong to node '${nodeId}'.`);
      return blocker;
    });
    const openBlockers = referenced.filter((blocker) => blocker.status === "open");
    if (node.status === "blocked" && openBlockers.length === 0) fail(`Blocked node '${nodeId}' needs an open blocker.`);
    if (node.status !== "blocked" && openBlockers.length > 0) fail(`Only blocked nodes may reference open blockers.`);
  }
}

function validateAcceptedNodes(nodesById) {
  for (const [nodeId, node] of nodesById) {
    if (node.status !== "accepted") continue;
    if (!node.evidence.some((record) => COMMIT_SHA.test(record.commit))) {
      fail(`Accepted node '${nodeId}' lacks a full commit SHA evidence record.`);
    }
    for (const dependencyId of node.dependsOn) {
      if (nodesById.get(dependencyId).status !== "accepted") {
        fail(`Accepted node '${nodeId}' depends on non-accepted node '${dependencyId}'.`);
      }
    }
    for (const acceptance of node.acceptance) {
      const satisfyingRecords = node.evidence.filter((record) => record.satisfies.includes(acceptance.id));
      if (satisfyingRecords.length === 0) fail(`Accepted node '${nodeId}' lacks evidence for '${acceptance.id}'.`);
      const kinds = new Set(satisfyingRecords.map((record) => record.kind));
      for (const kind of acceptance.requiredEvidenceKinds) {
        if (!kinds.has(kind)) fail(`Accepted node '${nodeId}' lacks '${kind}' evidence for '${acceptance.id}'.`);
      }
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Validates and canonicalizes the local, repository-bound product roadmap ledger.
 * `options.isCommitResolvable` is intentionally injectable so fixture tests need no Git repository.
 */
export function validateProgramState(value, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const resolveCommit = options.isCommitResolvable ?? ((sha) => defaultCommitResolver(root, sha));
  const normalized = structuredClone(value);
  expectExactKeys(normalized, new Set(["schemaVersion", "program", "updatedAt", "currentFocus", "milestones", "nodes", "blockers"]), "state");
  if (normalized.schemaVersion !== 1) fail("state.schemaVersion must be 1.");
  assertNoSecretLikeValues(normalized);
  validateProgram(normalized.program, root);
  expectTimestamp(normalized.updatedAt, "state.updatedAt");
  const milestones = expectArray(normalized.milestones, "state.milestones");
  const milestoneIds = validateMilestones(milestones);
  const nodes = expectArray(normalized.nodes, "state.nodes");
  const nodesById = validateNodes(nodes, milestoneIds, root, resolveCommit);
  assertAcyclic(nodesById);
  validateBlockers(expectArray(normalized.blockers, "state.blockers"), nodesById);
  validateAcceptedNodes(nodesById);

  const focus = expectRequiredString(normalized.currentFocus, "state.currentFocus");
  const focusNode = nodesById.get(focus);
  if (!focusNode || ["accepted", "deferred", "superseded"].includes(focusNode.status)) {
    fail("state.currentFocus must reference an executable node.");
  }
  if (focusNode.status !== "blocked" && focusNode.dependsOn.some((id) => nodesById.get(id).status !== "accepted")) {
    fail("state.currentFocus has unresolved dependencies without a blocked state.");
  }
  return deepFreeze(normalized);
}

export function loadProgramState(root, options = {}) {
  const path = resolve(root, "docs", "agent-program-state.json");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new RoadmapValidationError(`Could not load agent roadmap ledger: ${error.message}`);
  }
  return validateProgramState(parsed, { ...options, root });
}

export function renderRoadmap(state) {
  const focus = state.nodes.find((node) => node.id === state.currentFocus);
  return [
    `# ${state.program.name} Roadmap`,
    "",
    `Branch: \`${state.program.branch}\``,
    "",
    "## Current Focus",
    "",
    `- ${focus.id}: ${focus.title}`,
    `- Status: ${focus.status}`,
    `- Next action: ${focus.nextAction}`,
    "",
  ].join("\n");
}

export function buildStatus(state, git = {}) {
  const currentFocus = state.nodes.find((node) => node.id === state.currentFocus);
  const executableNodes = state.nodes.filter((node) => node.status === "planned" && node.dependsOn.every((id) => state.nodes.find((candidate) => candidate.id === id)?.status === "accepted"));
  return deepFreeze({
    program: { name: state.program.name, branch: state.program.branch },
    currentFocus,
    executableNodes,
    blockers: state.blockers.filter((blocker) => blocker.status === "open"),
    git: structuredClone(git),
    warnings: [],
    strictFailures: [],
  });
}

export function verifyRoadmap(root, options = {}) {
  return loadProgramState(root, options);
}
