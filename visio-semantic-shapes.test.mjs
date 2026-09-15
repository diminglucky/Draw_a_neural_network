import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(new URL("./visio-bridge.ps1", import.meta.url), "utf8");
const dispatch = script.match(/function Draw-PlanShape[\s\S]*?\r?\n}\r?\n\r?\nfunction Draw-JunctionDot/);

test("Visio bridge defines native semantic shape primitives", () => {
  for (const primitive of [
    "Draw-DecisionShape",
    "Draw-MergeAddShape",
    "Draw-MergeConcatShape",
    "Draw-SplitShape",
    "Draw-JunctionShape",
    "Draw-RepeatMarkerShape",
    "Draw-AnnotationShape",
  ]) {
    assert.match(script, new RegExp(`function ${primitive}`), `missing ${primitive}`);
  }
});

test("semantic primitives use COM-supported page drawing methods", () => {
  assert.match(script, /Draw-DecisionShape[\s\S]*?DrawPolyline\(/);
  assert.match(script, /Draw-MergeAddShape[\s\S]*?DrawOval\(/);
  assert.match(script, /Draw-MergeConcatShape[\s\S]*?DrawRectangle\(/);
  assert.match(script, /Draw-SplitShape[\s\S]*?DrawPolyline\(/);
  assert.match(script, /Draw-JunctionShape[\s\S]*?DrawOval\(/);
  assert.match(script, /Draw-RepeatMarkerShape[\s\S]*?DrawRectangle\(/);
  assert.match(script, /Draw-AnnotationShape[\s\S]*?DrawRectangle\(/);
  assert.doesNotMatch(script, /DrawRoundedRectangle|DrawDiamond|DrawCircle/);
});

test("Draw-PlanShape dispatches semantic roles without architecture-name branches", () => {
  assert.ok(dispatch, "expected semantic Draw-PlanShape dispatch body");
  for (const [role, primitive] of [
    ["decision", "Draw-DecisionShape"],
    ["merge-add", "Draw-MergeAddShape"],
    ["merge-concat", "Draw-MergeConcatShape"],
    ["split", "Draw-SplitShape"],
    ["junction", "Draw-JunctionShape"],
    ["repeat-marker", "Draw-RepeatMarkerShape"],
    ["annotation", "Draw-AnnotationShape"],
  ]) {
    assert.match(dispatch[0], new RegExp(role));
    assert.match(dispatch[0], new RegExp(primitive));
  }
  assert.doesNotMatch(dispatch[0], /YOLO|ResNet|Transformer|GAN|VGG|U-Net/);
});

test("semantic primitives preserve plan data through the common style path", () => {
  for (const primitive of [
    "Draw-DecisionShape",
    "Draw-MergeAddShape",
    "Draw-MergeConcatShape",
    "Draw-SplitShape",
    "Draw-JunctionShape",
    "Draw-RepeatMarkerShape",
    "Draw-AnnotationShape",
  ]) {
    const body = script.match(new RegExp(`function ${primitive}[\\s\\S]*?\\r?\\n}\\r?\\n`));
    assert.ok(body, `missing body for ${primitive}`);
    assert.match(body[0], /Set-ShapeStyle|Set-PlanData/);
  }
});

test("semantic primitives assign stable native identities from plan shape IDs", () => {
  assert.match(script, /function Set-NativeShapeIdentity[\s\S]*?\.NameU\s*=\s*\$nativeId/);
  assert.match(script, /Set-NativeShapeIdentity[\s\S]*?\$Spec\.id/);
  for (const primitive of [
    "Draw-DecisionShape",
    "Draw-MergeAddShape",
    "Draw-MergeConcatShape",
    "Draw-SplitShape",
    "Draw-JunctionShape",
    "Draw-RepeatMarkerShape",
    "Draw-AnnotationShape",
  ]) {
    const body = script.match(new RegExp(`function ${primitive}[\\s\\S]*?\\r?\\n}\\r?\\n`));
    assert.match(body[0], /Set-NativeShapeIdentity/);
  }
});

test("module colors are resolved from plan semantics and never from labels", () => {
  assert.doesNotMatch(script, /Get-NamedModuleColors/);
  assert.doesNotMatch(
    script,
    /-match\s+["'][^"']*(?:c2f|c2psa|csp|c3f|elan|repvgg|ghost|sppf|aspp|resblock|basicblock|yolo|conv)[^"']*["']/i,
  );

  const semanticColor = script.match(/function Get-SemanticColor[\s\S]*?\r?\n}\r?\n/);
  assert.ok(semanticColor, "expected semantic color resolver");
  assert.match(semanticColor[0], /styleProfile/);
  assert.match(semanticColor[0], /visualRole/);
  assert.match(semanticColor[0], /shapeData\.semanticRole/);
  assert.match(semanticColor[0], /Spec\.fill/);

  const namedModule = script.match(/function Draw-NamedModule[\s\S]*?\r?\n}\r?\n/);
  assert.ok(namedModule, "expected named module renderer");
  assert.match(namedModule[0], /Set-ShapeStyle/);
  assert.doesNotMatch(namedModule[0], /Get-PlanString\s+\$Spec\.label[\s\S]*?Get-(?:NamedModuleColors|ColorFromLabel)/i);
});

test("default neural primitives are flat, evidence-driven, and free of per-module legends", () => {
  const input = script.match(/function Draw-InputTensor[\s\S]*?\r?\n}\r?\n\r?\nfunction Draw-ImageInput/);
  const feature = script.match(/function Draw-FeaturePlane[\s\S]*?\r?\n}\r?\n/);
  const namedModule = script.match(/function Draw-NamedModule[\s\S]*?\r?\n}\r?\n/);
  assert.ok(input, "expected flat tensor input renderer");
  assert.ok(feature, "expected flat feature plane renderer");
  assert.ok(namedModule, "expected named module renderer");
  assert.doesNotMatch(input[0], /\$planes\s*=|planes\.Count|Draw-PrismFaces/);
  assert.match(feature[0], /DrawRectangle/);
  assert.doesNotMatch(feature[0], /PublicationTensor|RightBanded/);
  assert.match(namedModule[0], /Draw-RepeatBadge/);
  assert.match(dispatch[0], /feature-map-stage[\s\S]*Draw-FeaturePlane/);
  assert.match(dispatch[0], /legacy-publication-tensor[\s\S]*Draw-FeatureMapStack/);
  assert.doesNotMatch(script, /\$legendShapes\s*=\s*@\(Draw-Legend/);
});

test("compound modules dispatch through topology patterns, not architecture names", () => {
  assert.match(script, /function Draw-StructuredModule/);
  assert.match(script, /shapeData\.modulePattern/);
  assert.match(script, /Draw-StructuredModule[\s\S]*\$pattern/);
  assert.doesNotMatch(script, /Draw-StructuredModule[\s\S]*YOLO|Draw-StructuredModule[\s\S]*ResNet/);
});
