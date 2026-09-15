import assert from "node:assert/strict";
import test from "node:test";
import { createArchitectureEvidencePackage, validateArchitectureEvidencePackage } from "./architecture-evidence-package.mjs";

const source = { kind: "config", uri: "https://example.test/model.yaml", revision: "abc123", path: "model.yaml", content: "layers: []", license: "MIT", authority: 3 };

test("creates stable hashed sources and normalized claims", () => {
  const first = createArchitectureEvidencePackage({
    request: { kind: "repository", requestedIdentity: "example" },
    identity: { resolvedName: "Example", repository: "https://example.test/repo", revision: "abc123" },
    sources: [source],
    claims: [{ subjectId: "node-1", predicate: "operator", value: "Conv", sourceIds: [], confidence: 0.95, status: "grounded" }],
    graph: { nodes: [{ id: "node-1" }], edges: [], ports: [], tensors: [], containers: [] },
  });
  const second = createArchitectureEvidencePackage({ sources: [source] });
  assert.equal(first.version, "architecture-evidence-package/v1");
  assert.match(first.sources[0].id, /^source-/);
  assert.match(first.sources[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.sources[0].authority, 3);
  assert.equal(first.sources[0].id, second.sources[0].id);
  assert.deepEqual(first.claims[0].sourceIds, [first.sources[0].id]);
  assert.equal(validateArchitectureEvidencePackage(first).ok, true);
});

test("rejects mutable sources, invalid claim states, and contradictory grounded topology", () => {
  const pkg = createArchitectureEvidencePackage({
    sources: [{ ...source, revision: "" }],
    claims: [
      { id: "a", subjectId: "edge-1", predicate: "target", value: "node-a", status: "grounded", confidence: 1 },
      { id: "b", subjectId: "edge-1", predicate: "target", value: "node-b", status: "grounded", confidence: 1 },
      { id: "c", subjectId: "node-1", predicate: "operator", value: "Conv", status: "accepted", confidence: 1 },
    ],
  });
  const validation = validateArchitectureEvidencePackage(pkg);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "mutable-source"));
  assert.ok(validation.issues.some((issue) => issue.code === "invalid-claim-status"));
  assert.ok(validation.issues.some((issue) => issue.code === "contradicted-claim"));
});
