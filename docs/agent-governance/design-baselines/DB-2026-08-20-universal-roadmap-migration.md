# DB-2026-08-20：通用绘图路线图迁移基线

**Baseline ID：** `DB-2026-08-20-universal-roadmap-migration`
**状态：** `draft`（working-tree baseline，尚未绑定新提交或 tag）
**创建时间：** `2026-08-20T01:52:39.168Z`
**基线前 HEAD：** `7f188d175e6e9b2e4884928dce44193b771ee0f8`
**当前正式路线图焦点：** `M2.6 — UniversalGraphSpec and General Publication Graph`
**对应实现记录：** [current-roadmap.md](../implementation-records/current-roadmap.md)
**取代基线：** `DB-2026-08-20-adaptive-universal-agent`

## 1. 冻结的设计和状态来源

| 资产 | 仓库相对路径 | SHA-256 |
|---|---|---|
| 自适应通用绘图规格 | `docs/superpowers/specs/2026-08-20-adaptive-universal-neural-figure-agent-design.md` | `dfa104948e84940bd432eab9664e512ed8a0c8a6f63f94afcf9a20cbd23ce1c5` |
| 治理与可追溯性设计 | `docs/superpowers/specs/2026-08-20-agent-governance-traceability-design.md` | `e5760bd6b160dc479ddcaa02a183aa1c023d0c3e42992dfd220673dca2382436` |
| 迁移后的当前状态账本 | `docs/agent-program-state.json` | `f8043db5835029c0afa6917abb7480d61f9a65dec5e5ace86d7c8d5717ad3303` |

此基线是 draft：规格、ledger 迁移、R0 修复及实现记录仍在 working tree，尚未生成新的 commit 或 tag。它不能作为 release、真实 Visio 验收或任何节点 accepted 的证据。

## 2. 正式路线图映射

| 能力轨道 | 账本节点 | 本基线状态 | 边界 |
|---|---|---|---|
| R0：canonical VGG16 夹具恢复 | precondition | `passed` | 仅恢复 legacy bridge、snapshot、export route 的测试基线；不代表通用能力 |
| R1：UGS 与 General Publication Graph | `M2.6` | `planned`，当前焦点 | 任意拓扑明确网络的通用合同、端口、证据、不确定性和确定性专业布局 |
| R2：通用 Snapshot 与导出资格 | `M2.5` | `planned` | 依赖 M2.6；绑定 UGS、Presentation Graph 和 Figure Plan hash |
| R3：Adaptive Pattern Library | `M2.7` | `planned` | owner-scoped candidate、受限 visual recipe、审查和版本化提升 |
| R4：Prompt 与静态代码到 UGS | `M2.8` | `planned` | 不执行代码；未知模块保留，未知拓扑隔离 |
| R4：Sketch 到 UGS | `M4.5` | `planned` | 受置信度约束的观察和 candidate topology，不静默猜测 |
| R5：通用 Visio 与真实主机验收 | `M3.1`–`M3.5` | `planned` | generic snapshot export、sealed Worker、native readback、同页更新和真实主机证据 |

## 3. 冻结的不变量

1. M2.6 必须在 M2.5 前完成；不可变 Snapshot 不能绑定 legacy VGG DTO。
2. Unknown operator/module 名称可绘为 `CustomOperator` 或 `CustomModule`；只有 topology uncertainty 才进入 candidate，且不具备正式导出资格。
3. General Publication Graph 是任意有效 UGS 的专业默认输出，不是低质量回退。
4. Pattern/Profile 只能提升表现，不能成为绘图资格或模型名称白名单。
5. 用户代码永不执行；提示、代码、草图、浏览器和模型输出不能直接控制 Worker、COM、路径或自由坐标。
6. R5 之前不能声称通用 Visio、同页 applyDiff、保存重开或真实主机验收已经完成。
7. 已接受 M2.1–M2.4 的组件、DAG、Visual QA 和 owner-scoped preview 是可复用基础，不等于 R1–R5 已接受。

## 4. 已知风险和下一步

- 当前公开 legacy bridge 仍由 `assertCanonicalVgg16` 限制，必须在 R5 被通用路径替代，而不是继续扩展 VGG 特例；
- M2.6 尚未包含任何 UGS 源码、零模板 fixture 或通用渲染实现；
- Sketch-to-UGS 与真实 Visio 验收仍处于后续 planned 节点；
- 下一项代码工作必须是单独的 M2.6/R1 测试先行实现计划，不能并行启动 Snapshot、PatternLibrary 或输入适配器。

本文件一经创建不得修改。后续若改变映射、哈希、验收边界或 Git 状态，必须新建并关联新的 baseline。
