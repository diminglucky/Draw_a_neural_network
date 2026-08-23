import { createHash } from "node:crypto";
import { analyzeStaticPyTorchSource } from "../static-pytorch-source-analyzer.js";
import { assertEvidencePack, evidencePackFromStaticAnalysis, createEvidencePack, mergeEvidencePacks, type EvidencePack } from "./evidence-pack.js";
import { assertReceiptKindAndMime, type PrivateInputReceipt, type PrivateReceiptStore } from "./private-receipt.js";
import { createProviderContextReference, providerContextPayload, type ProviderContextPayload } from "./provider-context.js";
import { createDrawingWorkflowRunner, type DrawingWorkflowComposer, type DrawingWorkflowRunner } from "../drawing-run/langgraph-workflow.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createStoredArchitectureInterpreter, InMemoryLocalProposalStore, ReceiptBoundStructuralHarness, type LocalProposalStore } from "./structural-harness.js";

export interface ArchitectureDeclaration {
  version: 1;
  nodes: Array<{ id: string; kind: "input" | "output" | "operator" | "module"; label: string; ordinal: number }>;
  ports: Array<{ id: string; nodeId: string; direction: "input" | "output"; label: string | null; ordinal: number }>;
  edges: Array<{ id: string; sourcePortId: string; targetPortId: string; relation: "data" | "skip" | "merge" | "condition" | "feedback"; ordinal: number }>;
  unresolved: Array<{ code: string; severity: "blocking" | "warning"; summary: string; ordinal: number }>;
}

export class StaticPyTorchReceiptAdapter {
  constructor(private readonly receipts: PrivateReceiptStore) {}

  async analyze(receipt: PrivateInputReceipt): Promise<EvidencePack> {
    if (receipt.kind !== "pytorch_source") throw new Error("Static PyTorch adapter requires a pytorch_source receipt");
    assertReceiptKindAndMime(receipt.kind, receipt.mimeType);
    const bytes = await this.receipts.read(receipt.ownerId, receipt.receiptId);
    if (!bytes) throw new Error("Private PyTorch receipt content is unavailable");
    const code = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return evidencePackFromStaticAnalysis(analyzeStaticPyTorchSource({ sourceId: receipt.receiptId, sourceSha256: receipt.sha256, code }));
  }
}

export class TypedArchitectureDeclarationAdapter {
  constructor(private readonly receipts: PrivateReceiptStore) {}

  async analyze(receipt: PrivateInputReceipt): Promise<EvidencePack> {
    if (receipt.kind !== "architecture_description") throw new Error("Architecture adapter requires an architecture_description receipt");
    const bytes = await this.receipts.read(receipt.ownerId, receipt.receiptId);
    if (!bytes) throw new Error("Private architecture receipt content is unavailable");
    const declaration = parseArchitectureDeclaration(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    return evidencePackFromDeclaration(declaration, receipt.sha256);
  }
}

export interface EvidencePackStore {
  put(ownerId: string, pack: EvidencePack): Promise<void>;
  get(ownerId: string, hash: string): Promise<EvidencePack | null>;
}

export class InMemoryEvidencePackStore implements EvidencePackStore {
  private readonly packs = new Map<string, EvidencePack>();

  async put(ownerId: string, pack: EvidencePack): Promise<void> {
    const validated = assertEvidencePack(pack);
    this.packs.set(`${ownerId}:${validated.hash}`, structuredClone(validated));
  }
  async get(ownerId: string, hash: string): Promise<EvidencePack | null> {
    const pack = this.packs.get(`${ownerId}:${hash}`);
    return pack ? structuredClone(assertEvidencePack(pack)) : null;
  }
}

export class ReceiptBoundEvidenceAnalyzer {
  private readonly staticAdapter: StaticPyTorchReceiptAdapter;
  private readonly architectureAdapter: TypedArchitectureDeclarationAdapter;

  constructor(private readonly receipts: PrivateReceiptStore, private readonly packs: EvidencePackStore) {
    this.staticAdapter = new StaticPyTorchReceiptAdapter(receipts);
    this.architectureAdapter = new TypedArchitectureDeclarationAdapter(receipts);
  }

