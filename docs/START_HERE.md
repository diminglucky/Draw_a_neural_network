# 跨计算机开始

当前产品分支是 `agent`。在另一台机器上从仓库根目录开始：

```powershell
git fetch origin
git switch agent
git pull --ff-only
```

先阅读 [通用神经网络论文图编译 Agent 设计](superpowers/specs/2026-08-14-universal-neural-figure-compiler-design.md)，再修改代码或文档。

## 当前能力与禁止性声明

仓库已有认证、Draft、Network IR、确定性 preview、受限 Visio 协议，以及五个专用 grammar。五个 grammar 是针对已验证结构的专用策略，不是任意神经网络的通用支持；不得将五个 grammar 宣称为通用支持。

静态/协议/mock 测试、源代码实现和真实 Windows/Visio 的创建、保存、关闭、重开与 readback 验收是不同的门。前两者通过时，仍不得宣称已经完成真实 Visio 或顶刊图验收。

## 当前优先级

- P0：静态 PyTorch Source Analyzer、Evidence Graph 与 Architecture IR v3。
- P1：Figure Component contract、ComposableDagFigureCompiler 与 gold IR/反例。
- P2：论文版式/style tokens，以及缩放、灰度和人工视觉 benchmark。
- P3：FigurePlan 到 Visio native Shapes renderer 与真实 Windows/Visio readback 验收。
- P4：Keras/ONNX、草图真实视觉理解、Graph/Message Passing 等受控扩展。

不要让新 grammar、GNN/message passing 或新导出表结构越过 P0-P3 的前置门。

## 工作树纪律

先检查 `git status --short` 和 `git worktree list --porcelain`。保留其他工作树及当前工作树中不属于本任务的改动；不要使用 `git reset --hard`、`git clean`、广泛暂存或覆盖未关联文件。
