import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from "@langchain/langgraph";
import type { CheckpointListOptions, PendingWrite } from "@langchain/langgraph-checkpoint";
import type { PoolLike } from "../postgres-store.js";
import { deriveDrawingWorkflowThreadId, type DrawingWorkflowCheckpointIdentity } from "./langgraph-workflow.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/i;
const WORKFLOW_CHANNELS = new Set([
  "runId", "ownerId", "deviceId", "revision", "phase", "artifactHashes", "evidencePackHash",
  "needsInterpreter", "proposalHash", "assessment", "pvpHash", "qaHash", "pauseReason",
  "clarificationAnswerHash",
]);
const SENSITIVE_KEY = /rawsource|imagebytes|providerpayload|pagetarget|comcommand|workerrequest|localgraphid|receiptid|contenthandle|credential|password|secret/i;
const MAX_CHECKPOINT_BYTES = 1_048_576;
const MAX_METADATA_BYTES = 262_144;
const MAX_WRITE_BYTES = 262_144;

export interface DrawingWorkflowCheckpointRecord {
  identity: DrawingWorkflowCheckpointIdentity;
  threadId: string;
  checkpointNamespace: string;
  checkpointId: string;
  parentCheckpointId: string | null;
  checkpointType: string;
  checkpointData: Uint8Array;
  metadataType: string;
  metadataData: Uint8Array;
  createdAt: string;
}

export interface DrawingWorkflowPendingWriteRecord {
  identity: DrawingWorkflowCheckpointIdentity;
  threadId: string;
  checkpointNamespace: string;
  checkpointId: string;
  taskId: string;
  writeIndex: number;
  channel: string;
  valueType: string;
  valueData: Uint8Array;
}

export interface DrawingWorkflowCheckpointStore {
  putCheckpoint(record: DrawingWorkflowCheckpointRecord): Promise<void>;
  getCheckpoint(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string, checkpointId: string): Promise<DrawingWorkflowCheckpointRecord | null>;
  listCheckpoints(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string): Promise<DrawingWorkflowCheckpointRecord[]>;
  putWrite(record: DrawingWorkflowPendingWriteRecord): Promise<void>;
  listWrites(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string, checkpointId: string): Promise<DrawingWorkflowPendingWriteRecord[]>;
  deleteThread(identity: DrawingWorkflowCheckpointIdentity): Promise<void>;
}

export class InMemoryDrawingWorkflowCheckpointStore implements DrawingWorkflowCheckpointStore {
  private readonly checkpoints = new Map<string, DrawingWorkflowCheckpointRecord>();
  private readonly writes = new Map<string, DrawingWorkflowPendingWriteRecord>();

  async putCheckpoint(record: DrawingWorkflowCheckpointRecord): Promise<void> {
    this.checkpoints.set(this.checkpointKey(record), cloneCheckpointRecord(record));
  }

  async getCheckpoint(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string, checkpointId: string): Promise<DrawingWorkflowCheckpointRecord | null> {
    const record = this.checkpoints.get(this.key(identity, checkpointNamespace, checkpointId));
    return record ? cloneCheckpointRecord(record) : null;
  }

  async listCheckpoints(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string): Promise<DrawingWorkflowCheckpointRecord[]> {
    return [...this.checkpoints.values()]
      .filter((record) => sameIdentity(record.identity, identity) && record.checkpointNamespace === checkpointNamespace)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.checkpointId.localeCompare(left.checkpointId))
      .map(cloneCheckpointRecord);
  }

  async putWrite(record: DrawingWorkflowPendingWriteRecord): Promise<void> {
    const key = `${this.checkpointKey(record)},${record.taskId},${record.writeIndex}`;
    if (!this.writes.has(key) || record.writeIndex < 0) this.writes.set(key, cloneWriteRecord(record));
  }

  async listWrites(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string, checkpointId: string): Promise<DrawingWorkflowPendingWriteRecord[]> {
    return [...this.writes.values()]
      .filter((record) => sameIdentity(record.identity, identity) && record.checkpointNamespace === checkpointNamespace && record.checkpointId === checkpointId)
      .sort((left, right) => left.taskId.localeCompare(right.taskId) || left.writeIndex - right.writeIndex)
      .map(cloneWriteRecord);
  }

  async deleteThread(identity: DrawingWorkflowCheckpointIdentity): Promise<void> {
    for (const [key, record] of this.checkpoints) if (sameIdentity(record.identity, identity)) this.checkpoints.delete(key);
    for (const [key, record] of this.writes) if (sameIdentity(record.identity, identity)) this.writes.delete(key);
  }

  private checkpointKey(record: { identity: DrawingWorkflowCheckpointIdentity; checkpointNamespace: string; checkpointId: string }): string {
    return this.key(record.identity, record.checkpointNamespace, record.checkpointId);
  }

  private key(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string, checkpointId: string): string {
    return `${identity.ownerId}\u0000${identity.deviceId}\u0000${identity.runId}\u0000${identity.revision}\u0000${checkpointNamespace}\u0000${checkpointId}`;
  }
}

