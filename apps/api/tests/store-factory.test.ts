import { describe, expect, it } from "vitest";
import { createFoundationStore } from "../src/store-factory.js";
import { loadConfig } from "../src/config.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { PostgresFoundationStore } from "../src/postgres-store.js";
import { InMemoryPrivateReceiptStore, PostgresPrivateReceiptStore } from "../src/drawing-input/private-receipt.js";
import { InMemoryEvidencePackStore } from "../src/drawing-input/intent.js";
import { InMemoryLocalProposalStore } from "../src/drawing-input/structural-harness.js";
import { PostgresEvidencePackStore, PostgresLocalProposalStore } from "../src/drawing-input/postgres-input-stores.js";
import { InMemoryDrawingArtifactStore } from "../src/drawing-input/drawing-artifacts.js";
import { PostgresDrawingArtifactStore } from "../src/drawing-input/postgres-drawing-artifacts.js";
import { PostgresDrawingWorkflowCheckpointSaver } from "../src/drawing-run/postgres-checkpoint-saver.js";
import { MemorySaver } from "@langchain/langgraph";
import { InMemoryGenericPlanSnapshotStore } from "../src/generic-plan-snapshot-store.js";
import { PostgresGenericPlanSnapshotStore } from "../src/postgres-generic-plan-snapshot-store.js";

describe("foundation store factory", () => {
  it("selects the memory store only for an explicit memory configuration", async () => {
    const handle = await createFoundationStore(loadConfig({ NODE_ENV: "test", STORAGE_DRIVER: "memory", SESSION_SECRET: "test-session-secret-test-session-secret" }));
    expect(handle.store).toBeInstanceOf(InMemoryFoundationStore);
    expect(handle.privateReceiptStore).toBeInstanceOf(InMemoryPrivateReceiptStore);
    expect(handle.evidencePackStore).toBeInstanceOf(InMemoryEvidencePackStore);
    expect(handle.localProposalStore).toBeInstanceOf(InMemoryLocalProposalStore);
    expect(handle.drawingArtifactStore).toBeInstanceOf(InMemoryDrawingArtifactStore);
    expect(handle.drawingWorkflowCheckpointer).toBeInstanceOf(MemorySaver);
    expect(handle.genericPlanSnapshotStore).toBeInstanceOf(InMemoryGenericPlanSnapshotStore);
    await handle.close();
  });

  it("selects PostgreSQL without silently falling back to memory", async () => {
    const handle = await createFoundationStore(loadConfig({
      NODE_ENV: "development",
      STORAGE_DRIVER: "postgres",
      DATABASE_URL: "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio",
      SESSION_SECRET: "development-secret-development-secret",
    }));
    expect(handle.store).toBeInstanceOf(PostgresFoundationStore);
    expect(handle.privateReceiptStore).toBeInstanceOf(PostgresPrivateReceiptStore);
    expect(handle.evidencePackStore).toBeInstanceOf(PostgresEvidencePackStore);
    expect(handle.localProposalStore).toBeInstanceOf(PostgresLocalProposalStore);
    expect(handle.drawingArtifactStore).toBeInstanceOf(PostgresDrawingArtifactStore);
    expect(handle.drawingWorkflowCheckpointer).toBeInstanceOf(PostgresDrawingWorkflowCheckpointSaver);
    expect(handle.genericPlanSnapshotStore).toBeInstanceOf(PostgresGenericPlanSnapshotStore);
    await handle.close();
  });
});
