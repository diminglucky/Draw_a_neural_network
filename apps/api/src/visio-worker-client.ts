import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ApiErrorCode, FoundationError } from "./domain.js";
import type { VisioExecutor, VisioHealthResult } from "./adapters.js";
import type { VisioReadback } from "./visio-readback.js";
import {
  VISIO_PROTOCOL_VERSION,
  parseVisioWorkerResponse,
  type VisioWorkerRequest,
  type VisioWorkerResponse,
} from "./visio-protocol.js";
import {
  parseVisioSessionCommand,
  parseVisioSessionResponse,
  type TrustedVisioSessionIdentity,
  type VisioSessionCommand,
  type VisioSessionResponse,
} from "./visio-session-protocol.js";

export interface VisioWorkerClientOptions {
  workerPath: string;
  workerArgs?: string[];
  outputRoot: string;
  mode: "mock" | "live";
  timeoutMs?: number;
  visible?: boolean;
  attachToRunning?: boolean;
  maxPersistentSessions?: number;
}

interface NormalizedFigurePlan {
  coordinateSpace: Record<string, unknown>;
  primitiveGroups: Array<Record<string, unknown>>;
  connectors: Array<Record<string, unknown>>;
  labels: Array<Record<string, unknown>>;
}

type NormalizedVisioDiagram = VisioWorkerRequest["diagram"] & {
  figurePlan?: NormalizedFigurePlan;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_PERSISTENT_SESSIONS = 16;
const DEFAULT_TENANT_ID = "synapse-local";
const MAX_SESSION_STDIO_BYTES = 64 * 1024;
const SESSION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

interface PendingSessionResponse { resolve(response: VisioSessionResponse): void; reject(error: FoundationError): void; timer: ReturnType<typeof setTimeout>; abortListener?: () => void; }
interface PersistentSession {
  key: string;
  identity: TrustedVisioSessionIdentity;
  outputPath: string;
  child: ChildProcessWithoutNullStreams;
  pending: Map<string, PendingSessionResponse>;
  queue: Promise<void>;
  opened: boolean;
  hasBaseline: boolean;
  ending: boolean;
  broken?: FoundationError;
  stdout: string;
  stderr: string;
  closed: Promise<void>;
  resolveClosed(): void;
}

export class VisioWorkerClient implements VisioExecutor {
  private readonly workerArgs: string[];
  private readonly timeoutMs: number;
  private readonly outputRoot: string;
  private readonly maxPersistentSessions: number;
  private readonly sessions = new Map<string, PersistentSession>();

  constructor(private readonly options: VisioWorkerClientOptions) {
    if (!options.workerPath.trim()) throw new Error("Visio Worker path is required");
    if (!options.outputRoot.trim()) throw new Error("Visio output root is required");
    this.workerArgs = options.workerArgs ?? [];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxPersistentSessions = options.maxPersistentSessions ?? DEFAULT_MAX_PERSISTENT_SESSIONS;
    this.outputRoot = path.resolve(options.outputRoot);
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Visio Worker timeout must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.maxPersistentSessions) || this.maxPersistentSessions <= 0) throw new Error("Visio persistent session limit must be a positive safe integer");
  }

  async healthCheck(): Promise<VisioHealthResult> {
    try {
      await access(this.options.workerPath);
      return { connected: true };
    } catch {
      return { connected: false, reason: ApiErrorCode.VISIO_EXECUTION_FAILED };
    }
  }

  async executeDiagram(input: { jobId: string; diagram?: unknown; userId?: string; deviceId?: string; workflowId?: string; operation?: "apply" | "applyDiff" }, options: { signal?: AbortSignal } = {}): Promise<{ path: string; readback: VisioReadback }> {
    if (this.options.mode === "live" && this.options.visible === true) return this.executePersistent(input, options.signal);
    return this.executeOneShot(input, options);
  }

  async closeSession(input: { userId: string; deviceId: string; workflowId: string }): Promise<void> {
    const identity = this.identityFor(input);
    const session = this.sessions.get(this.sessionKey(identity));
    if (!session) return;
    await this.enqueue(session, async () => {
      this.requireHealthy(session);
      const response = await this.send(session, { protocolVersion: 2, requestId: randomUUID(), command: "close", session: identity, closeDisposition: "save" });
      this.requireSuccess(response, "close");
      session.ending = true;
      session.child.stdin.end();
      await Promise.race([session.closed, new Promise<void>((_resolve, reject) => setTimeout(() => { const error = new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker did not exit after close", 504); this.breakSession(session, error.message, error.details, error.statusCode); reject(error); }, this.timeoutMs))]);
      this.requireHealthy(session);
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map((session) => this.closeSession(session.identity)));
  }

  private async executeOneShot(input: { jobId: string; diagram?: unknown }, options: { signal?: AbortSignal } = {}): Promise<{ path: string; readback: VisioReadback }> {
    if (!input.diagram) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "A diagram is required for Visio export", 400, { field: "diagram" });
    }

    const outputPath = path.join(this.outputRoot, `${input.jobId}.vsdx`);
    const request: VisioWorkerRequest = {
      protocolVersion: VISIO_PROTOCOL_VERSION,
      requestId: randomUUID(),
      jobId: input.jobId,
      mode: this.options.mode,
      outputPath,
      diagram: normalizeVisioDiagram(input.diagram),
    };
    const response = await this.runWorker(request, options.signal);

    if (response.status === "failed") {
      const workerError = response.error;
      if (!workerError) throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker failed without an error", 502, { jobId: input.jobId });
      throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, workerError.message, 502, {
        workerCode: workerError.code,
        jobId: input.jobId,
      });
    }

    const responsePath = response.path;
    const responseReadback = response.readback;
    if (!responsePath || !responseReadback) {
      throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker returned an incomplete success response", 502, { jobId: input.jobId });
    }
    await assertRegularFile(outputPath);
    await assertRegularFile(responsePath);
    const [expectedPath, actualPath] = await Promise.all([realpath(outputPath), realpath(responsePath)]);
    if (!equivalentPath(expectedPath, actualPath)) {
      throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker returned an unexpected output path", 502, {
        expectedPath,
        actualPath,
      });
    }
    if (!responseReadback.valid) {
      throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker returned an invalid readback", 502, { jobId: input.jobId });
    }
    return { path: responsePath, readback: responseReadback };
  }

  async readback(input: { path: string }): Promise<VisioReadback> {
    throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Standalone readback must be returned by executeDiagram", 501, { path: input.path });
  }

  private async executePersistent(input: { jobId: string; diagram?: unknown; userId?: string; deviceId?: string; workflowId?: string; operation?: "apply" | "applyDiff" }, signal?: AbortSignal): Promise<{ path: string; readback: VisioReadback }> {
    if (!input.diagram) throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "A diagram is required for Visio export", 400, { field: "diagram" });
    const identity = this.identityFor(input);
    const command = input.operation ?? "apply";
    const existing = this.sessions.get(this.sessionKey(identity));
    if (!existing && command !== "apply") {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "The first visible Visio operation must be apply", 400);
    }
    if (existing && !existing.hasBaseline && command !== "apply") {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "The first visible Visio operation must be apply", 400);
    }
    if (existing?.hasBaseline && command !== "applyDiff") {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "A visible Visio revision must use applyDiff", 400);
    }
    const session = existing ?? this.getOrCreateSession(identity);
    return this.enqueue(session, async () => {
      this.requireHealthy(session);
      if (!session.hasBaseline && command !== "apply") throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "The first visible Visio operation must be apply", 400);
      if (session.hasBaseline && command !== "applyDiff") throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "A visible Visio revision must use applyDiff", 400);
      if (!session.opened) {
        this.requireSuccess(await this.send(session, { protocolVersion: 2, requestId: randomUUID(), command: "open", session: identity, outputPath: session.outputPath }, signal), "open");
        session.opened = true;
      }
      const applied = await this.send(session, parseVisioSessionCommand({ protocolVersion: 2, requestId: randomUUID(), command, session: identity, operationId: input.jobId, diagram: normalizeVisioDiagram(input.diagram) }), signal);
      this.requireSuccess(applied, command);
      if (!applied.readback?.valid) throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker returned no valid native readback", 502, { jobId: input.jobId, command });
      this.requireSuccess(await this.send(session, { protocolVersion: 2, requestId: randomUUID(), command: "save", session: identity, outputPath: session.outputPath }, signal), "save");
      await this.assertPersistentOutput(session.outputPath, applied.outputPath, input.jobId);
      session.hasBaseline = true;
      return { path: session.outputPath, readback: applied.readback };
    });
  }

  private identityFor(input: { userId?: string; deviceId?: string; workflowId?: string }): TrustedVisioSessionIdentity {
    if (!input.userId || !input.deviceId || !input.workflowId) throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Visible Visio export requires a server-derived user, device, and workflow identity", 400);
    const identity = { tenantId: DEFAULT_TENANT_ID, userId: input.userId, deviceId: input.deviceId, workflowId: input.workflowId };
    if (Object.values(identity).some((value) => value.length > 128 || !SESSION_IDENTIFIER.test(value))) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Visible Visio export identity is invalid", 400);
    }
    return identity;
  }

  private sessionKey(identity: TrustedVisioSessionIdentity): string { return `${identity.tenantId}\u001f${identity.userId}\u001f${identity.deviceId}\u001f${identity.workflowId}`; }

  private getOrCreateSession(identity: TrustedVisioSessionIdentity): PersistentSession {
    const key = this.sessionKey(identity);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    if (this.sessions.size >= this.maxPersistentSessions) throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio persistent session limit has been reached", 503);
    const child = spawn(this.options.workerPath, buildVisioWorkerArguments({ workerArgs: this.workerArgs, mode: this.options.mode, outputRoot: this.outputRoot, visible: this.options.visible, attachToRunning: this.options.attachToRunning }), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let resolveClosed!: () => void;
    const session: PersistentSession = { key, identity, outputPath: path.join(this.outputRoot, `${identity.workflowId}.vsdx`), child, pending: new Map(), queue: Promise.resolve(), opened: false, hasBaseline: false, ending: false, stdout: "", stderr: "", closed: new Promise((resolve) => { resolveClosed = resolve; }), resolveClosed };
    this.sessions.set(key, session);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receiveStdout(session, chunk));
    child.stderr.on("data", (chunk: string) => { session.stderr = (session.stderr + chunk).slice(-MAX_SESSION_STDIO_BYTES); });
    child.once("error", (error) => this.breakSession(session, "Visio Worker could not be started", { cause: error.message }));
    child.stdin.on("error", (error) => this.breakSession(session, "Visio Worker input could not be written", { cause: error.message }));
    child.once("close", (code) => {
      if (!session.ending || code !== 0 || session.broken) {
        const error = session.broken ?? new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker session ended unexpectedly", 502, { exitCode: code, stderr: session.stderr.trim().slice(0, 2000) });
        this.breakSession(session, error.message, error.details);
      }
      session.resolveClosed();
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    });
    return session;
  }

  private receiveStdout(session: PersistentSession, chunk: string): void {
    session.stdout += chunk;
    if (session.stdout.length > MAX_SESSION_STDIO_BYTES) return this.breakSession(session, "Visio Worker session exceeded the stdout limit");
    let newline: number;
    while ((newline = session.stdout.indexOf("\n")) >= 0) {
      const line = session.stdout.slice(0, newline).trim();
      session.stdout = session.stdout.slice(newline + 1);
      if (!line) continue;
      let response: VisioSessionResponse;
      try { response = parseVisioSessionResponse(JSON.parse(line)); }
      catch (error) { return this.breakSession(session, "Visio Worker returned an invalid session response", { cause: error instanceof Error ? error.message : String(error) }); }
      const pending = session.pending.get(response.requestId);
      if (!pending) return this.breakSession(session, "Visio Worker returned an unknown session response", { responseRequestId: response.requestId });
      session.pending.delete(response.requestId);
      clearTimeout(pending.timer);
      pending.resolve(response);
    }
  }

  private send(session: PersistentSession, command: VisioSessionCommand, signal?: AbortSignal): Promise<VisioSessionResponse> {
    this.requireHealthy(session);
    if (signal?.aborted) {
      const error = new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker was cancelled", 499, { reason: "cancelled" });
      this.breakSession(session, error.message, error.details);
      throw error;
    }
    return new Promise((resolve, reject) => {
      const rejectWith = (error: FoundationError) => { const pending = session.pending.get(command.requestId); if (!pending) return; session.pending.delete(command.requestId); clearTimeout(pending.timer); if (pending.abortListener) signal?.removeEventListener("abort", pending.abortListener); reject(error); };
      const timer = setTimeout(() => { const error = new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker session command timed out", 504, { requestId: command.requestId, timeoutMs: this.timeoutMs }); rejectWith(error); this.breakSession(session, error.message, error.details); }, this.timeoutMs);
      const abortListener = () => { const error = new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker was cancelled", 499, { reason: "cancelled" }); rejectWith(error); this.breakSession(session, error.message, error.details); };
      signal?.addEventListener("abort", abortListener, { once: true });
      session.pending.set(command.requestId, { resolve: (response) => { if (abortListener) signal?.removeEventListener("abort", abortListener); resolve(response); }, reject, timer, abortListener });
      session.child.stdin.write(`${JSON.stringify(command)}\n`, (error) => { if (error) this.breakSession(session, "Visio Worker input could not be written", { cause: error.message }); });
    });
  }

  private requireSuccess(response: VisioSessionResponse, command: string): void {
    if (response.status === "failed") throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, response.error ?? "Visio Worker session command failed", 502, { command });
  }

  private requireHealthy(session: PersistentSession): void { if (session.broken) throw session.broken; }

  private breakSession(session: PersistentSession, message: string, details: Record<string, unknown> = {}, statusCode = 502): void {
    if (session.broken) return;
    const error = new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, message, statusCode, details);
    session.broken = error;
    for (const pending of session.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    session.pending.clear();
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
    if (!session.child.killed) session.child.kill();
  }

  private enqueue<T>(session: PersistentSession, work: () => Promise<T>): Promise<T> {
    const next = session.queue.then(work).catch((error: unknown) => {
      const validationFailure = error instanceof FoundationError && error.code === ApiErrorCode.VALIDATION_FAILED;
      if (!session.broken && !validationFailure) this.breakSession(session, "Visio Worker session command failed", { cause: error instanceof Error ? error.message : String(error) });
      throw error;
    });
    session.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async assertPersistentOutput(expectedPath: string, responsePath: string | undefined, jobId: string): Promise<void> {
    if (!responsePath) throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker returned no output path", 502, { jobId });
    await assertRegularFile(expectedPath);
    await assertRegularFile(responsePath);
    const [expected, actual] = await Promise.all([realpath(expectedPath), realpath(responsePath)]);
    if (!equivalentPath(expected, actual)) throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker returned an unexpected output path", 502, { expectedPath: expected, actualPath: actual });
  }



  private runWorker(request: VisioWorkerRequest, signal?: AbortSignal): Promise<VisioWorkerResponse> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.workerPath, buildVisioWorkerArguments({
        workerArgs: this.workerArgs,
        mode: this.options.mode,
        outputRoot: this.outputRoot,
        visible: this.options.visible,
        attachToRunning: this.options.attachToRunning,
      }), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let abortListener: (() => void) | undefined;

      const cleanup = () => {
        clearTimeout(timer);
        if (abortListener && signal) signal.removeEventListener("abort", abortListener);
      };
      const finishReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finishResolve = (response: VisioWorkerResponse) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      };
      const timer = setTimeout(() => {
        finishReject(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker timed out", 504, {
          reason: "timeout",
          timeoutMs: this.timeoutMs,
          jobId: request.jobId,
        }));
        child.kill();
      }, this.timeoutMs);

      abortListener = () => {
        finishReject(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker was cancelled", 499, {
          reason: "cancelled",
          jobId: request.jobId,
        }));
        child.kill();
      };
      if (signal?.aborted) {
        abortListener();
        return;
      }
      signal?.addEventListener("abort", abortListener, { once: true });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", (error) => {
        finishReject(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker could not be started", 502, {
          cause: error.message,
          jobId: request.jobId,
        }));
      });
      child.stdin.once("error", (error) => {
        finishReject(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker input could not be written", 502, {
          cause: error.message,
          jobId: request.jobId,
        }));
      });
      child.once("close", (code) => {
        if (settled) return;
        const line = stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
        if (!line) {
          finishReject(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker returned no response", 502, {
            exitCode: code,
            stderr: stderr.trim().slice(0, 2000),
            jobId: request.jobId,
          }));
          return;
        }
        let response: VisioWorkerResponse;
        try {
          response = parseVisioWorkerResponse(JSON.parse(line));
        } catch (error) {
          finishReject(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker returned an invalid response", 502, {
            cause: error instanceof Error ? error.message : String(error),
            exitCode: code,
            jobId: request.jobId,
          }));
          return;
        }
        if (response.requestId !== request.requestId || response.jobId !== request.jobId) {
          finishReject(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker response identity did not match the request", 502, {
            requestId: request.requestId,
            responseRequestId: response.requestId,
            jobId: request.jobId,
            responseJobId: response.jobId,
          }));
          return;
        }
        if (code !== 0) {
          if (response.status === "failed") finishResolve(response);
          else finishReject(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker exited unsuccessfully", 502, { exitCode: code, jobId: request.jobId }));
          return;
        }
        finishResolve(response);
      });

      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
}

