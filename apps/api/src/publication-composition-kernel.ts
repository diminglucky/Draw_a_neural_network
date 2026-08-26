import type { ComposableRegionVisualDescriptor } from "./composable-region-visual-compiler.js";
import { compareCodeUnits } from "./stable-string-order.js";

const MARGIN = 200;
const COLUMN_GAP = 280;
const ROW_GAP = 160;
const ATTACHMENT_GAP = 16;

export interface PublicationCompositionBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PublicationCompositionLayout {
  readonly descriptors: readonly ComposableRegionVisualDescriptor[];
  readonly boundsByPrimitive: ReadonlyMap<string, PublicationCompositionBounds>;
  readonly page: PublicationCompositionBounds;
  readonly safeMargins: PublicationCompositionBounds;
}

/**
 * Converts renderer-neutral visual descriptors into deterministic publication
 * geometry. It has no topology authority and never creates or removes a visual.
 */
export function composePublicationLayout(input: readonly ComposableRegionVisualDescriptor[]): PublicationCompositionLayout {
  const descriptors = normalizeDescriptorOrder(input);
  const primaries = descriptors.filter((descriptor) => descriptor.attachment === null);
  if (primaries.length === 0) throw new Error("Publication composition requires at least one primary visual");

  const byRank = groupByRank(primaries);
  const stackHeightByRank = new Map([...byRank.entries()].map(([rank, values]) => [rank, stackHeight(values)]));
  const contentHeight = Math.max(...stackHeightByRank.values());
  const rankStartX = rankPositions(byRank, descriptors);
  const boundsByPrimitive = new Map<string, PublicationCompositionBounds>();

  for (const [rank, values] of [...byRank.entries()].sort(([left], [right]) => left - right)) {
    let y = MARGIN + Math.floor((contentHeight - stackHeightByRank.get(rank)!) / 2);
    const rankWidth = Math.max(...values.map((descriptor) => sizeFor(descriptor.kind).width));
    for (const descriptor of values) {
      const size = sizeFor(descriptor.kind);
      boundsByPrimitive.set(descriptor.primitiveId, {
        x: rankStartX.get(rank)! + Math.floor((rankWidth - size.width) / 2),
        y,
        ...size,
      });
      y += size.height + ROW_GAP;
    }
  }

  const allocated = [...boundsByPrimitive.values()];
  for (const descriptor of descriptors
    .filter((item) => item.attachment !== null)
    .sort((left, right) => left.layout.rank - right.layout.rank
      || left.layout.lane - right.layout.lane
      || attachmentPriority(left) - attachmentPriority(right)
      || compareCodeUnits(left.primitiveId, right.primitiveId))) {
    const primary = boundsByPrimitive.get(descriptor.attachment!.primaryPrimitiveId);
    if (!primary) throw new Error(`Attached visual primitive lacks stable primary bounds: ${descriptor.primitiveId}`);
    let bounds = preferredAttachmentBounds(primary, descriptor);
    let collision = allocated.find((item) => overlaps(bounds, item));
    while (collision) {
      bounds = { ...bounds, y: collision.y + collision.height + ATTACHMENT_GAP };
      collision = allocated.find((item) => overlaps(bounds, item));
    }
    allocated.push(bounds);
    boundsByPrimitive.set(descriptor.primitiveId, bounds);
  }

  const right = Math.max(...[...boundsByPrimitive.values()].map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...[...boundsByPrimitive.values()].map((bounds) => bounds.y + bounds.height));
  const page = Object.freeze({ x: 0, y: 0, width: right + MARGIN, height: bottom + MARGIN });
  const safeMargins = Object.freeze({ x: MARGIN, y: MARGIN, width: page.width - MARGIN * 2, height: page.height - MARGIN * 2 });
  return Object.freeze({ descriptors: Object.freeze(descriptors), boundsByPrimitive, page, safeMargins });
}

function normalizeDescriptorOrder(input: readonly ComposableRegionVisualDescriptor[]): ComposableRegionVisualDescriptor[] {
  const primariesByOriginalRank = new Map<number, ComposableRegionVisualDescriptor[]>();
  for (const descriptor of input.filter((item) => item.attachment === null)) {
    primariesByOriginalRank.set(descriptor.layout.rank, [...(primariesByOriginalRank.get(descriptor.layout.rank) ?? []), descriptor]);
  }
  const normalizedPrimaryLayout = new Map<string, { rank: number; lane: number; order: number }>();
  for (const [rank, [, values]] of [...primariesByOriginalRank.entries()].sort(([left], [right]) => left - right).entries()) {
    const ordered = [...values].sort(descriptorOrder);
    ordered.forEach((descriptor, lane) => normalizedPrimaryLayout.set(descriptor.primitiveId, { rank, lane, order: lane }));
  }
  return input.map((descriptor) => {
    const primaryId = descriptor.attachment?.primaryPrimitiveId ?? descriptor.primitiveId;
    const primaryLayout = normalizedPrimaryLayout.get(primaryId);
    if (!primaryLayout) throw new Error(`Visual primitive lacks canonical composition rank: ${descriptor.primitiveId}`);
    const layout = descriptor.attachment
      ? { ...primaryLayout, order: primaryLayout.order + descriptor.attachment.slot + 1 }
      : primaryLayout;
    return { ...descriptor, layout };
  }).sort(descriptorOrder);
}

