# 证据驱动的通用论文级神经网络构图器设计

**状态：** 已按用户方向完成修订，等待用户审核；不是实现、测试、部署或真实 Visio 视觉验收
**日期：** 2026-08-26
**规范性作用：** 取代 `2026-08-24-automatic-structural-drawing-agent-design.md` 中从 GPG 到 PVP 的视觉构图与视觉验收设计；保留其输入证据、UGS、非执行、候选/澄清、密封导出、当前 Visio 页面和独立 readback 边界
**核心目标：** 用户提交此前未见过的代码、草图或文字描述后，Agent 从当前输入中恢复网络结构和表达重点，并使用从近期高水平论文中归纳出的通用视觉规律，生成模型无关、可解释、可编辑、可验证的论文级神经网络图。

## 1. 产品决策

论文图只用于研究和归纳通用规律，绝不作为运行时模板、拓扑来源或临摹对象。

运行时必须满足：

```text
用户代码 / 草图 / 描述
  -> 当前输入的证据提取
  -> 结构确认或一个明确澄清问题
  -> 模型无关 UGS
  -> 模型无关 GPG
  -> FigureStoryPlan
  -> FigureCompositionPlan
  -> 确定性 PVP
  -> 浏览器视觉验收
  -> 用户确认
  -> 密封的当前 Visio 页面绘制
```

运行时不得满足下列任何一种行为：

```text
论文名称 -> 论文图模板
模型名称 -> 固定布局
参考图相似度 -> 复制其构图
未见网络 -> 搜索最相似论文并套用
语言模型 -> 直接生成 SVG / 坐标 / COM / Visio 命令
```

这项设计的类比不是“图库检索”，而是编译器：论文研究帮助设计通用视觉语言；用户当前输入决定需要编译的程序。

## 2. 设计不变量

1. **输入证据决定结构。** 节点、端口、边、重复、张量事实、条件、状态和分组只能来自当前代码、草图、描述、用户确认或受信任的分析证据。
2. **UGS 是唯一拓扑事实。** 后续阶段不得增加、删除、重定向或猜测拓扑。
3. **GPG 是唯一展示语义投影。** 它将 UGS 事实映射为 stage、tower、tensor、token、memory、condition、merge 等展示语义，但不拥有第二套网络拓扑。
4. **Story 和 Composition 没有拓扑权力。** 它们只决定讲什么、折叠什么、展开什么、如何分面板和如何安排阅读顺序。
5. **PVP 是唯一几何事实。** 浏览器、SVG、PNG、Visio、readback 和 diff 均消费同一个已验证 PVP。
6. **论文身份不能影响运行时结果。** 删除论文标题、作者、模型名和 venue 后，已经提升的通用规则仍应可独立执行。
7. **未知模块不等于未知拓扑。** 陌生但接口明确的模块使用 `CustomOperator` 或 `CustomModule`；只有端口、方向、分支或汇聚不明确时才阻断正式图。
8. **不复制论文表达。** 不复用论文图的坐标、配色、图标、缩略图、标签、版面或受版权保护的图形资产。
9. **Visio 只渲染。** Worker 不选择论文风格、不理解网络、不重新布局、不补全拓扑。
10. **设计、实现和视觉验收分开。** 本规格不表示当前 Agent 已能生成顶刊质量图。

## 3. 参考论文研究的正确角色

### 3.1 研究语料不是运行时输入

近期论文架构图形成离线、人工审查的 `ReferenceFigureCorpus`。该语料只用于：

- 发现跨论文、跨领域重复出现的表达规律；
- 定义模型无关的视觉原语和布局约束；
- 构建匿名测试案例和人工视觉量表；
- 发现当前构图器在现代网络上的缺失语义；
- 回归检查新版本是否退化为普通流程图。

生产运行时不查询该语料来选择某篇论文，也不接收 reference figure ID、论文名称或模型名称作为布局参数。

### 3.2 ReferenceFigureRecord

每个研究记录至少包含：

