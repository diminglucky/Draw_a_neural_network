# 架构图质量方案：顶刊规范对照与处理计划

> 状态：Active
> 目标版本：`0.4+`
> 最后更新：2026-10-10
> 适用：`semantic-neural-scene/v1` → `neural-scene-layout` → `scene-svg-renderer` / `visio-bridge.ps1`

本文回答两个问题：**顶刊的神经网络架构图到底遵循什么规范**，以及**Synapse Studio 应该怎么改才能靠近它**。规范部分只引用有据可查的一手来源，不写"经验之谈"。所有"我们现状"的数字都在 2026-10-10 实测自 `artifacts/onnx/` 下五个 SVG。

---

## 一、顶刊怎么做

### 1.1 唯一的循证框架：PLOS ONE 2025

Marshall, Freitas & Jay 的《An evidence-based guidance framework for neural network system diagrams》（PLOS ONE 20(3): e0318800, 2025）是目前唯一针对"学术论文里神经网络系统图"做过访谈 + 卡片分类 + 对照实验 + 顶会语料统计的**循证**框架。Table 6 共 12 条：

| # | 指南 | 含义 |
| --- | --- | --- |
| A | 尽量使用常规图形对象 | 读者不认识的符号最容易造成困惑 |
| B | 信息流只用一种箭头 | 不同箭头留给**根本不同**的用途 |
| C | 谨慎使用精度 | 画 4 个重复体，一部分读者理解为"正好 4 个"，另一部分理解为"n 个" |
| D | 必须包含整个系统的输入与输出 | 让图的整体目的清晰 |
| E | 尽量用同一个示例贯穿全图 | 便于"先具象再泛化"地理解 |
| F | 视觉编码必须有意义 | 用邻近/对齐/尺寸分组时，必须有理由 |
| G | 便于导航 | 层、箭头要有标签，线性对齐，容易找到一条路径 |
| H | 不要为美观用颜色 | 颜色若使用，应当表示分组 |
| I | 使用既有惯例 | 例如 CNN 用传统 3D 格式，并把 filter 宽度用数字标出 |
| J | 考虑读者的预期 | CNN 就该有 pooling；没有且重要时要说明 |
| K | 要具体 | `BERT` 优于 `embedding` |
| L | 考虑有人不读正文只看图 | 图应尽量自足（self-contained） |

**量化结论（ACL 2017 全量长文，119 张 NN 系统图）**——这部分是框架最有分量的证据：

- 图的**指南合规率**与**论文引用量**正相关。合规 **≥10/12** 的图，引用量高于合规 <10 的；合规 **>85%** 的图更少落入低引用区间。
- 单条指南里，只有 **K（要具体）** 与 **L（自足）** 单独达到统计显著（p < 0.05）。整体平均合规率比任何单条都更能预测引用量。
- **引用量前 1/4（30 篇，≥28 次引用）的实际做法**：
  - 自足性（L）：**30/30 全部合规**——没有一篇违反。
  - 含全系统输入输出（D）：27/30 合规。
  - 避免非常规对象（A）：25/30 合规。
  - 用具体示例贯穿（E）：19/30 合规；**没有用示例的 11 篇里有 11 篇改用了数学记号**。
  - 只用一种箭头（B）：**只有 16/30 合规——近一半（14/30）刻意用了多种箭头**，用途是区分"数据流"与"数学运算"两个抽象层级。作者对 B 的评分也是最低的三条之一（另两条是 C、I）。
- 119 篇里 **64 篇（54%）** 在图中放了具体示例来实例化输入。

**作者/设计专家反馈的常见错误**：未解释的符号（最突出）、图内不一致、图间不一致、用一组圆圈表示张量维度造成歧义、缺乏方向性/导航。设计专家另外点名了**复杂图模型、非线性导航、缺输入输出、颜色不一致、箭头类型不统一、以及"令人困惑的阴影用法"**。

> 实践含义：**L（自足）和 K（具体）是唯一被数据证实与引用量挂钩的单条**，应该优先满足；B（单一箭头）在顶刊实际做法里是被普遍违反的，不必教条遵守，但每一种箭头都必须有明确、可解释的语义。

### 1.2 Nature 硬性规范

来源：Nature research figure guide — *Preparing figures: our specifications*。

**文字**
- 图内文字最小 **5 pt**、最大 **7 pt**（成品尺寸下的绝对值）
- 多面板图面板标签：**8 pt 粗体、直立、小写 a/b/c**
- 无衬线字体，**优先 Helvetica / Arial**
- **禁止彩色文字**——改用 keyline 把颜色引到黑色文字上
- 不要转曲（outline）；嵌入字体（TrueType 2 或 42）

**明确避免**：背景网格线、多余图标与装饰元素、投影（drop shadow）、图案（patterns，改用纯色）、压在图上的文字、重叠文字。

