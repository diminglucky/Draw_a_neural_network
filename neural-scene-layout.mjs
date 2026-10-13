export const LAID_OUT_NEURAL_SCENE_VERSION = "laid-out-neural-scene/v1";
const VERSION = LAID_OUT_NEURAL_SCENE_VERSION;
// 间距不再是随手定的数字，而是从「盒子高」推出来的：正文标签 11 单位，
// 盒子高 32 单位（≈2.9× 字号，顶刊实测区间 1.6–3.2×），
// 列间距 ≈ 2 个盒高、行间距 ≈ 1.6 个盒高，跟 Transformer / ViT 原图的比例一致。
const GAP_X = 64;
const GAP_Y = 52;
const MARGIN = 34;

export function layoutNeuralScene(scene = {}, profiles = {}) {
  const renderingProfile = profiles.renderingProfile;
  const layoutArchetype = (renderingProfile?.constraints || [])
    .find((constraint) => constraint.kind === "layout-archetype")?.archetype || "";
  const plannedRouteClasses = new Map((renderingProfile?.constraints || [])
    .filter((constraint) => constraint.kind === "reserve-route-corridor" && constraint.edgeId)
    .map((constraint) => [String(constraint.edgeId), String(constraint.routeClass || "main-flow")]));
  const primitives = Array.isArray(scene.primitives) ? scene.primitives : [];
  const bodies = primitives.filter((primitive) => primitive.role === "body");
  // 说明文字画在所属盒子正下方（偏移 12 + 文字块自身高度）。横向排布时下方是空的，
  // 竖直堆叠时下方就是下一个盒子——行距必须把这段留出来，否则 3 行说明（41 单位）
  // 会顶进下面的盒子，直接触发 label-body-overlap。
  const verticalGap = Math.max(GAP_Y, decorationReserve(primitives) + 6);
  const bodyById = new Map(bodies.map((primitive) => [primitive.id, primitive]));
  const relations = Array.isArray(scene.relations) ? scene.relations : [];
  const layers = topologicalLayers(bodies, relations);
  const scaleRows = new Map();
  const laidBodies = [];
  const pinnedBounds = new Map();
  // 每个图元只测量一次尺寸；列宽由该列最宽的图元决定，避免张量尺寸驱动大小后
  // 与固定列距打架（宽块会盖住下一列）。
  const sizes = new Map(bodies.map((primitive) => [primitive.id, primitiveSize(primitive)]));
  const columnX = columnOffsets(layers, sizes);
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    for (let rowIndex = 0; rowIndex < layer.length; rowIndex += 1) {
      const primitive = layer[rowIndex];
      const scale = scaleKey(primitive);
      if (!scaleRows.has(scale)) scaleRows.set(scale, scaleRows.size);
      const row = scale === "unknown" ? rowIndex : scaleRows.get(scale);
      const size = sizes.get(primitive.id);
      const workspaceBounds = normalizeWorkspaceBounds(primitive.workspaceUi);
      if (workspaceBounds) pinnedBounds.set(String(primitive.id), workspaceBounds);
      laidBodies.push({
        ...primitive,
        bounds: workspaceBounds || { x: columnX[layerIndex], y: MARGIN + row * (size.h + GAP_Y), w: size.w, h: size.h },
        zIndex: 100 + layerIndex,
      });
    }
  }
  const wrapped = shouldWrapChain(layers) && applyChainWrapping(laidBodies, layers);
  if (!wrapped) {
    centerLayersVertically(laidBodies, layers);
    if (!renderingProfile || (renderingProfile.constraints || []).some((constraint) => constraint.kind === "align-scale-centerlines")) {
      alignSharedScaleCenters(laidBodies, layers);
    }
  }
  // 先让 blockKind / fusion / component pass 完成局部排布，再应用家族级宏观原型。
  // 若把 U-Net / Transformer 原型放在这些 pass 之前，后续通用规则会把三列拓扑改回多列顺序流。
  applyBlockKindArchetype(laidBodies);
  applyTransformerBlockStack(laidBodies, relations, layoutArchetype);
  applyFusionBranchLanes(laidBodies, relations);
  separateDisconnectedComponents(laidBodies, relations);
  // U 形是「编码器向下、解码器向上」，解码器列从底部往上排。
  // 解码器比编码器多时列顶会冲出页面上边界（y < 0），整张图被判 primitive-out-of-page。
  // 这里整体下移保证最小 y 不小于 MARGIN——只挪原点，不改形状。
  // 用户在工作区里钉住坐标的图元不参与，免得把手工摆放的位置挪走。
  const shiftable = laidBodies.filter((body) => !pinnedBounds.has(String(body.id)));
  const minY = shiftable.length ? Math.min(...shiftable.map((body) => body.bounds.y)) : MARGIN;
  if (Number.isFinite(minY) && minY < MARGIN) {
    const delta = MARGIN - minY;
    for (const body of shiftable) body.bounds = { ...body.bounds, y: body.bounds.y + delta };
  }
  const bodyPosition = new Map(laidBodies.map((primitive) => [primitive.id, primitive]));
  let groups = placeGroups(scene.groups || [], bodyPosition);
  if ((scene.groups || []).some((group) => ["horizontal", "vertical"].includes(group.direction))) {
    arrangeTopLevelUnits(groups, bodyPosition, relations);
  }
  // 架构原型必须是最后一个自动排布 pass；否则 top-level group 再把 U 型拆成多列。
  const archetypeApplied = applyLayoutArchetype(laidBodies, renderingProfile, verticalGap, relations);
  for (const primitive of laidBodies) {
    const pinned = pinnedBounds.get(String(primitive.id));
    if (pinned) primitive.bounds = { ...pinned };
  }
  // 架构原型可能移动了图元，只重算组框；不能再次调用 placeGroups（它会重新摆放组成员）。
  if (archetypeApplied) groups = measureGroupBounds(scene.groups || [], bodyPosition);
  const constraintDiagnostics = applySceneConstraints(bodyPosition, scene.constraints || []);
  const positionedBodies = [...bodyPosition.values()];
  const directionByPrimitive = groupDirections(scene.groups || []);
  const laidPrimitives = positionedBodies.map((primitive) => ({
    ...primitive,
    anchors: anchorsFor(primitive, directionByPrimitive.get(primitive.id) || "horizontal"),
  }));
  const bodyByProjection = new Map(positionedBodies.map((primitive) => [String(primitive.projectionId || ""), primitive]));
  const bodyBySourceNode = new Map();
  for (const body of positionedBodies) {
    for (const sourceNodeId of body.sourceNodeIds || []) bodyBySourceNode.set(String(sourceNodeId), body);
  }
  for (const primitive of primitives.filter((item) => item.role !== "body")) {
    const owner = bodyByProjection.get(String(primitive.projectionId || ""))
      || bodyBySourceNode.get(String(primitive.sourceNodeIds?.[0] || ""));
    if (!owner) continue;
    // 说明文字的高度必须由「有几行字」决定，不能跟着所属盒子的高度走。
    // 旧实现写死 34，盒子压扁之后说明块跟盒子一样高，正好顶进下一行的盒子里，
    // 触发 label-body-overlap。
    const labelLines = Math.max(1, (primitive.labels || []).filter(Boolean).length);
    const decorationHeight = Math.max(15, labelLines * 13 + 2);
    laidPrimitives.push({ ...primitive, bounds: { x: owner.bounds.x, y: owner.bounds.y + owner.bounds.h + 12, w: owner.bounds.w, h: decorationHeight }, anchors: { inputs: [], outputs: [] }, zIndex: owner.zIndex + 10 });
  }
  const visualBounds = [...laidPrimitives.map((primitive) => primitive.bounds), ...groups.map((group) => group.bounds)];
  const maxX = Math.max(...visualBounds.map((bounds) => bounds.x + bounds.w), MARGIN);
  const maxY = Math.max(...visualBounds.map((bounds) => bounds.y + bounds.h), MARGIN);
  const page = { x: 0, y: 0, width: maxX + MARGIN, height: maxY + MARGIN };
  const connectors = [];
  const primitiveById = new Map(laidPrimitives.map((primitive) => [primitive.id, primitive]));
  for (const relation of relations) connectors.push(routeRelation(
    relation,
    primitiveById,
    laidPrimitives,
    connectors,
    plannedRouteClasses.get(String((relation.sourceEdgeIds || [])[0] || "")),
  ));
  const diagnostics = [...(scene.diagnostics || [])];
  diagnostics.push(...constraintDiagnostics);
  for (const relation of relations) if (relation.relationTags?.includes("crossScale")) diagnostics.push({ code: "cross-scale-transfer", relationId: relation.id, severity: "warning" });
  const maxPrimitives = Number.isFinite(profiles.maxPrimitives) ? profiles.maxPrimitives : Infinity;
  if (laidPrimitives.length > maxPrimitives) diagnostics.push({ code: "layout-budget-exceeded", primitiveCount: laidPrimitives.length, budget: maxPrimitives, severity: "warning" });
  const visualQuality = analyzeVisualQuality(laidPrimitives, connectors, page, profiles.visualQualityThresholds || {});
  diagnostics.push(...visualQuality.diagnostics);
  const result = { version: VERSION, units: "layout-unit", ...(layoutArchetype ? { layoutArchetype } : {}), primitives: laidPrimitives.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)), connectors, groups, page, diagnostics, visualQuality: visualQuality.metrics, softScore: scoreLayout(positionedBodies, connectors) };
  return result;
}

