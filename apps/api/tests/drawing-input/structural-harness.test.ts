import { describe, expect, it } from "vitest";
import { createEvidencePack, type EvidencePack } from "../../src/drawing-input/evidence-pack.js";
import { assessInterpreterProposal, createDeterministicLocalProposal, createStoredArchitectureInterpreter, InMemoryLocalProposalStore, ReceiptBoundStructuralHarness, type InterpreterLocalProposal } from "../../src/drawing-input/structural-harness.js";
import { InMemoryEvidencePackStore } from "../../src/drawing-input/intent.js";

function evidencePack(overrides: { secondConfidence?: number; blocking?: boolean } = {}): EvidencePack {
  const facts = [
    { sourceKind: "typed_declaration" as const, sourceHash: "a".repeat(64), locatorKind: "section" as const, locatorOrdinal: 1, excerptDigest: "1".repeat(64), summary: "input declaration", confidence: 1, semanticKey: "node:input" },
    { sourceKind: "typed_declaration" as const, sourceHash: "a".repeat(64), locatorKind: "section" as const, locatorOrdinal: 2, excerptDigest: "2".repeat(64), summary: "operator declaration", confidence: overrides.secondConfidence ?? 1, semanticKey: "node:operator" },
    { sourceKind: "typed_declaration" as const, sourceHash: "a".repeat(64), locatorKind: "section" as const, locatorOrdinal: 3, excerptDigest: "3".repeat(64), summary: "output declaration", confidence: 1, semanticKey: "node:output" },
  ];
  return createEvidencePack({ facts, unresolved: overrides.blocking ? [{ code: "missing-merge", severity: "blocking", summary: "merge relation needs confirmation", sourceKind: "typed_declaration", sourceHash: "a".repeat(64), locatorKind: "section", locatorOrdinal: 4 }] : [] });
}

function proposal(rename = false, reorder = false, blocking = false): InterpreterLocalProposal {
  const suffix = rename ? "-renamed" : "";
  const nodes = [
    { localRef: `source${suffix}`, kind: "input" as const, displayLabel: "Suggested input", inputLocalRefs: [], outputLocalRefs: [`source-port${suffix}`], evidenceRefs: ["fact:f:1"] },
    { localRef: `middle${suffix}`, kind: "operator" as const, displayLabel: "custom block", inputLocalRefs: [`middle-in${suffix}`], outputLocalRefs: [`middle-out${suffix}`], evidenceRefs: ["fact:f:2"] },
    { localRef: `sink${suffix}`, kind: "output" as const, displayLabel: "Suggested output", inputLocalRefs: [`sink-port${suffix}`], outputLocalRefs: [], evidenceRefs: ["fact:f:3"] },
  ];
  const ports = [
    { localRef: `source-port${suffix}`, nodeLocalRef: `source${suffix}`, direction: "output" as const, displayLabel: null, evidenceRefs: ["fact:f:1"] },
    { localRef: `middle-in${suffix}`, nodeLocalRef: `middle${suffix}`, direction: "input" as const, displayLabel: "in", evidenceRefs: ["fact:f:2"] },
    { localRef: `middle-out${suffix}`, nodeLocalRef: `middle${suffix}`, direction: "output" as const, displayLabel: "out", evidenceRefs: ["fact:f:2"] },
    { localRef: `sink-port${suffix}`, nodeLocalRef: `sink${suffix}`, direction: "input" as const, displayLabel: null, evidenceRefs: ["fact:f:3"] },
  ];
  const edges = [
    { localRef: `first${suffix}`, sourcePortLocalRef: `source-port${suffix}`, targetPortLocalRef: `middle-in${suffix}`, relation: "data" as const, evidenceRefs: ["fact:f:2"] },
    { localRef: `last${suffix}`, sourcePortLocalRef: `middle-out${suffix}`, targetPortLocalRef: `sink-port${suffix}`, relation: "data" as const, evidenceRefs: ["fact:f:3"] },
  ];
  const unresolved = blocking ? [{ localRef: `question${suffix}`, scope: "topology" as const, severity: "blocking" as const, evidenceRefs: ["fact:f:2"] }] : [];
  return { version: 2, nodes: reorder ? nodes.slice().reverse() : nodes, ports: reorder ? ports.slice().reverse() : ports, edges: reorder ? edges.slice().reverse() : edges, unresolved };
}

