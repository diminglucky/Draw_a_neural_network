# 当前实现记录：自适应通用神经网络绘图 Agent

**Record ID：** `IR-2026-08-20-current-roadmap`
**对应基线：** `DB-2026-08-21-universal-visio-parallel-delivery`
**最后核对：** `2026-08-21T06:49:18.700Z`
**正式 ledger 焦点：** `M2.11 — Evidence-constrained drawing session`
**总体状态：** `awaiting_acceptance` — owner 明确将优先级从 Visio/export 基础设施切回通用 Agent 绘图能力。M2.11 的 renderer-neutral 证据、UGS、澄清、GPG/PVP 和局部修订会话闭环已完成聚焦/全套回归及独立代码审查，但尚未窄范围 Git 交付或正式 ledger acceptance；它仍不包含公开导出、真实 Windows/Visio、保存重开或人工视觉验收。

**修订中的产品基线：** `docs/superpowers/specs/2026-08-21-core-drawing-v1-vertical-slice-design.md` 将陌生网络理解、publication visual grammar、草图候选解析和当前 Visio 页增量更新收敛为一个可验证的 Core Drawing V1 垂直闭环。它保留 M2.11 的 UGS/GPG/PVP、静态不执行、证据谱系及 owner/device/revision 绑定；这是一份待 owner 审阅的设计提案，不增加已实现能力，不变更任何 ledger 节点状态，也不构成 Provider、草图、视觉语法、当前文档 Visio、真实主机或人工视觉验收。

**本轮审查修订：** 该基线现明确要求 Worker 发现当前已打开的文档/页面、用户显式选择目标、绑定 Agent-owned region、每次写入前后的独立 readback 与冲突拒绝。既有 `OpenOrCreate` 生命周期不能充当当前页附着机制；日常更新不得关闭或替换用户文档。架构描述、Provider proposal、草图 intake/observation、七类语义 visual corpus 和真实主机验收也已有独立契约与顺序。本段仍是设计记录，不是实现或验收声明。

**CD0 实施记录：** 已在 ledger 中登记 `M2.12 — Evidence-augmented architecture interpretation` 与 `M2.13 — Publication visual grammar and acceptance corpus` 为 `planned` 节点，且分别依赖 M2.8/M2.10/M2.11 与 M2.12。当前焦点仍为 M2.11；该登记不接受、激活或扩展任何已有能力，也不启动 Provider、Visio、Worker 或真实主机行为。

## 1. 当前交付判断

| 层次 | 当前判断 | 证据边界 |
|---|---|---|
| 设计 | `approved_for_staged_implementation` | 用户已确认以未知网络直绘为目标；规格和治理资产仍是未提交 working-tree 文档 |
| 当前路线图 | `awaiting_acceptance` | M2.11 已从 active 移至 awaiting_acceptance；M3.2 因产品优先级保持 deferred；M2.5 与 M3.1 已接受；Prompt-to-UGS 与 Static-code-to-UGS 已提交、等待独立 acceptance；PatternLibrary 已后置 |
| API | `passed` | `npx tsc --noEmit`、`npm run api:check` 通过；完整 API 套件为 125 个测试文件、813 个测试通过 |
| Worker 单元测试 | `passed` | 234 通过、2 跳过、0 失败；跳过项不是真实 Visio 验收 |
| 通用未知网络直绘 | `awaiting_acceptance` | UGS 严格合同、未知模块直绘、重复单元、candidate topology、非 feedback 闭环拒绝、feedback 回退为 candidate、结构证据强制、code-unit 确定性排序、ArchitectureIRv3 兼容投影、碰撞安全的多来源 evidence 保真、General Publication Graph 与 PVP 均有单元、极限容量和全套 API 证据；受限的认证 v4 preview 已支持 typed prompt/static PyTorch → UGS → GPG → PVP，但尚无真实 Visio 路径 |
| 通用 Visio | `not_started` | 当前 bridge 仍是 canonical VGG16 夹具，不能作为通用导出能力 |
| 真实 Visio / 人工视觉 | `not_started` | 尚无未知网络的真实主机保存、重开、编辑和独立 readback 证据 |

