# 设计迁移日志：从通用流程图到证据驱动的论文构图器

**日期：** 2026-08-26
**新规格：** `docs/superpowers/specs/2026-08-26-evidence-driven-publication-figure-composer-design.md`
**影响范围：** GPG 到 PVP 的表达规划、构图、视觉语法、研究语料和视觉验收
**状态：** 设计已修订，等待用户审核；没有因此新增运行时能力

## 1. 触发原因

真实 Visio v7 输出已经证明选中页面复用、Agent Shape 所有权、稳定替换、原生连线、保存和 readback 等执行基础，但可见结果仍是干净的工程流程图，与近期高水平论文方法图存在明显差距。

进一步检查 28 个跨领域论文页面或架构图样本后确认：2024–2025 的主要表达趋势不是更多装饰或固定梯形，而是多面板叙事、数据形态视觉化、stage/repeat 压缩、overview/detail 分层、训练与推理关系、时间/状态/条件语义以及克制的编辑风格。

用户同时明确要求：不能根据论文直接照着生成。Agent 必须总结跨论文共性，并在用户提供新代码、草图或提示后，根据该输入的证据分析和绘制。

## 2. 被修正的旧假设

| 旧假设 | 缺陷 | 新决策 |
|---|---|---|
| UGS/GPG 后可直接进入 PVP | 缺少论文叙事、抽象层级和多面板决策 | 增加无拓扑权力的 FigureStoryPlan 与 FigureCompositionPlan |
| 一个 `region:main` 足以承载通用图 | 无法表达 overview/detail、训练/推理和多视图 | PVP v2 支持 panel、stage、detail、callout、legend 和 reading order |
| rank/lane 紧凑布局是通用专业基线 | 只能稳定生成流程图 | 增加结构谓词驱动的宏观构图和 page-aware reflow |
| 论文图可作为风格样例 | 容易滑向隐式模板或临摹 | 论文只形成离线 ReferenceFigureRecord 和经审查的共性规则 |
| 更多图元就能提高专业感 | 缺少讲述重点和压缩策略 | Story 先决定主线、上下文、焦点、折叠和细节视图 |
| 视觉 QA 主要检查碰撞和越界 | 无法识别“正确但像流程图”的退化 | 增加叙事、信息层级、重复压缩、主线显著性、版面和跨 renderer QA |

## 3. 新的不变量

1. 参考论文、模型名称和图编号不得进入运行时路由。
2. 通用视觉规则必须跨论文、跨领域验证，并能在匿名 fixture 上工作。
3. 用户当前输入是结构和表达事实的唯一业务来源；参考图不能补全未知拓扑。
4. UGS 仍是唯一拓扑事实，GPG 仍是唯一展示语义投影，PVP 仍是唯一几何事实。
5. Story 和 Composition 只做表达规划，不改变网络。
6. 三维、梯形、token、矩阵、时间轴或领域缩略图只在语义匹配时使用。
7. 未知 operation 可画，未知 topology 澄清；不能因为没有见过模型而拒绝绘制。
8. Visio Worker 继续只消费密封 PVP，不查询论文、不理解模型、不重新布局。
9. 陌生输入由确定性观察、受约束 Provider proposal 和 Structural Harness 协作解释；Provider 不拥有拓扑、canonical ID 或几何权力。
10. 多个视觉规则按硬约束、叙事约束、编辑软约束和稳定 tie-break 组合，不按模型名选择一个模板。

## 4. 研究语料治理

初始研究的 28 个论文页面或架构图样本只作为设计证据。目标语料扩展到 60–100 个独立、完整记录的图样本，记录引用、沟通目标、面板、抽象层级、视觉语法、反例、合规信息和 Visio 可重建性。

一条规则至少需要三篇独立论文、两个渠道或领域、匿名 fixture 和人工审查，才能进入通用规则集。论文专用颜色、坐标、图标、文字和资产永不提升。

研究库、开发 fixture、盲测 holdout 和生产规则包必须分离。生产包只携带已发布的匿名谓词、约束、冲突、优先级和 fallback；不携带论文标题、模型名、reference ID、原图或缩略图。

## 5. 路线图与事实边界

该修订应进入 M2.13 的未来设计和 acceptance 范围，但本日志不修改 `agent-program-state.json`，不改变当前 milestone 状态，也不证明 GPG v2、Story、Composition、PVP v2、Provider、草图理解、Visual QA、Visio 或真实主机已经实现。

下一步必须先由用户审核新规格。审核通过后才能编写实施计划；代码实施必须按 GPG v2、Story/Composition、PVP v2/browser visual acceptance、Visio native acceptance 的依赖顺序进行。