function applySceneConstraints(bodyPosition, constraints) {
  const diagnostics = [];
  for (const constraint of constraints) {
    if (constraint.kind !== "center-y-between") continue;
    const target = bodyPosition.get(String(constraint.targetPrimitiveId || ""));
    const members = (constraint.memberPrimitiveIds || [])
      .map((primitiveId) => bodyPosition.get(String(primitiveId)))
      .filter(Boolean);
    if (!target || members.length < 2) {
      diagnostics.push({ code: "constraint-target-missing", constraintId: constraint.id, severity: "warning" });
      continue;
    }
    const centers = members.map((primitive) => primitive.bounds.y + primitive.bounds.h / 2);
    const desiredY = (Math.min(...centers) + Math.max(...centers)) / 2 - target.bounds.h / 2;
    const previousY = target.bounds.y;
    target.bounds = { ...target.bounds, y: desiredY };
    if (overlapsAny(target, bodyPosition.values())) {
      target.bounds = { ...target.bounds, y: previousY };
      diagnostics.push({ code: "constraint-skipped-overlap", constraintId: constraint.id, severity: "warning" });
    }
  }
  return diagnostics;
}

function overlapsAny(target, bodies) {
  for (const body of bodies) {
    if (body.id === target.id) continue;
    if (overlaps(target.bounds, body.bounds)) return true;
  }
  return false;
}

function centerLayersVertically(laidBodies, layers) {
  if (!laidBodies.length) return;
  const bodyById = new Map(laidBodies.map((body) => [body.id, body]));
  const bottom = Math.max(...laidBodies.map((body) => body.bounds.y + body.bounds.h));
  const centerY = MARGIN + (bottom - MARGIN) / 2;
  for (const layer of layers) {
    const bodies = layer.map((body) => bodyById.get(body.id)).filter(Boolean);
    if (!bodies.length) continue;
    const top = Math.min(...bodies.map((body) => body.bounds.y));
    const layerBottom = Math.max(...bodies.map((body) => body.bounds.y + body.bounds.h));
    const delta = centerY - (top + layerBottom) / 2;
    for (const body of bodies) body.bounds = { ...body.bounds, y: body.bounds.y + delta };
  }
}

function alignSharedScaleCenters(laidBodies, layers) {
  const groups = new Map();
  for (const body of laidBodies) {
    const scale = scaleKey(body);
    if (scale === "unknown") continue;
    if (!groups.has(scale)) groups.set(scale, []);
    groups.get(scale).push(body);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const targetCenter = group.reduce((sum, body) => sum + body.bounds.y + body.bounds.h / 2, 0) / group.length;
    const previous = group.map((body) => ({ body, y: body.bounds.y }));
    for (const body of group) body.bounds = { ...body.bounds, y: targetCenter - body.bounds.h / 2 };
    if (laidBodies.some((first, index) => laidBodies.slice(index + 1).some((second) => overlaps(first.bounds, second.bounds)))) {
      for (const item of previous) item.body.bounds = { ...item.body.bounds, y: item.y };
    }
  }
}

// 每种架构家族对应一套「整张图怎么摆」的排布引擎。识别层（architecture-family.mjs）
// 已经把网络判成六个家族之一，这里负责把家族翻译成几何：
//   cnn-tower        —— VGG：按池化切阶段，阶段成列、基线对齐，特征图逐级收窄成塔
//   residual-tower   —— ResNet：按降采样切阶段，阶段成列、顶端对齐
//   transformer-stack—— ViT：同构块竖直堆叠（顶刊 Transformer 的标准画法）
//   detection-pyramid—— YOLO：骨干 → 金字塔颈 → 多尺度头竖排成金字塔
//   encoder-decoder-u—— U-Net：U 形
// 任何一套排完只要产生重叠就整体回退到顺序流——宁可画得平庸，也不能画出叠在一起的图。
const ARCHETYPE_PLACERS = {
  "encoder-decoder-u": placeEncoderDecoderU,
  "cnn-tower": placeCnnTower,
  "residual-tower": placeResidualTower,
  "transformer-stack": placeTransformerStack,
  "detection-pyramid": placeDetectionPyramid,
};

function applyLayoutArchetype(laidBodies, renderingProfile, gapY = GAP_Y, relations = []) {
  const archetype = (renderingProfile?.constraints || [])
    .find((constraint) => constraint.kind === "layout-archetype")?.archetype;
  const place = ARCHETYPE_PLACERS[archetype];
  if (!place || laidBodies.length < 3) return false;
  const snapshot = laidBodies.map((body) => ({ ...body.bounds }));
  const hadOverlap = anyBodiesOverlap(laidBodies);
  const applied = place(laidBodies, gapY, relations);
  if (!applied) return false;
  if (!hadOverlap && anyBodiesOverlap(laidBodies)) {
    laidBodies.forEach((body, index) => { body.bounds = snapshot[index]; });
    return false;
  }
  return true;
}

// 说明文字块需要的垂直空间：LABEL_OFFSET(12) + 行数×13 + 2，与下方摆放装饰图元时一致。
function decorationReserve(primitives) {
  let reserve = 0;
  for (const primitive of primitives) {
    if (primitive.role === "body") continue;
    const lines = Math.max(1, (primitive.labels || []).filter(Boolean).length);
    reserve = Math.max(reserve, 12 + Math.max(15, lines * 13 + 2));
  }
  return reserve;
}

function anyBodiesOverlap(bodies) {
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      if (overlaps(bodies[i].bounds, bodies[j].bounds)) return true;
    }
  }
  return false;
}

function orderByFlow(bodies) {
  return [...bodies].sort((left, right) => left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y);
}

function isReduce(body) {
  return body.data?.scaleChange === "reduce" || (body.semanticTags || []).includes("reduce");
}

function isExpand(body) {
  return body.data?.scaleChange === "expand" || (body.semanticTags || []).includes("expand");
}

// 按降采样算子切阶段：每个池化收尾一段，这正是 VGG/ResNet 里「stage」的定义。
function splitAtDownsample(ordered) {
  const stages = [];
  let current = [];
  for (const body of ordered) {
    current.push(body);
    if (isReduce(body)) { stages.push(current); current = []; }
  }
  if (current.length) stages.push(current);
  return stages;
}

// 阶段太多时逐段折成多列，避免单列几千像素高。
function stageColumns(ordered, limit = MAX_COLUMN_BODIES) {
  const columns = [];
  for (const stage of splitAtDownsample(ordered)) {
    for (const chunk of balancedChunks(stage, limit)) columns.push(chunk);
  }
  return columns;
}

function placeColumns(columns, { align, gapY = GAP_Y }) {
  const heights = columns.map((column) => column.reduce((sum, body) => sum + body.bounds.h, 0)
    + gapY * Math.max(0, column.length - 1));
  const tallest = Math.max(...heights);
  let cursorX = MARGIN;
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    const width = Math.max(...column.map((body) => body.bounds.w));
    // bottom：所有列共用同一条基线，越靠后的阶段盒子越矮，顶边逐级下沉 → 收窄的塔
    // top   ：所有列从同一条顶边往下堆，读作「同构阶段的并列堆叠」
    const cursorY = align === "bottom" ? MARGIN + tallest - heights[index] : MARGIN;
    let y = cursorY;
    for (const body of column) {
      body.bounds = { ...body.bounds, x: cursorX, y };
      y += body.bounds.h + gapY;
    }
    cursorX += width + GAP_X;
  }
}

function placeCnnTower(laidBodies, gapY) {
  const columns = stageColumns(orderByFlow(laidBodies));
  if (columns.length < 2) return false;
  placeColumns(columns, { align: "bottom", gapY });
  return true;
}

function placeResidualTower(laidBodies, gapY) {
  const columns = stageColumns(orderByFlow(laidBodies));
  if (columns.length < 2) return false;
  placeColumns(columns, { align: "top", gapY });
  return true;
}

// Transformer 的标准画法是一摞同构块，而不是横向铺开的一条链。
function placeTransformerStack(laidBodies, gapY) {
  const ordered = orderByFlow(laidBodies);
  placeColumns(balancedChunks(ordered, MAX_COLUMN_BODIES), { align: "top", gapY });
  return true;
}

// YOLO：骨干 → 金字塔颈(FPN/PANet) → 多尺度检测头。
// 关键约束是「数据只能从左到右」：颈里的 PAN 之类的节点在拓扑上晚于骨干，
// 单纯按角色分组会把它们放到骨干左边，直接触发 dag-direction-violation。
// 所以先按角色给每个节点一个期望列号，再沿拓扑序取运行最大值（单调化），
// 得到一组既保住语义分列、又保证任何边的目标列不小于源列的列号。
function placeDetectionPyramid(laidBodies, gapY, relations = []) {
  const order = topologicalLayers(laidBodies, relations).flat();
  if (!order.length) return false;
  const heads = new Set(order.filter((body) => body.blockKind === "detection-head"
    || (body.sourceFamilies || []).includes("output")));
  if (!heads.size) return false;
  const fusions = new Set(order.filter((body) => body.blockKind === "multi-scale-fusion"));
  const roleColumn = (body) => (heads.has(body) ? 2 : fusions.has(body) ? 1 : 0);

  const columnOf = new Map();
  let running = 0;
  for (const body of order) {
    running = Math.max(running, roleColumn(body));
    columnOf.set(String(body.id), running);
  }

  const grouped = new Map();
  for (const body of order) {
    const column = columnOf.get(String(body.id));
    if (!grouped.has(column)) grouped.set(column, []);
    grouped.get(column).push(body);
  }
  // 检测头按空间尺寸升序（粗粒度小图在上、细粒度大图在下），读出来就是金字塔；
  // 它们都落在最后一列，列内排序不影响方向约束。
  const columns = [];
  for (const column of [...grouped.keys()].sort((left, right) => left - right)) {
    const group = grouped.get(column);
    if (column === 2) group.sort((left, right) => spatialSideOf(left) - spatialSideOf(right));
    for (const chunk of balancedChunks(group, MAX_COLUMN_BODIES)) columns.push(chunk);
  }
  placeColumns(columns, { align: "top", gapY });
  return true;
}

