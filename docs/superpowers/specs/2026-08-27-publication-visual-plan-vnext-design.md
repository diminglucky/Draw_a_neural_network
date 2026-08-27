# Publication Visual Plan vNext Design

## Goal

将已经确认的 Semantic Architecture Graph、Semantic Visual Compilation 和 Figure Story Plan 固化为一个独立、版本化、可审计的 PVP vNext Snapshot，作为后续浏览器预览和 Visio native group renderer 的唯一语义输入。

## Boundary

V4 只负责 snapshot contract、服务端确定性几何和 provenance/readback manifest。它不解析代码、不识别论文、不调用 Provider、不接收客户端 geometry、不生成 COM/Visio command，也不修改旧 PVP v1。

`blocked` graph 必须 fail closed，不产生 snapshot。`candidate` graph 可以产生 `candidate` snapshot，但 snapshot 不能携带 formal eligibility 或 QA passed。未知模块和 blocking unresolved 不得绕过 V1 eligibility。

## Input and output

```text
SemanticArchitectureGraph
SemanticVisualCompilation
FigureStoryPlan
layoutSeed + layoutIntent
            ↓
PublicationVisualPlanVNext
```

Snapshot 需要包含：

- stable identity and canonical hash;
- panel bounds and panel membership;
- semantic modules, V2 parts and module metadata;
- data objects;
- typed relations and deterministic orthogonal routes;
- panel containers and story insets;
- process tracks and relation legend;
- source mappings and readback manifest;
- renderer capability requirements.

## Determinism

所有 module、part、relation、panel 和 source mapping 按稳定 ID 或 story order 排序。布局只使用 graph/story 内容、声明的 layout intent 和显式 `layoutSeed`，不使用当前时间、随机数、模型名称或机器环境。相同输入连续生成三次必须得到 byte-equivalent canonical JSON；改变 revision 或 seed 必须改变 snapshot identity。

## Geometry policy

几何只由 V4 内部生成。overview 按 Figure Story 的 main path 横向排列；detail、process 和 legend 使用确定性的 panel grid；parts 在 module bounds 内按稳定 part order 排列；typed relation 使用 source/target port anchor 生成最小正交 route。布局器不能新增 graph module、relation 或 evidence。

## Eligibility and safety

- `formal` 仅当 Graph eligibility 为 `formal` 且 compilation/story eligibility 一致时生成；
- `candidate` 保留 candidate 状态，不能有 formal reasons 或 QA passed；
- `blocked` 直接抛出稳定错误；
- 每个 module、part、data object 和 relation 都必须保留 source/evidence mapping；
- 不保存原始代码、图片像素、本地路径、Provider 自由文本、COM command 或客户端覆盖坐标；
- output deep-freeze，canonical hash 覆盖全部公开字段但不自引用。

## Future handoff

V5 只消费此 snapshot，把每个 `PlannedVisualModule` 映射为一个 Visio native group，并以 readback manifest 对账。浏览器预览也应消费相同 snapshot，不能重新解释 Semantic Architecture Graph。
