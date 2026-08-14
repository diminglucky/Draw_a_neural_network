import { join } from "node:path";
import { existsSync } from "node:fs";

export interface VisioWorkerDiscoveryOptions {
  explicitPath?: string;
  cwd?: string;
  resourcesPath?: string;
  exists?: (path: string) => boolean;
}

export function resolveVisioWorkerPath(options: VisioWorkerDiscoveryOptions = {}): string | undefined {
  const exists = options.exists ?? existsSync;
  const candidates = [
    options.explicitPath,
    options.resourcesPath ? join(options.resourcesPath, "visio-worker", "VisioWorker.Host.exe") : undefined,
    options.cwd ? join(options.cwd, "workers", "visio-worker", "src", "VisioWorker.Host", "bin", "Release", "net8.0-windows", "VisioWorker.Host.exe") : undefined,
    options.cwd ? join(options.cwd, "workers", "visio-worker", "src", "VisioWorker.Host", "bin", "Debug", "net8.0-windows", "VisioWorker.Host.exe") : undefined,
  ];
  return candidates.find((candidate) => typeof candidate === "string" && candidate.trim() && exists(candidate));
}
