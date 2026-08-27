# Synapse Studio 神经网络论文级绘图 Agent 设计

## 1. 文档状态

- 状态：设计草案，等待用户审阅
- 日期：2026-08-13
- 首个完整验收样本：VGG16
- 首个 Visio 输出目标：可编辑的 Microsoft Visio 原生 Shape
- 本文档不包含实现代码，也不授权提交、推送或部署

## 2. 目标与非目标

### 2.1 目标

用户在桌面聊天框中输入网络名称、自然语言、模型代码、ONNX 文件或参考图片后，Agent 应能完成以下闭环：

~~~text
输入网络结构和参考图
  → 理解网络结构
  → 理解参考图的绘图语法
  → 生成结构化 Network IR
  → 生成论文级 Figure Plan
  → 生成浏览器预览
  → 自动启动或连接 Visio
  → 使用原生 Visio Shape 绘制
  → 保存 .vsdx
  → 关闭/重开后回读验证
  → 返回结构和视觉质量报告
~~~

Agent 需要具备以下能力：

1. 识别标准网络，例如 VGG16、ResNet、U-Net、Transformer。
2. 从常见 PyTorch、Keras/TensorFlow 代码中提取拓扑和 Tensor Shape。
3. 从 ONNX 等结构化模型文件中提取节点和连接关系。
4. 从参考图中识别方向、透视、体块、标签、颜色语义和连接线风格。
5. 根据网络家族选择不同的论文图 Renderer，而不是所有网络都画成矩形流程图。
6. 让空间分辨率、通道数、重复次数和层角色真正影响几何布局。
7. 在 Visio 中输出可单独编辑、移动、修改和读取的原生 Shape。
8. 在绘制前后执行结构、几何、出版物可读性和 Visio 文件验收。

### 2.2 非目标

第一阶段不实现以下能力：

- 让大模型直接输出任意 SVG、VBA、PowerShell、Python 或 COM 指令。
- 让 Agent 成为不受约束的通用桌面操控工具。
- 通过插入 PNG、截图或不可编辑 SVG 冒充 Visio 原生绘制。
- 在没有结构证据时假装精确识别复杂动态 Python。
- 一次性支持所有网络家族和所有论文绘图风格。
- 默认覆盖用户已有的 Visio 文档。

## 3. 产品原则

### 3.1 模型理解，程序绘制

大模型可以负责自然语言理解、代码语义解释和参考图风格归纳，但不能直接决定最终的任意坐标和 COM 行为。

~~~text
模型：理解意图、结构证据和视觉语法
确定性程序：生成 IR、几何、路由和质量校验
Visio Worker：执行受限的原生 Shape 操作
~~~

### 3.2 结构与风格分离

网络结构回答“画什么”，参考风格回答“怎么画”。二者必须使用独立的中间结构，再在 Figure Plan 阶段合并。

### 3.3 先预览，后写入 Visio

默认流程是先生成浏览器预览和验证报告，再由用户确认写入 Visio。预览和 Visio 输出必须来自同一份 Figure Plan，避免两边出现不同结果。

### 3.4 失败要显式暴露

任何不确定的结构、无法启动的 Visio、无法回读的文件或未通过的布局检查，都必须返回明确状态和原因，不能用“文件已生成”代替“绘图质量已通过”。

## 4. 总体架构

~~~mermaid
flowchart LR
    A["桌面聊天输入"] --> B["Input Evidence Extractor"]
    R["参考图片"] --> S["Reference Style Analyzer"]
    B --> N["Network IR"]
    S --> F["FigureStyle IR"]
    N --> Q["Renderer Family Selector"]
    F --> Q
    Q --> P["Publication Figure Plan"]
    P --> V["Deterministic Validators"]
    V --> H["Browser Preview Renderer"]
    V --> W["Visio Primitive Renderer"]
    W --> X["Visio Worker"]
    X --> Y["Microsoft Visio"]
    Y --> Z["VSDX Readback"]
    Z --> E["Acceptance Report"]
    E --> C["Auto Repair or User Revision"]
    C --> P
~~~

### 4.1 组件职责

