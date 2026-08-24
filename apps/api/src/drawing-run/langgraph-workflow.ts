import { createHash } from "node:crypto";
import { Annotation, END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import type { ProviderContextPayload } from "../drawing-input/provider-context.js";

export type { ProviderContextPayload } from "../drawing-input/provider-context.js";

export type DrawingWorkflowPhase =
  | "received"
  | "awaiting_input"
  | "analyzing"
  | "awaiting_interpreter"
  | "assessing"
  | "awaiting_clarification"
  | "composing"
  | "preview_ready"
  | "rejected";

export type StructuralAssessment =
  | { kind: "formal"; ugsHash: string; candidateHash: string }
  | { kind: "clarification"; candidateHash: string; clarificationHash: string }
  | { kind: "rejected"; errorCategory: "validation" | "provider_unavailable" | "provider_timeout" | "provider_invalid" };

export type DrawingWorkflowState = {
  runId: string;
  ownerId: string;
  deviceId: string;
  revision: number;
  phase: DrawingWorkflowPhase;
  artifactHashes: string[];
  evidencePackHash: string | null;
  needsInterpreter: boolean;
  proposalHash: string | null;
  assessment: StructuralAssessment | null;
  pvpHash: string | null;
  qaHash: string | null;
  pauseReason: "input_required" | "clarification_required" | null;
  clarificationAnswerHash?: string | null;
};

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  ownerId: Annotation<string>,
  deviceId: Annotation<string>,
  revision: Annotation<number>,
  phase: Annotation<DrawingWorkflowPhase>,
  artifactHashes: Annotation<string[]>({ reducer: (_previous, next) => [...next], default: () => [] }),
  evidencePackHash: Annotation<string | null>,
  needsInterpreter: Annotation<boolean>,
  proposalHash: Annotation<string | null>,
  assessment: Annotation<StructuralAssessment | null>,
  pvpHash: Annotation<string | null>,
  qaHash: Annotation<string | null>,
  pauseReason: Annotation<"input_required" | "clarification_required" | null>,
  clarificationAnswerHash: Annotation<string | null>,
});

type LangGraphDrawingWorkflowState = typeof WorkflowState.State;
export type DrawingWorkflowCheckpoint = Omit<Pick<LangGraphDrawingWorkflowState, keyof DrawingWorkflowState>, "clarificationAnswerHash"> & { clarificationAnswerHash?: string | null };

export interface DrawingWorkflowAnalyzer {
  analyze(input: {
    runId: string;
    ownerId: string;
    deviceId: string;
    revision: number;
    artifactHashes: readonly string[];
  }): Promise<{ evidencePackHash: string; needsInterpreter: boolean }>;
}

export interface DrawingWorkflowInterpreter {
  interpret(input: ProviderContextPayload, scope?: { ownerId: string; deviceId: string; runId: string; revision: number }): Promise<{ proposalHash: string }>;
}

export interface DrawingWorkflowHarness {
  assess(input: {
    runId: string;
    ownerId: string;
    deviceId: string;
    revision: number;
    evidencePackHash: string;
    proposalHash: string | null;
    clarificationAnswerHash?: string | null;
  }): Promise<StructuralAssessment>;
}

export interface DrawingWorkflowComposer {
  compose(input: { runId: string; ownerId: string; deviceId: string; revision: number; ugsHash: string }): Promise<{ pvpHash: string; qaHash: string }>;
}

export interface DrawingWorkflowOptions {
  analyzer: DrawingWorkflowAnalyzer;
  interpreter?: DrawingWorkflowInterpreter;
  providerContext?: (input: { runId: string; ownerId: string; deviceId: string; revision: number; evidencePackHash: string }) => Promise<ProviderContextPayload>;
  harness: DrawingWorkflowHarness;
  composer: DrawingWorkflowComposer;
  checkpointer: BaseCheckpointSaver;
}

export type DrawingWorkflowInput = Pick<DrawingWorkflowState, "runId" | "ownerId" | "deviceId" | "revision" | "artifactHashes"> & { clarificationAnswerHash?: string | null };

export type DrawingWorkflowResult = DrawingWorkflowCheckpoint;

export interface DrawingWorkflowCheckpointIdentity {
  ownerId: string;
  deviceId: string;
  runId: string;
  revision: number;
}

const phaseAfterAssessment = (assessment: StructuralAssessment): DrawingWorkflowPhase => {
  if (assessment.kind === "formal") return "composing";
  if (assessment.kind === "clarification") return "awaiting_clarification";
  return "rejected";
};

export function deriveDrawingWorkflowThreadId(input: Pick<DrawingWorkflowState, "ownerId" | "deviceId" | "runId" | "revision">): string {
  const scope = `${input.ownerId}\u0000${input.deviceId}\u0000${input.runId}\u0000${input.revision}`;
  return `drawing-run:${createHash("sha256").update(scope).digest("hex")}`;
}

function assertSafeHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${field} must be a sha256 hex digest`);
}

function assertProviderContextPayload(value: ProviderContextPayload): void {
  if (!value || value.version !== 1 || value.allowedPurpose !== "architecture_interpretation" || !Array.isArray(value.facts) || !Number.isSafeInteger(value.maxCharacters) || value.maxCharacters < 1 || value.maxCharacters > 100_000) {
    throw new Error("ProviderContextPayload is invalid");
  }
  if (Object.keys(value as object).some((key) => !["version", "allowedPurpose", "facts", "maxCharacters"].includes(key))) {
    throw new Error("ProviderContextPayload contains unsupported fields");
  }
  for (const fact of value.facts) {
    if (Object.keys(fact as object).some((key) => !["localFactRef", "sourceKind", "summary", "confidence"].includes(key))) {
      throw new Error("ProviderContextPayload fact contains unsupported fields");
    }
    if (!fact || !/^fact:f:[0-9]+$/.test(fact.localFactRef) || !["static_analysis", "typed_declaration", "architecture_fact", "sketch_observation"].includes(fact.sourceKind) || (fact.confidence !== null && (typeof fact.confidence !== "number" || fact.confidence < 0 || fact.confidence > 1)) || typeof fact.summary !== "string" || fact.summary.length > value.maxCharacters) {
      throw new Error("ProviderContextPayload fact is invalid");
    }
    if (/[\r\n]|(?:[A-Za-z]:[\\/])|(?:\\\\)|(?:https?:\/\/)|(?:\b(?:api[_-]?key|bearer|password|token)\b)/i.test(fact.summary)) {
      throw new Error("ProviderContextPayload fact contains unsafe text");
    }
  }
}

function assertWorkflowIdentity(state: DrawingWorkflowState): void {
  if (!state.runId || !state.ownerId || !state.deviceId) throw new Error("Drawing workflow identity is required");
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error("Drawing workflow revision is invalid");
  for (const hash of state.artifactHashes) assertSafeHash(hash, "artifact hash");
}

function assertWorkflowMatchesInput(result: DrawingWorkflowResult, input: DrawingWorkflowInput): void {
  if (result.runId !== input.runId || result.ownerId !== input.ownerId || result.deviceId !== input.deviceId || result.revision !== input.revision) {
    throw new Error("LangGraph checkpoint identity does not match the Drawing Run");
  }
}

function initialState(input: DrawingWorkflowInput): DrawingWorkflowState {
  const state: DrawingWorkflowState = {
    runId: input.runId,
    ownerId: input.ownerId,
    deviceId: input.deviceId,
    revision: input.revision,
    phase: input.artifactHashes.length === 0 ? "awaiting_input" : "received",
    artifactHashes: [...input.artifactHashes],
    evidencePackHash: null,
    needsInterpreter: false,
    proposalHash: null,
    assessment: null,
    pvpHash: null,
    qaHash: null,
    pauseReason: input.artifactHashes.length === 0 ? "input_required" : null,
    clarificationAnswerHash: input.clarificationAnswerHash ?? null,
  };
  assertWorkflowIdentity(state);
  return state;
}

export function createDrawingRunLangGraph(options: DrawingWorkflowOptions) {
  const graph = new StateGraph(WorkflowState)
    .addNode("intake", async (state) => {
      assertWorkflowIdentity(state);
      if (state.artifactHashes.length === 0) return { phase: "awaiting_input", pauseReason: "input_required" as const };
      return { phase: "analyzing", pauseReason: null };
    })
    .addNode("deterministic_analysis", async (state) => {
      assertWorkflowIdentity(state);
      const result = await options.analyzer.analyze({
        runId: state.runId,
        ownerId: state.ownerId,
        deviceId: state.deviceId,
        revision: state.revision,
        artifactHashes: state.artifactHashes,
      });
      assertSafeHash(result.evidencePackHash, "evidence pack hash");
      return {
        phase: result.needsInterpreter ? "awaiting_interpreter" as const : "assessing" as const,
        artifactHashes: [...state.artifactHashes, result.evidencePackHash],
        evidencePackHash: result.evidencePackHash,
        needsInterpreter: result.needsInterpreter,
      };
    })
    .addNode("optional_interpreter", async (state) => {
      if (!options.interpreter) return { phase: "assessing" as const };
      if (!options.providerContext) throw new Error("Interpreter requires a Coordinator-built ProviderContextPayload");
      const payload = await options.providerContext({ runId: state.runId, ownerId: state.ownerId, deviceId: state.deviceId, revision: state.revision, evidencePackHash: state.evidencePackHash! });
      assertProviderContextPayload(payload);
      const result = await options.interpreter.interpret(payload, { ownerId: state.ownerId, deviceId: state.deviceId, runId: state.runId, revision: state.revision });
      assertSafeHash(result.proposalHash, "proposal hash");
      return { phase: "assessing" as const, artifactHashes: [...state.artifactHashes, result.proposalHash], proposalHash: result.proposalHash };
    })
    .addNode("harness_assessment", async (state) => {
      const evidencePackHash = state.evidencePackHash;
      if (!evidencePackHash) throw new Error("Harness requires an EvidencePack hash");
      const assessment = await options.harness.assess({
        runId: state.runId,
        ownerId: state.ownerId,
        deviceId: state.deviceId,
        revision: state.revision,
        evidencePackHash,
        proposalHash: state.proposalHash,
        clarificationAnswerHash: state.clarificationAnswerHash,
      });
      if (assessment.kind === "formal") {
        assertSafeHash(assessment.ugsHash, "UGS hash");
        assertSafeHash(assessment.candidateHash, "candidate hash");
      }
      if (assessment.kind === "clarification") {
        assertSafeHash(assessment.candidateHash, "candidate hash");
        assertSafeHash(assessment.clarificationHash, "clarification hash");
      }
      return {
        phase: phaseAfterAssessment(assessment),
        assessment,
        pauseReason: assessment.kind === "clarification" ? "clarification_required" as const : null,
      };
    })
    .addNode("composition", async (state) => {
      if (!state.assessment || state.assessment.kind !== "formal") throw new Error("Only formal UGS may enter composition");
      const result = await options.composer.compose({
        runId: state.runId,
        ownerId: state.ownerId,
        deviceId: state.deviceId,
        revision: state.revision,
        ugsHash: state.assessment.ugsHash,
      });
      assertSafeHash(result.pvpHash, "PVP hash");
      assertSafeHash(result.qaHash, "PVP QA hash");
      return { phase: "preview_ready" as const, pvpHash: result.pvpHash, qaHash: result.qaHash, pauseReason: null };
    })
    .addEdge(START, "intake")
    .addConditionalEdges("intake", (state) => state.phase === "awaiting_input" ? END : "deterministic_analysis")
    .addConditionalEdges("deterministic_analysis", (state) => state.phase === "awaiting_interpreter" && options.interpreter ? "optional_interpreter" : "harness_assessment")
    .addEdge("optional_interpreter", "harness_assessment")
    .addConditionalEdges("harness_assessment", (state) => state.phase === "composing" ? "composition" : END)
    .addEdge("composition", END);

  return graph.compile({ checkpointer: options.checkpointer });
}

export async function runDrawingRunLangGraph(
  graph: ReturnType<typeof createDrawingRunLangGraph>,
  input: DrawingWorkflowInput,
): Promise<DrawingWorkflowResult> {
  const config = {
    durability: "sync" as const,
    configurable: {
      thread_id: deriveDrawingWorkflowThreadId(input),
      owner_id: input.ownerId,
      device_id: input.deviceId,
      run_id: input.runId,
      revision: input.revision,
    },
  };
  const saved = await graph.getState(config);
  if (saved.next.length === 0 && isCompletedWorkflowState(saved.values, input)) {
    return projectWorkflowResult(saved.values as DrawingWorkflowResult, input);
  }
  const hasPendingWork = saved.next.length > 0;
  const result = await graph.invoke(
    hasPendingWork ? null : initialState(input),
    hasPendingWork
      ? { durability: "sync", configurable: { ...config.configurable, __pregel_resuming: true } }
      : config,
  );
  return projectWorkflowResult(result as DrawingWorkflowResult, input);
}

function isCompletedWorkflowState(value: unknown, input: DrawingWorkflowInput): value is DrawingWorkflowResult {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).runId === input.runId
    && (value as Record<string, unknown>).ownerId === input.ownerId
    && (value as Record<string, unknown>).deviceId === input.deviceId
    && typeof (value as Record<string, unknown>).phase === "string");
}

function projectWorkflowResult(safe: DrawingWorkflowResult, input: DrawingWorkflowInput): DrawingWorkflowResult {
  assertWorkflowIdentity(safe);
  assertWorkflowMatchesInput(safe, input);
  return {
    runId: safe.runId,
    ownerId: safe.ownerId,
    deviceId: safe.deviceId,
    revision: safe.revision,
    phase: safe.phase,
    artifactHashes: [...safe.artifactHashes],
    evidencePackHash: safe.evidencePackHash,
    needsInterpreter: safe.needsInterpreter,
    proposalHash: safe.proposalHash,
    assessment: safe.assessment,
    pvpHash: safe.pvpHash,
    qaHash: safe.qaHash,
    pauseReason: safe.pauseReason,
    clarificationAnswerHash: safe.clarificationAnswerHash,
  };
}

export interface DrawingWorkflowRunner {
  run(input: DrawingWorkflowInput): Promise<DrawingWorkflowResult>;
}

export function createDrawingWorkflowRunner(options: DrawingWorkflowOptions): DrawingWorkflowRunner {
  const graph = createDrawingRunLangGraph(options);
  return { run: (input) => runDrawingRunLangGraph(graph, input) };
}
