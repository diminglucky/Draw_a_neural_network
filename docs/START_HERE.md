# 开始这里

## 当前产品基线

当前产品分支是 `agent`。产品目标不是 M2.4 预览，也不是五个专用 grammar 的模板集合，而是一个以 LangGraph 编排 Drawing Run、以证据和 Structural Harness 控制结构真相的可扩展神经网络绘图 Agent：

```text
input receipt
  -> LangGraph DrawingRun workflow
  -> EvidencePack / local proposal
  -> Structural Harness
  -> formal UGS 或 clarification / rejection
  -> GPG / PVP / browser preview
  -> selected existing Visio page
  -> sealed update / save / reopen / independent readback
```

权威设计是：

- [Core Drawing V1](superpowers/specs/2026-08-21-core-drawing-v1-vertical-slice-design.md)
- [Universal Neural Drawing Agent Platform](superpowers/plans/2026-08-21-universal-neural-drawing-agent-platform.md)
- [M2.12 Receipt-Bound Structural Harness](superpowers/specs/2026-08-21-m2-12-receipt-bound-structural-harness-design.md)
- [LangGraph Runtime Adoption](superpowers/specs/2026-08-22-langgraph-core-runtime-design.md)

`docs/agent-program-state.json` 是当前路线账本，`docs/ROADMAP.md` 是生成视图。开始工作前运行：

```powershell
git status --short
git worktree list --porcelain
npm run agent:status -- --json
```

## LangGraph 边界

LangGraph 是 Drawing Run 的编排核心，负责阶段路由、暂停、恢复和节点执行顺序；它不是数据真相、公共 ID 铸造器、UGS/PVP 授权器或 Visio 控制器。

- PostgreSQL/Foundation Store 是 durable run、CAS revision、幂等和事件的权威存储；`011_drawing_workflow_checkpoints.sql` 与 `PostgresDrawingWorkflowCheckpointSaver` 为 LangGraph 提供同一身份边界下的 checkpoint 持久化适配器。
- LangGraph checkpoint 只保存 owner/device/run/revision 绑定的脱敏工作状态，不能替代 Coordinator 的状态真相。
- Analyzer、Provider、Harness、Composer 都通过注入的窄接口调用。
- Provider 只能收到 `ProviderContextPayload`，不能收到 receipt/context/run/owner/device ID、原始输入、路径、凭据或 public UGS ID。
- 只有 Harness 的 `formal` 结果可以进入 PVP；candidate、clarification、rejected、stale 和 cancelled 不得触发 PVP、Snapshot、Worker、COM 或 Visio。

当前 LangGraph 垂直切片已实现 workflow 和 Coordinator 续跑适配，但 M2.12 仍未验收；Receipt/EvidencePack、正式 Structural Harness、真实 Provider、当前页 Visio、保存重开和独立 readback 仍是独立门。

当前 P0 实现进展（不等同于验收）：

- `drawing-input/private-receipt.ts` 已提供严格 kind/MIME/大小/digest/retention 校验、owner-bound receipt batch，以及内存和 PostgreSQL 私有内容存储；receipt 公共响应不含原始内容。`012_private_input_receipts.sql` 已接入 PostgreSQL smoke migration。
- EvidencePack、owner-scoped Provider-local proposal 和 formal/candidate UGS、PVP、QA 已有内存和 PostgreSQL artifact store；`013_drawing_input_artifacts.sql` 与 `014_drawing_artifacts.sql` 已接入 PostgreSQL smoke migration，读取时重新校验内容 hash。`014` 对历史未带 owner 的 proposal 表只做隔离，不会猜测租户归属。
- `drawing-input/evidence-pack.ts` 已提供规范化证据、重复/冲突检测、稳定 hash 和不含路径/文件名/摘录的 public evidence projection。
- `drawing-input/intent.ts` 已提供静态 PyTorch、typed architecture declaration 和 receipt-bound analyzer 适配器；静态 lane 仍不执行用户 Python。
- Structural Harness 已能从已验证的线性 static-analysis EvidencePack 生成确定性的 local proposal，因此已证明的静态结构不依赖 Provider；typed declaration 的 branch、skip、merge 与封闭的 Add/Concat 事实会保留到 UGS，未证明的多输入合并、冲突语义、断开拓扑和非法 merge arity 只能进入 clarification/rejection。未知结构仍只能走 bounded Provider proposal 或 clarification/rejection。
- `drawing-input/provider-context.ts` 已提供 Coordinator-owned reference 与有字符预算的 Provider payload factory；LangGraph checkpoint saver 拒绝 receipt ID、原文、Provider payload、路径和 native control 字段。
- `/api/drawing-runs/:runId/input` 已改为接收并验证编码后的私有 receipt，不再接受客户端伪造的 `artifactHash`。
- `buildDefaultApp()` 已将同一 Foundation Pool 上的 receipt、EvidencePack、proposal、UGS/PVP/QA artifact、Drawing Run store 和 PostgreSQL LangGraph checkpoint saver 装配到 receipt-bound workflow；API 启动时会扫描并恢复非终态 Drawing Run，内存模式仍只用于开发/测试，不能作为重启证据。
- formal composer 已复用 `composeGeneralPublicationGraph`、`compilePublicationVisualPlan` 和确定性 PVP QA；它从 Harness 持久化的 UGS 取回内容，禁止用固定 hash 伪造 preview。

这些是本地契约、单元测试和 API 边界证据；真实 PostgreSQL smoke 仍需可用数据库服务才能验收，真实 Provider，或 Windows/Visio 创建、保存、重开和独立 readback 仍未验收。普通文本和草图仍不能绕过 bounded analyzer/Harness；澄清只有显式确认才会 formalize。

历史 P0 能力仍然有效：authenticated static-linear PyTorch analysis 只支持声明范围内的静态分析，does not execute user Python；[2026-08-17-universal-compiler-repair-and-migration-design.md](superpowers/specs/2026-08-17-universal-compiler-repair-and-migration-design.md) 仅作为已接受兼容基线，不是当前产品方向。

## 工作树纪律

修改前保留不属于当前任务的改动和其他工作树。不要使用 `git reset --hard`、`git clean`、广泛暂存或覆盖未关联文件。不得将五个 grammar 宣称为通用支持；它们只能作为已验证结构的 bounded strategy 和回归 fixture。mock、协议和单元测试不能替代真实 Windows/Visio 验收。