| 组件 | 职责 | 不负责的事情 |
|---|---|---|
| Chat Orchestrator | 管理对话、输入附件、状态和用户确认 | 不直接绘制 Shape |
| Input Evidence Extractor | 解析网络名称、代码、ONNX、图片中的结构证据 | 不决定最终颜色和坐标 |
| Network IR Builder | 生成和校验网络拓扑、Tensor Shape、层角色 | 不生成 SVG 或 COM |
| Reference Style Analyzer | 提取参考图的绘图语法和风格参数 | 不猜测没有证据的真实层数 |
| Renderer Family Selector | 选择 CNN、残差、编码器解码器等 Renderer | 不修改网络结构 |
| Tensor Geometry Engine | 把 Shape、通道、重复次数映射成几何 | 不操作 Visio |
| Publication Plan Validator | 检查重叠、越界、路由、可读性和黑白安全 | 不吞掉错误 |
| Browser Renderer | 生成与 Visio 等价的可编辑预览 | 不作为最终 Visio 文件 |
| Visio Worker | 启动/连接 Visio 并创建原生 Shape | 不解释自然语言 |
| VSDX Readback | 重新打开并读取 Shape、文本、连接和 Shape Data | 不根据截图判断成功 |

## 5. Agent 输入与对话状态

### 5.1 支持的输入

用户可以提交以下任意组合：

- 网络名称：VGG16、ResNet50、U-Net。
- 自然语言：按照参考图片风格绘制一个编码器—解码器网络。
- PyTorch 或 Keras/TensorFlow 代码。
- ONNX 或受支持的模型结构文件。
- 论文截图、手绘草图或已有网络图。
- 对已有计划的修改：改成横向、减少标签、使用浅色、突出残差连接。

### 5.2 证据优先级

~~~text
可读取的 ONNX / 结构化模型
  > 可静态解析的 PyTorch / Keras 代码
  > 标准模型的本地确定性 preset
  > 用户明确描述
  > 参考图中推断出的结构
~~~

参考图片默认主要用于识别视觉语法。除非图片中有明确标签和尺寸，不能用图片推断精确层数替代代码或标准结构证据。

### 5.3 对话状态

Agent 使用显式状态机：

~~~text
IDLE
  → INPUT_ANALYZING
  → NETWORK_CONFIRMED
  → STYLE_CONFIRMED
  → PREVIEW_READY
  → WAITING_VISIO_APPROVAL
  → VISIO_EXECUTING
  → READBACK_VALIDATING
  → COMPLETED
~~~

失败状态包括：

~~~text
INPUT_AMBIGUOUS
NETWORK_INVALID
STYLE_UNCERTAIN
LAYOUT_INVALID
VISIO_UNAVAILABLE
VISIO_EXECUTION_FAILED
READBACK_FAILED
~~~

Agent 只有在以下情况才主动询问用户：网络结构无法确认、参考图风格冲突、会覆盖已有文档、或用户没有授权写入 Visio。颜色、间距、透视和标签位置等普通设计参数由 Agent 自动决定。

## 6. Network IR 设计

Network IR 是结构真相源，必须可以独立校验和序列化。

### 6.1 节点字段

~~~typescript
type NetworkNode = {
  id: string;
  kind: NetworkNodeKind;
  layerRole: LayerRole;
  label: string;
  tensorShape?: TensorShape;
  inputShapes?: TensorShape[];
  outputShapes?: TensorShape[];
  channelCount?: number;
  spatialSize?: { height?: number; width?: number; depth?: number };
  repeatCount?: number;
  parameters?: Record<string, string | number | boolean>;
  sourceEvidence: SourceEvidence[];
  confidence: number;
};
~~~

repeatCount 表示真实重复层数量；channelCount 表示真实通道数；二者都不能与视觉厚度混用。

### 6.2 边字段

~~~typescript
type NetworkEdge = {
  id: string;
  source: string;
  target: string;
  kind: "forward" | "residual" | "skip" | "concat" | "attention";
  label?: string;
  sourceEvidence: SourceEvidence[];
};
~~~

### 6.3 必须通过的结构检查

- 节点 ID 唯一。
- 所有边的端点存在。
- 禁止不合法自环。
- 输入节点存在。
- 输出节点存在。
- 输出从输入可达。
- 非残差普通边不能违反主干顺序。
- confidence 必须在 0 到 1 之间。
- Tensor Shape 的维度必须为正数或明确的符号表达式。
- 标准 preset 的节点数量、顺序和重复次数必须符合定义。

