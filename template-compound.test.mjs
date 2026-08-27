import assert from "node:assert/strict";
import test from "node:test";
import { templates } from "./models.js";

test("ResNet template uses a residual compound instead of a standalone bottleneck box", () => {
  const template = templates.resnet();
  const residual = template.nodes.find((node) => node.id === "res-b1b");
  assert.equal(residual.type, "compound");
  assert.equal(residual.compoundKind, "residual");
  assert.ok(!template.nodes.some((node) => node.id === "res-add1"));
  assert.ok(template.edges.some((edge) => edge.source === "res-pool0" && edge.target === "res-b1b" && edge.type === "skip"));
});

test("Diffusion template exposes timestep and conditioning inside the core module", () => {
  const template = templates.diffusion();
  const core = template.nodes.find((node) => node.id === "diff-mid");
  assert.equal(core.type, "compound");
  assert.equal(core.compoundKind, "diffusion");
  assert.ok(template.edges.some((edge) => edge.source === "diff-t" && edge.target === "diff-mid"));
  assert.ok(template.edges.some((edge) => edge.source === "diff-cond" && edge.target === "diff-mid"));
});

test("U-Net template represents encoder and decoder stages as stage compounds", () => {
  const template = templates.unet();
  for (const id of ["unet-e1", "unet-e2", "unet-d2", "unet-d1"]) {
    const stage = template.nodes.find((node) => node.id === id);
    assert.equal(stage.type, "compound", id);
    assert.equal(stage.compoundKind, "stage", id);
  }
});

test("3D Medical U-Net template represents volumetric stages as volume compounds", () => {
  const template = templates.unet3d();
  for (const id of ["vol-e1", "vol-e2", "vol-d2", "vol-d1"]) {
    const stage = template.nodes.find((node) => node.id === id);
    assert.equal(stage.type, "compound", id);
    assert.equal(stage.compoundKind, "volume-stage", id);
  }
});
