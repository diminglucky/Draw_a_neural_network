import { randomUUID } from "node:crypto";
import { publicEvidenceGraphSummary, type EvidenceLocator } from "./evidence-graph.js";
import type { FigureAnalysisRecord } from "./figure-analysis.js";
import { compileStaticPyTorchToArchitectureIR } from "./static-pytorch-ir-compiler.js";
import { analyzeStaticPyTorchSource, type StaticPyTorchAnalysis, type StaticPyTorchUnresolved } from "./static-pytorch-source-analyzer.js";
import type { SourcePack } from "./source-pack.js";
import type { FoundationStore } from "./store.js";

export interface FigureAnalysisServiceInput {
  userId: string;
  source: SourcePack;
  idempotencyKey: string;
  requestHash: string;
}

export class FigureAnalysisService {
  constructor(private readonly options: { store: FoundationStore }) {}

  async analyze(input: FigureAnalysisServiceInput): Promise<{ record: FigureAnalysisRecord; duplicate: boolean }> {
    const analysis = analyzeStaticPyTorchSource({
      sourceId: input.source.sourceId,
      sourceSha256: input.source.sourceSha256,
      code: input.source.code,
    });
    const candidateIR = compileStaticPyTorchToArchitectureIR(analysis);
    const blockingQuestions = candidateIR.unresolved.filter((question) => question.severity === "blocking");
    const architectureIR = blockingQuestions.length > 0
      ? candidateIR
      : compileStaticPyTorchToArchitectureIR(analysis, { renderReady: true });
    const unresolved = mergeUnresolved(analysis, candidateIR.unresolved, input.source.sourceId, input.source.sourceSha256);
    const blocking = selectBlockingQuestion(blockingQuestions, analysis, unresolved);
    const now = new Date().toISOString();
    const record: FigureAnalysisRecord = {
      id: randomUUID(),
      userId: input.userId,
      sourceId: input.source.sourceId,
      sourceName: input.source.name,
      sourceMimeType: input.source.mimeType,
      sourceBytes: input.source.bytes,
      sourceSha256: input.source.sourceSha256,
      kind: "pytorch-source",
      status: blocking ? "candidate_structure" : "ready_for_preview",
      architectureIR,
      unresolved,
      blockingQuestion: blocking,
      evidenceGraph: analysis.evidence,
      evidenceSummary: publicEvidenceGraphSummary(analysis.evidence),
      sourceRef: {
        sourceRecordId: `source-record-${randomUUID()}`,
        retentionClass: "analysis_source",
        sourceSha256: input.source.sourceSha256,
        bytes: input.source.bytes,
      },
      warnings: [],
      capabilityVersion: "pytorch-static-linear-v0",
      createdAt: now,
      updatedAt: now,
    };
    const persisted = await this.options.store.createFigureAnalysisIdempotent({
      record,
      sourceCode: input.source.code,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
    });
    if (!persisted.requestHashMatches) throw new Error("Figure analysis idempotency key was reused with a different request");
    return { record: persisted.record, duplicate: persisted.duplicate };
  }
}

function mergeUnresolved(
  analysis: StaticPyTorchAnalysis,
  questions: Array<{ conflictKey: string; severity: "blocking" | "warning"; candidateValues: string[]; evidenceFactIds: string[]; dependencyQuestionIds: string[] }>,
  sourceId: string,
  sourceSha256: string,
): StaticPyTorchUnresolved[] {
  const existing = [...analysis.unresolved];
  for (const question of questions) {
    if (existing.some((item) => item.code === question.conflictKey)) continue;
    existing.push({
      code: question.conflictKey,
      severity: question.severity,
      locator: firstLocator(analysis),
      evidenceRefs: [],
      message: questionMessage(question.conflictKey),
    });
  }
  return existing.map((item) => ({
    ...item,
    evidenceRefs: item.evidenceRefs.map((reference) => ({ ...reference, sourceId, sourceSha256 })),
  }));
}

function selectBlockingQuestion(
  questions: Array<{ conflictKey: string; severity: "blocking" | "warning" }>,
  analysis: StaticPyTorchAnalysis,
  unresolved: StaticPyTorchUnresolved[],
): FigureAnalysisRecord["blockingQuestion"] {
  const ordered = [...questions].sort((left, right) => {
    const leftItem = unresolved.find((item) => item.code === left.conflictKey);
    const rightItem = unresolved.find((item) => item.code === right.conflictKey);
    return compareLocator(leftItem?.locator, rightItem?.locator) || left.conflictKey.localeCompare(right.conflictKey);
  });
  const selected = ordered[0];
  if (!selected) return null;
  const item = unresolved.find((candidate) => candidate.code === selected.conflictKey);
  return {
    code: selected.conflictKey,
    message: item?.message ?? questionMessage(selected.conflictKey),
    locator: item?.locator ?? firstLocator(analysis),
  };
}

function compareLocator(left: EvidenceLocator | undefined, right: EvidenceLocator | undefined): number {
  const leftKey = left?.kind === "code" ? [left.startLine, left.startColumn] : [0, 0];
  const rightKey = right?.kind === "code" ? [right.startLine, right.startColumn] : [0, 0];
  return leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1];
}

function firstLocator(analysis: StaticPyTorchAnalysis): EvidenceLocator {
  return analysis.unresolved[0]?.locator ?? analysis.calls[0]?.locator ?? analysis.modules[0]?.locator ?? {
    kind: "code", startLine: 1, startColumn: 1, endLine: 1, endColumn: 1,
  };
}

function questionMessage(code: string): string {
  if (code === "module-reuse") return "A module is called more than once; confirm whether it is reused or expanded.";
  if (code === "unsupported-forward") return "No supported static forward call was identified; confirm the forward path.";
  return `Static analysis requires clarification for ${code}.`;
}
