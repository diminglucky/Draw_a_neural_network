import { createHash, randomUUID } from "node:crypto";
import {
  createDrawingRun,
  type AnswerClarificationInput,
  type AcceptDrawingInput,
  type BindExistingPageInput,
  type CancelDrawingRunInput,
  type DrawingRun,
  DRAWING_CLARIFICATION_CONFIRMATION_HASH,
  type DrawingRunCommand,
  type DrawingRunSnapshot,
  type PublicDrawingRunEvent,
  type DrawingRunTransition,
  type RequestDrawingApplyInput,
  type ResumeDrawingRunInput,
  type StartDrawingRunInput,
} from "./contracts.js";
import { DrawingRunError } from "./errors.js";
import { DrawingRunIdempotency } from "./idempotency.js";
import { projectPublicDrawingRun, projectPublicDrawingRunEvent } from "./public-projection.js";
import { reduceDrawingRun } from "./reducer.js";
import { InMemoryDrawingRunStore, type DrawingRunStore } from "./store.js";
import type { DrawingWorkflowRunner } from "./langgraph-workflow.js";

export interface DrawingRunCoordinator {
  start(input: StartDrawingRunInput): Promise<DrawingRunSnapshot>;
  acceptInput(input: AcceptDrawingInput): Promise<DrawingRunSnapshot>;
  resume(input: ResumeDrawingRunInput): Promise<DrawingRunSnapshot>;
  answerClarification(input: AnswerClarificationInput): Promise<DrawingRunSnapshot>;
  bindExistingPage(input: BindExistingPageInput): Promise<DrawingRunSnapshot>;
  requestApply(input: RequestDrawingApplyInput): Promise<DrawingRunSnapshot>;
  cancel(input: CancelDrawingRunInput): Promise<DrawingRunSnapshot>;
  recover(): Promise<void>;
  get(ownerId: string, runId: string): Promise<DrawingRunSnapshot | null>;
  list(ownerId: string): Promise<DrawingRunSnapshot[]>;
  listEvents(ownerId: string, runId: string): Promise<PublicDrawingRunEvent[] | null>;
}

export class InMemoryDrawingRunCoordinator implements DrawingRunCoordinator {
  private readonly store: DrawingRunStore;
  private readonly idempotency = new DrawingRunIdempotency();
  private readonly startIdempotency = new Map<string, { requestHash: string; runId: string }>();
  private readonly now: () => string;
  private readonly createRunId: () => string;
  private readonly workflow?: DrawingWorkflowRunner;
  private readonly inFlight = new Set<string>();

  constructor(options: {
    store?: DrawingRunStore;
    now?: () => string;
    createRunId?: () => string;
    workflow?: DrawingWorkflowRunner;
  } = {}) {
    this.store = options.store ?? new InMemoryDrawingRunStore();
    this.now = options.now ?? (() => new Date().toISOString());
    this.createRunId = options.createRunId ?? (() => `run-${randomUUID()}`);
    this.workflow = options.workflow;
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
    if (this.workflow) void this.scheduleWorkflow(run);
    return projectPublicDrawingRun(run);
  }

  async resume(input: ResumeDrawingRunInput): Promise<DrawingRunSnapshot> {
    const run = await this.requireRun(input.ownerId, input.runId);
    assertDevice(run, input.deviceId);
    if (this.workflow && isWorkflowResumable(run.status)) {
      void this.scheduleWorkflow(run);
    }
    return projectPublicDrawingRun(run);
  }

  async acceptInput(input: AcceptDrawingInput): Promise<DrawingRunSnapshot> {
    return this.dispatch({ ...input, type: "accept_input" });
  }