## 2. 能力轨道记录

| Work item | 目标 | 状态 | 当前证据/阻塞 | 下一步 |
|---|---|---|---|---|
| R0 | 恢复 canonical VGG16 夹具 | `passed` | canonical `conv-*` / `classifier` 名称别名恢复固定 VGG 槽位；bridge、execution snapshot、export route 重点测试 8 项通过；完整 API 套件通过 | 完成 R1–R5 到正式 ledger 的受审查映射；不要将 R0 误报为 universal renderer |
| R1 | UGS、General Publication Graph 与通用 Figure Plan | `accepted` → `M2.6` | 已验证 UGS→General Publication Graph→General Publication Figure Plan 的 canonical provenance 闭环：公开边界重解析 UGS，拒绝 candidate/blocking/feedback、伪造 graph/mapping/layout、非规范 plan 顺序及受限属性；Figure Plan 使用跨主机 code-unit 排序、支持 128 字符源 ID、256 nodes / 1,024 ports / 2,048 edges、768 primitives / 2,048 connectors 和受限 10,000 文档单位几何；聚焦 4 文件 49 项、全 API 103 文件 661 项、TypeScript、foundation、严格 roadmap 以及独立审查均通过 | 保持 accepted 合同稳定，作为 M2.5 的唯一通用结构输入 |
| R2 | PVP-backed Snapshot/导出资格 | `accepted` → `M2.5` | `f2f2114` 已将 Snapshot 重基为 trusted-QA PVP，重算 UGS/GPG/PVP lineage 并在不合格输入时零写入；owner 已授权接受该合同 | 保持 Snapshot 为唯一可信 PVP 来源；M3.2 仍需 M3.1 acceptance |
| R3 | Adaptive Pattern Library | `deferred` → `M2.7` | Profile 不是 PatternLibrary；共享模式库必须等待 M2.9 预览、M3.5 真实主机和 M4.5 受限草图证据 | 此前不实现 candidate 学习、提升或共享版本化 |
| R4A | Prompt-to-UGS | `awaiting_acceptance` → `M2.8` | `75dadb8` 已实现并覆盖 evidence-backed Prompt adapter，未知模块保留，未知 topology 进入 candidate | 独立验收后才能成为 M2.9 前置条件 |
| R4B | Static-code-to-UGS | `awaiting_acceptance` → `M2.10` | `75dadb8` 已实现并覆盖非执行静态 adapter；动态或无法证明的路径 fail closed | 独立验收后才能成为 M2.9 前置条件 |
| R4D | Evidence-constrained drawing session | `awaiting_acceptance` → `M2.11` | 首个纯服务闭环把提示/静态代码的已证明事实统一成 owner/device-bound UGS session；阻塞 topology 只产生一个澄清且不返回 PVP，确认后重算 GPG/PVP 并投影语义 local delta。静态来源摘要、全部阻塞证据和逐条澄清已补齐回归；独立复审无 P0/P1 | 等待窄范围 Git 交付和正式 ledger acceptance；它不是 persistence、provider、Snapshot、export、renderer 或 Visio 验收 |
| R4C | Sketch-to-UGS | `planned` → `M4.5` | 在 M2.9 后才开始，且只产生 candidate/clarification | 不能静默猜拓扑，不能直接写 formal PVP、Snapshot 或 export job |
| R5 | 通用 Visio + 真实主机验收 | `deferred` → `M3.1`–`M3.5` | M3.1 已接受且只从服务端存储的 GenericPlanSnapshot 定位并重验 PVP。PVP 的 owner/device/revision 与 UGS/GPG/source-hash 谱系必须与 Snapshot 一致，之后才映射 allowlisted native intent。candidate、pending、手工伪造 QA、能力不完整、未知图元及非 allowlisted connector 均被拒绝。公共 bridge 仍为 VGG fixture，尚无 COM/真实主机证据 | M3.2 sealed authorization 保持 deferred，等待 M2.11 核心会话获得独立验收后再恢复；之后才是 Worker → readback/recovery → real-host matrix |

## 3. 验证矩阵

