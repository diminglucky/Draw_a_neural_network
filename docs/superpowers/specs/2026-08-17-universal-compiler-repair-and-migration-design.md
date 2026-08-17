# 通用神经网络论文图编译器：彻底修复与双轨迁移设计

**状态：** 已获产品方向确认；待规格审阅后进入实施计划
**日期：** 2026-08-17
**范围：** 修复现有质量门漂移，并将当前 v2 MVP 有序迁移到可审计的 v3 通用编译主线。

## 1. 决策摘要

本项目不采用一次性重写，也不继续在 v2 路径上堆叠模型名模板。采用**绞杀式双轨迁移**：

- 保留现有 v2 Agent、Canvas、Draft、preview 和 legacy Visio 路径，作为明确标记的兼容/演示能力；不在迁移期间改变其已有请求和响应契约。
- 新的代码、模型和后续多模态输入进入 v3 通用编译路径：`SourcePack -> Analyzer -> EvidenceGraph -> Architecture IR v3 -> Figure Components -> PlanSnapshot -> sealed export -> Visio readback`。
- 每一阶段都必须通过 focused tests、全量 API tests、严格 TypeScript、diff check 和相应真实环境门，才可推进到下一阶段。
- 任何模型、Provider、浏览器或客户端都不得直接生成 Visio COM 命令、shell 命令、输出路径、原始 SVG/XML 或可直接执行的图形指令。

这不是“修几个报错”的任务；它是将已经存在但尚未接线的 v3 设计，变成用户可用、可验收、可回滚的产品主线。

## 2. 当前问题与根因

### 2.1 双轨实现没有迁移边界

现有用户路径是 v2：

```text
Browser chat -> POST /api/agent/chat -> PublicationFigureAgent
  -> Canonical NetworkIR v2 -> FigureDraft -> FigureDraftPreviewService
  -> specialized grammar preview
```

仓库同时拥有 v3 `EvidenceGraph`、`Architecture IR v3`、`UniversalPreviewService`、`PlanSnapshot`、sealed universal Worker protocol 和 universal export service；它们尚未形成受路由、应用装配和浏览器消费的正式产品路径。静态 PyTorch P0.0 分析器也仅由自身测试调用。

### 2.2 质量门漂移

Vitest 可以运行转译后的测试，却不取代 `tsc --noEmit`。legacy Visio readback 已扩展为 primitive、connector 和 Shape Data 对账，而旧路由投影和 mock 仍提供旧的最小 readback。严格 TypeScript 因此失败。质量门必须恢复为：测试绿、类型绿、diff check 绿共同成立。

### 2.3 P0.0 的真实边界

首个静态 PyTorch 切片只接受：

- 已声明的 `self.<name> = nn.<Constructor>(...)`；
- 单一、静态、线性的 `forward` 调用链；
- 不执行、导入、求值、加载权重或联网访问用户 Python。

它不接受 branch、Add/Concat、skip、module reuse、动态 shape、repeat、Keras、ONNX、图片理解或任意运行时反射。对这些情况必须产出带来源定位的 blocking unresolved，绝不猜测拓扑。该切片正式命名为 **P0.0**，而不是完整 Phase A.1。

## 3. 目标、非目标与完成定义

### 3.1 目标

1. 恢复全工程严格 TypeScript 质量门，并防止 legacy Worker 协议再次与路由/测试漂移。
2. 让受支持的线性 PyTorch 源码通过正式、认证的 v3 请求链生成 evidence-backed Architecture IR v3。
3. 让未确认或不支持的结构只能得到候选结构/一个明确问题，不能获得 PlanSnapshot 或导出权限。
4. 建立 v3 preview、不可变 PlanSnapshot 和正式 universal export 的明确迁移路径。
5. 最终在真实 Windows/Visio 主机完成可编辑 VSDX、关闭/重开/readback、PDF/PNG、视觉 QA 和生产产品验收。

### 3.2 非目标

- 不在 P0.0 中执行用户代码、运行 PyTorch、加载模型权重或使用任意桌面自动化。
- 不以网络名称、Provider 猜测或图像相似度补全关键结构事实。
- 不在 v3 达到对应迁移门前删除 v2 API、Canvas 行为、existing Draft 或 legacy export。
- 不将 Keras/ONNX、图片/草图理解、GNN/Message Passing 或新的专用 grammar 偷渡进 P0.0。
- 不把 mock、协议、单测或本地 preview 说成真实 Visio、Provider、安装包或商业验收。

### 3.3 端到端完成定义

“通用编译器主线完成”要求每个黄金样本完成：原始输入、EvidenceGraph、Architecture IR v3、组件化 FigurePlan/PlanSnapshot、preview、可编辑 VSDX、PDF、PNG、真实 Windows/Visio 保存/关闭/重开/readback、缩放灰度 QA 和人工视觉审阅。Provider、PostgreSQL/Redis、Electron 包、取消/恢复和 Git 交付仍是独立门。

