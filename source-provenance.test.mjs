import assert from "node:assert/strict";
import test from "node:test";
import { rankProvenanceSources, validateSourceProvenance } from "./source-provenance.mjs";

test("accepts pinned hashed repository evidence and ranks stronger authority first", () => {
  const official = { id: "official", kind: "repository", uri: "https://github.com/org/model", revision: "a".repeat(40), sha256: "1".repeat(64), authority: 4 };
  const mirror = { id: "mirror", kind: "repository", uri: "https://github.com/mirror/model", revision: "b".repeat(40), sha256: "2".repeat(64), authority: 2 };
  assert.equal(validateSourceProvenance(official).ok, true);
  assert.deepEqual(rankProvenanceSources([mirror, official]).map((source) => source.id), ["official", "mirror"]);
});

test("rejects mutable or unhashed remote sources", () => {
  assert.deepEqual(validateSourceProvenance({ kind: "repository", uri: "https://github.com/org/model", revision: "main", sha256: "1".repeat(64), authority: 4 }).issues.map((issue) => issue.code), ["mutable-revision"]);
  assert.ok(validateSourceProvenance({ kind: "config", uri: "https://example.test/model.yaml", revision: "abc123", authority: 3 }).issues.some((issue) => issue.code === "invalid-source-hash"));
});

test("rejects a declared hash that does not match acquired content", () => {
  const validation = validateSourceProvenance({
    kind: "config",
    uri: "https://example.test/model.yaml",
    revision: "abc1234",
    content: "layers: []",
    sha256: "1".repeat(64),
    authority: 3,
  });
  assert.ok(validation.issues.some((issue) => issue.code === "source-hash-mismatch"));
});

test("blocks conflicting facts from a weaker source instead of silently merging them", () => {
  const sources = [
    { id: "official", authority: 4, claims: [{ subjectId: "head", predicate: "repeat", value: 3 }] },
    { id: "mirror", authority: 2, claims: [{ subjectId: "head", predicate: "repeat", value: 4 }] },
  ];
  const ranked = rankProvenanceSources(sources);
  assert.equal(ranked.blocked, true);
  assert.equal(ranked.diagnostics[0].code, "stronger-source-conflict");
});
