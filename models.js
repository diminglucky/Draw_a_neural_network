export const defaultFigure = figureMeta(
  "Hybrid Vision Transformer Architecture",
  "Editable publication-style diagram: drag modules, reroute links, export SVG/PNG",
  ["Input", "CNN Stem", "Tokenize", "Embedding", "Transformer", "Readout", "Prediction"],
);

export const modelLibrary = [
  { id: "hybrid", title: "Hybrid ViT", description: "视觉 Transformer" },
  { id: "cnn", title: "CNN Stack", description: "卷积网络" },
  { id: "mlp", title: "Dense MLP", description: "全连接网络" },
  { id: "resnet", title: "ResNet", description: "残差网络 · Bottleneck" },
  { id: "unet", title: "U-Net", description: "医学分割 · Skip" },
  { id: "gan", title: "GAN", description: "生成器 · 判别器" },
  { id: "diffusion", title: "Diffusion U-Net", description: "噪声调度 · 条件生成" },
  { id: "unet3d", title: "3D Medical U-Net", description: "体数据 · 3D 卷积" },
];

export const templates = {
  hybrid: () => ({
    figure: figureMeta(
      "Hybrid CNN + Vision Transformer",
      "Feature maps are patchified into token sequences before Transformer encoding",
      ["Image", "Feature Maps", "Patchify", "Tokens", "Transformer", "Classifier"],
    ),
    nodes: [
      createNode("input", "tensor", 260, 650, 120, 190, "Image", "224 x 224 x 3", "#d7c28d", 0, { depth: 24, note: "RGB" }),
      createNode("stem1", "conv", 475, 650, 74, 180, "Conv 7x7", "112 x 112 x 64", "#b86655", 1, { depth: 88, layers: 8, note: "stride 2", channels: "64 maps" }),
      createNode("stem-pool", "pool", 720, 704, 92, 92, "MaxPool", "3 x 3 / 2", "#e6d49a", 1),
      createNode("stem2", "conv", 930, 630, 74, 220, "CNN Stem", "56 x 56 x 128", "#c9855f", 2, { depth: 104, layers: 9, note: "local features", channels: "128 maps" }),
      createNode("patch", "patch-grid", 1220, 625, 188, 188, "Patchify", "14 x 14 grid", "#c7ac64", 3, { badge: "196" }),
      createNode("cls", "token", 1242, 900, 148, 58, "[CLS]", "class token", "#e6d49a", 3),
      createNode("embed", "flatten", 1515, 650, 150, 138, "Linear Embed", "196 x 768", "#9abcb5", 4, { layers: 12 }),
      createNode("encoder", "encoder", 1795, 606, 190, 150, "Transformer", "MHSA + MLP", "#4e8790", 5, { badge: "x12", layers: 6 }),
      createNode("head", "dense-layer", 2150, 620, 134, 200, "MLP Head", "1000 classes", "#31556a", 6, { layers: 8 }),
    ],
    edges: [
      createEdge("input", "stem1", "pixels", "signal"),
      createEdge("stem1", "stem-pool", "pool", "signal"),
      createEdge("stem-pool", "stem2", "feature maps", "signal"),
      createEdge("stem2", "patch", "unfold", "signal"),
      createEdge("patch", "embed", "tokens", "attention"),
      createEdge("cls", "embed", "prepend", "skip"),
      createEdge("embed", "encoder", "sequence", "attention"),
      createEdge("encoder", "head", "CLS", "signal"),
    ],
  }),

  cnn: () => ({
    figure: figureMeta(
      "LeNet-style Convolutional Neural Network",
      "Feature-map stacks, pooling operators, flatten vector, dense classifier",
      ["Input", "Conv", "Pool", "Conv", "Pool", "Flatten", "Dense", "Softmax"],
    ),
    nodes: [
      createNode("cnn-input", "tensor", 275, 660, 116, 170, "Image", "32 x 32 x 1", "#d7c28d", 0, { depth: 18, note: "pixels" }),
      createNode("conv1", "conv", 520, 660, 82, 170, "C1 Conv", "28 x 28 x 6", "#b86655", 1, { depth: 86, layers: 6, note: "5 x 5 kernels", channels: "6 maps" }),
      createNode("pool1", "pool", 785, 702, 92, 92, "S2 Pool", "14 x 14 x 6", "#e6d49a", 2),
      createNode("conv2", "conv", 1030, 628, 78, 220, "C3 Conv", "10 x 10 x 16", "#c9855f", 3, { depth: 112, layers: 9, note: "5 x 5 kernels", channels: "16 maps" }),
      createNode("pool2", "pool", 1320, 704, 92, 92, "S4 Pool", "5 x 5 x 16", "#e6d49a", 4),
      createNode("flat", "flatten", 1570, 648, 154, 150, "Flatten", "400-d vector", "#9abcb5", 5, { layers: 13 }),
      createNode("fc1", "dense-layer", 1845, 625, 132, 220, "FC 120", "tanh / ReLU", "#4e8790", 6, { layers: 7 }),
      createNode("fc2", "dense-layer", 2080, 642, 118, 190, "FC 84", "classifier", "#6fa3a0", 7, { layers: 6 }),
      createNode("cnn-output", "output", 2310, 665, 110, 148, "Softmax", "10 classes", "#31556a", 8),
    ],
    edges: [
      createEdge("cnn-input", "conv1", "convolve", "signal"),
      createEdge("conv1", "pool1", "subsample", "signal"),
      createEdge("pool1", "conv2", "feature maps", "signal"),
      createEdge("conv2", "pool2", "subsample", "signal"),
      createEdge("pool2", "flat", "flatten", "attention"),
      createEdge("flat", "fc1", "400", "signal"),
      createEdge("fc1", "fc2", "120", "signal"),
      createEdge("fc2", "cnn-output", "logits", "signal"),
    ],
  }),

  mlp: () => {
    const nodes = [];
    const layers = [4, 6, 6, 3];
    const labels = ["Input", "Hidden I", "Hidden II", "Output"];
    layers.forEach((count, layerIndex) => {
      const x = 430 + layerIndex * 520;
      const startY = 760 - (count - 1) * 46;
      for (let i = 0; i < count; i += 1) {
        nodes.push(createNode(`l${layerIndex}n${i}`, "neuron", x, startY + i * 92, 64, 64, labels[layerIndex], `n${i + 1}`, layerIndex === 3 ? "#31556a" : "#b86655", layerIndex));
      }
    });

    const edges = [];
    for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
      for (let i = 0; i < layers[layerIndex]; i += 1) {
        for (let j = 0; j < layers[layerIndex + 1]; j += 1) {
          edges.push(createEdge(`l${layerIndex}n${i}`, `l${layerIndex + 1}n${j}`, "", "signal"));
        }
      }
    }
    return {
      figure: figureMeta(
        "Dense Multi-Layer Perceptron",
        "Editable fully-connected network with visible neuron layers and dense connections",
        ["Input", "Hidden I", "Hidden II", "Output"],
      ),
      nodes,
      edges,
    };
  },

  resnet: () => ({
    figure: figureMeta(
      "ResNet Bottleneck Architecture",
      "Residual feature-map stages with explicit identity/projection skip paths",
      ["Input", "Stem", "Block 1", "Add", "Block 2", "Pool", "Head"],
    ),
    nodes: [
      createNode("res-input", "tensor", 270, 660, 120, 180, "Input", "224 x 224 x 3", "#d7c28d", 0, { depth: 22, note: "RGB" }),
      createNode("res-stem", "conv", 500, 650, 78, 190, "7x7 Conv", "112 x 112 x 64", "#b86655", 1, { depth: 92, layers: 8, note: "BN + ReLU", channels: "64 maps" }),
      createNode("res-pool0", "pool", 760, 704, 92, 92, "MaxPool", "56 x 56 x 64", "#e6d49a", 1),
      createNode("res-b1a", "conv", 1010, 610, 72, 230, "1x1", "64", "#c9855f", 2, { depth: 84, layers: 6, note: "reduce", channels: "64 maps" }),
      createNode("res-b1b", "conv", 1260, 610, 72, 230, "3x3", "64", "#c9855f", 2, { depth: 84, layers: 6, note: "spatial", channels: "64 maps" }),
      createNode("res-add1", "concat", 1538, 686, 82, 82, "Add", "identity", "#e6d49a", 3),
      createNode("res-b2", "conv", 1775, 580, 74, 270, "Bottleneck x4", "28 x 28 x 128", "#4e8790", 4, { depth: 110, layers: 9, note: "projection", channels: "128 maps" }),
      createNode("res-gap", "pool", 2070, 704, 92, 92, "AvgPool", "1 x 1 x 2048", "#9abcb5", 5),
      createNode("res-head", "dense-layer", 2305, 630, 112, 210, "FC", "classes", "#31556a", 6, { layers: 7 }),
    ],
    edges: [
      createEdge("res-input", "res-stem", "pixels", "signal"),
      createEdge("res-stem", "res-pool0", "pool", "signal"),
      createEdge("res-pool0", "res-b1a", "feature", "signal"),
      createEdge("res-b1a", "res-b1b", "conv", "signal"),
      createEdge("res-b1b", "res-add1", "residual", "signal"),
      createEdge("res-pool0", "res-add1", "identity", "skip"),
      createEdge("res-add1", "res-b2", "stage 3", "signal"),
      createEdge("res-b2", "res-gap", "global pool", "signal"),
      createEdge("res-gap", "res-head", "logits", "signal"),
    ],
  }),

  unet: () => ({
    figure: figureMeta(
      "U-Net Encoder-Decoder Segmentation Network",
      "Symmetric feature-map pyramid with explicit concat nodes and long skip paths",
      ["Input", "Encoder", "Downsample", "Bottleneck", "Upsample", "Concat", "Mask"],
    ),
    nodes: [
      createNode("unet-input", "tensor", 255, 660, 122, 188, "Image", "512 x 512", "#d7c28d", 0, { depth: 22 }),
      createNode("unet-e1", "conv", 505, 620, 76, 245, "Conv 64", "512 x 512", "#b86655", 1, { depth: 92, layers: 8, note: "copy", channels: "64 maps" }),
      createNode("unet-p1", "pool", 760, 702, 90, 90, "MaxPool", "256 x 256", "#e6d49a", 2),
      createNode("unet-e2", "conv", 1000, 580, 74, 315, "Conv 128", "256 x 256", "#c9855f", 3, { depth: 118, layers: 9, note: "copy", channels: "128 maps" }),
      createNode("unet-b", "volume-stack", 1285, 620, 138, 230, "Bottleneck", "1024", "#4e8790", 4, { depth: 126, layers: 6, note: "semantic core" }),
      createNode("unet-cat2", "concat", 1610, 684, 82, 82, "Concat", "skip e2", "#e6d49a", 5),
      createNode("unet-d2", "conv", 1785, 580, 74, 315, "UpConv 128", "256 x 256", "#6fa3a0", 6, { depth: 118, layers: 9, note: "decode", channels: "128 maps" }),
      createNode("unet-cat1", "concat", 2050, 698, 78, 78, "Concat", "skip e1", "#e6d49a", 7),
      createNode("unet-d1", "conv", 2190, 620, 68, 245, "UpConv 64", "512 x 512", "#9abcb5", 8, { depth: 92, layers: 8, note: "decode", channels: "64 maps" }),
      createNode("unet-mask", "output", 2410, 660, 92, 150, "Mask", "H x W x C", "#31556a", 9),
    ],
    edges: [
      createEdge("unet-input", "unet-e1", "", "signal"),
      createEdge("unet-e1", "unet-p1", "down", "signal"),
      createEdge("unet-p1", "unet-e2", "feature", "signal"),
      createEdge("unet-e2", "unet-b", "down", "signal"),
      createEdge("unet-b", "unet-cat2", "up", "signal"),
      createEdge("unet-e2", "unet-cat2", "copy & crop", "skip"),
      createEdge("unet-cat2", "unet-d2", "concat", "attention"),
      createEdge("unet-d2", "unet-cat1", "up", "signal"),
      createEdge("unet-e1", "unet-cat1", "copy & crop", "skip"),
      createEdge("unet-cat1", "unet-d1", "concat", "attention"),
      createEdge("unet-d1", "unet-mask", "1x1 conv", "signal"),
    ],
  }),

  gan: () => ({
    figure: figureMeta(
      "Generative Adversarial Network",
      "Latent generator and discriminator adversarial loop with real/fake supervision",
      ["Latent", "Generator", "Synthetic", "Discriminator", "Decision", "Real Data", "Loss"],
    ),
    nodes: [
      createNode("gan-z", "token", 290, 676, 156, 70, "Latent z", "N(0, I)", "#e6d49a", 0),
      createNode("gan-g1", "block", 600, 620, 176, 128, "Generator", "MLP / ConvTranspose", "#9abcb5", 1, { note: "learns p(x)" }),
      createNode("gan-img", "tensor", 935, 625, 150, 180, "Fake Image", "G(z)", "#d7c28d", 2, { depth: 28 }),
      createNode("gan-disc", "conv", 1285, 600, 104, 260, "Discriminator", "CNN classifier", "#b86655", 3, { depth: 74, layers: 5 }),
      createNode("gan-score", "output", 1645, 650, 118, 148, "Real / Fake", "D(x)", "#31556a", 4),
      createNode("gan-real", "tensor", 935, 925, 150, 150, "Real Data", "dataset x", "#c7ac64", 5, { depth: 22 }),
      createNode("gan-loss", "attention", 1985, 650, 180, 128, "Adversarial Loss", "minimax", "#4e8790", 6),
    ],
    edges: [
      createEdge("gan-z", "gan-g1", "sample", "signal"),
      createEdge("gan-g1", "gan-img", "generate", "attention"),
      createEdge("gan-img", "gan-disc", "fake", "signal"),
      createEdge("gan-real", "gan-disc", "real", "skip"),
      createEdge("gan-disc", "gan-score", "probability", "signal"),
      createEdge("gan-score", "gan-loss", "feedback", "attention"),
      createEdge("gan-loss", "gan-g1", "gradient", "skip"),
    ],
  }),

  diffusion: () => ({
    figure: figureMeta(
      "Conditional Diffusion U-Net",
      "Noisy latent denoising network with timestep embedding and cross-attention conditioning",
      ["Noise", "Time", "Condition", "Down", "Cross-Attn", "Concat", "Denoised"],
    ),
    nodes: [
      createNode("diff-x", "tensor", 260, 660, 126, 186, "Noisy x_t", "latent / image", "#d7c28d", 0, { depth: 24 }),
      createNode("diff-t", "token", 505, 918, 150, 58, "timestep", "sin/cos embed", "#e6d49a", 1),
      createNode("diff-cond", "token", 505, 538, 168, 64, "Text / Class", "conditioning", "#e6d49a", 1),
      createNode("diff-enc", "conv", 760, 595, 80, 300, "Down ResBlock", "latent maps", "#b86655", 2, { depth: 108, layers: 9, note: "self-attn", channels: "C maps" }),
      createNode("diff-pool", "pool", 1055, 702, 92, 92, "Down", "stride 2", "#e6d49a", 3),
      createNode("diff-mid", "attention", 1305, 635, 205, 140, "Cross-Attn", "Q image · K/V text", "#4e8790", 4, { note: "condition" }),
      createNode("diff-cat", "concat", 1625, 684, 82, 82, "Concat", "skip", "#e6d49a", 5),
      createNode("diff-dec", "conv", 1810, 595, 80, 300, "Up ResBlock", "skip + res", "#6fa3a0", 6, { depth: 108, layers: 9, note: "upsample", channels: "C maps" }),
      createNode("diff-out", "output", 2210, 650, 124, 150, "epsilon theta", "predicted noise", "#31556a", 7),
    ],
    edges: [
      createEdge("diff-x", "diff-enc", "x_t", "signal"),
      createEdge("diff-t", "diff-enc", "time add", "skip"),
      createEdge("diff-cond", "diff-mid", "cross attention", "attention"),
      createEdge("diff-enc", "diff-pool", "down", "signal"),
      createEdge("diff-pool", "diff-mid", "latent", "signal"),
      createEdge("diff-mid", "diff-cat", "up", "signal"),
      createEdge("diff-enc", "diff-cat", "skip features", "skip"),
      createEdge("diff-cat", "diff-dec", "concat", "attention"),
      createEdge("diff-dec", "diff-out", "denoise", "attention"),
    ],
  }),

  unet3d: () => ({
    figure: figureMeta(
      "3D Medical U-Net Volume Segmentation",
      "Volumetric CT/MRI encoder-decoder with 3D convolution blocks and depth-aware skip paths",
      ["Volume", "3D Enc I", "3D Enc II", "Latent Cube", "3D Dec II", "3D Dec I", "Segmentation"],
    ),
    nodes: [
      createNode("vol-input", "volume", 250, 650, 145, 210, "CT Volume", "128 x 128 x 96", "#d7c28d", 0, { depth: 78, z: 58, note: "D x H x W" }),
      createNode("vol-e1", "volume-stack", 525, 610, 108, 250, "3D Conv", "32 channels", "#b86655", 1, { depth: 105, z: 72, layers: 6, note: "downsample" }),
      createNode("vol-e2", "volume-stack", 875, 560, 102, 310, "3D Conv", "64 channels", "#c9855f", 2, { depth: 132, z: 88, layers: 7, note: "pool" }),
      createNode("vol-core", "volume", 1235, 610, 165, 210, "Latent Cube", "128 channels", "#4e8790", 3, { depth: 150, z: 96, note: "context" }),
      createNode("vol-cat2", "concat", 1570, 680, 82, 82, "Concat", "vol skip", "#e6d49a", 4),
      createNode("vol-d2", "volume-stack", 1740, 560, 102, 310, "3D UpConv", "64 channels", "#6fa3a0", 5, { depth: 132, z: 88, layers: 7, note: "decode" }),
      createNode("vol-cat1", "concat", 2075, 690, 78, 78, "Concat", "vol skip", "#e6d49a", 6),
      createNode("vol-d1", "volume-stack", 2215, 610, 108, 250, "3D UpConv", "32 channels", "#9abcb5", 7, { depth: 105, z: 72, layers: 6, note: "decode" }),
      createNode("vol-mask", "volume", 2395, 650, 100, 190, "Mask", "labels", "#31556a", 8, { depth: 56, z: 42, note: "1x1x1" }),
    ],
    edges: [
      createEdge("vol-input", "vol-e1", "voxels", "signal"),
      createEdge("vol-e1", "vol-e2", "3D pool", "signal"),
      createEdge("vol-e2", "vol-core", "compress", "signal"),
      createEdge("vol-core", "vol-cat2", "3D up", "signal"),
      createEdge("vol-e2", "vol-cat2", "vol skip", "skip"),
      createEdge("vol-cat2", "vol-d2", "concat", "attention"),
      createEdge("vol-d2", "vol-cat1", "3D up", "signal"),
      createEdge("vol-e1", "vol-cat1", "vol skip", "skip"),
      createEdge("vol-cat1", "vol-d1", "concat", "attention"),
      createEdge("vol-d1", "vol-mask", "1x1x1", "attention"),
    ],
  }),
};

export function createTemplate(name) {
  return templates[name]?.();
}

export function createNode(id, type, x, y, w, h, label, subtitle, color, stage = 0, extras = {}) {
  return { id, type, x, y, w, h, label, subtitle, color, stage, ...extras };
}

export function createEdge(source, target, label = "", type = "signal") {
  return {
    id: `e-${source}-${target}-${Math.random().toString(16).slice(2, 7)}`,
    source,
    target,
    label,
    type,
    color: type === "skip" ? "#a98743" : type === "attention" ? "#2d6978" : "#56666d",
  };
}

function figureMeta(title, subtitle, stages) {
  return { title, subtitle, stages };
}
