import { ApiErrorCode, FoundationError } from "./domain.js";
import type { FigureAnalysisBlockingQuestion, FigureAnalysisRecord } from "./figure-analysis.js";
import {
  buildComposableDagPublicationPlan,
  type ComposableDagPublicationBuildResult,
  type ComposableDagPublicationPlan,
  type ComposableDagVisualSpec,
} from "./composable-dag-publication-plan.js";
import type { ComposableFigureComponent, ComposableFigureConnection, FigureBounds } from "./composable-dag-figure-compiler.js";
import { runComposableDagVisualQa } from "./composable-dag-visual-qa.js";
import type { FigureComponentPort } from "./figure-components.js";
import { defaultFigureIntent, type FigureIntent } from "./figure-intent.js";
import { validateArchitectureIRv3 } from "./network-ir-v3.js";
import { PublicationVisualPreviewService, type PublicationVisualPreview } from "./publication-visual-preview-service.js";
import { projectPublicationVisualPlanPreview, type PublicationVisualPlanPreview } from "./publication-visual-plan-preview.js";
import type { VisualQaResult } from "./plan-snapshot.js";
import type { FoundationStore } from "./store.js";
import { projectArchitectureIrV3ToUniversalGraphSpec } from "./universal-graph-spec-adapter.js";

export interface PublicComposableDagPublicationPlan {
  version: 1;
  graphId: string;
  compilerVersion: string;
  layoutVersion: string;
  intent: FigureIntent;
  pageBounds: FigureBounds;
  components: Array<Omit<ComposableFigureComponent, "evidenceIds">>;
  connections: Array<Omit<ComposableFigureConnection, "evidenceIds">>;
  visualSpec: ComposableDagVisualSpec;
  qaVersion: string;
}

export interface FigureAnalysisPreviewServiceOptions {
  store: Pick<FoundationStore, "getFigureAnalysis">;
  compilePublicationPlan?: (input: Parameters<typeof buildComposableDagPublicationPlan>[0]) => ComposableDagPublicationBuildResult;
  runVisualQa?: typeof runComposableDagVisualQa;
  compilePublicationPreview?: (input: Parameters<PublicationVisualPreviewService["preview"]>[0]) => PublicationVisualPreview;
}

export type FigureAnalysisPreviewOptions = { version?: 3 | 4; deviceId?: string };

export type FigureAnalysisPreviewResponse =
  | {
      version: 3;
      kind: "candidate_structure";
      analysis: { id: string; status: "candidate_structure"; capabilityVersion: string };
      watermark: "STRUCTURE_PENDING_CONFIRMATION";
      blockingQuestion: FigureAnalysisBlockingQuestion;
      confirmedNodeIds: string[];
    }
  | {
      version: 4;
      kind: "candidate_structure";
      analysis: { id: string; status: "candidate_structure"; capabilityVersion: string };
      watermark: "STRUCTURE_PENDING_CONFIRMATION";
      blockingQuestion: FigureAnalysisBlockingQuestion;
      confirmedNodeIds: string[];
    }
  | {
      version: 3;
      kind: "publication_plan";
      analysis: { id: string; status: "ready_for_preview"; capabilityVersion: string };
      publicationPlan: PublicComposableDagPublicationPlan;
      visualQa: VisualQaResult;
    }
  | {
      version: 4;
      kind: "publication_visual_preview";
      analysis: { id: string; status: "ready_for_preview"; capabilityVersion: string };
      publicationPreview: PublicationVisualPlanPreview;
    };

export class FigureAnalysisPreviewServiceImpl {
  private readonly compilePublicationPlan: NonNullable<FigureAnalysisPreviewServiceOptions["compilePublicationPlan"]>;
  private readonly runVisualQa: NonNullable<FigureAnalysisPreviewServiceOptions["runVisualQa"]>;
  private readonly compilePublicationPreview: NonNullable<FigureAnalysisPreviewServiceOptions["compilePublicationPreview"]>;

  constructor(private readonly options: FigureAnalysisPreviewServiceOptions) {
    this.compilePublicationPlan = options.compilePublicationPlan ?? buildComposableDagPublicationPlan;
    this.runVisualQa = options.runVisualQa ?? runComposableDagVisualQa;
    this.compilePublicationPreview = options.compilePublicationPreview ?? ((input) => new PublicationVisualPreviewService().preview(input));
  }