## 4. 目标架构与信任边界

```text
User input
  -> SourcePack (owner, immutable hash, media/type/size budget)
  -> analyzer (static PyTorch initially; future controlled analyzers)
  -> EvidenceGraph (facts, provenance, confidence, conflicts)
  -> Architecture IR v3 (typed ports, semantic operators, unresolved)
  -> CandidateStructurePreview OR Figure Components/Compiler
  -> immutable PlanSnapshot (planId, planHash, preview artifact hashes, QA)
  -> viewed-preview confirmation token
  -> sealed Universal Export Job
  -> restricted Windows Visio Worker
  -> native-shape readback and renderer QA
```

### 4.1 Trust rules

| Boundary | Allowed input | Required output | Forbidden |
|---|---|---|---|
| Analyzer | Immutable user SourcePack | Evidence facts, observations, unresolved | Execution, imports, network, shape guesses |
| Provider | Bounded evidence and user intent | Candidate facts, explanation, clarification | Plan coordinates, file paths, COM/shell commands |
| IR validator | EvidenceGraph and typed IR | Valid IR or explicit issues | Silent semantic repair |
| Compiler | Render-ready v3 IR and FigureIntent | FigureSet, QA, deterministic PlanSnapshot | Reading arbitrary attachment/filesystem state |
| Browser | Public safe projections | Candidate/preview display and explicit confirmation | Direct Worker control, secret access, arbitrary action execution |
| Worker | Signed sealed plan bound to user/device/job | VSDX/PDF/PNG and readback evidence | LLM text, browser diagram, external paths/URLs |

### 4.2 Candidate versus full preview

- If Architecture IR v3 contains a blocking unresolved item, the system returns `candidate_structure`, a visible `STRUCTURE_PENDING_CONFIRMATION` watermark and exactly one deterministically selected question. It does not invoke the compiler, create a snapshot or issue export authorization.
- If IR is render-ready, the compiler must produce a deterministic FigureSet and passing server-side visual QA before an immutable PlanSnapshot is stored.
- Export authorization binds the exact viewed `planId`, `planHash`, preview artifact hashes, owner, device and revision. Export never recompiles a possibly changed draft.

## 5. Versioning and migration rules

### 5.1 v2 remains explicit legacy

`POST /api/agent/chat`, Canonical NetworkIR v2, existing FigureDraft preview and browser canvas actions remain available while v3 is introduced. They must be labelled legacy/compatibility in code and product documentation once the v3 path exists.

No v2 object may masquerade as v3. Conversion can occur only through a versioned adapter that records loss/warnings. A v3 PlanSnapshot cannot be created from raw v2 visual fields or browser-controlled geometry.

### 5.2 v3 receives a separate public request boundary

The initial v3 API is versioned and separate from legacy Agent chat. It accepts only a bounded source descriptor plus authenticated ownership; it returns only a safe public analysis projection. Its exact route name and DTO are settled in the M1 implementation plan, but the contract must include:

- a source identifier, content type, byte count and immutable content hash;
- source type (`pytorch-source` for P0.0);
- v3 analysis status (`needs_confirmation`, `candidate_structure`, `ready_for_preview`, or explicit failure);
- bounded public evidence summary, Architecture IR v3 projection, one blocking question, warnings and capability version;
- no Provider key, raw secret, file path, executable payload, Worker protocol field or internal source locator excerpt beyond allowed public evidence policy.

The existing user-owned FigureDraft/revision model may be extended only after an explicit schema migration proves ownership, revision, retention and safe projection behavior. A separate immutable analysis record is preferred if extending Draft would expose v3 Plan or source content to legacy consumers.

### 5.3 Feature flags and rollback

The v3 route, preview and export path are independently feature-gated. Disabling a gate must reject new v3 work with an explicit capability error without deleting existing v2 content, PlanSnapshots or legacy behavior. Feature flags are configuration, not client-controlled request fields.

## 6. Delivery milestones and exit gates

### M0 — Restore engineering truth

**Scope:** legacy Visio readback contract, public DTO narrowing, tests and type check only.

**Required outcomes:**

1. One canonical typed legacy readback fixture/factory supplies every Worker mock.
2. Route projections validate `unknown` values with explicit type guards or schemas before reading numeric fields.
3. `npx tsc --noEmit`, focused affected tests, full `npm run api:test`, `npm run api:check` and `git diff --check` pass.
4. No externally visible v2 behavior changes.

**Exit condition:** no strict TypeScript errors and legacy protocol tests prove extended readback fields are required.

### M1 — P0.0 static PyTorch enters the authenticated product path

**Scope:** SourcePack boundary, static analyzer adapter, v3 analysis persistence/projection and authenticated request route.

**Required outcomes:**

