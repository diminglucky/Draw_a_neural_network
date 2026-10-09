# Synapse Studio

Synapse Studio 是一个面向源码输入的神经网络架构编译器。它先把代码或模型描述解析成 Universal IR，再推导语义事实、生成 Scene 布局，最后通过 PowerShell/COM 写入 Microsoft Visio 原生 Shape、连接器和 Shape Data。

当前主分支为 `main`，生产服务只使用 `visio-diagram-plan/v1` 携带 `laid-out-neural-scene/v1`。Visio bridge 只接受 Scene-backed plan，旧 publication/DSL plan、`allowLegacyProjection` 和 legacy 布局模块已经移除。

## 当前链路

```text
源码 / IR / 配置 / ONNX / 图像
  -> 输入归一化
  -> Evidence Graph
  -> Universal IR
  -> Canonical Model Graph
  -> Neural Semantic Facts
  -> Projection Map
  -> Semantic Scene
  -> Rendering Profile + Scene Layout
  -> Visio Diagram Plan
  -> PowerShell / Visio COM
  -> Shape Data / Connector Glue 回读
```

网页只负责输入、配置、状态展示和模型工作区编辑。图形由确定性的编译器和 Visio bridge 生成。

## 环境要求

- Windows 10/11
- Node.js 20 或更高版本
- Python 3.10 或更高版本，PyTorch/Keras 源码分析需要
- Microsoft Visio，真实 `.vsdx` 写入和回读需要

开发和测试不强制启动 Visio；设置 `VISIO_DRY_RUN=1` 时可以只验证 Render Plan。

## 本地运行

```powershell
npm.cmd ci
node server.js
```

打开 `http://127.0.0.1:4173/`。

也可以运行 Electron：

```powershell
npm.cmd start
```

## 配置

### LLM

未配置 API Key 时，源码走本地 AST 分析；自然语言和图像分析会停止并提示配置模型。

```powershell
$env:LLM_BASE_URL = "https://api.deepseek.com/v1"
$env:LLM_API_KEY = "sk-..."
$env:LLM_MODEL = "deepseek-chat"
node server.js
```

也可以在前端设置面板中配置 OpenAI-compatible 端点，配置会持久化到本地 `llm-config.json`。

### Visio

前端需要填写 Visio 文档路径和页面名。路径可以是目录或 `.vsdx` 文件；目录会解析为 `model.vsdx`，文件不存在时会通过 `/api/visio-prepare` 创建。

### Dry Run

```powershell
$env:VISIO_DRY_RUN = "1"
node server.js
```

Dry Run 只生成并校验 Render Plan，不修改 Visio 文档。

## API

- `POST /api/agent-run`：源码、prompt、IR、配置、ONNX 或图像进入可恢复分析状态机。
- `POST /api/agent-run/:id/resume`：确认、修复、渲染结果和回读结果恢复。
- `POST /api/render-visio`：从输入重新分析并写入 Visio，不接受客户端伪造 Figure/Visio Plan。
- `POST /api/analyze-code`：同步规则分析入口，主要用于源码和 IR 调试。
- `POST /api/model-workspace/apply`：编辑模型工作区节点、边、可见性和坐标。
- `POST /api/model-workspace/plan`：重新规划编辑后的工作区。
- `GET /api/llm-config`、`POST /api/llm-config`、`POST /api/llm-models`：LLM 配置和模型列表。
- `POST /api/visio-prepare`：解析、创建并保存 Visio 文档配置。

## 验证

```powershell
npm.cmd test
npm.cmd run block:acceptance -- --list
npm.cmd run block:plan-audit
npm.cmd run scene:preview
```

当前测试覆盖输入边界、证据融合、Universal IR、Canonical Graph、语义事实、Scene 布局、Visio Plan、Shape Data、连接器回读、工作区编辑和 HTTP 路由。

有真实 Visio 环境时，可以逐个执行：

```powershell
npm.cmd run block:acceptance -- --fixture=mixed
npm.cmd run block:acceptance -- --fixture=graph
```

没有 Visio 时先跑 `block:plan-audit`。它会检查全部 fixture 的 Block IR、Scene 布局、QA 指标、预期模块和稳定 plan hash，并把审计结果写到 `artifacts/block-acceptance/<fixture>/`。

`scene:preview` 会把每个 fixture 的最终 laid-out Scene 渲染成纯 Node SVG，输出到 `artifacts/scene-preview/<fixture>/`。它不依赖 Visio，用于快速检查节点、标签、连接器、Block badge 和端口。

真实验收必须使用 Windows + Microsoft Visio + 实际 `.vsdx`，并检查：

- 新建或打开目标文档
- 写入原生 Shapes 和 Connectors
- 保存并重新打开
- 读取 `sourceNodeId`、`sourceEdgeId`、端点和 Glue
- 导出 PNG 进行人工视觉检查

## 构建

```powershell
npm.cmd run pack
```

输出位于 `dist/`。构建前请阅读 [docs/build.md](docs/build.md)，其中包含 Python、Visio、Electron 打包和已知风险。

## 目录

```text
server.js                         HTTP 与静态资源服务
agent-service.mjs                 服务编排、输入提取、Visio 执行
agent-pipeline.mjs                Universal IR 到 Scene / Visio Plan 的主编译器
agent-orchestrator.mjs            可恢复 inspect -> extract -> normalize -> plan 状态机
model-workspace.mjs               可编辑模型工作区和 IR 往返
torch-code-analyzer.mjs           PyTorch AST analyzer 调用
keras-code-analyzer.mjs           Keras AST analyzer 调用
shape-inference.mjs               张量形状传播
neural-semantic-facts.mjs         语义事实
neural-block-ir.mjs               论文模块聚合：Conv、Residual、Attention、FFN、Encoder/Decoder、Fusion、Head、Recurrent、MoE、GNN
block-acceptance-fixtures.mjs     共享验收矩阵：CNN、U-Net、Transformer、ViT、多模态、RNN、MoE、GNN、GAN/多头
neural-projection-map.mjs         节点、边和 Block 边界到可视对象的投影
semantic-neural-scene.mjs         语义 Scene
rendering-profile.mjs             布局约束和网络家族配置
neural-scene-layout.mjs           Scene 布局与拓扑 QA
scene-svg-renderer.mjs            纯 Node Scene -> SVG 预览渲染器
visio-diagram-plan.mjs            唯一 Visio Diagram Plan 契约
visio-bridge.mjs                  Render Plan、COM 执行、回读校验
visio-bridge.ps1                  Visio 原生对象绘制
```

## 当前边界

- PyTorch/Keras 源码输入是主要路径。
- `ModuleList` 的列表和常量 `range` 循环已支持展开；变量次数、条件分支、函数式调用和运行时生成结构仍可能漏层或错边。
- 精确覆盖这些模型需要接入 `torch.export`、torch.fx、Keras Model 遍历或 ONNX。
- 自然语言和 LLM 只能辅助理解，不能替代真实模型图证据。
- 当前安装包会把 analyzer 脚本复制到 `resources/tools`，但仍需要系统 Python 或通过 `PYTHON` 指向可用解释器。
- `Block IR` 当前为 `neural-block-ir/v2`，v0/v1 会在投影和 Scene 编译边界自动升级。
- `npm run block:acceptance -- --list` 可以列出真实 Visio 验收样本；没有 Visio 时只运行自动测试和 dry-run 契约，不把计划校验当作真实绘制验收。

文档索引见 [docs/README.md](docs/README.md)，后续计划见 [docs/roadmap.md](docs/roadmap.md)。
