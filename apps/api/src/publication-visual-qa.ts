import type { ComposableDagFigurePlan, ComposableFigureComponent, ComposableFigureConnection, FigureBounds, FigurePoint } from "./composable-dag-figure-compiler.js";

export const PUBLICATION_STYLE_TOKEN_VERSION = "publication-style-v1" as const;
const MIN_CONTRAST_RATIO = 4.5;

export type PublicationStyleTokenRole = "component" | "connection";
export type PublicationLinePattern = "solid" | "dashed" | "dotted";

export interface PublicationStyleToken {
  id: string;
  role: PublicationStyleTokenRole;
  contrastRatio: number;
  grayscaleValue: number;
  linePattern: PublicationLinePattern;
}

export interface PublicationVisualPlan {
  version: 1;
  styleTokenVersion: typeof PUBLICATION_STYLE_TOKEN_VERSION;
  basePlan: ComposableDagFigurePlan;
  styleTokens: PublicationStyleToken[];
  componentStyles: Array<{ semanticId: string; styleTokenId: string }>;
  connectionStyles: Array<{ semanticId: string; styleTokenId: string }>;
}

export interface PublicationVisualQaCheck {
  id: string;
  severity: "blocking" | "warning";
  passed: boolean;
  message: string;
}

export interface PublicationVisualQaResult {
  status: "pass" | "fail";
  checks: PublicationVisualQaCheck[];
}

const styleTokens: PublicationStyleToken[] = [
  { id: "component-terminal", role: "component", contrastRatio: 12, grayscaleValue: 0.12, linePattern: "solid" },
  { id: "component-operator", role: "component", contrastRatio: 9, grayscaleValue: 0.28, linePattern: "solid" },
  { id: "component-merge", role: "component", contrastRatio: 8, grayscaleValue: 0.44, linePattern: "solid" },
  { id: "component-attention", role: "component", contrastRatio: 7, grayscaleValue: 0.6, linePattern: "solid" },
  { id: "component-repeat", role: "component", contrastRatio: 6, grayscaleValue: 0.76, linePattern: "solid" },
  { id: "connection-data", role: "connection", contrastRatio: 10, grayscaleValue: 0.16, linePattern: "solid" },
  { id: "connection-condition", role: "connection", contrastRatio: 8, grayscaleValue: 0.7, linePattern: "dashed" },
];

export function applyPublicationVisualTokens(basePlan: ComposableDagFigurePlan): PublicationVisualPlan {
  return {
    version: 1,
    styleTokenVersion: PUBLICATION_STYLE_TOKEN_VERSION,
    basePlan: structuredClone(basePlan),
    styleTokens: structuredClone(styleTokens),
    componentStyles: basePlan.components.map((component) => ({ semanticId: component.id, styleTokenId: componentTokenId(component) })),
    connectionStyles: basePlan.connections.map((connection) => ({ semanticId: connection.id, styleTokenId: connectionTokenId(connection) })),
  };
}

export function runPublicationVisualQa(plan: PublicationVisualPlan): PublicationVisualQaResult {
  const checks = [
    check("style-token-contract", checkStyleTokenContract(plan), "Every component and connection has one registered publication style token."),
    check("page-bounds", checkPageBounds(plan.basePlan.pageBounds), "The declared page has positive finite dimensions."),
    check("component-bounds", checkComponentBounds(plan), "All components stay within the declared page bounds."),
    check("route-bounds", checkRouteBounds(plan), "All connection route points stay within the declared page bounds."),
    check("component-collision", checkComponentCollisions(plan.basePlan.components), "No component bounds overlap."),
    check("connection-endpoints", checkConnectionEndpoints(plan), "Every connection starts and ends on the declared component edge."),
    check("route-clearance", checkRouteClearance(plan), "Connection routes do not pass through unrelated components."),
    check("component-scale", checkComponentScale(plan.basePlan), "Every component meets the minimum readable scale for the selected density."),
    check("source-mapping", checkSourceMappings(plan.basePlan), "Every component has one evidence-backed source mapping."),
    check("contrast", checkContrast(plan), "Every referenced style token meets the minimum contrast ratio."),
    check("grayscale-distinctiveness", checkGrayscaleDistinctiveness(plan), "Grayscale relation tokens remain visually distinguishable."),
  ];
  return { status: checks.some((item) => item.severity === "blocking" && !item.passed) ? "fail" : "pass", checks };
}

