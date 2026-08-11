# Synapse Studio 商业基础平台设计

## 状态

- 目标：先实现可收费产品的基础平台，再接入 OpenAI Agent 和 Visio 绘制。
- 范围：Windows 客户端骨架、云端认证、设备注册、单账号单机在线会话、订阅权益、管理员后台、监控审计、Job 和后续适配器接口。
- 本阶段明确不实现：OpenAI 真实分析、代码/截图语义解析、Visio COM、pywin32、自动布局和真实绘图。

## 1. 产品目标

软件必须联网完成登录、订阅和设备授权后，才允许进入主工作区。未授权时，聊天、Agent、代码上传、截图上传和 Visio 操作全部锁定。

同一用户账号同一时间只能拥有一个有效设备会话。新设备不能静默抢占旧设备；管理员可以查看设备、查看会话、强制下线和解除设备绑定。

第一阶段的验收重点是商业平台闭环：

```text
启动客户端 → 联网登录 → 设备授权 → 会话租约 → 主界面解锁
             → 心跳维持 → 管理员监控 → 强制下线 → 客户端锁定
```

## 2. 架构边界

```text
Windows Desktop Client
  ├── 登录与授权 UI
  ├── 设备身份模块
  ├── 会话心跳
  ├── 当前项目 UI
  └── Agent/Visio 占位状态

Cloud API
  ├── Auth
  ├── Users
  ├── Devices
  ├── Sessions
  ├── Plans/Subscriptions/Entitlements
  ├── Jobs
  ├── Admin
  └── Audit/Health

Future adapters
  ├── AgentProvider → OpenAI Responses API
  └── VisioExecutor → local Visio Bridge/COM
```

客户端不保存服务端授权真相，不保存模型 API Key，不执行任意 Python、COM、Shell 或 VBA。服务端负责身份、订阅、会话和权限；客户端负责展示并调用受限 API。

## 3. 技术选择

- Desktop：Electron，原因是当前项目为原生 JavaScript，能以较低迁移成本获得 Windows 主进程和安全存储能力。
- API：Node.js + TypeScript；先模块化单体，避免第一阶段过早拆分微服务。
- HTTP：Fastify 或同等具备 schema 校验的 Node API 框架。
- Schema：TypeScript 类型 + Zod/AJV；共享契约放在 `packages/contracts`。
- Database：PostgreSQL，保存用户、设备、订阅、Job、审计和管理员数据。
- Lease/Rate limit：Redis，用于单账号活动会话锁、心跳租约和限流。
- Password：Argon2id；Access Token 短期有效，Refresh Token 仅保存服务端哈希。
- Local device secret：Electron 主进程使用 Windows 安全存储能力保存设备私钥；渲染进程不能直接读取。
- Agent/Visio：本阶段只定义接口和占位实现，不引入 OpenAI Key 或 Visio COM 依赖。

## 4. 身份、设备和会话

### 用户

字段包括：`id`、`email`、`passwordHash`、`status`、`createdAt`、`lastLoginAt`。

### 设备

第一次启动时，客户端生成设备密钥对。私钥留在 Windows 安全存储，公钥注册到服务端。服务端生成随机 `deviceId`，并保存经过盐化哈希的机器指纹摘要。

设备认证采用：

```text
device private-key signature
+ server deviceId
+ fingerprint hash risk signal
+ user session
```

机器码不是唯一安全凭证，不保存原始硬件序列号，不在管理员页面展示原始硬件信息。

### 单机在线租约

- 客户端每 20～30 秒发送心跳。
- 服务端活动租约约 90 秒过期。
- 同一个用户只能有一个 `ACTIVE` 会话。
- 新设备登录时，如果旧设备租约有效，返回 `ACCOUNT_ALREADY_IN_USE`。
- 管理员可以撤销旧会话；客户端收到撤销结果后立即锁定主界面。
- 失去网络后不能创建新聊天、Agent 或 Job。

数据库和 Redis 都要参与并发控制，不能只依赖一次普通查询。

## 5. 订阅和权益

第一阶段不接真实支付，但创建完整的数据模型：`plans`、`subscriptions`、`entitlements`、`usageRecords`。

权益以服务端结果为准，例如：

```json
{
  "plan": "professional",
  "features": ["chat", "code-analysis", "image-analysis", "visio-export"],
  "limits": { "analysisJobsPerMonth": 100, "maxNodes": 100 }
}
```