export function buildVisioWorkerArguments(options: {
  workerArgs?: string[];
  mode: "mock" | "live";
  outputRoot: string;
  visible?: boolean;
  attachToRunning?: boolean;
}): string[] {
  return [
    ...(options.workerArgs ?? []),
    "--mode", options.mode,
    "--output-root", options.outputRoot,
    ...(options.visible ? ["--visible"] : []),
    ...(options.attachToRunning ? ["--attach-to-running"] : []),
  ];
}

export function normalizeVisioDiagram(value: unknown): NormalizedVisioDiagram {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "diagram must be an object", 400, { field: "diagram" });
  }
  const source = value as Record<string, unknown>;
  const figure = source.figure && typeof source.figure === "object" && !Array.isArray(source.figure)
    ? source.figure as Record<string, unknown>
    : {};
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const edges = Array.isArray(source.edges) ? source.edges : [];
  const figurePlan = normalizeFigurePlan(source.figurePlan);
  return {
    figure: {
      ...figure,
      stageLabels: Array.isArray(figure.stageLabels)
        ? figure.stageLabels
        : Array.isArray(figure.stages) ? figure.stages : [],
    },
    nodes: nodes.map((value) => {
      const node = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      return {
        id: node.id,
        kind: node.kind ?? node.type ?? "node",
        label: node.label ?? node.id ?? "Node",
        subtitle: node.subtitle ?? "",
        stage: node.stage ?? 0,
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? node.w ?? 1,
        height: node.height ?? node.h ?? 1,
        tensorShape: node.tensorShape ?? node.subtitle ?? "",
        visualRole: node.visualRole ?? "standard",
        layerRole: node.layerRole ?? "network-node",
        repeatCount: node.repeatCount ?? 1,
        depth: node.depth ?? 1,
        perspective: node.perspective ?? false,
        color: node.color ?? null,
      };
    }),
    edges: edges.map((value) => {
      const edge = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const route = edge.route && typeof edge.route === "object" && !Array.isArray(edge.route) ? edge.route as Record<string, unknown> : {};
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: edge.kind ?? edge.type ?? "signal",
        points: Array.isArray(edge.points) ? edge.points : Array.isArray(route.points) ? route.points : [],
      };
    }),
    ...(figurePlan ? { figurePlan } : {}),
  };
}