**颜色与无障碍**：使用色盲友好调色板（引 Wong, *Nature Methods* 8, 441 (2011)）；颜色只表达语义分组。Nature.com 遵循 WCAG 2.1 AA。

**导出**：矢量 **PDF / EPS**；**RGB**；图片 ≥300 dpi（在线 ≥450 dpi）；用比例尺而非放大倍数。
**标准尺寸**：单栏 **89 mm**，双栏 **183 mm**。

### 1.3 五家期刊硬指标对照

| 项目 | Nature | Science (AAAS) | Cell Press | IEEE | ACS |
| --- | --- | --- | --- | --- | --- |
| 单栏宽 | **89 mm** | **84 mm** | **85 mm** | 88.9 mm | 82.5 mm |
| 1.5 栏 | — | — | **114 mm** | — | — |
| 双栏 / 满栏 | **183 mm** | **174 mm** | **174 mm**（高 ≤225 mm） | 182 mm | 单栏即满 |
| 图内字号 | **5–7 pt** | ≥6 pt | **6–8 pt**（下限 6 pt） | ≥6 pt（推荐 8 pt） | ≥5 pt（推荐 8 pt） |
| 面板标签 | 8 pt 粗体**小写** a/b/c | 大写字母 | 大写粗体 9–10 pt | — | — |
| 轴标签 / 刻度 | 需轴线与刻度，轴标带单位 | — | 轴标 7–8 pt / 刻度 6–7 pt | — | — |
| 字体 | Helvetica / Arial | Arial / Helvetica | Arial / Helvetica（社内 Avenir） | Arial / Helvetica / Times | Arial / Helvetica |
| 线宽 | — | — | **0.5–1.5 pt** | — | — |
| 线稿分辨率 | 矢量优先 | 1200 dpi（栅格） | **1000 dpi** | >600 dpi | 1200 PPI |
| 色彩空间 | RGB | RGB 优先 | **RGB 必需** | — | — |
| 字体嵌入 | 要求 | 要求 | **要求（PDF/EPS）** | **必需，缺字体直接退稿** | — |
| 面板间距 | — | — | **2–3 mm** | — | — |

补充两条通用规则（Genes & Development 作者指南，代表老牌期刊口径）：
- **同一张图内字号变化不超过 2 pt**。
- 所有线条线宽 **≥0.25 pt**，否则制版时会丢失。

### 1.4 色盲友好调色板：Okabe-Ito（Wong 2011）

Nature 明文引用的就是这一套。八个色值（本项目应以此替换现有 ad-hoc 配色）：

| 名称 | HEX |
| --- | --- |
| Black | `#000000` |
| Orange | `#E69F00` |
| Sky Blue | `#56B4E9` |
| Bluish Green | `#009E73` |
| Yellow | `#F0E442` |
| Blue | `#0072B2` |
| Vermillion | `#D55E00` |
| Reddish Purple | `#CC79A7` |

### 1.5 领域惯例（CNN / Transformer）

- CNN 特征图用**长方体（cuboid）**；全连接层用点列或紧凑盒。
- 张量尺寸（通道数、空间尺寸）**用数字标注**。
- 池化、上采样用收缩/扩张几何表达尺度变化。
- 顶刊图几乎都是**横向主数据流 + 纵向分支**，且**输入输出各自可见**。

---

## 二、逐条差距分析（对照当前代码，2026-10-10 实测）

