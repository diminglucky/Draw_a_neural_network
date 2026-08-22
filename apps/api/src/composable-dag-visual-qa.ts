import type { VisualQaCheck, VisualQaResult } from "./plan-snapshot.js";
import type { ComposableFigureComponent, ComposableFigureConnection, FigureBounds, FigurePoint } from "./composable-dag-figure-compiler.js";
import type { ComposableDagPublicationPlan } from "./composable-dag-publication-plan.js";

const MAX_DIAGNOSTIC_ID_LENGTH = 128;
const COMPONENT_KINDS = ["terminal", "operator", "merge", "attention", "repeat"] as const;
const CONNECTION_TRANSPORTS = ["data", "condition"] as const;
const COMPONENT_GRAYSCALE_PATTERNS = ["solid", "stripe", "dot", "hatch", "none"] as const;
const CONNECTION_GRAYSCALE_PATTERNS = ["solid", "dash", "dot", "double"] as const;

export function runComposableDagVisualQa(input: ComposableDagPublicationPlan): VisualQaResult {
  const checks: VisualQaCheck[] = [];
  const page = input.dagPlan.pageBounds;
  const components = input.dagPlan.components;
  const connections = input.dagPlan.connections;
  const componentById = new Map(components.map((component) => [component.id, component]));

  checks.push(check("publication-plan-version", input.version === 1 && input.qaVersion === "composable-dag-visual-qa-v1", "Publication plan and QA versions are supported."));
  checks.push(check("page-bounds", validBounds(page), "Page bounds are finite and positive."));
  checks.push(check("page-constraints", pageConstraintsValid(input), describePageConstraintFailure(input)));
  checks.push(check("component-bounds", components.every((component) => validBounds(component.bounds) && within(page, component.bounds)), describeBoundsFailure(components, page)));
  checks.push(check("component-margin", components.every((component) => hasMargin(page, component.bounds, input.visualSpec.page.minMargin)), describeMarginFailure(components, page, input.visualSpec.page.minMargin)));
  checks.push(check("component-overlap", noOverlappingComponents(components), describeOverlapFailure(components)));

  const labels = input.visualSpec.labels;
  checks.push(check("label-bounds", labels.every((label) => validBounds(label.bounds) && within(page, label.bounds)), describeLabelBoundsFailure(labels, page)));
  checks.push(check("label-margin", labels.every((label) => hasMargin(page, label.bounds, input.visualSpec.page.minMargin)), describeLabelMarginFailure(labels, page, input.visualSpec.page.minMargin)));
  checks.push(check("label-overlap", noOverlappingLabels(labels), describeLabelOverlapFailure(labels)));
  checks.push(check("label-font-size", labels.every((label) => Number.isFinite(label.fontSizePt) && label.fontSizePt >= input.visualSpec.page.minFontSizePt), "Labels meet the configured minimum font size."));

  checks.push(check("style-tokens", styleTokensValid(input), describeStyleTokenFailure(input)));
  checks.push(check("component-styles", componentStylesComplete(input), describeComponentStyleFailure(input)));
  checks.push(check("connection-styles", connectionStylesComplete(input), describeConnectionStyleFailure(input)));
  checks.push(check("style-colors", colorsValid(input), describeColorFailure(input)));
  checks.push(check("style-grayscale", grayscalePatternsValid(input), describeGrayscaleFailure(input)));
  checks.push(check("connection-style-thickness", connectionThicknessValid(input), describeConnectionThicknessFailure(input)));
  checks.push(check("style-contrast", contrastValid(input), describeContrastFailure(input)));
  checks.push(check("grayscale-collision", grayscaleSignaturesUnique(input), describeGrayscaleCollisionFailure(input)));
  checks.push(check("label-identity", labelIdentityValid(input), describeLabelIdentityFailure(input)));
  checks.push(check("label-text", labelTextValid(labels), describeLabelTextFailure(labels)));

  checks.push(check("connection-components", connections.every((connection) => componentById.has(connection.source.nodeId) && componentById.has(connection.target.nodeId)), describeConnectionComponentFailure(connections, componentById)));
  checks.push(check("connection-ports", connections.every((connection) => hasConnectionPorts(connection, componentById)), describeConnectionPortFailure(connections, componentById)));
  checks.push(check("connection-route-shape", connections.every((connection) => connection.route.length >= 2 && connection.route.every(isFinitePoint)), describeRouteShapeFailure(connections)));
  checks.push(check("connection-route-bounds", connections.every((connection) => connection.route.every((point) => withinPoint(page, point))), describeRouteBoundsFailure(connections, page)));
  checks.push(check("connection-route-endpoints", connections.every((connection) => routeTouchesComponents(connection, componentById)), describeRouteEndpointFailure(connections, componentById)));

  checks.push(check("component-evidence", components.every((component) => hasKnownEvidence(component.evidenceIds, input.evidenceIndex)), describeEvidenceFailure("component", components.filter((component) => !hasKnownEvidence(component.evidenceIds, input.evidenceIndex)).map((component) => component.id))));
  checks.push(check("connection-evidence", connections.every((connection) => hasKnownEvidence(connection.evidenceIds, input.evidenceIndex)), describeEvidenceFailure("connection", connections.filter((connection) => !hasKnownEvidence(connection.evidenceIds, input.evidenceIndex)).map((connection) => connection.id))));
  checks.push(check("source-mappings", sourceMappingsValid(input), describeSourceMappingFailure(input)));

  const blockingFailure = checks.some((item) => item.severity === "blocking" && !item.passed);
  return { status: blockingFailure ? "fail" : "pass", checks };
}

