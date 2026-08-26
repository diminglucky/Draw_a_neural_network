# DB-2026-08-26：证据驱动论文构图器草案基线

**Baseline ID：** `DB-2026-08-26-evidence-driven-publication-composer`
**状态：** `draft`，等待用户审核；不能作为 milestone acceptance、release 或真实视觉能力证据
**创建日期：** 2026-08-26
**基线分支：** `codex/current-page-visio-chain`
**基线前提交：** `5de06101b0db6d453543c8e7af3126daf2ed7f5a`

## 1. 冻结的设计资产

| 资产 | 路径 | 作用 |
|---|---|---|
| 规范性构图器规格 | `docs/superpowers/specs/2026-08-26-evidence-driven-publication-figure-composer-design.md` | 定义输入证据、论文共性治理、Story、Composition、PVP v2、QA 和 Visio 边界 |
| 设计迁移日志 | `docs/design-log/2026-08-26-research-derived-publication-composer-revision.md` | 记录从通用流程图到论文构图器的原因和取代关系 |
| 自动结构绘图前序规格 | `docs/superpowers/specs/2026-08-24-automatic-structural-drawing-agent-design.md` | 保留 EvidencePack、UGS/GPG、候选/澄清、非执行和密封当前页路径 |
| 当前页 Visio 表现规格 | `docs/superpowers/specs/2026-08-25-selected-page-publication-presentation-design.md` | 保留 Worker 端原生映射、页面适配和用户 Shape 安全边界 |

本草案基线随设计提交保存，但不会在原文件上改为 `accepted`。用户审核通过、实施计划完成且治理映射一致后，应创建后继接受基线并记录最终设计提交、文件 hash 和审查证据。

本次草案冻结的内容 hash：

| 资产 | SHA-256 |
|---|---|
| 规范性构图器规格 | `D01C22F147BC4CD6431BF945A97A87B1F6935B4AD1249B6501615B336260F8D6` |
| 设计迁移日志 | `1AECDABB2DDED70A4797D46D0D03387C61E2DC8ABE3F676349A8B9BCC72CBD2A` |

## 2. 冻结的核心决策

1. 论文研究只产生经审查的模型无关共性规则，不产生运行时论文模板。
2. 用户代码、草图、描述和确认是网络事实与表达意图的来源。
3. UGS、GPG、PVP 继续分别拥有拓扑、展示语义和几何权威。
4. FigureStoryPlan 和 FigureCompositionPlan 只拥有表达规划权，不能改变拓扑。
5. 共性规则需要跨至少三篇论文、两个渠道或领域，并通过匿名 fixture。
6. 运行时不接受论文名、模型名、reference ID 或参考图相似度作为布局输入。
7. 现代论文级图必须支持多面板、overview/detail、数据形态、重复压缩、时间/状态/条件和 page-aware reflow。
8. PVP v2 密封前完成版面重排和视觉 QA；Visio Worker 不在确认后重新构图。
9. 防模板化测试、盲测新代码/新草图和跨 renderer 人工视觉验收是完成门。
10. 当前 v7 只证明稳定原生执行基线，不证明论文级构图能力。
11. 陌生输入由 EvidencePack、受约束 proposal 和 Structural Harness 解释；任何模型都不能直接创建正式拓扑或几何。
12. 规则匹配基于匿名结构/沟通谓词并通过确定性约束求解组合，不选择单一论文或模型模板。

## 3. 取代与保留

本基线取代 `DB-2026-08-20-adaptive-universal-agent` 对最终视觉构图层的草案判断，但不修改该历史基线。以下内容继续保留：

- 非执行输入分析；
- EvidencePack 与可追溯来源；
- 未知模块可画、未知拓扑澄清；
- owner/device/revision/Snapshot/sealed request；
- 当前 document/page、Agent ownership、applyDiff、checkpoint、readback 和 recovery；
- `agent-program-state.json` 是唯一当前状态账本。

## 4. 当前事实边界

截至本基线创建时：

- 已有 UGS、GPG、PVP、浏览器预览和当前选中 Visio 页面执行基础；
- v7 视觉结果仍是工程流程图基线；
- FigureStoryPlan、FigureCompositionPlan、GPG v2 语义、PVP v2 多面板和现代视觉 QA 尚未实现；
- 28 个初始论文页面或架构图样本尚未形成仓库内受治理的 ReferenceFigureCorpus；
- 60–100 篇目标语料尚未完成；
- 未见代码与未见草图的论文级盲测尚未完成；
- 研究库、开发 fixture、盲测 holdout 与生产规则包的物理隔离尚未实现；
- 因此不能宣称 Agent 已能通用绘制顶刊级神经网络图。

## 5. 后继接受基线的最低证据

1. 用户审核并明确接受规范性规格；
2. 实施计划将 GPG v2、Story/Composition、PVP v2、browser QA 和 Visio acceptance 分阶段；
3. ReferenceFigureRecord 与 GeneralizedVisualRule schema 通过审查；
4. 研究规则与运行时模板之间有机械隔离测试；
5. 匿名现代结构 fixture 和防模板化测试已定义；
6. ledger、ROADMAP、Implementation Record 与本设计保持一致；
7. 新的 accepted baseline 记录最终 commit、hash、审查结论和仍未完成的真实主机门。
8. 冻结规则后，陌生代码、陌生草图和混合输入达到规格规定的盲测规模与人工视觉阈值。