  async preview(userId: string, analysisId: string, options: FigureAnalysisPreviewOptions = {}): Promise<FigureAnalysisPreviewResponse> {
    const version = options.version ?? 3;
    const record = await this.options.store.getFigureAnalysis(userId, analysisId);
    if (!record) throw notFoundPreviewError();
    if (record.status === "candidate_structure") return candidatePreview(record, version);
    if (record.status !== "ready_for_preview" || !record.architectureIR || !safeIdentifier(record.id)) {
      throw invalidPreviewError();
    }

    const validated = validateArchitectureIRv3(record.architectureIR, undefined, { renderReady: true });
    if (!validated.valid || !validated.ir) throw invalidPreviewError();

    if (version === 3) {
      const compiled = this.compilePublicationPlan({
        architectureIr: validated.ir,
        intent: defaultFigureIntent(),
        layoutSeed: `m2-4-${record.id}`,
      });
      if (compiled.status !== "ready") throw invalidPreviewError();

      const visualQa = this.runVisualQa(compiled.publicationPlan);
      if (visualQa.status !== "pass") throw invalidPreviewError();

      return {
        version: 3,
        kind: "publication_plan",
        analysis: {
          id: record.id,
          status: "ready_for_preview",
          capabilityVersion: record.capabilityVersion,
        },
        publicationPlan: projectPublicComposableDagPublicationPlan(compiled.publicationPlan),
        visualQa: structuredClone(visualQa),
      };
    }

    if (version !== 4 || !options.deviceId || !safeIdentifier(options.deviceId)) throw invalidPreviewError();
    const ugs = projectArchitectureIrV3ToUniversalGraphSpec(validated.ir);
    const compiled = this.compilePublicationPreview({
      ugs: { ...ugs, graphId: `analysis:${record.id}` },
      detail: "architecture",
      updateIdentity: {
        ownerId: userId,
        deviceId: options.deviceId,
        workflowId: `figure-analysis:${record.id}`,
        documentId: `analysis:${record.id}`,
        pageId: "pvp-preview",
        expectedRevision: 1,
      },
    });

    return {
      version: 4,
      kind: "publication_visual_preview",
      analysis: {
        id: record.id,
        status: "ready_for_preview",
        capabilityVersion: record.capabilityVersion,
      },
      publicationPreview: projectPublicationVisualPlanPreview(compiled),
    };
  }
}

function candidatePreview(record: FigureAnalysisRecord, version: 3 | 4): FigureAnalysisPreviewResponse {
  if (!record.blockingQuestion) throw invalidPreviewError();
  return {
    version,
    kind: "candidate_structure",
    analysis: {
      id: record.id,
      status: "candidate_structure",
      capabilityVersion: record.capabilityVersion,
    },
    watermark: "STRUCTURE_PENDING_CONFIRMATION",
    blockingQuestion: structuredClone(record.blockingQuestion),
    confirmedNodeIds: record.architectureIR?.nodes.filter((node) => node.evidenceIds.length > 0).map((node) => node.id) ?? [],
  };
}