function check(id: string, passed: boolean, message: string, severity: VisualQaCheck["severity"] = "blocking"): VisualQaCheck {
  return { id, severity, passed, message };
}

function validBounds(bounds: FigureBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
}

function within(page: FigureBounds, bounds: FigureBounds): boolean {
  return bounds.x >= page.x
    && bounds.y >= page.y
    && bounds.x + bounds.width <= page.x + page.width
    && bounds.y + bounds.height <= page.y + page.height;
}

function withinPoint(page: FigureBounds, point: FigurePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= page.x
    && point.y >= page.y
    && point.x <= page.x + page.width
    && point.y <= page.y + page.height;
}

function hasMargin(page: FigureBounds, bounds: FigureBounds, margin: number): boolean {
  return Number.isFinite(margin)
    && margin >= 0
    && bounds.x >= page.x + margin
    && bounds.y >= page.y + margin
    && bounds.x + bounds.width <= page.x + page.width - margin
    && bounds.y + bounds.height <= page.y + page.height - margin;
}

function overlaps(left: FigureBounds, right: FigureBounds): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function noOverlappingComponents(components: ComposableFigureComponent[]): boolean {
  for (let left = 0; left < components.length; left += 1) {
    for (let right = left + 1; right < components.length; right += 1) {
      if (overlaps(components[left]!.bounds, components[right]!.bounds)) return false;
    }
  }
  return true;
}

function noOverlappingLabels(labels: ComposableDagPublicationPlan["visualSpec"]["labels"]): boolean {
  for (let left = 0; left < labels.length; left += 1) {
    for (let right = left + 1; right < labels.length; right += 1) {
      if (overlaps(labels[left]!.bounds, labels[right]!.bounds)) return false;
    }
  }
  return true;
}

