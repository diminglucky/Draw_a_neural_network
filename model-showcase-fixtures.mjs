const n = (id, family, op, extra = {}) => ({ id, family, op, confidence: 1, ...extra });
const e = (id, source, target, extra = {}) => ({ id, source, target, confidence: 1, ...extra });

function fixture(name, title, subtitle, capabilities, expectedKinds, nodes, edges) {
  return {
    name,
    title,
    subtitle,
    capabilities,
    expectedKinds,
    ir: {
      source: { kind: "reference", name: title },
      figure: { title, subtitle },
      nodes,
      edges,
    },
  };
}

const resnetBlock = fixture(
  "resnet-block",
  "ResNet Residual Block",
  "Canonical bottleneck-style residual path",
  ["residual-cnn", "skip-connection", "batch-norm"],
  ["residual-block"],
  [
    n("input", "input", "FeatureMap"),
    n("conv1", "conv", "Conv2d"),
    n("bn1", "norm", "BatchNorm2d"),
    n("relu1", "activation", "ReLU"),
    n("conv2", "conv", "Conv2d"),
    n("bn2", "norm", "BatchNorm2d"),
    n("add", "merge", "Add", { semanticRole: "add" }),
    n("relu2", "activation", "ReLU"),
    n("output", "output", "FeatureMap"),
  ],
  [
    e("e1", "input", "conv1"),
    e("e2", "conv1", "bn1"),
    e("e3", "bn1", "relu1"),
    e("e4", "relu1", "conv2"),
    e("e5", "conv2", "bn2"),
    e("e6", "bn2", "add"),
    e("e7", "input", "add", { type: "residual" }),
    e("e8", "add", "relu2"),
    e("e9", "relu2", "output"),
  ],
);

const unet = fixture(
  "unet",
  "U-Net",
  "Encoder, bottleneck and decoder with skip fusion",
  ["medical-segmentation", "encoder-decoder", "skip-connection"],
  ["encoder-stage", "conv-block", "detection-head"],
  [
    n("image", "input", "Image", { attributes: { dataDomain: "spatial" } }),
    n("enc-conv", "conv", "DoubleConv"),
    n("down", "pool", "MaxPool2d"),
    n("bottleneck", "conv", "BottleneckConv"),
    n("up", "upsample", "Upsample"),
    n("dec-conv", "conv", "DecoderConv"),
    n("fusion", "merge", "Concat", { semanticRole: "concat" }),
    n("head", "conv", "SegmentationHead"),
    n("output", "output", "Mask"),
  ],
  [
    e("e1", "image", "enc-conv"),
    e("e2", "enc-conv", "down"),
    e("e3", "down", "bottleneck"),
    e("e4", "bottleneck", "up"),
    e("e5", "up", "fusion", { type: "cross-scale" }),
    e("e6", "fusion", "dec-conv"),
    e("e7", "enc-conv", "fusion", { type: "skip" }),
    e("e8", "dec-conv", "head"),
    e("e9", "head", "output"),
  ],
);
unet.ir.projection = "full";

const transformer = fixture(
  "transformer",
  "Transformer Encoder Block",
  "Self-attention and feed-forward sublayers",
  ["transformer", "attention", "feed-forward"],
  ["attention-block", "ffn-block"],
  [
    n("tokens", "input", "TokenEmbedding", { attributes: { dataDomain: "sequence" } }),
    n("attn", "attention", "MultiheadAttention"),
    n("norm1", "norm", "LayerNorm"),
    n("ffn1", "dense", "Linear"),
    n("gelu", "activation", "GELU"),
    n("ffn2", "dense", "Linear"),
    n("add", "merge", "Add", { semanticRole: "add" }),
    n("output", "output", "TokenStates"),
  ],
  [
    e("e1", "tokens", "attn"),
    e("e2", "attn", "norm1"),
    e("e3", "norm1", "ffn1"),
    e("e4", "ffn1", "gelu"),
    e("e5", "gelu", "ffn2"),
    e("e6", "ffn2", "add"),
    e("e7", "tokens", "add", { type: "residual" }),
    e("e8", "add", "output"),
  ],
);

