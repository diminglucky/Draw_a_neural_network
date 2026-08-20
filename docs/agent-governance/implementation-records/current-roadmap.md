# 当前实现记录：自适应通用神经网络绘图 Agent

**Record ID：** `IR-2026-08-20-current-roadmap`
**对应基线：** `DB-2026-08-20-adaptive-universal-agent`
**最后核对：** `2026-08-20T04:15:23.551Z`
**正式 ledger 焦点：** `M2.6 — UniversalGraphSpec and General Publication Graph`
**总体状态：** `awaiting_acceptance` — M2.6 的 UGS、v3 兼容投影、General Publication Graph 和通用 Figure Plan 已完成独立审查；仍未达到 M2.6 accepted，且不得将此状态误报为通用 Visio 交付。

## 1. 当前交付判断

| 层次 | 当前判断 | 证据边界 |
|---|---|---|
| 设计 | `approved_for_staged_implementation` | 用户已确认以未知网络直绘为目标；规格和治理资产仍是未提交 working-tree 文档 |
| 当前路线图 | `awaiting_acceptance` | M2.6 独立审查已清零，但仍须由 owner 接受；R0–R5 已有明确 ledger 映射，尚未改变任何节点 accepted 状态 |
| API | `passed` | `npm run api:check` 通过；完整 API 套件为 103 个测试文件、661 个测试通过 |
| Worker 单元测试 | `passed` | 234 通过、2 跳过、0 失败；跳过项不是真实 Visio 验收 |
| 通用未知网络直绘 | `awaiting_acceptance` | UGS 严格合同、未知模块直绘、重复单元、candidate topology、非 feedback 闭环拒绝、feedback 回退为 candidate、结构证据强制、code-unit 确定性排序、ArchitectureIRv3 兼容投影、碰撞安全的多来源 evidence 保真、General Publication Graph 与通用 Figure Plan 均有单元、极限容量和全套 API 证据；正式图只由 rank/lane 产生受限文档单位布局、语义连接器和 source/evidence mapping，且 compiler/graph/plan 验证入口均会重算 canonical provenance；尚未接入公开 preview/Visio 路径 |
| 通用 Visio | `not_started` | 当前 bridge 仍是 canonical VGG16 夹具，不能作为通用导出能力 |
| 真实 Visio / 人工视觉 | `not_started` | 尚无未知网络的真实主机保存、重开、编辑和独立 readback 证据 |

## 2. 能力轨道记录

| Work item | 目标 | 状态 | 当前证据/阻塞 | 下一步 |
|---|---|---|---|---|
| R0 | 恢复 canonical VGG16 夹具 | `passed` | canonical `conv-*` / `classifier` 名称别名恢复固定 VGG 槽位；bridge、execution snapshot、export route 重点测试 8 项通过；完整 API 套件通过 | 完成 R1–R5 到正式 ledger 的受审查映射；不要将 R0 误报为 universal renderer |
| R1 | UGS、General Publication Graph 与通用 Figure Plan | `awaiting_acceptance` → `M2.6` | 已验证 UGS→General Publication Graph→General Publication Figure Plan 的 canonical provenance 闭环：公开边界重解析 UGS，拒绝 candidate/blocking/feedback、伪造 graph/mapping/layout、非规范 plan 顺序及受限属性；Figure Plan 使用跨主机 code-unit 排序、支持 128 字符源 ID、256 nodes / 1,024 ports / 2,048 edges、768 primitives / 2,048 connectors 和受限 10,000 文档单位几何；聚焦 4 文件 49 项、全 API 103 文件 661 项、TypeScript、foundation、严格 roadmap 以及独立审查均通过 | 等待 owner 接受 M2.6；在正式 accepted 前，不开始 M2.5 的通用不可变 snapshot binding |
| R2 | 通用 Snapshot/导出资格 | `planned` → `M2.5` | M2.5 依赖 M2.6，验收明确绑定 UGS/Presentation/Figure Plan hash | 在 M2.6 deterministic generic plan 后实现 |
| R3 | Adaptive Pattern Library | `planned` → `M2.7` | 只有设计合同；依赖 M2.6 | 实现 owner-scoped candidate、受限 recipe、审查和版本化提升 |
| R4 | Prompt/Code/Sketch 直绘 | `planned` → `M2.8`、`M4.5` | prompt/static code 归 M2.8；Sketch-to-UGS 归 M4.5 | M2.6 后先做 prompt/static code；Sketch 保持置信度约束 |
| R5 | 通用 Visio + 真实主机验收 | `planned` → `M3.1`–`M3.5` | Worker 基础存在，公共 bridge 仍为 VGG fixture | generic snapshot export、sealed Worker、native readback、同页更新和真实主机矩阵 |