function check(id: string, passed: boolean, message: string): PublicationVisualQaCheck {
  return { id, severity: "blocking", passed, message: passed ? message : `Visual QA failed: ${message}` };
}

function checkComponentBounds(plan: PublicationVisualPlan): boolean {
  return plan.basePlan.components.length > 0 && plan.basePlan.components.every((component) => within(plan.basePlan.pageBounds, component.bounds));
}

function checkPageBounds(page: FigureBounds): boolean {
  return Number.isFinite(page.x) && Number.isFinite(page.y) && Number.isFinite(page.width) && Number.isFinite(page.height) && page.width > 0 && page.height > 0;
}

function checkRouteBounds(plan: PublicationVisualPlan): boolean {
  return plan.basePlan.connections.every((connection) => connection.route.length >= 2 && connection.route.every((point) => withinPoint(plan.basePlan.pageBounds, point)));
}

function checkComponentCollisions(components: ComposableFigureComponent[]): boolean {
  for (let left = 0; left < components.length; left += 1) {
    for (let right = left + 1; right < components.length; right += 1) {
      if (overlaps(components[left]!.bounds, components[right]!.bounds)) return false;
    }
  }
  return true;
}

function checkConnectionEndpoints(plan: PublicationVisualPlan): boolean {
  const components = new Map(plan.basePlan.components.map((component) => [component.id, component]));
  const horizontal = plan.basePlan.intent.orientation !== "portrait";
  return plan.basePlan.connections.every((connection) => {
    const source = components.get(connection.source.nodeId);
    const target = components.get(connection.target.nodeId);
    const first = connection.route[0];
    const last = connection.route.at(-1);
    if (!source || !target || !first || !last) return false;
    return samePoint(first, endpoint(source.bounds, horizontal, "source")) && samePoint(last, endpoint(target.bounds, horizontal, "target"));
  });
}

function checkRouteClearance(plan: PublicationVisualPlan): boolean {
  const components = new Map(plan.basePlan.components.map((component) => [component.id, component]));
  return plan.basePlan.connections.every((connection) => {
    const source = components.get(connection.source.nodeId);
    const target = components.get(connection.target.nodeId);
    if (!source || !target) return false;
    for (const component of plan.basePlan.components) {
      if (component.id === source.id || component.id === target.id) continue;
      for (let index = 1; index < connection.route.length; index += 1) {
        if (segmentIntersectsBounds(connection.route[index - 1]!, connection.route[index]!, component.bounds)) return false;
      }
    }
    return true;
  });
}

function checkComponentScale(plan: ComposableDagFigurePlan): boolean {
  const minimum = plan.intent.density === "compact" ? { width: 48, height: 24 } : plan.intent.density === "detailed" ? { width: 96, height: 48 } : { width: 72, height: 32 };
  return plan.components.every((component) => component.bounds.width >= minimum.width && component.bounds.height >= minimum.height);
}

function checkSourceMappings(plan: ComposableDagFigurePlan): boolean {
  const componentIds = new Set(plan.components.map((component) => component.id));
  const mappings = plan.sourceMappings.filter((mapping) => componentIds.has(mapping.semanticId));
  return mappings.length === componentIds.size && new Set(mappings.map((mapping) => mapping.semanticId)).size === componentIds.size && mappings.every((mapping) => mapping.evidenceIds.length > 0);
}

