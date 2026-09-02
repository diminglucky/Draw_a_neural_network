# Input Visual Grammar 重构设计

## 目标

将 Universal IR 中所有输入节点从单一的 `input-tensor -> volume` 模板，重构为由数据语义决定的输入视觉语法，解决 VGG16 左侧输入仍像固定模板的问题，同时覆盖序列、状态、向量和体数据输入。

## 非目标

- 不增加 `VGG16`、`LSTM`、`GRU` 等模型名称分支。
- 不修改网络拓扑推断规则，不凭空增加源码中不存在的层或循环边。
- 不替换现有 Visio 原生 Shape/Connector 与 Shape Data readback 契约。
- 不改变已有 feature-map、pooling、flatten、dense 的视觉语法。

## 设计

### 1. 输入语义推导

在 semantic visual grammar 层新增纯函数 `inputVisualGrammarForNode(node)`，只读取规范化 IR 的以下证据：

- `shape` 的 rank、空间维度和通道维度；
- `ports` 中的端口名称及其时间/状态含义；
- `label`、`op`、`subtitle` 中的 modality 词；
- `evidence` 与 `attributes` 中已确认的 modality 信息。

返回一个稳定的语义对象：

```js
{
  kind: "image-input" | "sequence-input" | "state-input" | "vector-input" | "volume-input" | "unknown-input",
  confidence: number,
  reason: string,
  channelCount: number | null,
  spatialSize: number | null,
  tensorRank: number | null
}
```

推导优先级如下：

1. 明确的 `attributes.modality` 或 evidence modality；
2. 明确的状态端口名称（`h`、`c`、`state`、`hidden`、`cell`）；
3. 序列/时间端口或 `sequence`、`token`、`time` 语义；
4. 3D/voxel/volume 语义或四维以上张量；
5. rank=3 且最后一维为 1/3/4 的图像候选；
6. rank=1/2 的 vector 候选；
7. `unknown-input`。

没有足够证据时返回 `unknown-input`，不把未知输入误判为图像或体数据。

### 2. Figure Plan 角色与几何

输入节点的 `visualRole` 拆分为：

- `image-input`：平面图像，显示 RGB/通道信息；
- `sequence-input`：横向 token/时间序列带；
- `state-input`：状态向量与反馈端口语义；
- `vector-input`：紧凑向量列；
- `volume-input`：立体 voxel 体；
- `unknown-input`：带不确定性标记的张量轮廓。

Figure Plan 必须携带：

- `inputGrammar`；
- `geometryData.tensorRank`、`channelCount`、`spatialSize`；
- `geometryData.modalityReason`；
- 原始 `sourceNodeId`、ports、evidence、confidence。

### 3. Browser 与 Visio 投影

两种渲染器只消费 Figure Plan 的 `visualRole` 和 `geometryData`：

- Browser 为每种输入角色选择不同的 SVG/native primitive；
- Visio 为每种输入角色选择对应的 PowerShell 原生绘制函数；
- 输入角色、源节点身份、端口和边身份在两种投影中必须一致。

VGG16 的 `224×224×3` 输入应得到 `image-input`，以图像平面和 RGB 通道语义呈现，而不是复用 feature-map 的体积堆叠。LSTM 的 `x` 与 `state` 应分别根据证据进入 sequence/state 语法；没有显式时间回写时不得添加 loop 边。

### 4. 验证标准

- VGG16 源码：输入为 `image-input`，第一层卷积仍为 `feature-map-stage`；Figure Plan 不含模型名判断。
- LSTM 源码：输入/状态节点不会被归类为 feature-map volume；显式 loop IR 的 loop route 与 source edge identity 保持不变。
- 3D 体数据：仍为 `volume-input`。
- 缺少 modality 证据的 rank=3 输入：不自动升级为 RGB image。
- Browser 与 Visio projection 对输入节点使用相同的 `sourceNodeId`、`visualRole`、`geometryData`。
- 真实 Visio 输出完成 VSDX readback、Glue readback 和 PNG 视觉检查。

## 文件边界

- 修改：`semantic-visual-grammar.mjs`、`universal-figure.mjs`、`visio-bridge.mjs`、`visio-bridge.ps1`、`app.js`（仅在现有浏览器渲染入口需要适配时）。
- 测试：对应 semantic grammar、Universal Figure、Visio bridge 与 browser renderer 测试。
- 不修改：`models.js`，不向生产分析链路引入模板注册表。

