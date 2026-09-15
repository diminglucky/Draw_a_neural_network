import assert from "node:assert/strict";
import test from "node:test";
import { resolveArchitectureRequest } from "./architecture-resolver.mjs";

const registry = [
  { id: "detector-v8", names: ["Acme Detector v8", "detector"], repository: "https://github.com/acme/detector", revision: "a".repeat(40), configPath: "models/v8.yaml", authority: 4 },
  { id: "detector-v9", names: ["Acme Detector v9", "detector"], repository: "https://github.com/acme/detector", revision: "b".repeat(40), configPath: "models/v9.yaml", authority: 4 },
];

test("returns candidates for an ambiguous alias without fabricating topology", async () => {
  const result = await resolveArchitectureRequest({ kind: "prompt", prompt: "draw detector" }, { registry });
  assert.equal(result.status, "needs_resolution");
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["detector-v8", "detector-v9"]);
  assert.equal("nodes" in result, false);
  assert.equal("edges" in result, false);
});

test("resolves an exact registered identity and acquires only its pinned source", async () => {
  const calls = [];
  const result = await resolveArchitectureRequest({ kind: "prompt", prompt: "Acme Detector v8" }, {
    registry,
    fetchRepository: async (request) => {
      calls.push(request);
      return { content: "layers: []", license: "MIT" };
    },
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.identity.id, "detector-v8");
  assert.equal(result.sources[0].revision, "a".repeat(40));
  assert.equal(result.sources[0].path, "models/v8.yaml");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].revision, "a".repeat(40));
});

test("rejects resolver registry entries that contain topology or layout templates", async () => {
  for (const forbidden of [{ nodes: [] }, { edges: [] }, { layout: {} }]) {
    await assert.rejects(
      resolveArchitectureRequest({ kind: "prompt", prompt: "Model X" }, { registry: [{ id: "x", names: ["Model X"], repository: "https://example.test/x", revision: "a".repeat(40), ...forbidden }] }),
      /source locator only/,
    );
  }
});

test("requires pinned revisions before repository acquisition", async () => {
  let fetched = false;
  const result = await resolveArchitectureRequest({ kind: "repository", repository: "https://github.com/acme/detector", revision: "main", entryPoint: "model.py" }, {
    fetchRepository: async () => { fetched = true; return { content: "x" }; },
  });
  assert.equal(result.status, "invalid_source");
  assert.equal(fetched, false);
  assert.ok(result.diagnostics.some((item) => item.code === "mutable-revision"));
});

test("rejects acquired repository content when its declared hash is false", async () => {
  const result = await resolveArchitectureRequest({ kind: "repository", repository: "https://github.com/acme/detector", revision: "a".repeat(40), entryPoint: "model.py" }, {
    fetchRepository: async () => ({ content: "real content", sha256: "1".repeat(64) }),
  });
  assert.equal(result.status, "invalid_source");
  assert.ok(result.diagnostics.some((item) => item.code === "source-hash-mismatch"));
});