```text
referenceId
citation
venueKind                 journal | conference | preprint
publicationYear
figureNumber
architectureCharacteristics
communicationGoal
panelStructure
readingOrder
abstractionLevels
dataRepresentations
moduleRepresentations
connectorSemantics
repetitionCompression
focusAndContextTreatment
typographyHierarchy
colorSemantics
legendStrategy
singleColumnReadability
doubleColumnReadability
grayscaleReadability
visioReconstructability
generalizableObservations
paperSpecificExpressions
licenseAndUsageNotes
reviewDecision
```

`paperSpecificExpressions` 必须显式记录不能进入通用规则的内容，例如专用图标、论文配色、模型名标签、特定模块轮廓、固定坐标或原图素材。

### 3.3 共性规则的提升门槛

一条 `GeneralizedVisualRule` 只有同时满足以下条件才能进入构图器：

1. 至少在三篇相互独立的论文图中观察到；
2. 至少跨两个发表渠道或两个研究领域；
3. 能用结构或表达意图谓词描述，不包含论文名和模型名；
4. 不需要复制任何参考图坐标、资产、文字或配色；
5. 能在匿名网络 fixture 上独立验证；
6. 失败时可以退回通用构图，而不是拒绝绘制；
7. 经过人工审查并记录来源、适用范围和反例。

“出现三次”只是候选门槛，不等于自动成为规则。审查者还必须证明这些案例共享的是结构或沟通问题，而不是同一作者群、同一模型系列或相互临摹造成的表面相似。无法写成匿名谓词的观察只能留在研究记录中。

每条可执行规则必须具有完整、版本化的定义：

```ts
interface GeneralizedVisualRule {
  ruleId: string;
  version: string;
  status: "candidate" | "reviewed" | "published" | "retired";
  structuralPredicate: StructuralPredicate;
  communicationPredicate: CommunicationPredicate;
  requiredSemanticFacts: string[];
  prohibitedConditions: string[];
  emittedConstraints: CompositionConstraint[];
  priorityClass: "safety" | "semantic" | "narrative" | "editorial";
  compatibleRuleIds: string[];
  conflictRuleIds: string[];
  deterministicTieBreakKey: string;
  fallbackRuleId: string;
  positiveFixtureIds: string[];
  negativeFixtureIds: string[];
  nonApplicableFixtureIds: string[];
  researchEvidenceIds: string[];
  reviewerDecisionIds: string[];
}
```

运行时只装载 `published` 规则的去标识化编译产物。该产物包含谓词、约束、优先级、冲突和 fallback，不包含 citation、论文标题、模型名、原图、缩略图或 reference ID。研究库和运行时规则包必须是物理分离的构建产物，并由依赖扫描测试保证生产 bundle 不携带研究素材。

示例：

```text
错误：如果模型名包含 UNet，则套 U 型模板。

正确：如果 UGS 证明存在连续降采样阶段、瓶颈、连续升采样阶段，
      且存在按尺度对应的跨阶段边，则提出 encoder-decoder 对称构图约束。
```

```text
错误：如果参考图与 SAM 2 相似，则复制其 memory bank 布局。

正确：如果 UGS 证明存在按时间消费的输入、持久状态和跨步反馈，
      则提出 temporal-memory 构图：时间轴、状态区、反馈 lane 和当前步焦点。
```

### 3.4 规则归纳流程

论文共性必须经过以下单向流程，不能由运行时反向检索：

```text
人工查看论文图
  -> 原子观察（它解决了什么沟通问题）
  -> 去掉论文、模型、作者和视觉资产身份
  -> 跨来源聚类
  -> 写成结构谓词 + 沟通谓词 + 构图约束
  -> 正例 / 反例 / 不适用 fixture
  -> 人工审查
  -> 发布匿名、版本化规则包
```

例如，“使用梯形”不是共性规则；“当有证据证明连续空间尺度变化，并且需要在有限宽度内保留尺度方向时，允许使用带尺度语义的 taper/slab primitive”才是可审查规则。形状选择仍须通过可读性、灰度和页面约束，不能因为某篇论文使用过梯形就触发。

