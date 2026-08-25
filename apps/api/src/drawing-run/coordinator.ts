import { createHash, randomUUID } from "node:crypto";
import {
  createDrawingRun,
  type AnswerClarificationInput,
  type AcceptDrawingInput,
  type BindExistingPageInput,
  type CancelDrawingRunInput,
  type DiscoverPageTargetInput,
  type DrawingRun,
  type DrawingRunTrustedScope,
  DRAWING_CLARIFICATION_CONFIRMATION_HASH,
  type DrawingRunCommand,
  type DrawingRunSnapshot,
  type FailDrawingRunInput,
  type PublicDrawingRunEvent,
  type DrawingRunTransition,
  type RequestDrawingApplyInput,
  type RequestDrawingApplyResult,
  type ResumeDrawingRunInput,
  type StartDrawingRunInput,
  type VerifyDrawingReadbackInput,
} from "./contracts.js";
import { classifyDrawingWorkflowFailure, DrawingRunError } from "./errors.js";
import { DrawingRunIdempotency } from "./idempotency.js";
import { projectPublicDrawingRun, projectPublicDrawingRunEvent } from "./public-projection.js";
import { reduceDrawingRun } from "./reducer.js";
import { InMemoryDrawingRunStore, type DrawingRunStore } from "./store.js";
import type { DrawingWorkflowRunner } from "./langgraph-workflow.js";
import { InMemoryLeaseCoordinator, type LeaseCoordinator } from "../lease-coordinator.js";

export interface DrawingRunCoordinator {
  start(input: StartDrawingRunInput): Promise<DrawingRunSnapshot>;
  acceptInput(input: AcceptDrawingInput): Promise<DrawingRunSnapshot>;
  resume(input: ResumeDrawingRunInput): Promise<DrawingRunSnapshot>;
  answerClarification(input: AnswerClarificationInput): Promise<DrawingRunSnapshot>;
  discoverPageTarget(input: DiscoverPageTargetInput): Promise<DrawingRunSnapshot>;
  bindExistingPage(input: BindExistingPageInput): Promise<DrawingRunSnapshot>;
  requestApply(input: RequestDrawingApplyInput): Promise<RequestDrawingApplyResult>;
  verifyReadback(input: VerifyDrawingReadbackInput): Promise<DrawingRunSnapshot>;
  fail(input: FailDrawingRunInput): Promise<DrawingRunSnapshot>;
  cancel(input: CancelDrawingRunInput): Promise<DrawingRunSnapshot>;
  recover(): Promise<void>;
  get(ownerId: string, runId: string, deviceId: string): Promise<DrawingRunSnapshot | null>;
  list(ownerId: string, deviceId: string): Promise<DrawingRunSnapshot[]>;
  listEvents(ownerId: string, runId: string, deviceId: string): Promise<PublicDrawingRunEvent[] | null>;
}

export class InMemoryDrawingRunCoordinator implements DrawingRunCoordinator {
  private readonly store: DrawingRunStore;
  private readonly idempotency = new DrawingRunIdempotency();
  private readonly startIdempotency = new Map<string, { requestHash: string; runId: string }>();
  private readonly now: () => string;
  private readonly createRunId: () => string;
  private readonly workflow?: DrawingWorkflowRunner;
  private readonly inFlight = new Set<string>();
  private readonly leaseCoordinator: LeaseCoordinator;
  private readonly leaseSeconds: number;
  private readonly instanceId: string;

  constructor(options: {
    store?: DrawingRunStore;
    now?: () => string;
    createRunId?: () => string;
    workflow?: DrawingWorkflowRunner;
    leaseCoordinator?: LeaseCoordinator;
    leaseSeconds?: number;
    instanceId?: string;
  } = {}) {
    this.store = options.store ?? new InMemoryDrawingRunStore();
    this.now = options.now ?? (() => new Date().toISOString());
    this.createRunId = options.createRunId ?? (() => `run-${randomUUID()}`);
    this.workflow = options.workflow;
    this.leaseCoordinator = options.leaseCoordinator ?? new InMemoryLeaseCoordinator();
    this.leaseSeconds = options.leaseSeconds ?? 60;
    if (!Number.isFinite(this.leaseSeconds) || this.leaseSeconds <= 0) throw new Error("Drawing Run lease duration must be positive");
    this.instanceId = options.instanceId ?? `coordinator-${randomUUID()}`;
  }