| 指南 / 规范 | 顶刊做法 | 项目现状 | 代码位置 | 差距 |
| --- | --- | --- | --- | --- |
| **L 图自足** | 有图例，颜色对应语义类别 | ✅ 已实现：仅列出图内实际出现的形态 | `scene-svg-renderer.mjs` `buildLegend()` | 合规 |
| **G 便于导航** | 步骤编号、方向指示 | ✅ 已实现：按 x 再按 y 排序的步骤圆标 | `scene-svg-renderer.mjs` `renderStepChip()` | 合规 |
| **I 既有惯例 + 数值标注** | CNN 用 3D 块并标出尺寸 | 部分：`volume` 三维盒已按张量形状定尺寸（通道定宽、空间边长定高）；尺寸仍只在标签里，未标在前表面 | `neural-scene-layout.mjs` `primitiveSize()` / `tensorSizeFactors()` | 中 |
| **H 颜色表意 + 图内一致** | 少量语义色，全图统一 | ⚠️ 三套并行配色：`BLOCK_STYLES`（12 种）、`styleForForm`（7 种）、`roleStyle`（8 种）互相叠加。三维盒的明暗已改为 HSL 保色相（不再出现脏灰） | `scene-svg-renderer.mjs` `tint()` / `styleForPrimitive()` | 中 |
| **Nature 禁止彩色文字** | 颜色只出现在图形上 | ✅ 已修复：序号改用深色 `#1F2937`，并有测试锁住 | `scene-svg-renderer.mjs` `stepChipMarkup()` | 合规 |
| **Nature 字号 5–7 pt** | 成品尺寸下绝对值 | ❌ 见 2.1 实测：双栏下最小 **3.34 pt**，单栏 **1.63 pt** | `scene-svg-renderer.mjs` `css()` | **高** |
| **图内字号变化 ≤2 pt** | — | ❌ 双栏下字号跨度 **3.34–6.31 pt**，跨度 2.97 pt | 同上 | 中 |
| **Nature 字体族** | Helvetica / Arial | ⚠️ 栈首是 `Segoe UI`（屏幕字体），Helvetica/Arial 只在后备位 | `scene-svg-renderer.mjs:32` | 中 |
| **A 常规图形对象** | 避免读者不认识的符号 | SVG 侧已修：合并算子改为标准「圆 + ⊕」；Visio 侧 `glyph` 仍被 `Draw-OperatorGlyph` 画成**椭圆** | `scene-svg-renderer.mjs` `renderGlyph()` / `visio-bridge.ps1:1123` | 中 |
| **B 箭头一致性** | 一种箭头表达信息流 | 5 种（`main-flow / bypass / state / conditional / cross-scale`），各有语义。顶刊 14/30 也这么做 → **不算缺陷**，但要保证语义可解释 | `scene-svg-renderer.mjs` `ROUTE_STYLES` | 合规 |
| **D 输入输出** | 全系统输入输出可见 | ✅ 有 input / output | — | 合规 |
| **E 单一示例贯穿** | 用具体示例实例化输入 | ❌ 只画结构，没有具体输入样例（如一张图 / 一个向量） | — | 中 |
| **C 谨慎使用精度** | 重复体不画成精确个数 | ✅ 用 `xN` badge，未画满重复实例 | `neural-visual-rules.mjs` `repeat-decoration` | 合规 |
| **K 具体** | 用具体名而非泛称 | ✅ 用真实 op 名（ONNX 直通后尤其准确） | — | 合规 |
| **Nature 面板标签** | 8 pt 粗体小写 a/b/c | 单面板输出，暂不适用；多面板场景缺失 | — | 低 |
| **Nature 避免装饰** | 无网格线 / 投影 / 图案 | ✅ 无网格线、无投影（2026-10-12 修正：此前误判为"已无网格线"，实际模块内有 3×3 网格，见 5.5）；⚠️ 组框用虚线 + 三维盒用 `shade()` 三档明暗，设计专家点名过"令人困惑的阴影用法" | `scene-svg-renderer.mjs:238-240 / 394` | 低 |

### 2.1 字号实测换算（最重要的一项）

Nature 的 5–7 pt 是**成品尺寸下的绝对值**，而项目用的是抽象 layout 单位，必须按"目标栏宽 ÷ viewBox 宽"换算：

```
有效 pt = 字号(用户单位) × (目标栏宽 pt) ÷ viewBox 宽度
```

实测各图在 Nature 双栏（183 mm = 518.74 pt）下的**最小字号（9 单位）**：

| 图 | viewBox | Nature 单栏 89 mm | Nature 双栏 183 mm | Science 单栏 84 mm | Cell 单栏 85 mm |
| --- | --- | --- | --- | --- | --- |
| `full/resnet18-lite` | 1397×872 | 1.63 pt ❌ | **3.34 pt ❌** | 1.53 pt ❌ | 1.55 pt ❌ |
| `full/unet-lite` | 1233×1186 | 1.84 pt ❌ | 3.79 pt ❌ | 1.74 pt ❌ | 1.76 pt ❌ |
| `full/vit-lite` | 1228×866 | 1.85 pt ❌ | 3.80 pt ❌ | 1.75 pt ❌ | 1.77 pt ❌ |
| `balanced/resnet18-lite` | 911×619 | 2.49 pt ❌ | 5.12 pt ✅ | 2.35 pt ❌ | 2.38 pt ❌ |
| `overview/resnet18-lite` | 1058×446 | 2.15 pt ❌ | 4.41 pt ❌ | 2.03 pt ❌ | 2.05 pt ❌ |

`full/resnet18-lite` 逐字号（双栏 183 mm，1 单位 = 0.3713 pt）：

| 元素 | 现在 | 双栏下有效值 | 单栏下有效值 |
| --- | --- | --- | --- |
| 图题 | 17 | 6.31 pt ✅ | 3.07 pt ❌ |
| body 标签 | 11 | 4.08 pt ❌ | 1.99 pt ❌ |
| 图例 | 11 | 4.08 pt ❌ | 1.99 pt ❌ |
| 组标签 | 10 | 3.71 pt ❌ | 1.81 pt ❌ |
| 图元标签 | 9.5 | 3.53 pt ❌ | 1.72 pt ❌ |
| Block 角标 | 9.5 | 3.53 pt ❌ | 1.72 pt ❌ |
| 步骤序号 | 9 | 3.34 pt ❌ | 1.63 pt ❌ |

