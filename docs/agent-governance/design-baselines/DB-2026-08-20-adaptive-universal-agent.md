# DB-2026-08-20：未知网络直绘 Agent 设计基线

**Baseline ID：** `DB-2026-08-20-adaptive-universal-agent`
**状态：** `draft`（working-tree baseline，尚未绑定新提交或 tag）
**创建时间：** `2026-08-20T01:27:54.958Z`
**基线前 HEAD：** `7f188d175e6e9b2e4884928dce44193b771ee0f8`
**当前正式路线图焦点：** `M2.5 — Immutable PlanSnapshot binding`
**对应实现记录：** [current-roadmap.md](../implementation-records/current-roadmap.md)

## 1. 冻结的设计来源

| 资产 | 仓库相对路径 | SHA-256 |
|---|---|---|
| 自适应通用绘图规格 | `docs/superpowers/specs/2026-08-20-adaptive-universal-neural-figure-agent-design.md` | `dfa104948e84940bd432eab9664e512ed8a0c8a6f63f94afcf9a20cbd23ce1c5` |
| 治理与可追溯性设计 | `docs/superpowers/specs/2026-08-20-agent-governance-traceability-design.md` | `e5760bd6b160dc479ddcaa02a183aa1c023d0c3e42992dfd220673dca2382436` |
| 当前状态账本 | `docs/agent-program-state.json` | `00b64120277a4966af74049505fe9d609826eb09cb2833393b17ce919e46b3ea` |

本基线是 draft，因为以上规格与治理资产尚未提交。创建接受基线时必须生成新的 `DB-*` 文件，记录提交 SHA、可选 tag、更新后的 hash 和接受证据；不得编辑本文件把 draft 改为 accepted。

## 2. 冻结的不变量

1. 任意拓扑明确的未知网络都先进入 `UniversalGraphSpec → General Publication Graph`，不得因未命中模型家族而拒绝绘制。
2. 未知模块名、未知 shape 或陌生局部算子可用 `CustomOperator`/`CustomModule` 表达；只有未知拓扑才成为 candidate。
3. Profile/Pattern 只增强表现，不决定基础图是否可生成。
4. PatternCandidate 默认 owner-scoped；共享 PatternLibrary 的提升、替代、废弃均版本化、可审查、可回滚。
5. 输入代码绝不执行；提示、代码、草图不得直接控制 Worker、COM、路径或坐标。
6. 正式导出只能从 QA 通过、不可变 Snapshot 绑定、owner/device 授权的 Figure Plan 产生。
7. Visio 更新必须维持同一 document/page identity，支持 idempotent applyDiff、checkpoint、readback 和 recovery。
8. `agent-program-state.json` 是唯一当前状态；baseline、record 和 history 不能自行宣称 milestone accepted。

## 3. 路线图映射状态

| 新能力轨道 | 当前映射状态 | 说明 |
|---|---|---|
| R0：VGG 夹具回归恢复 | `precondition` | 不推进通用能力；当前 API 失败是阻塞 |
| R1：UGS 与 General Publication Graph | `not_migrated` | 需要经过审查的 ledger 节点/验收迁移后才可 active |
| R2：通用 Snapshot | `maps_to_M2.5_pending_detail` | M2.5 必须绑定通用 UGS/Presentation/Figure Plan，而非 legacy VGG DTO |
| R3：Adaptive Pattern Library | `not_migrated` | 需要独立节点、fixture 和审查门 |
| R4：提示/代码/草图直绘 | `not_migrated` | 需要分别定义适配器验收 |
| R5：通用 Visio 真实主机验收 | `maps_to_M3_pending_detail` | 需要 M3.1–M3.5 映射和真实主机证据 |

## 4. 当前已知风险

- 当前完整 API 测试有 6 个失败，根因是 `conv-1` 无法得到 CNN publication group 坐标；
- 当前公共 Agent-to-Visio bridge 仍有 canonical VGG16 限制；
- 当前静态代码分析仍主要支持可证明的线性 forward 链；
- 当前没有真实 Windows/Visio 的通用未知网络验收；
- 本基线尚未提交，不能当作 release/tag 基线。

## 5. 接受所需证据

接受替代 baseline 至少需要：设计规格和治理规格已提交、ledger/ROADMAP 一致、当前实现记录更新、关联操作历史事件、范围内自动化检查结果，以及任何被声明为完成的真实 Visio/人工视觉证据。
