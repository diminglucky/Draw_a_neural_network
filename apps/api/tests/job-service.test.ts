import { describe, expect, it } from "vitest";
import { ApiErrorCode } from "../src/domain.js";
import { NotConfiguredAgentProvider, NotConnectedVisioExecutor } from "../src/adapters.js";
import { JobService } from "../src/job-service.js";
import { InMemoryFoundationStore } from "../src/store.js";

describe("job service and adapter boundaries", () => {
  it("tracks a job from queued to running to succeeded", async () => {
    const service = new JobService({ store: new InMemoryFoundationStore() });
    const created = await service.create({ userId: "user-1", deviceId: "device-1", type: "chat", input: { message: "hello" } });

    expect(created.status).toBe("queued");
    expect((await service.start(created.id)).status).toBe("running");
    expect((await service.succeed(created.id, { text: "ready" })).status).toBe("succeeded");
    expect((await service.get(created.id))?.output).toEqual({ text: "ready" });
  });

  it("records failure and allows queued jobs to be cancelled", async () => {
    const service = new JobService({ store: new InMemoryFoundationStore() });
    const failed = await service.create({ userId: "user-1", deviceId: "device-1", type: "image-analysis", input: {} });
    const cancelled = await service.create({ userId: "user-1", deviceId: "device-1", type: "visio-export", input: {} });

    expect((await service.fail(failed.id, ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent is not configured")).status).toBe("failed");
    expect((await service.cancel(cancelled.id)).status).toBe("cancelled");
  });

  it("does not pretend that unavailable integrations succeeded", async () => {
    const agent = new NotConfiguredAgentProvider();
    const visio = new NotConnectedVisioExecutor();

    await expect(agent.chat({ message: "hello" })).rejects.toMatchObject({ code: ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED });
    await expect(agent.analyzeCode({ source: "class Net: pass" })).rejects.toMatchObject({ code: ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED });
    await expect(agent.analyzeImage({ dataUrl: "data:image/png;base64,AA==" })).rejects.toMatchObject({ code: ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED });
    await expect(visio.healthCheck()).resolves.toEqual({ connected: false, reason: ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED });
    await expect(visio.executeDiagram({ jobId: "job-1" })).rejects.toMatchObject({ code: ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED });
  });
});
