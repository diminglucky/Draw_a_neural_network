// 架构家族识别：把"这是一张什么网络"变成确定事实，供下游选画法。
//
// 为什么必须单独做这一层？
// 顶刊里每一类网络有各自的**标准图形拓扑**，不是换个颜色/形状能解决的：
//   U-Net / SegNet   → U 形：编码器下行、瓶颈、解码器上行 + 跳跃虚线
//   YOLO / RetinaNet → 骨干 + 金字塔颈(FPN/PANet) + 多尺度检测头(P3/P4/P5)
//   ResNet           → 重复残差块塔 + 跳跃弧线
//   ViT / BERT       → 同构注意力+FFN 块序列
//   VGG / AlexNet    → 均匀 conv+pool 塔（特征图堆逐级收窄）
//   GAN              → 生成器/判别器双塔相对
// 所以"识别网络"分两层：
//   微观：算子长什么样（conv=特征图堆、FC=扁条…）——已由 renderBodyShape 处理
//   宏观：整张图怎么摆（U 形 / 金字塔 / 塔 / 序列）——本模块负责判定，再交给布局原型
// 旧实现只有一条 detectEncoderDecoder（有下采样+上采样+跳跃边就判 U-Net），
// 其余所有网络一律走通用顺序流，于是 YOLO 和 ViT 画出来是同一种东西。
export const ARCHITECTURE_FAMILY_VERSION = "architecture-family/v1";

// 判定优先级 = 数组顺序：越靠前越特异。
// 检测金字塔最特异（有 detection-head 基本就是检测器），
// 卷积塔最宽泛（放在倒数第二，避免抢走 ResNet / ViT）。
//
// signals 返回"该家族关心的全部信号 + 是否命中"，而不是只返回命中的那些。
// 这样 requireAll 才能正确比较"命中数 vs 关心总数"；
// 早期版本只返回命中项，导致 encoder-decoder 仅凭一条跳跃边就误判。
const FAMILIES = [
  {
    id: "detection",
    label: "目标检测 · 多尺度金字塔",
    archetype: "detection-pyramid",
    canonical: "骨干 → 金字塔颈(FPN/PANet) → 多尺度检测头（P3/P4/P5 各挂一个 head）",
    // 必须"检测头 + 多尺度融合"同时成立才判为检测器。
    // 只凭一个 detection-head 就判检测是错误的：block IR 会给 diffusion-unet
    // 这类模型也挂上 detection-head，于是它丢掉了本该有的 U 形布局，
    // 退化成从左到右顺序流后，U 形关系直接违反 DAG 方向约束。
    // 宏观看拓扑（U 形 / 金字塔）比单个 block 标签更可靠。
    signals: (s) => [
      { label: "blockKind:detection-head", present: s.kinds.has("detection-head") },
      { label: "blockKind:multi-scale-fusion", present: s.kinds.has("multi-scale-fusion") },
    ],
    requireAll: true,
  },
  {
    id: "encoder-decoder",
    label: "编码器-解码器",
    archetype: "encoder-decoder-u",
    canonical: "U 形：编码器下行 → 瓶颈 → 解码器上行，跳跃连接虚线横跨",
    signals: (s) => [
      { label: "下采样算子", present: s.hasDown },
      { label: "上采样算子", present: s.hasUp },
      { label: "跳跃连接", present: s.hasSkip },
    ],
    requireAll: true,
  },
  {
    id: "transformer",
    label: "Transformer 栈",
    archetype: "transformer-stack",
    canonical: "同构注意力+FFN 块串联，常画成重复块序列（×N 标注）",
    signals: (s) => [
      { label: "blockKind:attention-block", present: s.kinds.has("attention-block") },
      { label: "attention 算子 + 矩阵乘", present: s.hasAttention && s.hasMatmul },
    ],
  },
  {
    id: "residual",
    label: "残差网络 · 塔",
    archetype: "residual-tower",
    canonical: "重复残差块堆叠，跳跃弧线绕过块（ResNet 标志性画法）",
    signals: (s) => [
      { label: "blockKind:residual-block", present: s.kinds.has("residual-block") },
      // Add 合并 + 长程跳跃 = 残差分支绕过若干层直接汇入（ResNet 的 y = f(x) + x）
      { label: "残差合并 (Add + 长程跳跃)", present: s.hasAddMerge && s.hasSkip },
    ],
  },
  {
    id: "cnn",
    label: "卷积网络 · 塔",
    archetype: "cnn-tower",
    canonical: "均匀 conv+pool 塔，特征图堆逐级收窄（VGG 标志性画法）",
    signals: (s) => [
      { label: "卷积算子", present: s.hasConv },
      { label: "池化算子", present: s.hasPool },
      { label: "无跳跃连接", present: !s.hasSkip },
    ],
    requireAll: true,
  },
  {
    id: "sequential",
    label: "通用顺序流",
    archetype: "sequential-flow",
    canonical: "未匹配到已知家族，按数据流从左到右排布",
    signals: () => [{ label: "（兜底）", present: true }],
    fallback: true,
  },
];

