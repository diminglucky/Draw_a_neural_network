# 通用神经网络语义模块与论文级视觉组合设计

**状态：** 待用户评审；本文是设计规格，不代表实现完成

**日期：** 2026-08-26

**适用工作树：** `C:\项目\code\Draw_a_neural_network\.worktrees\current-page-visio-chain`

**关联基线：**

- `docs/START_HERE.md`
- `docs/superpowers/specs/2026-08-14-universal-neural-figure-compiler-design.md`
- `docs/superpowers/specs/2026-08-21-core-drawing-v1-vertical-slice-design.md`
- `docs/superpowers/specs/2026-08-22-langgraph-core-runtime-design.md`

本文不替代上述安全、证据、Drawing Run、LangGraph、PlanSnapshot、Worker 和 Visio 生命周期设计；本文只补齐其当前最薄弱的绘图核心：**模块本身如何被理解、建模、组合和渲染为论文级视觉对象**。

## 1. 背景与问题定义

当前通用绘图链路已经能够表达部分 UGS、GPG、PVP、primitive group、connector、shape data 和 Visio readback，但通用组件编译仍容易把大多数组件映射成 `OperatorFrame`。结果是：拓扑可以存在，连接线可以存在，然而模块本身缺少数据形态、内部算子、状态、迭代、重复和层级，最终输出退化为“矩形模块 + 箭头”的流程图。

近期论文中的网络架构图通常同时表达以下信息：

```text
数据对象 → 表示变换 → 计算模块 → 重复/迭代过程 → 条件/状态 → 输出对象
```

因此本项目不能把：

```text
node = rectangle
edge = arrow
```

作为默认绘图模型，而必须采用：

```text
semantic module = data objects + internal parts + typed relations + layout intent
```

本设计的核心目标是：对未见过的网络，根据代码、草图、提示和已验证结构证据推导模块语义，再通过模块组合生成专业图稿；禁止以 VGG、ResNet、U-Net、ViT、AlphaFold 或其他模型名称作为通用能力边界。

## 2. 目标与非目标

### 2.1 目标

1. 每个主要模块都具有可解释的视觉内部结构，而不是只有外框和标题。
2. 数据对象、计算对象、状态对象和过程对象使用不同视觉语法。
3. Add、Concat、Cross-Attention、Message Passing、Skip、Feedback、Memory 和 Diffusion 等关系不再全部退化为普通箭头。
4. 支持 overview、stage、detail inset、legend 和 process lane 的层级版面。
5. 同一份 renderer-neutral Publication Visual Plan 可以由浏览器预览和 Visio native group 消费。
6. 代码、草图和提示都通过证据与置信度进入语义模块；不确定时保留未知并请求澄清，不伪造结构。
7. 视觉模块通过结构特征选择，不能通过 `modelName` 分支选择。
8. Visio 输出保持可编辑：一个语义模块可以由多个有 ownership 和 source mapping 的 native shapes 组成。

### 2.2 非目标

1. 本文不实现计费、套餐、Provider 商业策略或后台运营功能。
2. 本文不在第一阶段实现所有神经网络算子，也不承诺任意动态代码都能静态解析。
3. 本文不复制具体论文图片、文字、颜色或受保护布局；论文只用于抽取通用视觉规律。
4. 本文不允许 Provider、浏览器或客户端直接提交 Visio 坐标、COM 指令、脚本、文件路径或自由形状计划。
5. 本文不把 mock、协议测试或浏览器预览当作真实 Windows/Visio 保存、关闭、重开和独立 readback 证据。

## 3. 总体架构

```text
SourcePack / prompt / sketch
          ↓
EvidencePack + StructuralFacts
          ↓
UniversalGraphSpec / Architecture IR v3
          ↓
Semantic Architecture Graph
          ↓
Visual Grammar Selector
          ↓
Semantic Visual Module Library
          ↓
Figure Story Composer
          ↓
Publication Visual Plan vNext
          ↓
Browser preview + Visio native group renderer
          ↓
Visual QA + native readback
```