  async answerClarification(input: AnswerClarificationInput): Promise<DrawingRunSnapshot> {
    const normalizedAnswer = input.answer.trim().toLowerCase();
    const answerHash = ["confirm", "confirmed", "yes"].includes(normalizedAnswer)
      ? DRAWING_CLARIFICATION_CONFIRMATION_HASH
      : digest(input.answer);
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

  async recover(): Promise<void> {
    if (!this.workflow) return;
    const runs = await this.store.listForRecovery();
    await Promise.all(runs.map((run) => this.scheduleWorkflow(run)));
  }

  private async scheduleWorkflow(run: DrawingRun): Promise<void> {
    if (!this.workflow || !isWorkflowResumable(run.status)) return;
    const key = `${run.ownerId}\u0000${run.deviceId}\u0000${run.runId}\u0000${run.revision}`;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    try {
      await this.dispatchWorkflow(run);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async dispatchWorkflow(run: DrawingRun): Promise<void> {
    if (run.status === "awaiting_clarification") return;
    const expectedRevision = run.revision;
    try {
      const clarificationAnswerHash = await this.findClarificationAnswerHash(run);
      const result = await this.workflow!.run({
        runId: run.runId,
        ownerId: run.ownerId,
        deviceId: run.deviceId,
        revision: expectedRevision,
        artifactHashes: run.artifactHashes,
        clarificationAnswerHash,
      });
      const current = await this.store.get(run.ownerId, run.runId);
      if (!current || current.revision !== expectedRevision || current.status === "cancelled") return;
      await this.applyWorkflowResult(current, result);
    } catch {
      const current = await this.store.get(run.ownerId, run.runId);
      if (!current || current.revision !== expectedRevision || current.status === "cancelled") return;
      await this.dispatch({
        ownerId: current.ownerId,
        deviceId: current.deviceId,
        runId: current.runId,
        expectedRevision,
        idempotencyKey: `workflow-failure:${expectedRevision}`,
        type: "fail",
        errorCategory: "validation",
      });
    }
  }

  private async findClarificationAnswerHash(run: DrawingRun): Promise<string | null> {
    const events = await this.store.listEvents(run.ownerId, run.runId);
    for (let index = events.length - 1; index >= 1; index -= 1) {
      const current = events[index]!;
      const previous = events[index - 1]!;
      if (current.action === "analyzed" && current.status === "analyzing" && previous.status === "awaiting_clarification") {
        return current.artifactHashes.find((hash) => !previous.artifactHashes.includes(hash)) ?? null;
      }
    }
    return null;
  }

  private async applyWorkflowResult(run: DrawingRun, result: import("./langgraph-workflow.js").DrawingWorkflowResult): Promise<void> {
    const base = { ownerId: run.ownerId, deviceId: run.deviceId, runId: run.runId, expectedRevision: run.revision };
    const dispatch = (command: DrawingRunCommand) => this.dispatch(command);
    if (result.phase === "awaiting_input") return;
    if (run.status === "received") {
      const artifactHash = result.artifactHashes[0];
      if (!artifactHash) return;
      await dispatch({ ...base, idempotencyKey: `workflow:accept:${run.revision}`, type: "accept_input", receiptIds: [], artifactHash });
      return;
    }
    if (run.status === "input_accepted") {
      await dispatch({ ...base, idempotencyKey: `workflow:begin:${run.revision}`, type: "begin_analysis", policyHash: result.evidencePackHash ?? "0".repeat(64) });
      return;
    }
    if (result.assessment?.kind === "rejected") {
      await dispatch({ ...base, idempotencyKey: `workflow:reject:${run.revision}`, type: "reject", errorCategory: result.assessment.errorCategory });
      return;
    }
    if (run.status === "analyzing" && result.evidencePackHash) {
      if (result.assessment?.kind === "formal" || result.assessment?.kind === "clarification") {
        await dispatch({ ...base, idempotencyKey: `workflow:candidate:${run.revision}`, type: "record_candidate", candidateHash: result.assessment.candidateHash });
      } else if (result.needsInterpreter) {
        await dispatch({ ...base, idempotencyKey: `workflow:interpreter:${run.revision}`, type: "request_interpreter", evidencePackHash: result.evidencePackHash });
      }
      return;
    }
    if (run.status === "awaiting_interpreter" && (result.assessment?.kind === "formal" || result.assessment?.kind === "clarification")) {
      await dispatch({ ...base, idempotencyKey: `workflow:candidate:${run.revision}`, type: "record_candidate", candidateHash: result.assessment.candidateHash });
      return;
    }
    if (result.phase === "awaiting_clarification" && result.assessment?.kind === "clarification") {
      if (run.status !== "candidate_structure") {
        await dispatch({ ...base, idempotencyKey: `workflow:candidate:${run.revision}`, type: "record_candidate", candidateHash: result.assessment.candidateHash });
        return;
      }
      await dispatch({ ...base, idempotencyKey: `workflow:clarify:${run.revision}`, type: "request_clarification", clarificationHash: result.assessment.clarificationHash });
      return;
    }
    if (result.assessment?.kind === "formal" && run.status === "candidate_structure") {
      await dispatch({ ...base, idempotencyKey: `workflow:formal:${run.revision}`, type: "formalize_ugs", ugsHash: result.assessment.ugsHash });
      return;
    }
    if (result.phase === "preview_ready" && result.assessment?.kind === "formal" && result.pvpHash && run.status === "formal_ugs") {
      await dispatch({ ...base, idempotencyKey: `workflow:compose:${run.revision}`, type: "compose_pvp", ugsHash: result.assessment.ugsHash });
      return;
    }
    if (result.phase === "preview_ready" && result.pvpHash && result.qaHash && run.status === "composing_pvp") {
      await dispatch({ ...base, idempotencyKey: `workflow:publish:${run.revision}`, type: "publish_preview", pvpHash: result.pvpHash, qaHash: result.qaHash });
    }
  }

  async get(ownerId: string, runId: string): Promise<DrawingRunSnapshot | null> {
    const run = await this.store.get(ownerId, runId);
    return run ? projectPublicDrawingRun(run) : null;
  }

  async list(ownerId: string): Promise<DrawingRunSnapshot[]> {
    return (await this.store.list(ownerId)).map(projectPublicDrawingRun);
  }

  async listEvents(ownerId: string, runId: string): Promise<PublicDrawingRunEvent[] | null> {
    const run = await this.store.get(ownerId, runId);
    if (!run) return null;
    return (await this.store.listEvents(ownerId, runId)).map(projectPublicDrawingRunEvent);
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
    await this.store.appendEvent(command.ownerId, transition.event, command.idempotencyKey);
    this.idempotency.record(command.ownerId, command.deviceId, command.runId, command.idempotencyKey, requestHash, transition.next.revision);
    if (this.workflow && isWorkflowResumable(transition.next.status)) {
      void this.scheduleWorkflow(transition.next);
    }
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

function isWorkflowResumable(status: DrawingRun["status"]): boolean {
  return ["received", "input_accepted", "analyzing", "awaiting_interpreter", "candidate_structure", "formal_ugs", "composing_pvp"].includes(status);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
