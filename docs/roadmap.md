# 项目路线

> 状态：Active  
> 目标版本：`0.4+`  
> 最后更新：2026-10-09

## 目标

项目要解决的是：用户提供 PyTorch、Keras/TensorFlow 或其他模型代码时，能够生成正确、可编辑、接近论文级别的网络架构图。

当前实现已经打通源码 -> Universal IR -> Scene -> Visio 的基础链路，但“任意代码都准确”和“顶刊级视觉”仍未完成。

## 已完成：Scene-only 收口

- 删除 `allowLegacyProjection`
- 删除 `universal-publication-figure/v1` 接受逻辑
- 删除只服务 legacy plan 的 `planOuterShapes` / `planConnectors`
- 删除旧 Visio layout/detail/port-routing 模块
- 删除 PowerShell legacy shape dispatcher 和旧测试
- README、构建文档和测试表述统一为 Scene-only
- 工作区 `ui` 坐标进入 Scene 布局
- Python analyzer 脚本在打包后从 `resources/tools` 加载
- PyTorch `ModuleList` 列表/常量 range 循环展开
- Keras Sequential 内部 Input 去重

## 第一优先级：模型图准确性

### 1. ONNX 与 PyTorch 导出

新增准确的模型图输入路径：

- ONNX 文件直接解析
- `torch.export`
- `torch.fx`
- TorchScript

要求输出节点、边、输入输出形状、算子属性和层级信息，不能只得到扁平算子列表。

### 2. Keras 模型遍历

支持：

- `keras.Model`
- Functional Graph
- Sequential
- 多输入多输出
- `_inbound_nodes` / `_outbound_nodes`

需要修复当前 Keras Sequential 额外生成重复 Input 和 unresolved Input 的问题。

### 3. 隔离运行源码

对于只提供代码的场景，增加可选“精确模式”：

- 单独进程
- 临时工作目录
- 无网络
- 超时和资源限制
- 不继承密钥
- 只返回结构化模型图

如果没有隔离环境，不让任意用户代码进入主服务进程。

### 4. 证据合并

结构证据优先级：

1. ONNX / torch.export / Keras Model
2. 源码 AST
3. 配置文件
4. LLM 解释
5. 模型名称

低优先级证据只能补充标签和解释，不能覆盖真实图。

## 第二优先级：模块语义与网络家族

`Block IR` 当前为 `neural-block-ir/v2`，自动升级 v0/v1，当前覆盖：

- ConvBlock
- ResidualBlock
- AttentionBlock
- FFN
- EncoderStage
- DecoderStage
- MultiScaleFusion
- DetectionHead
- RecurrentCell
- MoEBlock
- GraphBlock / GNN message passing
- block entry/exit ports
- balanced projection 按 Block IR 聚合投影边界
- block projection 不跨显式 group/container，并拒绝双向环折叠
- blockKind 驱动 Scene primitive 尺寸
- EncoderStage / DecoderStage 自动 U 形列布局
- AttentionBlock / FFN Transformer 垂直堆叠
- MultiScaleFusion / MoE 输入分支 Lane 对齐
- Block badge 和 layout hint 写入 Visio Shape Data，并绘制原生文字标记
- Block entry/exit ports 写入 Visio Shape Data
- Block entry/exit ports 绘制为原生 Visio 端口标记
- Connector 优先 Glue 到 block port marker，端口缺失时回退到 Block shape
- Scene validation 检查 connector 是否引用了不存在的 block port anchor
- BlockKind 驱动 Visio 填充色和线色 style profile
- 连续相同算子聚合为 repeat-block，并生成 xN badge
- `full` 保留逐节点细节，`balanced` 才按 Block IR 聚合
- Residual / Recurrent / MoE / Graph Block overlay 绘制结构提示
- 手动 workspaceUi 节点默认阻止所在 Block 折叠
- ResidualBlock 保留公共起点在 Block 外，避免隐藏真实残差边
- `balanced` 模式支持 `expandBlockKinds` 指定展开某些 Block
- Scene / Agent 输出 blockSummary，统计 blockKind、端口、badge、overlay 覆盖
- RecurrentCell 回线优先 Glue 到 state port marker
- MoE overlay 输出 router / experts N 分区标签
- Workspace 支持 Block 展开/折叠/锁定，并通过 blockOverrides 进入 Projection
- Block lock 时自动折叠 expanded 状态
- Block badge/port QA metrics 与 warning diagnostics
- ResidualBlock bypass route clearance 扩大
- Block lock/expand 冲突诊断
- Block QA threshold 可配置
- Block IR v0/v1 legacy schema 自动升级与迁移诊断
- workspace 展示视觉 QA 摘要
- Block acceptance matrix 覆盖 sequential CNN、residual、encoder-decoder、transformer、ViT、多模态、recurrent、repeat、MoE、GNN、GAN/多头
- workspace 回写视觉诊断和 Block 冲突状态
- repeat-block expanded override 端到端恢复验证
- Residual bypass 根据顶部空间自动选择 bottom/top corridor
- Workspace Block 操作后自动 replan，并保留 Block IR
- Scene/Projection/视觉 QA 诊断回写 workspace
- 新增 `npm run block:acceptance` 真实 Visio/PNG 验收脚本
- Block entry/exit port mappings 保留 edge 到 node/port 的对应关系
- MIMO Block 端口唯一化，Scene 使用 block port id 生成 anchor，原始 edge port 保留校验
- Workspace 操作自动 replan 并刷新 QA
- MIMO block endpoint ids 通过 Render Plan 进入 connector Glue 回归
- Workspace QA 诊断可点击定位 node/primitive/relation
- Block acceptance script 支持 `--list`、`--fixture=<name>` 和 `--fixture=all` 并写 audit JSON
- plan-only audit 覆盖全部 fixture，校验 Block IR、Scene、QA、预期模块和稳定 plan hash
- 纯 Node Scene -> SVG 预览器覆盖全部 fixture，用于无 Visio 环境检查最终布局
- MoE 只在存在 router / expert / conditional 证据时聚合，不再把普通 fan-in 误判为 MoE
- GNN message-passing block 使用独立 layout hint、badge、颜色和原生节点链路 overlay