各层职责必须保持单向：

| 层 | 责任 | 不负责 |
|---|---|---|
| StructuralFacts | 记录输入中的可追溯结构事实 | 决定具体颜色、坐标或 Visio shape |
| Architecture IR | 表达拓扑、端口、数据表示、重复、状态和过程 | 生成像素坐标或 COM 命令 |
| Semantic Architecture Graph | 将 IR 归并为模块、数据对象和关系语义 | 选择最终页尺寸和渲染 API |
| Visual Grammar Selector | 根据语义证据选择模块视觉语法 | 根据模型名称选择模板 |
| Visual Module Library | 描述模块内部结构和 native mapping contract | 运行用户代码或改变拓扑 |
| Figure Story Composer | 决定主图、stage、inset、legend、过程轴和空间层级 | 猜测未证明的关系 |
| Publication Visual Plan | 固化不可变的 renderer-neutral 图稿计划 | 读取外部路径或重新编译用户输入 |
| Visio renderer | 将已验证 plan 映射为 native groups/connectors/text/data | 解释自由文本或执行任意 COM |

## 4. Semantic Architecture Graph

### 4.1 核心对象

```ts
interface SemanticArchitectureGraph {
  graphId: string;
  revision: string;
  modules: SemanticModule[];
  dataObjects: SemanticDataObject[];
  relations: SemanticRelation[];
  panels: SemanticPanelIntent[];
  evidenceIds: string[];
  confidence: number;
  unresolved: UnresolvedSemantic[];
  exportEligibility: "formal" | "candidate" | "blocked";
}
```

### 4.2 模块对象

```ts
interface SemanticModule {
  moduleId: string;
  semanticType: SemanticModuleType;
  label: string;
  sourceNodeIds: string[];
  evidenceIds: string[];
  inputs: PortRef[];
  outputs: PortRef[];
  internalParts: ModulePart[];
  repeat: RepeatSpec | null;
  state: StateSpec | null;
  condition: ConditionSpec | null;
  layoutIntent: ModuleLayoutIntent;
  confidence: number;
}
```

### 4.3 数据对象

```ts
type SemanticDataType =
  | "image"
  | "video_frame"
  | "tensor"
  | "feature_map"
  | "token_sequence"
  | "grid"
  | "mesh"
  | "graph"
  | "latent"
  | "mask"
  | "prediction"
  | "memory"
  | "state"
  | "unknown";

interface SemanticDataObject {
  dataId: string;
  dataType: SemanticDataType;
  shape: SymbolicShape | null;
  sourceNodeIds: string[];
  evidenceIds: string[];
  visualRole: "primary" | "condition" | "state" | "output" | "auxiliary";
  confidence: number;
}
```

### 4.4 关系对象

```ts
type SemanticRelationType =
  | "data_flow"
  | "condition_flow"
  | "residual_skip"
  | "add_merge"
  | "concat_merge"
  | "cross_attention"
  | "message_passing"
  | "state_read"
  | "state_write"
  | "feedback"
  | "time_step"
  | "diffusion_iteration";
```

关系类型必须表达在 IR/PVP 中，不能只由线颜色或线型隐含。渲染样式是关系类型的投影，不是关系类型本身。

## 5. Semantic Visual Module Library

第一版不以模型名称组织库，而以可组合的语义模块组织库。每个模块都必须提供：

1. 适用的结构证据条件；
2. 必需输入和输出端口；
3. 内部 parts；
4. 最小和推荐尺寸；
5. 标签层级规则；
6. style token 和 legend 规则；
7. 浏览器 preview mapping；
8. Visio native group mapping；
9. readback manifest；
10. 几何、缩放、灰度和文本 QA 规则。

### 5.1 DataArtifact 模块

#### ImageFrame

用于图像、视频帧、多帧输入和视觉样本。

内部 parts：

```text
frame tile × N
time marker
optional frame index
optional resolution label
```

视觉规则：叠放卡片表示多帧或样本集合；时间箭头表示帧序列；输入对象使用 data color，不使用 compute color。

