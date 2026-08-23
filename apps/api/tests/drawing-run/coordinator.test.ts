import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemorySaver } from "@langchain/langgraph";
import { InMemoryDrawingRunCoordinator } from "../../src/drawing-run/coordinator.js";
import { DrawingRunError } from "../../src/drawing-run/errors.js";
import { InMemoryFoundationStore } from "../../src/store.js";
import { FoundationDrawingRunStoreAdapter } from "../../src/drawing-run/store.js";
import type { DrawingWorkflowRunner } from "../../src/drawing-run/langgraph-workflow.js";
import { InMemoryPrivateReceiptStore, receiptBatchHash } from "../../src/drawing-input/private-receipt.js";
import { InMemoryEvidencePackStore, createReceiptBoundDrawingWorkflow } from "../../src/drawing-input/intent.js";
import { InMemoryDrawingArtifactStore } from "../../src/drawing-input/drawing-artifacts.js";
import { createPublicationDrawingWorkflowComposer } from "../../src/drawing-run/publication-composer.js";

const intent = {
  action: "create_figure" as const,
  requestedDetail: "overview" as const,
  target: "browser_preview" as const,
  sourceKinds: ["typed_text" as const],
};

describe("Drawing Run coordinator", () => {
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
        const current = await coordinator.get("owner-1", started.runId);
        if (current?.status === status) return current;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const final = await coordinator.get("owner-1", started.runId);
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
    await expect(coordinator.get("owner-1", "run-langgraph")).resolves.toMatchObject({ status: "preview_ready" });
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
    await expect(coordinator.get("owner-2", "run-1")).resolves.toBeNull();
    await expect(coordinator.cancel({ ownerId: "owner-1", deviceId: "foreign", runId: "run-1", expectedRevision: 0, idempotencyKey: "cancel-1" })).rejects.toBeInstanceOf(DrawingRunError);
  });

  it("restores start idempotency from the shared durable store", async () => {
    const foundation = new InMemoryFoundationStore();
    const first = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), createRunId: () => "run-1" });
    const input = { ownerId: "owner-1", deviceId: "device-1", idempotencyKey: "start-1", intent };
    const started = await first.start(input);
    const second = new InMemoryDrawingRunCoordinator({ store: new FoundationDrawingRunStoreAdapter(foundation), createRunId: () => "run-2" });
    await expect(second.start(input)).resolves.toEqual(started);
  });

  it("recovers a persisted non-terminal run and fences duplicate scheduling", async () => {
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
    expect(calls).toBe(1);
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
    await coordinator.resume({ ownerId: "owner-1", deviceId: "device-1", runId: started.runId, expectedRevision: 4, idempotencyKey: "resume-preview-fence" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(callsAtPreview);
  });
});