// NCHW / NHWC 都用最后一维当空间边长；拿不到形状时按 0 处理，保持原顺序。
function spatialSideOf(body) {
  const shape = body.data?.tensorShape;
  if (!Array.isArray(shape) || shape.length < 3) return 0;
  const last = Number(shape[shape.length - 1]);
  return Number.isFinite(last) ? last : 0;
}

function placeEncoderDecoderU(laidBodies, gapY = GAP_Y) {
  const ordered = orderByFlow(laidBodies);
  // 真实 block IR 会给 U-Net 的 encoder/decoder 阶段明确打标签。
  // 先用这些语义标签分列，不能按“第一个 pool 到第一个 up”切片：多级 U-Net
  // 有多个 pool/upsample，旧切法把后续编码器误塞进瓶颈，还把右侧拆成多列。
  const explicitEncoder = ordered.filter((body) => body.blockKind === "encoder-stage");
  const explicitDecoder = ordered.filter((body) => body.blockKind === "decoder-stage");
  const explicitInputs = ordered.filter((body) => (body.sourceFamilies || []).includes("input")
    && !explicitEncoder.includes(body) && !explicitDecoder.includes(body));
  const explicitOutputs = ordered.filter((body) => (body.sourceFamilies || []).includes("output")
    || body.blockKind === "detection-head");
  const explicitMiddle = ordered.filter((body) => !explicitEncoder.includes(body)
    && !explicitDecoder.includes(body) && !explicitInputs.includes(body) && !explicitOutputs.includes(body));

  let inputBodies;
  let encoder;
  let bottleneck;
  let decoder;
  let outputBodies;
  if (explicitEncoder.length && explicitDecoder.length) {
    inputBodies = explicitInputs;
    encoder = explicitEncoder;
    bottleneck = explicitMiddle;
    decoder = explicitDecoder.filter((body) => !explicitOutputs.includes(body));
    outputBodies = explicitOutputs;
  } else {
    const firstExpand = ordered.findIndex(isExpand);
    if (firstExpand < 0) return false;
    // 编码器一路可能有多个池化层；U 底部取上采样开始前最后一次下采样。
    let lastReduce = -1;
    for (let index = 0; index < firstExpand; index += 1) if (isReduce(ordered[index])) lastReduce = index;
    if (lastReduce < 0) return false;
    inputBodies = [];
    encoder = ordered.slice(0, lastReduce + 1);
    bottleneck = ordered.slice(lastReduce + 1, firstExpand);
    decoder = ordered.slice(firstExpand);
    outputBodies = [];
  }

  const groups = [inputBodies, encoder, bottleneck, decoder, outputBodies];
  if (!groups.some((group) => group.length)) return false;
  const widths = groups.map((group) => group.length ? Math.max(...group.map((body) => body.bounds.w)) : 0);
  const xOffsets = [];
  let x = MARGIN;
  for (let index = 0; index < groups.length; index += 1) {
    xOffsets[index] = x;
    if (widths[index]) x += widths[index] + GAP_X;
  }
  // 同列统一左对齐：按列宽居中会让同列内各图元错开几个像素，
  // 把「数据只能从左到右」的方向校验误判成违规（项目既有约定）。
  const columnX = (groupIndex) => xOffsets[groupIndex];
  const boxHeight = (group) => group.reduce((sum, body) => sum + body.bounds.h, 0);
  const minimumColumnHeight = (group) => boxHeight(group) + gapY * Math.max(0, group.length - 1);
  // 所有列都参与取最大高度：只按两条臂算的话，中间列（瓶颈）比臂高时
  // 底部锚点会把它推到页面上边界之外（diffusion-unet 的 primitive-out-of-page 就是这么来的）。
  const armHeight = Math.max(...groups.map(minimumColumnHeight), 0);
  const baseline = MARGIN + armHeight;
  const placeDown = (group, columnIndex, totalHeight = armHeight) => {
    if (!group.length) return;
    const gap = group.length > 1 ? Math.max(gapY, (totalHeight - boxHeight(group)) / (group.length - 1)) : 0;
    let y = MARGIN;
    for (const body of group) {
      body.bounds = { ...body.bounds, x: columnX(columnIndex), y };
      y += body.bounds.h + gap;
    }
  };
  const placeUp = (group, columnIndex, totalHeight = armHeight) => {
    if (!group.length) return;
    const gap = group.length > 1 ? Math.max(gapY, (totalHeight - boxHeight(group)) / (group.length - 1)) : 0;
    let y = baseline;
    for (const body of group) {
      y -= body.bounds.h;
      body.bounds = { ...body.bounds, x: columnX(columnIndex), y };
      y -= gap;
    }
  };
  placeDown(inputBodies, 0);
  placeDown(encoder, 1);
  const bottleneckHeight = minimumColumnHeight(bottleneck);
  let cursorY = baseline - bottleneckHeight;
  for (const body of bottleneck) {
    body.bounds = { ...body.bounds, x: columnX(2), y: cursorY };
    cursorY += body.bounds.h + gapY;
  }
  // U 的右臂按“从底部向上”排：第一层上采样靠近瓶颈，输出端回到顶部。
  placeUp(decoder, 3);
  placeDown(outputBodies, 4);
  return true;
}

function analyzeVisualQuality(primitives, connectors, page, thresholdInput = {}) {
  const bodies = primitives.filter((primitive) => primitive.role === "body");
  const decorations = primitives.filter((primitive) => primitive.role === "decoration");
  const diagnostics = [];
  let labelOverlapCount = 0;
  for (let i = 0; i < decorations.length; i += 1) {
    for (let j = i + 1; j < decorations.length; j += 1) {
      if (overlaps(decorations[i].bounds, decorations[j].bounds)) labelOverlapCount += 1;
    }
  }
  let labelBodyOverlapCount = 0;
  for (const decoration of decorations) {
    for (const body of bodies) {
      if (!overlaps(decoration.bounds, body.bounds)) continue;
      if ((decoration.sourceNodeIds || []).some((id) => (body.sourceNodeIds || []).includes(String(id)))) continue;
      labelBodyOverlapCount += 1;
    }
  }
  let connectorBodyIntersectionCount = 0;
  for (const connector of connectors) {
    for (const body of bodies) {
      if (body.id === connector.sourcePrimitiveId || body.id === connector.targetPrimitiveId) continue;
      if (pathIntersectsRectInterior(connector.points, body.bounds)) connectorBodyIntersectionCount += 1;
    }
  }
  const pageArea = Math.max(1, Number(page?.width || 0) * Number(page?.height || 0));
  const bodyArea = bodies.reduce((sum, body) => sum + Math.max(0, body.bounds.w * body.bounds.h), 0);
  const whitespaceRatio = Math.max(0, Math.min(1, 1 - bodyArea / pageArea));
  const blockBodies = bodies.filter((body) => body.blockKind);
  const blockBadgeMissingCount = blockBodies.filter((body) => !body.blockBadge).length;
  const blockPortMissingCount = blockBodies.filter((body) => {
    const inputs = Array.isArray(body.ports?.inputs) ? body.ports.inputs : [];
    const outputs = Array.isArray(body.ports?.outputs) ? body.ports.outputs : [];
    return inputs.length === 0 && outputs.length === 0;
  }).length;
  const blockOverlayExpectedCount = blockBodies.filter((body) => ["residual-block", "recurrent-cell", "moe-block", "graph-block"].includes(String(body.blockKind))).length;
  const thresholds = {
    maxLabelOverlapCount: Number.isFinite(thresholdInput.maxLabelOverlapCount) ? thresholdInput.maxLabelOverlapCount : 0,
    maxLabelBodyOverlapCount: Number.isFinite(thresholdInput.maxLabelBodyOverlapCount) ? thresholdInput.maxLabelBodyOverlapCount : 0,
    maxConnectorBodyIntersectionCount: Number.isFinite(thresholdInput.maxConnectorBodyIntersectionCount) ? thresholdInput.maxConnectorBodyIntersectionCount : 0,
    maxBlockBadgeMissingCount: Number.isFinite(thresholdInput.maxBlockBadgeMissingCount) ? thresholdInput.maxBlockBadgeMissingCount : 0,
    maxBlockPortMissingCount: Number.isFinite(thresholdInput.maxBlockPortMissingCount) ? thresholdInput.maxBlockPortMissingCount : 0,
  };
  if (labelOverlapCount > thresholds.maxLabelOverlapCount) diagnostics.push({ code: "label-overlap", severity: "warning", count: labelOverlapCount, threshold: thresholds.maxLabelOverlapCount });
  if (labelBodyOverlapCount > thresholds.maxLabelBodyOverlapCount) diagnostics.push({ code: "label-body-overlap", severity: "warning", count: labelBodyOverlapCount, threshold: thresholds.maxLabelBodyOverlapCount });
  if (connectorBodyIntersectionCount > thresholds.maxConnectorBodyIntersectionCount) diagnostics.push({ code: "connector-body-intersection", severity: "error", count: connectorBodyIntersectionCount, threshold: thresholds.maxConnectorBodyIntersectionCount });
  if (blockBadgeMissingCount > thresholds.maxBlockBadgeMissingCount) diagnostics.push({ code: "block-badge-missing", severity: "warning", count: blockBadgeMissingCount, threshold: thresholds.maxBlockBadgeMissingCount });
  if (blockPortMissingCount > thresholds.maxBlockPortMissingCount) diagnostics.push({ code: "block-port-missing", severity: "warning", count: blockPortMissingCount, threshold: thresholds.maxBlockPortMissingCount });
  return {
    metrics: {
      labelOverlapCount,
      labelBodyOverlapCount,
      connectorBodyIntersectionCount,
      whitespaceRatio,
      bodyCount: bodies.length,
      decorationCount: decorations.length,
      connectorCount: connectors.length,
      blockPrimitiveCount: blockBodies.length,
      blockBadgeMissingCount,
      blockPortMissingCount,
      blockOverlayExpectedCount,
      thresholds,
    },
    diagnostics,
  };
}

