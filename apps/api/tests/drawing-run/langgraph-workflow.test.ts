import { describe, expect, it, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import {
  createDrawingRunLangGraph,
  runDrawingRunLangGraph,
  type DrawingWorkflowAnalyzer,
  type DrawingWorkflowComposer,
  type DrawingWorkflowHarness,
  type DrawingWorkflowInterpreter,
} from "../../src/drawing-run/langgraph-workflow.js";

const hash = (seed: string) => seed.repeat(64).slice(0, 64);

function services(overrides: Partial<{
  analyzer: DrawingWorkflowAnalyzer;
  interpreter: DrawingWorkflowInterpreter;
  harness: DrawingWorkflowHarness;
  composer: DrawingWorkflowComposer;
}> = {}) {
  return {
    analyzer: overrides.analyzer ?? {
      analyze: vi.fn(async () => ({ evidencePackHash: hash("a"), needsInterpreter: true })),
    },
    interpreter: overrides.interpreter ?? {
      interpret: vi.fn(async (payload) => {
        expect(payload).not.toHaveProperty("runId");
        expect(payload).not.toHaveProperty("ownerId");
        expect(payload).not.toHaveProperty("deviceId");
        return { proposalHash: hash("b") };
      }),
    },
    harness: overrides.harness ?? {
      assess: vi.fn(async () => ({ kind: "formal" as const, ugsHash: hash("c"), candidateHash: hash("f") })),
    },
    composer: overrides.composer ?? {
      compose: vi.fn(async () => ({ pvpHash: hash("d"), qaHash: hash("e") })),
    },
  };
}

const input = { runId: "run-1", ownerId: "owner-1", deviceId: "device-1", revision: 0, artifactHashes: [hash("0")] };

describe("LangGraph Drawing Run workflow", () => {
  it("orchestrates analyzer, interpreter, Harness, and composer for a formal result", async () => {
    const deps = services();
    const result = await runDrawingRunLangGraph(createDrawingRunLangGraph({ ...deps, checkpointer: new MemorySaver(), providerContext: async () => ({ version: 1, allowedPurpose: "architecture_interpretation", facts: [], maxCharacters: 1000 }) }), input);

    expect(result.phase).toBe("preview_ready");
    expect(result.assessment).toEqual({ kind: "formal", ugsHash: hash("c"), candidateHash: hash("f") });
    expect(result.pvpHash).toBe(hash("d"));
    expect(deps.harness.assess).toHaveBeenCalledWith(expect.objectContaining({ evidencePackHash: hash("a"), proposalHash: hash("b") }));
  });

  it("pauses at clarification and never calls composition", async () => {
    const deps = services({
      harness: { assess: vi.fn(async () => ({ kind: "clarification" as const, candidateHash: hash("c"), clarificationHash: hash("e") })) },
    });
    const result = await runDrawingRunLangGraph(createDrawingRunLangGraph({ ...deps, checkpointer: new MemorySaver(), providerContext: async () => ({ version: 1, allowedPurpose: "architecture_interpretation", facts: [], maxCharacters: 1000 }) }), input);

    expect(result.phase).toBe("awaiting_clarification");
    expect(result.pauseReason).toBe("clarification_required");
    expect(deps.composer.compose).not.toHaveBeenCalled();
  });

  it("rejects without composition when the Harness rejects", async () => {
    const deps = services({
      harness: { assess: vi.fn(async () => ({ kind: "rejected" as const, errorCategory: "provider_invalid" as const })) },
    });
    const result = await runDrawingRunLangGraph(createDrawingRunLangGraph({ ...deps, checkpointer: new MemorySaver(), providerContext: async () => ({ version: 1, allowedPurpose: "architecture_interpretation", facts: [], maxCharacters: 1000 }) }), input);

    expect(result.phase).toBe("rejected");
    expect(result.assessment).toEqual({ kind: "rejected", errorCategory: "provider_invalid" });
    expect(deps.composer.compose).not.toHaveBeenCalled();
  });

  it("pauses before analysis when no private receipt artifact is accepted", async () => {
    const deps = services();
    const result = await runDrawingRunLangGraph(createDrawingRunLangGraph({ ...deps, checkpointer: new MemorySaver() }), { ...input, artifactHashes: [] });

    expect(result.phase).toBe("awaiting_input");
    expect(result.pauseReason).toBe("input_required");
    expect(deps.analyzer.analyze).not.toHaveBeenCalled();
  });

  it("does not expose arbitrary state fields through the returned checkpoint", async () => {
    const graph = createDrawingRunLangGraph({ ...services(), checkpointer: new MemorySaver(), providerContext: async () => ({ version: 1, allowedPurpose: "architecture_interpretation", facts: [], maxCharacters: 1000 }) });
    const result = await runDrawingRunLangGraph(graph, input);

    expect(result).not.toHaveProperty("rawSource");
    expect(result).not.toHaveProperty("providerPayload");
    expect(result).not.toHaveProperty("pageTarget");
    expect(result).not.toHaveProperty("comCommand");
  });

  it("rejects unsafe Provider context before the interpreter is called", async () => {
    const deps = services();
    const interpreter = deps.interpreter.interpret as ReturnType<typeof vi.fn>;
    await expect(runDrawingRunLangGraph(createDrawingRunLangGraph({
      ...deps,
      checkpointer: new MemorySaver(),
      providerContext: async () => ({
        version: 1,
        allowedPurpose: "architecture_interpretation" as const,
        facts: [{ localFactRef: "fact:f:1" as const, sourceKind: "architecture_fact" as const, summary: "C:\\private\\model.py", confidence: 1 }],
        maxCharacters: 1000,
      }),
    }), input)).rejects.toThrow(/unsafe/i);
    expect(interpreter).not.toHaveBeenCalled();
  });

  it("resumes after a node failure from the durable graph checkpoint", async () => {
    const checkpointer = new MemorySaver();
    const evidencePackHash = hash("a");
    const analyzer = vi.fn(async () => ({ evidencePackHash, needsInterpreter: false }));
    const harness = vi.fn()
      .mockRejectedValueOnce(new Error("transient harness failure"))
      .mockResolvedValueOnce({ kind: "rejected" as const, errorCategory: "validation" as const });
    const firstGraph = createDrawingRunLangGraph({
      analyzer: { analyze: analyzer },
      harness: { assess: harness },
      composer: { compose: vi.fn(async () => ({ pvpHash: hash("d"), qaHash: hash("e") })) },
      checkpointer,
    });

    await expect(runDrawingRunLangGraph(firstGraph, input)).rejects.toThrow(/transient harness failure/);

    const secondGraph = createDrawingRunLangGraph({
      analyzer: { analyze: analyzer },
      harness: { assess: harness },
      composer: { compose: vi.fn(async () => ({ pvpHash: hash("d"), qaHash: hash("e") })) },
      checkpointer,
    });
    const resumed = await runDrawingRunLangGraph(secondGraph, input);

    expect(resumed.phase).toBe("rejected");
    expect(analyzer).toHaveBeenCalledTimes(1);
    expect(harness).toHaveBeenCalledTimes(2);
  });

  it("reuses a completed checkpoint when the Coordinator had not applied it yet", async () => {
    const checkpointer = new MemorySaver();
    const analyzer = vi.fn(async () => ({ evidencePackHash: hash("a"), needsInterpreter: false }));
    const harness = vi.fn(async () => ({ kind: "rejected" as const, errorCategory: "validation" as const }));
    const services = {
      analyzer: { analyze: analyzer },
      harness: { assess: harness },
      composer: { compose: vi.fn(async () => ({ pvpHash: hash("d"), qaHash: hash("e") })) },
      checkpointer,
    };
    const first = createDrawingRunLangGraph(services);
    await expect(runDrawingRunLangGraph(first, input)).resolves.toMatchObject({ phase: "rejected" });

    const second = createDrawingRunLangGraph(services);
    await expect(runDrawingRunLangGraph(second, input)).resolves.toMatchObject({ phase: "rejected" });
    expect(analyzer).toHaveBeenCalledTimes(1);
    expect(harness).toHaveBeenCalledTimes(1);
  });
});
