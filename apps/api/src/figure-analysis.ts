import type { EvidenceGraph, EvidenceLocator, PublicEvidenceGraphSummary } from "./evidence-graph.js";
import type { ArchitectureIRv3 } from "./network-ir-v3.js";
import type { SourcePack } from "./source-pack.js";
import type { StaticPyTorchUnresolved } from "./static-pytorch-source-analyzer.js";

export type FigureAnalysisStatus = "needs_confirmation" | "candidate_structure" | "ready_for_preview" | "failed";

export interface FigureAnalysisBlockingQuestion {
  code: string;
  message: string;
  locator: EvidenceLocator;
}

export interface FigureAnalysisSourceRef {
  sourceRecordId: string;
  retentionClass: "analysis_source";
  sourceSha256: string;
  bytes: number;
}

export interface FigureAnalysisRecord {
  id: string;
  userId: string;
  sourceId: string;
  sourceName: string;
  sourceMimeType: SourcePack["mimeType"];
  sourceBytes: number;
  sourceSha256: string;
  kind: "pytorch-source";
  status: FigureAnalysisStatus;
  architectureIR: ArchitectureIRv3 | null;
  unresolved: StaticPyTorchUnresolved[];
  blockingQuestion: FigureAnalysisBlockingQuestion | null;
  evidenceGraph: EvidenceGraph;
  evidenceSummary: PublicEvidenceGraphSummary;
  sourceRef: FigureAnalysisSourceRef;
  warnings: string[];
  capabilityVersion: "pytorch-static-linear-v0";
  createdAt: string;
  updatedAt: string;
}

export type FigureAnalysisCreationResult = {
  record: FigureAnalysisRecord;
  duplicate: boolean;
  requestHashMatches: boolean;
};

export interface PublicFigureAnalysis {
  id: string;
  kind: "pytorch-source";
  status: FigureAnalysisStatus;
  source: {
    sourceId: string;
    name: string;
    mimeType: SourcePack["mimeType"];
    sourceSha256: string;
    bytes: number;
  };
  architectureIR: ArchitectureIRv3 | null;
  evidence: PublicEvidenceGraphSummary;
  blockingQuestion: FigureAnalysisBlockingQuestion | null;
  warnings: string[];
  capabilityVersion: "pytorch-static-linear-v0";
  createdAt: string;
  updatedAt: string;
}

export function publicFigureAnalysis(record: FigureAnalysisRecord): PublicFigureAnalysis {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    source: {
      sourceId: record.sourceId,
      name: record.sourceName,
      mimeType: record.sourceMimeType,
      sourceSha256: record.sourceSha256,
      bytes: record.sourceBytes,
    },
    architectureIR: structuredClone(record.architectureIR),
    evidence: structuredClone(record.evidenceSummary),
    blockingQuestion: record.status === "candidate_structure" ? structuredClone(record.blockingQuestion) : null,
    warnings: [...record.warnings],
    capabilityVersion: record.capabilityVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
