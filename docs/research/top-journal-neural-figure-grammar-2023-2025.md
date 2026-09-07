# 近三年高影响论文神经网络架构图研究记录（2023–2025）

## 研究边界

这里的“顶刊绘制”不是复制某一张 VGG16 图，也不是按模型名称选择模板，而是提取近期高影响论文中反复出现、且可以迁移到任意网络的视觉语法。VGG16 只作为当前线性 CNN 路径的回归样本；最终 renderer 必须从 Universal IR 的拓扑、张量形状、端口和内部证据生成图形。

样本采用 2023–2025 年公开论文页面和图 1，重点观察架构图而不是结果图：

| 样本 | 期刊/年份 | 观察入口 |
| --- | --- | --- |
| CHGNet model architecture | Nature Machine Intelligence, 2023 | [doi:10.1038/s42256-023-00716-3](https://doi.org/10.1038/s42256-023-00716-3) |
| The Allegro network | Nature Communications, 2023 | [doi:10.1038/s41467-023-36329-y](https://doi.org/10.1038/s41467-023-36329-y) |
| EMReady deep learning framework | Nature Communications, 2023 | [doi:10.1038/s41467-023-39031-1](https://doi.org/10.1038/s41467-023-39031-1) |
| Accurate structure prediction with AlphaFold 3 | Nature, 2024 | [doi:10.1038/s41586-024-07487-w](https://doi.org/10.1038/s41586-024-07487-w) |

## 共同视觉语法

### 1. 先表达数据流，再表达装饰

主干方向、输入输出、分支和汇合是第一层信息。箭头连接的是语义端口，而不是装饰线；旁路、recycling、skip connection 有独立的 lane 和颜色，不能被压成一个普通直连箭头。

### 2. 模块不是空白卡片，而是“边界 + 内部证据”

高影响论文通常把大模块画成浅色容器，内部放少量但有证据的算子节点。例如 CHGNet 的 Interaction block、Allegro 的 Layer/MLP 链、AlphaFold 3 的 MSA/Pairformer/Diffusion module。模块内部节点可以折叠，但折叠必须由重复数、内部图或源码证据支持；没有证据时保留 unresolved 边界，不臆造结构。

### 3. 重复层要折叠成“重复语义”，不是堆满同样的方块

重复的卷积/Transformer/Interaction layer 通常用以下组合表达：少量可见实例、中心省略号或 repeat 标记、内部方向箭头。可见实例的数量随重复数和可用空间变化，不能把每一层都画成等权重的大卡片。

### 4. Tensor 与 operator 使用不同几何

CNN/3D 数据使用薄的层叠平面或 tensor stack，尺寸变化通过高度/宽度/通道标注表达；pool/downsample 使用收缩几何；Flatten/reshape 使用漏斗或带状转换；Dense 使用窄列和神经元节点；普通算子使用紧凑圆角 capsule。所有角色都不能退化为相同矩形。

### 5. 颜色表示语义通道，不能成为随机装饰

低饱和底色表示模块边界，较强颜色只用于输入类型、分支通道、skip/residual 或关键算子。颜色应在灰度打印下仍能通过边框、线型、位置或符号区分。顶刊样本普遍使用少量固定语义色，而不是每个节点随机换色。

### 6. 标签分槽，不挤进主体

标题、算子参数、张量尺寸、重复数、端口名分别占用上方/下方/侧边槽位。主体内部只保留短算子名；长公式、尺寸和证据不应把模块撑成横向卡片。字体和标签宽度必须随角色和画布缩放计算。

## 对当前 renderer 的直接结论

当前代码已经具备 Universal IR、语义角色、原生 Visio Shape、Glue 和 Shape Data，但 feature-map 路径仍有两个退化点：

1. `Draw-FeatureMapStack` 只把重复层画成相同的 3D 平面，内部 `repeatCount/internalNodeCount` 没有成为可见的模块语法；
2. `Draw-FeatureMapTexture` 画完整规则网格，虽然消除了空白，但视觉上变成表格，不能表达算子链或激活场。

因此本轮修复采用“薄 tensor stack + 稀疏 activation field + evidence-driven operator rail”：

- 保留当前 3D tensor stack 的可编辑原生图元和尺寸比例；
- 用少量不规则、短的原生线段/小胶囊表示空间激活场，不再画完整网格；
- 当 `repeatCount` 或 `internalNodeCount` 有证据时，在前表面增加紧凑的 operator rail，显示重复算子的层次，而不是凭空绘制未知模块；
- 当没有内部证据时，只显示 tensor stack 和通道/尺寸标签，不制造假内部结构；
- 分支、merge、skip、compound、unresolved 继续走各自的 renderer，不能被 CNN 路径吞掉。

## 自测标准

每次视觉修改都必须同时通过四层检查：

1. **语义测试**：结构化 IR fixture 证明角色来自证据，不来自模型名称；
2. **渲染计划测试**：`visualRole/styleProfile/labelSlots/geometryData` 和 source IDs 保持完整；
3. **Visio 结构测试**：原生 Shape、Glue 端点、Shape Data readback 完整，且更新已有文档 `Page-1`；
4. **视觉回归**：在现有 VGG16 文档原地重绘，检查薄 tensor、pool 收缩、operator rail、标签可读性、分支/汇合和空白边缘。若输出只是方块阵列或规则表格，则视为失败，不能以“测试通过”结案。

## 一致性边界

“一模一样”可以在给定同一源码、同一版式参数、同一参考图和同一 Visio 字体环境时做到可重复；对任意未知网络，不能预先保证与某篇论文逐像素一致，因为论文图本身包含作者手工排版、裁剪和未由源码公开的视觉决定。本项目的可验证目标是：对已有证据逐项一致、结构不丢失、版式规则稳定、Visio 图元可编辑，并通过参考图对比持续收敛。
