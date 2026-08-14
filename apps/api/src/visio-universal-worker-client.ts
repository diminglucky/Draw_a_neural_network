import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { ApiErrorCode, FoundationError } from "./domain.js";
import {
  UNIVERSAL_VISIO_PROTOCOL_VERSION,
  parseUniversalVisioWorkerRequest,
  parseUniversalVisioWorkerResponse,
  verifySealedPlan,
  type SealedPlanBinding,
  type SealedPlanEnvelope,
  type UniversalVisioWorkerResponse,
  type UniversalVisioWorkerSuccessResponse,
} from "./visio-universal-protocol.js";

export interface UniversalVisioWorkerClientOptions {
  workerPath: string;
  workerArgs?: string[];
  mode: "mock" | "live";
  sealedPlanSecret: string;
  timeoutMs?: number;
  now?: () => Date;
}
export interface ExecuteSealedPlanInput {
  sealedPlan: SealedPlanEnvelope;
  binding: SealedPlanBinding;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class UniversalVisioWorkerClient {
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: UniversalVisioWorkerClientOptions) {
    if (!options.workerPath.trim()) throw new Error("Universal Visio Worker path is required");
    if (!options.sealedPlanSecret.trim()) throw new Error("Universal Visio Worker sealed plan secret is required");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("Universal Visio Worker timeout must be a positive safe integer");
  }

  async executeSealedPlan(input: ExecuteSealedPlanInput, options: { signal?: AbortSignal } = {}): Promise<UniversalVisioWorkerSuccessResponse> {
    verifySealedPlan(input.sealedPlan, input.binding, this.options.sealedPlanSecret, this.now());
    const request = parseUniversalVisioWorkerRequest({
      protocolVersion: UNIVERSAL_VISIO_PROTOCOL_VERSION,
      requestId: `request-${randomUUID()}`,
      jobId: input.binding.jobId,
      mode: this.options.mode,
      sealedPlan: input.sealedPlan,
    });
    const response = await this.runWorker(request, options.signal);
    if (response.status === "failed") {
      throw new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Universal Visio Worker rejected the sealed plan", 502, { jobId: request.jobId });
    }
    return response;
  }

  private runWorker(request: ReturnType<typeof parseUniversalVisioWorkerRequest>, signal?: AbortSignal): Promise<UniversalVisioWorkerResponse> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.workerPath, [...(this.options.workerArgs ?? []), "--mode", this.options.mode], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let abortListener: (() => void) | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        if (abortListener && signal) signal.removeEventListener("abort", abortListener);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const succeed = (response: UniversalVisioWorkerResponse) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      };
      const timer = setTimeout(() => {
        fail(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Universal Visio Worker timed out", 504, { reason: "timeout", jobId: request.jobId, timeoutMs: this.timeoutMs }));
        child.kill();
      }, this.timeoutMs);
      abortListener = () => {
        fail(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Universal Visio Worker was cancelled", 499, { reason: "cancelled", jobId: request.jobId }));
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
      child.once("error", (error) => fail(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Universal Visio Worker could not be started", 502, { cause: error.message, jobId: request.jobId })));
      child.stdin.once("error", (error) => fail(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Universal Visio Worker input could not be written", 502, { cause: error.message, jobId: request.jobId })));
      child.once("close", (code) => {
        if (settled) return;
        const line = stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
        if (!line) {
          fail(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Universal Visio Worker returned no response", 502, { exitCode: code, stderr: stderr.trim().slice(0, 2_000), jobId: request.jobId }));
          return;
        }
        let response: UniversalVisioWorkerResponse;
        try {
          response = parseUniversalVisioWorkerResponse(JSON.parse(line));
        } catch (error) {
          fail(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Universal Visio Worker returned an invalid response", 502, { cause: error instanceof Error ? error.message : String(error), jobId: request.jobId }));
          return;
        }
        if (response.requestId !== request.requestId || response.jobId !== request.jobId) {
          fail(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Universal Visio Worker response identity did not match the request", 502, { requestId: request.requestId, responseRequestId: response.requestId, jobId: request.jobId, responseJobId: response.jobId }));
          return;
        }
        if (code !== 0 && response.status !== "failed") {
          fail(new FoundationError(ApiErrorCode.VISIO_EXECUTION_FAILED, "Universal Visio Worker exited unsuccessfully", 502, { exitCode: code, jobId: request.jobId }));
          return;
        }
        succeed(response);
      });
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
}
