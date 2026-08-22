# DB-2026-08-21：Receipt-Bound Harness 设计闭合基线

**Baseline ID：** `DB-2026-08-21-receipt-bound-harness-closure`
**状态：** `draft`（working-tree baseline，尚未绑定新的 commit、tag 或验收证据）
**创建时间：** `2026-08-21T17:36:00.000Z`
**基线前 HEAD：** `a93c8c7f60d6424d2daf2cd710c3dde2e51d723b`
**正式 ledger 焦点：** `M2.12 — Evidence-augmented architecture interpretation`（design gated）
**对应实现记录：** [current-roadmap.md](../implementation-records/current-roadmap.md)
**取代范围：** 仅取代先前 M2.12 迁移草案中未闭合的 Provider 输入、receipt retention、candidate PVP、canonicalization 与切换顺序表述；不修改已冻结的 `DB-2026-08-21-universal-visio-parallel-delivery`。

## 1. 冻结的设计资产

| 资产 | 仓库相对路径 | SHA-256 |
|---|---|---|
| Core Drawing V1 规格 | `docs/superpowers/specs/2026-08-21-core-drawing-v1-vertical-slice-design.md` | `fa17913641018585b502b4859e175ba8e3becce87f4c0367da69559435876d1f` |
| M2.12 闭合规格 | `docs/superpowers/specs/2026-08-21-m2-12-receipt-bound-structural-harness-design.md` | `0bfacc1e81c95732a4c06070a1b27362a58a204f09638a3c2c7080bea05fb7ec` |
| 主平台实施计划 | `docs/superpowers/plans/2026-08-21-universal-neural-drawing-agent-platform.md` | `80d256078318537d7e12a156daf7128a6b998b0570652c20bfca231143070441` |
| M2.12 专项迁移计划 | `docs/superpowers/plans/2026-08-21-m2-12-receipt-bound-structural-harness-migration.md` | `872113adb0df04d832f0d595cfdd3082302f6c198132eca4b624b56a217c4d64` |
| 账本状态源 | `docs/agent-program-state.json` | `1fa5532654e8ae5012167c27553cd3c62ecf60f3d4c0ca089321767a6bb6504f` |

该基线冻结的是设计边界和实施顺序，不是实现完成证明。它不能作为 Provider 调用、PVP、Worker、Visio、持久化、保存重开、readback、真实主机或顶刊人工视觉验收的证据。

## 2. 关闭后的权威链

```text
DrawingRun + Coordinator fence
  -> PrivateInputReceipt + ArtifactStore content handle
  -> EvidencePack
  -> ProviderContextReference (internal only)
  -> ProviderContextPayload (redacted local facts only)
  -> InterpreterLocalProposal
  -> Structural Harness
  -> formal UGS | revision-bound clarification | rejected
  -> formal-only PVP composition
```

1. `ProviderContextReference` 不跨 Provider 或公开边界；`ProviderContextPayload` 是唯一发送给 Provider 的对象。
2. Provider payload 不包含 receipt/context/run/owner/device ID、原始字节、内容句柄、路径、凭据或公开 UGS ID。
3. Provider 只能使用 local node/port/edge reference 与 local fact token；Harness 是唯一可铸造 public evidence 和 UGS ID 的组件。
4. Receipt 的 `owner_revision` retention 由 Coordinator-owned ArtifactStore 实施；M2.12 不新建持久化或会话系统。
5. `formal` 是唯一允许进入 PVP 的 assessment；candidate、clarification、rejected、stale 与 cancelled 全部零 PVP、零 native authority。

## 3. Canonicalization 不变量

1. Evidence 的唯一键是 `(sourceKind, sourceHash, locatorKind, locatorOrdinal, excerptDigest)`；相同键去重，同一 source/locator 但 digest 不同为冲突，fail closed。
2. Evidence 在任何 public ID 前排序；`evidence:e:*` 只由该排序产生。
3. Node/port/edge canonical 顺序来自语义、证据、端口方向、关系与邻域的固定点 fingerprint；Provider localRef 和请求数组位置禁止成为 tie-break。
4. 完整 local-ref 改名和数组重排必须得到相同 UGS hash。若语义对称在没有额外可证明事实时无法区分，则返回 clarification，而不是任意分配不同 public identity。
5. `PublicDisplayText` 由 Harness 投影；Provider 原始标签、属性和错误文本不直接进入任何公开 artifact。

## 4. 实施门与非目标

M2.12 的第一项代码工作之前，必须接受主平台 Phase 0–2：迁移库存、DrawingRun reducer/public projection、Coordinator/store/idempotency/cancellation。Receipt/EvidencePack 位于 Phase 3，Harness 位于 Phase 4，session/route cutover 位于 Phase 5。M2.12 `active` 表示当前设计/盘点焦点，并不授予跳过这些门直接实现解释器的权限。

本基线不引入 LangChain、LangGraph、LangSmith、OpenAI Agents SDK、视觉语法、草图理解、Snapshot/export、Worker/COM/Visio、现有页面绑定或真实主机测试。它也不改变已接受 M2.8、M2.10、M2.11 的公共合同。

## 5. 后续变更规则

若更改 Provider payload、canonical evidence key、graph fingerprint、formal-only PVP 条件、clarification token 字段或阶段顺序，必须创建新的 design baseline，并同步更新 M2.12 规格、专项计划、主平台计划、实现记录、operation history 与 ledger。没有对应的 focused/full/independent-review/commit 证据，不得将本设计基线描述为已实现或已验收。