## 7. FigureStyle IR 设计

FigureStyle IR 描述参考图的绘图语法，而不是保存参考图片本身。

~~~typescript
type FigureStyleIR = {
  styleFamily:
    | "cnn-volume-schematic"
    | "multi-branch-cnn"
    | "residual-graph"
    | "dense-connectivity"
    | "encoder-decoder"
    | "token-sequence"
    | "dual-tower-alignment"
    | "iterative-process"
    | "graph-topology"
    | "coordinate-rendering"
    | "multi-track-relational";
  direction: "left-to-right" | "right-to-left" | "top-to-bottom";
  projection: "flat" | "oblique-3d" | "isometric";
  outlineMode: "dominant" | "subtle" | "none";
  fillMode: "light" | "solid" | "outline-only";
  spatialSizeEncoding: "front-face-size" | "label-only" | "height";
  channelEncoding: "bounded-depth" | "visible-planes" | "label-only";
  repeatEncoding: "expand-small-collapse-large" | "grouped-label" | "fully-expanded";
  classifierEncoding: "thin-horizontal-prism" | "vector-stack" | "flat-block";
  poolingEncoding: "thin-outline-prism" | "small-block" | "label-only";
  connectorMode: "minimal-arrow" | "plain-line" | "orthogonal-arrow";
  labelPolicy: "tensor-shape-above" | "tensor-shape-below" | "inside-block";
  colorMode: "muted-semantic" | "monochrome" | "high-contrast";
  page: { aspectRatio: number; margin: number; background: string };
  confidence: number;
  evidence: SourceEvidence[];
};
~~~

### 7.1 风格识别方法

Reference Style Analyzer 依次识别：

1. 主方向和页面比例。
2. 平面、棱柱、圆柱、箭头、括号等 primitive。
3. 是否存在斜投影或等距投影。
4. 尺寸变化是通过宽度、高度、前面面积还是文字表达。
5. 通道变化是通过深度、平面数量还是标签表达。
6. 重复层是展开、压缩还是使用 ×N 标签。
7. Pooling、FC、Softmax 的专属视觉表达。
8. 主连接、跳跃连接、注意力连接的线型和路由。
9. 颜色的语义角色，而不是只保存 RGB 值。
10. 标签层级、字号和图例形式。

## 8. Renderer Family

第一阶段实现 cnn-volume-schematic，其他 family 预留接口。

| Family | 适用网络 | 第一阶段 |
|---|---|---|
| cnn-volume-schematic | VGG、AlexNet | 实现 VGG16 |
| residual-graph | ResNet | 接口预留 |
| encoder-decoder | U-Net、DeepLab | 接口预留 |
| multi-branch-cnn | Inception、ASPP | 接口预留 |
| dense-connectivity | DenseNet、UNet++ | 接口预留 |
| token-sequence | ViT、BERT、DETR | 接口预留 |
| 其他 family | 图网络、扩散、CLIP、NeRF 等 | 后续扩展 |

Renderer Family 只消费 Network IR 和 FigureStyle IR，不直接访问聊天上下文或用户 API Key。

## 9. Publication Figure Plan

Figure Plan 是浏览器和 Visio 的共同输入，描述最终要绘制哪些 primitive、在哪里绘制以及为什么这样绘制。

~~~typescript
type FigurePrimitive = {
  id: string;
  kind:
    | "input-plane"
    | "feature-map-prism"
    | "pooling-prism"
    | "classifier-prism"
    | "softmax-prism"
    | "block-label"
    | "tensor-label"
    | "connector"
    | "legend-item";
  geometry: {
    x: number;
    y: number;
    width: number;
    height: number;
    extrusionDepth?: number;
    skewX?: number;
    skewY?: number;
  };
  semantic: {
    sourceNodeId?: string;
    visualRole: string;
    tensorShape?: TensorShape;
    channelCount?: number;
    repeatCount?: number;
  };
  style: PrimitiveStyle;
  text?: TextPlacement[];
};
~~~

Figure Plan 还要包含页面尺寸、安全边距、标题、副标题、图例、primitive 绘制顺序、主干和 skip lane 的路由、标签最小字号、颜色语义表、黑白打印检查参数、生成版本和源证据摘要。

