# 跨计算机开始

## Verified P0.0 capability

The accepted v3 entry point is authenticated static-linear PyTorch analysis. It accepts a bounded source descriptor, produces evidence-backed Architecture IR v3, and does not execute user Python. Dynamic control flow and unsupported forward structures return a candidate structure with a blocking question; they do not create a preview, PlanSnapshot, export token, Worker job, or Visio output.

The current authoritative design is [2026-08-17-universal-compiler-repair-and-migration-design.md](superpowers/specs/2026-08-17-universal-compiler-repair-and-migration-design.md). P0.0 is deliberately narrower than universal figure generation. Figure Components, publication preview, real Windows/Visio save-close-reopen/readback, Keras/ONNX, image understanding, and GNN remain unaccepted milestones.

当前产品分支是 `agent`。在另一台机器上从仓库根目录开始：

```powershell
git fetch origin
git switch agent
git pull --ff-only
npm ci
npm run agent:status
```

`docs/agent-program-state.json` 是当前产品状态的唯一账本，`docs/ROADMAP.md` 是由它生成的只读视图。开始实现前先查看 `agent:status` 的 current focus、依赖和 blocker；完成节点后必须更新证据并运行 `npm run agent:verify-roadmap`。

先阅读 [通用编译器修复与迁移设计](superpowers/specs/2026-08-17-universal-compiler-repair-and-migration-design.md)，再修改代码或文档；2026-08-14 设计仅作为历史背景，不再作为当前实现依据。

## 当前能力与禁止性声明

仓库已有认证、Draft、Network IR、确定性 preview、受限 Visio 协议，以及五个专用 grammar。五个 grammar 是针对已验证结构的专用策略，不是任意神经网络的通用支持；不得将五个 grammar 宣称为通用支持。

静态/协议/mock 测试、源代码实现和真实 Windows/Visio 的创建、保存、关闭、重开与 readback 验收是不同的门。前两者通过时，仍不得宣称已经完成真实 Visio 或顶刊图验收。

静态 PyTorch Source Analyzer 的 P0 支持范围仅限于已声明的 `nn.*` 模块、单一 `forward(self, value)` 定义、可证明的单变量线性 `self.<module>(value)` 调用链及显式返回。纯局部字面量注释变量可以忽略；其它未识别语句、分支、Add/Concat、模块复用、重复声明、shape 推断、重复结构、Keras/ONNX，以及图像理解均不受支持，并以带源码定位的阻断性 unresolved 拒绝猜测图结构。

## 当前优先级

- P0：静态 PyTorch Source Analyzer、Evidence Graph 与 Architecture IR v3。
- P1：Figure Component contract、ComposableDagFigureCompiler 与 gold IR/反例。
- P2：论文版式/style tokens，以及缩放、灰度和人工视觉 benchmark。
- P3：FigurePlan 到 Visio native Shapes renderer 与真实 Windows/Visio readback 验收。
- P4：Keras/ONNX、草图真实视觉理解、Graph/Message Passing 等受控扩展。

不要让新 grammar、GNN/message passing 或新导出表结构越过 P0-P3 的前置门。

## 工作树纪律

先检查 `git status --short` 和 `git worktree list --porcelain`。保留其他工作树及当前工作树中不属于本任务的改动；不要使用 `git reset --hard`、`git clean`、广泛暂存或覆盖未关联文件。
