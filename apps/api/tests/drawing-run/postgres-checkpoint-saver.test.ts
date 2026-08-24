import { describe, expect, it } from "vitest";
import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph";
import {
  InMemoryDrawingWorkflowCheckpointStore,
  PostgresDrawingWorkflowCheckpointSaver,
} from "../../src/drawing-run/postgres-checkpoint-saver.js";
import { createDrawingRunLangGraph, deriveDrawingWorkflowThreadId, runDrawingRunLangGraph } from "../../src/drawing-run/langgraph-workflow.js";
import type { DrawingWorkflowPendingWriteRecord, DrawingWorkflowCheckpointRecord } from "../../src/drawing-run/postgres-checkpoint-saver.js";

const identity = { ownerId: "owner-1", deviceId: "device-1", runId: "run-1", revision: 3 };
const threadId = deriveDrawingWorkflowThreadId(identity);
const config = { configurable: { owner_id: identity.ownerId, device_id: identity.deviceId, run_id: identity.runId, revision: identity.revision, thread_id: threadId, checkpoint_ns: "" } };
const metadata: CheckpointMetadata = { source: "input", step: -1, parents: {} };

function checkpoint(overrides: Record<string, unknown> = {}): Checkpoint {
  return {
    v: 4,
    id: "checkpoint-1",
    ts: "2026-08-22T00:00:00.000Z",
    channel_values: { runId: identity.runId, ownerId: identity.ownerId, deviceId: identity.deviceId, revision: identity.revision, phase: "received", artifactHashes: [], ...overrides },
    channel_versions: {},
    versions_seen: {},
  };
}

class DelayedCheckpointStore extends InMemoryDrawingWorkflowCheckpointStore {
  async putCheckpoint(record: DrawingWorkflowCheckpointRecord): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await super.putCheckpoint(record);
  }

  async putWrite(record: DrawingWorkflowPendingWriteRecord): Promise<void> {
    if (!(await this.getCheckpoint(record.identity, record.checkpointNamespace, record.checkpointId))) throw new Error("write arrived before checkpoint");
    await super.putWrite(record);
  }
}

describe("durable LangGraph checkpoint boundary", () => {
  it("restores a scoped checkpoint and pending writes through a new saver instance", async () => {
    const store = new InMemoryDrawingWorkflowCheckpointStore();
    const first = new PostgresDrawingWorkflowCheckpointSaver(store);
    await first.put(config, checkpoint(), metadata, {});
    await first.putWrites({ configurable: { ...config.configurable, checkpoint_id: "checkpoint-1" } }, [["safeChannel", { hash: "a".repeat(64) }]], "task-1");

    const second = new PostgresDrawingWorkflowCheckpointSaver(store);
    const restored = await second.getTuple({ configurable: { ...config.configurable, checkpoint_id: "checkpoint-1" } });
    expect(restored?.checkpoint.channel_values.phase).toBe("received");
    expect(restored?.pendingWrites).toEqual([["task-1", "safeChannel", { hash: "a".repeat(64) }]]);
  });

  it("fences concurrent checkpoint writes behind their parent checkpoint", async () => {
    const saver = new PostgresDrawingWorkflowCheckpointSaver(new DelayedCheckpointStore());
    const put = saver.put(config, checkpoint(), metadata, {});
    const writes = saver.putWrites({ configurable: { ...config.configurable, checkpoint_id: "checkpoint-1" } }, [["safeChannel", { hash: "a".repeat(64) }]], "task-1");
    await expect(Promise.all([put, writes])).resolves.toBeDefined();
  });

  it("rejects a checkpoint config whose identity is not bound to its thread", async () => {
    const saver = new PostgresDrawingWorkflowCheckpointSaver(new InMemoryDrawingWorkflowCheckpointStore());
    await expect(saver.put({ configurable: { ...config.configurable, owner_id: "owner-2" } }, checkpoint(), metadata, {})).rejects.toThrow(/thread_id/i);
    await expect(saver.getTuple({ configurable: { ...config.configurable, device_id: "device-2" } })).rejects.toThrow(/thread_id/i);
  });

  it("rejects private or native-control fields before serialization", async () => {
    const saver = new PostgresDrawingWorkflowCheckpointSaver(new InMemoryDrawingWorkflowCheckpointStore());
    await expect(saver.put(config, checkpoint({ rawSource: "class Secret: pass" }), metadata, {})).rejects.toThrow(/forbidden/i);
    await expect(saver.putWrites({ configurable: { ...config.configurable, checkpoint_id: "checkpoint-1" } }, [["writes", { providerPayload: "forbidden" }]], "task-1")).rejects.toThrow(/forbidden/i);
  });

  it("deletes only the derived thread and its pending writes", async () => {
    const store = new InMemoryDrawingWorkflowCheckpointStore();
    const saver = new PostgresDrawingWorkflowCheckpointSaver(store);
    await saver.put(config, checkpoint(), metadata, {});
    await expect(saver.deleteThread(threadId)).rejects.toThrow(/scope/i);
    await store.deleteThread(identity);
    await expect(saver.getTuple({ configurable: { ...config.configurable, checkpoint_id: "checkpoint-1" } })).resolves.toBeUndefined();
  });

  it("can run the LangGraph workflow against the scoped saver", async () => {
    const store = new InMemoryDrawingWorkflowCheckpointStore();
    const hash = "b".repeat(64);
    const graph = createDrawingRunLangGraph({
      checkpointer: new PostgresDrawingWorkflowCheckpointSaver(store),
      analyzer: { analyze: async () => ({ evidencePackHash: hash, needsInterpreter: false }) },
      harness: { assess: async () => ({ kind: "rejected" as const, errorCategory: "validation" as const }) },
      composer: { compose: async () => ({ pvpHash: hash, qaHash: hash }) },
    });
    const result = await runDrawingRunLangGraph(graph, { runId: identity.runId, ownerId: identity.ownerId, deviceId: identity.deviceId, revision: identity.revision, artifactHashes: [hash] });
    expect(result.phase).toBe("rejected");
  });
});