## 10. VGG16 第一阶段视觉规范

VGG16 使用以下绘图策略：

~~~text
styleFamily: cnn-volume-schematic
projection: oblique-3d
fillMode: light
spatialSizeEncoding: front-face-size
channelEncoding: bounded-depth
repeatEncoding: expand-small-collapse-large
classifierEncoding: thin-horizontal-prism
poolingEncoding: thin-outline-prism
connectorMode: minimal-arrow
colorMode: muted-semantic
~~~

### 10.1 空间尺寸

空间尺寸必须影响特征图前面的实际面积。推荐使用带最小值的非线性映射：

~~~text
frontHeight = max(minHeight, maxHeight × sqrt(spatialSize / 224))
~~~

视觉趋势应保持：

~~~text
224×224 > 112×112 > 56×56 > 28×28 > 14×14 > 7×7
~~~

但最后的 7×7 不能缩小到不可读。

### 10.2 FeatureMapPrism

一个特征图体块由三个原生面组成：

~~~text
front face
top face
side face
~~~

前面表示空间尺寸，侧向厚度表示通道规模的受限视觉编码，平面数量表示视觉抽样而不表示真实通道数。

### 10.3 PoolingPrism

Pooling 采用窄、薄、浅色、轮廓明确的棱柱。它表示空间尺寸转换，不应该成为视觉主体。标签使用 MaxPool 或 AvgPool，必要时附加 stride。

### 10.4 ClassifierPrism 与 SoftmaxPrism

FC 使用低高度的细长体块，Softmax 使用更短的末端体块。二者不能与卷积特征图使用相同的高度和填充重量。

### 10.5 标签与图例

主体标签优先显示：

~~~text
Block 3
Conv ×3
28 × 28 × 256
~~~

不在每一层都重复显示相同信息。图例必须复用真实的 FeatureMapPrism、PoolingPrism 和 ClassifierPrism primitive，不能使用普通色块替代。

## 11. Visio 原生绘制边界

Visio Worker 接收经过 schema 校验的 Figure Plan，不接收任意脚本。

### 11.1 允许的原生操作

- 创建空白文档。
- 创建矩形、自由曲面、连接线和文本 Shape。
- 设置填充、线条、字体、透明度和几何公式。
- 创建 FeatureMapPrism 的 front/top/side 三个面。
- 创建 PoolingPrism、ClassifierPrism、SoftmaxPrism。
- 设置 Shape Data。
- 连接 Shape。
- 保存为新的 .vsdx。
- 关闭、重新打开并读取文档。
- 导出 PNG 供视觉检查。

### 11.2 禁止的操作

- 根据模型输出执行任意 COM 方法名。
- 执行用户提供的 PowerShell、Python、VBA 或 Shell。
- 直接把 PNG、SVG 或截图作为最终图形。
- 默认覆盖用户原有文件。
- 在日志中打印 API Key、完整请求头或模型原始密钥。

### 11.3 Visio 运行流程

~~~text
healthCheck
  → detect installed Visio
  → attach running Visio or start visible Visio
  → create new document
  → apply validated Figure Plan
  → save to new .vsdx path
  → close/reopen
  → readback
  → export preview PNG
~~~

Agent 只需要调用 start_visio、apply_figure_plan 和 read_visio_document 等窄接口，不需要知道 COM 细节。

## 12. 固定中转站 URL 与 API Key

桌面设置页面只提供：

~~~text
中转站 API Key
~~~

不提供：

~~~text
API URL
Base URL
Provider URL
任意模型服务地址
~~~

固定 URL 由应用和服务端契约共同确定。服务端必须忽略或拒绝客户端提交的 URL 覆盖字段。需要明确：URL 可以被用户通过程序检查或网络调试发现，但用户不能在设置页面修改它；真正的秘密是 API Key 和服务端权限。

Provider 返回的内容必须经过结构化输出和服务端 schema 校验，才能进入 Network IR。API Key 不得进入 Network IR、Figure Plan、Visio Shape Data、日志或错误消息。

## 13. 质量验证

### 13.1 结构质量

- VGG16 的五个卷积 Block、五个 Pooling、两个 FC 和一个 Softmax 顺序正确。
- 每个 Block 的 repeatCount 正确。
- Tensor Shape 和通道数正确。
- 所有连接端点存在。
- 输入可达输出。