### 3.5 初始与目标语料规模

2026-08-26 的研究形成 28 个初始跨领域论文页面或架构图样本，其中 20 个来自 2024–2025。正式语料目标为 60–100 个经过完整记录和人工复核的独立图样本，并满足：

- 2024–2026 论文不少于 60%；
- 顶级或领域权威期刊论文不少于 40%；
- 每个结构族至少 6 个独立来源；
- 同一作者团队或同一模型系列不得构成某条规则的全部证据；
- 每条提升规则必须有正例、反例和不适用案例；
- 原图只用于人工研究与合规审查，不成为运行时模板资产。

## 4. 输入驱动的结构恢复

### 4.1 代码

代码适配器不执行用户程序。它提取：

- 模块声明、调用和所有权；
- 输入输出端口与数据依赖；
- 可静态证明的分支、汇聚、重复和状态；
- 可静态证明的 tensor rank、尺寸、通道、token 数和尺度变化；
- 自定义模块边界和源码位置；
- 动态控制流、模块复用、别名和 shape 不确定性。

不能证明的局部结构不得由参考论文补全。未知 operation 可以绘制，未知 topology 必须澄清。

### 4.2 草图

草图解析只产生有置信度和来源定位的观察：

- 候选形状、分组、文本和箭头；
- 箭头方向与端点候选；
- 可能的对齐、重复、尺度和面板关系；
- 用户明确标注的重点、输入、输出和创新模块。

草图的颜色、位置和形状可以作为用户表达意图的证据，但不能直接成为最终 PVP 坐标。模糊箭头、重叠线或无法判断的 merge 产生一个局部澄清问题。

### 4.3 文字描述

Provider 只能提出结构化、证据引用的节点、端口、边、分组、tensor/state 事实和表达意图。它不能返回论文 ID、参考图选择、坐标、SVG、XML、Visio、COM、Worker、路径或脚本。

### 4.4 多输入融合

证据优先级固定为：

```text
用户明确确认
  > 可证明代码事实
  > 多来源一致事实
  > 文字或草图候选
  > 无证据猜测（禁止）
```

冲突只影响冲突区域；Agent 返回一个最小、确定的澄清问题，不因为局部冲突放弃整个已证明网络。

### 4.5 面向陌生输入的受约束分析器

“通用”不是要求静态解析器预先认识每个模型或类名，而是允许分析器理解陌生源码和草图，同时把推理限制在证据边界内：

1. 确定性适配器先生成不可变观察：AST/符号/数据依赖、OCR、形状、箭头、端点和区域；
2. Provider 只接收经过裁剪的 EvidencePack 投影，不接收 Worker、文件路径、论文语料或 renderer 能力；
3. Provider 返回 `InterpreterLocalProposal`，每个节点、关系、分组、语义角色和表达重点都必须引用 evidence ID，并给出置信度和必要的备选解释；
4. Structural Harness 验证引用、端口、方向、基数、重复和冲突，重新铸造 canonical ID；Provider 的对象 ID、顺序和文字不能成为事实；
5. 接口和数据流明确但内部未知时，Harness 形成 `CustomModule`，Agent 继续构图；
6. 会改变端口、方向、分支、汇聚、重复次数或状态边的歧义，产生一个确定性局部澄清，且不生成正式 PVP；
7. Provider 只能提出 Story/Composition 候选，规则引擎和 Harness 验证其适用谓词、禁止条件、来源覆盖和预算，之后才形成正式计划。

因此，新增网络通常只新增输入事实组合，而不新增模型适配器、模型模板或 renderer 分支。只有出现现有 UGS 无法表达的新型事实时，才通过版本化 schema 扩展进入设计流程。

## 5. 规范数据流

