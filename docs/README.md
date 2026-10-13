# 文档索引

本文档目录只保留当前有效资料和研究快照。

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| `README.md` | Active | 项目入口、运行方式、当前链路和边界 |
| `docs/build.md` | Active | 构建、测试、打包和发布门禁 |
| `docs/roadmap.md` | Active | 后续架构、准确性和视觉路线 |
| `docs/figure-quality-plan.md` | Active | 顶刊架构图规范对照、差距分析与处理计划 |
| `docs/research/top-journal-neural-figure-grammar-2023-2025.md` | Snapshot | 论文视觉语法研究，不是实现契约 |

## 维护规则

- Active 文档必须描述当前代码，不写未来能力为已完成能力。
- Snapshot 文档可以保留旧思路，但必须明确标注状态和适用范围。
- 删除旧计划前，先把仍然有效的约束迁移到 Active 文档。
- 每次修改生产链、构建方式或验收边界时，同步更新 README、构建文档和 roadmap。

## 当前验证

最后验证时间：2026-10-10

- `npm.cmd test`：431 tests passed
- 关键 JavaScript 文件通过 `node --check`
- `visio-bridge.ps1` 通过 PowerShell parser
- `git diff --check` 通过
- `npm.cmd run block:acceptance -- --list` 可列出真实 Visio 验收样本
- `npm.cmd run block:plan-audit`：11/11 fixture plan-only 审计通过，并生成 `artifacts/block-acceptance/<fixture>/*.plan.audit.json`
- `npm.cmd run scene:preview`：11/11 fixture 生成 `artifacts/scene-preview/<fixture>/*.svg`
- `npm.cmd run scene:showcase`：13 个主流/顶刊参考架构生成 `artifacts/showcase/<model>/*.svg`
- `npm.cmd run onnx:draw`：`artifacts/onnx/` 下 3 个真实结构 × 3 档投影，SVG + Visio Plan + summary
- `node tools/module-gallery.mjs`：`artifacts/module-gallery/modules.svg`，12 种图元形态按真实尺寸单独渲染，用于肉眼复核模块绘制

本轮没有执行打包。真实 Visio 写入、保存、重开、回读和 PNG 视觉验收仍未执行；`block:acceptance` 脚本只生成计划、验收清单和 audit JSON，Visio 环境缺失时不会把计划校验当成真实绘制通过。

**已知未达标项**：`docs/figure-quality-plan.md` 第二节实测显示，当前出图在 Nature 双栏（183 mm）下最小字号仅 3.34 pt，低于 5 pt 下限；单栏下 1.63 pt。渲染器尚无 `targetWidth`（mm）概念，无法保证字号合规。对照报告见 `artifacts/journal-spec/index.html`。
