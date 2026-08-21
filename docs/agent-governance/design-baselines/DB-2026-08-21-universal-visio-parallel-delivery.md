# DB-2026-08-21：通用 Visio 并行交付治理基线

**Baseline ID：** `DB-2026-08-21-universal-visio-parallel-delivery`
**状态：** `draft`（working-tree baseline，尚未绑定新的 commit 或 tag）
**创建时间：** `2026-08-21T01:00:32.078Z`
**基线前 HEAD：** `2eaa2c4197434731e2a9a0301395e42647cd9d90`
**正式路线图焦点：** `M3.1 — Generic PVP-to-Visio primitive mapping slice`
**对应实现记录：** [current-roadmap.md](../implementation-records/current-roadmap.md)
**取代基线：** `DB-2026-08-20-universal-roadmap-migration`

## 1. 冻结的设计和状态来源

| 资产 | 仓库相对路径 | SHA-256 |
|---|---|---|
| 自适应通用绘图规格 | `docs/superpowers/specs/2026-08-20-adaptive-universal-neural-figure-agent-design.md` | `7c48864031e23b578548517661fd014c013abdee863064c1be834e4bfe713d77` |
| 当前状态账本 | `docs/agent-program-state.json` | `95cb6465892013ee88e39d9422d333a05c31363f443ec1d1226ab50e47443baa` |
| 当前实现记录 | `docs/agent-governance/implementation-records/current-roadmap.md` | `eb9b3f84ecb7b357066cc762f9c50a689cacca14609bd2ece2a4192a1a68325f` |
| 治理修复计划 | `docs/superpowers/plans/2026-08-21-universal-visio-parallel-delivery.md` | `0e6602fd4be04fc3a53ed8e5f4046f491b84098fb2418f702a6f6244b5a5e404` |

本基线冻结的是路线图的排序与证据边界，不是新功能完成证明。它不能作为 release、真实 Visio、editable VSDX、保存重开、native readback、取消恢复或顶刊人工视觉验收的证据。

## 2. 正式路线图映射

| 能力轨道 | 账本节点 | 本基线状态 | 边界 |
|---|---|---|---|
| 已有通用结构基础 | `M2.6` | `accepted` | UGS → GPG → PVP；未知模块可画，未知拓扑 fail closed |
| 不可变 PVP Snapshot | `M2.5` | `awaiting_acceptance` | `f2f2114` 证明 trusted-QA PVP、canonical lineage 与零写入拒绝；公共 sealed export 仍不可用 |
| Prompt 输入 | `M2.8` | `planned`，可执行 | Prompt 仅形成 evidence-backed UGS/candidate，不控制 Visio |
| 静态代码输入 | `M2.10` | `planned`，可执行 | 源码永不执行；动态或无法证明的 topology fail closed |
| 内部 native 映射 | `M3.1` | `active` | 只用服务端 canonical 零模板 PVP fixture 产生 allowlisted primitive intent，不创建公开 export |
| sealed export、Worker、readback、host | `M3.2`–`M3.5` | `planned` | M3.2 需 M2.5 accepted；M3.5 才是同页 applyDiff、保存重开和真实 Windows/Visio 门 |
| 草图理解 | `M4.5` | `planned` | 仅 candidate/clarification，不能生成 formal PVP、Snapshot 或 export |
| PatternCandidate/PatternLibrary | `M2.7` | `deferred` | 仅在 M2.9、M3.5、M4.5 接受后开始，绝非基础直绘前提 |

## 3. 冻结的不变量

1. `PublicationVisualPlan` 是浏览器预览、Snapshot、后续 Worker 和 readback 的唯一 renderer-neutral 主链；不得重新引入 Figure Plan、VGG DTO 或浏览器 geometry 作为公共出口输入。
2. M3.1 与 M2.8/M2.10 可并行，但它们之间不共享可越过 formal/candidate、Snapshot 或 Worker 边界的捷径。
3. M3.1 只能消费服务端创建的 canonical PVP fixture，绝不能消费原始 prompt、代码、草图、模型输出、自由坐标、任意路径或 COM 指令。
4. sealed export 必须在 M2.5 accepted 后才开始；真实 Visio 生命周期只能在 M3.5 通过后宣布。
5. PatternLibrary 不按模型名选择，也不能通过未审查输入自我学习；在 M3.5 前不得开始实现。
6. 任何新输入适配器都必须保留未知模块、隔离 topology uncertainty，并让 candidate/clarification 零 Snapshot、零 export、零 Worker 写入。

## 4. 已知风险和下一步

- 当前公共 bridge 仍是 VGG fixture，不能作为 M3.1 或 M3.5 已完成的证据；
- M2.5 的 committed contract evidence 尚待 owner acceptance，因此 M3.2 不能启动；
- 现有浏览器 SVG 与 visual-rubric 只提供诊断性布局信号，尚无 Visio PNG、保存重开 PNG 或人工跨 renderer 量表；
- 下一项实现应是 M3.1 的最小 native primitive mapping contract test 和内部 mapping，或独立的 M2.8/M2.10 adapter test-first slice，不得开始 PatternLibrary、计费或公开 Visio export。

本文件一经创建不得修改。后续若改变映射、哈希、验收边界或 Git 状态，必须新建并关联新的 baseline。
