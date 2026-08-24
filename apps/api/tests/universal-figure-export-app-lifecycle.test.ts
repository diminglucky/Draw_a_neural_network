import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("Universal figure export application lifecycle", () => {
  it("recovers injected Universal Jobs when the API becomes ready and closes the runner with the API", async () => {
    let recoverCalls = 0;
    let closeCalls = 0;
    const runner = {
      submit: async (_jobId: string) => {},
      recoverJobs: async () => { recoverCalls += 1; },
      close: async () => { closeCalls += 1; },
    };
    const app = buildApp({ universalFigureExportRunner: runner } as never);

    await app.ready();
    expect(recoverCalls).toBe(1);
    await app.close();
    expect(closeCalls).toBe(1);
  });

  it("recovers non-terminal Drawing Runs when the API becomes ready", async () => {
    let recoverCalls = 0;
    const drawingRunCoordinator = {
      start: async () => { throw new Error("unused"); },
      acceptInput: async () => { throw new Error("unused"); },
      resume: async () => { throw new Error("unused"); },
      answerClarification: async () => { throw new Error("unused"); },
      bindExistingPage: async () => { throw new Error("unused"); },
      requestApply: async () => { throw new Error("unused"); },
      cancel: async () => { throw new Error("unused"); },
      recover: async () => { recoverCalls += 1; },
      get: async () => null,
    };
    const app = buildApp({ drawingRunCoordinator } as never);

    await app.ready();
    expect(recoverCalls).toBe(1);
    await app.close();
  });

  it("rejects partial Drawing workflow dependency injection", () => {
    expect(() => buildApp({ privateReceiptStore: {} as never })).toThrow(/complete set/i);
  });
});
