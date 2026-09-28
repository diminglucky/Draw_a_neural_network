export const LABEL_PLACEMENT_VERSION = "label-placement/v1";

export function placeLabels(items = [], options = {}) {
  const padding = finite(options.padding, 8);
  const labelHeight = finite(options.labelHeight, 24);
  const charWidth = finite(options.charWidth, 8);
  const minWidth = finite(options.minWidth, 72);
  const preferredPlacement = String(options.preferredPlacement || "");
  const placements = [];
  const occupied = items.map((item) => normalizeBounds(item.bounds)).filter(Boolean);
  for (const item of [...items].sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x)) {
    const bounds = normalizeBounds(item.bounds);
    if (!bounds || !String(item.label || "").trim()) continue;
    const width = Math.max(minWidth, String(item.label).length * charWidth + padding * 2);
    const candidates = [
      { placement: "below", box: { x: bounds.x + bounds.w / 2 - width / 2, y: bounds.y + bounds.h + padding, w: width, h: labelHeight } },
      { placement: "above", box: { x: bounds.x + bounds.w / 2 - width / 2, y: bounds.y - labelHeight - padding, w: width, h: labelHeight } },
      { placement: "right", box: { x: bounds.x + bounds.w + padding, y: bounds.y + bounds.h / 2 - labelHeight / 2, w: width, h: labelHeight } },
      { placement: "left", box: { x: bounds.x - width - padding, y: bounds.y + bounds.h / 2 - labelHeight / 2, w: width, h: labelHeight } },
    ];
    const orderedCandidates = preferredPlacement
      ? [
        ...candidates.filter((candidate) => candidate.placement === preferredPlacement),
        ...candidates.filter((candidate) => candidate.placement !== preferredPlacement),
      ]
      : candidates;
    const selected = orderedCandidates.find((candidate) => !overlapsAny(candidate.box, occupied)) || orderedCandidates[0];
    placements.push({
      id: String(item.id || `label-${placements.length + 1}`),
      sourceId: String(item.id || ""),
      text: String(item.label),
      placement: selected.placement,
      bounds: selected.box,
    });
    occupied.push(selected.box);
  }
  return {
    version: LABEL_PLACEMENT_VERSION,
    labels: placements,
    diagnostics: [],
  };
}

export function validateLabelPlacement(result = {}) {
  const issues = [];
  if (result.version !== LABEL_PLACEMENT_VERSION) issues.push({ code: "invalid-label-placement-version", value: result.version });
  for (const label of result.labels || []) {
    if (!normalizeBounds(label.bounds)) issues.push({ code: "invalid-label-bounds", labelId: label.id });
    if (!String(label.text || "").trim()) issues.push({ code: "empty-label-text", labelId: label.id });
  }
  return { ok: issues.length === 0, issues };
}

function overlapsAny(box, others) {
  return others.some((other) => overlaps(box, other));
}

function overlaps(left, right) {
  return left.x < right.x + right.w && left.x + left.w > right.x
    && left.y < right.y + right.h && left.y + left.h > right.y;
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const w = Number(bounds.w);
  const h = Number(bounds.h);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