管理员可以创建试用、调整计划、调整额度和冻结账号。支付平台通过后续 adapter 接入，不影响授权核心。

## 6. 管理员后台

管理员后台独立于普通用户客户端，第一阶段默认一个 Owner 账号，但数据模型预留 RBAC：`Owner`、`Administrator`、`Support`、`Finance`、`Auditor`。

页面模块：

1. Dashboard：用户、订阅、在线设备、会话冲突、Job、错误和系统健康。
2. Users：查询用户、冻结/恢复、查看订阅和当前设备。
3. Devices：查看设备摘要、最后心跳、撤销、解绑和重置。
4. Sessions：查看活动会话、强制下线和撤销。
5. Plans/Subscriptions：计划、试用和权益。
6. Jobs：通用 Job 列表、状态、错误和耗时。
7. Audit Logs：管理员和用户关键行为。
8. Health：API、数据库、Redis 和后台任务状态。

管理员操作必须写审计日志，并支持原因字段。

## 7. Job 与后续适配器

通用 Job 状态：

```text
queued → running → succeeded
                 ↘ failed
                 ↘ cancelled
                 ↘ expired
```

预留 Job 类型：`chat`、`code-analysis`、`image-analysis`、`visio-export`。

适配器接口：

```ts
interface AgentProvider {
  chat(input: ChatInput): Promise<ChatResult>;
  analyzeCode(input: CodeAnalysisInput): Promise<AnalysisResult>;
  analyzeImage(input: ImageAnalysisInput): Promise<AnalysisResult>;
}

interface VisioExecutor {
  healthCheck(): Promise<HealthResult>;
  createDocument(input: CreateDocumentInput): Promise<JobResult>;
  executeDiagram(input: DiagramExecutionInput): Promise<JobResult>;
  readback(input: ReadbackInput): Promise<ReadbackResult>;
}
```

本阶段使用 `NotConfiguredAgentProvider` 和 `NotConnectedVisioExecutor`，返回稳定错误码而不是模拟成功。

## 8. 错误和安全

统一错误格式：

```json
{
  "error": {
    "code": "ACCOUNT_ALREADY_IN_USE",
    "message": "该账号已在其他设备上使用。",
    "requestId": "req-001",
    "retryable": false
  }
}
```

必须覆盖：网络断开、Token 过期、订阅过期、设备撤销、会话冲突、心跳超时、权限不足、Job 不存在和占位功能未配置。

安全约束：

- OpenAI Key、支付密钥和授权签名私钥只在服务端。
- Electron 使用 `contextIsolation`，禁用渲染进程 Node 能力。
- 客户端不决定 `isPro`、额度和管理员权限。
- 设备私钥不进入渲染进程或日志。
- 原始机器序列号不进入管理员 UI。
- 管理员使用独立认证和 MFA 扩展点。
- 关键操作带审计日志。

## 9. 第一阶段不包含

- OpenAI 真实调用。
- 代码和截图语义解析。
- 神经网络 IR 生成和高级布局。
- Visio COM、pywin32 和真实 `.vsdx` 绘制。
- 自动支付接入。
- 多管理员完整权限运营体系，只保留 RBAC 数据结构和 Owner 主流程。

## 10. 验收标准

1. 用户可以注册、登录、退出和刷新会话。
2. 未授权用户无法进入主工作区。
3. 客户端可以注册并复用 Windows 设备身份。
4. 同一账号在第二台设备上不能同时建立有效会话。
5. 心跳租约过期后客户端回到锁定状态。
6. 管理员可以查看用户、设备和会话。
7. 管理员可以强制下线用户。
8. 被撤销的会话不能继续创建业务请求。
9. 订阅、计划和权益可由管理员管理。
10. Job 可以创建、查询、取消并记录失败状态。
11. Agent 和 Visio 占位适配器返回明确的未配置错误。
12. 登录、设备、会话、订阅和管理员操作均有审计记录。
13. API、数据库和 Redis 健康状态可在后台查看。
14. 基础测试覆盖认证、单机会话、心跳过期、强制下线和权限边界。

## 11. 后续扩展

第一阶段完成后，再按顺序接入：

```text
OpenAI Responses API
  → Structured Outputs
  → neural-network IR
  → SVG preview
  → local Visio Bridge
  → COM/Shape Data
  → readback validation
```

以上扩展不得破坏现有 Auth、Device、Session、Entitlement、Job 和 Audit 契约。