function groupByRank(descriptors: readonly ComposableRegionVisualDescriptor[]): Map<number, ComposableRegionVisualDescriptor[]> {
  const result = new Map<number, ComposableRegionVisualDescriptor[]>();
  for (const descriptor of descriptors) result.set(descriptor.layout.rank, [...(result.get(descriptor.layout.rank) ?? []), descriptor]);
  for (const [rank, values] of result) result.set(rank, [...values].sort(descriptorOrder));
  return result;
}

function rankPositions(byRank: ReadonlyMap<number, readonly ComposableRegionVisualDescriptor[]>, descriptors: readonly ComposableRegionVisualDescriptor[]): Map<number, number> {
  const result = new Map<number, number>();
  let x = MARGIN;
  for (const [rank, primaries] of [...byRank.entries()].sort(([left], [right]) => left - right)) {
    result.set(rank, x);
    const primaryWidth = Math.max(...primaries.map((descriptor) => sizeFor(descriptor.kind).width));
    const attachmentWidth = descriptors
      .filter((descriptor) => descriptor.attachment !== null && descriptor.layout.rank === rank)
      .reduce((maximum, descriptor) => Math.max(maximum, attachmentSizeFor(descriptor).width + ATTACHMENT_GAP), 0);
    x += primaryWidth + attachmentWidth + COLUMN_GAP;
  }
  return result;
}

function stackHeight(descriptors: readonly ComposableRegionVisualDescriptor[]): number {
  return descriptors.reduce((total, descriptor) => total + sizeFor(descriptor.kind).height, 0)
    + Math.max(0, descriptors.length - 1) * ROW_GAP;
}

function sizeFor(kind: ComposableRegionVisualDescriptor["kind"]): { width: number; height: number } {
  if (kind === "InputTerminal" || kind === "OutputTerminal") return { width: 480, height: 240 };
  if (kind === "ModuleFrame") return { width: 720, height: 320 };
  if (kind === "OperatorFrame") return { width: 600, height: 280 };
  if (kind === "CandidateCallout") return { width: 720, height: 280 };
  if (kind === "SplitMarker") return { width: 120, height: 120 };
  if (kind === "AddMarker") return { width: 160, height: 160 };
  if (kind === "ConcatMarker") return { width: 180, height: 180 };
  if (kind === "RepeatBadge") return { width: 240, height: 96 };
  if (kind === "TensorStage") return { width: 360, height: 200 };
  if (kind === "TensorVolume") return { width: 300, height: 200 };
  if (kind === "AttentionTokenStrip") return { width: 360, height: 160 };
  if (kind === "AttentionRelation") return { width: 120, height: 120 };
  return { width: 600, height: 280 };
}

function preferredAttachmentBounds(primary: PublicationCompositionBounds, descriptor: ComposableRegionVisualDescriptor): PublicationCompositionBounds {
  const size = attachmentSizeFor(descriptor);
  const x = primary.x + primary.width + ATTACHMENT_GAP;
  if (descriptor.attachment!.placement === "corner_top_right") return { x, y: primary.y + ATTACHMENT_GAP, ...size };
  if (descriptor.attachment!.placement === "output_side") return { x, y: primary.y + Math.floor((primary.height - size.height) / 2), ...size };
  if (descriptor.attachment!.placement === "adjacent_right_top") return { x, y: primary.y + 64, ...size };
  return { x, y: primary.y + 184, ...size };
}

function attachmentSizeFor(descriptor: ComposableRegionVisualDescriptor): { width: number; height: number } {
  if (descriptor.attachment?.placement === "corner_top_right") return { width: 180, height: 48 };
  if (descriptor.attachment?.placement === "adjacent_right_top") return { width: 300, height: 88 };
  if (descriptor.attachment?.placement === "adjacent_right_bottom") return { width: 300, height: 68 };
  return sizeFor(descriptor.kind);
}

function attachmentPriority(descriptor: ComposableRegionVisualDescriptor): number {
  if (descriptor.kind === "SplitMarker") return 5;
  if (descriptor.kind === "RepeatBadge") return 10;
  if (descriptor.kind === "TensorStage") return 20;
  if (descriptor.kind === "TensorVolume") return 30;
  if (descriptor.kind === "AttentionTokenStrip") return 50;
  if (descriptor.kind === "AttentionRelation") return 60;
  return 100;
}

function overlaps(left: PublicationCompositionBounds, right: PublicationCompositionBounds): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function descriptorOrder(left: ComposableRegionVisualDescriptor, right: ComposableRegionVisualDescriptor): number {
  return left.layout.rank - right.layout.rank
    || left.layout.lane - right.layout.lane
    || left.layout.order - right.layout.order
    || compareCodeUnits(left.primitiveId, right.primitiveId);
}
