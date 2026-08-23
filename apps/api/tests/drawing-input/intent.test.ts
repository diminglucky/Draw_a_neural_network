import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StaticPyTorchReceiptAdapter, TypedArchitectureDeclarationAdapter, parseArchitectureDeclaration } from "../../src/drawing-input/intent.js";
import { InMemoryPrivateReceiptStore, receiptBatchHash } from "../../src/drawing-input/private-receipt.js";
import { InMemoryEvidencePackStore, ReceiptBoundEvidenceAnalyzer } from "../../src/drawing-input/intent.js";
import { createReceiptBoundDrawingWorkflow } from "../../src/drawing-input/intent.js";
import { MemorySaver } from "@langchain/langgraph";
import { InMemoryDrawingArtifactStore } from "../../src/drawing-input/drawing-artifacts.js";
import { createPublicationDrawingWorkflowComposer } from "../../src/drawing-run/publication-composer.js";

function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

describe("drawing input adapters", () => {
  it("wraps static PyTorch analysis without executing the source", async () => {
    const store = new InMemoryPrivateReceiptStore();
    const code = Buffer.from("class N(nn.Module):\n def __init__(self):\n  self.a = nn.Linear(2,2)\n def forward(self,x):\n  return self.a(x)\n", "utf8");
    const receipt = await store.ingest({ ownerId: "owner-1", kind: "pytorch_source", mimeType: "text/x-python", bytes: code, sha256: sha256(code) });
    const pack = await new StaticPyTorchReceiptAdapter(store).analyze(receipt);
    expect(pack.facts.length).toBeGreaterThan(0);
    expect(pack.facts.every((fact) => fact.sourceKind === "static_analysis")).toBe(true);
    expect(pack.unresolved).toEqual([]);
  });

  it("accepts typed declarations only after closed-reference validation", async () => {
    const declaration = { version: 1, nodes: [{ id: "input", kind: "input", label: "Input", ordinal: 1 }, { id: "output", kind: "output", label: "Output", ordinal: 2 }], ports: [{ id: "in-out", nodeId: "input", direction: "output", label: null, ordinal: 3 }, { id: "out-in", nodeId: "output", direction: "input", label: null, ordinal: 4 }], edges: [{ id: "edge-1", sourcePortId: "in-out", targetPortId: "out-in", relation: "data", ordinal: 5 }], unresolved: [] };
    expect(parseArchitectureDeclaration(declaration)).toMatchObject({ version: 1 });
    expect(parseArchitectureDeclaration(declaration).nodes[0]).toMatchObject({ id: "input" });
    const store = new InMemoryPrivateReceiptStore();
    const bytes = Buffer.from(JSON.stringify(declaration), "utf8");
    const receipt = await store.ingest({ ownerId: "owner-1", kind: "architecture_description", mimeType: "application/json", bytes, sha256: sha256(bytes), retention: "owner_revision" });
    const pack = await new TypedArchitectureDeclarationAdapter(store).analyze(receipt);
    expect(pack.facts).toHaveLength(5);
    expect(() => parseArchitectureDeclaration({ ...declaration, edges: [{ ...declaration.edges[0], targetPortId: "missing" }] })).toThrow(/unknown port/i);
    expect(() => parseArchitectureDeclaration({ ...declaration, nodes: [{ ...declaration.nodes[0], label: "C:\\secret\\model.py" }] })).toThrow(/invalid/i);
  });

  it("binds receipt batches to the analyzer without placing receipt IDs in graph state", async () => {
    const store = new InMemoryPrivateReceiptStore();
    const bytes = Buffer.from("class N(nn.Module):\n", "utf8");
    const receipt = await store.ingest({ ownerId: "owner-1", kind: "pytorch_source", mimeType: "text/x-python", bytes, sha256: sha256(bytes), retention: "owner_revision" });
    const batchHash = receiptBatchHash([receipt]);
    await store.bindBatchHash("owner-1", batchHash, [receipt.receiptId]);
    const packs = new InMemoryEvidencePackStore();
    const result = await new ReceiptBoundEvidenceAnalyzer(store, packs).analyze({ ownerId: "owner-1", artifactHashes: [batchHash] });
    expect(result.needsInterpreter).toBe(false);
    expect(await packs.get("owner-1", result.evidencePackHash)).toMatchObject({ version: 1, hash: result.evidencePackHash });
  });

  it("formalizes a proven static linear graph without requiring a Provider", async () => {
    const store = new InMemoryPrivateReceiptStore();
    const code = Buffer.from([
      "import torch.nn as nn",
      "class N(nn.Module):",
      "    def __init__(self):",
      "        self.a = nn.Linear(2,2)",
      "    def forward(self,x):",
      "        return self.a(x)",
    ].join("\n"), "utf8");
    const receipt = await store.ingest({ ownerId: "owner-1", kind: "pytorch_source", mimeType: "text/x-python", bytes: code, sha256: sha256(code), retention: "owner_revision" });
    const batchHash = receiptBatchHash([receipt]);
    await store.bindBatchHash("owner-1", batchHash, [receipt.receiptId]);
    const runner = createReceiptBoundDrawingWorkflow({
      receipts: store,
      evidencePacks: new InMemoryEvidencePackStore(),
      composer: { compose: async () => ({ pvpHash: "d".repeat(64), qaHash: "e".repeat(64) }) },
      checkpointer: new MemorySaver(),
    });
    const result = await runner.run({ runId: "run-static", ownerId: "owner-1", deviceId: "device-1", revision: 0, artifactHashes: [batchHash] });
    expect(result.assessment?.kind).toBe("formal");
    expect(result.phase).toBe("preview_ready");
  });

  it("runs the proven static lane through the real formal publication composer", async () => {
    const store = new InMemoryPrivateReceiptStore();
    const code = Buffer.from([
      "import torch.nn as nn",
      "class N(nn.Module):",
      "    def __init__(self):",
      "        self.a = nn.Linear(2,2)",
      "    def forward(self,x):",
      "        return self.a(x)",
    ].join("\n"), "utf8");
    const receipt = await store.ingest({ ownerId: "owner-1", kind: "pytorch_source", mimeType: "text/x-python", bytes: code, sha256: sha256(code), retention: "owner_revision" });
    const batchHash = receiptBatchHash([receipt]);
    await store.bindBatchHash("owner-1", batchHash, [receipt.receiptId]);
    const artifacts = new InMemoryDrawingArtifactStore();
    const runner = createReceiptBoundDrawingWorkflow({
      receipts: store,
      evidencePacks: new InMemoryEvidencePackStore(),
      artifacts,
      composer: createPublicationDrawingWorkflowComposer(artifacts),
      checkpointer: new MemorySaver(),
    });
    const result = await runner.run({ runId: "run-static-real-composer", ownerId: "owner-1", deviceId: "device-1", revision: 0, artifactHashes: [batchHash] });
    expect(result.phase).toBe("preview_ready");
    expect(result.pvpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await artifacts.getPvp("owner-1", result.pvpHash!)).not.toBeNull();
  });

  it("assembles the receipt, Provider, Harness, and LangGraph ports without exposing private IDs", async () => {
    const declaration = { version: 1, nodes: [{ id: "input", kind: "input", label: "Input", ordinal: 1 }, { id: "output", kind: "output", label: "Output", ordinal: 2 }], ports: [{ id: "in-out", nodeId: "input", direction: "output", label: null, ordinal: 3 }, { id: "out-in", nodeId: "output", direction: "input", label: null, ordinal: 4 }], edges: [{ id: "edge-1", sourcePortId: "in-out", targetPortId: "out-in", relation: "data", ordinal: 5 }], unresolved: [] };
    const store = new InMemoryPrivateReceiptStore();
    const bytes = Buffer.from(JSON.stringify(declaration), "utf8");
    const receipt = await store.ingest({ ownerId: "owner-1", kind: "architecture_description", mimeType: "application/json", bytes, sha256: sha256(bytes), retention: "owner_revision" });
    const batchHash = receiptBatchHash([receipt]);
    await store.bindBatchHash("owner-1", batchHash, [receipt.receiptId]);
    const packs = new InMemoryEvidencePackStore();
    const proposal = { version: 2, nodes: [{ localRef: "a", kind: "input", displayLabel: "Input", inputLocalRefs: [], outputLocalRefs: ["a-out"], evidenceRefs: ["fact:f:1"] }, { localRef: "b", kind: "output", displayLabel: "Output", inputLocalRefs: ["b-in"], outputLocalRefs: [], evidenceRefs: ["fact:f:2"] }], ports: [{ localRef: "a-out", nodeLocalRef: "a", direction: "output", displayLabel: null, evidenceRefs: ["fact:f:1"] }, { localRef: "b-in", nodeLocalRef: "b", direction: "input", displayLabel: null, evidenceRefs: ["fact:f:2"] }], edges: [{ localRef: "e", sourcePortLocalRef: "a-out", targetPortLocalRef: "b-in", relation: "data", evidenceRefs: ["fact:f:3"] }], unresolved: [] };
    const runner = createReceiptBoundDrawingWorkflow({
      receipts: store,
      evidencePacks: packs,
      provider: { propose: async (payload) => { expect(payload).not.toHaveProperty("ownerId"); expect(payload).not.toHaveProperty("contextId"); return proposal; } },
      composer: { compose: async () => ({ pvpHash: "d".repeat(64), qaHash: "e".repeat(64) }) },
      checkpointer: new MemorySaver(),
    });
    const result = await runner.run({ runId: "run-1", ownerId: "owner-1", deviceId: "device-1", revision: 0, artifactHashes: [batchHash] });
    expect(result.phase).toBe("preview_ready");
    expect(result.proposalHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