```text
DrawingIntent
  -> PrivateInputReceipt / EvidencePack
  -> StructuralAssessment
  -> formal UGS | deterministic clarification
  -> GPG v2 semantic projection
  -> FigureStoryPlan
  -> FigureCompositionPlan
  -> PublicationVisualPlan v2
  -> structural / semantic / narrative / visual QA
  -> SVG and PNG review projection
  -> user confirmation
  -> immutable Snapshot and sealed request
  -> selected-current-page Visio renderer
  -> native readback and save/reopen acceptance
```

不允许出现第二条从模型输出、参考图或 legacy figure DTO 直接进入 Visio 的路径。

## 6. GPG v2：展示语义，而不是模型分类

GPG v2 在不改变 UGS 拓扑的前提下，增加以下模型无关角色：

### 6.1 数据形态

```text
scalar_or_vector
token_sequence
image_or_feature_map
volumetric_tensor
latent_grid
graph_structure
attention_matrix
time_series_or_frames
domain_observation
prediction_or_reconstruction
uncertainty_or_confidence
```

### 6.2 模块角色

```text
input_adapter
encoder_stage
processor_stage
bottleneck
decoder_stage
prediction_head
custom_module
memory_bank
state_update
condition_encoder
teacher_module
student_module
loss_or_supervision
shared_backbone
task_adapter
```

### 6.3 关系角色

```text
primary_data_flow
skip_or_residual
cross_scale_feature
conditioning
query_key_value
cross_modal
state_or_feedback
temporal_transition
teacher_supervision
loss_dependency
callout_reference
```

### 6.4 状态与视觉含义

```text
repeated
shared
frozen
trainable
optional
candidate
user_focus
evidence_limited
```

GPG v2 只能添加从 UGS/EvidencePack 可推导的展示角色。无法证明时不添加角色，绝不能借助论文相似性猜测。

## 7. FigureStoryPlan：决定“讲什么”

`FigureStoryPlan` 是新的、无拓扑权力的规范中间产物：

```ts
interface FigureStoryPlan {
  storyPlanId: string;
  sourceUgsHash: string;
  sourceGpgHash: string;
  communicationGoal:
    | "architecture_overview"
    | "method_overview"
    | "module_detail"
    | "training_process"
    | "inference_process";
  primaryNarrative: string;
  primaryComponentIds: string[];
  contextComponentIds: string[];
  focusComponentIds: string[];
  compressionDecisions: CompressionDecision[];
  detailViews: DetailViewIntent[];
  omittedFactIds: string[];
  domainVisualIntents: DomainVisualIntent[];
  readingOrder: string[];
  targetPublication: "single_column" | "double_column" | "a4_landscape";
  evidenceIds: string[];
}
```

### 7.1 默认叙事决策

没有用户风格指令时，系统按以下顺序决定内容：

1. 输入、输出和主数据流必须可见；
2. 分支、汇聚、尺度变化、时间、状态和模态接口必须可见；
3. 重复等价结构优先折叠为 stage 和 repeat badge；
4. 自定义模块保留接口，内部细节只在有证据时展开；
5. 用户明确要求强调的模块成为 focus；
6. 系统不能自行把结构罕见等同于“论文创新”；
7. 训练、损失和推理过程只有在输入证据存在或用户请求时进入主图；
8. 不能在目标版面清晰表达的次要事实被记录为省略项，而不是静默丢失。

### 7.2 多视图触发条件

满足任一条件时可以生成 overview + detail：

- 一个模块内部有至少三个有证据的算子或关系，直接放入主图会破坏可读性；
- 网络同时存在宏观 stage 结构和局部创新机制；
- 训练与推理结构不同且用户请求两者；
- 主图需要折叠重复块，但用户要求展示一个 block 的内部结构；
- 多模态或多任务系统需要独立的数据/任务面板。

多视图默认不超过四个面板。每个面板必须有独立沟通目标、明确来源和 callout 关系。

## 8. FigureCompositionPlan：决定“怎么组织”

`FigureCompositionPlan` 将 Story 转为布局约束，但仍不包含最终 renderer 命令：