const vit = fixture(
  "vit",
  "Vision Transformer",
  "Patch embedding, attention and MLP head",
  ["vision-transformer", "patch-embedding", "attention"],
  ["conv-block", "attention-block", "ffn-block", "detection-head"],
  [
    n("image", "input", "Image", { attributes: { dataDomain: "spatial" } }),
    n("patch", "conv", "PatchEmbedding"),
    n("flatten", "flatten", "TokenFlatten"),
    n("attn", "attention", "MultiheadAttention"),
    n("norm", "norm", "LayerNorm"),
    n("mlp1", "dense", "Linear"),
    n("gelu", "activation", "GELU"),
    n("mlp2", "dense", "Linear"),
    n("head", "dense", "ClassifierHead"),
    n("output", "output", "ClassLogits"),
  ],
  [
    e("e1", "image", "patch"),
    e("e2", "patch", "flatten"),
    e("e3", "flatten", "attn"),
    e("e4", "attn", "norm"),
    e("e5", "norm", "mlp1"),
    e("e6", "mlp1", "gelu"),
    e("e7", "gelu", "mlp2"),
    e("e8", "mlp2", "head"),
    e("e9", "head", "output"),
  ],
);

const clip = fixture(
  "clip",
  "CLIP Dual Encoder",
  "Image and text towers with projection heads",
  ["multimodal", "contrastive-learning", "dual-encoder"],
  ["conv-block", "attention-block", "ffn-block", "detection-head"],
  [
    n("image", "input", "Image", { attributes: { dataDomain: "spatial" } }),
    n("vision", "conv", "VisionEncoder"),
    n("vision-proj", "dense", "ImageProjection"),
    n("image-embedding", "output", "ImageEmbedding"),
    n("text", "input", "Text", { attributes: { dataDomain: "sequence" } }),
    n("text-embed", "dense", "TextEmbedding"),
    n("text-encoder", "attention", "TextTransformer"),
    n("text-norm", "norm", "LayerNorm"),
    n("text-proj", "dense", "TextProjection"),
    n("text-embedding", "output", "TextEmbedding"),
  ],
  [
    e("e1", "image", "vision"),
    e("e2", "vision", "vision-proj"),
    e("e3", "vision-proj", "image-embedding"),
    e("e4", "text", "text-embed"),
    e("e5", "text-embed", "text-encoder"),
    e("e6", "text-encoder", "text-norm"),
    e("e7", "text-norm", "text-proj"),
    e("e8", "text-proj", "text-embedding"),
  ],
);

const detr = fixture(
  "detr",
  "DETR",
  "CNN backbone, transformer encoder-decoder and object queries",
  ["detection", "transformer", "object-queries"],
  ["conv-block", "attention-block", "ffn-block", "detection-head"],
  [
    n("image", "input", "Image", { attributes: { dataDomain: "spatial" } }),
    n("backbone", "conv", "CNNBackbone"),
    n("encoder", "attention", "TransformerEncoder"),
    n("enc-norm", "norm", "LayerNorm"),
    n("enc-ffn", "dense", "FeedForward"),
    n("queries", "input", "ObjectQueries", { attributes: { dataDomain: "sequence" } }),
    n("query-proj", "dense", "QueryProjection"),
    n("decoder", "attention", "TransformerDecoder"),
    n("dec-norm", "norm", "LayerNorm"),
    n("head", "dense", "DetectionHead"),
    n("output", "output", "BoxesAndClasses"),
  ],
  [
    e("e1", "image", "backbone"),
    e("e2", "backbone", "encoder"),
    e("e3", "encoder", "enc-norm"),
    e("e4", "enc-norm", "enc-ffn"),
    e("e5", "queries", "query-proj"),
    e("e6", "enc-ffn", "decoder"),
    e("e7", "query-proj", "decoder"),
    e("e8", "decoder", "dec-norm"),
    e("e9", "dec-norm", "head"),
    e("e10", "head", "output"),
  ],
);

const lstm = fixture(
  "lstm",
  "LSTM Sequence Model",
  "Recurrent state path with classification head",
  ["recurrent", "sequence-modeling", "state-feedback"],
  ["recurrent-cell", "ffn-block", "detection-head"],
  [
    n("sequence", "input", "Sequence", { attributes: { dataDomain: "sequence" } }),
    n("cell", "recurrent", "LSTMCell", { ports: { inputs: ["x", "state"], outputs: ["y", "state"] } }),
    n("dense", "dense", "Classifier"),
    n("output", "output", "Logits"),
  ],
  [
    e("e1", "sequence", "cell"),
    e("e2", "cell", "cell", { type: "state", ports: { source: "state", target: "state" } }),
    e("e3", "cell", "dense"),
    e("e4", "dense", "output"),
  ],
);

const gcn = fixture(
  "gcn",
  "Graph Neural Network",
  "Message passing followed by node classification",
  ["gnn", "message-passing", "node-classification"],
  ["graph-block", "ffn-block", "detection-head"],
  [
    n("graph", "input", "Graph", { attributes: { dataDomain: "graph" } }),
    n("gcn1", "graph", "GCNConv"),
    n("gcn2", "graph", "GATConv"),
    n("norm", "norm", "GraphNorm"),
    n("classifier", "dense", "NodeClassifier"),
    n("output", "output", "NodeLogits"),
  ],
  [
    e("e1", "graph", "gcn1"),
    e("e2", "gcn1", "gcn2"),
    e("e3", "gcn2", "norm"),
    e("e4", "norm", "classifier"),
    e("e5", "classifier", "output"),
  ],
);

