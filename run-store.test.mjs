import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRunStore } from "./run-store.mjs";

test("memory Run Store gets and sets independent run snapshots", async () => {
  const store = createMemoryRunStore();
  const run = { id: "run-1", status: "ready", snapshots: [] };
  await store.set(run.id, run);

  run.status = "changed-outside-store";
  const loaded = await store.get(run.id);
  assert.equal(loaded.status, "ready");

  loaded.status = "changed-after-get";
  assert.equal((await store.get(run.id)).status, "ready");
});

test("memory Run Store appends snapshots and deletes runs", async () => {
  const store = createMemoryRunStore();
  await store.set("run-1", { id: "run-1", snapshots: [] });

  const appended = await store.appendSnapshot("run-1", { stage: "inspect", value: { source: "x" } });
  assert.deepEqual(appended, { stage: "inspect", value: { source: "x" } });
  assert.deepEqual((await store.get("run-1")).snapshots, [appended]);

  assert.equal(await store.delete("run-1"), true);
  assert.equal(await store.get("run-1"), undefined);
  assert.equal(await store.delete("run-1"), false);
});