```ts
interface FigureCompositionPlan {
  compositionPlanId: string;
  storyPlanHash: string;
  panels: PanelPlan[];
  regionAssignments: RegionAssignment[];
  grammarApplications: GrammarApplication[];
  connectorClasses: ConnectorClassAssignment[];
  labelHierarchy: LabelHierarchy;
  legendPlan: LegendPlan | null;
  pageConstraints: PageConstraintSet;
  ruleApplications: RuleApplicationTrace[];
}
```

### 8.1 通用宏观构图

首批支持的构图不是模型模板，而是可组合约束：

1. **hierarchical-stage-pipeline**：分层 stage、尺度变化和重复压缩；
2. **encoder-decoder-multiscale**：有证据的降采样、瓶颈、升采样和跨尺度边；
3. **branch-fusion**：共享起点、平行分支、明确融合；
4. **dual-or-multi-tower**：多个模态或独立编码器进入共享接口；
5. **temporal-memory**：时间轴、当前步、持久状态和反馈 lane；
6. **iterative-process**：有界或抽象重复求解、去噪、优化和状态更新；
7. **graph-message-passing**：节点/边表示、局部消息和全局聚合；
8. **data-model-task**：数据来源、共享模型和下游任务；
9. **overview-with-detail-callout**：主干折叠、一个或多个证据充分的模块放大；
10. **general-publication-graph**：没有高级关系时仍保持主路径、分支、汇聚、重复和接口层级的专业基线。

一个图可以组合多个构图。例如时序多模态网络可以同时使用 multi-tower、temporal-memory 和 overview-with-detail-callout。

### 8.2 通用局部视觉语法

```text
TensorSlab / TensorVolume / LatentGrid
TokenStrip / QuerySet / AttentionMatrix
ImageStack / FrameStack / VolumeStack
GraphThumbnail / MessageFlow / AggregationMarker
StageFrame / ModuleFrame / OperatorFrame
RepeatBadge / SharedBadge / FrozenBadge / TrainableBadge
Split / Add / Concat / Gate / ConditionPort
MemoryBank / StateCell / IterationLoop / TimeAxis
LossNode / SupervisionConnector / TeacherStudentBoundary
PanelFrame / DetailCallout / AnnotationTrack / Legend
DomainThumbnail / AbstractDomainIcon
```

只有与数据语义相符时才使用三维、梯形或堆叠图元。普通 operator 不因“看起来更像论文”而强制变成立体图形。

### 8.3 连接线语言

路由器按关系角色分配端口、lane、线型和视觉权重：

- 主数据流优先、连续、最少转折；
- skip/residual 使用主节点走廊之外的稳定 lane；
- cross-scale 与对应 stage 对齐；
- condition/query 从独立语义方向进入；
- temporal/state 连接可使用反馈方向，但必须避开主文本；
- supervision/loss 使用低视觉权重，不抢占推理主线；
- callout reference 不是数据边，不得带数据流语义箭头。

### 8.4 规则匹配与确定性组合求解

构图器不是在十个宏观构图中“猜一个模板”。它按以下固定过程组合约束：

```text
UGS/GPG/Story facts
  -> 计算模型无关 structural signature
  -> 求值所有 published rule predicates
  -> 收集可兼容 composition constraints
  -> 先满足 safety / semantic 硬约束
  -> 再满足 narrative 约束
  -> 在页面预算内优化 editorial 软约束
  -> 按稳定 key 消解同分结果
  -> 输出 CompositionPlan + rule application trace
```

求解目标按固定优先级排序：事实完整性、主线连续性、语义关系可辨识、标签可读、交叉与穿字最少、对齐与重复压缩、留白均衡。低优先级美学目标不能牺牲高优先级语义目标。无高级规则适用或约束无解时，回退到 `general-publication-graph`，保留完整结构并记录降级原因；不得搜索相似论文，也不得让 Provider补坐标。

`FigureCompositionPlan` 必须记录每条规则的 `matchedFactIds`、`emittedConstraintIds`、`suppressedByRuleIds` 和 `fallbackReason`。相同 canonical 输入、规则包版本、Profile 和页面约束必须产生相同结果。

