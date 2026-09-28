import assert from "node:assert/strict";
import test from "node:test";
import { placeLabels, validateLabelPlacement } from "./label-placement.mjs";

test("places labels outside occupied primitive bounds", () => {
  const result = placeLabels([
    { id: "a", label: "Input", bounds: { x: 0, y: 0, w: 100, h: 60 } },
    { id: "b", label: "Conv + ReLU", bounds: { x: 140, y: 0, w: 100, h: 60 } },
  ]);
  assert.equal(validateLabelPlacement(result).ok, true);
  assert.equal(result.labels.length, 2);
  for (const label of result.labels) {
    assert.equal(overlaps(label.bounds, { x: 0, y: 0, w: 100, h: 60 }), false);
    assert.equal(overlaps(label.bounds, { x: 140, y: 0, w: 100, h: 60 }), false);
  }
});

test("label placement avoids other labels", () => {
  const result = placeLabels([
    { id: "a", label: "A", bounds: { x: 0, y: 0, w: 20, h: 20 } },
    { id: "b", label: "B", bounds: { x: 0, y: 40, w: 20, h: 20 } },
    { id: "c", label: "C", bounds: { x: 0, y: 80, w: 20, h: 20 } },
  ]);
  for (let i = 0; i < result.labels.length; i += 1) {
    for (let j = i + 1; j < result.labels.length; j += 1) {
      assert.equal(overlaps(result.labels[i].bounds, result.labels[j].bounds), false);
    }
  }
});

function overlaps(left, right) {
  return left.x < right.x + right.w && left.x + left.w > right.x
    && left.y < right.y + right.h && left.y + left.h > right.y;
}
