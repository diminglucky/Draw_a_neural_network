# Visio Native Group Intent V5 Design

## Goal

把 V4 PVP vNext Snapshot 映射成一个明确的、可校验的 native group intent，使一个 semantic module 对应一个 group，module parts 对应 group children，并保留后续 Visio readback 所需的 identity。

## Boundary

V5A 只生成 `pvp-vnext-native-group-1` renderer intent。它不重新布局、不重新解释 graph、不接受客户端 shape、 不调用 COM，也不复用旧 `pvp-native-intent-1` 的 primitive-only contract。只有 `formal` V4 snapshot 可以进入 V5A；candidate 和 blocked 必须 fail closed。

## Mapping

```text
PlannedVisualModule
  → NativeModuleGroup
      → NativeGroupChild[]
      → module shape data
      → readback manifest

PlannedVisualRelation
  → NativeGroupConnector
```

每个 group 必须包含：`groupId`、`moduleId`、`semanticType`、`panelId`、`grammarId`、bounds、children、shape data 和 ownership marker。每个 child 必须包含 part ID、part role、kind、bounds、label、source/evidence mapping 和 group ownership marker。

## Safety

- group IDs、child IDs、relation IDs 必须稳定且唯一；
- 所有 bounds 和 route 必须来自 V4 snapshot，并且仍在 page 内；
- 不允许 command、COM、provider、sourceCode、sourcePath 等字段；
- intent 的 snapshot hash 必须绑定 V4 canonical hash；
- readback manifest 必须列出每个 group 和 child 的期望 identity；
- 后续 Worker mapper 必须独立校验 protocol、hash、ownership 和 shape data，不能把此 DTO 当作旧 PVP primitive intent。

## Future Worker handoff

后续 C# Worker mapper 将把 `NativeModuleGroup` 映射到 Visio COM group/ungrouped child shapes，并在保存、关闭、重开后按 readback manifest 独立核对 group 与 child。当前 V5A 不宣称真实 Visio 验收。
