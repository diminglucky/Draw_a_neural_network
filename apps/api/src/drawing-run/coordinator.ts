import { createHash, randomUUID } from "node:crypto";
import {
  createDrawingRun,
  type AnswerClarificationInput,
  type BindExistingPageInput,
  type CancelDrawingRunInput,
  type DrawingRun,
  type DrawingRunCommand,
  type DrawingRunSnapshot,
  type DrawingRunTransition,
  type RequestDrawingApplyInput,
  type ResumeDrawingRunInput,
  type StartDrawingRunInput,
} from "./contracts.js";
import { DrawingRunError } from "./errors.js";
import { DrawingRunIdempotency } from "./idempotency.js";
import { projectPublicDrawingRun } from "./public-projection.js";
import { reduceDrawingRun } from "./reducer.js";
import { InMemoryDrawingRunStore, type DrawingRunStore } from "./store.js";

export interface DrawingRunCoordinator {
  start(input: StartDrawingRunInput): Promise<DrawingRunSnapshot>;
  resume(input: ResumeDrawingRunInput): Promise<DrawingRunSnapshot>;
  answerClarification(input: AnswerClarificationInput): Promise<DrawingRunSnapshot>;
  bindExistingPage(input: BindExistingPageInput): Promise<DrawingRunSnapshot>;
  requestApply(input: RequestDrawingApplyInput): Promise<DrawingRunSnapshot>;
  cancel(input: CancelDrawingRunInput): Promise<DrawingRunSnapshot>;
  get(ownerId: string, runId: string): Promise<DrawingRunSnapshot | null>;
}

export class InMemoryDrawingRunCoordinator implements DrawingRunCoordinator {
  private readonly store: DrawingRunStore;
  private readonly idempotency = new DrawingRunIdempotency();
  private readonly startIdempotency = new Map<string, { requestHash: string; runId: string }>();
  private readonly now: () => string;
  private readonly createRunId: () => string;

  constructor(options: {
    store?: DrawingRunStore;
    now?: () => string;
    createRunId?: () => string;
  } = {}) {
    this.store = options.store ?? new InMemoryDrawingRunStore();
    this.now = options.now ?? (() => new Date().toISOString());
    this.createRunId = options.createRunId ?? (() => `run-${randomUUID()}`);
  }

  async start(input: StartDrawingRunInput): Promise<DrawingRunSnapshot> {
    const startKey = `${input.ownerId}:${input.deviceId}:${input.idempotencyKey}`;
    const requestHash = digest(input);
    const persisted = await this.store.getByStartIdempotency(input.ownerId, input.deviceId, input.idempotencyKey);
    if (persisted) {
      if (persisted.startRequestHash !== requestHash) throw new DrawingRunError("DRAWING_RUN_IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different start command");
      return projectPublicDrawingRun(persisted);
    }
    const existing = this.startIdempotency.get(startKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new DrawingRunError("DRAWING_RUN_IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different start command");
      }
      const replay = await this.requireRun(input.ownerId, existing.runId);
      return projectPublicDrawingRun(replay);
    }
    const runId = this.createRunId();
    const run = createDrawingRun({ ...input, runId, now: this.now(), startIdempotencyKey: input.idempotencyKey, startRequestHash: requestHash });
    await this.store.create(run);
    this.startIdempotency.set(startKey, { requestHash, runId });
    return projectPublicDrawingRun(run);
  }

  async resume(input: ResumeDrawingRunInput): Promise<DrawingRunSnapshot> {
    const run = await this.requireRun(input.ownerId, input.runId);
    assertDevice(run, input.deviceId);
    return projectPublicDrawingRun(run);
  }

  async answerClarification(input: AnswerClarificationInput): Promise<DrawingRunSnapshot> {
    const answerHash = digest(input.answer);
    return this.dispatch({
      ...input,
      type: "answer_clarification",
      clarificationId: input.clarificationId,
      answerHash,
    });
  }

  async bindExistingPage(input: BindExistingPageInput): Promise<DrawingRunSnapshot> {
    return this.dispatch({
      ...input,
      type: "bind_page",
      bindingHash: digest({ pageTargetHandle: input.pageTargetHandle, ownedRegionId: input.ownedRegionId }),
    });
  }

  async requestApply(input: RequestDrawingApplyInput): Promise<DrawingRunSnapshot> {
    return this.dispatch({ ...input, type: "request_apply", authorizationHash: digest(input.confirmationNonce) });
  }

  async cancel(input: CancelDrawingRunInput): Promise<DrawingRunSnapshot> {
    return this.dispatch({ ...input, type: "cancel", reasonCategory: "user" });
  }

  async get(ownerId: string, runId: string): Promise<DrawingRunSnapshot | null> {
    const run = await this.store.get(ownerId, runId);
    return run ? projectPublicDrawingRun(run) : null;
  }

  async dispatch(command: DrawingRunCommand): Promise<DrawingRunSnapshot> {
    const run = await this.requireRun(command.ownerId, command.runId);
    assertDevice(run, command.deviceId);
    const requestHash = digest(command);
    const replayRevision = this.idempotency.read(command.ownerId, command.deviceId, command.runId, command.idempotencyKey, requestHash);
    if (replayRevision !== null) {
      const replay = await this.requireRun(command.ownerId, command.runId);
      return projectPublicDrawingRun(replay);
    }
    const persistedEvent = await this.store.getEvent(command.ownerId, command.runId, command.idempotencyKey);
    if (persistedEvent) {
      if (persistedEvent.requestHash !== requestHash) throw new DrawingRunError("DRAWING_RUN_IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different command");
      const replay = await this.requireRun(command.ownerId, command.runId);
      this.idempotency.record(command.ownerId, command.deviceId, command.runId, command.idempotencyKey, requestHash, persistedEvent.revision);
      return projectPublicDrawingRun(replay);
    }
    const transition: DrawingRunTransition = reduceDrawingRun(run, command);
    transition.event.requestHash = requestHash;
    const result = await this.store.compareAndSet({
      ownerId: command.ownerId,
      runId: command.runId,
      expectedRevision: command.expectedRevision,
      next: transition.next,
    });
    if (result === "conflict") throw new DrawingRunError("DRAWING_RUN_REVISION_CONFLICT", "Drawing Run changed concurrently");
    await this.store.appendEvent(transition.event, command.idempotencyKey);
    this.idempotency.record(command.ownerId, command.deviceId, command.runId, command.idempotencyKey, requestHash, transition.next.revision);
    return projectPublicDrawingRun(transition.next);
  }

  private async requireRun(ownerId: string, runId: string): Promise<DrawingRun> {
    const run = await this.store.get(ownerId, runId);
    if (!run) throw new DrawingRunError("DRAWING_RUN_IDENTITY_MISMATCH", "Drawing Run was not found");
    return run;
  }
}

function assertDevice(run: DrawingRun, deviceId: string): void {
  if (run.deviceId !== deviceId) throw new DrawingRunError("DRAWING_RUN_IDENTITY_MISMATCH", "Device does not match the Drawing Run");
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
