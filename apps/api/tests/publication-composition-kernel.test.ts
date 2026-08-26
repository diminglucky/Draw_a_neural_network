import { describe, expect, it } from "vitest";
import { composePublicationLayout } from "../src/publication-composition-kernel.js";
import type { ComposableRegionVisualDescriptor } from "../src/composable-region-visual-compiler.js";

describe("publication composition kernel", () => {
  it("creates semantic size hierarchy and balances branch columns around one reading axis", () => {
    const descriptors = [
      descriptor("input", "InputTerminal", 0, 0),
      descriptor("branch-module", "ModuleFrame", 1, 0),
      descriptor("branch-operator", "OperatorFrame", 1, 8),
      descriptor("merge", "AddMarker", 2, 0),
      descriptor("output", "OutputTerminal", 3, 0),
    ];

    const first = composePublicationLayout(descriptors);
    const second = composePublicationLayout(descriptors);
    const input = requiredBounds(first, "primitive:input");
    const module = requiredBounds(first, "primitive:branch-module");
    const operator = requiredBounds(first, "primitive:branch-operator");
    const merge = requiredBounds(first, "primitive:merge");
    const output = requiredBounds(first, "primitive:output");

    expect(first).toEqual(second);
    expect(input).toMatchObject({ width: 480, height: 240 });
    expect(operator).toMatchObject({ width: 600, height: 280 });
    expect(module).toMatchObject({ width: 720, height: 320 });
    expect(merge.width).toBe(merge.height);
    expect(merge.width).toBeLessThan(operator.width);

    const readingAxis = verticalCenter([module, operator]);
    expect(verticalCenter([input])).toBe(readingAxis);
    expect(verticalCenter([merge])).toBe(readingAxis);
    expect(verticalCenter([output])).toBe(readingAxis);

    const primaryBounds = [...first.boundsByPrimitive.values()];
    expect(primaryBounds.every((bounds, index) => primaryBounds.slice(index + 1).every((other) => !overlap(bounds, other)))).toBe(true);
    expect(primaryBounds.every((bounds) => contains(first.page, bounds))).toBe(true);
  });
});

function descriptor(id: string, kind: ComposableRegionVisualDescriptor["kind"], rank: number, lane: number): ComposableRegionVisualDescriptor {
  return {
    primitiveId: `primitive:${id}`,
    componentId: `component:${id}`,
    topologyComponentId: `component:${id}`,
    kind,
    regionId: "region:main",
    regionRole: "base",
    label: id,
    styleTokenIds: [],
    nativeSupport: "supported",
    connectorPorts: ["left", "right"],
    geometryRequirement: "none",
    sourceNodeIds: [`node:${id}`],
    sourceEdgeIds: [],
    evidenceIds: [`evidence:${id}`],
    layout: { rank, lane, order: lane },
    attachment: null,
  };
}

function requiredBounds(layout: ReturnType<typeof composePublicationLayout>, primitiveId: string) {
  const bounds = layout.boundsByPrimitive.get(primitiveId);
  if (!bounds) throw new Error(`Missing bounds for ${primitiveId}`);
  return bounds;
}

function verticalCenter(bounds: readonly { y: number; height: number }[]): number {
  const top = Math.min(...bounds.map((item) => item.y));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return top + (bottom - top) / 2;
}

function overlap(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function contains(outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}
