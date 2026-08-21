import type { UniversalEdgeRelation } from "./universal-graph-spec.js";

export type ArchitectureInterpretationDetail = "overview" | "architecture" | "operator_detail";
export type ArchitectureInterpretationNodeKind = "input" | "output" | "operator" | "module";

/** Public, digest-only evidence available to an unfamiliar-architecture interpreter. */
export interface BoundedPublicEvidence {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly locator: string;
  readonly excerptDigest: string;
}

export interface BoundedInterpretationRequest {
  readonly requestId: string;
  readonly evidence: readonly BoundedPublicEvidence[];
  readonly detail: ArchitectureInterpretationDetail;
  readonly maxNodes: number;
  readonly maxEdges: number;
}

export interface InterpreterProposalNode {
  readonly nodeId: string;
  readonly kind: ArchitectureInterpretationNodeKind;
  readonly label: string;
  readonly operation?: string;
  readonly semanticHints?: readonly string[];
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
  readonly inputPortIds: readonly string[];
  readonly outputPortIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface InterpreterProposalPort {
  readonly portId: string;
  readonly nodeId: string;
  readonly direction: "input" | "output";
  readonly label?: string | null;
  readonly representation?: string | null;
  readonly semanticType?: string | null;
  readonly evidenceIds: readonly string[];
}

export interface InterpreterProposalEdge {
  readonly edgeId: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly relation?: Exclude<UniversalEdgeRelation, "candidate">;
  readonly evidenceIds: readonly string[];
}

export interface InterpreterProposalUnresolved {
  readonly id: string;
  readonly scope: "operation" | "shape" | "topology";
  readonly severity: "blocking" | "warning";
  readonly evidenceIds: readonly string[];
}

/** The only proposal shape accepted from an architecture interpreter. */
export interface InterpreterProposal {
  readonly version: 1;
  readonly nodes: readonly InterpreterProposalNode[];
  readonly ports: readonly InterpreterProposalPort[];
  readonly edges: readonly InterpreterProposalEdge[];
  readonly unresolved: readonly InterpreterProposalUnresolved[];
}

export interface ArchitectureInterpreter {
  propose(input: BoundedInterpretationRequest): Promise<InterpreterProposal>;
}