**结论**：
1. 双栏下，除图题外**全部文字低于 5 pt 下限**，最小者低 33%。
2. 单栏下要满足 5 pt，字号需 ≥ **27.7 单位**——而我们的盒子本身才 60–110 单位宽。**单栏不是"缩放"问题，是"版式必须重做"的问题**：必须减少列数、放大盒子。
3. 要落在 5–7 pt 区间，双栏下字号应取 **13.5–18.9 单位**。也就是说字号要从 9 提到 ~14（**+50%**），而不是把图缩小。
4. 因此 `targetWidth`（mm）必须**反推布局**，而不是只用来缩放：它应当同时决定 `MAX_CHAIN_COLUMNS`、`GAP_X/GAP_Y` 与字号。

---

## 三、处理方案

### P0 — 立即可做（纯 Scene / 规则 / 渲染层，可自动测试）

1. **目标栏宽驱动排版（最高优先级，未做）**：给渲染器/布局加 `targetWidth`（mm）+ `journal` 预设（Nature 89/183、Science 84/174、Cell 85/114/174）。由目标宽度反推：① 字号区间（映射到 5–7 pt）② `MAX_CHAIN_COLUMNS`（单栏 ≤3 列，双栏 ≤6 列）③ `GAP_X/GAP_Y`。不满足 5 pt 时输出**诊断**而不是静默出图。
2. ✅ **取消彩色文字**（已完成，见 5.3）：序号改用深色 `#1F2937`。
3. **配色收敛为 Okabe-Ito（未做）**：三套并行配色合并为一套——**填充用 Okabe-Ito 的浅色调（同色系 20–25% 明度）**，**描边用 Okabe-Ito 原色**。语义只分四类：张量/特征图、算子、合并、未解析。对应指南 H、图内一致、Nature 无障碍。
4. ✅ **字体族改为 Helvetica / Arial 优先**（已完成，见 5.3）。
5. **字号跨度收敛到 ≤2 pt（未做）**：把 17/11/10/9.5/9 五档压到三档（图题 / 标签 / 图例），跨度落在 2 pt 内。

### P1 — 结构层（改动较大，需同步测试与 fixture）

6. **张量尺寸标在前表面**：`volume` 前表面标注 `C×H×W`，并把尺寸数字从标签里移除（避免重复）。对应指南 I、K。
7. **输入/输出具体示例**：给 input/output 图元挂一个可选的"示例"渲染（灰度缩略图或向量示意）。对应指南 D、E——这是顶刊前 1/4 里 19/30 的做法。
8. ✅ **`glyph` 语义拆分**（SVG 侧已完成，见 5.3）：合并算子改为标准「圆 + ⊕」。Visio 侧 `Draw-OperatorGlyph` 仍画椭圆，需 P2 同步。
9. ✅ **减少三维盒的明暗层次**（已完成，见 5.3）：`shade()` 三档压到 HSL 三面（顶/正/侧），色相不再流失。

### P2 — 需要真实 Visio 环境验证

10. **`visio-bridge.ps1` 绘制风格同步**：把 SVG 侧已完成的真三维盒、页边距、圆角连线、字号搬进 PowerShell。无 Visio 环境无法验证，必须单独验收。

### 验收标准

- 每项改动后 `npm.cmd test` 全绿（当前 **431/431**）
- **模块绘制不变量**（已落地，`scene-svg-renderer.test.mjs`）：全图只有两种线宽；无彩色文字；合并算子是圆且名字在圆外；图元内部无虚线（`callout` 除外）；三维盒侧面饱和度不低于正面的 75% 且必须更暗；进深随尺寸变化且落在 6–24
- **新增单元测试**：给定 `targetWidth`（mm）+ journal 预设，断言渲染出的最小字号落在该刊 5–7 pt 区间；断言 `targetWidth=89` 时列数 ≤3
- 图例、面板标签、序号有对应的 SVG 断言
- P2 必须在 Windows + Microsoft Visio 上做"写入 → 保存 → 重开 → 回读 → 导出 PNG 人工复核"

### 风险

- 默认投影档 `balanced` 受验收契约约束（`block-acceptance-audit.test.mjs` 断言 `bodyCount`、`neural-projection-map.test.mjs` 断言 conv-block 折叠），**不要为视觉改动而改折叠默认值**。
- 颜色收敛会改动 `BLOCK_STYLES`，需同步更新 `block-acceptance` 的视觉阈值。
- 折行/列数改动会触碰 `validateLaidOutScene` 的 `dag-direction-violation` 不变量（连接器目标 x 不得小于源 x），任何新布局都必须先过这一关。

---

## 四、参考来源