function normalizeFigurePlan(value: unknown): NormalizedFigurePlan | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "figurePlan must be an object", 400, { field: "diagram.figurePlan" });
  }
  const plan = value as Record<string, unknown>;
  const coordinateSpace = plan.coordinateSpace;
  if (!coordinateSpace || typeof coordinateSpace !== "object" || Array.isArray(coordinateSpace)) {
    throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "figurePlan.coordinateSpace must be an object", 400, { field: "diagram.figurePlan.coordinateSpace" });
  }
  const groups = Array.isArray(plan.primitiveGroups) ? plan.primitiveGroups : null;
  if ((plan.version !== undefined && plan.version !== 1) || !groups) {
    throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "figurePlan must use the Worker v1 structure with primitiveGroups", 400, { field: "diagram.figurePlan" });
  }
  return {
    coordinateSpace: coordinateSpace as Record<string, unknown>,
    primitiveGroups: groups.map(asRecord),
    connectors: (Array.isArray(plan.connectors) ? plan.connectors : []).map(asRecord),
    labels: (Array.isArray(plan.labels) ? plan.labels : []).map(asRecord),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function assertRegularFile(filePath: string): Promise<void> {
  try {
    await access(filePath);
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error("output path is not a regular file");
  } catch (error) {
    throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Visio Worker output file was not found", 502, {
      path: filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function equivalentPath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