  async start(input: StartDrawingRunInput): Promise<DrawingRunSnapshot> {
    const startKey = `${input.ownerId}:${input.deviceId}:${input.idempotencyKey}`;
    const requestHash = digest(input);
    const persisted = await this.store.getByStartIdempotency(input.ownerId, input.deviceId, input.idempotencyKey);
    if (persisted) {
      if (persisted.startRequestHash !== requestHash) throw new DrawingRunError("DRAWING_RUN_IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different start command");
      const trustedScope = verifiedDrawingRunScope(persisted, { ...input, runId: persisted.runId });
      return projectPublicDrawingRun(persisted, trustedScope);
    }
    const existing = this.startIdempotency.get(startKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new DrawingRunError("DRAWING_RUN_IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different start command");
      }
      const trustedScope = { runId: existing.runId, ownerId: input.ownerId, deviceId: input.deviceId };
      const replay = await this.requireRun(trustedScope);
      return projectPublicDrawingRun(replay, trustedScope);
    }
    const runId = this.createRunId();
    const run = createDrawingRun({ ...input, runId, now: this.now(), startIdempotencyKey: input.idempotencyKey, startRequestHash: requestHash });
    const trustedScope = verifiedDrawingRunScope(run, { ...input, runId });
    await this.store.create(run);
    this.startIdempotency.set(startKey, { requestHash, runId });
    if (this.workflow) void this.scheduleWorkflow(run, trustedScope);
    return projectPublicDrawingRun(run, trustedScope);
  }

  async resume(input: ResumeDrawingRunInput): Promise<DrawingRunSnapshot> {
    const trustedScope = drawingRunTrustedScope(input);
    const run = await this.requireRun(trustedScope);
    if (run.revision !== input.expectedRevision) {
      throw new DrawingRunError("DRAWING_RUN_REVISION_CONFLICT", "Drawing Run revision is stale");
    }
    if (this.workflow && isWorkflowResumable(run.status)) {
      void this.scheduleWorkflow(run, trustedScope);
    }
    return projectPublicDrawingRun(run, trustedScope);
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

  async discoverPageTarget(input: DiscoverPageTargetInput): Promise<DrawingRunSnapshot> {
    return this.dispatch({
      ...input,
      type: "discover_page_target",
      discoveryHash: digest(input.discoveryIdentity),
    });
  }

  async bindExistingPage(input: BindExistingPageInput): Promise<DrawingRunSnapshot> {
    return this.dispatch({
      ...input,
      type: "bind_page",
      bindingHash: digest({ pageTargetHandle: input.pageTargetHandle, ownedRegionId: input.ownedRegionId }),
    });
  }

  async requestApply(input: RequestDrawingApplyInput): Promise<RequestDrawingApplyResult> {
    return this.dispatchWithReplay({ ...input, type: "request_apply", authorizationHash: digest(input.confirmationNonce) });
  }

  async verifyReadback(input: VerifyDrawingReadbackInput): Promise<DrawingRunSnapshot> {
    return this.dispatch({ ...input, type: "verify_readback", readbackHash: digest(input.readback) });
  }

  async fail(input: FailDrawingRunInput): Promise<DrawingRunSnapshot> {
    return this.dispatch({ ...input, type: "fail", errorCategory: input.errorCategory });
  }

  async cancel(input: CancelDrawingRunInput): Promise<DrawingRunSnapshot> {
    return this.dispatch({ ...input, type: "cancel", reasonCategory: "user" });
  }

  async recover(): Promise<void> {
    // Cold recovery has no authenticated owner/device scope, so it must not schedule persisted runs.
  }

  private async scheduleWorkflow(run: DrawingRun, trustedScope: DrawingRunTrustedScope): Promise<void> {
    if (!this.workflow || !isWorkflowResumable(run.status)) return;
    const key = `${run.ownerId}\u0000${run.deviceId}\u0000${run.runId}\u0000${run.revision}`;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    const leaseKey = `drawing-run:${run.ownerId}:${run.deviceId}:${run.runId}:${run.revision}`;
    const leaseOwner = `${this.instanceId}:${key}`;
    let lease: { fencingToken: number } | null = null;
    let leaseLost = false;
    let renewPromise: Promise<boolean> | null = null;
    const renewLease = async (): Promise<boolean> => {
      if (!lease || leaseLost) return false;
      if (renewPromise) return renewPromise;
      const request = (async () => {
        try {
          const result = await this.leaseCoordinator.renew(leaseKey, leaseOwner, lease.fencingToken, this.leaseSeconds);
          if (!result.acquired || result.fencingToken !== lease.fencingToken) leaseLost = true;
        } catch {
          leaseLost = true;
        }
        return !leaseLost;
      })();
      renewPromise = request.finally(() => { renewPromise = null; });
      return renewPromise;
    };
    const renewIntervalMs = Math.max(1_000, Math.floor(this.leaseSeconds * 1_000 / 3));
    let renewInterval: ReturnType<typeof setInterval> | undefined;
    try {
      let claimed;
      try {
        claimed = await this.leaseCoordinator.claim(leaseKey, leaseOwner, this.leaseSeconds);
      } catch {
        return;
      }
      if (!claimed.acquired || claimed.fencingToken === null) return;
      lease = { fencingToken: claimed.fencingToken };
      renewInterval = setInterval(() => { void renewLease(); }, renewIntervalMs);
      await this.dispatchWorkflow(run, trustedScope, renewLease);
    } finally {
      if (renewInterval) clearInterval(renewInterval);
      if (lease) {
        try {
          await this.leaseCoordinator.release(leaseKey, leaseOwner, lease.fencingToken);
        } catch {
          // Losing release must not turn a completed workflow into an unhandled rejection.
        }
      }
      this.inFlight.delete(key);
    }
  }

  private async dispatchWorkflow(run: DrawingRun, trustedScope: DrawingRunTrustedScope, leaseHeld: () => Promise<boolean>): Promise<void> {
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
      if (!(await leaseHeld())) return;
      const current = await this.store.get(trustedScope.ownerId, trustedScope.runId);
      if (!current || !isBoundToDrawingRunScope(current, trustedScope) || current.revision !== expectedRevision || current.status === "cancelled") return;
      await this.applyWorkflowResult(current, result);
    } catch (error) {
      if (!(await leaseHeld())) return;
      const current = await this.store.get(trustedScope.ownerId, trustedScope.runId);
      if (!current || !isBoundToDrawingRunScope(current, trustedScope) || current.revision !== expectedRevision || current.status === "cancelled") return;
      await this.dispatch({
        ...trustedScope,
        expectedRevision,
        idempotencyKey: `workflow-failure:${expectedRevision}`,
        type: "fail",
        errorCategory: classifyDrawingWorkflowFailure(error),
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

  async get(ownerId: string, runId: string, deviceId: string): Promise<DrawingRunSnapshot | null> {
    const run = await this.store.get(ownerId, runId);
    if (!run) return null;
    const trustedScope = readableDrawingRunScope(run, { ownerId, runId, deviceId });
    if (!trustedScope) return null;
    return projectPublicDrawingRun(run, trustedScope);
  }

  async list(ownerId: string, deviceId: string): Promise<DrawingRunSnapshot[]> {
    return (await this.store.list(ownerId)).flatMap((run) => {
      const trustedScope = readableDrawingRunScope(run, { ownerId, runId: run.runId, deviceId });
      return trustedScope ? [projectPublicDrawingRun(run, trustedScope)] : [];
    });
  }

  async listEvents(ownerId: string, runId: string, deviceId: string): Promise<PublicDrawingRunEvent[] | null> {
    const run = await this.store.get(ownerId, runId);
    if (!run) return null;
    if (!readableDrawingRunScope(run, { ownerId, runId, deviceId })) return null;
    return (await this.store.listEvents(ownerId, runId)).map(projectPublicDrawingRunEvent);
  }

  async dispatch(command: DrawingRunCommand): Promise<DrawingRunSnapshot> {
    return (await this.dispatchWithReplay(command)).run;
  }

  private async dispatchWithReplay(command: DrawingRunCommand): Promise<RequestDrawingApplyResult> {
    const trustedScope = drawingRunTrustedScope(command);
    const run = await this.requireRun(trustedScope);
    const requestHash = digest(command);
    const replayRevision = this.idempotency.read(command.ownerId, command.deviceId, command.runId, command.idempotencyKey, requestHash);
    if (replayRevision !== null) {
      const replay = await this.requireRun(trustedScope);
      return { run: projectPublicDrawingRun(replay, trustedScope), replayed: true };
    }
    const persistedEvent = await this.store.getEvent(command.ownerId, command.runId, command.idempotencyKey);
    if (persistedEvent) {
      if (persistedEvent.requestHash !== requestHash) throw new DrawingRunError("DRAWING_RUN_IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different command");
      const replay = await this.requireRun(trustedScope);
      this.idempotency.record(command.ownerId, command.deviceId, command.runId, command.idempotencyKey, requestHash, persistedEvent.revision);
      return { run: projectPublicDrawingRun(replay, trustedScope), replayed: true };
    }
    const transition: DrawingRunTransition = reduceDrawingRun(run, command, trustedScope);
    transition.event.requestHash = requestHash;
    const result = await this.store.commitTransition({
      ownerId: command.ownerId,
      runId: command.runId,
      expectedRevision: command.expectedRevision,
      transition,
      idempotencyKey: command.idempotencyKey,
    });
    if (result === "conflict") throw new DrawingRunError("DRAWING_RUN_REVISION_CONFLICT", "Drawing Run changed concurrently");
    this.idempotency.record(command.ownerId, command.deviceId, command.runId, command.idempotencyKey, requestHash, transition.next.revision);
    if (result === "replayed") {
      const replay = await this.requireRun(trustedScope);
      return { run: projectPublicDrawingRun(replay, trustedScope), replayed: true };
    }
    if (this.workflow && isWorkflowResumable(transition.next.status)) {
      void this.scheduleWorkflow(transition.next, trustedScope);
    }
    return { run: projectPublicDrawingRun(transition.next, trustedScope), replayed: false };
  }

  private async requireRun(trustedScope: DrawingRunTrustedScope): Promise<DrawingRun> {
    const run = await this.store.get(trustedScope.ownerId, trustedScope.runId);
    if (!run) throw new DrawingRunError("DRAWING_RUN_IDENTITY_MISMATCH", "Drawing Run was not found");
    verifiedDrawingRunScope(run, trustedScope);
    return run;
  }
}

function drawingRunTrustedScope(input: Pick<DrawingRunTrustedScope, "runId" | "ownerId" | "deviceId">): DrawingRunTrustedScope {
  return { runId: input.runId, ownerId: input.ownerId, deviceId: input.deviceId };
}

function isBoundToDrawingRunScope(run: DrawingRun, trustedScope: DrawingRunTrustedScope): boolean {
  return run.runId === trustedScope.runId
    && run.ownerId === trustedScope.ownerId
    && run.deviceId === trustedScope.deviceId;
}

function verifiedDrawingRunScope(
  run: DrawingRun,
  input: Pick<DrawingRunTrustedScope, "runId" | "ownerId" | "deviceId">,
): DrawingRunTrustedScope {
  const trustedScope = drawingRunTrustedScope(input);
  if (!isBoundToDrawingRunScope(run, trustedScope)) {
    throw new DrawingRunError("DRAWING_RUN_IDENTITY_MISMATCH", "Drawing Run identity does not match the trusted scope");
  }
  return trustedScope;
}

function readableDrawingRunScope(
  run: DrawingRun,
  input: Pick<DrawingRunTrustedScope, "runId" | "ownerId" | "deviceId">,
): DrawingRunTrustedScope | null {
  const trustedScope = drawingRunTrustedScope(input);
  if (run.runId !== trustedScope.runId || run.ownerId !== trustedScope.ownerId) {
    throw new DrawingRunError("DRAWING_RUN_IDENTITY_MISMATCH", "Drawing Run identity does not match the trusted scope");
  }
  return run.deviceId === trustedScope.deviceId ? trustedScope : null;
}

function isWorkflowResumable(status: DrawingRun["status"]): boolean {
  return ["received", "input_accepted", "analyzing", "awaiting_interpreter", "candidate_structure", "formal_ugs", "composing_pvp"].includes(status);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