#### TensorVolume / FeatureMap

内部 parts：

```text
front face
top face
side face
optional channel marker
shape label
scale label
```

输入和输出 Tensor 的空间尺寸、通道数和深度变化必须能够在视觉上比较。不能只把 `H × W × C` 写在普通矩形旁边。

#### TokenSequence

内部 parts：

```text
token cells
special token markers
sequence length label
optional positional axis
```

用于 patch、text、visual token、query、key、value 和 object pointer。

#### Grid / MeshGraph

`Grid` 使用规则网格；`MeshGraph` 使用节点、边和局部邻域。二者不能都映射到 TensorVolume。

MeshGraph 必须支持：

- node group；
- edge group；
- node feature label；
- message-passing inset；
- grid-to-mesh 和 mesh-to-grid 关系。

#### Latent / Mask / Prediction

Latent 使用压缩的 volume 或 token 表示；Mask 和 Prediction 使用数据对象叠加或热区表达。输出对象不能与普通 OperatorFrame 混淆。

#### MemoryState

MemoryState 必须具有 read port、write port、持久状态标记和历史来源。它不是普通的从左到右数据对象。

### 5.2 OperatorBlock 模块

#### ConvolutionStage

内部 parts：

```text
input tensor
kernel / operator body
stride / padding label
optional norm
optional activation
output tensor
```

连续的 `Conv → Norm → Activation → Conv` 可以组合成一个 stage；只有存在结构证据时才折叠，不得凭模型名称折叠。

#### Pooling / ScaleTransition

使用 wedge 或 prism 表示空间压缩/扩张，输入输出是两个独立的 TensorVolume。`flatten`、`patchify`、`reshape` 和 `upsample` 都是 ScaleTransition 的不同 relation subtype，不能统一为普通箭头。

#### AttentionBlock

支持两种展开粒度：

```text
摘要粒度：TokenSequence → AttentionBlock → TokenSequence

细节粒度：
Q projection + K projection + V projection
                    ↓
             attention relation
                    ↓
              output projection
```

Self-attention、cross-attention 和 memory attention 必须通过 relation type 区分。

#### FFN / MLPBlock

细节粒度为：

```text
expand projection → activation → contract projection
```

主图可使用 `FFN × N`，细节 inset 负责展开内部。

#### SSM / RecurrentBlock

内部必须包含 state update 和 causal/recurrent relation。state 是旁路持久对象，不得被普通 data flow 覆盖。

#### GraphMessagePassingBlock

内部必须包含局部 graph inset：邻居节点、边、消息聚合和更新结果。模块之间的 graph relation 和模块内部的 message-passing relation 要分开。

#### DiffusionDenoiserBlock

内部必须支持 noise level、condition、denoiser、clean output 和 timestep embedding。若存在重复 solver steps，必须生成 process track，而不是一根长箭头。

### 5.3 StructuralBlock 模块

#### StageRegion

带标题、内部模块、输入输出端口和可折叠状态的视觉容器。StageRegion 可以代表 encoder、decoder、backbone、head、memory path 或 diffusion stage，但其 role 必须来自结构语义。

#### RepeatGroup

支持：

- `×N` 摘要；
- 首尾代表实例 + ellipsis；
- 时间步重复；
- diffusion iteration；
- recurrent rollout。

重复的视觉表现必须由 `repeat.kind` 决定，不能统一使用右上角 badge。

#### MultiTower

用于 image/text/audio/condition 等多塔输入。每个 tower 有独立数据对象、内部 stage 和输出 representation，融合关系由 FusionBlock 表达。

#### FusionBlock

至少区分：

- Add；
- Concat；
- Cross-Attention；
- Gated Fusion；
- Message Aggregation；
- Elementwise Product。

这些模块不得都绘制成同一个 `+` 圆形。

### 5.4 ProcessBlock 模块

#### TimeAxis

用于视频、autoregressive rollout、天气预测和多步推理。它表达时间，不替代数据流。

#### FeedbackLoop