export function detectArchitectureFamily({ canonicalModel = {}, blocks = {} } = {}) {
  const signals = buildSignals({ canonicalModel, blocks });
  for (const family of FAMILIES) {
    if (family.fallback) continue;
    const declared = family.signals(signals);
    const evidence = declared.filter((signal) => signal.present).map((signal) => signal.label);
    if (!evidence.length) continue;
    // requireAll：关心的信号必须全部命中，否则跳过（避免仅凭单一信号误判）。
    if (family.requireAll && evidence.length < declared.length) continue;
    return {
      version: ARCHITECTURE_FAMILY_VERSION,
      family: family.id,
      label: family.label,
      archetype: family.archetype,
      canonical: family.canonical,
      confidence: confidenceOf(family.id, evidence),
      evidence,
      signals: snapshotSignals(signals),
    };
  }
  const fallback = FAMILIES.find((family) => family.fallback);
  return {
    version: ARCHITECTURE_FAMILY_VERSION,
    family: fallback.id,
    label: fallback.label,
    archetype: fallback.archetype,
    canonical: fallback.canonical,
    confidence: 0,
    evidence: fallback.signals(signals).filter((signal) => signal.present).map((signal) => signal.label),
    signals: snapshotSignals(signals),
  };
}

// 把 canonical model + block IR 压成一组可判定的布尔/集合信号。
function buildSignals({ canonicalModel = {}, blocks = {} } = {}) {
  const nodes = canonicalModel.nodes || [];
  const edges = canonicalModel.edges || [];
  const kinds = new Set();
  for (const block of blocks.blocks || []) if (block.kind) kinds.add(String(block.kind));
  for (const node of nodes) if (node.blockKind) kinds.add(String(node.blockKind));

  const text = nodes
    .map((node) => `${String(node.op || "")} ${String(node.family || "")} ${String(node.label || "")}`)
    .join(" ")
    .toLowerCase();

  // 关键：canonical model 里**所有边都是 "signal"**，从来没有被打成 skip/residual。
  // 光看 edge.type 永远检测不到跳跃连接，于是 U-Net 和 ResNet 都掉进"卷积塔"。
  // 但拓扑证据就在那儿：合并节点（Add/Concat）的多路输入深度差很大
  // ——resnet 是 Add <- [BatchNorm(深度8), MaxPool(深度3)]，
  //   unet  是 Concat <- [Resize, Relu]，两条都是绕过若干层的长程跳跃。
  const hasSkip = edges.some((edge) => /skip|residual|bypass/i.test(String(edge.type || "")))
    || hasLongRangeMergeSkip(nodes, edges);

  return {
    kinds,
    hasDown: /pool|downsample|stride/.test(text),
    hasUp: /upsample|interpolate|resize|deconv|convtranspose|unpool/.test(text),
    hasSkip,
    hasConv: /conv|convolution/.test(text),
    hasPool: /pool|downsample|stride/.test(text),
    hasMatmul: /matmul|gemm|linear|dense/.test(text),
    hasAttention: /attention|softmax/.test(text),
    hasAddMerge: nodes.some((node) => /^add$/i.test(String(node.op || ""))),
    hasConcatMerge: nodes.some((node) => /concat/i.test(String(node.op || ""))),
    nodeCount: nodes.length,
  };
}

// 合并节点（Add / Concat）的多路输入如果在拓扑深度上差很多，
// 说明较浅的那条输入绕过了中间的若干层——这就是跳跃/残差连接。
function hasLongRangeMergeSkip(nodes, edges) {
  const idOf = (node) => String(node.canonicalId || node.id);
  const idSet = new Set(nodes.map(idOf));
  const out = new Map();
  const indegree = new Map();
  for (const node of nodes) {
    out.set(idOf(node), []);
    indegree.set(idOf(node), 0);
  }
  for (const edge of edges) {
    const source = String(edge.canonicalSource || edge.source);
    const target = String(edge.canonicalTarget || edge.target);
    if (!idSet.has(source) || !idSet.has(target)) continue;
    out.get(source).push(target);
    indegree.set(target, indegree.get(target) + 1);
  }

  // Kahn 拓扑序 + 最长路径深度
  const depth = new Map();
  for (const node of nodes) depth.set(idOf(node), 0);
  const remaining = new Map(indegree);
  const queue = nodes.filter((node) => indegree.get(idOf(node)) === 0).map(idOf);
  while (queue.length) {
    const current = queue.shift();
    for (const next of out.get(current) || []) {
      depth.set(next, Math.max(depth.get(next) || 0, (depth.get(current) || 0) + 1));
      remaining.set(next, remaining.get(next) - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }

  for (const node of nodes) {
    if (!/merge|add|concat/i.test(`${node.family || ""} ${node.op || ""}`)) continue;
    const mergeId = idOf(node);
    const sources = edges
      .filter((edge) => String(edge.canonicalTarget || edge.target) === mergeId)
      .map((edge) => String(edge.canonicalSource || edge.source))
      .filter((source) => idSet.has(source));
    if (sources.length < 2) continue;
    const depths = sources.map((source) => depth.get(source) || 0);
    // 深度差 ≥2 才算"绕过若干层"；相邻两路输入（差 1）只是普通分支合并。
    if (Math.max(...depths) - Math.min(...depths) >= 2) return true;
  }
  return false;
}

function snapshotSignals(signals) {
  return {
    blockKinds: [...signals.kinds].sort(),
    hasDown: signals.hasDown,
    hasUp: signals.hasUp,
    hasSkip: signals.hasSkip,
    hasConv: signals.hasConv,
    hasPool: signals.hasPool,
    hasMatmul: signals.hasMatmul,
    hasAttention: signals.hasAttention,
    hasAddMerge: signals.hasAddMerge,
    hasConcatMerge: signals.hasConcatMerge,
  };
}

// 置信度：证据越多、越特异（blockKind 直接命中）越高。
function confidenceOf(familyId, evidence) {
  const byKind = evidence.filter((item) => item.startsWith("blockKind:")).length;
  if (byKind >= 2) return 0.95;
  if (byKind === 1) return 0.85;
  if (familyId === "encoder-decoder") return 0.8;
  if (familyId === "cnn") return 0.6;
  return 0.5;
}