  async analyze(input: { ownerId: string; artifactHashes: readonly string[] }): Promise<{ evidencePackHash: string; needsInterpreter: boolean }> {
    const batchHash = input.artifactHashes[0];
    if (!batchHash) throw new Error("Drawing Run has no receipt batch hash");
    const receipts = await this.receipts.findByBatchHash(input.ownerId, batchHash);
    if (receipts.length === 0) throw new Error("Receipt batch is unavailable or owner-bound hash does not match");
    const packs: EvidencePack[] = [];
    let needsInterpreter = false;
    for (const receipt of receipts) {
      if (receipt.kind === "pytorch_source") packs.push(await this.staticAdapter.analyze(receipt));
      else if (receipt.kind === "architecture_description") {
        packs.push(await this.architectureAdapter.analyze(receipt));
        needsInterpreter = true;
      } else if (receipt.kind === "typed_text") {
        const bytes = await this.receipts.read(receipt.ownerId, receipt.receiptId);
        if (!bytes) throw new Error("Private typed text receipt content is unavailable");
        const summary = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
        packs.push(createEvidencePack({ facts: [{ sourceKind: "architecture_fact", sourceHash: receipt.sha256, locatorKind: "section", locatorOrdinal: 1, excerptDigest: receipt.sha256, summary, confidence: null, semanticKey: "typed-text:architecture" }] }));
        needsInterpreter = true;
      } else {
        throw new Error("Sketch receipts are candidate-only and need a dedicated observation adapter");
      }
    }
    const pack = mergeEvidencePacks(packs);
    await this.packs.put(input.ownerId, pack);
    return { evidencePackHash: pack.hash, needsInterpreter };
  }
}

export function createReceiptBoundProviderContext(packs: EvidencePackStore) {
  return async (input: { runId: string; ownerId: string; deviceId: string; revision: number; evidencePackHash: string }): Promise<ProviderContextPayload> => {
    const pack = await packs.get(input.ownerId, input.evidencePackHash);
    if (!pack) throw new Error("EvidencePack is unavailable for Provider context");
    const reference = createProviderContextReference({ runId: input.runId, ownerId: input.ownerId, deviceId: input.deviceId, expectedRevision: input.revision, evidencePackHash: input.evidencePackHash, allowedPurpose: "architecture_interpretation" });
    return providerContextPayload(reference, pack);
  };
}

export function createReceiptBoundDrawingWorkflow(input: {
  receipts: PrivateReceiptStore;
  evidencePacks: EvidencePackStore;
  proposals?: LocalProposalStore;
  artifacts?: import("./drawing-artifacts.js").DrawingArtifactStore;
  provider?: { propose(payload: ProviderContextPayload): Promise<unknown> };
  composer: DrawingWorkflowComposer;
  checkpointer: BaseCheckpointSaver;
}): DrawingWorkflowRunner {
  const proposals = input.proposals ?? new InMemoryLocalProposalStore();
  const analyzer = new ReceiptBoundEvidenceAnalyzer(input.receipts, input.evidencePacks);
  const harness = new ReceiptBoundStructuralHarness(input.evidencePacks, proposals, input.artifacts);
  return createDrawingWorkflowRunner({
    analyzer,
    ...(input.provider ? { interpreter: createStoredArchitectureInterpreter(input.provider, proposals), providerContext: createReceiptBoundProviderContext(input.evidencePacks) } : {}),
    harness,
    composer: input.composer,
    checkpointer: input.checkpointer,
  });
}

export function parseArchitectureDeclaration(value: unknown): ArchitectureDeclaration {
  if (!record(value)) throw new Error("ArchitectureDeclaration must be an object");
  exactKeys(value, ["version", "nodes", "ports", "edges", "unresolved"]);
  if (value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.ports) || !Array.isArray(value.edges) || !Array.isArray(value.unresolved)) throw new Error("ArchitectureDeclaration is invalid");
  const nodes = value.nodes.map((item, index) => {
    const node = objectItem(item, `nodes[${index}]`); exactKeys(node, ["id", "kind", "label", "ordinal"]);
    const kind = oneOf(node.kind, ["input", "output", "operator", "module"] as const);
    return { id: identifier(node.id, `nodes[${index}].id`), kind, label: safeLabel(node.label, `nodes[${index}].label`), ordinal: ordinal(node.ordinal, `nodes[${index}].ordinal`) };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const ports = value.ports.map((item, index) => {
    const port = objectItem(item, `ports[${index}]`); exactKeys(port, ["id", "nodeId", "direction", "label", "ordinal"]);
    if (!nodeIds.has(port.nodeId)) throw new Error(`ports[${index}] references an unknown node`);
    return { id: identifier(port.id, `ports[${index}].id`), nodeId: identifier(port.nodeId, `ports[${index}].nodeId`), direction: oneOf(port.direction, ["input", "output"] as const), label: port.label === null ? null : safeLabel(port.label, `ports[${index}].label`), ordinal: ordinal(port.ordinal, `ports[${index}].ordinal`) };
  });
  const portIds = new Set(ports.map((port) => port.id));
  const edges = value.edges.map((item, index) => {
    const edge = objectItem(item, `edges[${index}]`); exactKeys(edge, ["id", "sourcePortId", "targetPortId", "relation", "ordinal"]);
    if (!portIds.has(edge.sourcePortId) || !portIds.has(edge.targetPortId)) throw new Error(`edges[${index}] references an unknown port`);
    return { id: identifier(edge.id, `edges[${index}].id`), sourcePortId: identifier(edge.sourcePortId, `edges[${index}].sourcePortId`), targetPortId: identifier(edge.targetPortId, `edges[${index}].targetPortId`), relation: oneOf(edge.relation, ["data", "skip", "merge", "condition", "feedback"] as const), ordinal: ordinal(edge.ordinal, `edges[${index}].ordinal`) };
  });
  const unresolved = value.unresolved.map((item, index) => {
    const unresolvedItem = objectItem(item, `unresolved[${index}]`); exactKeys(unresolvedItem, ["code", "severity", "summary", "ordinal"]);
    return { code: identifier(unresolvedItem.code, `unresolved[${index}].code`), severity: oneOf(unresolvedItem.severity, ["blocking", "warning"] as const), summary: safeLabel(unresolvedItem.summary, `unresolved[${index}].summary`), ordinal: ordinal(unresolvedItem.ordinal, `unresolved[${index}].ordinal`) };
  });
  unique(nodes.map((item) => item.id), "node IDs"); unique(ports.map((item) => item.id), "port IDs"); unique(edges.map((item) => item.id), "edge IDs");
  return { version: 1, nodes, ports, edges, unresolved };
}

function evidencePackFromDeclaration(declaration: ArchitectureDeclaration, sourceHash: string): EvidencePack {
  const facts = [
    ...declaration.nodes.map((node) => declarationFact(sourceHash, node.ordinal, `node ${node.id} ${node.kind} ${node.label}`, `node:${node.id}`)),
    ...declaration.ports.map((port) => declarationFact(sourceHash, port.ordinal, `port ${port.id} ${port.direction} node ${port.nodeId}`, `port:${port.id}`)),
    ...declaration.edges.map((edge) => declarationFact(sourceHash, edge.ordinal, `edge ${edge.id} ${edge.sourcePortId} to ${edge.targetPortId} ${edge.relation}`, `edge:${edge.id}`)),
    ...declaration.unresolved.map((item) => declarationFact(sourceHash, item.ordinal, `unresolved ${item.code} ${item.summary}`, `unresolved:${item.code}`)),
  ];
  const unresolved = declaration.unresolved.map((item) => ({ code: item.code, severity: item.severity, summary: item.summary, sourceKind: "typed_declaration" as const, sourceHash, locatorKind: "section" as const, locatorOrdinal: item.ordinal }));
  return createEvidencePack({ facts, unresolved });
}

function declarationFact(sourceHash: string, ordinalValue: number, summary: string, semanticKey: string) {
  return { sourceKind: "typed_declaration" as const, sourceHash, locatorKind: "section" as const, locatorOrdinal: ordinalValue, excerptDigest: createHash("sha256").update(summary, "utf8").digest("hex"), summary, confidence: 1, semanticKey };
}

function record(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function objectItem(value: unknown, location: string): Record<string, any> { if (!record(value)) throw new Error(`${location} must be an object`); return value; }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void { if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("ArchitectureDeclaration contains unsupported fields"); }
function identifier(value: unknown, location: string): string { if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`${location} is invalid`); return value; }
function safeLabel(value: unknown, location: string): string { if (typeof value !== "string") throw new Error(`${location} is invalid`); const label = value.trim(); if (label.length < 1 || label.length > 160 || /[\r\n]|[<>]|(?:[A-Za-z]:[\\/])|(?:https?:\/\/)|(?:\b(?:path|coordinate|renderer|visio|com|shell|exec|token|password|secret)\b)/i.test(label)) throw new Error(`${location} is invalid`); return label; }
function ordinal(value: unknown, location: string): number { if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000_000) throw new Error(`${location} is invalid`); return value as number; }
function oneOf<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== "string" || !values.includes(value as T)) throw new Error("ArchitectureDeclaration enum value is invalid"); return value as T; }
function unique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`); }