export function validateLaidOutScene(layout = {}, sourceScene = {}) {
  const issues = [];
  if (layout.version !== VERSION || layout.units !== "layout-unit") issues.push({ code: "invalid-laid-out-scene-version" });
  const primitiveIds = new Set();
  for (const primitive of layout.primitives || []) {
    const primitiveId = String(primitive?.id || "");
    if (!primitiveId) issues.push({ code: "missing-laid-out-primitive-id" });
    else if (primitiveIds.has(primitiveId)) issues.push({ code: "duplicate-laid-out-primitive", primitiveId });
    else primitiveIds.add(primitiveId);
  }
  if (Array.isArray(sourceScene.primitives)) {
    for (const sourcePrimitive of sourceScene.primitives) {
      const primitiveId = String(sourcePrimitive?.id || "");
      if (primitiveId && !primitiveIds.has(primitiveId)) issues.push({ code: "missing-laid-out-primitive", primitiveId });
    }
  }
  const connectorIds = new Set((layout.connectors || []).map((connector) => String(connector?.id || "")).filter(Boolean));
  if (Array.isArray(sourceScene.relations)) {
    for (const sourceRelation of sourceScene.relations) {
      const relationId = String(sourceRelation?.id || "");
      if (relationId && !connectorIds.has(relationId)) issues.push({ code: "missing-laid-out-connector", relationId });
    }
  }
  const bodies = (layout.primitives || []).filter((primitive) => primitive.role === "body");
  for (const primitive of layout.primitives || []) {
    if (!validBounds(primitive.bounds) || !insidePage(primitive.bounds, layout.page)) issues.push({ code: "primitive-out-of-page", primitiveId: primitive.id });
    if (primitive.role === "body" && (!primitive.anchors || !Array.isArray(primitive.anchors.inputs) || !Array.isArray(primitive.anchors.outputs))) issues.push({ code: "missing-primitive-anchors", primitiveId: primitive.id });
  }
  for (let i = 0; i < bodies.length; i += 1) for (let j = i + 1; j < bodies.length; j += 1) if (overlaps(bodies[i].bounds, bodies[j].bounds)) issues.push({ code: "body-overlap", first: bodies[i].id, second: bodies[j].id });
  for (const connector of layout.connectors || []) if (!Array.isArray(connector.points) || connector.points.length < 2 || !connector.sourcePrimitiveId || !connector.targetPrimitiveId) issues.push({ code: "invalid-connector-route", relationId: connector.id });
  const primitiveById = new Map((layout.primitives || []).map((primitive) => [primitive.id, primitive]));
  for (const connector of layout.connectors || []) {
    if (!Array.isArray(connector.points) || connector.points.length < 2) continue;
    for (const body of bodies) {
      if (body.id === connector.sourcePrimitiveId || body.id === connector.targetPrimitiveId) continue;
      if (pathIntersectsRectInterior(connector.points, body.bounds)) issues.push({ code: "connector-body-intersection", relationId: connector.id, primitiveId: body.id });
    }
    validateConnectorPort(connector, "source", connector.sourcePortId, primitiveById, issues);
    validateConnectorPort(connector, "target", connector.targetPortId, primitiveById, issues);
  }
  for (const group of layout.groups || []) {
    if (!validBounds(group.bounds) || !insidePage(group.bounds, layout.page)) issues.push({ code: "group-out-of-page", groupId: group.id });
    for (const primitiveId of group.primitiveIds || []) {
      const member = primitiveById.get(primitiveId);
      if (!member) issues.push({ code: "missing-group-primitive", groupId: group.id, primitiveId });
      else if (!contains(group.bounds, member.bounds)) issues.push({ code: "group-containment-violation", groupId: group.id, primitiveId });
    }
  }
  const groupById = new Map((layout.groups || []).map((group) => [group.id, group]));
  for (const group of layout.groups || []) {
    if (!group.parentId) continue;
    const parent = groupById.get(group.parentId);
    if (!parent) issues.push({ code: "missing-parent-group", groupId: group.id, parentId: group.parentId });
    else if (!contains(parent.bounds, group.bounds)) issues.push({ code: "group-parent-containment-violation", groupId: group.id, parentId: group.parentId });
  }
  const positions = new Map(bodies.map((primitive) => [primitive.id, primitive.bounds]));
  const allowEncoderDecoderReflow = layout.layoutArchetype === "encoder-decoder-u";
  for (const connector of layout.connectors || []) {
    const source = positions.get(connector.sourcePrimitiveId);
    const target = positions.get(connector.targetPrimitiveId);
    if (!allowEncoderDecoderReflow && source && target && connector.relationTags?.includes("data") && target.x < source.x) {
      issues.push({ code: "dag-direction-violation", relationId: connector.id });
    }
  }
  return { ok: issues.length === 0, issues, summary: { primitiveCount: layout.primitives?.length || 0, connectorCount: layout.connectors?.length || 0 } };
}

function placeGroups(sourceGroups, bodyPosition) {
  if (!sourceGroups.length) return [];
  const hasPlacementIntent = sourceGroups.some((group) => group.direction === "horizontal" || group.direction === "vertical");
  if (!hasPlacementIntent) return measureGroupBounds(sourceGroups, bodyPosition);
  const definitions = sourceGroups.map((group) => ({
    id: String(group.id),
    parentId: group.parentId ? String(group.parentId) : "",
    primitiveIds: [...(group.primitiveIds || [])],
    role: String(group.role || "module"),
    label: String(group.label || group.id || ""),
    direction: group.direction === "vertical" ? "vertical" : "horizontal",
    padding: finiteNonNegative(group.padding, 24),
    gap: finiteNonNegative(group.gap, 32),
  }));
  const byId = new Map(definitions.map((group) => [group.id, group]));
  const childrenByParent = new Map(definitions.map((group) => [group.id, []]));
  for (const group of definitions) if (byId.has(group.parentId)) childrenByParent.get(group.parentId).push(group.id);
  const measurements = new Map();
  const visiting = new Set();
  const measure = (group) => {
    if (measurements.has(group.id)) return measurements.get(group.id);
    if (visiting.has(group.id)) return { w: group.padding * 2, h: group.padding * 2, items: [] };
    visiting.add(group.id);
    const childIds = childrenByParent.get(group.id) || [];
    const childPrimitiveIds = new Set(childIds.flatMap((id) => byId.get(id).primitiveIds));
    const directPrimitiveIds = group.primitiveIds.filter((id) => bodyPosition.has(id) && !childPrimitiveIds.has(id));
    const items = [
      ...directPrimitiveIds.map((id) => ({ kind: "body", id, ...bodyPosition.get(id).bounds })),
      ...childIds.map((id) => ({ kind: "group", id, ...measure(byId.get(id)) })),
    ];
    visiting.delete(group.id);
    const primary = items.reduce((sum, item) => sum + (group.direction === "horizontal" ? item.w : item.h), 0)
      + Math.max(0, items.length - 1) * group.gap;
    const cross = items.reduce((max, item) => Math.max(max, group.direction === "horizontal" ? item.h : item.w), 0);
    const measured = {
      w: group.padding * 2 + (group.direction === "horizontal" ? primary : cross),
      h: group.padding * 2 + (group.direction === "horizontal" ? cross : primary),
      items,
    };
    measurements.set(group.id, measured);
    return measured;
  };
  const boundsById = new Map();
  const place = (group, x, y) => {
    const measured = measure(group);
    const bounds = { x, y, w: measured.w, h: measured.h };
    boundsById.set(group.id, bounds);
    let cursor = group.direction === "horizontal" ? x + group.padding : y + group.padding;
    for (const item of measured.items) {
      const itemX = group.direction === "horizontal" ? cursor : x + group.padding;
      const itemY = group.direction === "horizontal" ? y + group.padding : cursor;
      if (item.kind === "group") place(byId.get(item.id), itemX, itemY);
      else {
        const body = bodyPosition.get(item.id);
        body.bounds = { ...body.bounds, x: itemX, y: itemY };
      }
      cursor += (group.direction === "horizontal" ? item.w : item.h) + group.gap;
    }
  };
  let rootX = MARGIN;
  for (const root of definitions.filter((group) => !byId.has(group.parentId))) {
    place(root, rootX, MARGIN);
    rootX += measure(root).w + 48;
  }
  return definitions.map((group) => ({ ...group, bounds: boundsById.get(group.id) || { x: MARGIN, y: MARGIN, w: 0, h: 0 } }));
}

function groupDirections(groups = []) {
  const directions = new Map();
  for (const group of groups) {
    const direction = group.direction === "vertical" ? "vertical" : "horizontal";
    for (const primitiveId of group.primitiveIds || []) {
      const id = String(primitiveId);
      if (direction === "vertical" || !directions.has(id)) directions.set(id, direction);
    }
  }
  return directions;
}

function measureGroupBounds(sourceGroups, bodyPosition) {
  const definitions = sourceGroups.map((group) => ({
    ...group,
    id: String(group.id),
    parentId: group.parentId ? String(group.parentId) : "",
    primitiveIds: [...(group.primitiveIds || [])],
  }));
  const byId = new Map(definitions.map((group) => [group.id, group]));
  const childrenByParent = new Map(definitions.map((group) => [group.id, []]));
  for (const group of definitions) if (byId.has(group.parentId)) childrenByParent.get(group.parentId).push(group.id);
  const measured = new Map();
  const measure = (group, visiting = new Set()) => {
    if (measured.has(group.id)) return measured.get(group.id);
    if (visiting.has(group.id)) return { x: MARGIN, y: MARGIN, w: 48, h: 48 };
    const next = new Set(visiting).add(group.id);
    const boxes = group.primitiveIds.map((id) => bodyPosition.get(id)?.bounds).filter(Boolean);
    for (const childId of childrenByParent.get(group.id) || []) boxes.push(measure(byId.get(childId), next));
    const padding = 24;
    const bounds = boxes.length ? boundingBox(boxes, padding) : { x: MARGIN, y: MARGIN, w: 48, h: 48 };
    measured.set(group.id, bounds);
    return bounds;
  };
  return definitions.map((group) => ({ ...group, bounds: measure(group) }));
}