function checkContrast(plan: PublicationVisualPlan): boolean {
  const tokens = new Map(plan.styleTokens.map((token) => [token.id, token]));
  const ids = [...plan.componentStyles, ...plan.connectionStyles].map((mapping) => mapping.styleTokenId);
  return ids.length > 0 && ids.every((id) => {
    const token = tokens.get(id);
    return Boolean(token && token.contrastRatio >= MIN_CONTRAST_RATIO && token.grayscaleValue >= 0 && token.grayscaleValue <= 1);
  });
}

function checkStyleTokenContract(plan: PublicationVisualPlan): boolean {
  if (plan.version !== 1 || plan.styleTokenVersion !== PUBLICATION_STYLE_TOKEN_VERSION) return false;
  const tokenIds = new Set(plan.styleTokens.map((token) => token.id));
  if (tokenIds.size !== plan.styleTokens.length) return false;
  const componentIds = new Set(plan.basePlan.components.map((component) => component.id));
  const connectionIds = new Set(plan.basePlan.connections.map((connection) => connection.id));
  const componentStyleIds = new Set(plan.componentStyles.map((style) => style.semanticId));
  const connectionStyleIds = new Set(plan.connectionStyles.map((style) => style.semanticId));
  return plan.componentStyles.length === componentIds.size && componentStyleIds.size === componentIds.size && [...componentIds].every((id) => componentStyleIds.has(id)) &&
    plan.connectionStyles.length === connectionIds.size && connectionStyleIds.size === connectionIds.size && [...connectionIds].every((id) => connectionStyleIds.has(id)) &&
    [...plan.componentStyles, ...plan.connectionStyles].every((style) => tokenIds.has(style.styleTokenId));
}

function checkGrayscaleDistinctiveness(plan: PublicationVisualPlan): boolean {
  if (plan.basePlan.intent.printMode !== "grayscale") return true;
  const tokens = new Map(plan.styleTokens.map((token) => [token.id, token]));
  const relationStyles = plan.basePlan.connections.map((connection) => ({ transport: connection.transport, token: tokens.get(plan.connectionStyles.find((style) => style.semanticId === connection.id)?.styleTokenId ?? "") }));
  for (let left = 0; left < relationStyles.length; left += 1) {
    for (let right = left + 1; right < relationStyles.length; right += 1) {
      const first = relationStyles[left]!;
      const second = relationStyles[right]!;
      if (first.transport !== second.transport && first.token && second.token && first.token.grayscaleValue === second.token.grayscaleValue && first.token.linePattern === second.token.linePattern) return false;
    }
  }
  return true;
}

function componentTokenId(component: ComposableFigureComponent): string {
  return `component-${component.kind}`;
}

function connectionTokenId(connection: ComposableFigureConnection): string {
  return `connection-${connection.transport}`;
}

function endpoint(bounds: FigureBounds, horizontal: boolean, role: "source" | "target"): FigurePoint {
  if (horizontal) return role === "source" ? { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 } : { x: bounds.x, y: bounds.y + bounds.height / 2 };
  return role === "source" ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height } : { x: bounds.x + bounds.width / 2, y: bounds.y };
}

function within(page: FigureBounds, value: FigureBounds): boolean {
  return value.x >= page.x && value.y >= page.y && value.width > 0 && value.height > 0 && value.x + value.width <= page.x + page.width && value.y + value.height <= page.y + page.height;
}

function withinPoint(page: FigureBounds, point: FigurePoint): boolean {
  return point.x >= page.x && point.y >= page.y && point.x <= page.x + page.width && point.y <= page.y + page.height;
}

function overlaps(left: FigureBounds, right: FigureBounds): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

function samePoint(left: FigurePoint, right: FigurePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function segmentIntersectsBounds(start: FigurePoint, end: FigurePoint, bounds: FigureBounds): boolean {
  let startT = 0;
  let endT = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  for (const [p, q] of [[-dx, start.x - bounds.x], [dx, bounds.x + bounds.width - start.x], [-dy, start.y - bounds.y], [dy, bounds.y + bounds.height - start.y]] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) startT = Math.max(startT, ratio);
    else endT = Math.min(endT, ratio);
    if (startT > endT) return false;
  }
  return true;
}
