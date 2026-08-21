# 当前实现记录：自适应通用神经网络绘图 Agent

**Record ID：** `IR-2026-08-20-current-roadmap`
**对应基线：** `DB-2026-08-21-receipt-bound-harness-closure`
**最后核对：** `2026-08-21T07:13:31.831Z`
**正式 ledger 焦点：** `M2.12 — Evidence-augmented architecture interpretation`
**总体状态：** `active` — `aa9835c383aa18c804a23856893685af97443fef` 已推送至 `origin/agent`。M2.8、M2.10、M2.11 的来源边界、非执行静态分析、会话澄清与局部 PVP delta 已完成全套回归和两组独立审查，且正式证据已记录。M2.12 当前是设计和迁移盘点焦点，而非可直接编码的独立解释器：其实现必须先依赖 DrawingRun、Coordinator、idempotency/cancellation 与 EvidencePack 前置合同。现有自由文本解释器仅为兼容原型；正式实现必须使用私有回执、Coordinator 内部上下文、脱敏 Provider payload、Harness 公共证据投影与规范 ID 重键。

**修订中的产品基线：** `docs/superpowers/specs/2026-08-21-core-drawing-v1-vertical-slice-design.md` 将陌生网络理解、publication visual grammar、草图候选解析和当前 Visio 页增量更新收敛为一个可验证的 Core Drawing V1 垂直闭环。它保留 M2.11 的 UGS/GPG/PVP、静态不执行、证据谱系及 owner/device/revision 绑定；这是一份待 owner 审阅的设计提案，不增加已实现能力，不变更任何 ledger 节点状态，也不构成 Provider、草图、视觉语法、当前文档 Visio、真实主机或人工视觉验收。

**本轮审查修订：** 该基线现明确要求 Worker 发现当前已打开的文档/页面、用户显式选择目标、绑定 Agent-owned region、每次写入前后的独立 readback 与冲突拒绝。既有 `OpenOrCreate` 生命周期不能充当当前页附着机制；日常更新不得关闭或替换用户文档。M2.12 已进一步闭合为 `Coordinator-internal context reference -> redacted Provider payload -> local proposal -> Harness`：Provider 不接收 receipt/context/run/owner/device ID，候选或阻塞结构不产生 PVP，公开文本与证据均由 Harness 投影，局部 ID 和数组位置不得作为 canonical 排序依据。架构描述、草图 intake/observation、七类语义 visual corpus 和真实主机验收仍有独立契约与顺序。本段仍是设计记录，不是实现或验收声明。

**CD0 验收记录：** `docs/evidence/2026-08-21-core-drawing-cd0-acceptance.md` 记录了 M2.8/M2.10/M2.11 的可达提交、全套回归与独立审查。三者现为 `accepted`，因此 `M2.12` 已成为唯一 `active` 节点；`M2.13` 仍为 planned，且 Provider、Visio、Worker 与真实主机行为仍未启动。

## 1. 当前交付判断

| 层次 | 当前判断 | 证据边界 |
|---|---|---|
| 设计 | `approved_for_staged_implementation` | 用户已确认以未知网络直绘为目标；规格和治理资产仍是未提交 working-tree 文档 |
| 当前路线图 | `active` | M2.8、M2.10、M2.11 已接受；M2.12 是唯一 active 的设计/盘点节点，但生产代码须先完成主平台 Phase 0–2 前置。M3.2 仍因产品优先级保持 deferred，PatternLibrary 继续后置。 |
| API | `passed` | `npx tsc --noEmit`、`npm run api:check` 通过；完整 API 套件为 125 个测试文件、820 个测试通过 |
| Worker 单元测试 | `passed` | 234 通过、2 跳过、0 失败；跳过项不是真实 Visio 验收 |
| 通用未知网络直绘 | `M2.12 active — design gated` | UGS 严格合同、未知模块直绘、candidate topology、结构证据、GPG/PVP、会话澄清及全套 API 证据均已接受；受限 v4 preview 已支持 typed prompt/static PyTorch → UGS → GPG → PVP。M2.12 的自由文本解释器是待迁移兼容原型，不能作为正式通用理解能力或后续视觉/Visio 权威；新 Harness 须先依赖 Phase 0–2，再完成 receipt/EvidencePack、内部 context 与外发 payload 分离、formal-only PVP 及 canonical rekeying。 |
| 通用 Visio | `not_started` | 当前 bridge 仍是 canonical VGG16 夹具，不能作为通用导出能力 |
| 真实 Visio / 人工视觉 | `not_started` | 尚无未知网络的真实主机保存、重开、编辑和独立 readback 证据 |

## 2. 能力轨道记录