1. Marshall G, Freitas A, Jay C. *An evidence-based guidance framework for neural network system diagrams.* PLOS ONE 20(3): e0318800, 2025. doi:10.1371/journal.pone.0318800
2. Nature research figure guide — *Preparing figures: our specifications.* research-figure-guide.nature.com
3. Nature — *Final artwork guidelines*（标准尺寸 89 mm / 183 mm）. nature.com/documents/nature-final-artwork.pdf
4. Wong B. *Points of view: Color blindness.* Nature Methods 8, 441 (2011). nature.com/articles/nmeth.1618
5. Cell Press figure guidelines（85 / 114 / 174 mm，6–8 pt，线宽 0.5–1.5 pt，线稿 1000 dpi）
6. Science (AAAS) author preparation guide（84 / 174 mm，≥6 pt，线稿 1200 dpi）
7. IEEE author guidelines（字体嵌入必需，≥6 pt，88.9 / 182 mm）
8. Genes & Development 作者指南（字号变化 ≤2 pt，线宽 ≥0.25 pt）
9. 本项目 `docs/research/top-journal-neural-figure-grammar-2023-2025.md`（视觉语法快照）

---

## 五、已落地

### 5.1 ONNX 直通（"准"的根）

真正决定"像不像真实网络"的是**拓扑从哪来**。源码 AST 分析只能猜，ONNX 是编译器导出的确定事实。

| 改动 | 文件 | 说明 |
|---|---|---|
| ONNX 输入默认 `full` 投影 | `agent-pipeline.mjs`、`input-adapters.mjs`、`architecture-evidence-package.mjs`、`evidence-graph.mjs` | 此前 ONNX 导入后没有 `projection` 字段，`projectionDetailFor()` 回落到 `balanced`，把刚导入的真实算子链又折叠回几个大方块。现在 ONNX 默认逐算子出图，其他输入仍为 `balanced`；调用方可用 `projection` 显式覆盖，`full` 布局失败时显式降级并在 summary 记录。 |
| ONNX 直通 CLI | `scripts/draw-onnx.mjs` | `.onnx` → 证据包 → Universal IR → Scene → SVG + Visio Plan，全程无 LLM、无网络。 |
| PyTorch 导出脚本 | `tools/export_onnx.py` | `dynamo=True`（torch.export 路径）优先，失败降级 TorchScript trace。 |
| 合成样例 | `tools/make-sample-onnx.mjs` | 无 PyTorch 环境也能端到端验证；三个真实结构样例。 |
| 回归测试 | `onnx-direct-pipeline.test.mjs` | 锁定"ONNX 默认 full""逐算子出图""显式 balanced 仍然更粗"等契约。 |

### 5.2 视觉语法与版式（"像不像"的一轮）

| 改动 | 说明 |
|---|---|
| 算子语义 | `MatMul`/`Gemm`/`Transpose`/`Resize` 此前无别名，注意力与 FFN 全部落到 `custom`；`Softmax` 被无锚点的 `output` 规则吞掉，误画成检测头。现已全部映射到真实家族。 |
| 视觉语法 | 数据形状只给真正的张量边界；算子按类型分配形态（矩阵→叠板、逐元素→紧凑条、合并→⊕、卷积特征图→三维盒、上/下采样→楔形）。 |
| 形状驱动几何 | 空间边长定高、通道数定宽。`Conv_0 [1,64,112,112]` → 111×130，`Conv_11 [1,128,28,28]` → 127×92（更宽更矮），CNN 金字塔可见。 |
| 折行布局 | 列优先蛇形折行，保留"数据只能从左到右"的 DAG 不变量。 |
| 步骤序号 + 图例 | 对应指南 G、L。 |
| 配色收敛（第一轮） | `conv-block` 与 `encoder-stage` 统一同色。 |

**版式效果（已解决）：** 逐算子出图曾把线性主干排成一行（resnet 19.67:1、unet 18.66:1、vit 5.28:1）。折行后：

| 模型 | viewBox | 宽高比 | 图元形态 |
|---|---|---|---|
| resnet18-lite `full` | 1397×872 | **1.60 : 1** | 11 volume + 3 wedge + 1 glyph + 1 band + 1 stack |
| unet-lite `full` | 1233×1186 | **1.04 : 1** | 10 volume + 4 wedge + 2 glyph |
| vit-lite `full` | 1228×866 | **1.42 : 1** | 5 stack + 4 band + 4 glyph |
| resnet18-lite `balanced` | 911×619 | 1.47 : 1 | 整块折叠 |
| resnet18-lite `overview` | 1058×446 | 2.37 : 1 | 最粗粒度 |

### 5.3 模块绘制层重建（"单个模块画得丑"的一轮）

前两轮解决的是"拓扑对不对"和"整体版式"，但单个模块本身仍然难看：一个 `Conv_0` 盒子上叠了 10 个元素、5 种线宽，侧面还是脏灰。这一轮只改绘制层，不动版式。