## 9. 现代编辑风格，不是期刊仿制

系统提供模型无关的 `EditorialProfile`：

1. `compact-technical`：适合双栏架构图，信息密度较高；
2. `balanced-method`：默认，整体与局部细节平衡；
3. `domain-narrative`：适合数据—模型—任务或跨学科方法图；
4. `module-detail`：适合算子、注意力、状态空间或融合模块展开；
5. `print-monochrome`：以灰度、线型和明度保证印刷可读。

Profile 只能控制：

- 字体层级；
- 间距和留白；
- 合法的 primitive family；
- 低饱和度语义色；
- 边框、线型和箭头；
- 面板标题与图例策略；
- 单栏、双栏和 A4 的密度预算。

Profile 不能控制拓扑、模型分类、模块内容、repeat count、事实标签或正式资格。Profile 名称不得使用期刊、论文或模型品牌。

## 10. DomainVisual 的安全边界

近期论文常把医学图像、病理切片、地球场、分子、视频帧或重建结果放入方法图。Agent 支持三类领域视觉：

1. 用户随任务提供且明确用于绘图的图像；
2. 从用户输入中生成的抽象、非识别性缩略图或网格；
3. 内置的通用抽象图标和占位视觉。

禁止：

- 从参考论文截取或重用图像；
- 未经授权下载领域素材进入用户图；
- 用虚构医学、实验或预测结果冒充真实输出；
- 将参考图视觉相似度作为结构证据；
- 把受版权保护的图形资产打包进运行时规则。

## 11. PVP v2 要求

PVP v2 在当前 primitive/port/connector/source-mapping 基础上增加：

- 嵌套 `panel`、`region`、`stage` 和 `detailView`；
- panel 与 reading-order identity；
- overview/detail callout mapping；
- label role：panel、stage、module、tensor、annotation、legend；
- semantic connector class；
- domain visual placeholder 或受信任资产引用；
- compression/omission provenance；
- target publication width 和最小字号；
- generalized rule provenance，但不暴露论文身份给 renderer；
- 页面重排版本和 deterministic layout seed；
- SVG/Visio 能力协商与允许的降级策略。

同一 UGS、GPG、Story、Composition、Profile 和目标版面必须产生相同 canonical PVP hash。

## 12. Page-aware 构图与 Visio

页面适配必须发生在 PVP 密封之前：

```text
结构和表达意图
  -> single-column / double-column / A4 composition
  -> page-aware reflow
  -> visual QA
  -> user confirmation
  -> sealed PVP
```

Visio Worker 只允许执行确定性的 affine fit、原生图元映射和同页 applyDiff。它不得在已确认后把横向图改成纵向图、改变 panel 顺序、折叠模块或新增图例。

现有当前页面合同继续有效：

- 使用用户已打开并选择的文档和页面；
- 不以新建文档或新页面作为 fallback；
- 保留 user-owned shape；
- 只替换匹配 ownership namespace 的 Agent shape；
- 正常绘制后保持 Visio 可见和文档打开；
- 保存、独立 readback、需要时的关闭/重开测试分别验证。

## 13. 分层 QA

### 13.1 结构 QA

- UGS node/port/edge/group 与来源一致；
- 无缺失端点、自环、非法方向或未确认拓扑；
- PVP 不能制造 UGS 中不存在的计算关系。

### 13.2 语义 QA

- tensor、token、graph、time、state 和 modality 表达与证据一致；
- frozen/trainable/shared/optional 等状态不被猜测；
- CustomModule 接口完整，未知内部不被伪装成已知算子。

### 13.3 叙事 QA

- 两秒内可以识别输入、主路径、输出和关键关系；
- 每个面板有唯一沟通目标；
- detail view 可追溯到 overview 中的组件；
- 折叠和省略有 provenance；
- 用户未声明创新时，系统不自行标记“创新模块”。

### 13.4 构图 QA