function boundingBox(boxes, padding) {
  const minX = Math.max(0, Math.min(...boxes.map((box) => box.x)) - padding);
  const minY = Math.max(0, Math.min(...boxes.map((box) => box.y)) - padding);
  const maxX = Math.max(...boxes.map((box) => box.x + box.w)) + padding;
  const maxY = Math.max(...boxes.map((box) => box.y + box.h)) + padding;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function arrangeTopLevelUnits(groups, bodyPosition, relations) {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const roots = groups.filter((group) => !groupById.has(group.parentId));
  const rootByBody = new Map();
  for (const root of roots) for (const primitiveId of root.primitiveIds) if (!rootByBody.has(primitiveId)) rootByBody.set(primitiveId, root.id);
  const units = [
    ...roots.map((group) => ({ id: `group:${group.id}`, kind: "group", sourceId: group.id, bounds: group.bounds })),
    ...[...bodyPosition.values()]
      .filter((body) => !rootByBody.has(body.id))
      .map((body) => ({ id: `body:${body.id}`, kind: "body", sourceId: body.id, bounds: body.bounds })),
  ];
  const unitIdForBody = (bodyId) => rootByBody.has(bodyId) ? `group:${rootByBody.get(bodyId)}` : `body:${bodyId}`;
  const unitRelations = relations
    .map((relation) => ({
      ...relation,
      sourcePrimitiveId: unitIdForBody(relation.sourcePrimitiveId),
      targetPrimitiveId: unitIdForBody(relation.targetPrimitiveId),
    }))
    .filter((relation) => relation.sourcePrimitiveId !== relation.targetPrimitiveId);
  const layers = topologicalLayers(units, unitRelations);
  let x = MARGIN;
  for (const layer of layers) {
    let y = MARGIN;
    let layerWidth = 0;
    for (const unit of layer) {
      translateTopLevelUnit(unit, x - unit.bounds.x, y - unit.bounds.y, groups, groupById, bodyPosition);
      y += unit.bounds.h + GAP_Y;
      layerWidth = Math.max(layerWidth, unit.bounds.w);
    }
    x += layerWidth + GAP_X;
  }
}

function translateTopLevelUnit(unit, dx, dy, groups, groupById, bodyPosition) {
  if (unit.kind === "body") {
    const body = bodyPosition.get(unit.sourceId);
    body.bounds = translateBounds(body.bounds, dx, dy);
    unit.bounds = body.bounds;
    return;
  }
  const root = groupById.get(unit.sourceId);
  for (const primitiveId of root.primitiveIds) {
    const body = bodyPosition.get(primitiveId);
    if (body) body.bounds = translateBounds(body.bounds, dx, dy);
  }
  for (const group of groups) {
    let ancestor = group;
    while (ancestor && ancestor.id !== root.id) ancestor = groupById.get(ancestor.parentId);
    if (ancestor) group.bounds = translateBounds(group.bounds, dx, dy);
  }
  unit.bounds = root.bounds;
}

function translateBounds(bounds, dx, dy) {
  return { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
}

function topologicalLayers(bodies, relations) {
  const ids = new Set(bodies.map((primitive) => primitive.id));
  const incoming = new Map(bodies.map((primitive) => [primitive.id, 0]));
  const adjacency = new Map(bodies.map((primitive) => [primitive.id, []]));
  for (const relation of relations) {
    if (!ids.has(relation.sourcePrimitiveId) || !ids.has(relation.targetPrimitiveId) || relation.sourcePrimitiveId === relation.targetPrimitiveId) continue;
    if (relation.relationTags?.includes("state")) continue;
    adjacency.get(relation.sourcePrimitiveId).push(relation.targetPrimitiveId);
    incoming.set(relation.targetPrimitiveId, incoming.get(relation.targetPrimitiveId) + 1);
  }
  const remaining = new Set(ids);
  const result = [];
  while (remaining.size) {
    const layer = bodies.filter((primitive) => remaining.has(primitive.id) && incoming.get(primitive.id) === 0);
    if (!layer.length) return [...result, bodies.filter((primitive) => remaining.has(primitive.id))];
    result.push(layer.sort((a, b) => a.id.localeCompare(b.id)));
    for (const primitive of layer) {
      remaining.delete(primitive.id);
      for (const target of adjacency.get(primitive.id)) incoming.set(target, incoming.get(target) - 1);
    }
  }
  return result;
}

function routeRelation(relation, primitiveById, primitives, routedConnectors, plannedRouteClass = "") {
  const source = primitiveById.get(relation.sourcePrimitiveId);
  const target = primitiveById.get(relation.targetPrimitiveId);
  const sourcePort = findAnchor(source, "outputs", relation.sourcePortId);
  const targetPort = findAnchor(target, "inputs", relation.targetPortId);
  const sourceAnchor = sourcePort ? { x: sourcePort.x, y: sourcePort.y } : null;
  const targetAnchor = targetPort ? { x: targetPort.x, y: targetPort.y } : null;
  const relationTags = new Set(relation.relationTags || []);
  const routeClass = String(plannedRouteClass || "")
    || (relationTags.has("state")
      ? "state"
      : relationTags.has("conditional")
        ? "conditional"
        : relationTags.has("bypass")
          ? "bypass"
          : relationTags.has("crossScale")
            ? "cross-scale"
            : "main-flow");
  if (!sourceAnchor || !targetAnchor) return { ...relation, routeClass, points: [] };
  if (routeClass === "bypass") {
    const residual = source?.blockKind === "residual-block" || target?.blockKind === "residual-block";
    const clearance = residual ? 48 : 30;
    const top = Math.min(source.bounds.y, target.bounds.y) - clearance;
    const bottom = Math.max(source.bounds.y + source.bounds.h, target.bounds.y + target.bounds.h) + clearance;
    const corridor = top < MARGIN / 2 ? bottom : top;
    return withObstacleRouting({ ...relation, routeClass, points: [sourceAnchor, { x: sourceAnchor.x + 18, y: corridor }, { x: targetAnchor.x - 18, y: corridor }, targetAnchor] }, source, target, primitives, routedConnectors);
  }
  if (routeClass === "state") {
    const left = Math.min(source.bounds.x, target.bounds.x) - 36;
    return withObstacleRouting({ ...relation, routeClass, points: [sourceAnchor, { x: left, y: sourceAnchor.y }, { x: left, y: targetAnchor.y }, targetAnchor] }, source, target, primitives, routedConnectors);
  }
  const middle = (sourceAnchor.x + targetAnchor.x) / 2;
  return withObstacleRouting({ ...relation, routeClass, points: [sourceAnchor, { x: middle, y: sourceAnchor.y }, { x: middle, y: targetAnchor.y }, targetAnchor] }, source, target, primitives, routedConnectors);
}

function withObstacleRouting(connector, source, target, primitives, routedConnectors) {
  const bodies = primitives.filter((primitive) => primitive.role === "body"
    && primitive.id !== source.id && primitive.id !== target.id);
  const start = connector.points[0];
  const end = connector.points.at(-1);
  const clearance = 24;
  const candidates = [{ kind: "direct", points: connector.points }];
  const topCorridors = uniqueNumbers(bodies.map((body) => body.bounds.y - clearance));
  const bottomCorridors = uniqueNumbers(bodies.map((body) => body.bounds.y + body.bounds.h + clearance));
  for (const y of topCorridors.sort((a, b) => b - a)) candidates.push({ kind: "top", points: horizontalCorridor(start, end, y) });
  for (const y of bottomCorridors.sort((a, b) => a - b)) candidates.push({ kind: "bottom", points: horizontalCorridor(start, end, y) });
  if (connector.routeClass === "state") {
    const left = Math.min(source.bounds.x, target.bounds.x, ...bodies.map((body) => body.bounds.x)) - clearance;
    const right = Math.max(source.bounds.x + source.bounds.w, target.bounds.x + target.bounds.w, ...bodies.map((body) => body.bounds.x + body.bounds.w)) + clearance;
    candidates.push({ kind: "left", points: verticalCorridor(start, end, left) });
    candidates.push({ kind: "right", points: verticalCorridor(start, end, right) });
  }
  // 侧向回退通道：绕到某一列的左侧或右侧再纵向走。
  // 顶/底通道的外拐只有 18 单位，对「同一列内向下」的连线来说这个外拐落在列内部，
  // 必然穿过夹在中间的那个盒子。盒子变矮、折行变密之后这条路才开始被走到。
  const sideCorridors = uniqueNumbers([
    ...bodies.map((body) => body.bounds.x - clearance),
    ...bodies.map((body) => body.bounds.x + body.bounds.w + clearance),
  ]).sort((a, b) => a - b);
  const fallbackCandidates = sideCorridors.map((x) => ({ kind: "side", points: verticalCorridor(start, end, x) }));
  const rank = (list) => list.map((candidate, index) => {
    const points = simplifyOrthogonalPath(candidate.points);
    return {
      ...candidate,
      points,
      index,
      cost: [countBodyIntersections(points, bodies), countConnectorCrossings(points, connector, routedConnectors), countBends(points), pathLength(points), index],
    };
  }).filter((candidate) => candidate.cost[0] === 0).sort((first, second) => compareCost(first.cost, second.cost));
  // 先试原有通道；全都被挡住时才动用侧向回退，避免改变已经正常的图的走线。
  const selected = rank(candidates)[0] || rank(fallbackCandidates)[0];
  return selected ? { ...connector, points: selected.points } : connector;
}

function horizontalCorridor(start, end, y) {
  const direction = end.x >= start.x ? 1 : -1;
  const startX = start.x + direction * 18;
  const endX = end.x - direction * 18;
  return [start, { x: startX, y: start.y }, { x: startX, y }, { x: endX, y }, { x: endX, y: end.y }, end];
}

function verticalCorridor(start, end, x) {
  return [start, { x, y: start.y }, { x, y: end.y }, end];
}

function uniqueNumbers(values) { return [...new Set(values.filter(Number.isFinite))]; }

function simplifyOrthogonalPath(points) {
  const compact = [];
  for (const point of points) {
    const previous = compact.at(-1);
    if (!previous || previous.x !== point.x || previous.y !== point.y) compact.push(point);
  }
  return compact.filter((point, index) => {
    if (index === 0 || index === compact.length - 1) return true;
    const previous = compact[index - 1];
    const next = compact[index + 1];
    return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
  });
}

function countBodyIntersections(points, bodies) {
  return bodies.reduce((count, body) => count + Number(pathIntersectsRectInterior(points, body.bounds)), 0);
}

function countConnectorCrossings(points, connector, routedConnectors) {
  let crossings = 0;
  for (const other of routedConnectors) {
    if (connectorsShareEndpoint(connector, other)) continue;
    const intersections = new Set();
    forEachSegment(points, (start, end) => forEachSegment(other.points, (otherStart, otherEnd) => {
      const point = segmentIntersection(start, end, otherStart, otherEnd);
      if (point) intersections.add(`${point.x.toFixed(9)},${point.y.toFixed(9)}`);
    }));
    crossings += intersections.size;
  }
  return crossings;
}

function countBends(points) {
  let bends = 0;
  for (let index = 2; index < points.length; index += 1) {
    const previousHorizontal = points[index - 2].y === points[index - 1].y;
    const nextHorizontal = points[index - 1].y === points[index].y;
    if (previousHorizontal !== nextHorizontal) bends += 1;
  }
  return bends;
}

function pathLength(points) {
  let length = 0;
  forEachSegment(points, (start, end) => { length += Math.abs(end.x - start.x) + Math.abs(end.y - start.y); });
  return length;
}

function compareCost(first, second) {
  for (let index = 0; index < first.length; index += 1) if (first[index] !== second[index]) return first[index] - second[index];
  return 0;
}

// 一条 20 个算子的主干如果一字排开，宽高比会到 20:1，缩放进论文栏宽后字号必然不可读。
// 折行采用「列优先」而不是蛇形回折：数据在列内向下、列间向右，因此
// 「数据流只能从左到右」的校验依然成立（同列 x 相等，下一列 x 更大）。
const MAX_CHAIN_COLUMNS = 6;
// 折成几行几列不能只看「每行最多 6 个」。
// 盒子压扁之后（高 32、宽 78）固定切 6 列会把 17 个算子排成 994×298 的长条，
// 宽高比 3.3:1，缩到栏宽后同样不可读。这里改成枚举列数，
// 挑出最接近论文插图常见比例（约 1.7:1）的那个网格。
const TARGET_FIGURE_ASPECT = 1.7;

function shouldWrapChain(layers) {
  if (layers.length <= MAX_CHAIN_COLUMNS) return false;
  return true;
}

function chooseWrapGrid(count, typicalWidth, typicalHeight) {
  let best = null;
  for (let columns = 1; columns <= MAX_CHAIN_COLUMNS; columns += 1) {
    const rows = Math.ceil(count / columns);
    const width = columns * (typicalWidth + GAP_X) + MARGIN;
    const height = rows * (typicalHeight + GAP_Y) + MARGIN;
    const score = Math.abs(Math.log(width / height) - Math.log(TARGET_FIGURE_ASPECT));
    if (!best || score < best.score - 1e-9) best = { rows, columns, score };
  }
  return best || { rows: Math.ceil(count / MAX_CHAIN_COLUMNS), columns: MAX_CHAIN_COLUMNS };
}

function applyChainWrapping(laidBodies, layers) {
  const laidById = new Map(laidBodies.map((body) => [String(body.id), body]));
  const ordered = [];
  for (const layer of layers) {
    const placed = layer.map((primitive) => laidById.get(String(primitive.id))).filter(Boolean);
    for (const body of placed.sort((left, right) => left.bounds.y - right.bounds.y)) ordered.push(body);
  }
  if (ordered.length <= MAX_CHAIN_COLUMNS) return false;

  const sortedWidths = ordered.map((body) => body.bounds.w).sort((left, right) => left - right);
  const sortedHeights = ordered.map((body) => body.bounds.h).sort((left, right) => left - right);
  const median = (values) => values[Math.floor(values.length / 2)];
  const { rows, columns } = chooseWrapGrid(ordered.length, median(sortedWidths), median(sortedHeights));
  const columnWidths = new Array(columns).fill(0);
  const placement = ordered.map((body, index) => {
    const column = Math.min(columns - 1, Math.floor(index / rows));
    columnWidths[column] = Math.max(columnWidths[column], body.bounds.w);
    return { body, column };
  });

  const offsets = [];
  let cursor = MARGIN;
  for (const width of columnWidths) {
    offsets.push(cursor);
    cursor += width + GAP_X;
  }
  const cursors = offsets.map(() => MARGIN);
  for (const item of placement) {
    const x = offsets[item.column];
    const y = cursors[item.column];
    item.body.bounds = { ...item.body.bounds, x, y };
    cursors[item.column] = y + item.body.bounds.h + GAP_Y;
  }
  return true;
}

function columnOffsets(layers, sizes) {
  const offsets = [];
  let cursor = MARGIN;
  for (const layer of layers) {
    offsets.push(cursor);
    const widest = layer.reduce((max, primitive) => Math.max(max, sizes.get(primitive.id)?.w || 0), 0);
    cursor += widest + GAP_X;
  }
  return offsets;
}

function primitiveSize(primitive) {
  const form = String(primitive.form || "");
  // 圆形算子（合并符号）必须是正方形。真实场景里 merge 算子会带着 blockKind
  // （unet 的 Concat 是 decoder-stage），旧逻辑让 blockKindSize 优先，于是
  // 画出一个 100×34 的扁盒子里嵌一颗 34 直径的小圆——这正是"模块又大又空"的来源。
  if (form === "glyph") return { ...baseSizeForForm("glyph") };
  const blockSize = blockKindSize(primitive.blockKind || primitive.data?.blockKind);
  const base = blockSize || baseSizeForForm(form);
  return scaleSizeByTensorShape(base, primitive.data?.tensorShape, form);
}

// 盒子尺寸的唯一依据是「正文标签要多高」。
// 实测顶刊（Transformer 注意力图、ViT 结构图、U-Net 图 1）：
// 盒高 / 正文字号 = 1.6–3.2，盒子中位宽高比 2.2–9.6（又宽又扁的横条）。
// 我们旧值是盒高 54–133（字号 11），即 8–13×，于是字被盒子淹了，
// 视觉上就是「又大又空」。这里把所有形态压到 h≈32、宽高比≈2.4。
function baseSizeForForm(form) {
  // 圆形算子必须保持正方形，否则圆会被拉成椭圆。
  if (form === "glyph" || form === "cell") return { w: 34, h: 34 };
  if (form === "strip") return { w: 72, h: 26 };
  if (form === "callout") return { w: 92, h: 34 };
  if (form === "stack") return { w: 70, h: 32 };
  if (form === "plane") return { w: 62, h: 40 };
  if (form === "volume") return { w: 62, h: 36 };
  if (form === "wedge") return { w: 62, h: 32 };
  return { w: 68, h: 32 };
}

// 张量形状只做「弱调制」：宽度色散从 3.10× 压到 ~1.5×，
// 既保住 224→112→56 的收窄塔形，又不让同一张图里盒子大小差三倍。
const SHAPE_SCALE_MIN = 0.8;
const SHAPE_SCALE_MAX = 1.2;

// 调制之后再夹一次硬边界。
// 宽：高 56–104（宽高比 ≥1.6 仍成立）。
// 高：volume 可以高到 96（VGG16 式的"特征图塔"——空间尺寸大时盒子高），
//     其他形态仍压在 24–34（旧"顶刊比例带"对 band/strip 仍适用）。
// 旧版把 height 也锁到 24–34，导致 CNN/VGG 的空间维度编码不出来，整张图变成
// 一排一样高的横条——用户说"全是方框"就是这个。
const MODULE_MIN_W = 56;
const MODULE_MAX_W = 104;
const MODULE_MIN_H = 24;
const MODULE_MAX_H = 34;
const VOLUME_MAX_H = 96;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * 让盒子大小反映真实张量尺寸：空间边长决定高度，通道数决定宽度。
 * 这样 CNN 的 224 -> 112 -> 56 -> 28 会画成逐级收窄的塔，
 * Transformer 的 FFN 扩张（768 -> 3072）也会在宽度上看得见。
 * 没有声明形状的图元保持默认尺寸。
 */
function scaleSizeByTensorShape(size, shape, form) {
  const factors = tensorSizeFactors(shape);
  if (!factors) return { w: clamp(size.w, MODULE_MIN_W, MODULE_MAX_W), h: clamp(size.h, MODULE_MIN_H, MODULE_MAX_H) };
  const maxH = form === "volume" ? VOLUME_MAX_H : MODULE_MAX_H;
  // CNN volume：空间尺寸直接编码为高度（VGG16 式的特征图塔）。
  // 旧版 height 只用 log 弱调制（0.8–1.2×），加 maxH=34 的夹子后，spatial 7 和
  // spatial 224 出来一样高——塔形没了。改成 h = base + k·spatialSide，
  // 空间 7→h≈26、112→h≈64、224→h≈90，能读出"每过一个 pool 变矮一半"。
  if (form === "volume" && shape && shape.length >= 3) {
    const dims = shape[0] === 1 ? shape.slice(1) : shape;
    const spatialSide = dims[dims.length - 1] || 0;
    const targetH = Math.round(24 + Math.min(72, spatialSide * 0.32));
    return {
      w: Math.max(1, Math.round(clamp(size.w * factors.width, MODULE_MIN_W, MODULE_MAX_W))),
      h: Math.max(1, clamp(targetH, MODULE_MIN_H, maxH)),
    };
  }
  return {
    w: Math.max(1, Math.round(clamp(size.w * factors.width, MODULE_MIN_W, MODULE_MAX_W))),
    h: Math.max(1, Math.round(clamp(size.h * factors.height, MODULE_MIN_H, maxH))),
  };
}

function tensorSizeFactors(shape) {
  const dims = Array.isArray(shape) ? shape.map(Number).filter((value) => Number.isFinite(value) && value > 0) : [];
  if (dims.length < 3) return null;
  const values = dims[0] === 1 ? dims.slice(1) : dims;
  if (values.length < 2) return null;
  // NCHW：最后一维是特征图边长，第 1 维是通道数。
  // N,C：第 1 维是 token 数，最后一维是特征数。
  const spatialSide = values.length >= 3 ? values[values.length - 1] : values[0];
  const channelCount = values.length >= 3 ? values[0] : values[values.length - 1];
  return {
    width: logarithmicScale(channelCount, 32, 4096),
    height: logarithmicScale(spatialSide, 14, 320),
  };
}

function logarithmicScale(value, min, max) {
  const span = Math.log2(max) - Math.log2(min);
  if (!(span > 0)) return 1;
  const position = Math.min(1, Math.max(0, (Math.log2(value) - Math.log2(min)) / span));
  return SHAPE_SCALE_MIN + (SHAPE_SCALE_MAX - SHAPE_SCALE_MIN) * position;
}

function anchorsFor(primitive, direction = "horizontal") {
  const inputs = declaredPorts(primitive, "inputs", "in");
  const outputs = declaredPorts(primitive, "outputs", "out");
  return {
    inputs: inputs.map((port, index, ports) => anchorForPort(primitive.bounds, port.id, "input", direction, index, ports.length)),
    outputs: outputs.map((port, index, ports) => anchorForPort(primitive.bounds, port.id, "output", direction, index, ports.length)),
  };
}

function declaredPorts(primitive, side, fallback) {
  const ports = Array.isArray(primitive.ports?.[side]) ? primitive.ports[side] : [];
  if (!ports.length) return [{ id: fallback }];
  const used = new Set();
  return ports.map((port, index) => {
    const base = String(port?.portId || port?.id || (typeof port === "string" ? port : "") || fallback);
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    return { id };
  });
}

function findAnchor(primitive, side, portId) {
  const anchors = primitive?.anchors?.[side] || [];
  if (portId !== undefined && portId !== null && String(portId)) {
    const matched = anchors.find((anchor) => String(anchor.id) === String(portId));
    if (matched) return matched;
  }
  return anchors[0] || null;
}

function anchorForPort(bounds, portId, kind, direction, index, count) {
  const side = anchorSide(portId, kind, direction);
  const ratio = (index + 1) / (count + 1);
  if (side === "top") return { id: portId, x: bounds.x + bounds.w * ratio, y: bounds.y };
  if (side === "bottom") return { id: portId, x: bounds.x + bounds.w * ratio, y: bounds.y + bounds.h };
  if (side === "left") return { id: portId, x: bounds.x, y: bounds.y + bounds.h * ratio };
  return { id: portId, x: bounds.x + bounds.w, y: bounds.y + bounds.h * ratio };
}

function anchorSide(portId, kind, direction) {
  const id = String(portId || "").toLowerCase();
  if (/top|north/.test(id)) return "top";
  if (/bottom|south/.test(id)) return "bottom";
  if (/left|west/.test(id)) return "left";
  if (/right|east/.test(id)) return "right";
  if (direction === "vertical") return kind === "input" ? "top" : "bottom";
  return kind === "input" ? "left" : "right";
}
function scaleKey(primitive) { return String(primitive.data?.scale || primitive.semanticTags?.find((tag) => /^scale[:=]/.test(tag)) || "unknown"); }
function validBounds(bounds) { return bounds && [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) && bounds.w > 0 && bounds.h > 0; }
function insidePage(bounds, page) { return validBounds(bounds) && page && bounds.x >= page.x && bounds.y >= page.y && bounds.x + bounds.w <= page.x + page.width && bounds.y + bounds.h <= page.y + page.height; }
function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function contains(outer, inner) { return validBounds(outer) && validBounds(inner) && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h; }
function normalizeWorkspaceBounds(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const w = Number(value.w);
  const h = Number(value.h);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

function validateConnectorPort(connector, side, portId, primitiveById, issues) {
  if (!portId) return;
  const primitiveId = side === "source" ? connector.sourcePrimitiveId : connector.targetPrimitiveId;
  const primitive = primitiveById.get(String(primitiveId));
  if (!primitive) return;
  const anchors = primitive.anchors?.[side === "source" ? "outputs" : "inputs"] || [];
  if (!anchors.some((anchor) => String(anchor.id) === String(portId))) {
    issues.push({
      code: "missing-block-port-anchor",
      relationId: connector.id,
      primitiveId,
      side,
      portId: String(portId),
    });
  }
}

function applyBlockKindArchetype(laidBodies) {
  const encoders = laidBodies.filter((body) => body.blockKind === "encoder-stage");
  const decoders = laidBodies.filter((body) => body.blockKind === "decoder-stage");
  if (!encoders.length || !decoders.length) return;

  const ordered = [...laidBodies].sort((left, right) => left.bounds.x - right.bounds.x);
  const encoderSet = new Set(encoders);
  const decoderSet = new Set(decoders);
  const inputBodies = ordered.filter((body) => (body.sourceFamilies || []).includes("input"));
  const outputBodies = ordered.filter((body) =>
    body.blockKind === "detection-head" || (body.sourceFamilies || []).includes("output"));
  const middle = ordered.filter((body) =>
    !encoderSet.has(body)
    && !decoderSet.has(body)
    && !inputBodies.includes(body)
    && !outputBodies.includes(body));
  const stages = [inputBodies, encoders, middle, decoders, outputBodies];
  if (!stages.some((group) => group.length)) return;
  // 每个阶段都装得下一列时，画成真正的 U 形（编码器向下、解码器向上）。
  // 一旦某个阶段太长（逐算子出图时必然如此），U 形会变成几千像素高的窄条，
  // 于是改用折行阶梯：每组按高度上限拆成子列，逐列向右推进。
  const tallestStage = Math.max(...stages.map((group) => group.length));
  if (tallestStage <= MAX_COLUMN_BODIES) placeUStages({ inputBodies, encoders, middle, decoders, outputBodies });
  else placeStageColumns(stages);
}

const MAX_COLUMN_BODIES = 5;

function placeUStages({ inputBodies, encoders, middle, decoders, outputBodies }) {
  const widthOf = (group) => (group.length ? Math.max(...group.map((body) => body.bounds.w)) : 0);
  const leftX = MARGIN;
  const inputWidth = widthOf(inputBodies);
  const encoderX = leftX + (inputWidth ? inputWidth + GAP_X : 0);
  const encoderWidth = widthOf(encoders);
  const centerX = encoderX + encoderWidth + GAP_X;
  const centerWidth = widthOf(middle);
  const rightX = centerX + (centerWidth ? centerWidth + GAP_X : 0);
  let cursorY = MARGIN;
  for (const body of inputBodies) {
    body.bounds = { ...body.bounds, x: leftX, y: cursorY };
    cursorY += body.bounds.h + GAP_Y;
  }
  for (const body of encoders) {
    body.bounds = { ...body.bounds, x: encoderX, y: cursorY };
    cursorY += body.bounds.h + GAP_Y;
  }
  const bottomY = cursorY;
  let middleY = bottomY;
  for (const body of middle) {
    body.bounds = { ...body.bounds, x: centerX, y: middleY };
    middleY += body.bounds.h + GAP_Y;
  }
  let decoderY = middleY - GAP_Y;
  for (const body of decoders) {
    body.bounds = { ...body.bounds, x: rightX, y: decoderY };
    decoderY -= body.bounds.h + GAP_Y;
  }
  let outputY = MARGIN;
  for (const body of outputBodies) {
    body.bounds = { ...body.bounds, x: rightX, y: outputY };
    outputY += body.bounds.h + GAP_Y;
  }
}

function placeStageColumns(stages) {
  const columns = [];
  for (const group of stages) for (const chunk of balancedChunks(group, MAX_COLUMN_BODIES)) columns.push(chunk);
  let cursorX = MARGIN;
  for (const column of columns) {
    const width = Math.max(...column.map((body) => body.bounds.w));
    let cursorY = MARGIN;
    // 同一列内统一贴左对齐。早先按 (columnWidth - w) / 2 居中，一旦各图元宽度不同
    // （张量尺寸驱动大小后必然如此），同列内就会互相错开几个像素，
    // 把「数据只能从左到右」的校验误判成违规。
    for (const body of column) {
      body.bounds = { ...body.bounds, x: cursorX, y: cursorY };
      cursorY += body.bounds.h + GAP_Y;
    }
    cursorX += width + GAP_X;
  }
}

// 均分而不是贪心切分：6 个图元的上限 5 应该切成 3 + 3，而不是 5 + 1。
function balancedChunks(bodies, limit) {
  if (!bodies.length) return [];
  const columns = Math.ceil(bodies.length / limit);
  const perColumn = Math.ceil(bodies.length / columns);
  const chunks = [];
  for (let index = 0; index < bodies.length; index += perColumn) chunks.push(bodies.slice(index, index + perColumn));
  return chunks;
}

function applyTransformerBlockStack(laidBodies, relations, layoutArchetype = "") {
  // transformer-stack 原型已经把同构块排成（可能多列的）竖直堆叠，
  // 这里再统一拉回第一列会把多列压成一摞重叠的盒子，直接跳过。
  if (layoutArchetype === "transformer-stack") return;
  if (laidBodies.some((body) => body.blockKind === "encoder-stage" || body.blockKind === "decoder-stage")) return;
  const stack = laidBodies
    .filter((body) => body.blockKind === "attention-block" || body.blockKind === "ffn-block")
    .sort((left, right) => left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y);
  if (stack.length < 2) return;
  const stackIds = new Set(stack.map((body) => String(body.id)));
  const incoming = new Map(stack.map((body) => [String(body.id), 0]));
  const outgoing = new Map(stack.map((body) => [String(body.id), 0]));
  const stackIncoming = new Map(stack.map((body) => [String(body.id), 0]));
  const stackOutgoing = new Map(stack.map((body) => [String(body.id), 0]));
  for (const relation of relations || []) {
    const source = String(relation.sourcePrimitiveId || "");
    const target = String(relation.targetPrimitiveId || "");
    if (stackIds.has(source)) outgoing.set(source, (outgoing.get(source) || 0) + 1);
    if (stackIds.has(target)) incoming.set(target, (incoming.get(target) || 0) + 1);
    if (stackIds.has(source) && stackIds.has(target)) {
      stackOutgoing.set(source, (stackOutgoing.get(source) || 0) + 1);
      stackIncoming.set(target, (stackIncoming.get(target) || 0) + 1);
    }
  }
  const linear = stack.every((body) => {
    const id = String(body.id);
    return (incoming.get(id) || 0) <= 1 && (outgoing.get(id) || 0) <= 1;
  });
  if (!linear) return;
  const directlyConnected = stack.every((body, index) => {
    const id = String(body.id);
    const needsIncoming = index > 0;
    const needsOutgoing = index < stack.length - 1;
    return (!needsIncoming || (stackIncoming.get(id) || 0) > 0)
      && (!needsOutgoing || (stackOutgoing.get(id) || 0) > 0);
  });
  if (!directlyConnected) return;
  const columnX = stack[0].bounds.x;
  let cursorY = Math.min(...stack.map((body) => body.bounds.y));
  for (const body of stack) {
    body.bounds = { ...body.bounds, x: columnX, y: cursorY };
    cursorY += body.bounds.h + GAP_Y;
  }
}

function applyFusionBranchLanes(laidBodies, relations) {
  const bodyById = new Map(laidBodies.map((body) => [String(body.id), body]));
  const participants = new Set();
  for (const relation of relations) {
    const target = bodyById.get(String(relation.targetPrimitiveId));
    if (!target || !["multi-scale-fusion", "moe-block"].includes(String(target.blockKind || ""))) continue;
    const sources = [...new Set(relations
      .filter((candidate) => String(candidate.targetPrimitiveId) === String(target.id))
      .map((candidate) => bodyById.get(String(candidate.sourcePrimitiveId)))
      .filter(Boolean))]
      .sort((left, right) => left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y);
    if (sources.length < 2) continue;
    const previous = sources.map((source) => ({ source, bounds: { ...source.bounds } }));
    const gap = GAP_Y;
    const totalHeight = sources.reduce((sum, source) => sum + source.bounds.h, 0) + gap * (sources.length - 1);
    const centerY = target.bounds.y + target.bounds.h / 2;
    let cursor = centerY - totalHeight / 2;
    for (const source of sources) {
      source.bounds = { ...source.bounds, y: cursor };
      cursor += source.bounds.h + gap;
      participants.add(String(source.id));
    }
    participants.add(String(target.id));
    const violation = laidBodies.some((first, index) => laidBodies.slice(index + 1).some((second) =>
      participants.has(String(first.id)) !== participants.has(String(second.id)) && overlaps(first.bounds, second.bounds)));
    if (violation) {
      for (const item of previous) item.source.bounds = item.bounds;
    }
  }
}

function separateDisconnectedComponents(laidBodies, relations) {
  const bodyById = new Map(laidBodies.map((body) => [String(body.id), body]));
  const parent = new Map(laidBodies.map((body) => [String(body.id), String(body.id)]));
  const find = (id) => {
    let current = String(id);
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const relation of relations || []) {
    if (!bodyById.has(String(relation.sourcePrimitiveId)) || !bodyById.has(String(relation.targetPrimitiveId))) continue;
    union(relation.sourcePrimitiveId, relation.targetPrimitiveId);
  }
  const components = new Map();
  for (const body of laidBodies) {
    const root = find(body.id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(body);
  }
  if (components.size < 2) return;
  const boxes = [...components.values()].map((items) => ({
    items,
    bounds: boundsOf(items.map((item) => item.bounds)),
  })).sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
  const placed = [];
  for (const component of boxes) {
    let shift = 0;
    for (const previous of placed) {
      if (!overlaps(component.bounds, previous.bounds)) continue;
      shift = Math.max(shift, previous.bounds.y + previous.bounds.h + GAP_Y - component.bounds.y);
    }
    if (shift > 0) {
      for (const body of component.items) body.bounds = { ...body.bounds, y: body.bounds.y + shift };
      component.bounds = { ...component.bounds, y: component.bounds.y + shift };
    }
    placed.push(component);
  }
}

function boundsOf(boxes) {
  const valid = boxes.filter(validBounds);
  if (!valid.length) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...valid.map((box) => box.x));
  const minY = Math.min(...valid.map((box) => box.y));
  const maxX = Math.max(...valid.map((box) => box.x + box.w));
  const maxY = Math.max(...valid.map((box) => box.y + box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// 复合块的尺寸同样遵守 h≈32–38、宽高比≈2.4 的规则：
// 块越「重」（残差、注意力、编解码级）就多给一点宽和高，
// 但差异控制在 1.5× 以内，避免同一张图里出现巨块和小块并排。
function blockKindSize(blockKind) {
  const sizes = {
    "conv-block": { w: 78, h: 32 },
    "residual-block": { w: 96, h: 34 },
    "attention-block": { w: 88, h: 36 },
    "ffn-block": { w: 84, h: 34 },
    "encoder-stage": { w: 100, h: 34 },
    "decoder-stage": { w: 100, h: 34 },
    "multi-scale-fusion": { w: 64, h: 32 },
    "detection-head": { w: 80, h: 32 },
    "recurrent-cell": { w: 68, h: 34 },
    "moe-block": { w: 100, h: 34 },
    "repeat-block": { w: 84, h: 32 },
    "graph-block": { w: 94, h: 36 },
  };
  return sizes[String(blockKind || "")] || null;
}
export function scoreLayout(bodies, connectors) {
  let crossings = 0;
  for (let firstIndex = 0; firstIndex < connectors.length; firstIndex += 1) {
    const first = connectors[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < connectors.length; secondIndex += 1) {
      const second = connectors[secondIndex];
      if (connectorsShareEndpoint(first, second)) continue;
      const intersections = new Set();
      forEachSegment(first.points, (firstStart, firstEnd) => {
        forEachSegment(second.points, (secondStart, secondEnd) => {
          const point = segmentIntersection(firstStart, firstEnd, secondStart, secondEnd);
          if (point) intersections.add(`${point.x.toFixed(9)},${point.y.toFixed(9)}`);
        });
      });
      crossings += intersections.size;
    }
  }
  return { crossings, bends: connectors.reduce((sum, connector) => sum + Math.max(0, connector.points.length - 2), 0), crossScaleAlignment: bodies.length ? 1 : 0 };
}

function connectorsShareEndpoint(first, second) {
  return first.sourcePrimitiveId === second.sourcePrimitiveId
    || first.sourcePrimitiveId === second.targetPrimitiveId
    || first.targetPrimitiveId === second.sourcePrimitiveId
    || first.targetPrimitiveId === second.targetPrimitiveId;
}

function forEachSegment(points, visit) {
  if (!Array.isArray(points)) return;
  for (let index = 1; index < points.length; index += 1) visit(points[index - 1], points[index]);
}

function segmentIntersection(a, b, c, d) {
  if (![a, b, c, d].every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const firstX = b.x - a.x;
  const firstY = b.y - a.y;
  const secondX = d.x - c.x;
  const secondY = d.y - c.y;
  const denominator = firstX * secondY - firstY * secondX;
  if (denominator === 0) return null;
  const offsetX = c.x - a.x;
  const offsetY = c.y - a.y;
  const firstRatio = (offsetX * secondY - offsetY * secondX) / denominator;
  const secondRatio = (offsetX * firstY - offsetY * firstX) / denominator;
  if (firstRatio < 0 || firstRatio > 1 || secondRatio < 0 || secondRatio > 1) return null;
  return { x: a.x + firstRatio * firstX, y: a.y + firstRatio * firstY };
}

function pathIntersectsRectInterior(points, bounds) {
  if (!validBounds(bounds)) return false;
  let intersects = false;
  forEachSegment(points, (start, end) => {
    if (!intersects && segmentIntersectsRectInterior(start, end, bounds)) intersects = true;
  });
  return intersects;
}

function segmentIntersectsRectInterior(start, end, bounds) {
  if (![start, end].every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  const xInterval = openAxisInterval(start.x, end.x - start.x, bounds.x, bounds.x + bounds.w);
  const yInterval = openAxisInterval(start.y, end.y - start.y, bounds.y, bounds.y + bounds.h);
  if (!xInterval || !yInterval) return false;
  const low = Math.max(0, xInterval.low, yInterval.low);
  const high = Math.min(1, xInterval.high, yInterval.high);
  return low < high && high > 0 && low < 1;
}

function openAxisInterval(origin, delta, minimum, maximum) {
  if (delta === 0) return origin > minimum && origin < maximum ? { low: -Infinity, high: Infinity } : null;
  const first = (minimum - origin) / delta;
  const second = (maximum - origin) / delta;
  return { low: Math.min(first, second), high: Math.max(first, second) };
}