const gan = fixture(
  "gan",
  "Generative Adversarial Network",
  "Generator and discriminator branches",
  ["generative", "adversarial", "multi-head"],
  ["ffn-block", "decoder-stage", "detection-head"],
  [
    n("noise", "input", "LatentNoise", { attributes: { dataDomain: "vector" } }),
    n("gen-fc", "dense", "GeneratorProjection"),
    n("gen-up", "upsample", "Upsample"),
    n("gen-conv", "conv", "GeneratorConv"),
    n("generated", "output", "GeneratedImage"),
    n("real", "input", "Image", { attributes: { dataDomain: "spatial" } }),
    n("disc-conv", "conv", "DiscriminatorConv"),
    n("disc-fc", "dense", "DiscriminatorHead"),
    n("score", "output", "RealFakeScore"),
  ],
  [
    e("e1", "noise", "gen-fc"),
    e("e2", "gen-fc", "gen-up"),
    e("e3", "gen-up", "gen-conv"),
    e("e4", "gen-conv", "generated"),
    e("e5", "real", "disc-conv"),
    e("e6", "disc-conv", "disc-fc"),
    e("e7", "disc-fc", "score"),
  ],
);

const diffusionUnet = fixture(
  "diffusion-unet",
  "Diffusion U-Net",
  "Timestep-conditioned denoising encoder-decoder",
  ["diffusion", "unet", "timestep-conditioning"],
  ["encoder-stage", "decoder-stage", "attention-block"],
  [
    n("image", "input", "NoisyLatent", { attributes: { dataDomain: "spatial" } }),
    n("timestep", "input", "Timestep", { attributes: { dataDomain: "vector" } }),
    n("time-embed", "dense", "TimestepEmbedding"),
    n("condition", "merge", "ConditionInjection"),
    n("down", "conv", "DownBlock"),
    n("pool", "pool", "Downsample"),
    n("mid-attn", "attention", "SpatialSelfAttention"),
    n("up", "upsample", "Upsample"),
    n("decoder", "conv", "UpBlock"),
    n("skip", "merge", "SkipConcat", { semanticRole: "concat" }),
    n("head", "conv", "NoiseHead"),
    n("output", "output", "PredictedNoise"),
  ],
  [
    e("e1", "image", "condition"),
    e("e2", "timestep", "time-embed"),
    e("e3", "time-embed", "condition"),
    e("e4", "condition", "down"),
    e("e5", "down", "pool"),
    e("e6", "pool", "mid-attn"),
    e("e7", "mid-attn", "up"),
    e("e8", "up", "decoder"),
    e("e9", "decoder", "skip", { type: "cross-scale" }),
    e("e10", "down", "skip", { type: "skip" }),
    e("e11", "skip", "head"),
    e("e12", "head", "output"),
  ],
);
diffusionUnet.ir.projection = "full";

const moeTransformer = fixture(
  "moe-transformer",
  "Mixture-of-Experts Transformer",
  "Attention followed by routed expert branches",
  ["transformer", "mixture-of-experts", "routing"],
  ["attention-block", "moe-block", "detection-head"],
  [
    n("tokens", "input", "Tokens", { attributes: { dataDomain: "sequence" } }),
    n("attn", "attention", "MultiheadAttention"),
    n("norm", "norm", "LayerNorm"),
    n("router", "dense", "Router"),
    n("expert1", "dense", "ExpertLinear"),
    n("expert2", "dense", "ExpertLinear"),
    n("expert3", "dense", "ExpertLinear"),
    n("merge", "merge", "WeightedAdd"),
    n("output", "output", "TokenStates"),
  ],
  [
    e("e1", "tokens", "attn"),
    e("e2", "attn", "norm"),
    e("e3", "norm", "router"),
    e("e4", "router", "expert1", { type: "route" }),
    e("e5", "router", "expert2", { type: "route" }),
    e("e6", "router", "expert3", { type: "route" }),
    e("e7", "expert1", "merge", { type: "expert" }),
    e("e8", "expert2", "merge", { type: "expert" }),
    e("e9", "expert3", "merge", { type: "expert" }),
    e("e10", "merge", "output"),
  ],
);

