# Agent Pipeline Refactor Design

## Goal

将神经网络绘图 Agent 从“识别模型名称并套用模板”重构为“基于输入证据恢复网络拓扑，再生成可编辑图形”的统一主链路，并让浏览器预览与 Visio 原生绘制消费同一份绘图计划。

## Non-goals

- 不新增 LSTM、CNN、ResNet 等模型专用生产模板。
- 不让模型名称、关键词或模型库决定节点、边和布局。
- 不把论文图或草图直接当作最终图片嵌入 Visio。
- 不在本轮实现训练、推理或模型评估功能。

## Architecture

生产链路划分为六层，每层只负责一种转换：

```text
Input Adapter
  → Evidence Extraction
  → Evidence Graph / Diagnostics
  → Universal Network IR
  → Figure Style IR / Layout Plan
  → Browser SVG + Visio Native Render Plan
                         ↘ Readback / Repair Loop
```

### 1. Input Adapter

输入适配器把源码、图片/论文图、草图统一成 `ArchitectureInput`。每个输入包含 `kind`、原始内容、来源标识和可选用户说明。第一阶段保证源码路径完整可用；图片和草图提供稳定的适配器接口及“证据不足”的诊断，不伪造拓扑。

### 2. Evidence Extraction

提取器只输出可追溯证据，不直接输出绘图形状。源码提取器复用现有静态解析能力，产出模块、调用/数据流、输入输出端口、张量信息、重复结构、分支/合并/循环以及来源位置。视觉提取器和人工确认未来使用相同的证据契约。

每条证据都带有 `evidenceId`、`source`、`confidence` 和 `status`。无法确认的结构必须标为 `unresolved`，并进入诊断列表。

### 3. Evidence Graph and diagnostics

证据图是从来源证据到规范网络 IR 的中间层。它保留冲突、缺失和不确定性，不在早期阶段丢弃。规范化失败时主链路返回结构化诊断，包括阶段、代码、消息、关联节点/边和建议动作；Agent 可以据此请求确认或触发修复。

### 4. Universal Network IR

Universal IR 是唯一的网络语义来源，至少表达：

- 节点身份、类型、标签、来源证据和置信度；
- 输入/输出端口及张量形状、数据类型、语义；
- 有向数据边、控制/状态边、残差/跳连和循环边；
- 重复/共享参数关系、分支与合并关系；
- 未解析节点和边，不得静默删除。

IR 校验集中处理 ID 唯一性、端口存在性、边引用、循环合法性和 unresolved 诊断。布局与渲染层不得重新猜测网络语义。

### 5. Figure Style IR and layout

Figure Style IR 根据 Universal IR 的拓扑和节点语义选择视觉语法，而不是根据模型名选择模板。视觉语法只描述“如何表达”：算子、容器、状态、门控、聚合、分支、循环、张量流和注意力等角色。布局计划描述节点位置、层级、通道、端口和边路径，保留真实拓扑；只有在明确无残差/跳连/循环边时才允许压缩为单通道布局。

Figure Plan 是浏览器和 Visio 的共同输入，包含稳定的 `sourceNodeId`/`sourceEdgeId`、`visualRole`、`shapeKind`、端口坐标、连接器路径、标签和诊断标记。浏览器只负责快速可视化，Visio 负责把同一计划投影为原生 Shape、Connector 和 Shape Data。

### 6. Agent loop

Agent 以可恢复的阶段状态运行：`inspect → extract → normalize → plan → render → readback → diagnose → repair`。每一阶段产生不可变快照和诊断；重试只从最近一个有效快照继续。若证据不足，状态为 `needs-confirmation`，不自动生成未经证实的结构。

Visio 绘制完成后必须执行最小读回：源节点/边 ID、Shape Data、连接器粘合关系和当前文档截图。读回差异转成诊断，Agent 只修复绘图计划或映射问题，不修改来源证据。

## Module boundaries

- `input-adapters.mjs`: 统一输入契约和输入类型分发。
- `evidence-graph.mjs`: 证据、冲突、不确定性和诊断模型。
- `network-ir.mjs`: 规范网络 IR 的构造、归一化和校验入口。
- `figure-plan.mjs`: Figure Style IR、布局计划和渲染计划契约。
- `agent-orchestrator.mjs`: 阶段状态机、快照、诊断和修复循环。
- `agent-pipeline.mjs`: 兼容现有服务的薄编排入口，只连接各层，不承载模型模板逻辑。
- `browser` / `visio` renderer: 只消费 Figure Plan，不重新识别模型。
- `models.js`: 保留为演示/fixture 数据源，不再作为生产 Agent 入口。

## Error handling

所有阶段错误都使用结构化诊断，不以字符串猜测下游行为。诊断分为 `input-invalid`、`evidence-conflict`、`ir-invalid`、`layout-invalid`、`render-failed`、`readback-mismatch` 和 `needs-confirmation`。不可恢复错误停止在当前阶段；可恢复错误最多按策略重试，并保留每次尝试的原因。

## Testing and acceptance

测试按层验证：

1. 输入适配和证据图契约测试；
2. Universal IR 拓扑、端口、状态边、循环边和 unresolved 保留测试；
3. Figure Plan 测试，证明同一 IR 不依赖模型名称且浏览器/Visio 计划一致；
4. Agent 状态机测试，覆盖确认、失败、读回差异和修复；
5. 现有回归测试；
6. 源码闭环验收：源码 → IR → 浏览器 SVG → Visio VSDX → Shape Data/Connector readback → 截图检查。

验收报告必须分开记录源码、测试、浏览器输出、Visio 实际运行、PNG 视觉检查和 VSDX 读回证据，不能用其中一项替代另一项。

## Migration strategy

先增加新契约并把现有源码分析接入新编排器，再迁移浏览器与 Visio 入口到 Figure Plan，最后删除生产路径中的模板分支。旧模板仅在明确的 fixture/test 入口可调用；任何生产请求都必须经过证据图和 Universal IR。