function isFinitePoint(point: FigurePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function hasConnectionPorts(connection: ComposableFigureConnection, componentById: Map<string, ComposableFigureComponent>): boolean {
  const source = componentById.get(connection.source.nodeId);
  const target = componentById.get(connection.target.nodeId);
  return Boolean(
    source?.outputPorts.some((port) => port.id === connection.source.portId)
      && target?.inputPorts.some((port) => port.id === connection.target.portId),
  );
}

function routeTouchesComponents(connection: ComposableFigureConnection, componentById: Map<string, ComposableFigureComponent>): boolean {
  const source = componentById.get(connection.source.nodeId);
  const target = componentById.get(connection.target.nodeId);
  const first = connection.route[0];
  const last = connection.route[connection.route.length - 1];
  return Boolean(source && target && first && last && touches(source.bounds, first) && touches(target.bounds, last));
}

function touches(bounds: FigureBounds, point: FigurePoint): boolean {
  const tolerance = 0.001;
  const inHorizontal = point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance;
  const inVertical = point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance;
  const onVerticalEdge = Math.abs(point.x - bounds.x) <= tolerance || Math.abs(point.x - (bounds.x + bounds.width)) <= tolerance;
  const onHorizontalEdge = Math.abs(point.y - bounds.y) <= tolerance || Math.abs(point.y - (bounds.y + bounds.height)) <= tolerance;
  return (inHorizontal && onHorizontalEdge) || (inVertical && onVerticalEdge);
}

function hasKnownEvidence(evidenceIds: string[], evidenceIndex: ComposableDagPublicationPlan["evidenceIndex"]): boolean {
  return evidenceIds.length > 0 && evidenceIds.every((id) => Array.isArray(evidenceIndex[id]) && evidenceIndex[id]!.length > 0);
}

function styleTokensValid(input: ComposableDagPublicationPlan): boolean {
  const componentStyles = input.visualSpec.componentStyles;
  const connectionStyles = input.visualSpec.connectionStyles;
  const allowedComponentKeys = new Set<string>(COMPONENT_KINDS);
  const allowedConnectionKeys = new Set<string>(CONNECTION_TRANSPORTS);
  const componentKeysValid = Object.keys(componentStyles).every((key) => allowedComponentKeys.has(key))
    && Object.values(componentStyles).every((style) => hasExactKeys(style, ["fill", "stroke", "grayscalePattern"]));
  const connectionKeysValid = Object.keys(connectionStyles).every((key) => allowedConnectionKeys.has(key))
    && Object.values(connectionStyles).every((style) => hasExactKeys(style, ["stroke", "grayscalePattern", "thickness"]));
  return componentKeysValid && connectionKeysValid && hasExactKeys(input.visualSpec.page, ["background", "minMargin", "minFontSizePt", "minContrastRatio"]);
}

function hasExactKeys(value: object, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function componentStylesComplete(input: ComposableDagPublicationPlan): boolean {
  return input.dagPlan.components.every((component) => Boolean(input.visualSpec.componentStyles[component.kind]));
}

function connectionStylesComplete(input: ComposableDagPublicationPlan): boolean {
  return input.dagPlan.connections.every((connection) => Boolean(input.visualSpec.connectionStyles[connection.transport]));
}

function colorsValid(input: ComposableDagPublicationPlan): boolean {
  const values = [
    input.visualSpec.page.background,
    ...Object.values(input.visualSpec.componentStyles).flatMap((style) => [style.fill, style.stroke]),
    ...Object.values(input.visualSpec.connectionStyles).map((style) => style.stroke),
  ];
  return values.every(isHexColor);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}

function grayscalePatternsValid(input: ComposableDagPublicationPlan): boolean {
  return Object.values(input.visualSpec.componentStyles).every((style) => COMPONENT_GRAYSCALE_PATTERNS.includes(style.grayscalePattern as typeof COMPONENT_GRAYSCALE_PATTERNS[number]))
    && Object.values(input.visualSpec.connectionStyles).every((style) => CONNECTION_GRAYSCALE_PATTERNS.includes(style.grayscalePattern as typeof CONNECTION_GRAYSCALE_PATTERNS[number]));
}

function connectionThicknessValid(input: ComposableDagPublicationPlan): boolean {
  return Object.values(input.visualSpec.connectionStyles).every((style) => Number.isFinite(style.thickness) && style.thickness > 0 && style.thickness <= 16);
}

function contrastValid(input: ComposableDagPublicationPlan): boolean {
  const threshold = input.visualSpec.page.minContrastRatio;
  if (!Number.isFinite(threshold) || threshold < 1) return false;
  const background = input.visualSpec.page.background;
  if (!isHexColor(background)) return false;
  for (const [kind, style] of Object.entries(input.visualSpec.componentStyles)) {
    if (!isHexColor(style.fill) || !isHexColor(style.stroke)) return false;
    if (contrastRatio(background, style.stroke) < threshold || contrastRatio(style.fill, style.stroke) < threshold) return false;
    if (kind.length === 0) return false;
  }
  for (const style of Object.values(input.visualSpec.connectionStyles)) {
    if (!isHexColor(style.stroke) || contrastRatio(background, style.stroke) < threshold) return false;
  }
  return true;
}

function relativeLuminance(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const linearize = (channel: number) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function contrastRatio(first: string, second: string): number {
  const brighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (brighter + 0.05) / (darker + 0.05);
}

function grayscaleSignaturesUnique(input: ComposableDagPublicationPlan): boolean {
  const componentSignatures = Object.entries(input.visualSpec.componentStyles)
    .filter(([kind]) => input.dagPlan.components.some((component) => component.kind === kind))
    .map(([, style]) => style.grayscalePattern);
  const connectionSignatures = Object.entries(input.visualSpec.connectionStyles)
    .filter(([transport]) => input.dagPlan.connections.some((connection) => connection.transport === transport))
    .map(([transport, style]) => `${transport}:${style.grayscalePattern}:${style.thickness}`);
  return new Set(componentSignatures).size === componentSignatures.length
    && new Set(connectionSignatures).size === connectionSignatures.length;
}

function labelIdentityValid(input: ComposableDagPublicationPlan): boolean {
  const labels = input.visualSpec.labels;
  const componentIds = new Set(input.dagPlan.components.map((component) => component.id));
  const ids = labels.map((label) => label.id);
  const semanticIds = labels.map((label) => label.semanticId);
  return ids.every((id) => typeof id === "string" && id.trim().length > 0 && id.length <= MAX_DIAGNOSTIC_ID_LENGTH)
    && new Set(ids).size === ids.length
    && labels.length === componentIds.size
    && new Set(semanticIds).size === semanticIds.length
    && labels.every((label) => componentIds.has(label.semanticId))
    && [...componentIds].every((componentId) => semanticIds.includes(componentId));
}

function labelTextValid(labels: ComposableDagPublicationPlan["visualSpec"]["labels"]): boolean {
  return labels.every((label) => typeof label.text === "string"
    && label.text.trim().length > 0
    && label.text.length <= MAX_DIAGNOSTIC_ID_LENGTH
    && !/[\r\n]/.test(label.text));
}

function sourceMappingsValid(input: ComposableDagPublicationPlan): boolean {
  const componentIds = new Set(input.dagPlan.components.map((component) => component.id));
  const mappingIds = input.dagPlan.sourceMappings.map((mapping) => mapping.semanticId);
  return input.dagPlan.sourceMappings.length === input.dagPlan.components.length
    && new Set(mappingIds).size === mappingIds.length
    && input.dagPlan.sourceMappings.every((mapping) => componentIds.has(mapping.semanticId) && hasKnownEvidence(mapping.evidenceIds, input.evidenceIndex));
}

function pageConstraintsValid(input: ComposableDagPublicationPlan): boolean {
  const page = input.visualSpec.page;
  return Number.isFinite(page.minMargin)
    && page.minMargin >= 0
    && Number.isFinite(page.minFontSizePt)
    && page.minFontSizePt > 0
    && Number.isFinite(page.minContrastRatio)
    && page.minContrastRatio >= 1;
}

function describeBoundsFailure(components: ComposableFigureComponent[], page: FigureBounds): string {
  const failed = components.filter((component) => !validBounds(component.bounds) || !within(page, component.bounds)).map((component) => component.id);
  return failed.length === 0 ? "All component bounds are finite, positive, and inside the page." : `Component bounds are invalid or outside the page: ${ids(failed)}.`;
}

function describePageConstraintFailure(input: ComposableDagPublicationPlan): string {
  return pageConstraintsValid(input)
    ? "Page margin, minimum font size, and minimum contrast thresholds are valid."
    : "Page visual thresholds must be finite, non-negative, and readable.";
}

function describeMarginFailure(components: ComposableFigureComponent[], page: FigureBounds, margin: number): string {
  const failed = components.filter((component) => !hasMargin(page, component.bounds, margin)).map((component) => component.id);
  return failed.length === 0 ? "All components respect the page margin." : `Components violate the page margin: ${ids(failed)}.`;
}

function describeOverlapFailure(components: ComposableFigureComponent[]): string {
  const pairs: string[] = [];
  for (let left = 0; left < components.length; left += 1) {
    for (let right = left + 1; right < components.length; right += 1) {
      if (overlaps(components[left]!.bounds, components[right]!.bounds)) pairs.push(`${components[left]!.id}:${components[right]!.id}`);
    }
  }
  return pairs.length === 0 ? "Components do not overlap." : `Overlapping components: ${ids(pairs)}.`;
}

function describeLabelBoundsFailure(labels: ComposableDagPublicationPlan["visualSpec"]["labels"], page: FigureBounds): string {
  const failed = labels.filter((label) => !validBounds(label.bounds) || !within(page, label.bounds)).map((label) => label.id);
  return failed.length === 0 ? "All label bounds are finite, positive, and inside the page." : `Label bounds are invalid or outside the page: ${ids(failed)}.`;
}

function describeLabelMarginFailure(labels: ComposableDagPublicationPlan["visualSpec"]["labels"], page: FigureBounds, margin: number): string {
  const failed = labels.filter((label) => !hasMargin(page, label.bounds, margin)).map((label) => label.id);
  return failed.length === 0 ? "All labels respect the page margin." : `Labels violate the page margin: ${ids(failed)}.`;
}

function describeLabelOverlapFailure(labels: ComposableDagPublicationPlan["visualSpec"]["labels"]): string {
  const pairs: string[] = [];
  for (let left = 0; left < labels.length; left += 1) {
    for (let right = left + 1; right < labels.length; right += 1) {
      if (overlaps(labels[left]!.bounds, labels[right]!.bounds)) pairs.push(`${labels[left]!.id}:${labels[right]!.id}`);
    }
  }
  return pairs.length === 0 ? "Labels do not overlap." : `Overlapping labels: ${ids(pairs)}.`;
}

function describeConnectionComponentFailure(connections: ComposableFigureConnection[], componentById: Map<string, ComposableFigureComponent>): string {
  const failed = connections.filter((connection) => !componentById.has(connection.source.nodeId) || !componentById.has(connection.target.nodeId)).map((connection) => connection.id);
  return failed.length === 0 ? "All connections reference existing components." : `Connections reference missing components: ${ids(failed)}.`;
}

function describeConnectionPortFailure(connections: ComposableFigureConnection[], componentById: Map<string, ComposableFigureComponent>): string {
  const failed = connections.filter((connection) => !hasConnectionPorts(connection, componentById)).map((connection) => connection.id);
  return failed.length === 0 ? "All connections reference declared ports." : `Connections reference missing ports: ${ids(failed)}.`;
}

function describeRouteShapeFailure(connections: ComposableFigureConnection[]): string {
  const failed = connections.filter((connection) => connection.route.length < 2 || !connection.route.every(isFinitePoint)).map((connection) => connection.id);
  return failed.length === 0 ? "All routes have finite endpoints and at least two points." : `Routes have invalid point sequences: ${ids(failed)}.`;
}

function describeRouteBoundsFailure(connections: ComposableFigureConnection[], page: FigureBounds): string {
  const failed = connections.filter((connection) => !connection.route.every((point) => withinPoint(page, point))).map((connection) => connection.id);
  return failed.length === 0 ? "All route points are inside the page." : `Routes leave the page: ${ids(failed)}.`;
}

function describeRouteEndpointFailure(connections: ComposableFigureConnection[], componentById: Map<string, ComposableFigureComponent>): string {
  const failed = connections.filter((connection) => !routeTouchesComponents(connection, componentById)).map((connection) => connection.id);
  return failed.length === 0 ? "All routes touch their declared endpoint components." : `Routes have detached endpoints: ${ids(failed)}.`;
}

function describeEvidenceFailure(kind: string, failed: string[]): string {
  return failed.length === 0 ? `All ${kind} evidence mappings resolve.` : `Unresolved ${kind} evidence mappings: ${ids(failed)}.`;
}

function describeSourceMappingFailure(input: ComposableDagPublicationPlan): string {
  const expected = new Set(input.dagPlan.components.map((component) => component.id));
  const actual = new Set(input.dagPlan.sourceMappings.map((mapping) => mapping.semanticId));
  const failed = [...expected].filter((id) => !actual.has(id));
  return failed.length === 0 && input.dagPlan.sourceMappings.every((mapping) => expected.has(mapping.semanticId) && hasKnownEvidence(mapping.evidenceIds, input.evidenceIndex))
    ? "All semantic source mappings resolve to known evidence."
    : `Invalid semantic source mappings: ${ids(failed.length > 0 ? failed : [...actual])}.`;
}

function describeStyleTokenFailure(input: ComposableDagPublicationPlan): string {
  const componentKeys = Object.keys(input.visualSpec.componentStyles).filter((key) => !(COMPONENT_KINDS as readonly string[]).includes(key));
  const connectionKeys = Object.keys(input.visualSpec.connectionStyles).filter((key) => !(CONNECTION_TRANSPORTS as readonly string[]).includes(key));
  return componentKeys.length === 0 && connectionKeys.length === 0
    ? "Visual style tokens use the supported v3 vocabulary."
    : `Unsupported visual style tokens: ${ids([...componentKeys, ...connectionKeys].sort())}.`;
}

function describeComponentStyleFailure(input: ComposableDagPublicationPlan): string {
  const failed = input.dagPlan.components
    .filter((component) => !input.visualSpec.componentStyles[component.kind])
    .map((component) => component.id);
  return failed.length === 0 ? "Every component has a complete style token." : `Components have no style token: ${ids(failed)}.`;
}

function describeConnectionStyleFailure(input: ComposableDagPublicationPlan): string {
  const failed = input.dagPlan.connections
    .filter((connection) => !input.visualSpec.connectionStyles[connection.transport])
    .map((connection) => connection.id);
  return failed.length === 0 ? "Every connection has a complete style token." : `Connections have no style token: ${ids(failed)}.`;
}

function describeColorFailure(input: ComposableDagPublicationPlan): string {
  const invalid: string[] = [];
  if (!isHexColor(input.visualSpec.page.background)) invalid.push("page.background");
  for (const [kind, style] of Object.entries(input.visualSpec.componentStyles)) {
    if (!isHexColor(style.fill)) invalid.push(`${kind}.fill`);
    if (!isHexColor(style.stroke)) invalid.push(`${kind}.stroke`);
  }
  for (const [transport, style] of Object.entries(input.visualSpec.connectionStyles)) if (!isHexColor(style.stroke)) invalid.push(`${transport}.stroke`);
  return invalid.length === 0 ? "All visual colors use six-digit hexadecimal tokens." : `Invalid visual colors: ${ids(invalid)}.`;
}

function describeGrayscaleFailure(input: ComposableDagPublicationPlan): string {
  const invalid: string[] = [];
  for (const [kind, style] of Object.entries(input.visualSpec.componentStyles)) {
    if (!(COMPONENT_GRAYSCALE_PATTERNS as readonly string[]).includes(style.grayscalePattern)) invalid.push(`${kind}.grayscalePattern`);
  }
  for (const [transport, style] of Object.entries(input.visualSpec.connectionStyles)) {
    if (!(CONNECTION_GRAYSCALE_PATTERNS as readonly string[]).includes(style.grayscalePattern)) invalid.push(`${transport}.grayscalePattern`);
  }
  return invalid.length === 0 ? "All grayscale patterns use the supported vocabulary." : `Invalid grayscale patterns: ${ids(invalid)}.`;
}

function describeConnectionThicknessFailure(input: ComposableDagPublicationPlan): string {
  const invalid = Object.entries(input.visualSpec.connectionStyles)
    .filter(([, style]) => !Number.isFinite(style.thickness) || style.thickness <= 0 || style.thickness > 16)
    .map(([transport]) => transport);
  return invalid.length === 0 ? "Connection thickness values are finite and bounded." : `Invalid connection thickness: ${ids(invalid)}.`;
}

function describeContrastFailure(input: ComposableDagPublicationPlan): string {
  return contrastValid(input)
    ? "All configured fills, strokes, and connections meet the minimum contrast ratio."
    : "One or more visual style pairs do not meet the minimum contrast ratio.";
}

function describeGrayscaleCollisionFailure(input: ComposableDagPublicationPlan): string {
  const signatures = new Map<string, string[]>();
  for (const [kind, style] of Object.entries(input.visualSpec.componentStyles)) {
    if (!input.dagPlan.components.some((component) => component.kind === kind)) continue;
    const key = `component:${style.grayscalePattern}`;
    signatures.set(key, [...(signatures.get(key) ?? []), kind]);
  }
  for (const [transport, style] of Object.entries(input.visualSpec.connectionStyles)) {
    if (!input.dagPlan.connections.some((connection) => connection.transport === transport)) continue;
    const key = `connection:${style.grayscalePattern}:${style.thickness}`;
    signatures.set(key, [...(signatures.get(key) ?? []), transport]);
  }
  const collisions = [...signatures.values()].filter((values) => values.length > 1).flatMap((values) => values.sort());
  return collisions.length === 0 ? "Grayscale styles remain distinguishable by semantic kind or relation." : `Grayscale style collisions: ${ids(collisions)}.`;
}

function describeLabelIdentityFailure(input: ComposableDagPublicationPlan): string {
  const labels = input.visualSpec.labels;
  const idsSeen = new Set<string>();
  const duplicates = labels.map((label) => label.id).filter((id) => idsSeen.has(id) || (idsSeen.add(id), false));
  const complete = labels.length === input.dagPlan.components.length
    && new Set(labels.map((label) => label.semanticId)).size === labels.length
    && input.dagPlan.components.every((component) => labels.some((label) => label.semanticId === component.id));
  return duplicates.length === 0 && labelIdentityShapeValid(labels) && complete
    ? "Label IDs are unique, bounded, and map to every semantic component."
    : `Label IDs or semantic mappings are invalid: ${ids(duplicates.length > 0 ? duplicates : labels.map((label) => label.id))}.`;
}

function labelIdentityShapeValid(labels: ComposableDagPublicationPlan["visualSpec"]["labels"]): boolean {
  return labels.every((label) => typeof label.id === "string" && label.id.trim().length > 0 && label.id.length <= MAX_DIAGNOSTIC_ID_LENGTH);
}

function describeLabelTextFailure(labels: ComposableDagPublicationPlan["visualSpec"]["labels"]): string {
  const failed = labels.filter((label) => typeof label.text !== "string"
    || label.text.trim().length === 0
    || label.text.length > MAX_DIAGNOSTIC_ID_LENGTH
    || /[\r\n]/.test(label.text)).map((label) => label.id);
  return failed.length === 0 ? "Labels are non-empty, single-line, and bounded." : `Invalid label text: ${ids(failed)}.`;
}

function ids(values: string[]): string {
  return values.map((value) => value.slice(0, MAX_DIAGNOSTIC_ID_LENGTH)).join(", ");
}