describe("receipt-bound Structural Harness", () => {
  it("formalizes a verified local proposal with Harness-owned public IDs and labels", () => {
    const result = assessInterpreterProposal({ evidencePack: evidencePack(), proposal: proposal() });
    expect(result.kind).toBe("formal");
    if (result.kind !== "formal") return;
    expect(result.ugs.nodes.map((node) => node.nodeId)).toEqual(["node:n:1", "node:n:2", "node:n:3"]);
    expect(result.ugs.nodes.map((node) => node.label).sort()).toEqual(["Custom operator", "Input", "Output"]);
    expect(result.ugs.ports.every((port) => port.label === null)).toBe(true);
    expect(result.ugs.nodes.every((node) => node.evidenceIds.every((id) => id.startsWith("evidence:e:")))).toBe(true);
    expect(result.ugs.sourceIds).toEqual(["source:typed-declaration"]);
  });

  it("does not let provider display text change the public graph", () => {
    const base = proposal();
    const altered = {
      ...base,
      nodes: base.nodes.map((node) => ({ ...node, displayLabel: "Alternate label" })),
      ports: base.ports.map((port) => ({ ...port, displayLabel: "Renamed port" })),
    };
    const first = assessInterpreterProposal({ evidencePack: evidencePack(), proposal: base });
    const second = assessInterpreterProposal({ evidencePack: evidencePack(), proposal: altered });
    expect(first.kind).toBe("formal");
    expect(second.kind).toBe("formal");
    if (first.kind === "formal" && second.kind === "formal") {
      expect(second.ugsHash).toBe(first.ugsHash);
      expect(JSON.stringify(second.ugs)).not.toContain("Renamed");
    }
  });

  it("keeps formal hash stable across local-ref renaming and array reordering", () => {
    const first = assessInterpreterProposal({ evidencePack: evidencePack(), proposal: proposal() });
    const second = assessInterpreterProposal({ evidencePack: evidencePack(), proposal: proposal(true, true) });
    expect(first.kind).toBe("formal");
    expect(second.kind).toBe("formal");
    if (first.kind === "formal" && second.kind === "formal") expect(second.ugsHash).toBe(first.ugsHash);
  });

  it("keeps multi-port graph identity stable when port arrays are reordered", () => {
    const pack = topologyEvidencePack("merge", "Add");
    const original = createDeterministicLocalProposal(pack)!;
    const base = {
      ...original,
      ports: original.ports.map((port) => port.nodeLocalRef === "merge" ? { ...port, evidenceRefs: ["fact:f:1"] } : port),
    };
    const altered = {
      ...base,
      ports: [
        ...base.ports.filter((port) => port.nodeLocalRef !== "merge"),
        ...base.ports.filter((port) => port.nodeLocalRef === "merge").reverse(),
      ],
    };
    const first = assessInterpreterProposal({ evidencePack: pack, proposal: base });
    const second = assessInterpreterProposal({ evidencePack: pack, proposal: altered });
    expect(first.kind).toBe("formal");
    expect(second.kind).toBe("formal");
    if (first.kind === "formal" && second.kind === "formal") expect(second.ugsHash).toBe(first.ugsHash);
  });

  it("clarifies completely indistinguishable parallel ports instead of using array order", () => {
    const pack = topologyEvidencePack("merge", "Add");
    const base = createDeterministicLocalProposal(pack)!;
    const indistinguishable = {
      ...base,
      nodes: base.nodes.map((node) => node.localRef === "left" || node.localRef === "right" ? { ...node, evidenceRefs: ["fact:f:1"] } : node),
      ports: base.ports.map((port) => port.nodeLocalRef === "merge" || port.nodeLocalRef === "left" || port.nodeLocalRef === "right"
        ? { ...port, evidenceRefs: ["fact:f:1"] }
        : port),
      edges: base.edges.map((edge) => ({ ...edge, evidenceRefs: ["fact:f:1"] })),
    };
    const result = assessInterpreterProposal({ evidencePack: pack, proposal: indistinguishable });
    expect(result.kind).toBe("clarification");
    if (result.kind === "clarification") expect(result.clarification.code).toBe("ambiguous_structure");
  });

  it("rejects unknown fields, dangling facts, and unsafe provider text", () => {
    expect(assessInterpreterProposal({ evidencePack: evidencePack(), proposal: { ...proposal(), renderer: "visio" } }).kind).toBe("rejected");
    expect(assessInterpreterProposal({ evidencePack: evidencePack(), proposal: { ...proposal(), nodes: [{ ...proposal().nodes[0], evidenceRefs: ["fact:f:99"] }, ...proposal().nodes.slice(1)] } }).kind).toBe("rejected");
    expect(assessInterpreterProposal({ evidencePack: evidencePack(), proposal: { ...proposal(), nodes: [{ ...proposal().nodes[0], displayLabel: "C:\\private\\model.py" }, ...proposal().nodes.slice(1)] } }).kind).toBe("rejected");
  });

  it("returns one deterministic clarification for blocking structure", () => {
    const result = assessInterpreterProposal({ evidencePack: evidencePack({ blocking: true }), proposal: proposal(undefined, undefined, true) });
    expect(result.kind).toBe("clarification");
    if (result.kind !== "clarification") return;
    expect(result.clarification.code).toBe("blocking_unresolved");
    expect(result.candidateUgs.unresolved.some((item) => item.severity === "blocking")).toBe(true);
    expect(result.candidateUgs.edges.every((edge) => edge.knowledge === "candidate")).toBe(true);
    expect(result.candidateUgs.unresolved[0]?.id).toBe("unresolved:u:1");
    expect(result.candidateUgs.unresolved[0]?.id).not.toContain("question");
  });

  it("formalizes blocking topology only after an explicit confirmation", () => {
    const pending = assessInterpreterProposal({ evidencePack: evidencePack({ blocking: true }), proposal: proposal(undefined, undefined, true) });
    expect(pending.kind).toBe("clarification");
    const confirmed = assessInterpreterProposal({ evidencePack: evidencePack({ blocking: true }), proposal: proposal(undefined, undefined, true), confirmBlocking: true });
    expect(confirmed.kind).toBe("formal");
    if (confirmed.kind === "formal") {
      expect(confirmed.ugs.unresolved).toEqual([]);
      expect(confirmed.ugs.edges.every((edge) => edge.knowledge === "proven")).toBe(true);
    }
  });

  it("keeps clarification selection stable when provider local refs are renamed", () => {
    const first = assessInterpreterProposal({ evidencePack: evidencePack({ blocking: true }), proposal: proposal(undefined, undefined, true) });
    const second = assessInterpreterProposal({ evidencePack: evidencePack({ blocking: true }), proposal: proposal(true, true, true) });
    expect(first.kind).toBe("clarification");
    expect(second.kind).toBe("clarification");
    if (first.kind === "clarification" && second.kind === "clarification") {
      expect(second.clarification.hash).toBe(first.clarification.hash);
      expect(second.candidateUgsHash).toBe(first.candidateUgsHash);
    }
  });

  it("bridges the stored local proposal into the LangGraph Harness port", async () => {
    const pack = evidencePack();
    const packs = new InMemoryEvidencePackStore();
    await packs.put("owner-1", pack);
    const proposals = new InMemoryLocalProposalStore();
    const interpreter = createStoredArchitectureInterpreter({ propose: async () => proposal() }, proposals);
    const interpreted = await interpreter.interpret({ version: 1, allowedPurpose: "architecture_interpretation", facts: [], maxCharacters: 1000 }, { ownerId: "owner-1", deviceId: "device-1", runId: "run-1", revision: 0 });
    const assessment = await new ReceiptBoundStructuralHarness(packs, proposals).assess({ runId: "run-1", ownerId: "owner-1", deviceId: "device-1", revision: 0, evidencePackHash: pack.hash, proposalHash: interpreted.proposalHash });
    expect(assessment).toMatchObject({ kind: "formal", ugsHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it("rejects a stored proposal whose contents do not match the supplied hash", async () => {
    const pack = evidencePack();
    const packs = new InMemoryEvidencePackStore();
    await packs.put("owner-1", pack);
    const proposals = new InMemoryLocalProposalStore();
    const interpreted = await createStoredArchitectureInterpreter({ propose: async () => proposal() }, proposals).interpret({ version: 1, allowedPurpose: "architecture_interpretation", facts: [], maxCharacters: 1000 }, { ownerId: "owner-1", deviceId: "device-1", runId: "run-1", revision: 0 });
    const corruptStore = { put: async () => {}, get: async () => proposal(true) };
    const assessment = await new ReceiptBoundStructuralHarness(packs, corruptStore).assess({ runId: "run-1", ownerId: "owner-1", deviceId: "device-1", revision: 0, evidencePackHash: pack.hash, proposalHash: interpreted.proposalHash });
    expect(assessment).toEqual({ kind: "rejected", errorCategory: "provider_invalid" });
  });

  it("preserves verified branch, merge, and Add semantics in the deterministic local lane", () => {
    const pack = topologyEvidencePack("merge", "Add");
    const proposal = createDeterministicLocalProposal(pack);
    expect(proposal).not.toBeNull();
    const result = assessInterpreterProposal({ evidencePack: pack, proposal });
    expect(result.kind).toBe("formal");
    if (result.kind !== "formal") return;
    expect(result.ugs.nodes.find((node) => node.label === "Add")?.semanticHints).toContain("operation:add");
    expect(result.ugs.edges.filter((edge) => edge.relation === "merge")).toHaveLength(2);
    expect(result.ugs.edges.filter((edge) => edge.relation === "data")).toHaveLength(3);
  });

  it("preserves verified Concat semantics without trusting provider display text", () => {
    const pack = topologyEvidencePack("merge", "Concat");
    const proposal = createDeterministicLocalProposal(pack)!;
    const altered = { ...proposal, nodes: proposal.nodes.map((node) => ({ ...node, displayLabel: "Alternate label" })) };
    const result = assessInterpreterProposal({ evidencePack: pack, proposal: altered });
    expect(result.kind).toBe("formal");
    if (result.kind !== "formal") return;
    expect(result.ugs.nodes.find((node) => node.label === "Concat")?.semanticHints).toContain("operation:concat");
    expect(JSON.stringify(result.ugs)).not.toContain("provider-forged");
  });

  it("clarifies a multi-input node whose merge relation is not proven", () => {
    const pack = topologyEvidencePack("data", "Add");
    const proposal = createDeterministicLocalProposal(pack);
    const result = assessInterpreterProposal({ evidencePack: pack, proposal });
    expect(result.kind).toBe("clarification");
    if (result.kind !== "clarification") return;
    expect(result.clarification.code).toBe("ambiguous_structure");
    expect(result.candidateUgs.edges.every((edge) => edge.knowledge === "candidate")).toBe(true);
  });

  it("rejects disconnected topology and invalid merge arity", () => {
    const disconnected = topologyEvidencePack("merge", "Add", true);
    const disconnectedResult = assessInterpreterProposal({ evidencePack: disconnected, proposal: createDeterministicLocalProposal(disconnected) });
    expect(disconnectedResult).toMatchObject({ kind: "rejected", errorCategory: "validation", reasonCode: "unreachable_node" });

    const invalidMergePack = topologyEvidencePack("merge", "Add");
    const completeProposal = createDeterministicLocalProposal(invalidMergePack)!;
    const invalidMergeProposal = {
      ...completeProposal,
      nodes: completeProposal.nodes.filter((node) => !node.localRef.startsWith("right")),
      ports: completeProposal.ports.filter((port) => !port.localRef.startsWith("right")),
      edges: completeProposal.edges.filter((edge) => !["input-right", "right-merge"].includes(edge.localRef)),
    };
    const invalidMergeResult = assessInterpreterProposal({ evidencePack: invalidMergePack, proposal: invalidMergeProposal });
    expect(invalidMergeResult).toMatchObject({ kind: "rejected", errorCategory: "validation", reasonCode: "merge_arity" });
  });
});

function topologyEvidencePack(mergeRelation: "data" | "merge", operation: "Add" | "Concat", disconnected = false, singleMergeEdge = false): EvidencePack {
  const sourceHash = "c".repeat(64);
  const summaries = [
    "node input input Input",
    "node left operator Left branch",
    "node right operator Right branch",
    `node merge operator ${operation}`,
    "node output output Output",
    ...(disconnected ? ["node orphan operator Orphan"] : []),
    "port input:out output node input",
    "port left:in input node left",
    "port left:out output node left",
    "port right:in input node right",
    "port right:out output node right",
    "port merge:left input node merge",
    ...(singleMergeEdge ? [] : ["port merge:right input node merge"]),
    "port merge:out output node merge",
    "port output:in input node output",
    ...(disconnected ? ["port orphan:in input node orphan", "port orphan:out output node orphan"] : []),
    "edge input-left input:out to left:in data",
    "edge input-right input:out to right:in data",
    `edge left-merge left:out to merge:left ${mergeRelation}`,
    ...(singleMergeEdge ? [] : [`edge right-merge right:out to merge:right ${mergeRelation}`]),
    "edge merge-output merge:out to output:in data",
    ...(disconnected ? ["edge orphan-self orphan:out to orphan:in feedback"] : []),
  ];
  return createEvidencePack({ facts: summaries.map((summary, index) => ({
    sourceKind: "typed_declaration" as const,
    sourceHash,
    locatorKind: "section" as const,
    locatorOrdinal: index + 1,
    excerptDigest: (index + 1).toString(16).padStart(64, "0"),
    summary,
    confidence: 1,
    semanticKey: `topology:${index + 1}`,
  })) });
}