const graphcast = fixture(
  "graphcast",
  "GraphCast",
  "Graph encoder, processor and decoder for weather fields",
  ["gnn", "weather", "message-passing"],
  ["graph-block", "ffn-block", "detection-head"],
  [
    n("state", "input", "WeatherGraph", { attributes: { dataDomain: "graph" } }),
    n("encoder", "graph", "GraphEncoder"),
    n("processor1", "graph", "GraphProcessor"),
    n("processor2", "graph", "GraphProcessor"),
    n("decoder", "graph", "GraphDecoder"),
    n("projection", "dense", "FieldProjection"),
    n("output", "output", "ForecastFields"),
  ],
  [
    e("e1", "state", "encoder"),
    e("e2", "encoder", "processor1"),
    e("e3", "processor1", "processor2"),
    e("e4", "processor2", "decoder"),
    e("e5", "decoder", "projection"),
    e("e6", "projection", "output"),
  ],
);

const swin = fixture(
  "swin-transformer",
  "Swin Transformer",
  "Hierarchical window attention with patch merging",
  ["vision-transformer", "window-attention", "hierarchical"],
  ["conv-block", "attention-block", "ffn-block", "detection-head"],
  [
    n("image", "input", "Image", { attributes: { dataDomain: "spatial" } }),
    n("patch", "conv", "PatchEmbedding"),
    n("stage1", "attention", "WindowAttention"),
    n("norm1", "norm", "LayerNorm"),
    n("merge", "pool", "PatchMerging"),
    n("stage2", "attention", "WindowAttention"),
    n("norm2", "norm", "LayerNorm"),
    n("head", "dense", "ClassifierHead"),
    n("output", "output", "ClassLogits"),
  ],
  [
    e("e1", "image", "patch"),
    e("e2", "patch", "stage1"),
    e("e3", "stage1", "norm1"),
    e("e4", "norm1", "merge"),
    e("e5", "merge", "stage2"),
    e("e6", "stage2", "norm2"),
    e("e7", "norm2", "head"),
    e("e8", "head", "output"),
  ],
);
swin.ir.projection = "full";

// YOLO 式检测器：骨干多尺度特征 → 金字塔颈(FPN/PANet) → 三个尺度各挂一个检测头。
// 这是「detection-pyramid」原型唯一的端到端样本——此前该家族只有合成单元测试，
// 真实流水线上从未验证过，所以补齐。
const yolo = fixture(
  "yolo",
  "YOLO Detector",
  "Backbone, FPN/PANet neck and multi-scale detection heads",
  ["object-detection", "multi-scale-pyramid", "fpn-neck"],
  ["conv-block", "multi-scale-fusion", "detection-head"],
  [
    n("image", "input", "Image", { attributes: { dataDomain: "spatial" } }),
    n("stem", "conv", "ConvStem"),
    n("c3", "conv", "C3Block"),
    n("c4", "conv", "C4Block"),
    n("c5", "conv", "C5Block"),
    n("fpn", "merge", "FeaturePyramid", { semanticRole: "concat" }),
    n("pan", "merge", "PathAggregation", { semanticRole: "concat" }),
    n("head-p3", "conv", "DetectHeadP3"),
    n("head-p4", "conv", "DetectHeadP4"),
    n("head-p5", "conv", "DetectHeadP5"),
    n("out-p3", "output", "PredictionsP3"),
    n("out-p4", "output", "PredictionsP4"),
    n("out-p5", "output", "PredictionsP5"),
  ],
  [
    e("e1", "image", "stem"),
    e("e2", "stem", "c3"),
    e("e3", "c3", "c4"),
    e("e4", "c4", "c5"),
    e("e5", "c3", "fpn", { type: "cross-scale" }),
    e("e6", "c4", "fpn", { type: "cross-scale" }),
    e("e7", "c5", "fpn", { type: "cross-scale" }),
    e("e8", "fpn", "pan"),
    e("e9", "pan", "head-p3"),
    e("e10", "pan", "head-p4"),
    e("e11", "pan", "head-p5"),
    e("e12", "head-p3", "out-p3"),
    e("e13", "head-p4", "out-p4"),
    e("e14", "head-p5", "out-p5"),
  ],
);
yolo.ir.projection = "full";

export const architectureShowcaseFixtures = Object.freeze([
  resnetBlock,
  unet,
  transformer,
  vit,
  yolo,
  clip,
  detr,
  lstm,
  gcn,
  gan,
  diffusionUnet,
  moeTransformer,
  graphcast,
  swin,
]);

export const pendingArchitectureShowcaseFixtures = Object.freeze([]);

export function showcaseNames() {
  return architectureShowcaseFixtures.map((item) => item.name);
}

export function findShowcaseFixture(name) {
  return architectureShowcaseFixtures.find((item) => item.name === name) || null;
}
