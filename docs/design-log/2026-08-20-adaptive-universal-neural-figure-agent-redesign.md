# 设计迁移日志：从家族 Grammar 门槛到未知网络直绘

**日期：** 2026-08-20
**影响规格：** `2026-08-20-adaptive-universal-neural-figure-agent-design.md`
**取代规格：** `2026-08-19-universal-neural-figure-agent-design.md`
**状态：** 已记录重新设计；等待用户审核。不是实现、测试、部署或真实 Visio 验收。

## 1. 重新设计的触发原因

旧规格虽然明确反对按模型名称绘图，但仍把 CNN、Residual、Encoder–Decoder、Transformer 和 General DAG 的 Figure Grammar 放在主绘图路径上。这会产生错误的产品行为：遇到一个从未见过的新网络时，系统可能因没有匹配的高级 Grammar 而把“专业绘制”退化为等待人工新增规则。

用户的实际目标是：大多数输入都是此前没有见过的新网络，但它们由主流网络的局部思想重新组合而成；Agent 必须根据提示、代码或草图直接绘制，并从新结构中受控学习更好的表达。

## 2. 取代的决策

| 旧决策 | 问题 | 新决策 |
|---|---|---|
| Figure Grammar 是绘制主入口 | 容易形成模型家族白名单 | Universal Visual Composer 是所有有效图的默认入口 |
| 未命中高级模式时以 General DAG 作为回退 | 回退容易被实现成低质量方框图 | General Publication Graph 是专业基线，不是失败回退 |
| 未知模块强调 unresolved | 容易把陌生名称与未知拓扑混为一谈 | 未知模块直接用 CustomOperator 绘制；只有未知拓扑进入 candidate |
| 黄金样例以 VGG/ResNet/U-Net/ViT 为中心 | 容易驱动模型模板覆盖率 | 零模板未知网络案例是主要验收，主流模型只作为模式回归样例 |
| 新模式通过实现新 renderer 分支获得支持 | 维护成本随模型数量线性增长 | 新组合先形成 owner-scoped PatternCandidate，再受控提升到声明式 PatternLibrary |

## 3. 保留的决策

下列边界不因重新设计而放松：

- 不执行用户代码；
- Evidence、来源和不确定性必须可追溯；
- 无法证明的动态拓扑不允许伪造或正式导出；
- 浏览器、LLM、原始草图和代码不能直接控制 Worker/COM；
- preview、Snapshot、export、owner/device、idempotency、checkpoint、readback 和同画布 applyDiff 仍是必要的长期稳定合同；
- VGG16 bridge 仍是 legacy 夹具，不是通用路径。

## 4. 路线图影响

当前路线图 M2.5 保持为正式焦点，但其实现必须绑定通用 UGS/Presentation/Figure Plan，而不是固定 VGG 图。后续开发按新规格的 R0–R5 执行：先恢复当前回归，再实现通用结构与通用绘制，随后扩展学习和输入适配器，最后完成真实 Visio 验收。

此日志不改变任何 milestone 的 accepted/planned 状态；状态变化只能在实现、测试、文档和独立审查证据齐全后更新 `docs/agent-program-state.json`。
