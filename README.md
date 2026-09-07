# Draw_a_neural_network

这是一个以 Microsoft Visio 为唯一绘图后端的神经网络架构 Agent。所有最终图形都通过 PowerShell/COM 写入已有 `.vsdx`，生成原生 Shape、连接器和 Shape Data，并执行回读校验。

## 主链路

```text
源码 / 图像 / IR
    -> 证据提取
    -> Universal IR
    -> 语义图形语法
    -> Figure Plan
    -> Visio PowerShell/COM
    -> 原生 Shape / Connector / Shape Data
    -> 回读验证
```

网页只负责输入、参数、状态和 Visio 执行控制，不生成或保存网络图形。

## 快速开始

```bash
node server.js
```

打开 `http://127.0.0.1:4173/`，填写已有 Visio 文档路径和页面名称，然后提交源码或参考图像。

## 能力

- PyTorch 与 Keras/TensorFlow 源码拓扑提取。
- `forward()` 顺序、Sequential 展开、分支、合并、跳连和符号形状传播。
- 自定义模块的源码内部拓扑证据；没有证据时保留 unresolved 状态。
- 图像视觉分析接入统一 IR 边界；没有视觉能力时不会猜测固定网络。
- 卷积特征图、池化、向量化、全连接、注意力、循环状态、循环边、体数据和复合模块的语义几何。
- 稳定的 sourceNodeId/sourceEdgeId、端口、连接器胶合关系和 Shape Data 回读。
- 现有文档内的 Agent 管理范围同步，不创建隐式空白文档。

## API

- `POST /api/analyze-code`：源码或 IR 分析。
- `POST /api/render-visio`：将 Figure Plan 写入已有 Visio 文档。
- `POST /api/agent-run`：可恢复的完整 Agent 运行。

核心状态为 `ready_for_preview`、`needs_confirmation`、`needs_external_vision` 和 `invalid_input`。未确认的结构不会被伪造或静默展开。

## 关键文件

```text
index.html                     输入与 Visio 控制面
app.js                         输入、状态和 Visio 执行
server.js                      HTTP 服务与 Agent API
agent-pipeline.mjs             统一分析入口
agent-orchestrator.mjs         可恢复运行状态机
input-adapters.mjs             输入归一化
evidence-graph.mjs             证据图
universal-ir.mjs               通用 IR 归一化与校验
semantic-visual-grammar.mjs    语义视觉角色与输入语法
universal-figure.mjs           拓扑驱动的 Figure Plan 几何
figure-plan.mjs                Figure Plan 契约与校验
visio-client.mjs               Visio 请求边界
visio-bridge.mjs               Visio 计划、COM 执行和回读校验
visio-bridge.ps1               原生 Visio Shape/Connector bridge
```

## 验证

```bash
node --test
```

测试覆盖 IR、证据、语义图形、循环网络、Visio 计划、Shape Data、连接器端点、运行恢复和 HTTP 边界。真实 Visio 验收仍需要 Windows 上已安装并可自动化的 Microsoft Visio，以及一个明确存在的 `.vsdx` 文档。
