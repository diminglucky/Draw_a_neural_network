import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
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

export interface VisioWorkerClientOptions {
  workerPath: string;
  workerArgs?: string[];
  outputRoot: string;
  mode: "mock" | "live";
  timeoutMs?: number;
  visible?: boolean;
  attachToRunning?: boolean;
}

interface NormalizedFigurePlan {
  version: 1;
  coordinateSpace: Record<string, unknown>;
  primitiveGroups: Array<Record<string, unknown>>;
  connectors: Array<Record<string, unknown>>;
}

type NormalizedVisioDiagram = VisioWorkerRequest["diagram"] & {
  figurePlan?: NormalizedFigurePlan;
};

const DEFAULT_TIMEOUT_MS = 120_000;

export class VisioWorkerClient implements VisioExecutor {
  private readonly workerArgs: string[];
  private readonly timeoutMs: number;
  private readonly outputRoot: string;

  constructor(private readonly options: VisioWorkerClientOptions) {
    if (!options.workerPath.trim()) throw new Error("Visio Worker path is required");
    if (!options.outputRoot.trim()) throw new Error("Visio output root is required");
    this.workerArgs = options.workerArgs ?? [];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.outputRoot = path.resolve(options.outputRoot);
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Visio Worker timeout must be a positive safe integer");
    }
  }

  async healthCheck(): Promise<VisioHealthResult> {
    try {
      await access(this.options.workerPath);
      return { connected: true };
    } catch {
      return { connected: false, reason: ApiErrorCode.VISIO_EXECUTION_FAILED };
    }
  }

  async executeDiagram(input: { jobId: string; diagram?: unknown }, options: { signal?: AbortSignal } = {}): Promise<{ path: string; readback: VisioReadback }> {
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
  if (plan.version !== 1 || !groups) {
    throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "figurePlan must use version 1 with primitiveGroups", 400, { field: "diagram.figurePlan" });
  }
  return {
    version: 1,
    coordinateSpace: coordinateSpace as Record<string, unknown>,
    primitiveGroups: groups.map(asRecord),
    connectors: (Array.isArray(plan.connectors) ? plan.connectors : []).map(asRecord),
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
