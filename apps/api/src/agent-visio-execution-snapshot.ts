import { AgentVisioDiagram, compileAgentCnnVisioDiagram } from "./agent-visio-bridge.js";
import { ApiErrorCode, FoundationError } from "./domain.js";
import { FigureDraftService } from "./figure-draft-service.js";
import { parseFigureDraftRevisionPayload } from "./figure-draft-payload.js";
import type { FoundationStore } from "./store.js";

export interface AgentVisioExecutionOwner {
  tenantId: string;
  userId: string;
}

export interface AgentVisioExecutionSnapshot {
  snapshotId: string;
  draftId: string;
  revision: number;
  diagram: AgentVisioDiagram;
  planDigest: string;
  createdAt: string;
  immutable: true;
}

export interface AgentVisioExecutionSnapshotStore {
  getForRevision(owner: AgentVisioExecutionOwner, draftId: string, revision: number): Promise<AgentVisioExecutionSnapshot | null>;
  getById(owner: AgentVisioExecutionOwner, snapshotId: string): Promise<AgentVisioExecutionSnapshot | null>;
  insert(owner: AgentVisioExecutionOwner, snapshot: AgentVisioExecutionSnapshot): Promise<AgentVisioExecutionSnapshot>;
}

export class InMemoryAgentVisioExecutionSnapshotStore implements AgentVisioExecutionSnapshotStore {
  private readonly snapshots = new Map<string, AgentVisioExecutionSnapshot>();

  async getForRevision(owner: AgentVisioExecutionOwner, draftId: string, revision: number): Promise<AgentVisioExecutionSnapshot | null> {
    assertOwner(owner);
    return this.snapshots.get(keyFor(owner, draftId, revision)) ?? null;
  }

  async getById(owner: AgentVisioExecutionOwner, snapshotId: string): Promise<AgentVisioExecutionSnapshot | null> {
    assertOwner(owner);
    assertId(snapshotId, "snapshotId");
    for (const [key, snapshot] of this.snapshots) {
      if (key.startsWith(`${owner.tenantId}:${owner.userId}:`) && snapshot.snapshotId === snapshotId) return snapshot;
    }
    return null;
  }

  async insert(owner: AgentVisioExecutionOwner, snapshot: AgentVisioExecutionSnapshot): Promise<AgentVisioExecutionSnapshot> {
    assertOwner(owner);
    const key = keyFor(owner, snapshot.draftId, snapshot.revision);
    if (this.snapshots.has(key)) throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Agent Visio execution snapshot already exists", 409);
    if (!snapshot.immutable || !Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.diagram) || !Object.isFrozen(snapshot.diagram.figurePlan)) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Agent Visio execution snapshot must be immutable", 400);
    }
    this.snapshots.set(key, snapshot);
    return snapshot;
  }
}

export interface AgentVisioExecutionSnapshotServiceOptions {
  foundation: FoundationStore;
  figureDraftService: FigureDraftService;
  snapshotStore: AgentVisioExecutionSnapshotStore;
  now?: () => string;
}

export class AgentVisioExecutionSnapshotService {
  private readonly now: () => string;

  constructor(private readonly options: AgentVisioExecutionSnapshotServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async create(input: { owner: AgentVisioExecutionOwner; draftId: string; revision: number }): Promise<AgentVisioExecutionSnapshot> {
    assertOwner(input.owner);
    assertId(input.draftId, "draftId");
    if (!Number.isSafeInteger(input.revision) || input.revision <= 0) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Figure draft revision is invalid", 400);
    }

    const existing = await this.options.snapshotStore.getForRevision(input.owner, input.draftId, input.revision);
    if (existing) return existing;

    const draft = await this.options.figureDraftService.get(input.owner.userId, input.draftId);
    if (!draft) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft was not found", 404);
    const revision = await this.options.foundation.getFigureDraftRevision(input.owner.userId, input.draftId, input.revision);
    if (!revision) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft revision was not found", 404);
    if (revision.status !== "ready_for_preview") {
      throw new FoundationError("FIGURE_PREVIEW_NOT_READY", "Figure draft requires confirmation before a Visio execution snapshot can be created", 409);
    }

    const payload = parseFigureDraftRevisionPayload(revision.payload, { statusCode: 500 });
    const bridge = compileAgentCnnVisioDiagram({
      draftId: input.draftId,
      revision: input.revision,
      canonicalNetworkIR: payload.canonicalNetworkIR,
    });
    const snapshot = deepFreeze({
      snapshotId: `visio-${bridge.planDigest.slice(0, 32)}`,
      draftId: input.draftId,
      revision: input.revision,
      diagram: structuredClone(bridge.diagram),
      planDigest: bridge.planDigest,
      createdAt: this.now(),
      immutable: true as const,
    });
    return this.options.snapshotStore.insert(input.owner, snapshot);
  }
}

function keyFor(owner: AgentVisioExecutionOwner, draftId: string, revision: number): string {
  return `${owner.tenantId}:${owner.userId}:${draftId}:${revision}`;
}

function assertOwner(owner: AgentVisioExecutionOwner): void {
  assertId(owner.tenantId, "tenantId");
  assertId(owner.userId, "userId");
}

function assertId(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || value.length > 128) {
    throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, `${field} is invalid`, 400);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
