import { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { PostgresFoundationStore, type PoolLike } from "./postgres-store.js";
import { InMemoryFoundationStore } from "./store.js";
import type { FoundationStore } from "./store.js";
import { InMemoryPrivateReceiptStore, PostgresPrivateReceiptStore, type PrivateReceiptStore } from "./drawing-input/private-receipt.js";
import { InMemoryEvidencePackStore } from "./drawing-input/intent.js";
import { InMemoryLocalProposalStore, type LocalProposalStore } from "./drawing-input/structural-harness.js";
import { PostgresEvidencePackStore, PostgresLocalProposalStore } from "./drawing-input/postgres-input-stores.js";
import type { EvidencePackStore } from "./drawing-input/intent.js";
import { InMemoryDrawingArtifactStore, type DrawingArtifactStore } from "./drawing-input/drawing-artifacts.js";
import { PostgresDrawingArtifactStore } from "./drawing-input/postgres-drawing-artifacts.js";
import { PostgresDrawingWorkflowCheckpointSaver, PostgresDrawingWorkflowCheckpointStore } from "./drawing-run/postgres-checkpoint-saver.js";
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";

export interface FoundationStoreHandle {
  store: FoundationStore;
  privateReceiptStore: PrivateReceiptStore;
  evidencePackStore: EvidencePackStore;
  localProposalStore: LocalProposalStore;
  drawingArtifactStore: DrawingArtifactStore;
  drawingWorkflowCheckpointer: BaseCheckpointSaver;
  close(): Promise<void>;
}

export async function createFoundationStore(config: AppConfig): Promise<FoundationStoreHandle> {
  if (config.storageDriver === "memory") {
    return {
      store: new InMemoryFoundationStore(),
      privateReceiptStore: new InMemoryPrivateReceiptStore(),
      evidencePackStore: new InMemoryEvidencePackStore(),
      localProposalStore: new InMemoryLocalProposalStore(),
      drawingArtifactStore: new InMemoryDrawingArtifactStore(),
      drawingWorkflowCheckpointer: new MemorySaver(),
      close: async () => {},
    };
  }
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  }
  const pool = new Pool({ connectionString: config.databaseUrl });
  const store = new PostgresFoundationStore(pool as unknown as PoolLike);
  const checkpointStore = new PostgresDrawingWorkflowCheckpointStore(pool as unknown as PoolLike);
  return {
    store,
    privateReceiptStore: new PostgresPrivateReceiptStore(pool as unknown as PoolLike),
    evidencePackStore: new PostgresEvidencePackStore(pool as unknown as PoolLike),
    localProposalStore: new PostgresLocalProposalStore(pool as unknown as PoolLike),
    drawingArtifactStore: new PostgresDrawingArtifactStore(pool as unknown as PoolLike),
    drawingWorkflowCheckpointer: new PostgresDrawingWorkflowCheckpointSaver(checkpointStore),
    close: () => store.close(),
  };
}
