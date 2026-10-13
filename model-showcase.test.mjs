import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBlockAcceptanceFixture } from "./block-acceptance-audit.mjs";
import { architectureShowcaseFixtures, showcaseNames } from "./model-showcase-fixtures.mjs";

test("architecture showcase fixtures compile into valid Visio-ready scenes", () => {
  assert.equal(new Set(showcaseNames()).size, architectureShowcaseFixtures.length);
  for (const fixture of architectureShowcaseFixtures) {
    const { audit, result } = evaluateBlockAcceptanceFixture(fixture);
    assert.equal(audit.accepted, true, fixture.name);
    assert.equal(result.visioDiagramPlanValidation.ok, true, fixture.name);
    for (const kind of fixture.expectedKinds) {
      assert.ok(result.blockSummary.byKind[kind]?.count >= 1, `${fixture.name} missing ${kind}`);
    }
  }
});

// 识别层判出的家族必须真的落到对应的版式原型上——只"认出来"但版式没跟上，
// 画出来还是通用顺序流，等于没做。这里挑几个有代表性的家族端到端锁一遍。
test("detected architecture families drive their own layout archetype", () => {
  const expected = {
    yolo: { family: "detection", archetype: "detection-pyramid" },
    unet: { family: "encoder-decoder", archetype: "encoder-decoder-u" },
    "resnet-block": { family: "residual", archetype: "residual-tower" },
    vit: { family: "transformer", archetype: "transformer-stack" },
  };
  for (const [name, want] of Object.entries(expected)) {
    const fixture = architectureShowcaseFixtures.find((item) => item.name === name);
    const { result } = evaluateBlockAcceptanceFixture(fixture);
    const family = result.renderingProfile?.architectureFamily || {};
    assert.equal(family.family, want.family, `${name} 家族判定`);
    assert.equal(family.archetype, want.archetype, `${name} 原型`);
    assert.equal(result.visioDiagramPlan?.scene?.layoutArchetype, want.archetype, `${name} 版式必须真的用上该原型`);
  }
});