**根因**：线宽散落着 `0.8 / 0.9 / 1.1 / 1.2 / 1.3 / 1.4 / 1.8` 七种，圆角有 `0 / 4 / 6 / 7 / 8 / 10 / 12 / 16` 八种，明暗由 `shade()` 直接向黑/白混合——`shade("#DCEAF4", -0.18)` 得到 `#b4c0c8`，饱和度从 0.52 掉到 0.13，整块发灰。

| 改动 | 说明 |
|---|---|
| 一套绘制令牌 | `STROKE = 1.25` / `STROKE_HAIRLINE = 1` / `RADIUS_2D = 8` / `RADIUS_SLAB = 5`。全图只有两种线宽。 |
| `tint()` 取代 `shade()` | 在 HSL 空间只调亮度、保留色相与饱和度。`#DCEAF4` 的侧面现在是 `#66a7d5`（饱和度 0.53）。 |
| 三维盒三面明暗 | 顶面 = 基色（最亮）、正面 = `tint(-0.10)`、侧面 = `tint(-0.34)`，光从上方来。 |
| 进深按自身尺寸 | `cuboidDepth()`：`clamp(min(w,h) × 0.26, 6, 24)`。旧实现固定上限 16，在 111×130 的盒子上只挤出薄边。 |
| `plane` 改为薄板 | 从"圆角矩形 + 内嵌细框"改成很薄的长方体，否则和 `band` 几乎分不开。 |
| `glyph` 改为圆 + ⊕ | 旧实现是圆角矩形里放加号，和普通算子框分不开；且加号与名字重叠。名字移到圆下方。 |
| `stack` 文字归位 | 等尺寸板沿右上错开，文字落到最前面那块板上（旧实现文字飘在叠板外）。 |
| `strip` 去掉虚线 | 虚线 tick 改为整高实线分段——既糊，又是 Nature 明令避免的 pattern。（2026-10-12 进一步：分段竖线本身也不编码 token 数，已全部去掉，见 5.5） |
| 删掉端口圆点 | resnet 一张图上 29 个；且三维盒的输出锚点在 `x+w`，正好落在侧面那条棱上，像蹭脏的斑点。锚点仍由布局层使用。 |
| 删掉悬浮药丸角标 | 角标改为名字下方的灰色说明行，不再用药丸背景。 |
| 禁止彩色文字 | 序号改用深色 `#1F2937`。 |
| 字体栈首 | `Segoe UI` → `Helvetica,Arial`。 |

**效果**：单个 `Conv_0` 从 10 个元素 / 5 种线宽降到 **4 个元素 / 1 种线宽**。

**新增 5 条不变量测试**（`scene-svg-renderer.test.mjs`）：统一线宽、无彩色文字、合并算子是圆且名字在圆外、图元内部无虚线（`callout` 除外）、侧面饱和度不得低于正面的 75% 且必须更暗。

### 5.4 字号合规：从"画得出"到"投得出去"（本轮）

5.2/5.3 之后图已经画得像了，但**没有任何一张图知道自己会被印多大**——字号是 layout 单位，排版时被期刊缩放多少、字号就变多少。这一轮把物理尺寸接上，并堵住最后一个静默越界。

**换算依据**：`有效 pt = 字号(单位) × 目标栏宽(pt) ÷ viewBox 宽(单位)`，其中 `目标栏宽(pt) = 栏宽(mm) ÷ (25.4/72)`。反向即 `unitsPerPt = viewBox宽 ÷ 目标栏宽(pt)`。

| 改动 | 说明 |
|---|---|
| `JOURNAL_PRESETS` | Nature 89/183、Science 84/174、Cell 85/114/174、IEEE 88.9/182、ACS 82.5/178，各自带 `fontPt` 区间与 `maxHeightMm`。 |
| `resolvePrintType()` | 按宽高比选栏（优先最宽且不超页高；都超则取最窄并报 `figure-too-tall`）→ 反推 `unitsPerPt` → 生成三档字号。跨度恒 ≤ 2 pt（Genes & Dev 通用规则）。 |
| 根节点物理尺寸 | 接 `journal`/`targetWidth` 时输出 `width="183mm" height="…mm"`，导出 PDF/EPS 后字号就是绝对 pt。 |
| `planFigureTypography()` | 出图前预检，无副作用，返回 `ladderPt / spanPt / diagnostics`。 |
| `scripts/check-typography.mjs` | **独立核验器**：直接量成品 SVG 里写进去的 `font-size`，换算成 pt 对照该刊上下限。不信任渲染器自报的诊断，两边必须一致。 |

**静默越界（本轮抓到并修掉的真 bug）**。三档字号一定落在区间内（是构造出来的），真正会越界的是**盒内自适应**：长名字在锁死的盒宽里只能靠缩字号。`fitLabelText` 的循环是"先判断再减 0.5"，最后一次递减会**越过下限**——比如 7.7 → 7.2，而 7.2 恰好放得下。此时文本没溢出，字号却已跌破期刊下限。原先只检查"放不下"，于是这类情况**全部漏掉**：

