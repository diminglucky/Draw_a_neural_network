import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemorySaver } from "@langchain/langgraph";
import { InMemoryDrawingRunCoordinator } from "../../src/drawing-run/coordinator.js";
import { DrawingRunError, DrawingWorkflowError } from "../../src/drawing-run/errors.js";
import { InMemoryFoundationStore } from "../../src/store.js";
import { FoundationDrawingRunStoreAdapter, InMemoryDrawingRunStore } from "../../src/drawing-run/store.js";
import type { DrawingWorkflowRunner } from "../../src/drawing-run/langgraph-workflow.js";
import { InMemoryPrivateReceiptStore, receiptBatchHash } from "../../src/drawing-input/private-receipt.js";
import { InMemoryEvidencePackStore, createReceiptBoundDrawingWorkflow } from "../../src/drawing-input/intent.js";
import { InMemoryDrawingArtifactStore } from "../../src/drawing-input/drawing-artifacts.js";
import { createPublicationDrawingWorkflowComposer } from "../../src/drawing-run/publication-composer.js";
import { InMemoryLeaseCoordinator } from "../../src/lease-coordinator.js";

const intent = {
  action: "create_figure" as const,
  requestedDetail: "overview" as const,
  target: "browser_preview" as const,
  sourceKinds: ["typed_text" as const],
};

class JsonTamperingDrawingRunStore extends InMemoryDrawingRunStore {
  tamperOwner = false;
  tamperDevice = false;
  tamperRunId = false;
  captureCommits = false;
  capturedCommitCount = 0;

  override async get(ownerId: string, runId: string) {
    return this.tamper(await super.get(ownerId, runId));
  }

  override async list(ownerId: string) {
    return Promise.all((await super.list(ownerId)).map((run) => this.tamper(run))).then((runs) => runs.filter((run) => run !== null));
  }

  override async listForRecovery() {
    return Promise.all((await super.listForRecovery()).map((run) => this.tamper(run))).then((runs) => runs.filter((run) => run !== null));
  }

  override async getByStartIdempotency(ownerId: string, deviceId: string, idempotencyKey: string) {
    return this.tamper(await super.getByStartIdempotency(ownerId, deviceId, idempotencyKey));
  }

  override async commitTransition(input: Parameters<InMemoryDrawingRunStore["commitTransition"]>[0]) {
    if (this.captureCommits) {
      this.capturedCommitCount += 1;
      return "updated" as const;
    }
    return super.commitTransition(input);
  }

  private async tamper(run: Awaited<ReturnType<InMemoryDrawingRunStore["get"]>>) {
    if (!run) return null;
    const restored = JSON.parse(JSON.stringify(run)) as typeof run;
    if (this.tamperOwner) restored.ownerId = "owner-tampered";
    if (this.tamperDevice) restored.deviceId = "device-tampered";
    if (this.tamperRunId) restored.runId = "run-tampered";
    return restored;
  }
}

