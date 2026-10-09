# 构建与发布

> 状态：Active  
> 适用版本：`0.3.x`  
> 最后验证：2026-10-09
> 验证范围：Node 单元测试、PowerShell 静态检查、Scene dry run 契约、Block 验收 fixture 清单

## 目标

这份文档说明当前源码如何构建、测试和打包，以及发布前必须验证的外部依赖。

## 运行时

### Node.js

项目使用 ESM、`fetch`、`AbortSignal.timeout` 和 `structuredClone`。开发环境建议 Node.js 20 LTS 或更高版本。

```powershell
npm.cmd ci
```

### Python

PyTorch 和 Keras 源码分析通过 Python AST 脚本完成：

- `tools/torch_source_analyzer.py`
- `tools/keras_source_analyzer.py`

Node 侧调用方式是 `spawn("python", [scriptPath])`。因此：

- 系统 PATH 中必须有可执行的 `python`
- 仅安装 `py` launcher 不足以满足当前实现
- 安装包用户机器必须预装 Python，或者项目必须改为携带 Python、内置解释器或纯 JS parser

`electron-builder` 会把 `tools/*.py` 复制到 `resources/tools`，Node 在 `.asar` 环境中从 resources 解析脚本路径，外部 Python 不再需要读取 asar 内部文件。

当前仍然需要目标机器安装 Python 3.10+，或在 `PYTHON` 环境变量中指定解释器路径。安装包尚未内置 Python 运行时。

### Microsoft Visio

真实写入要求：

- Windows
- 已安装可自动化的 Microsoft Visio
- PowerShell 可调用 COM
- 目标 `.vsdx` 存在且可写

只验证编译计划时可以不安装或启动 Visio：

```powershell
$env:VISIO_DRY_RUN = "1"
npm.cmd test
```

## 测试

```powershell
npm.cmd test
```

完整测试包含 Node 单元测试和 PowerShell 脚本静态检查。当前生产服务和 Visio bridge 已经收口为 Scene 路径，旧 publication/DSL 模块、legacy projection、旧布局模块和对应测试已经删除。

当前自动测试包含 `neural-block-ir/v2` 迁移、Block 投影、Scene 布局、SVG 预览、Shape Data、连接器 Glue、ViT、多模态、GNN、MoE、多头/GAN 等验收矩阵。最新结果为 415 tests passed。

没有 Visio 时，先运行 plan-only 审计：

```powershell
npm.cmd run block:plan-audit
```

该命令会逐个执行 `mixed`、`residual`、`repeat`、`transformer`、`encoder-decoder`、`recurrent`、`moe`、`graph`、`vit`、`multimodal`、`dual-head`，校验：

- `readyForVisio`
- `visioDiagramPlanValidation`
- `neural-block-ir/v2` validation
- 预期 BlockKind 是否存在
- 是否存在 error diagnostics
- Scene primitive、connector、group 和 visualQuality 指标
- 稳定 plan hash

输出位于 `artifacts/block-acceptance/<fixture>/block-acceptance-<fixture>.plan.audit.json`。它不替代真实 Visio 绘制验收。

还可以生成纯 Node SVG 预览：

```powershell
npm.cmd run scene:preview
```

输出位于 `artifacts/scene-preview/<fixture>/`。该预览直接读取最终 laid-out Scene，包含 body、decoration、connector route class、Block badge 和 port anchor，用于在无 Visio 环境下检查布局。

Block 验收样本可以直接列出：

```powershell
npm.cmd run block:acceptance -- --list
```

逐个执行真实 Visio 验收时会写入 `artifacts/block-acceptance/<fixture>/`：

```powershell
npm.cmd run block:acceptance -- --fixture=mixed
npm.cmd run block:acceptance -- --fixture=graph
```

每个样本会生成 `.vsdx`、`.png` 和 `.audit.json`。没有 Microsoft Visio 或 COM 自动化环境时，不要执行该命令来代替自动测试；计划校验通过不等于真实文档绘制通过。

真实 Visio 验收不属于普通单元测试，必须在 Windows 上单独执行：

1. 创建或选择一个实际 `.vsdx`
2. 通过 `/api/visio-prepare` 保存文档配置
3. 通过 `/api/render-visio` 执行真实写入
4. 检查返回状态不是 `dry_run`
5. 保存并关闭文档
6. 重新打开并读取 Shape Data
7. 验证 `sourceNodeId`、`sourceEdgeId`、连接器 Glue 和页面范围
8. 导出 PNG 做人工视觉检查

## Electron 打包

```powershell
npm.cmd run pack
```

主要输出：

- `dist/Synapse Studio Setup <version>.exe`
- `dist/latest.yml`

历史上已验证 `npm.cmd run pack` 成功，并确认 `resources/tools/torch_source_analyzer.py` 与 `resources/tools/keras_source_analyzer.py` 被复制到 `dist/win-unpacked/resources/tools`。当前阶段以代码设计、自动测试和 Scene/Block 契约为主，不要求重新打包。

`package.json` 当前配置：

- `files` 包含项目文件并排除测试、临时产物和文档
- `extraResources` 复制 `visio-bridge.ps1` 和 `visio-create-empty.ps1`
- Windows target 为 NSIS

发布前必须补做：

- 决定是否内置 Python 运行时，或继续将系统 Python 作为安装前置条件
- 在干净 Windows 机器安装后测试源码分析
- 在干净 Visio 环境测试创建、写入、保存、重开和回读
- 确认 `llm-config.json` 不会进入安装包

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `PORT` | HTTP 端口，默认 `4173` |
| `LLM_BASE_URL` | OpenAI-compatible Base URL |
| `LLM_API_KEY` | LLM API Key |
| `LLM_MODEL` | LLM 模型名 |
| `VISIO_DRY_RUN` | 设为 `1` 时只生成 Render Plan |
| `VISIO_WORKER` | 设为 `1` 时使用持久 Visio worker |
| `VISIO_BRIDGE_SCRIPT` | 指定自定义 Visio bridge 脚本 |
| `VISIO_CREATE_SCRIPT` | 指定创建空 Visio 文档的脚本 |

## 发布门禁

以下条件全部满足才可标记为可发布：

- `npm test` 全通过
- PowerShell 脚本语法检查通过
- 当前提交重新生成安装包
- 干净机器上源码分析可用
- 真实 Visio 写入、保存、重开、回读可用
- PNG 导出无节点重叠、连接器穿框、标签丢失
- README、构建文档和 roadmap 与代码一致
