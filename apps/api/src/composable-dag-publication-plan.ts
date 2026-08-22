import {
  compileComposableDagFigure,
  type ComposableDagFigurePlan,
  type ComposableDagUnresolved,
} from "./composable-dag-figure-compiler.js";
import type { FigureIntent } from "./figure-intent.js";
import type { ArchitectureIRv3 } from "./network-ir-v3.js";
import type { FigureBounds } from "./composable-dag-figure-compiler.js";

export const COMPOSABLE_DAG_PUBLICATION_PLAN_VERSION = 1 as const;
export const COMPOSABLE_DAG_VISUAL_QA_VERSION = "composable-dag-visual-qa-v1" as const;

export type GrayscalePattern = "solid" | "stripe" | "dot" | "hatch" | "none";
export type ConnectionGrayscalePattern = "solid" | "dash" | "dot" | "double";

export interface ComposableDagVisualSpec {
  page: {
    background: string;
    minMargin: number;
    minFontSizePt: number;
    minContrastRatio: number;
  };
  componentStyles: Record<string, {
    fill: string;
    stroke: string;
    grayscalePattern: GrayscalePattern;
  }>;
  connectionStyles: Record<string, {
    stroke: string;
    grayscalePattern: ConnectionGrayscalePattern;
    thickness: number;
  }>;
  labels: Array<{
    id: string;
    semanticId: string;
    text: string;
    bounds: FigureBounds;
    fontSizePt: number;
  }>;
}

export interface ComposableDagPublicationPlan {
  version: typeof COMPOSABLE_DAG_PUBLICATION_PLAN_VERSION;
  dagPlan: ComposableDagFigurePlan;
  visualSpec: ComposableDagVisualSpec;
  evidenceIndex: ArchitectureIRv3["evidenceIndex"];
  qaVersion: typeof COMPOSABLE_DAG_VISUAL_QA_VERSION;
}

export type ComposableDagPublicationBuildResult =
  | { status: "ready"; publicationPlan: ComposableDagPublicationPlan }
  | { status: "unresolved"; graphId: string; unresolved: ComposableDagUnresolved[] };

const COLOR_COMPONENT_STYLES: ComposableDagVisualSpec["componentStyles"] = {
  terminal: { fill: "#E8EEF7", stroke: "#1D3557", grayscalePattern: "solid" },
  operator: { fill: "#DDEBF7", stroke: "#1D4E89", grayscalePattern: "stripe" },
  merge: { fill: "#FCECC9", stroke: "#8A5A00", grayscalePattern: "dot" },
  attention: { fill: "#E8DFF5", stroke: "#5A189A", grayscalePattern: "hatch" },
  repeat: { fill: "#D9F2E6", stroke: "#1B5E20", grayscalePattern: "none" },
};

const MONOCHROME_COMPONENT_STYLES: ComposableDagVisualSpec["componentStyles"] = {
  terminal: { fill: "#FFFFFF", stroke: "#111111", grayscalePattern: "solid" },
  operator: { fill: "#E6E6E6", stroke: "#111111", grayscalePattern: "stripe" },
  merge: { fill: "#CCCCCC", stroke: "#111111", grayscalePattern: "dot" },
  attention: { fill: "#999999", stroke: "#111111", grayscalePattern: "hatch" },
  repeat: { fill: "#F2F2F2", stroke: "#111111", grayscalePattern: "none" },
};

const CONNECTION_STYLES: ComposableDagVisualSpec["connectionStyles"] = {
  data: { stroke: "#334155", grayscalePattern: "solid", thickness: 1.5 },
  condition: { stroke: "#7C3AED", grayscalePattern: "dash", thickness: 1.5 },
};

export function buildComposableDagPublicationPlan(input: {
  architectureIr: ArchitectureIRv3;
  intent: FigureIntent;
  layoutSeed: string;
}): ComposableDagPublicationBuildResult {
  const compiled = compileComposableDagFigure({
    architectureIr: input.architectureIr,
    intent: input.intent,
    layoutSeed: input.layoutSeed,
  });
  if (compiled.status === "unresolved") return compiled;

  const dagPlan = structuredClone(compiled.plan);
  return {
    status: "ready",
    publicationPlan: {
      version: COMPOSABLE_DAG_PUBLICATION_PLAN_VERSION,
      dagPlan,
      visualSpec: createVisualSpec(dagPlan, input.intent),
      evidenceIndex: structuredClone(input.architectureIr.evidenceIndex),
      qaVersion: COMPOSABLE_DAG_VISUAL_QA_VERSION,
    },
  };
}

function createVisualSpec(plan: ComposableDagFigurePlan, intent: FigureIntent): ComposableDagVisualSpec {
  const styles = intent.printMode === "grayscale"
    ? MONOCHROME_COMPONENT_STYLES
    : COLOR_COMPONENT_STYLES;
  const fontSizePt = intent.density === "compact" ? 8 : intent.density === "detailed" ? 10 : 9;
  return {
    page: {
      background: "#FFFFFF",
      minMargin: 48,
      minFontSizePt: 8,
      minContrastRatio: 4.5,
    },
    componentStyles: structuredClone(styles),
    connectionStyles: structuredClone(CONNECTION_STYLES),
    labels: plan.components.map((component) => ({
      id: `label-${component.id}`,
      semanticId: component.id,
      text: boundedLabel(component.semanticRole || component.id),
      bounds: labelBounds(component.bounds),
      fontSizePt,
    })),
  };
}

function boundedLabel(value: string): string {
  const singleLine = value.replace(/[\r\n]+/g, " ").trim();
  return singleLine.slice(0, 128) || "component";
}

function labelBounds(bounds: FigureBounds): FigureBounds {
  return {
    x: bounds.x + 8,
    y: bounds.y + 8,
    width: Math.max(1, bounds.width - 16),
    height: Math.min(18, Math.max(1, bounds.height - 16)),
  };
}
