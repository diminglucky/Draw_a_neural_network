import type { FigureBounds, PublicationFigurePlanV2 } from "./publication-figure-plan-v2.js";

export interface VisualQaIssue { code: string; message: string; objectIds: string[]; }
export interface VisualQaResult { blocking: VisualQaIssue[]; warnings: VisualQaIssue[]; }

export function runVisualQa(plan: PublicationFigurePlanV2): VisualQaResult {
  const blocking: VisualQaIssue[] = [];
  const warnings: VisualQaIssue[] = [];
  const page = { x: 0, y: 0, width: plan.coordinateSpace.width, height: plan.coordinateSpace.height };
  const bounded = [
    ...plan.regions.map((item) => ({ id: item.id, bounds: item.bounds })),
    ...plan.primitives.map((item) => ({ id: item.id, bounds: item.bounds })),
    ...plan.annotations.map((item) => ({ id: item.id, bounds: item.bounds })),
  ];
  for (const item of bounded) if (!within(page, item.bounds)) blocking.push({ code: "page-overflow", message: `Plan object "${item.id}" extends beyond the figure page`, objectIds: [item.id] });
  for (const relation of plan.relations) {
    if (relation.route.some((point) => point.x > page.width || point.y > page.height)) blocking.push({ code: "page-overflow", message: `Relation "${relation.id}" routes beyond the figure page`, objectIds: [relation.id] });
    const source = plan.primitives.find((primitive) => primitive.id === relation.sourcePrimitiveId);
    const target = plan.primitives.find((primitive) => primitive.id === relation.targetPrimitiveId);
    const first = relation.route[0];
    const last = relation.route[relation.route.length - 1];
    if (source && first && !touches(source.bounds, first)) blocking.push({ code: "relation-endpoint-detached", message: `Relation "${relation.id}" does not begin on its source primitive`, objectIds: [relation.id, source.id] });
    if (target && last && !touches(target.bounds, last)) blocking.push({ code: "relation-endpoint-detached", message: `Relation "${relation.id}" does not end on its target primitive`, objectIds: [relation.id, target.id] });
  }
  for (let left = 0; left < plan.annotations.length; left += 1) {
    for (let right = left + 1; right < plan.annotations.length; right += 1) {
      const first = plan.annotations[left]!;
      const second = plan.annotations[right]!;
      if (overlaps(first.bounds, second.bounds)) blocking.push({ code: "label-overlap", message: `Annotations "${first.id}" and "${second.id}" overlap`, objectIds: [first.id, second.id] });
    }
  }
  const drawable = plan.primitives.filter((item) => item.kind !== "semantic_region" && item.kind !== "annotation_track" && item.kind !== "flow_arrow" && item.kind !== "residual_skip");
  for (let left = 0; left < drawable.length; left += 1) {
    for (let right = left + 1; right < drawable.length; right += 1) {
      const first = drawable[left]!;
      const second = drawable[right]!;
      if (overlaps(first.bounds, second.bounds)) blocking.push({ code: "primitive-collision", message: `Primitives "${first.id}" and "${second.id}" collide`, objectIds: [first.id, second.id] });
    }
  }
  if (plan.qaContract.printMode === "grayscale") {
    for (let left = 0; left < plan.relations.length; left += 1) {
      for (let right = left + 1; right < plan.relations.length; right += 1) {
        const first = plan.relations[left]!;
        const second = plan.relations[right]!;
        if (first.kind !== second.kind && first.style.stroke === second.style.stroke && first.style.tone === second.style.tone && first.style.thickness === second.style.thickness) {
          blocking.push({ code: "grayscale-relation-style-collision", message: `Relations "${first.id}" and "${second.id}" are indistinguishable in grayscale`, objectIds: [first.id, second.id] });
        }
      }
    }
  }
  if (plan.annotations.length > 120) warnings.push({ code: "annotation-density", message: "The preview contains more than 120 annotations", objectIds: plan.annotations.map((item) => item.id) });
  return { blocking, warnings };
}

function within(page: FigureBounds, value: FigureBounds): boolean { return value.x >= page.x && value.y >= page.y && value.x + value.width <= page.x + page.width && value.y + value.height <= page.y + page.height; }
function overlaps(left: FigureBounds, right: FigureBounds): boolean { return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y; }
function touches(bounds: FigureBounds, point: { x: number; y: number }): boolean {
  const tolerance = 0.001;
  const insideHorizontal = point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance;
  const insideVertical = point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance;
  const onVerticalEdge = Math.abs(point.x - bounds.x) <= tolerance || Math.abs(point.x - (bounds.x + bounds.width)) <= tolerance;
  const onHorizontalEdge = Math.abs(point.y - bounds.y) <= tolerance || Math.abs(point.y - (bounds.y + bounds.height)) <= tolerance;
  return (insideHorizontal && onHorizontalEdge) || (insideVertical && onVerticalEdge);
}