## 3. 验证矩阵

| 门 | 最新结果 | 是否足够 |
|---|---|---:|
| `npm run agent:status -- --strict` | 通过；ledger/ROADMAP 一致 | 否，仅状态治理 |
| `npm run api:check` | 通过 | 否，仅基础边界 |
| `npm run api:test -- apps/api/tests/agent-visio-bridge.test.ts apps/api/tests/agent-visio-execution-snapshot.test.ts apps/api/tests/agent-visio-export-routes.test.ts` | 3 个测试文件、8 个测试通过 | 是，R0 重点 API 路径 |
| `npm run api:test` | 99 个测试文件、612 个测试通过 | 是，R0 API 回归 |
| `npm run api:test -- apps/api/tests/universal-graph-spec.test.ts apps/api/tests/universal-graph-spec-adapter.test.ts apps/api/tests/general-publication-graph.test.ts apps/api/tests/general-publication-figure-plan.test.ts` | 4 个测试文件、49 个测试通过 | 是，R1 合同、通用语义图、极限容量和 Figure Plan provenance |
| `npm run api:test` | 103 个测试文件、661 个测试通过 | 是，R1 API 回归 |
| `dotnet test workers/visio-worker/VisioWorker.sln --no-restore` | 234 通过、2 跳过、0 失败 | 否，跳过的真实 Visio 测试未执行 |
| Visual QA | 有现有基础测试 | 否，未覆盖未知网络直绘的零模板案例 |
| Native readback | 有局部 Worker 能力 | 否，未完成通用 plan/真实主机矩阵 |
| 人工视觉审查 | 未记录当前新设计案例 | 否 |

## 4. 范围边界

本记录不把以下事项误报为已完成：

- 不把 VGG16 专用 bridge 报为 universal renderer；
- 不把图语法/fixture 单元测试报为未知网络可直接绘制；
- 不把 C# unit tests 报为真实 Windows/Visio 交互验收；
- 不把设计文档、commit 或 tag 报为完整产品交付；
- 不把未来 R1–R5 的设计状态报为正式 ledger accepted 状态。

## 5. 允许的下一步

R0 已恢复 legacy VGG16 夹具，M2.6 的 UGS/General Publication Graph/General Publication Figure Plan 合同已完成独立审查：公开入口重验证 UGS，General Graph 与 Figure Plan 完全重算 canonical projection，未知模块保持可画，candidate/blocking/feedback 保持 fail-closed，属性拒绝 geometry/rendering/execution 与 renderer/Worker/Visio/COM/raw-source namespaces，并以 code-unit 排序保证跨主机 hash 一致。M2.6 现为 `awaiting_acceptance`，仍未 accepted，也没有通用公开 preview、immutable snapshot 或通用 Visio 输出。下一步是 owner 接受 M2.6；随后才可为 M2.5 写入并实施 generic immutable snapshot binding。PatternLibrary、输入适配器和 Worker 仍按各自节点后置。任何后续实现必须更新本记录、对应 baseline 和 Operation History，并根据证据决定是否更新 ledger。
