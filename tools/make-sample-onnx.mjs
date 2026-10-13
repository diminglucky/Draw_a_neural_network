// 合成真实的 ONNX 计算图，用于在没有 torch 的环境下端到端验证「ONNX 直通」链路。
// 这些图刻意保留逐算子的节点、声明的张量形状与残差/多尺度分支，
// 以便验证 full 投影确实画出了真实算子链，而不是被折叠成几个大方块。
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import onnxProto from "onnx-proto";

const { onnx } = onnxProto;

// 每个模型用一个紧凑的声明式描述：节点 + 张量形状。
// dims 写在节点上表示「该节点第一个输出的形状」，与真实 ONNX 一致。
const MODELS = {
  "resnet18-lite": {
    title: "ResNet-18 残差主干（lite）",
    input: { name: "image", dims: [1, 3, 224, 224] },
    output: { name: "logits", dims: [1, 1000] },
    nodes: [
      node("Conv_0", "Conv", ["image"], [1, 64, 112, 112], { kernel_shape: [7, 7], strides: [2, 2], pads: [3, 3, 3, 3] }),
      node("BatchNorm_1", "BatchNormalization", ["Conv_0"], [1, 64, 112, 112], { epsilon: 1e-5 }),
      node("Relu_2", "Relu", ["BatchNorm_1"], [1, 64, 112, 112]),
      node("MaxPool_3", "MaxPool", ["Relu_2"], [1, 64, 56, 56], { kernel_shape: [3, 3], strides: [2, 2], pads: [1, 1, 1, 1] }),
      node("Conv_4", "Conv", ["MaxPool_3"], [1, 64, 56, 56], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("BatchNorm_5", "BatchNormalization", ["Conv_4"], [1, 64, 56, 56], { epsilon: 1e-5 }),
      node("Relu_6", "Relu", ["BatchNorm_5"], [1, 64, 56, 56]),
      node("Conv_7", "Conv", ["Relu_6"], [1, 64, 56, 56], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("BatchNorm_8", "BatchNormalization", ["Conv_7"], [1, 64, 56, 56], { epsilon: 1e-5 }),
      node("Add_9", "Add", ["BatchNorm_8", "MaxPool_3"], [1, 64, 56, 56]),
      node("Relu_10", "Relu", ["Add_9"], [1, 64, 56, 56]),
      node("Conv_11", "Conv", ["Relu_10"], [1, 128, 28, 28], { kernel_shape: [3, 3], strides: [2, 2], pads: [1, 1, 1, 1] }),
      node("BatchNorm_12", "BatchNormalization", ["Conv_11"], [1, 128, 28, 28], { epsilon: 1e-5 }),
      node("Relu_13", "Relu", ["BatchNorm_12"], [1, 128, 28, 28]),
      node("GlobalAveragePool_14", "GlobalAveragePool", ["Relu_13"], [1, 128, 1, 1]),
      node("Flatten_15", "Flatten", ["GlobalAveragePool_14"], [1, 128], { axis: 1 }),
      node("Gemm_16", "Gemm", ["Flatten_15"], [1, 1000], { alpha: 1, beta: 1, transB: 1 }),
    ],
  },
  "unet-lite": {
    title: "U-Net 编码器-解码器（lite）",
    input: { name: "image", dims: [1, 3, 256, 256] },
    output: { name: "mask", dims: [1, 2, 256, 256] },
    nodes: [
      node("Conv_0", "Conv", ["image"], [1, 64, 256, 256], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_1", "Relu", ["Conv_0"], [1, 64, 256, 256]),
      node("MaxPool_2", "MaxPool", ["Relu_1"], [1, 64, 128, 128], { kernel_shape: [2, 2], strides: [2, 2] }),
      node("Conv_3", "Conv", ["MaxPool_2"], [1, 128, 128, 128], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_4", "Relu", ["Conv_3"], [1, 128, 128, 128]),
      node("MaxPool_5", "MaxPool", ["Relu_4"], [1, 128, 64, 64], { kernel_shape: [2, 2], strides: [2, 2] }),
      node("Conv_6", "Conv", ["MaxPool_5"], [1, 256, 64, 64], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_7", "Relu", ["Conv_6"], [1, 256, 64, 64]),
      node("Resize_8", "Resize", ["Relu_7"], [1, 256, 128, 128], { mode: "nearest" }),
      node("Concat_9", "Concat", ["Resize_8", "Relu_4"], [1, 384, 128, 128], { axis: 1 }),
      node("Conv_10", "Conv", ["Concat_9"], [1, 128, 128, 128], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_11", "Relu", ["Conv_10"], [1, 128, 128, 128]),
      node("Resize_12", "Resize", ["Relu_11"], [1, 128, 256, 256], { mode: "nearest" }),
      node("Concat_13", "Concat", ["Resize_12", "Relu_1"], [1, 192, 256, 256], { axis: 1 }),
      node("Conv_14", "Conv", ["Concat_13"], [1, 64, 256, 256], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Conv_15", "Conv", ["Conv_14"], [1, 2, 256, 256], { kernel_shape: [1, 1] }),
    ],
  },
  // VGG16：13 个卷积 + 3 个全连接，共 16 个带权重的层——"16" 就是这么来的。
  // 这张图是「塔状堆叠」的试金石：五段卷积塔，每段内部通道数翻倍、空间尺寸减半，
  // 段尾一个池化。顶刊画 VGG 的惯用语言是「一摞薄片」而不是「一个大方块」，
  // 薄片的数量示意通道数、薄片的宽高示意空间尺寸。
  vgg16: {
    title: "VGG16（13 卷积 + 3 全连接）",
    input: { name: "image", dims: [1, 3, 224, 224] },
    output: { name: "logits", dims: [1, 1000] },
    nodes: [
      // --- block1: 224×224, 64 通道 ---
      node("Conv_0", "Conv", ["image"], [1, 64, 224, 224], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_1", "Relu", ["Conv_0"], [1, 64, 224, 224]),
      node("Conv_2", "Conv", ["Relu_1"], [1, 64, 224, 224], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_3", "Relu", ["Conv_2"], [1, 64, 224, 224]),
      node("MaxPool_4", "MaxPool", ["Relu_3"], [1, 64, 112, 112], { kernel_shape: [2, 2], strides: [2, 2] }),
      // --- block2: 112×112, 128 通道 ---
      node("Conv_5", "Conv", ["MaxPool_4"], [1, 128, 112, 112], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_6", "Relu", ["Conv_5"], [1, 128, 112, 112]),
      node("Conv_7", "Conv", ["Relu_6"], [1, 128, 112, 112], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_8", "Relu", ["Conv_7"], [1, 128, 112, 112]),
      node("MaxPool_9", "MaxPool", ["Relu_8"], [1, 128, 56, 56], { kernel_shape: [2, 2], strides: [2, 2] }),
      // --- block3: 56×56, 256 通道 ---
      node("Conv_10", "Conv", ["MaxPool_9"], [1, 256, 56, 56], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_11", "Relu", ["Conv_10"], [1, 256, 56, 56]),
      node("Conv_12", "Conv", ["Relu_11"], [1, 256, 56, 56], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_13", "Relu", ["Conv_12"], [1, 256, 56, 56]),
      node("Conv_14", "Conv", ["Relu_13"], [1, 256, 56, 56], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_15", "Relu", ["Conv_14"], [1, 256, 56, 56]),
      node("MaxPool_16", "MaxPool", ["Relu_15"], [1, 256, 28, 28], { kernel_shape: [2, 2], strides: [2, 2] }),
      // --- block4: 28×28, 512 通道 ---
      node("Conv_17", "Conv", ["MaxPool_16"], [1, 512, 28, 28], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_18", "Relu", ["Conv_17"], [1, 512, 28, 28]),
      node("Conv_19", "Conv", ["Relu_18"], [1, 512, 28, 28], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_20", "Relu", ["Conv_19"], [1, 512, 28, 28]),
      node("Conv_21", "Conv", ["Relu_20"], [1, 512, 28, 28], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_22", "Relu", ["Conv_21"], [1, 512, 28, 28]),
      node("MaxPool_23", "MaxPool", ["Relu_22"], [1, 512, 14, 14], { kernel_shape: [2, 2], strides: [2, 2] }),
      // --- block5: 14×14, 512 通道 ---
      node("Conv_24", "Conv", ["MaxPool_23"], [1, 512, 14, 14], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_25", "Relu", ["Conv_24"], [1, 512, 14, 14]),
      node("Conv_26", "Conv", ["Relu_25"], [1, 512, 14, 14], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_27", "Relu", ["Conv_26"], [1, 512, 14, 14]),
      node("Conv_28", "Conv", ["Relu_27"], [1, 512, 14, 14], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] }),
      node("Relu_29", "Relu", ["Conv_28"], [1, 512, 14, 14]),
      node("MaxPool_30", "MaxPool", ["Relu_29"], [1, 512, 7, 7], { kernel_shape: [2, 2], strides: [2, 2] }),
      // --- classifier: 25088 → 4096 → 4096 → 1000 ---
      node("Flatten_31", "Flatten", ["MaxPool_30"], [1, 25088], { axis: 1 }),
      node("Gemm_32", "Gemm", ["Flatten_31"], [1, 4096], { alpha: 1, beta: 1, transB: 1 }),
      node("Relu_33", "Relu", ["Gemm_32"], [1, 4096]),
      node("Gemm_34", "Gemm", ["Relu_33"], [1, 4096], { alpha: 1, beta: 1, transB: 1 }),
      node("Relu_35", "Relu", ["Gemm_34"], [1, 4096]),
      node("Gemm_36", "Gemm", ["Relu_35"], [1, 1000], { alpha: 1, beta: 1, transB: 1 }),
    ],
  },
  "vit-lite": {
    title: "ViT 单层 Transformer（lite）",
    input: { name: "patches", dims: [1, 196, 768] },
    output: { name: "features", dims: [1, 196, 768] },
    nodes: [
      node("MatMul_0", "MatMul", ["patches"], [1, 196, 768]),
      node("MatMul_1", "MatMul", ["patches"], [1, 196, 768]),
      node("MatMul_2", "MatMul", ["patches"], [1, 196, 768]),
      node("Transpose_3", "Transpose", ["MatMul_1"], [1, 768, 196], { perm: [0, 2, 1] }),
      node("MatMul_4", "MatMul", ["MatMul_0", "Transpose_3"], [1, 196, 196]),
      node("Softmax_5", "Softmax", ["MatMul_4"], [1, 196, 196], { axis: -1 }),
      node("MatMul_6", "MatMul", ["Softmax_5", "MatMul_2"], [1, 196, 768]),
      node("Add_7", "Add", ["MatMul_6", "patches"], [1, 196, 768]),
      node("LayerNormalization_8", "LayerNormalization", ["Add_7"], [1, 196, 768]),
      node("MatMul_9", "MatMul", ["LayerNormalization_8"], [1, 196, 3072]),
      node("Gelu_10", "Gelu", ["MatMul_9"], [1, 196, 3072]),
      node("MatMul_11", "MatMul", ["Gelu_10"], [1, 196, 768]),
      node("Add_12", "Add", ["MatMul_11", "Add_7"], [1, 196, 768]),
    ],
  },
};

function node(name, opType, inputs, dims, attributes = {}) {
  return { name, opType, inputs, dims, attributes };
}

function tensorInfo(name, dims) {
  return { name, type: { tensorType: { elemType: 1, shape: { dim: dims.map((dimValue) => ({ dimValue })) } } } };
}

function toAttributes(attributes) {
  return Object.entries(attributes).map(([name, value]) => {
    if (typeof value === "string") return { name, type: 3, s: Buffer.from(value, "utf8") };
    if (Number.isInteger(value)) return { name, type: 2, i: value };
    if (typeof value === "number") return { name, type: 1, f: value };
    return { name, type: 7, ints: value.map((item) => Number(item)) };
  });
}

function buildModel(spec) {
  const nodeNames = new Set(spec.nodes.map((item) => item.name));
  const tensors = new Map();
  tensors.set(spec.input.name, spec.input.dims);
  tensors.set(spec.output.name, spec.output.dims);
  for (const item of spec.nodes) tensors.set(item.name, item.dims);
  for (const [name, dims] of tensors) {
    if (!nodeNames.has(name) && name !== spec.input.name && name !== spec.output.name) {
      throw new Error(`Unreachable tensor ${name}`);
    }
  }
  const graph = {
    name: spec.title,
    input: [tensorInfo(spec.input.name, spec.input.dims)],
    output: [tensorInfo(spec.output.name, spec.output.dims)],
    // 除图输入/输出外，其余张量以 valueInfo 声明形状——这正是 torch.onnx.export
    // 开启 shape inference 后的真实形态。
    valueInfo: spec.nodes.map((item) => tensorInfo(item.name, item.dims)),
    node: spec.nodes.map((item) => ({
      name: item.name,
      opType: item.opType,
      input: item.inputs,
      output: [item.name],
      ...(Object.keys(item.attributes).length ? { attribute: toAttributes(item.attributes) } : {}),
    })),
  };
  return onnx.ModelProto.encode(onnx.ModelProto.create({ irVersion: 8, producer_name: "synapse-studio/sample-onnx", graph })).finish();
}

export const sampleOnnxNames = () => Object.keys(MODELS);

export function createSampleOnnx(name) {
  const spec = MODELS[name];
  if (!spec) throw new Error(`Unknown sample ONNX model "${name}". Available: ${sampleOnnxNames().join(", ")}`);
  return { name, title: spec.title, buffer: buildModel(spec), nodeCount: spec.nodes.length };
}

function main() {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }));

  if (args.has("list")) {
    console.log(sampleOnnxNames().join("\n"));
    return;
  }

  const requested = String(args.get("model") || "all");
  const names = requested === "all" ? sampleOnnxNames() : [requested];
  const outputDir = fileURLToPath(new URL("../artifacts/onnx/", import.meta.url));
  mkdirSync(outputDir, { recursive: true });

  const written = [];
  for (const name of names) {
    const sample = createSampleOnnx(name);
    const path = `${outputDir}${name}.onnx`;
    writeFileSync(path, sample.buffer);
    written.push({ name, title: sample.title, nodeCount: sample.nodeCount, path, bytes: sample.buffer.length });
  }
  console.log(JSON.stringify({ status: "written", count: written.length, models: written }, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) main();
