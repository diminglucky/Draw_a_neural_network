# 通用神经网络顶刊绘图 Agent：设计审查日志

**日期：** 2026-08-19
**审查对象：** `docs/superpowers/specs/2026-08-19-universal-neural-figure-agent-design.md`
**审查基线：** `agent` / `f2ccaa7558bc67efedfa159b0800eddbab07b0ce`
**状态：** 已审查并修订；等待产品负责人确认。不是实现验收、部署验收或真实 Visio 验收。

## 1. 审查范围与方法

本次审查从四个维度进行：

1. 用户目标是否被正确建模为“结构理解 + 论文图表达 + 原生可编辑 Visio”，而不是 VGG16 模板；
2. 文档的模型、状态机、阶段顺序和失败处理是否能形成稳定的实现合同；
3. 文档是否如实描述当前源码，而没有把 WIP、局部测试或 VGG 专用 bridge 写成通用能力；
4. 设计是否保留 fail-closed、白名单投影、owner/device 绑定和同画布持续编辑等安全/长期运行边界。

已核验的实现事实：

- `apps/api/src/agent-visio-bridge.ts` 在入口执行 `assertCanonicalVgg16`，并在不符合 canonical VGG16 拓扑时拒绝；它是试验夹具，不能作为 universal export。
- `apps/api/src/static-pytorch-source-analyzer.ts` 只证明线性 `self.<module>(value)` forward 路径；非线性数据流、模块复用、动态控制流和未知语句会产生 unresolved。
- `apps/api/src/figure-components.ts` 拒绝 feedback edge；`apps/api/src/composable-dag-figure-compiler.ts` 拒绝 cycle。因此首版通用回退语法必须是 acyclic，不能假称支持循环网络。
- `docs/agent-program-state.json` 的当前 focus 为 M2.5，M3 的 universal export、sealed authorization、Worker 边界、readback/recovery 和真实 Windows/Visio 验收均仍是 planned。

当前 worktree 存在未提交 WIP；本日志不把这些文件视为接受证据，也不授权其进入通用产品路径。

## 2. 审查结论

**结论：条件通过（设计层面）。**

该设计的总体方向合理，正确地把“理解网络”“选择图语法”“生成可编辑 Visio”分成独立、可验证的层次；它也明确拒绝模型名称模板、直接执行代码、浏览器直控 COM、草图图片贴图和未知结构猜测。这是构建稳定通用绘图 Agent 的必要方向。

但原始版本有四项会导致实施歧义的缺口。它们已经在同一审查中修订到设计文档；在下表中保留原因、决策和验证要求，防止后续实现再次偏离。

| ID | 级别 | 发现 | 审查决定 | 关闭条件 |
|---|---|---|---|---|
| DR-01 | P1 | Gate 0 已定义 M2.5，但 Phase C 又写“完成 M2.5”，阶段所有权不唯一。 | M2.5 固定为 Gate 0；Phase C 只扩展已接受的 Snapshot 以包含 Module/Presentation hash。 | Gate 0 计划和测试证明 preview/export 使用同一 snapshot；Phase C 不重新实现它。 |
| DR-02 | P0 | 模块合并规则没有解决 Conv、Repeat、Residual 等重叠匹配，无法保证输出稳定。 | 增加 deterministic normalizer：连通子图、显式接口、单归属、语义优先级、canonical ID tie-break、无法证明即 unresolved，以及可重放 transform 记录。 | 同一 IR 多次 normalize 的 graph hash 一致；重叠/分叉/冲突 fixture fail closed。 |
| DR-03 | P1 | Computational Graph 可有 feedback，现有 Figure Component/DAG compiler 却拒绝 feedback/cycle。 | G5 首版只接收 acyclic Presentation Graph；循环/状态结构保留 candidate，未来独立实现 State/Recurrence grammar。 | feedback/cycle fixture 不创建 Figure Plan、Snapshot 或 export。 |
| DR-04 | P1 | Phase A 要用 ResNet/U-Net/ViT，但代码输入扩展在 Phase E，原文“每个样例都有 SourcePack”会制造错误的端到端承诺。 | 黄金样例分层：Phase A/B 用 canonical Computational Graph fixture；对应 SourcePack-to-IR 只有在适配器支持后才加入。 | Phase A 测试不假设复杂 PyTorch 已支持；Phase E 为每个支持的族增加端到端 SourcePack evidence。 |
| DR-05 | P1 | `agent-program-state.json` 仍指向较早 architectureSpec。 | 新规格和本日志在用户确认前是 reviewed proposal；确认后以窄文档提交更新正式指针。 | 路线图指针、设计规格和已批准实施计划三者同一提交可追溯。 |