describe("Drawing Run coordinator", () => {
  it("rejects device-only JSON-restored tampering on a start replay", async () => {
    const store = new JsonTamperingDrawingRunStore();
    const coordinator = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-trusted-projection" });
    const input = { ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-trusted-projection", intent };
    await coordinator.start(input);

    store.tamperDevice = true;

    await expect(coordinator.start(input)).rejects.toBeInstanceOf(DrawingRunError);
  });

  it("returns controlled absence for a different device on get", async () => {
    const store = new JsonTamperingDrawingRunStore();
    const coordinator = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-trusted-get" });
    await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-trusted-get", intent });

    store.tamperDevice = true;

    await expect(coordinator.get("owner-1", "run-trusted-get", "device-1")).resolves.toBeNull();
  });

  it("excludes a different device from list", async () => {
    const store = new JsonTamperingDrawingRunStore();
    const coordinator = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-trusted-list" });
    await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-trusted-list", intent });

    store.tamperDevice = true;

    await expect(coordinator.list("owner-1", "device-1")).resolves.toEqual([]);
  });

  it("returns controlled absence for a different device on listEvents", async () => {
    const store = new JsonTamperingDrawingRunStore();
    const coordinator = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-trusted-events" });
    const started = await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-trusted-events", intent });

    store.tamperDevice = true;

    await expect(coordinator.listEvents("owner-1", started.runId, "device-1")).resolves.toBeNull();
  });

  it("rejects a malformed restored run that claims the current device", async () => {
    const store = new JsonTamperingDrawingRunStore();
    const coordinator = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-malformed-read" });
    await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-malformed-read", intent });

    store.tamperRunId = true;

    await expect(coordinator.get("owner-1", "run-malformed-read", "device-1")).rejects.toBeInstanceOf(DrawingRunError);
  });

  it("rejects a tampered JSON-restored run on an idempotent replay projection", async () => {
    const store = new JsonTamperingDrawingRunStore();
    const coordinator = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-trusted-replay" });
    const command = {
      ownerId: "owner-1",
      deviceId: "device-1",
      runId: "run-trusted-replay",
      expectedRevision: 0,
      idempotencyKey: "cancel-trusted-replay",
    };
    await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-trusted-replay", intent });
    await coordinator.cancel(command);

    store.tamperOwner = true;

    await expect(coordinator.cancel(command)).rejects.toBeInstanceOf(DrawingRunError);
  });

  it("does not transition a workflow result under a tampered persisted device", async () => {
    const store = new JsonTamperingDrawingRunStore();
    let workflowCall = 0;
    let releaseSecondWorkflow!: () => void;
    const secondWorkflowStarted = new Promise<void>((resolveStarted) => {
      releaseSecondWorkflow = resolveStarted;
    });
    let continueSecondWorkflow!: () => void;
    const secondWorkflowGate = new Promise<void>((resolveGate) => {
      continueSecondWorkflow = resolveGate;
    });
    const hash = "a".repeat(64);
    const workflow: DrawingWorkflowRunner = {
      run: async (workflowInput) => {
        workflowCall += 1;
        if (workflowCall === 1) {
          return {
            runId: workflowInput.runId,
            ownerId: workflowInput.ownerId,
            deviceId: workflowInput.deviceId,
            revision: workflowInput.revision,
            phase: "awaiting_input",
            artifactHashes: workflowInput.artifactHashes,
            evidencePackHash: null,
            needsInterpreter: false,
            proposalHash: null,
            assessment: null,
            pvpHash: null,
            qaHash: null,
            pauseReason: "input_required",
          };
        }
        releaseSecondWorkflow();
        await secondWorkflowGate;
        return {
          runId: workflowInput.runId,
          ownerId: workflowInput.ownerId,
          deviceId: workflowInput.deviceId,
          revision: workflowInput.revision,
          phase: "composing",
          artifactHashes: workflowInput.artifactHashes,
          evidencePackHash: hash,
          needsInterpreter: false,
          proposalHash: null,
          assessment: null,
          pvpHash: null,
          qaHash: null,
          pauseReason: null,
        };
      },
    };
    const coordinator = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-trusted-workflow", workflow });
    const started = await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-trusted-workflow", intent });
    await coordinator.acceptInput({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "accept-trusted-workflow", receiptIds: ["receipt-1"], artifactHash: hash });
    await secondWorkflowStarted;

    store.tamperDevice = true;
    store.captureCommits = true;
    continueSecondWorkflow();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(store.capturedCommitCount).toBe(0);
  });

  it("pauses on blocking structure and resumes only after explicit confirmation", async () => {
    const declaration = {
      version: 1,
      nodes: [{ id: "input", kind: "input", label: "Input", ordinal: 1 }, { id: "output", kind: "output", label: "Output", ordinal: 2 }],
      ports: [{ id: "in-out", nodeId: "input", direction: "output", label: null, ordinal: 3 }, { id: "out-in", nodeId: "output", direction: "input", label: null, ordinal: 4 }],
      edges: [{ id: "edge-1", sourcePortId: "in-out", targetPortId: "out-in", relation: "data", ordinal: 5 }],
      unresolved: [{ code: "confirm-topology", severity: "blocking", summary: "Confirm the declared relation", ordinal: 6 }],
    } as const;
    const receipts = new InMemoryPrivateReceiptStore();
    const bytes = Buffer.from(JSON.stringify(declaration), "utf8");
    const receipt = await receipts.ingest({ ownerId: "owner-1", kind: "architecture_description", mimeType: "application/json", bytes, sha256: createHash("sha256").update(bytes).digest("hex"), retention: "owner_revision" });
    const batchHash = receiptBatchHash([receipt]);
    await receipts.bindBatchHash("owner-1", batchHash, [receipt.receiptId]);
    const artifacts = new InMemoryDrawingArtifactStore();
    const workflow = createReceiptBoundDrawingWorkflow({
      receipts,
      evidencePacks: new InMemoryEvidencePackStore(),
      artifacts,
      composer: createPublicationDrawingWorkflowComposer(artifacts),
      checkpointer: new MemorySaver(),
    });
    const coordinator = new InMemoryDrawingRunCoordinator({ createRunId: () => "run-clarification", workflow });
    const started = await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-clarification", intent: { ...intent, sourceKinds: ["architecture_description"] } });
    await coordinator.acceptInput({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "accept-clarification", receiptIds: [receipt.receiptId], artifactHash: batchHash });
    const waitFor = async (status: string) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const current = await coordinator.get("owner-1", started.runId, "device-1");
        if (current?.status === status) return current;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const final = await coordinator.get("owner-1", started.runId, "device-1");
      throw new Error(`Drawing Run did not reach ${status}: ${JSON.stringify(final)}`);
    };
    const paused = await waitFor("awaiting_clarification");
    expect(paused.clarification?.id).toBeTruthy();
    await coordinator.answerClarification({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: paused.revision, idempotencyKey: "answer-clarification", clarificationId: paused.clarification!.id, answer: "confirm" });
    await expect(waitFor("preview_ready")).resolves.toMatchObject({ status: "preview_ready", preview: { hash: expect.any(String) } });
  });

  it("uses LangGraph as the resumable orchestration port without bypassing reducer revisions", async () => {
    const digest = "a".repeat(64);
    const workflow: DrawingWorkflowRunner = {
      run: async (input) => ({
        runId: input.runId,
        ownerId: input.ownerId,
        deviceId: input.deviceId,
        revision: input.revision,
        phase: input.revision >= 4 ? "preview_ready" : input.revision === 0 ? "awaiting_input" : "composing",
        artifactHashes: [...input.artifactHashes, digest],
        evidencePackHash: digest,
        needsInterpreter: false,
        proposalHash: null,
        assessment: { kind: "formal", candidateHash: digest, ugsHash: digest },
        pvpHash: digest,
        qaHash: digest,
        pauseReason: null,
      }),
    };
    const coordinator = new InMemoryDrawingRunCoordinator({ createRunId: () => "run-langgraph", workflow });
    const started = await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-langgraph", intent });
    await coordinator.dispatch({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "accept-langgraph", type: "accept_input", receiptIds: ["receipt-1"], artifactHash: digest });

    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(coordinator.get("owner-1", "run-langgraph", "device-1")).resolves.toMatchObject({ status: "preview_ready" });
  });

  it("creates an owner/device-scoped observable run and replays cancellation", async () => {
    const coordinator = new InMemoryDrawingRunCoordinator({ createRunId: () => "run-1", now: () => "2026-08-22T00:00:00.000Z" });
    const started = await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-1", intent });
    expect(await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-1", intent })).toEqual(started);
    expect(started).toMatchObject({ runId: "run-1", status: "received", revision: 0, allowedActions: ["accept_input", "cancel"] });
    const cancelled = await coordinator.cancel({ ownerId: "owner-1", deviceId: "device-1", runId: "run-1", expectedRevision: 0, idempotencyKey: "cancel-1" });
    expect(cancelled).toMatchObject({ status: "cancelled", revision: 1, allowedActions: [] });
    expect(await coordinator.cancel({ ownerId: "owner-1", deviceId: "device-1", runId: "run-1", expectedRevision: 0, idempotencyKey: "cancel-1" })).toEqual(cancelled);
  });

  it("rejects foreign access and stale concurrent commands", async () => {
    const coordinator = new InMemoryDrawingRunCoordinator({ createRunId: () => "run-1" });
    await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-1", intent });
    await expect(coordinator.get("owner-2", "run-1", "device-1")).resolves.toBeNull();
    await expect(coordinator.cancel({ ownerId: "owner-1", deviceId: "foreign", runId: "run-1", expectedRevision: 0, idempotencyKey: "cancel-1" })).rejects.toBeInstanceOf(DrawingRunError);
  });

  it("scopes same-owner reads to the authenticated device and does not schedule foreign or stale resumes", async () => {
    const store = new InMemoryDrawingRunStore();
    const first = new InMemoryDrawingRunCoordinator({ store, createRunId: (() => {
      let sequence = 0;
      return () => `run-device-${++sequence}`;
    })() });
    const deviceA = await first.start({ ownerId: "owner-1", deviceId: "device-a", idempotencyKey: "start-device-a", intent });
    const deviceB = await first.start({ ownerId: "owner-1", deviceId: "device-b", idempotencyKey: "start-device-b", intent });
    let calls = 0;
    const coordinator = new InMemoryDrawingRunCoordinator({
      store,
      workflow: {
        run: async (workflowInput) => {
          calls += 1;
          return {
            runId: workflowInput.runId,
            ownerId: workflowInput.ownerId,
            deviceId: workflowInput.deviceId,
            revision: workflowInput.revision,
            phase: "awaiting_input",
            artifactHashes: workflowInput.artifactHashes,
            evidencePackHash: null,
            needsInterpreter: false,
            proposalHash: null,
            assessment: null,
            pvpHash: null,
            qaHash: null,
            pauseReason: "input_required",
          };
        },
      },
    });

    await expect(coordinator.list("owner-1", "device-a")).resolves.toEqual([deviceA]);
    await expect(coordinator.get("owner-1", deviceB.runId, "device-a")).resolves.toBeNull();
    await expect(coordinator.listEvents("owner-1", deviceB.runId, "device-a")).resolves.toBeNull();
    await expect(coordinator.resume({ ownerId: "owner-1", deviceId: "device-a", runId: deviceB.runId, expectedRevision: 0, idempotencyKey: "resume-device-mismatch" })).rejects.toBeInstanceOf(DrawingRunError);
    await expect(coordinator.resume({ ownerId: "owner-1", deviceId: "device-a", runId: deviceA.runId, expectedRevision: 1, idempotencyKey: "resume-stale-revision" })).rejects.toBeInstanceOf(DrawingRunError);
    expect(calls).toBe(0);
  });

  it("does not schedule or transition a device-tampered persisted run through authenticated resume", async () => {
    const store = new JsonTamperingDrawingRunStore();
    const first = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-tampered-resume" });
    const started = await first.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-tampered-resume", intent });
    let calls = 0;
    const coordinator = new InMemoryDrawingRunCoordinator({
      store,
      workflow: {
        run: async (workflowInput) => {
          calls += 1;
          return {
            runId: workflowInput.runId,
            ownerId: workflowInput.ownerId,
            deviceId: workflowInput.deviceId,
            revision: workflowInput.revision,
            phase: "awaiting_input",
            artifactHashes: workflowInput.artifactHashes,
            evidencePackHash: null,
            needsInterpreter: false,
            proposalHash: null,
            assessment: null,
            pvpHash: null,
            qaHash: null,
            pauseReason: "input_required",
          };
        },
      },
    });
    store.tamperDevice = true;
    store.captureCommits = true;

    await expect(coordinator.resume({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "resume-tampered" })).rejects.toBeInstanceOf(DrawingRunError);

    expect(calls).toBe(0);
    expect(store.capturedCommitCount).toBe(0);
  });

  it("commits a concurrent command and its event exactly once", async () => {
    const foundation = new InMemoryFoundationStore();
    const coordinator = new InMemoryDrawingRunCoordinator({
      store: new FoundationDrawingRunStoreAdapter(foundation),
      createRunId: () => "run-atomic-transition",
    });
    const started = await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-atomic", intent });
    const command = {
      ownerId: "owner-1",
      deviceId: "device-1",
      runId: started.runId,
      expectedRevision: 0,
      idempotencyKey: "accept-atomic",
      type: "accept_input" as const,
      receiptIds: ["receipt-1"],
      artifactHash: "a".repeat(64),
    };

    const results = await Promise.all([coordinator.dispatch(command), coordinator.dispatch(command)]);
    expect(results[0]).toMatchObject({ status: "input_accepted", revision: 1 });
    expect(results[1]).toEqual(results[0]);
    await expect(coordinator.listEvents("owner-1", started.runId, "device-1")).resolves.toMatchObject([{ revision: 1, action: "received" }]);
  });

  it("restores start idempotency from the shared durable store", async () => {
    const foundation = new InMemoryFoundationStore();
    const first = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), createRunId: () => "run-1" });
    const input = { ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-1", intent };
    const started = await first.start(input);
    const second = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), createRunId: () => "run-2" });
    await expect(second.start(input)).resolves.toEqual(started);
  });

  it("does not schedule a valid persisted non-terminal run from unauthenticated cold recovery", async () => {
    const foundation = new InMemoryFoundationStore();
    const first = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), createRunId: () => "run-recovery" });
    const input = { ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-recovery", intent };
    const started = await first.start(input);
    await first.acceptInput({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "accept-recovery", receiptIds: ["receipt-1"], artifactHash: "a".repeat(64) });

    let calls = 0;
    const workflow: DrawingWorkflowRunner = {
      run: async (workflowInput) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          runId: workflowInput.runId,
          ownerId: workflowInput.ownerId,
          deviceId: workflowInput.deviceId,
          revision: workflowInput.revision,
          phase: "awaiting_input",
          artifactHashes: workflowInput.artifactHashes,
          evidencePackHash: null,
          needsInterpreter: false,
          proposalHash: null,
          assessment: null,
          pvpHash: null,
          qaHash: null,
          pauseReason: "input_required",
        };
      },
    };
    const second = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), workflow });
    await Promise.all([second.recover(), second.recover()]);
    expect(calls).toBe(0);
  });

  it("does not schedule or transition a device-tampered run from unauthenticated cold recovery", async () => {
    const store = new JsonTamperingDrawingRunStore();
    const first = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-tampered-cold-recovery" });
    const started = await first.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-tampered-cold-recovery", intent });
    await first.acceptInput({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "accept-tampered-cold-recovery", receiptIds: ["receipt-1"], artifactHash: "a".repeat(64) });

    let calls = 0;
    const workflow: DrawingWorkflowRunner = {
      run: async (workflowInput) => {
        calls += 1;
        return {
          runId: workflowInput.runId,
          ownerId: workflowInput.ownerId,
          deviceId: workflowInput.deviceId,
          revision: workflowInput.revision,
          phase: "awaiting_input",
          artifactHashes: workflowInput.artifactHashes,
          evidencePackHash: null,
          needsInterpreter: false,
          proposalHash: null,
          assessment: null,
          pvpHash: null,
          qaHash: null,
          pauseReason: "input_required",
        };
      },
    };
    store.tamperDevice = true;
    store.captureCommits = true;
    const coldCoordinator = new InMemoryDrawingRunCoordinator({ store, workflow });

    await coldCoordinator.recover();

    expect(calls).toBe(0);
    expect(store.capturedCommitCount).toBe(0);
    store.tamperDevice = false;
    await expect(coldCoordinator.get("owner-1", started.runId, "device-1")).resolves.toMatchObject({ status: "input_accepted", revision: 1 });
  });

  it("schedules a valid persisted run through device-authenticated resume", async () => {
    const store = new InMemoryDrawingRunStore();
    const first = new InMemoryDrawingRunCoordinator({ store, createRunId: () => "run-authenticated-resume" });
    const started = await first.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-authenticated-resume", intent });

    let calls = 0;
    const workflow: DrawingWorkflowRunner = {
      run: async (workflowInput) => {
        calls += 1;
        return {
          runId: workflowInput.runId,
          ownerId: workflowInput.ownerId,
          deviceId: workflowInput.deviceId,
          revision: workflowInput.revision,
          phase: "awaiting_input",
          artifactHashes: workflowInput.artifactHashes,
          evidencePackHash: null,
          needsInterpreter: false,
          proposalHash: null,
          assessment: null,
          pvpHash: null,
          qaHash: null,
          pauseReason: "input_required",
        };
      },
    };
    const second = new InMemoryDrawingRunCoordinator({ store, workflow });

    await second.resume({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "resume-authenticated" });
    for (let attempt = 0; attempt < 20 && calls === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(calls).toBe(1);
  });

  it("does not schedule a cold recovery across coordinator instances", async () => {
    const foundation = new InMemoryFoundationStore();
    const first = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), createRunId: () => "run-shared-lease" });
    const started = await first.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-shared-lease", intent });
    await first.acceptInput({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "accept-shared-lease", receiptIds: ["receipt-1"], artifactHash: "a".repeat(64) });

    let calls = 0;
    const workflow: DrawingWorkflowRunner = {
      run: async (workflowInput) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          runId: workflowInput.runId,
          ownerId: workflowInput.ownerId,
          deviceId: workflowInput.deviceId,
          revision: workflowInput.revision,
          phase: "awaiting_input",
          artifactHashes: workflowInput.artifactHashes,
          evidencePackHash: null,
          needsInterpreter: false,
          proposalHash: null,
          assessment: null,
          pvpHash: null,
          qaHash: null,
          pauseReason: "input_required",
        };
      },
    };
    const sharedLease = new InMemoryLeaseCoordinator();
    const second = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), workflow, leaseCoordinator: sharedLease, instanceId: "coordinator-2" });
    const third = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), workflow, leaseCoordinator: sharedLease, instanceId: "coordinator-3" });

    await Promise.all([second.recover(), third.recover()]);
    expect(calls).toBe(0);
  });

  it("records provider timeout separately from validation failures", async () => {
    const workflow: DrawingWorkflowRunner = {
      run: async (workflowInput) => {
        if (workflowInput.artifactHashes.length === 0) {
          return {
            runId: workflowInput.runId,
            ownerId: workflowInput.ownerId,
            deviceId: workflowInput.deviceId,
            revision: workflowInput.revision,
            phase: "awaiting_input",
            artifactHashes: [],
            evidencePackHash: null,
            needsInterpreter: false,
            proposalHash: null,
            assessment: null,
            pvpHash: null,
            qaHash: null,
            pauseReason: "input_required",
          };
        }
        throw new DrawingWorkflowError("provider_timeout", "provider deadline exceeded");
      },
    };
    const coordinator = new InMemoryDrawingRunCoordinator({ createRunId: () => "run-provider-timeout", workflow });
    const started = await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-provider-timeout", intent });
    await coordinator.acceptInput({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "accept-provider-timeout", receiptIds: ["receipt-1"], artifactHash: "a".repeat(64) });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const current = await coordinator.get("owner-1", started.runId, "device-1");
      if (current?.status === "failed") {
        expect(current.errorCategory).toBe("provider_timeout");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Drawing Run did not fail");
  });

  it("does not rerun the structure workflow after preview publication", async () => {
    const digest = "b".repeat(64);
    let calls = 0;
    const workflow: DrawingWorkflowRunner = {
      run: async (workflowInput) => {
        calls += 1;
        return {
          runId: workflowInput.runId,
          ownerId: workflowInput.ownerId,
          deviceId: workflowInput.deviceId,
          revision: workflowInput.revision,
          phase: "preview_ready",
          artifactHashes: workflowInput.artifactHashes,
          evidencePackHash: digest,
          needsInterpreter: false,
          proposalHash: null,
          assessment: { kind: "formal", candidateHash: digest, ugsHash: digest },
          pvpHash: digest,
          qaHash: digest,
          pauseReason: null,
        };
      },
    };
    const coordinator = new InMemoryDrawingRunCoordinator({ createRunId: () => "run-preview-fence", workflow });
    const started = await coordinator.start({ ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-preview-fence", intent });
    await coordinator.acceptInput({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 0, idempotencyKey: "accept-preview-fence", receiptIds: ["receipt-1"], artifactHash: digest });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBeGreaterThan(0);
    const callsAtPreview = calls;
    const current = await coordinator.get("owner-1", started.runId, "device-1");
    await coordinator.resume({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: current!.revision, idempotencyKey: "resume-preview-fence" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(callsAtPreview);
  });
});
