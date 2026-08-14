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
});