```
resnet18-lite  3D   183×140mm  pt: 4.69, 5.00, 5.16, 6.00, 7.00   ← 4.69 越界，旧逻辑未报
vit-lite       3D   183×207mm  pt: 4.55, 5.00, 6.00, 7.00        ← 4.55 越界，旧逻辑未报
```

修正判定口径：**只要最终字号低于下限（或在下限仍放不下）即越界**，不再只看"是否溢出"。修正后新增 `label-below-font-floor` 诊断，附上实际会掉到的 pt 与肇事标签名。

**越界的真实来源是 ONNX 节点名**。`vit-lite` 的 `labels` 为空，标签回退到 `sourceNodeIds[0]`，也就是导出器自动生成的 `算子类型_序号`——`LayerNormalization_8` 里的 `_8` 只是"第 8 个节点"，不是架构信息。新增 `displayNodeName()` 保守剥离该后缀：仅当"去掉 `_序号` 后剩下的是一个干净的算子名"（纯字母数字、无下划线/点/空格）才动手。`layer1.0.conv1`、`resnet50_conv1`、`Encoder Stage 1` 都不受影响。

**效果**：三模型 × 两种渲染模式共 6 张图，**全部落在 Nature 5–7 pt 区间内，跨度精确 2.00 pt**，且渲染器诊断与独立核验器 6/6 一致。

```
flat   resnet18-lite  183×140mm  5.00/5.02/6.00/7.00 pt  跨度 2.00  → 合规
flat   unet-lite       89×186mm  5.00/6.00/7.00 pt        跨度 2.00  → 合规
flat   vit-lite       183×207mm  5.00/5.03/6.00/7.00 pt  跨度 2.00  → 合规
3D     resnet18-lite  183×140mm  5.00/5.02/5.16/5.67/6.00/7.00 pt  跨度 2.00  → 合规
3D     unet-lite       89×186mm  5.00/6.00/7.00 pt        跨度 2.00  → 合规
3D     vit-lite       183×207mm  5.00/5.03/6.00/7.00 pt  跨度 2.00  → 合规
```

**新增 6 条测试**：无 `targetWidth` 时保留旧字号阶梯且不声明 mm；五刊预置各自把字号阶梯收进该刊区间且跨度 ≤ 2 pt；显式 `targetWidth` 被遵守且高度按 viewBox 比例推出；超高图报 `figure-too-tall`；跌破下限的标签报 `label-below-font-floor` 且**诊断值与成品 SVG 实测 pt 一致**（含短标签不报的对照组）。

### 5.5 模块内部：去掉装饰线，改由形状承载语义（本轮）

**问题**：模块内部画了横线竖线。resnet 一张扁平图里有 **92 个 `<line>`**，其中约 87 个是模块内部的装饰。

| form | 数量 | 内部几何 | 信息量 |
|---|---|---|---|
| `volume`（卷积/特征图） | 11 | 内嵌矩形框 + 2~4 条网格线 | **零** |
| `wedge`（池化/上采样） | 3 | 两层 mini 网格 + 3 条映射线 | 零 |
| `stack`（矩阵/线性） | 1 | 2~3 条横线 | 零 |

**这些线不编码任何信息**——它们的分格数是按**盒子尺寸**算的，与数据无关：

```js
const divisions = gw >= 46 && gh >= 26 ? 3 : 2;   // 只看盒子大小，不看卷积核/通道数/分辨率
const slats = h >= 40 ? 4 : 3;                     // 同上
const segments = Math.max(2, Math.min(6, Math.round(w / 16)));  // 同上
```

比"多余"更糟的是**误导**：读者会以为格数代表核尺寸或特征图分辨率。resnet 的 11 个 volume 全是 86×60，于是全是 3×3 网格——而 stem 的 7×7 卷积和 3×3 卷积画出来一模一样。

**一手证据**（仓库 `tmp/refs`、`tmp/pdfs` 里已有的四张原始论文图）：

| 图 | 出处 | 模块内部 |
|---|---|---|
| U-Net Figure 1 | Ronneberger 2015, MICCAI | 纯矩形；**算子画成箭头**（conv 蓝 / max-pool 红 / up-conv 绿），不在盒内画任何东西 |
| VGG16 | 官方图 | 偏移的**平面堆**（正是我们的 `renderFeatureMapStack`），平面边缘是三维构造，**没有网格** |
| Attention | Vaswani 2017, NeurIPS | 纯圆角矩形 + 标签，**内部完全空白** |
| ViT | Dosovitskiy 2021, ICLR | 纯圆角矩形 + 标签；合并用 **⊕ 圆**；重复块用 **"L ×" 标注**；图像输入用**真实缩略图** |

四张图**没有一张**在模块内部画网格。那张 3×3 网格既不属于 U-Net 也不属于 VGG16，是教科书/博客的发明。

**改法**：算子类型改由「**形状 + 标签 + 填充**」承担，而不是盒内装饰。