用于 recycling、memory update、state carry 和 refinement。反馈路径必须使用独立 route lane，不能穿过主模块。

#### DiffusionLadder

使用竖向或分段的 repeated denoiser 表达 `noise → denoise steps → clean state`，并显示 timestep/noise level/condition。

#### EnsembleBranch

用于多样本采样和 ensemble。其视觉表达是受控的平行样本路径，不是普通 split。

## 6. Visual Grammar Selection

Visual Grammar Selector 输入的是结构签名，不是模型名称。

```ts
interface ArchitectureSignature {
  dataTypes: SemanticDataType[];
  hasSpatialScaleChange: boolean;
  hasGraphStructure: boolean;
  hasPersistentState: boolean;
  hasConditionPath: boolean;
  hasCrossAttention: boolean;
  hasRepeat: boolean;
  hasFeedback: boolean;
  hasDiffusionIteration: boolean;
  hasMultiTower: boolean;
  complexity: "compact" | "composite" | "high";
}
```

选择规则示例：

| 结构证据 | 视觉组合 |
|---|---|
| rank-4 tensor + spatial scale change | TensorVolume + ScaleTransition |
| token sequence + Q/K/V | TokenSequence + AttentionBlock |
| grid + mesh + neighborhood | Grid + MeshGraph + GraphMessagePassingBlock + inset |
| persistent state + feedback | MemoryState + FeedbackLoop |
| noise schedule + repeated denoiser | DiffusionLadder + DenoiserBlock + TimeAxis |
| two or more independent input representations | MultiTower + FusionBlock |
| explicit repeated subgraph | RepeatGroup |
| unresolved relation type | candidate module + clarification, no formal Visio export |

同一网络允许组合多个 grammar profile。grammar profile 是视觉组合策略，不是模型模板。

## 7. Figure Story Composer

### 7.1 版面层级

```text
FigureSet
├── OverviewPanel
│   ├── input objects
│   ├── main stages
│   ├── major conditions
│   └── outputs
├── DetailPanel[]
│   └── selected complex module internals
├── ProcessPanel?
│   └── time / diffusion / recurrent process
└── LegendPanel
```

主图只保留主叙事和关键创新；复杂模块通过 inset 展开。模块是否展开由：模块复杂度、结构不确定性、用户 FigureIntent 和页面密度共同决定。

### 7.2 布局顺序

1. 提取主数据路径。
2. 单独分配 condition lane、state lane、feedback lane 和 graph detail lane。
3. 选择横向、纵向或多 panel 方向。
4. 放置 StageRegion 和主要 DataArtifact。
5. 在 stage 内放置 internal parts。
6. 生成 inset 和主图引用标记。
7. 生成 typed relations 和 orthogonal routes。
8. 最后放置标签、图例和 shape data，不让标签决定主拓扑。

### 7.3 关系路由

关系必须携带类型：

```text
data_flow       → 主实线
condition_flow  → 辅助实线或细线
feedback        → 外侧虚线/反馈 lane
state_read      → memory lane 读路径
state_write     → memory lane 写路径
time_step       → 时间轴关系
message_passing → graph edge 关系
```

连接线不能负责替代模块语义；连接线只表达模块之间的 typed relationship。

## 8. PVP vNext 数据扩展

当前 PVP 只有单一 `region:main`、primitive、connector、empty legend 等基础对象。新版本需要增加：

```ts
interface PublicationVisualPlanVNext {
  panels: FigurePanel[];
  modules: PlannedVisualModule[];
  dataObjects: PlannedDataObject[];
  relations: PlannedVisualRelation[];
  containers: PlannedContainer[];
  insets: FigureInsetLink[];
  processTracks: ProcessTrack[];
  legend: FigureLegend;
  sourceMappings: SourceMapping[];
  rendererRequirements: RendererRequirements;
}
```

`PlannedVisualModule` 必须包含：

- semantic module ID；
- visual grammar ID；
- internal parts；
- panel ID；
- bounds；
- z-index；
- style token IDs；
- source node IDs；
- evidence IDs；
- repeat/state/process metadata；
- readback manifest。