后续继续完善 Block 内部端口、折叠绘制和布局约束。

新增 `Block IR`，把底层算子聚合成论文图中的模块：

- ConvBlock
- ResidualBlock
- EncoderStage
- Bottleneck
- DecoderStage
- AttentionBlock
- FFN
- RecurrentCell
- MultiScaleFusion
- DetectionHead
- MoE router 和 experts
- GNN message passing 节点和消息链路

布局按结构自动选择，不按模型名硬编码：

| 家族 | 布局 |
| --- | --- |
| Sequential CNN | 左到右 Tensor Flow |
| Residual CNN | 主路径 + 残差 Lane |
| Encoder-Decoder | U 形镜像布局 |
| Transformer | 垂直 Block、AddNorm、`xN` |
| RNN/LSTM/GRU | 时间展开或状态折叠 |
| YOLO/FPN | 多尺度 Pyramid Lane |
| GNN | 节点消息传递图 |
| 多模态 | 多输入流 + Cross-Attention |

## 第三优先级：顶刊视觉语法

当前 Scene 已具备 form、primitive、connector 和 label 契约，接下来需要：

- 独立张量体积、平面、序列、状态和图的视觉语法
- 残差、skip、state、conditional 的固定线型和 Lane
- 重复模块折叠为 `xN`
- 标签槽位和自动避让
- 图例只保留语义类别
- 灰度打印仍可区分
- 页面、边距和字体按论文两栏宽度输出

## 第四优先级：编辑与预览

工作区需要做到：

- 网页预览和最终 Visio 使用同一个 Scene
- 节点拖动、分组、隐藏和标签修改可以进入最终 Render Plan
- 写入前显示结构 QA 和视觉 QA
- 支持导出 SVG/TikZ/PDF 作为投稿矢量格式
- Visio 作为可编辑交付格式

工作区 `ui` 坐标已经进入 Scene 布局；仍需继续完善分组容器自动重算和手动排布后的视觉 QA。

## 第五优先级：动态结构

专项处理：

- `nn.ModuleList`
- `for block in self.blocks`
- `nn.Sequential(*layers)`
- 条件分支
- 多分支 concat/add
- 动态 shape
- 自定义模块和第三方算子

无法解析时不能伪造，应生成 unresolved 边界并请求补充 ONNX、入口或输入 shape。

## 验收矩阵

至少覆盖：

- VGG16
- ResNet18/50 残差块
- U-Net
- Transformer Encoder/Decoder
- LSTM/GRU 分类器
- YOLO/FPN 多尺度头
- GNN 消息传递
- 多输入多输出 Keras Functional
- MoE router / expert
- GAN / 多输出头

每个样本都必须验证：

- 节点数
- 边数
- 分支和 merge
- skip/residual
- 输入输出 shape
- 重复块数量
- Visio Shape Data
- 连接器 Glue
- PNG 人工视觉复核

## 完成定义

项目达到可用状态需要同时满足：

- 真实模型图准确率可测
- 常见网络家族有专用布局
- 论文级矢量输出稳定
- 未解析结构不会伪造
- 干净机器安装后源码分析可用
- 真实 Visio 保存重开回读通过
- 自动测试、dry run 和真实 Visio 验收分别有明确证据