| 门 | 最新结果 | 是否足够 |
|---|---|---:|
| `npm run agent:status -- --strict` | 通过；ledger/ROADMAP 一致 | 否，仅状态治理 |
| `npm run api:check` | 通过 | 否，仅基础边界 |
| `npm run api:test -- apps/api/tests/agent-visio-bridge.test.ts apps/api/tests/agent-visio-execution-snapshot.test.ts apps/api/tests/agent-visio-export-routes.test.ts` | 3 个测试文件、8 个测试通过 | 是，R0 重点 API 路径 |
| `npm run api:test` | 99 个测试文件、612 个测试通过 | 是，R0 API 回归 |
| `npm run api:test -- apps/api/tests/universal-graph-spec.test.ts apps/api/tests/universal-graph-spec-adapter.test.ts apps/api/tests/general-publication-graph.test.ts apps/api/tests/general-publication-figure-plan.test.ts` | 4 个测试文件、49 个测试通过 | 是，R1 合同、通用语义图、极限容量和 Figure Plan provenance |
| `npx vitest run apps/api/tests/publication-visual-plan-native-intent.test.ts` | 15 个测试通过 | 是，M3.1 的 Snapshot-only native-intent allowlist、精确保真、递归不可变、外层定位符和内部身份与谱系绑定、以及拒绝边界。否，不是 COM 或真实 Visio 验收 |
| `npm run api:test` | 103 个测试文件、661 个测试通过 | 是，R1 API 回归 |
| `npx vitest run apps/api/tests/evidence-constrained-drawing-session.test.ts apps/api/tests/static-pytorch-universal-graph-spec.test.ts apps/api/tests/input-adapter-publication-chain.test.ts apps/api/tests/universal-input-compilation-service.test.ts apps/api/tests/figure-analysis-routes.test.ts apps/api/tests/agent-roadmap-cli.test.ts` | 6 个测试文件、39 个测试通过 | 是，M2.11 会话、静态来源摘要、候选兼容性与路线图聚焦回归 |
| `npm run api:test` | 125 个测试文件、813 个测试通过 | 是，M2.11 全 API 回归；不代表 Visio 或人工视觉验收 |
| 独立代码审查 | 无 P0/P1 | 是，确认多阻塞证据完整保留、会话逐条澄清及旧 v3 单题兼容投影 |
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
- 不把浏览器 SVG rubric 诊断报为跨 renderer、顶刊人工审查或正式 visual acceptance；
- 不把未来 R1–R5 的设计状态报为正式 ledger accepted 状态。

## 5. 允许的下一步

R0 的 legacy VGG16 fixture 只保留作回归基线。M2.6 已接受的 UGS、General Publication Graph 与 PublicationVisualPlan 合同仍是唯一通用结构输入。M2.11 已把提示/静态代码事实放入确定性的 owner/device-bound session：阻塞 topology 只能返回一个澄清且没有 PVP；确认只更新所涉语义区域并重新编译 GPG/PVP。它不读取路径、不会产生 COM 参数、Snapshot、export job 或 renderer authority。M2.11 当前等待窄范围 Git 交付和正式 ledger acceptance，不能仅凭工作树回归报告为 accepted。Core Drawing V1 在 owner 审阅后按以下顺序实施：受约束的陌生架构解释（只写入证据绑定 UGS）→ 语义 visual grammar 与 zero-template 人工审阅 → 仅候选/澄清的草图观察 → sealed formal PVP 驱动的当前 Visio 页更新、保存/重开/独立 readback。任何 candidate 或 blocking UGS 均不得进入 Snapshot、native intent、Worker 或 Visio。M3.1 的 Snapshot-only native intent 维持已接受边界；M3.2 因产品优先级而回退为 deferred，不能在 M2.11 的正式 acceptance 前继续扩展。Prompt-to-UGS 与 Static-code-to-UGS 已有提交证据但仍待独立接受；两者均不能绕过 formal/candidate 边界。PatternLibrary 必须等待预览、真实 Visio 生命周期和 Sketch 的受限证据。任何后续实现必须更新本记录、对应 baseline 和 Operation History，并根据证据决定是否更新 ledger。