PVP 不保存：

- 原始代码；
- 图片像素；
- Provider 自由文本；
- 本地路径；
- COM command；
- 客户端任意坐标覆盖；
- 未验证的未知结构。

## 9. Visio Native Group Renderer

一个语义模块由一个 native group 表达，而不是一个 shape 表达。

### 9.1 例：ConvolutionStage

```text
Visio Group: module.conv-stage.1
├── tensor.input
├── operator.conv-body
├── operator.kernel-marker
├── annotation.stride
├── tensor.output
└── label.module-name
```

### 9.2 例：AttentionBlock

```text
Visio Group: module.cross-attention.1
├── tokens.query
├── tokens.condition
├── relation.cross-attention
├── tokens.output
├── label.relation-type
└── optional detail reference
```

### 9.3 例：DiffusionLadder

```text
Visio Group: process.diffusion.1
├── object.noise
├── block.denoiser.0
├── block.denoiser.1
├── block.denoiser.ellipsis
├── object.clean-state
├── axis.timestep
└── relation.condition
```

每个 group 和子 shape 必须写入：

```text
moduleId
semanticType
panelId
sourceNodeIds
sourceEdgeIds
evidenceIds
grammarId
ownershipMarker
```

用户已有 shape 不得被删除。更新时只替换当前 session 拥有的 group 和 connector。

## 10. 代码、草图和未知结构推导

### 10.1 静态代码

静态分析必须将调用、构造、端口、shape、分支、重复和状态证据转换为 StructuralFacts。示例：

```python
self.conv = nn.Conv2d(64, 128, 3, stride=2)
```

得到：

```text
operator=convolution
rank=4
spatial=true
stride=2
channels=64→128
```

进而选择：

```text
TensorVolume + ConvolutionStage + ScaleTransition + TensorVolume
```

### 10.2 草图和截图

视觉识别只产生带证据定位和置信度的候选事实。箭头、标签、形状、颜色和空间位置都必须成为 evidence；低置信度事实不能直接进入 formal PVP。

### 10.3 未知模块

遇到没有见过的模块时：

1. 保留 `CustomModule` 容器；
2. 保留已知输入输出和内部证据；
3. 给出 `unknown` 或 `candidate` 语义；
4. 不把未知模块伪装成 Conv、Attention 或 Transformer；
5. 如果未知关系影响拓扑，返回一个最高信息价值澄清问题；
6. 结构未确认时允许 preview-safe candidate，但不允许最终 VSDX export。

## 11. 验收 Fixture

不以模型名称作为产品功能入口，验收以匿名结构族为主：

| Fixture | 必须验证 |
|---|---|
| 多尺度 encoder-decoder | TensorVolume、ScaleTransition、StageRegion、skip/concat |
| 多塔条件融合 | MultiTower、ConditionPath、Cross-Attention、FusionBlock |
| grid-mesh message passing | Grid、MeshGraph、node/edge、Graph inset、MessagePassing |
| memory/iteration/diffusion | MemoryState、FeedbackLoop、TimeAxis、DiffusionLadder、RepeatGroup |

每个 fixture 必须拥有：

1. 原始输入或受控 source pack；
2. gold facts；
3. gold Architecture IR；
4. expected Semantic Architecture Graph；
5. expected PVP module/relations；
6. 结构反例；
7. 浏览器 full-page preview；
8. 50% grayscale preview；
9. Visio native readback manifest；
10. 人工 visual review 记录。

验收失败条件：

- 主要模块全部退化为普通矩形；
- 关键数据对象不可区分；
- Add/Concat/Cross-Attention 被混淆；
- repeat、feedback、memory 或 time 被画成普通箭头；
- 主图和 detail inset 无引用关系；
- 缩小或灰度后关键关系不可读；
- preview 和 Visio group 的 semantic IDs 不一致；
- unknown topology 被强行 formalize。

## 12. 分阶段实现顺序

### Phase V1：Semantic Module Contract