## 3. 已确认的设计决策

### D-01：结构优先于视觉

任何论文级输出都必须从 evidence、atomic computational topology 和 semantic module derivation 获得，而不是从模型名、LLM 描述或截图像素直接生成 Visio 坐标。VGG16 仅作为 CNN Tensor Plate 的黄金样例。

### D-02：可逆合并是核心能力

模块合并只能改变默认展示粒度，不能删除节点、边、端口和 evidence。`collapse`、`expand`、`merge`、`split` 都要产生有 hash 的 Presentation Graph revision；Visio 的 `applyDiff` 仅以这些稳定身份更新同一个画布。

### D-03：不确定性必须可见且不可导出

未证明的 Add/Concat、箭头方向、shape、模块重用、动态控制流、feedback/cycle 都进入 `candidate_structure` 或 `needs_clarification`。系统每轮提出一个最高优先级的 blocking question；候选结构不得创建正式 PlanSnapshot 或导出作业。

### D-04：图语法是可版本化产品资产

CNN、Residual、Encoder–Decoder、Transformer 和 General Provenance DAG 的适用条件、primitive、布局约束、视觉 QA 与黄金样例必须独立版本化。不能用统一方块/线性 cursor 布局冒充“顶刊风格”。

### D-05：稳定 Visio 是协议责任，不是 UI 偶然行为

相同 owner/device/workflow/document/page 只允许一个串行 Worker actor；每个命令带 snapshot、expected revision 与 idempotency key；成功需要 checkpoint 和 native readback 对账。崩溃、取消、超时、锁冲突、版本不兼容必须可恢复或显式失败，不能偷建新画布、重复 Shape 或降级成截图。

## 4. 当前真实状态与不可越过的边界

以下不是设计缺陷，但必须在实施时持续保持真实：

| 项目 | 当前状态 | 不得误报为 |
|---|---|---|
| 静态 PyTorch 输入 | 仅安全地支持可证明的线性 forward 链 | ResNet/U-Net/ViT 代码已通用支持 |
| VGG16 Visio bridge | canonical VGG16 专用试验路径 | universal Visio renderer |
| M2.1–M2.4 | 已有组件、DAG compiler、Visual QA 和 owner-scoped preview 的接受记录 | 完整的 preview-to-export 完成 |
| M2.5 | 当前可执行、planned | 已稳定绑定的 snapshot/export |
| M3 | universal export、sealed job、Worker/recovery 和真实主机验收仍 planned | 已长期可用的 Visio 产品 |

## 5. 后续执行门

1. 产品负责人确认该规格及本日志；随后以单独的窄文档提交更新 `program.architectureSpec`。
2. Gate 0 / M2.5：先以测试证明预览、snapshot 和导出资格是同一不可变对象；candidate 永不具备导出资格。
3. Phase A：以 canonical IR fixture 实现并独立审查 deterministic Semantic Module Graph。此阶段不扩展 VGG 专用代码、不做草图 OCR、不声称复杂 PyTorch 输入支持。
4. Phase B：为每种 Grammar 建立 layout、semantic QA、视觉截图和人工审查门。
5. Phase C/D：接入统一预览、sealed export 与通用 Visio renderer，并按 M3.5 在真实 Windows/Visio 上完成保存、关闭、重开、编辑和独立 readback 验收。
6. Phase E：输入适配器以 SourcePack-to-IR 端到端证据逐族扩展；每增加一类输入，都必须保留 fail-closed 反例。

## 6. 本次审查后的剩余风险

没有未处理的架构矛盾；仍存在两个明确的交付风险：

1. 本规格和本日志尚未获得产品负责人确认，也尚未成为 `agent-program-state.json` 指向的正式 architectureSpec；
2. 当前工作树中的 VGG/Visio WIP 与通用路线尚未完成隔离和独立审查，后续实施必须只按 allowlist 操作，不能把 WIP 当成 Gate 0、Phase A 或 M3 的通过证据。

因此，本次状态是 **“设计审查完成并条件通过，待确认后开始按门实施”**，不是“Agent 已开发完成”。