- panel、stage、module、label、legend 和 callout 不碰撞；
- 主线不被 skip、condition、state 或 supervision 抢占；
- 重复结构没有不必要展开；
- 对称或尺度对齐关系在允许误差内；
- connector 交叉数、穿字数和转折数在密度预算内；
- 留白分布、面板面积和视觉重量不过度失衡；
- 不出现大量无语义差异的同尺寸矩形。

### 13.5 出版与跨 renderer QA

固定验证：

```text
single-column color
double-column color
A4 landscape color
A4 landscape grayscale
SVG preview
Visio PNG export
saved-and-reopened Visio PNG
```

检查最小字号、灰度区分、线宽、箭头、裁剪、字体替代、图片清晰度、图例和 source mapping。结构 QA 通过不等于视觉 QA 通过。

### 13.6 人工视觉量表

“像顶刊”不能由单一相似度分数或 Agent 自评决定。盲审量表至少覆盖：

1. 结构忠实度（硬门，任何虚构或遗漏关键关系即失败）；
2. 两秒主线识别与阅读顺序；
3. 层级、重复压缩和 overview/detail 合理性；
4. 数据形态与连接关系的语义可辨识度；
5. 字体、标签、留白、对齐、线条和视觉重量；
6. 单栏、双栏、A4、彩色和灰度可读性；
7. SVG 与 Visio 的语义等价和 Visio 可编辑性；
8. 是否存在明显论文临摹、品牌化模板或普通流程图退化。

每张盲测图由至少两名未参与该规则编写的审查者评分；结构忠实度必须通过，其余维度使用五分制，任何维度不得低于 3，均值不得低于 4。审查者分歧超过 1 分时进入复核，不以平均分掩盖严重缺陷。

## 14. 验收语料

验收数据分成互不替代的三层：

- `ReferenceFigureCorpus`：只用于发现和审查共性，不进入生产运行时；
- `RuleDevelopmentFixtures`：匿名正例、反例和不适用案例，用于规则单测；
- `BlindHoldoutInputs`：规则冻结后才揭示的陌生代码、草图和混合输入，不得用于修改本轮规则后再原样计分。

首批结构覆盖至少包括：

1. 陌生多阶段空间主干；
2. 多尺度 encoder-decoder；
3. residual 与 projection shortcut；
4. 多分支 add/concat/gated fusion；
5. token/query/cross-attention；
6. 双塔跨模态融合；
7. 时间帧、memory bank 与反馈；
8. 有界迭代或 diffusion-like process；
9. graph message passing 与全局聚合；
10. teacher-student 与多目标训练；
11. 数据—共享模型—多任务；
12. overview + 两个 detail callout 的混合网络；
13. 未知 custom module 但接口完整；
14. 模糊草图只产生一个局部澄清；
15. 代码、草图和文字证据冲突的负例。

每个正向 fixture 必须从输入开始，而不是从手写 PVP 开始：

```text
prompt / static code / sketch observation
  -> EvidencePack
  -> UGS
  -> GPG
  -> Story
  -> Composition
  -> PVP
  -> SVG
  -> Visio
  -> readback
```

## 15. 防模板化测试

以下测试是阻塞门：

1. 删除输入中的模型名后，只要结构事实不变，结果拓扑和构图不变；
2. 将模型名替换成随机字符串，不得改变 grammar/profile 选择；
3. 未见过的新组合能直接生成图或一个澄清问题，不需要新增 renderer 分支；
4. 生产构建完全不包含 reference corpus 时，已发布的匿名规则包仍能工作；
5. 删除某一论文记录不会改变已版本化规则的运行结果；
6. 任何 generalized rule 都能在匿名 fixture 上被触发；
7. 输出不得与参考图在固定坐标、特定图标、特定文字或颜色序列上形成复制；
8. Provider 返回论文名称、图编号或坐标时，Harness 拒绝这些字段；
9. 只有结构变化、表达意图变化、规则版本或目标版面变化才能改变 PVP hash。
10. 同一结构使用不同类名、变量名、模型名和等价代码顺序时，除用户可见标题外，Story/Composition 保持不变；
11. 结构族相同但沟通目标不同，允许 Story 改变，但 UGS 和事实映射不得改变；
12. 把一个新网络组合成多个已知结构谓词时，规则必须可组合，不得要求新增以模型命名的分支。

