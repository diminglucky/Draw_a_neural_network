# Agent 治理资产

本目录帮助项目回答“现在做到什么程度、依据什么设计、验证是否可信、下一步是什么”。

## 快速入口

1. 先运行 `npm run agent:status -- --strict`，读取唯一当前状态：`docs/agent-program-state.json`；
2. 再查看当前实现记录：[current-roadmap.md](implementation-records/current-roadmap.md)；
3. 查看与该工作对应的设计基线；
4. 最后查看当月操作历史中最新的关键事件。

| 目录 | 内容 | 规则 |
|---|---|---|
| `design-baselines/` | 不可变的设计、路线图和验证边界快照 | 新增替代，不回写 |
| `implementation-records/` | 每个 gate 的实际实现、验证、阻塞和下一步 | 追加事实，不改写既有结论 |
| `operation-history/` | 用户可理解的追加式 JSONL 关键事件 | 只追加 |

完整合同见 [Agent 开发治理、操作历史与可追溯性设计](../superpowers/specs/2026-08-20-agent-governance-traceability-design.md)。