export class PostgresDrawingWorkflowCheckpointStore implements DrawingWorkflowCheckpointStore {
  constructor(private readonly pool: PoolLike) {}

  async putCheckpoint(record: DrawingWorkflowCheckpointRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO drawing_workflow_checkpoints
       (owner_id, device_id, run_id, revision, thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        checkpoint_type, checkpoint_data, metadata_type, metadata_data, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (owner_id, device_id, run_id, revision, checkpoint_ns, checkpoint_id)
       DO UPDATE SET parent_checkpoint_id = EXCLUDED.parent_checkpoint_id,
                     checkpoint_type = EXCLUDED.checkpoint_type,
                     checkpoint_data = EXCLUDED.checkpoint_data,
                     metadata_type = EXCLUDED.metadata_type,
                     metadata_data = EXCLUDED.metadata_data,
                     created_at = EXCLUDED.created_at`,
      [
        record.identity.ownerId, record.identity.deviceId, record.identity.runId, record.identity.revision,
        record.threadId, record.checkpointNamespace, record.checkpointId, record.parentCheckpointId,
        record.checkpointType, Buffer.from(record.checkpointData), record.metadataType, Buffer.from(record.metadataData), record.createdAt,
      ],
    );
  }

  async getCheckpoint(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string, checkpointId: string): Promise<DrawingWorkflowCheckpointRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM drawing_workflow_checkpoints
       WHERE owner_id = $1 AND device_id = $2 AND run_id = $3 AND revision = $4 AND checkpoint_ns = $5 AND checkpoint_id = $6`,
      [identity.ownerId, identity.deviceId, identity.runId, identity.revision, checkpointNamespace, checkpointId],
    );
    return result.rows[0] ? mapCheckpointRow(result.rows[0]) : null;
  }