| Work item | 目标 | 状态 | 当前证据/阻塞 | 下一步 |
|---|---|---|---|---|
| R0 | 恢复 canonical VGG16 夹具 | `passed` | canonical `conv-*` / `classifier` 名称别名恢复固定 VGG 槽位；bridge、execution snapshot、export route 重点测试 8 项通过；完整 API 套件通过 | 完成 R1–R5 到正式 ledger 的受审查映射；不要将 R0 误报为 universal renderer |
| R1 | UGS、General Publication Graph 与通用 Figure Plan | `accepted` → `M2.6` | 已验证 UGS→General Publication Graph→General Publication Figure Plan 的 canonical provenance 闭环：公开边界重解析 UGS，拒绝 candidate/blocking/feedback、伪造 graph/mapping/layout、非规范 plan 顺序及受限属性；Figure Plan 使用跨主机 code-unit 排序、支持 128 字符源 ID、256 nodes / 1,024 ports / 2,048 edges、768 primitives / 2,048 connectors 和受限 10,000 文档单位几何；聚焦 4 文件 49 项、全 API 103 文件 661 项、TypeScript、foundation、严格 roadmap 以及独立审查均通过 | 保持 accepted 合同稳定，作为 M2.5 的唯一通用结构输入 |
| R2 | PVP-backed Snapshot/导出资格 | `accepted` → `M2.5` | `f2f2114` 已将 Snapshot 重基为 trusted-QA PVP，重算 UGS/GPG/PVP lineage 并在不合格输入时零写入；owner 已授权接受该合同 | 保持 Snapshot 为唯一可信 PVP 来源；M3.2 仍需 M3.1 acceptance |
| R3 | Adaptive Pattern Library | `deferred` → `M2.7` | Profile 不是 PatternLibrary；共享模式库必须等待 M2.9 预览、M3.5 真实主机和 M4.5 受限草图证据 | 此前不实现 candidate 学习、提升或共享版本化 |
| R4A | Prompt-to-UGS | `accepted` → `M2.8` | `aa9835c` 补齐端口级 evidence lineage；全套回归与独立审查均通过 | 仅以 canonical evidence 向 M2.12 提供输入，不授予 export/Visio 权限 |
| R4B | Static-code-to-UGS | `accepted` → `M2.10` | `aa9835c` 强制直接分析器摘要绑定，并使条件初始化 fail closed；全套回归与独立审查均通过 | 仅以非执行 canonical evidence 向 M2.12 提供输入，不授予 export/Visio 权限 |
| R4D | Evidence-constrained drawing session | `accepted` → `M2.11` | 来源配对、逐条澄清与 PVP semantic delta 已有回归和两组独立审查；正式 evidence 已记录 | 保持 renderer-neutral；M2.12 不得引入 persistence、provider、Snapshot、export、Worker 或 Visio |
| R4E | Receipt-bound Structural Harness | `active — design gated` → `M2.12` | 现有自由文本 interpreter 原型与 83 项聚焦回归存在，但无 M2.12 acceptance evidence；其自由 locator 与 Provider ID 不能构成长期公开边界，且不能绕过 DrawingRun/Coordinator 前置 | 先完成 Phase 0–2，再建立 PrivateInputReceipt → EvidencePack → Coordinator-internal ProviderContextReference → redacted ProviderContextPayload → local proposal → Harness。Provider 仅 localRef/localFactRef；Harness 完成 canonical evidence/graph ordering 后才可发出 formal UGS |
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
| `npm run api:test` | 125 个测试文件、820 个测试通过 | 是，CD0 全 API 回归；不代表 Visio 或人工视觉验收 |
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

R0 的 legacy VGG16 fixture 只保留作回归基线。M2.6 已接受的 UGS、General Publication Graph 与 PublicationVisualPlan 合同仍是唯一通用结构输入。M2.8/M2.10/M2.11 现已接受：提示/静态代码的 canonical facts 进入确定性的 owner/device-bound session，阻塞 topology 只能返回一个澄清且没有 PVP，确认只更新所涉语义区域并重新编译 GPG/PVP。它不读取路径、不会产生 COM 参数、Snapshot、export job 或 renderer authority。M2.12 的下一步不是直接实现陌生架构解释器，而是完成平台 Phase 0–2 的状态机、Coordinator、存储、幂等、取消和迁移清单；之后才按 receipt/EvidencePack、内部 context/外发 payload、local proposal、Harness 的顺序实施。任何 candidate 或 blocking UGS 均不得进入 PVP、Snapshot、native intent、Worker 或 Visio。其后依次是语义 visual grammar 与 zero-template 人工审阅、仅候选/澄清的草图观察、sealed formal PVP 驱动的当前 Visio 页更新、保存/重开/独立 readback。M3.1 的 Snapshot-only native intent 维持已接受边界；M3.2 仍因产品优先级 deferred。PatternLibrary 必须等待预览、真实 Visio 生命周期和 Sketch 的受限证据。任何后续实现必须更新本记录、对应 baseline 和 Operation History，并根据证据决定是否更新 ledger。

## 6. Phase 0 DrawingRun migration truth

Phase 0 records the migration baseline only. `M2.12` remains the active design-gated current focus with its established `M2.8`/`M2.10`/`M2.11` dependencies. Phase 0 migration governance, Phase 1 DrawingRun contracts/public projection, Phase 2 Coordinator/durability, and the following receipt/EvidencePack intake are non-skippable prerequisites recorded in M2.12's existing quality acceptance and next action, not new graph dependencies or executable ledger nodes. M2.12 must remain active and cannot enter review or acceptance from test-only evidence or without documented Phase 0-2 predecessor closure. Its free-text interpreter remains a regression-only compatibility prototype. `M2.13` remains planned and needs manual visual review in addition to tests.

The only planned current-page Visio record is `M3.6`. It cannot be accepted until formal PVP, sealed binding, restricted Worker, independent readback/recovery, and real-host acceptance have all completed. Unit tests, existing VGG fixtures, Snapshot-only native intent, an export job, or `OpenOrCreate` behavior do not satisfy that claim. This Phase 0 work adds no Provider, PVP, Worker, Visio, API, persistence, or real-host capability and changes no node to `accepted`.
