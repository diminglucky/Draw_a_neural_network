const COMPOUND_MIN_SIZES = Object.freeze({
  transformer: Object.freeze({ width: 320, height: 250 }),
  attention: Object.freeze({ width: 320, height: 250 }),
  operator: Object.freeze({ width: 320, height: 250 }),
  residual: Object.freeze({ width: 300, height: 220 }),
  diffusion: Object.freeze({ width: 320, height: 250 }),
  stage: Object.freeze({ width: 250, height: 180 }),
  "volume-stage": Object.freeze({ width: 300, height: 220 }),
  unresolved: Object.freeze({ width: 320, height: 250 }),
});

const SUPPORTED_KINDS = new Set(["transformer", "attention", "operator", "residual", "diffusion", "stage", "volume-stage"]);

export function compoundKindForNode(node = {}) {
  if (node.type === "encoder" || node.type === "transformer" || node.compoundKind === "transformer") {
    return "transformer";
  }
  if (node.type === "attention" || node.compoundKind === "attention") {
    return "attention";
  }
  if (node.type === "block" || node.compoundKind === "operator") {
    return "operator";
  }
  if (node.compoundKind === "residual") return "residual";
  if (node.compoundKind === "diffusion") return "diffusion";
  if (node.compoundKind === "stage") return "stage";
  if (node.compoundKind === "volume-stage") return "volume-stage";
  if (node.type === "compound" && SUPPORTED_KINDS.has(node.compoundKind)) {
    return node.compoundKind;
  }
  return "unresolved";
}

export function normalizeCompoundNode(node = {}) {
  const kind = compoundKindForNode(node);
  const isLegacyCompound = node.type === "encoder" || node.type === "attention" || node.type === "block" || node.type === "compound";
  if (!isLegacyCompound) return { ...node };
  const minSize = COMPOUND_MIN_SIZES[kind] || COMPOUND_MIN_SIZES.unresolved;

  return {
    ...node,
    type: "compound",
    compoundKind: kind,
    w: Math.max(Number(node.w) || 0, minSize.width),
    h: Math.max(Number(node.h) || 0, minSize.height),
  };
}

export function getCompoundLayout(node = {}) {
  const normalized = normalizeCompoundNode(node);
  const kind = compoundKindForNode(normalized);
  const minSize = COMPOUND_MIN_SIZES[kind] || COMPOUND_MIN_SIZES.unresolved;
  const width = Math.max(normalized.w || 0, minSize.width);
  const height = Math.max(normalized.h || 0, minSize.height);

  if (kind === "transformer") return transformerLayout(normalized, width, height);
  if (kind === "attention") return attentionLayout(normalized, width, height);
  if (kind === "operator") return operatorLayout(normalized, width, height);
  if (kind === "residual") return residualLayout(normalized, width, height);
  if (kind === "diffusion") return diffusionLayout(normalized, width, height);
  if (kind === "stage") return stageLayout(normalized, width, height);
  if (kind === "volume-stage") return volumeStageLayout(normalized, width, height);

  return {
    kind: "unresolved",
    width,
    height,
    title: normalized.label || "Unresolved module",
    subtitle: normalized.subtitle || "structure requires review",
    repeat: null,
    children: [{
      id: `${normalized.id || "compound"}-unresolved`,
      kind: "unresolved",
      label: normalized.label || "Unresolved module",
      subtitle: "structure requires review",
      x: 20,
      y: 92,
      w: width - 40,
      h: Math.max(70, height - 125),
    }],
    edges: [],
  };
}

function operatorLayout(node, width, height) {
  const id = node.id || "operator";
  const children = [
    child(id, "operator", "operator", node.label || "Operator", "learned transform", 24, 96, 112, 48),
    child(id, "activation", "activation", "Activation", "non-linearity", 154, 96, 92, 48),
    child(id, "projection", "projection", "Output", node.subtitle || "feature state", 256, 96, 48, 48),
  ];
  return {
    kind: "operator",
    width,
    height,
    title: node.label || "Operator module",
    subtitle: node.subtitle || "learned operator chain",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "operator", "activation", "signal"),
      edge(children, "activation", "projection", "signal"),
    ],
  };
}

function residualLayout(node, width, height) {
  const id = node.id || "residual";
  const children = [
    child(id, "norm", "norm", "Norm", "identity", 16, 62, 62, 30),
    child(id, "conv-1", "conv", "1×1", "reduce", 88, 54, 64, 46),
    child(id, "activation", "activation", "ReLU", "non-linearity", 160, 54, 64, 46),
    child(id, "conv-2", "conv", "3×3", "spatial", 232, 54, 64, 46),
    child(id, "projection", "projection", "Shortcut", "identity / proj", 88, 132, 82, 36),
    child(id, "add", "add", "+", "merge", 224, 126, 50, 50),
  ];
  return {
    kind: "residual",
    width,
    height,
    title: node.label || "Residual Block",
    subtitle: node.subtitle || "main branch + shortcut",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "norm", "conv-1", "signal"),
      edge(children, "conv-1", "activation", "signal"),
      edge(children, "activation", "conv-2", "signal"),
      edge(children, "conv-2", "add", "signal"),
      edge(children, "norm", "projection", "residual"),
      edge(children, "projection", "add", "residual"),
    ],
  };
}

