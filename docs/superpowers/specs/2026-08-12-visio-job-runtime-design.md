# Visio Job Runtime Stability Design

## Goal

把当前已验证的 Agent → Visio 导出链路升级为可恢复、可取消、可观测的异步 Job 运行时，同时保持现有认证、用户所有权、幂等和 Worker/COM 隔离边界。

## Scope

本阶段只处理 Visio export Job 的运行时稳定性：异步提交、状态轮询、取消、Worker 超时与异常退出、API 重启后的 stale Job 恢复、前端状态恢复和对应验收测试。

本阶段不实现持续保持 Visio 窗口的 interactive mode、VSTO/Add-in、高级 stencil、签名安装包、自动更新或计费系统。

## Architecture

```text
Authenticated POST /api/visio/export
  -> validate diagram and Idempotency-Key
  -> atomically create or reuse a user-owned Job
  -> return 202 queued (new) or 200 existing (replay)
  -> VisioJobRunner starts one Worker process for the Job
  -> Worker owns all Visio COM access on one STA thread
  -> validated output/readback is persisted as succeeded
  -> client polls GET /api/jobs/:id
```

`VisioJobRunner` is an API-side orchestration boundary. Routes do not own child-process handles, COM state, timeout timers, or cancellation races. The runner maintains one active process per Job and removes it on every terminal path.

The existing `VisioWorkerClient` remains the process/protocol adapter. It gains an abortable execution method used by the runner; the JSON-lines protocol and output-root policy remain unchanged.

## Job state rules

```text
queued -> running -> succeeded
                 -> failed
                 -> cancelled
                 -> expired
queued -> cancelled
queued -> expired
```

- A repeated idempotency key never creates a second Job or starts a second Worker.
- A queued Job can be cancelled before process launch.
- A running Job cancellation terminates only its own Worker process.
- A Worker timeout fails the Job with `VISIO_EXECUTION_FAILED` and records a timeout reason.
- A Worker non-zero exit, invalid response, identity mismatch, missing output, or invalid readback fails the Job.
- On API startup, Jobs left in `running` are marked `expired` because their previous per-Job Worker cannot be safely assumed to exist.
- A terminal Job is immutable from the public cancellation route.

## HTTP contract

### Submit

`POST /api/visio/export` remains authenticated and requires `Idempotency-Key`.

- New Job: HTTP `202` with the queued Job and `pollUrl`.
- Same key and same request hash: HTTP `200` with the existing Job.
- Same key and different request hash: HTTP `409 VISIO_IDEMPOTENCY_KEY_REUSED`.
- Invalid diagram, missing authorization, missing key, or forbidden `outputPath` retain existing error codes.

### Status

`GET /api/jobs/:id` remains user-scoped. It returns the complete current Job, including `output` only after successful readback.

### Cancellation

`POST /api/jobs/:id/cancel` remains user-scoped. It returns the cancelled Job for a successful cancellation and `409 JOB_NOT_CANCELLABLE` for terminal Jobs.

## Frontend behavior

The Visio button creates one idempotency key per user submission, displays `queued` and `running`, polls the Job endpoint with bounded backoff, and stops on `succeeded`, `failed`, `cancelled`, or `expired`. A visible cancel action is available while the Job is queued or running. Reloading the page does not restart the Worker; a stored in-memory view can resume polling a known Job id.

## Observability and safety

- Audit records retain `job.created`, `job.started`, `job.succeeded`, `job.failed`, and `job.cancelled` transitions.
- Error metadata contains status, Worker exit/timeout reason, and Job id, but not diagram contents or credentials.
- Worker process handles, timers, and cancellation callbacks are cleaned up on success, failure, cancellation, timeout, and API close.
- Only the server-created output path under the configured root is passed to the Worker.
- No Visio COM object crosses the Node process boundary.

## Verification

The implementation must add tests for:

1. asynchronous `202` submit and status polling;
2. repeated idempotency key with no duplicate Worker invocation;
3. queued cancellation;
4. running cancellation and child termination;
5. timeout and non-zero Worker failure;
6. startup recovery of stale running Jobs;
7. frontend polling, cancellation, and terminal-state rendering;
8. mock Worker smoke and the existing live COM/API route smoke.

The existing synchronous live acceptance remains valid as a Worker-level smoke. The new API acceptance additionally proves that the asynchronous Job state reaches `succeeded` and that a repeated submission reuses the same Job.