  async listCheckpoints(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string): Promise<DrawingWorkflowCheckpointRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM drawing_workflow_checkpoints
       WHERE owner_id = $1 AND device_id = $2 AND run_id = $3 AND revision = $4 AND checkpoint_ns = $5
       ORDER BY created_at DESC, checkpoint_id DESC`,
      [identity.ownerId, identity.deviceId, identity.runId, identity.revision, checkpointNamespace],
    );
    return result.rows.map(mapCheckpointRow);
  }

  async putWrite(record: DrawingWorkflowPendingWriteRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO drawing_workflow_checkpoint_writes
       (owner_id, device_id, run_id, revision, thread_id, checkpoint_ns, checkpoint_id, task_id, write_index, channel, value_type, value_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (owner_id, device_id, run_id, revision, checkpoint_ns, checkpoint_id, task_id, write_index) DO NOTHING`,
      [
        record.identity.ownerId, record.identity.deviceId, record.identity.runId, record.identity.revision,
        record.threadId, record.checkpointNamespace, record.checkpointId, record.taskId, record.writeIndex,
        record.channel, record.valueType, Buffer.from(record.valueData),
      ],
    );
  }

  async listWrites(identity: DrawingWorkflowCheckpointIdentity, checkpointNamespace: string, checkpointId: string): Promise<DrawingWorkflowPendingWriteRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM drawing_workflow_checkpoint_writes
       WHERE owner_id = $1 AND device_id = $2 AND run_id = $3 AND revision = $4 AND checkpoint_ns = $5 AND checkpoint_id = $6
       ORDER BY task_id ASC, write_index ASC`,
      [identity.ownerId, identity.deviceId, identity.runId, identity.revision, checkpointNamespace, checkpointId],
    );
    return result.rows.map(mapWriteRow);
  }

  async deleteThread(identity: DrawingWorkflowCheckpointIdentity): Promise<void> {
    await this.pool.query(
      `DELETE FROM drawing_workflow_checkpoints WHERE owner_id = $1 AND device_id = $2 AND run_id = $3 AND revision = $4`,
      [identity.ownerId, identity.deviceId, identity.runId, identity.revision],
    );
  }
}

export class PostgresDrawingWorkflowCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly store: DrawingWorkflowCheckpointStore, serde?: ConstructorParameters<typeof BaseCheckpointSaver>[0]) {
    super(serde);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const scope = scopedConfig(config);
    const checkpointId = config.configurable?.checkpoint_id;
    const record = checkpointId
      ? await this.store.getCheckpoint(scope.identity, scope.checkpointNamespace, String(checkpointId))
      : (await this.store.listCheckpoints(scope.identity, scope.checkpointNamespace))[0];
    if (!record) return undefined;
    const checkpoint = await this.serde.loadsTyped(record.checkpointType, record.checkpointData) as Checkpoint;
    const metadata = await this.serde.loadsTyped(record.metadataType, record.metadataData) as CheckpointMetadata;
    const writes = await Promise.all((await this.store.listWrites(scope.identity, scope.checkpointNamespace, record.checkpointId)).map(async (write) => [
      write.taskId,
      write.channel,
      await this.serde.loadsTyped(write.valueType, write.valueData),
    ] as [string, string, unknown]));
    const result: CheckpointTuple = {
      config: checkpointConfig(scope, record.checkpointId),
      checkpoint,
      metadata,
      pendingWrites: writes,
    };
    if (record.parentCheckpointId) result.parentConfig = checkpointConfig(scope, record.parentCheckpointId);
    return result;
  }

  async *list(config: RunnableConfig, options: CheckpointListOptions = {}): AsyncGenerator<CheckpointTuple> {
    const scope = scopedConfig(config);
    const beforeId = options.before?.configurable?.checkpoint_id;
    let yielded = 0;
    for (const record of await this.store.listCheckpoints(scope.identity, scope.checkpointNamespace)) {
      if (beforeId && record.checkpointId >= String(beforeId)) continue;
      const tuple = await this.getTuple(checkpointConfig(scope, record.checkpointId));
      if (!tuple) continue;
      if (options.filter && !Object.entries(options.filter).every(([key, value]) => (tuple.metadata as Record<string, unknown> | undefined)?.[key] === value)) continue;
      yield tuple;
      yielded += 1;
      if (options.limit !== undefined && yielded >= options.limit) return;
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: Record<string, string | number>): Promise<RunnableConfig> {
    const scope = scopedConfig(config);
    validateCheckpoint(scope.identity, checkpoint, metadata);
    const [checkpointType, checkpointData] = await this.serde.dumpsTyped(checkpoint);
    const [metadataType, metadataData] = await this.serde.dumpsTyped(metadata);
    enforceSize(checkpointData, MAX_CHECKPOINT_BYTES, "checkpoint");
    enforceSize(metadataData, MAX_METADATA_BYTES, "checkpoint metadata");
    await this.store.putCheckpoint({
      identity: scope.identity,
      threadId: scope.threadId,
      checkpointNamespace: scope.checkpointNamespace,
      checkpointId: checkpoint.id,
      parentCheckpointId: config.configurable?.checkpoint_id ? String(config.configurable.checkpoint_id) : null,
      checkpointType,
      checkpointData,
      metadataType,
      metadataData,
      createdAt: checkpoint.ts,
    });
    return checkpointConfig(scope, checkpoint.id);
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const scope = scopedConfig(config);
    const checkpointId = config.configurable?.checkpoint_id;
    if (!checkpointId) throw new Error("Checkpoint writes require checkpoint_id");
    if (!IDENTIFIER.test(taskId)) throw new Error("Checkpoint task_id is invalid");
    for (let index = 0; index < writes.length; index += 1) {
      const [channel, value] = writes[index]!;
      const [valueType, valueData] = await this.serde.dumpsTyped(value);
      enforceSize(valueData, MAX_WRITE_BYTES, "checkpoint write");
      validateSafeValue(value);
      await this.store.putWrite({
        identity: scope.identity,
        threadId: scope.threadId,
        checkpointNamespace: scope.checkpointNamespace,
        checkpointId: String(checkpointId),
        taskId,
        writeIndex: index,
        channel,
        valueType,
        valueData,
      });
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!IDENTIFIER.test(threadId)) throw new Error("Checkpoint thread_id is invalid");
    throw new Error("Deleting checkpoints requires owner/device/run/revision scope");
  }
}

interface ScopedConfig {
  identity: DrawingWorkflowCheckpointIdentity;
  threadId: string;
  checkpointNamespace: string;
}

function scopedConfig(config: RunnableConfig): ScopedConfig {
  const configurable = config.configurable as Record<string, unknown> | undefined;
  if (!configurable) throw new Error("Checkpoint config is missing configurable scope");
  const ownerId = identifier(configurable.owner_id, "owner_id");
  const deviceId = identifier(configurable.device_id, "device_id");
  const runId = identifier(configurable.run_id, "run_id");
  const revision = configurable.revision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new Error("Checkpoint revision is invalid");
  const identity = { ownerId, deviceId, runId, revision: revision as number };
  const threadId = identifier(configurable.thread_id, "thread_id");
  if (threadId !== deriveDrawingWorkflowThreadId(identity)) throw new Error("Checkpoint thread_id is not bound to the Drawing Run identity");
  const checkpointNamespace = configurable.checkpoint_ns === undefined ? "" : identifier(configurable.checkpoint_ns, "checkpoint_ns", true);
  return { identity, threadId, checkpointNamespace };
}

function checkpointConfig(scope: ScopedConfig, checkpointId: string): RunnableConfig {
  return {
    configurable: {
      thread_id: scope.threadId,
      checkpoint_ns: scope.checkpointNamespace,
      checkpoint_id: checkpointId,
      owner_id: scope.identity.ownerId,
      device_id: scope.identity.deviceId,
      run_id: scope.identity.runId,
      revision: scope.identity.revision,
    },
  };
}

function validateCheckpoint(identity: DrawingWorkflowCheckpointIdentity, checkpoint: Checkpoint, metadata: CheckpointMetadata): void {
  if (!HASH.test(checkpoint.id) && !IDENTIFIER.test(checkpoint.id)) throw new Error("Checkpoint id is invalid");
  if (typeof checkpoint.ts !== "string" || !checkpoint.ts) throw new Error("Checkpoint timestamp is invalid");
  const values = checkpoint.channel_values as Record<string, unknown>;
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Checkpoint channel values are invalid");
  for (const key of Object.keys(values)) {
    if (!WORKFLOW_CHANNELS.has(key) && !key.startsWith("__") && !key.startsWith("branch:to:")) throw new Error(`Checkpoint contains a forbidden channel: ${key}`);
  }
  if (metadata && typeof metadata === "object") validateSafeValue(metadata);
  for (const key of ["runId", "ownerId", "deviceId", "revision"] as const) {
    const value = values[key];
    if (value !== undefined) {
      const expected = key === "runId" ? identity.runId : key === "ownerId" ? identity.ownerId : key === "deviceId" ? identity.deviceId : identity.revision;
      if (value !== expected) throw new Error(`Checkpoint ${key} does not match its scoped identity`);
    }
  }
  validateSafeValue(values);
}

function validateSafeValue(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("Checkpoint contains a cyclic value");
  seen.add(value);
  if (value instanceof Uint8Array) return;
  if (Array.isArray(value)) {
    for (const item of value) validateSafeValue(item, seen);
    seen.delete(value);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new Error(`Checkpoint contains a forbidden field: ${key}`);
    validateSafeValue(child, seen);
  }
  seen.delete(value);
}

function identifier(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || (value.length > 0 && !IDENTIFIER.test(value))) throw new Error(`Checkpoint ${field} is invalid`);
  return value;
}

function enforceSize(value: Uint8Array, max: number, field: string): void {
  if (value.byteLength > max) throw new Error(`${field} exceeds its size limit`);
}

function sameIdentity(left: DrawingWorkflowCheckpointIdentity, right: DrawingWorkflowCheckpointIdentity): boolean {
  return left.ownerId === right.ownerId && left.deviceId === right.deviceId && left.runId === right.runId && left.revision === right.revision;
}

function cloneCheckpointRecord(record: DrawingWorkflowCheckpointRecord): DrawingWorkflowCheckpointRecord {
  return { ...record, identity: { ...record.identity }, checkpointData: new Uint8Array(record.checkpointData), metadataData: new Uint8Array(record.metadataData) };
}

function cloneWriteRecord(record: DrawingWorkflowPendingWriteRecord): DrawingWorkflowPendingWriteRecord {
  return { ...record, identity: { ...record.identity }, valueData: new Uint8Array(record.valueData) };
}

function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new Error("PostgreSQL checkpoint blob is invalid");
}

function mapCheckpointRow(row: Record<string, unknown>): DrawingWorkflowCheckpointRecord {
  return {
    identity: { ownerId: String(row.owner_id), deviceId: String(row.device_id), runId: String(row.run_id), revision: Number(row.revision) },
    threadId: String(row.thread_id),
    checkpointNamespace: String(row.checkpoint_ns),
    checkpointId: String(row.checkpoint_id),
    parentCheckpointId: row.parent_checkpoint_id === null ? null : String(row.parent_checkpoint_id),
    checkpointType: String(row.checkpoint_type),
    checkpointData: bytes(row.checkpoint_data),
    metadataType: String(row.metadata_type),
    metadataData: bytes(row.metadata_data),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapWriteRow(row: Record<string, unknown>): DrawingWorkflowPendingWriteRecord {
  return {
    identity: { ownerId: String(row.owner_id), deviceId: String(row.device_id), runId: String(row.run_id), revision: Number(row.revision) },
    threadId: String(row.thread_id),
    checkpointNamespace: String(row.checkpoint_ns),
    checkpointId: String(row.checkpoint_id),
    taskId: String(row.task_id),
    writeIndex: Number(row.write_index),
    channel: String(row.channel),
    valueType: String(row.value_type),
    valueData: bytes(row.value_data),
  };
}