1. A supported linear source produces hash-bound facts, typed locators, Architecture IR v3 and a safe public result.
2. Dynamic control flow, unknown calls, reuse, branch and merge return blocking unresolved without compiler/export invocation.
3. Audit records contain outcome/count/version metadata only; raw source content and Provider credentials are excluded.
4. Ownership, session/device authorization, request-size limits and idempotency are covered by route tests.
5. No code path silently falls back from static source failure to a model-name preset or Provider topology guess.

**Exit condition:** P0.0 can be demonstrated through the authenticated public route, but is advertised only as static linear PyTorch support.

### M2 — v3 compiler and publication preview

**Scope:** Figure Component contract, ComposableDagFigureCompiler, v3 preview route, PlanSnapshot and visual QA.

**Required outcomes:**

1. Gold fixtures cover CNN, residual backbone, encoder-decoder and token transformer, plus at least one unknown-to-specialized-grammar DAG fallback.
2. The compiler operates on semantic v3 IR rather than model-name conditionals.
3. PlanSnapshot is immutable, deterministic for the same IR/intent/manifest/seed and invalidated on any relevant visual artifact change.
4. Layout, labels, contrast, grayscale, route/endpoint and source-mapping QA must pass before snapshot persistence.
5. Candidate structures cannot create snapshots, preview tokens or export jobs.

**Exit condition:** users can view a v3 preview that is exactly the object eligible for later export.

### M3 — sealed universal export and real Visio acceptance

**Scope:** production app assembly, universal Worker runner, signed plan execution and Windows/Visio evidence.

**Required outcomes:**

1. Production `buildApp` constructs and owns the universal export service/runner; they are not test-only injected dependencies.
2. Worker only accepts a valid sealed plan whose job, owner, device and plan binding match.
3. A successful Worker result supplies VSDX/PDF/PNG artifacts, hashes, native-shape readback, connector endpoint readback and renderer QA.
4. Real Windows/Visio runs create a new document, save it, close it, reopen it and independently inspect editability/readback.
5. Cancellation, timeout, restart recovery and idempotency are tested separately from successful export.

**Exit condition:** a real-host VSDX is proven to match its viewed v3 preview and remain natively editable after reopen.

### M4 — production delivery acceptance

**Scope:** real Provider, durable services, desktop package and operations.

**Required outcomes:**

1. Provider cost/timeout/retry/redaction/usage controls work with live credentials kept server-side.
2. PostgreSQL and Redis durable behavior, migrations, fencing, concurrency, recovery, backup and alerting are accepted.
3. Electron package signing, DPAPI lifecycle, clean install, upgrade, revocation, offline/reconnect and multi-device behavior are accepted.
4. Release artifacts, package hashes, source commit, remote SHA and actual host versions are recorded together.

**Exit condition:** commercial readiness is reported only after all separate gates have direct evidence.

## 7. Testing strategy

Each behavior change follows red -> green -> refactor. New v3 capabilities require at least:

1. raw source/input fixture and analyzer facts;
2. expected v3 IR plus rejection/clarification counterexample;
3. expected semantic model/plan or PlanSnapshot identity;
4. preview or Worker/readback assertion appropriate to the phase;
5. route authorization/ownership/public-projection tests;
6. full-suite, strict TypeScript and diff checks.

Focused tests do not replace full-suite, type, real-host, visual or external-service acceptance.

## 8. Risks and controls

| Risk | Control |
|---|---|
| v2/v3 data leak or accidental downgrade | Separate versions, explicit adapters, feature flags, no raw v2 visual fields in v3 export |
| Provider hallucinates topology | Analyzer/evidence facts authoritative; unresolved blocks preview/export |
| More grammar equals false “universal” support | Expand only through analyzer, IR semantic or component contracts with fixtures |
| Tests hide type regressions | Strict TypeScript is a required gate; mock fixtures derive from canonical protocol type |
| Browser/Worker command injection | Browser sees safe projections; Worker receives only sealed allowlisted plan |
| Preview differs from VSDX | Hash-bound PlanSnapshot, readback, PDF/PNG and renderer QA comparison |
| Scope explosion | M0-M4 gates; Keras/ONNX, image understanding and GNN remain post-M3 controlled extensions |

## 9. Acceptance reporting discipline

Every report must separately identify:

- source/design/spec approved;
- focused and full automated tests;
- strict TypeScript and diff checks;
- durable database/Redis proof;
- real Provider proof;
- worker mock proof;
- real Windows/Visio save/close/reopen/readback proof;
- visual and grayscale manual review;
- Electron/package/installation proof;
- commit, remote SHA and release artifact evidence.

No green result implies any other gate.

## 10. Next implementation boundary

The first implementation plan covers **M0 and M1 only**. It does not start M2 components, M3 Visio acceptance or M4 commercial operations. M0 repairs the existing type/legacy contract before M1 adds one safe, linear source-to-v3-analysis path. M2 may begin only after M0 and M1 acceptance evidence is recorded.
