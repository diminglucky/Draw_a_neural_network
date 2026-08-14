import { describe, expect, it } from "vitest";
import { resolveVisioWorkerPath } from "../src/visio-discovery.js";

describe("Visio Worker discovery", () => {
  it("prefers an explicit executable path when it exists", () => {
    expect(resolveVisioWorkerPath({
      explicitPath: "C:\\tools\\VisioWorker.Host.exe",
      exists: (value) => value === "C:\\tools\\VisioWorker.Host.exe",
    })).toBe("C:\\tools\\VisioWorker.Host.exe");
  });

  it("finds a development build before falling back to no Worker", () => {
    expect(resolveVisioWorkerPath({
      cwd: "C:\\repo",
      exists: (value) => value === "C:\\repo\\workers\\visio-worker\\src\\VisioWorker.Host\\bin\\Release\\net8.0-windows\\VisioWorker.Host.exe",
    })).toBe("C:\\repo\\workers\\visio-worker\\src\\VisioWorker.Host\\bin\\Release\\net8.0-windows\\VisioWorker.Host.exe");
    expect(resolveVisioWorkerPath({ cwd: "C:\\repo", exists: () => false })).toBeUndefined();
  });
});
