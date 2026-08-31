# 通用语义视觉渲染设计

## 目标

在不绑定任何具体模型名称的前提下，修复 Universal IR 到 Visio 的视觉退化问题。网络源码先转换为通用拓扑，再根据节点语义、端口、张量形状、内部拓扑和分支关系生成语义视觉计划，最后由 Visio 原生图元执行绘制。

VGG16 只作为当前线性 CNN 路径的实际质量检查样本，不作为模板、特殊分支或固定模型回归集合。

## 非目标

- 不实现 VGG16、ResNet、U-Net 或 Transformer 模板。
- 不根据模型名称选择绘图逻辑。
- 不继续用更多矩形、棱柱和圆点装饰当前卡片式输出。
- 不凭空展开没有源码证据的自定义模块。
- 不创建新的 Visio 空白画布。

## 架构

```text
任意网络源码
  -> Universal IR
  -> topology-derived semantic visual grammar
  -> Visual Render Plan
  -> Visio native shapes and glued connectors
  -> Shape Data readback
```

Universal IR 描述网络是什么；语义视觉语法描述如何表达；Visio bridge 只负责把渲染计划转换为可编辑的原生 Shape。三层之间通过稳定的 `sourceNodeId`、`edgeId`、`visualRole`、`tensorShape`、`confidence` 和 `evidenceCount` 关联。

## 语义视觉角色

视觉角色由结构证据推导，不由模型名称推导：

- `feature-map-stage`：有空间维度和通道维度的特征变换，使用分层 feature-map 体块、明暗面、网格和尺寸标注。
- `pool-downsample`：池化或显式降采样，使用独立的降采样图元。
- `merge`：Add、Concat、Sum 或多输入融合，显示真实输入端和合并符号。
- `skip-connection`：保留独立的残差或旁路通道。
- `token-sequence` 与 `attention`：用序列、token 和注意力关系表达，不套卷积体块。
- `vectorize` 与 `neuron-layer`：分别表达 Flatten/Reshape 和 Dense/Linear，标签使用外部槽位。
- `compound-module`：存在内部拓扑证据时显示内部节点和边。
- `unresolved-module`：没有足够证据时保留未知边界，并显示不确定性。

每个外部图元都拥有 `labelSlots` 和 `styleProfile`。标题、张量尺寸、算子细节不再全部塞入 7pt 的形状文本中。

## Visual Render Plan

渲染计划包含以下稳定字段：

```javascript
{
  visualRole,
  styleProfile,
  labelSlots,
  geometry,
  geometryData,
  sourceNodeId,
  parentNodeId,
  shapeData,
  connectors,
  annotations
}
```

`geometryData` 用于记录重复层、切片、深度和网格等可编辑绘图信息；`labelSlots` 控制标签位于图元上方、下方、侧边或内部；`styleProfile` 选择低饱和的论文配色和明暗面规则。

## 布局

布局根据真实拓扑选择线性、分支、合并、旁路、嵌套 compound 或 unresolved 流程。线性网络可以合并连续的同类算子为阶段，但阶段内部仍然保留真实 operator chain 和层数证据。存在分支、merge、skip 或多端口时不得强行套单链布局。

页面宽度随内容扩展；节点宽度必须同时容纳语义图元和外部标签；字体大小不能用一个固定值覆盖所有图元。

## Visio 绘制

Visio bridge 为语义角色提供原生绘制工厂。feature-map 图元包含正面、顶面、侧面、层叠、可选网格和切片；pool、vectorize、neuron、merge 和 unresolved 使用独立表达。外部标签使用无边框文本 Shape，主 Shape 保留可编辑的 Shape Data。连接器继续通过 Glue 连接到真实 Shape，不绘制孤立直线。

Bridge 继续使用已有文档和页面，按 `renderId` 清理 Agent 自有 Shape，保留非 Agent Shape，并在保存后进行 Shape Data 和连接器读回。

## 验证

验证分为结构验证和实际样本检查：

- 结构化 IR fixture 验证线性、并行、多输入合并、skip、嵌套 compound 和 unresolved 结构，不使用固定模型名称。
- VGG16 仅作为当前线性 CNN 视觉路径的实际检查样本，检查 feature-map、pool、vectorize 和 neuron 语义是否恢复到已存在的较好基线。
- Visio 计划验证 `visualRole`、`styleProfile`、`labelSlots`、Shape Data、Glue 端点和读回完整性。
- 最终检查包括测试、JavaScript/PowerShell 语法、Visio 实际生成、PNG 视觉检查和 VSDX 读回。

## 实施顺序

1. 先为语义角色、标签槽位和低饱和样式补充失败测试。
2. 在 Universal Figure 中生成语义角色和渲染计划字段。
3. 在 Visio bridge 中恢复 feature-map、pool、vectorize、neuron 和外部标签的语义绘制。
4. 保留 compound、分支、merge、skip 和 unresolved 的通用拓扑处理。
5. 使用 VGG16 实际样本验证视觉结果，并使用结构化 IR fixture 验证通用性。