只增加 renderer-neutral semantic schema、模块类型、内部 parts、relation types、evidence mapping 和确定性序列化。暂不改变 Visio。

退出条件：四类匿名 fixture 能输出稳定的 Semantic Architecture Graph；反例会进入 candidate/clarification；已有 UGS/GPG/PVP 测试不回归。

### Phase V2：Visual Module Compiler

实现 DataArtifact、OperatorBlock、StageRegion、RepeatGroup、FusionBlock、MemoryState、GraphMessagePassing、DiffusionLadder 的浏览器预览编译。

退出条件：模块内部结构可见，模块不再只显示外框；主图和 detail inset 的 source mapping 稳定。

### Phase V3：Figure Story Composer

实现主路径、condition lane、state lane、feedback lane、process axis、overview/detail/legend panel 和 typed route。

退出条件：四类 fixture 在单栏缩小、彩色、灰度视图中通过自动 QA 和人工视觉审阅。

### Phase V4：PVP vNext Adapter

把 Semantic Architecture Graph 和 Figure Story Plan 固化为 versioned PVP Snapshot。禁止客户端和 Provider 直接写入 geometry 或 Visio intent。

退出条件：同一 IR、Intent、grammar manifest 和 seed 连续三次生成 byte-equivalent plan；计划变更会生成新 revision。

### Phase V5：Visio Native Group Mapping

把每个 Visual Module 映射为 native group、子 shape、connector、native text 和 shape data，并增加模块内部 readback。

退出条件：真实 Windows/Visio 环境完成保存、关闭、重开、可编辑性和独立 readback；mock 只作为补充证据。

## 13. 与现有路线的关系

本文不重新引入 VGG16 专用模板，也不删除已有 VGG/ResNet/U-Net/ViT fixture。已有 fixture 只用于结构回归和视觉基准。

本文的实现必须遵守：

- `docs/START_HERE.md` 的 LangGraph、EvidencePack、Harness 和 PlanSnapshot 边界；
- `docs/agent-program-state.json` 的里程碑门；
- M2.13 的 publication visual grammar and acceptance corpus 目标；
- M3.5/M3.6 的真实 Windows/Visio 与 current-page 验收门；
- 当前工作树已有未提交修改不得被覆盖、reset 或广泛暂存。

## 14. 设计决策

### D1：模块优先于连接线

连接线只能表达已类型化的关系；模块必须先表达自己的数据、算子、状态和过程内部结构。

### D2：结构签名优先于模型名称

Visual Grammar Selector 只消费 Architecture Signature 和 evidence，不消费模型名作为模板选择条件。

### D3：摘要与细节并存

复杂网络采用 overview + detail inset；不能为了显示所有内部层而把主图压成不可读的长流程。

### D4：未知必须可见

未知模块可以用 CustomModule 表达，但未知不能被伪装成已知模块；关键不确定性必须阻断 formal export。

### D5：同一计划驱动预览和 Visio

浏览器预览和 Visio 不允许各自重新解释网络。二者必须消费同一份 immutable PVP Snapshot，并通过 source mapping/readback 对账。

### D6：先确定性内核，再拆分 Agent

LangGraph 负责 Drawing Run 编排，Analyzer、Harness、Composer、Renderer 使用窄接口。只有语义模块内核稳定后，才扩展多 Agent 协作。

## 15. 自检结果

- 未把任何具体模型名称作为通用绘图入口。
- 明确区分数据对象、计算模块、结构容器、关系模块、状态模块和过程模块。
- 每类模块都定义了内部 parts，而不是只定义外框。
- 代码、草图和未知结构都有证据、置信度和 fail-closed 规则。
- 主图、detail inset、process lane 和 legend 的职责已分开。
- PVP、Visio native group 和 readback 的边界没有混合。
- 没有把浏览器预览、mock 或单元测试称为真实 Visio 完成。
- 实现顺序从 semantic contract → visual compiler → composition → PVP → Visio，避免继续堆叠零散 primitive。

本文完成后仍需用户评审；用户确认文档后，才进入 writing-plans 生成具体实现计划。