function diffusionLayout(node, width, height) {
  const id = node.id || "diffusion";
  const children = [
    child(id, "latent", "latent", "xₜ", "noisy latent", 16, 104, 54, 38),
    child(id, "timestep", "timestep", "t", "time embedding", 84, 48, 82, 32),
    child(id, "condition", "condition", "Cond", "text / class", 84, 166, 82, 32),
    child(id, "attention", "attention", "Cross-Attn", "Q latent · K/V cond", 184, 76, 94, 68),
    child(id, "denoise", "denoise", "Denoise", "U-Net update", 184, 166, 88, 38),
    child(id, "add", "add", "+", "residual", 278, 162, 34, 46),
  ];
  return {
    kind: "diffusion",
    width,
    height,
    title: node.label || "Diffusion Core",
    subtitle: node.subtitle || "latent · timestep · condition",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "latent", "attention", "signal"),
      edge(children, "timestep", "attention", "time"),
      edge(children, "condition", "attention", "condition"),
      edge(children, "attention", "denoise", "signal"),
      edge(children, "denoise", "add", "signal"),
      edge(children, "latent", "add", "residual"),
    ],
  };
}

function stageLayout(node, width, height) {
  const id = node.id || "stage";
  const children = [
    child(id, "conv", "conv", "Conv", "feature", 12, 102, 52, 44),
    child(id, "norm", "norm", "Norm", "stabilize", 72, 102, 52, 44),
    child(id, "activation", "activation", "Act", "ReLU", 132, 102, 52, 44),
    child(id, "projection", "projection", "Out", "tensor", 192, 102, 46, 44),
  ];
  return {
    kind: "stage",
    width,
    height,
    title: node.label || "Feature Stage",
    subtitle: node.subtitle || "Conv · Norm · Activation",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "conv", "norm", "signal"),
      edge(children, "norm", "activation", "signal"),
      edge(children, "activation", "projection", "signal"),
    ],
  };
}

function transformerLayout(node, width, height) {
  const id = node.id || "transformer";
  const children = [
    child(id, "norm-1", "norm", "LayerNorm", "pre-attention", 18, 58, 76, 32),
    child(id, "qkv", "qkv", "Q / K / V", "linear projections", 108, 52, 82, 44),
    child(id, "attention", "attention", "Attention", "softmax(QKᵀ)V", 208, 44, 80, 62),
    child(id, "projection", "projection", "Projection", "output linear", 108, 120, 82, 32),
    child(id, "add-1", "add", "+", "residual", 220, 124, 44, 44),
    child(id, "norm-2", "norm", "LayerNorm", "pre-MLP", 18, 190, 76, 32),
    child(id, "mlp", "mlp", "MLP", "GELU · Linear", 108, 178, 92, 56),
    child(id, "add-2", "add", "+", "residual", 220, 184, 44, 44),
  ];

  return {
    kind: "transformer",
    width,
    height,
    title: node.label || "Transformer Block",
    subtitle: node.subtitle || "LayerNorm · Attention · MLP",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "norm-1", "qkv", "signal"),
      edge(children, "qkv", "attention", "attention"),
      edge(children, "attention", "projection", "signal"),
      edge(children, "projection", "add-1", "signal"),
      edge(children, "qkv", "add-1", "residual"),
      edge(children, "add-1", "norm-2", "signal"),
      edge(children, "norm-2", "mlp", "signal"),
      edge(children, "mlp", "add-2", "signal"),
      edge(children, "add-1", "add-2", "residual"),
    ],
  };
}

function attentionLayout(node, width, height) {
  const id = node.id || "attention";
  const children = [
    child(id, "norm", "norm", "Norm", "query input", 18, 82, 72, 32),
    child(id, "qkv", "qkv", "Q / K / V", "project", 104, 76, 82, 44),
    child(id, "attention", "attention", "Attention", "cross-token weights", 204, 66, 94, 70),
    child(id, "projection", "projection", "Output", "linear", 104, 144, 82, 32),
    child(id, "add", "add", "+", "residual", 222, 140, 44, 44),
  ];

  return {
    kind: "attention",
    width,
    height,
    title: node.label || "Attention",
    subtitle: node.subtitle || "Q · K · V interaction",
    repeat: node.badge || null,
    children,
    edges: [
      edge(children, "norm", "qkv", "signal"),
      edge(children, "qkv", "attention", "attention"),
      edge(children, "attention", "projection", "signal"),
      edge(children, "projection", "add", "signal"),
      edge(children, "qkv", "add", "residual"),
    ],
  };
}

function volumeStageLayout(node, width, height) {
  const id = node.id || "volume-stage";
  const children = [
    child(id, "volume", "volume", "Volume", node.subtitle || "D × H × W", 10, 72, 58, 74, { depth: 14 }),
    child(id, "conv", "conv", "Conv3D", "kernel", 80, 88, 54, 42),
    child(id, "norm", "norm", "Norm", "stabilize", 142, 88, 54, 42),
    child(id, "activation", "activation", "Act", "ReLU", 204, 88, 54, 42),
    child(id, "projection", "projection", "Out", "maps", 266, 88, 28, 42),
  ];
  return {
    kind: "volume-stage",
    width,
    height,
    title: node.label || "3D Volume Stage",
    subtitle: node.subtitle || "volume · Conv3D · Norm · Act",
    repeat: node.badge || repeatLabel(node),
    children,
    edges: [
      edge(children, "volume", "conv", "signal"),
      edge(children, "conv", "norm", "signal"),
      edge(children, "norm", "activation", "signal"),
      edge(children, "activation", "projection", "signal"),
    ],
  };
}

function child(parentId, suffix, kind, label, subtitle, x, y, w, h, extra = {}) {
  return { id: `${parentId}-${suffix}`, kind, label, subtitle, x, y, w, h, ...extra };
}

function edge(children, sourceSuffix, targetSuffix, kind) {
  const source = children.find((item) => item.id.endsWith(`-${sourceSuffix}`));
  const target = children.find((item) => item.id.endsWith(`-${targetSuffix}`));
  return { source: source.id, target: target.id, kind };
}

function repeatLabel(node) {
  const count = Number(node.repeatCount ?? node.layers);
  return Number.isFinite(count) && count > 1 ? `×${count}` : null;
}