export function projectPublicComposableDagPublicationPlan(plan: ComposableDagPublicationPlan): PublicComposableDagPublicationPlan {
  return {
    version: 1,
    graphId: plan.dagPlan.graphId,
    compilerVersion: plan.dagPlan.compilerVersion,
    layoutVersion: plan.dagPlan.layoutVersion,
    intent: projectFigureIntent(plan.dagPlan.intent),
    pageBounds: projectBounds(plan.dagPlan.pageBounds),
    components: plan.dagPlan.components.map((component) => ({
      id: component.id,
      kind: component.kind,
      semanticRole: component.semanticRole,
      parentModuleId: component.parentModuleId,
      bounds: projectBounds(component.bounds),
      inputPorts: component.inputPorts.map(projectFigurePort),
      outputPorts: component.outputPorts.map(projectFigurePort),
      repeat: component.repeat ? projectRepeat(component.repeat) : undefined,
    })),
    connections: plan.dagPlan.connections.map((connection) => ({
      id: connection.id,
      source: { nodeId: connection.source.nodeId, portId: connection.source.portId },
      target: { nodeId: connection.target.nodeId, portId: connection.target.portId },
      transport: connection.transport,
      route: connection.route.map((point) => ({ x: point.x, y: point.y })),
    })),
    visualSpec: {
      page: {
        background: plan.visualSpec.page.background,
        minMargin: plan.visualSpec.page.minMargin,
        minFontSizePt: plan.visualSpec.page.minFontSizePt,
        minContrastRatio: plan.visualSpec.page.minContrastRatio,
      },
      componentStyles: {
        terminal: projectComponentStyle(plan.visualSpec.componentStyles.terminal),
        operator: projectComponentStyle(plan.visualSpec.componentStyles.operator),
        merge: projectComponentStyle(plan.visualSpec.componentStyles.merge),
        attention: projectComponentStyle(plan.visualSpec.componentStyles.attention),
        repeat: projectComponentStyle(plan.visualSpec.componentStyles.repeat),
      },
      connectionStyles: {
        data: projectConnectionStyle(plan.visualSpec.connectionStyles.data),
        condition: projectConnectionStyle(plan.visualSpec.connectionStyles.condition),
      },
      labels: plan.visualSpec.labels.map((label) => ({
        id: label.id,
        semanticId: label.semanticId,
        text: label.text,
        bounds: projectBounds(label.bounds),
        fontSizePt: label.fontSizePt,
      })),
    },
    qaVersion: plan.qaVersion,
  };
}

type FigureShape = NonNullable<FigureComponentPort["shape"]>;
type FigureShapeExpression = FigureShape["dimensions"][number];

function projectFigureIntent(intent: FigureIntent): FigureIntent {
  return {
    version: 1,
    purpose: intent.purpose,
    density: intent.density,
    orientation: intent.orientation,
    printMode: intent.printMode,
    emphasis: intent.emphasis.map((value) => value),
    target: intent.target,
    stylePreset: intent.stylePreset,
  };
}

function projectBounds(bounds: FigureBounds): FigureBounds {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function projectFigurePort(port: FigureComponentPort): FigureComponentPort {
  return {
    id: port.id,
    direction: port.direction,
    representation: port.representation,
    semanticType: port.semanticType,
    ...(port.shape ? { shape: projectFigureShape(port.shape) } : {}),
  };
}

function projectFigureShape(shape: FigureShape): FigureShape {
  return {
    axes: shape.axes.map((axis) => axis),
    dimensions: shape.dimensions.map(projectShapeExpression),
    batchSemantics: shape.batchSemantics,
  };
}

function projectShapeExpression(expression: FigureShapeExpression): FigureShapeExpression {
  switch (expression.kind) {
    case "known": return { kind: "known", value: expression.value };
    case "symbol": return { kind: "symbol", name: expression.name };
    case "derived": return { kind: "derived", operator: expression.operator, operands: expression.operands.map(projectShapeExpression) };
    case "unknown": return { kind: "unknown" };
  }
}

function projectRepeat(repeat: NonNullable<ComposableFigureComponent["repeat"]>): NonNullable<ComposableFigureComponent["repeat"]> {
  return {
    count: repeat.count,
    unitNodeIds: repeat.unitNodeIds.map((id) => id),
    expansionPolicy: repeat.expansionPolicy,
  };
}

function projectComponentStyle(style: ComposableDagVisualSpec["componentStyles"][string] | undefined): ComposableDagVisualSpec["componentStyles"][string] {
  if (!style) throw invalidPreviewError();
  return { fill: style.fill, stroke: style.stroke, grayscalePattern: style.grayscalePattern };
}

function projectConnectionStyle(style: ComposableDagVisualSpec["connectionStyles"][string] | undefined): ComposableDagVisualSpec["connectionStyles"][string] {
  if (!style) throw invalidPreviewError();
  return { stroke: style.stroke, grayscalePattern: style.grayscalePattern, thickness: style.thickness };
}

function notFoundPreviewError(): FoundationError {
  return new FoundationError(ApiErrorCode.NOT_FOUND, "Figure analysis was not found", 404);
}

function invalidPreviewError(): FoundationError {
  return new FoundationError("FIGURE_ANALYSIS_PREVIEW_INVALID", "Figure analysis cannot produce a safe preview", 409);
}

function safeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && value.length <= 128;
}