| 形态 | 改前 | 改后 |
|---|---|---|
| `volume` 卷积/特征图 | 矩形 + 内嵌框 + 3×3 网格 | **圆角矩形** |
| `wedge` 下采样/上采样 | 矩形 + 两层网格 + 映射线 | **梯形**（收窄=池化 / 放宽=上采样），3D 模式为**梯形棱柱** |
| `stack` 矩阵/线性 | 矩形 + 叠层横线 | 圆角矩形（`RADIUS_SLAB`，小圆角） |
| `strip` 序列张量 | 矩形 + 分段竖线 | 圆角矩形 |
| `glyph` 合并 | 圆 + ⊕ | 不变（⊕ 就是符号本身） |
| `plane` 图像输入 | 矩形 + 图片符号 | 不变（对应 ViT 的缩略图） |

**关键点：形状词汇其实变多了。** 改前池化也是矩形（只是盒内有淡淡的网格），改后是真梯形——resnet 的 17 个模块现在有 3 种轮廓（矩形 / 梯形 / 圆），而改前只有 2 种。所以这既满足了"模块内无横竖线"，也没有退回"全是矩形"。

**梯形带来的两个新约束**（都已处理）：

1. **文字面变窄**：梯形中腰处宽度才是可用宽度（`w - inset`），`textFace` 据此收窄，否则名字会从斜腰里伸出去。
2. **角标会悬空**：步骤角标原先贴在盒子的左上角，而梯形的左上角是**斜的**（3D 棱柱还多一层顶面斜边）。新增 `wedgeLeftAt()` 求形状在任意高度处的左边界，角标据实定位。验证时注意**角标是圆**——最左点只在圆心高度处，用包围盒角点判定会过于保守。

**效果**：两种模式 × 三模型，**所有 `<line>` 都只剩合并算子 ⊕ 的两条臂**。

```
flat  resnet18-lite  17 模块   4 条 line = 2 个 ⊕ × 2 臂
flat  unet-lite      16 模块   6 条 line = 3 个 ⊕ × 2 臂
flat  vit-lite       13 模块  10 条 line = 5 个 ⊕ × 2 臂
3D    同上（3D 模式的 <polygon> 是平面堆与棱柱的面，不是装饰线）
```

**新增 2 条测试**：`flat 模式无装饰线 + 形状词汇（梯形真的收窄/放宽、角标不悬空）`；`两种模式都无装饰线 + 3D 梯形角标不悬空`。

**⚠️ 替换了一条既有测试**。原先有一条 `flat mode gives volume, plane, and stack distinct silhouettes`，锁的是"卷积必须是网格（`opacity="0.42"` 的网格外框 + ≥2 条 line）、矩阵必须是叠层条"。那是上一轮"不应该全是矩形"诉求下的产物，与"模块内不许有横竖线"直接冲突。已改为锁新不变量：**无装饰线 + 形状承载类型**，并保留原测试的**意图**（形态必须可区分）——只是改由轮廓与类名区分。

### 5.6 仍未解决

- **配色未收敛到 Okabe-Ito**：`BLOCK_STYLES`（12 条）/ `styleForForm`（7 条）/ `ROLE_STYLES` 三套并行，尚未合并为"填充用浅色调、描边用原色"的单一色板（1.4 节）。
- **重复块没有 "L ×" 标注**：ViT 参考图用一个 `L ×` 代替 N 个重复块，我们仍逐个画出（vit-lite 里 4 个 MatMul）。
- **张量尺寸没有标注**：U-Net 参考图在每根柱旁标 `572 × 572` / `64`，我们只标算子名。`data.tensorShape` 已经有了，缺的是排版。
- **`cnn-tower` 无真实样本**：没有 VGG/AlexNet 的 ONNX，塔形版式只有合成测试覆盖。
- **`lstm` / `gcn` / `gan` / `graphcast` 仍是 sequential 兜底**：缺 RNN 状态轨、GNN 不规则图、GAN 双塔三个原型。
- **跨列正交总线 / 列密度均衡**：各列盒子高度随张量形状变化，列间未做密度均衡，右下留白偏大；跨列跳跃仍沿上/下边缘长距离走线。
- **长算子名的折行位置**：折行仍是可达路径（当前 6 张图 0 次触发），触发时按字符中点断词，应改 camelCase 边界折行或领域标准缩写。
- **长算子名的折行位置**：当前 6 张产出里折行**一次都没触发**（`LayerNormalization` 在 72 宽的盒子里以 5.03 pt 单行放下）。但折行仍是可达路径——名字再长一档就会触发，而它按**字符中点**断开（`LayerNormalization` → `LayerNorm` / `alization`），断词难看。应改为 camelCase 边界折行，或采用领域标准缩写（LayerNorm / BatchNorm / GAP）。
- **Visio 侧未同步**（P2）：无真实 Visio 环境可验证。