### 13.2 几何质量

- 无 primitive 重叠。
- 无标签越界。
- 无非预期的连接线穿过主体。
- Skip lane 独立且不互相冲突。
- 页面边距统一。
- 后续特征图逐步缩小但仍然可读。
- Pooling 明显比卷积体块细。
- FC 和 Softmax 明显比卷积主体低。

### 13.3 出版物质量

- 颜色使用低饱和语义色。
- 统一线宽、字体和标签层级。
- 转成灰度后仍然能够区分主要组件。
- 预览缩小后仍能识别主干和 Block 分组。
- 不出现产品 UI 式的过度渐变、强烈荧光色或厚重阴影。
- 连接线不会压过特征图主体。

### 13.4 Visio 文件质量

- .vsdx 保存成功。
- 关闭后可以重新打开。
- Shape 数量、文本、连接和 Shape Data 与 Figure Plan 一致。
- FeatureMapPrism 的三个面仍是独立可编辑 Shape。
- 用户可以单独选择、移动和修改图形。
- 导出的 PNG 与浏览器预览在结构和布局上保持一致。

Shape Data 至少保存：

~~~text
visualRole
layerRole
tensorShape
channelCount
repeatCount
sourceNodeId
rendererFamily
planVersion
~~~

## 14. 分阶段实现范围

### Phase 1：VGG16 完整闭环

实现 Network IR preset、FigureStyle IR、cnn-volume-schematic、Tensor Geometry Engine、三面 FeatureMapPrism、PoolingPrism、ClassifierPrism、预览、Visio 输出和重开回读。

### Phase 2：代码和 ONNX 证据

扩展 PyTorch、Keras 和 ONNX 解析，加入 stride、padding、dilation、BatchNorm、Activation、Flatten、Residual、Concat 和 Upsampling 的结构表达。

### Phase 3：参考图风格识别

实现参考图片的 primitive、透视、颜色语义、标签策略、连接方式和页面比例提取，并允许用户在预览阶段修正风格结论。

### Phase 4：其他 Renderer Family

依次实现 residual-graph、encoder-decoder、multi-branch-cnn、dense-connectivity 和 token-sequence。

### Phase 5：自动修正循环

当验证器发现拥挤、标签不可读、Skip lane 冲突、灰度不可区分或主体比例不协调时，Agent 自动重新生成 Figure Plan，并在写入 Visio 前展示修正后的预览。

## 15. 第一阶段验收场景

### 场景 A：标准 VGG16

~~~text
用户输入：绘制 VGG16
预期：加载标准 VGG16 IR，生成论文级 CNN 体块预览
~~~

### 场景 B：VGG16 加参考图

~~~text
用户输入：按照上传图片的风格绘制 VGG16
预期：识别参考图的 3D 体块、标签、颜色和连线语法，再生成预览
~~~

### 场景 C：写入 Visio

~~~text
用户确认：在 Visio 中绘制
预期：自动发现或启动 Visio，创建新文档，生成原生 Shape，保存新 .vsdx
~~~

### 场景 D：回读

~~~text
关闭并重新打开 .vsdx
预期：读取节点、文本、连接和 Shape Data，与 Figure Plan 对比
~~~

### 场景 E：不确定输入

~~~text
用户输入：绘制一张类似截图的网络图，但没有提供网络结构
预期：Agent 识别风格，但明确说明无法确认真实拓扑，不伪造精确结构
~~~

## 16. 设计决策

本项目第一阶段采用以下决策：

1. 使用 NetworkIR + FigureStyleIR + PublicationFigurePlan 三层中间表示。
2. VGG16 作为首个完整验收样本。
3. 采用 cnn-volume-schematic 作为首个 Renderer Family。
4. 使用确定性几何布局，不让大模型直接输出坐标。
5. 浏览器预览和 Visio 输出共享 Figure Plan。
6. Visio 最终输出必须是原生 Shape，不接受图片嵌入替代。
7. 固定中转站 URL，不允许用户配置或覆盖；设置页只允许填写 API Key。
8. 结构验证、几何验证、出版物验证和 Visio 回读验证分开报告。
9. 第一阶段不覆盖原始 Visio 文件，默认创建新文件。
10. 在设计审阅通过前不进入代码实现。