## 16. 实施顺序

### P0：规范与研究语料

1. 固化 ReferenceFigureRecord 和 GeneralizedVisualRule schema；
2. 将 28 个初始论文页面或架构图样本扩展至 60–100 个完整记录的独立图样本；
3. 由人工审查提取共性、反例和适用边界；
4. 建立匿名 fixture 映射，不把论文名带入运行时；
5. 将本规格映射到 M2.13 的正式 acceptance，而不宣称其已实现。
6. 构建研究库与匿名运行时规则包的物理隔离和生产依赖扫描。

### P1：Story 与 Composition

1. 扩展 GPG v2 展示语义；
2. 实现 FigureStoryPlan parser/canonicalizer；
3. 实现 FigureCompositionPlan parser/canonicalizer；
4. 实现 hierarchy、encoder-decoder、branch-fusion、multi-tower、temporal、iterative 六类首批构图；
5. 建立 overview/detail 和 compression provenance。
6. 实现 GeneralizedVisualRule evaluator、约束冲突消解、稳定 tie-break 和通用 fallback；
7. 将受约束 Provider proposal 接入 Harness，保证陌生输入分析不拥有拓扑或几何权力。

### P2：PVP v2 与浏览器视觉验收

1. 支持嵌套 panel/region/stage/detail；
2. 支持新的数据形态、状态、连接线和标签语法；
3. 实现 page-aware reflow；
4. 实现分层 QA 和固定出版版面输出；
5. 对匿名现代网络语料完成 SVG 人工视觉验收。

### P3：当前 Visio 页面

1. 扩展 allowlisted native primitive；
2. 保持 PVP 到 Visio 一对一映射；
3. 在真实主机执行全部匿名结构案例；
4. 完成同页更新、保存、readback、关闭/重开、冲突和恢复；
5. 对 SVG 与 Visio PNG 使用同一视觉量表。

## 17. 完成定义

本设计对应的能力只有在以下条件全部满足后才能称为“可根据代码或草图绘制论文级神经网络图”：

1. 代码、提示和草图输入均有受控证据链；
2. 未见网络无需论文或模型模板即可形成 UGS；
3. Story 和 Composition 只从当前输入与通用规则产生；
4. 至少 15 个匿名复杂结构完成开发期端到端视觉验收；
5. 单栏、双栏、A4、彩色和灰度条件全部通过；
6. SVG 与 Visio 结果通过同一人工量表；
7. Visio 使用当前选中页面，保留用户 Shape，并通过保存/重开/readback；
8. 防模板化测试全部通过；
9. 无模型名、论文名、参考图 ID 或固定坐标参与运行时路由；
10. 冻结规则后，至少 12 份此前未见代码、12 份此前未见草图和 6 份代码/草图/描述混合输入通过盲测，覆盖至少六种结构组合；
11. 盲测期间若修改结构规则、构图规则或视觉量表，受影响样本作废并更换新的 holdout；
12. 人工视觉量表达到规定阈值，且没有论文临摹、模型名路由、普通流程图退化或 Visio 不可编辑问题。

在这些证据之前，只能分别声明结构分析、构图器、预览、Visio 渲染或某个 fixture 已通过，不能声明整个 Agent 已达到顶刊级通用绘图能力。

## 18. 非目标

- 不建立论文图复制器或模型图目录；
- 不训练系统记住某篇论文的坐标和配色；
- 不在运行时搜索相似论文后套图；
- 不让大模型直接输出 PVP 坐标、SVG、Visio 或 COM；
- 不用“支持多少个模型名称”作为 KPI；
- 不因追求视觉效果执行用户代码或猜测拓扑；
- 不在本设计阶段开展计费、商业化或无关平台功能；
- 不把本设计文档当作实现完成证据。
