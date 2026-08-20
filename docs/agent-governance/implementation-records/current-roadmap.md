# 当前实现记录：自适应通用神经网络绘图 Agent

**Record ID：** `IR-2026-08-20-current-roadmap`
**对应基线：** `DB-2026-08-20-adaptive-universal-agent`
**最后核对：** `2026-08-20T02:59:15.3836329Z`
**正式 ledger 焦点：** `M2.6 — UniversalGraphSpec and General Publication Graph`
**总体状态：** `in_progress` — R0 已恢复 legacy canonical VGG16 兼容链；R1 的 UGS、v3 兼容投影和 General Publication Graph 首段源码已实现并通过自动化验证，尚未达到 M2.6 accepted。

## 1. 当前交付判断

| 层次 | 当前判断 | 证据边界 |
|---|---|---|
| 设计 | `approved_for_staged_implementation` | 用户已确认以未知网络直绘为目标；规格和治理资产仍是未提交 working-tree 文档 |
| 当前路线图 | `planned` | M2.6 是唯一正式可执行节点；R0–R5 已有明确 ledger 映射，尚未改变任何节点 accepted 状态 |
| API | `passed` | `npm run api:check` 通过；完整 API 套件为 102 个测试文件、628 个测试通过 |
| Worker 单元测试 | `passed` | 234 通过、2 跳过、0 失败；跳过项不是真实 Visio 验收 |
| 通用未知网络直绘 | `in_progress` | UGS 严格合同、未知模块直绘、重复单元、candidate topology、非 feedback 闭环拒绝、feedback 回退为 candidate、结构证据强制、确定性 evidence 排序、ArchitectureIRv3 兼容投影、碰撞安全的多来源 evidence 保真与 General Publication Graph 已有单元和全套 API 证据；尚未接入公开 preview/Visio 路径 |
| 通用 Visio | `not_started` | 当前 bridge 仍是 canonical VGG16 夹具，不能作为通用导出能力 |
| 真实 Visio / 人工视觉 | `not_started` | 尚无未知网络的真实主机保存、重开、编辑和独立 readback 证据 |

## 2. 能力轨道记录

| Work item | 目标 | 状态 | 当前证据/阻塞 | 下一步 |
|---|---|---|---|---|
| R0 | 恢复 canonical VGG16 夹具 | `passed` | canonical `conv-*` / `classifier` 名称别名恢复固定 VGG 槽位；bridge、execution snapshot、export route 重点测试 8 项通过；完整 API 套件通过 | 完成 R1–R5 到正式 ledger 的受审查映射；不要将 R0 误报为 universal renderer |
| R1 | UGS 与 General Publication Graph | `in_progress` → `M2.6` | `UniversalGraphSpec`、v3-to-UGS adapter、General Publication Graph 与零模板双流融合、重复自定义模块、candidate edge/evidence region、非 feedback cycle、feedback candidate 回退、结构 evidence 强制、确定性 evidence 排序、碰撞安全的多来源 evidence fixture 已实现；聚焦 16 项与完整 API 628 项通过 | 独立审查并决定通用 preview 的受控接入；不得提前 accepted |
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
| `npm run api:test -- apps/api/tests/universal-graph-spec.test.ts apps/api/tests/universal-graph-spec-adapter.test.ts apps/api/tests/general-publication-graph.test.ts` | 3 个测试文件、16 个测试通过 | 是，R1 合同和通用语义图 |
| `npm run api:test` | 102 个测试文件、628 个测试通过 | 是，R1 API 回归 |
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

R0 已恢复 legacy VGG16 夹具，M2.6 的 UGS/General Publication Graph 合同已补齐重复单元、candidate evidence region、非 feedback 闭环拒绝、feedback candidate 回退、结构 evidence 强制、确定性 evidence 排序和碰撞安全的多来源 evidence 保真，但未推进任何通用节点 accepted，也没有通用 Visio 输出。下一步做独立审查并决定通用 preview 的受控接入；Snapshot、PatternLibrary、输入适配器和 Worker 仍按各自节点后置。任何后续实现必须更新本记录、对应 baseline 和 Operation History，并根据证据决定是否更新 ledger。
