import { describe, expect, it } from "vitest";
import { ApiErrorCode } from "../src/domain.js";

describe("foundation error contracts", () => {
  it("exports stable authorization and adapter error codes", () => {
    expect(ApiErrorCode.ACCOUNT_ALREADY_IN_USE).toBe("ACCOUNT_ALREADY_IN_USE");
    expect(ApiErrorCode.SESSION_REVOKED).toBe("SESSION_REVOKED");
    expect(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED).toBe("AGENT_PROVIDER_NOT_CONFIGURED");
    expect(ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED).toBe("VISIO_EXECUTOR_NOT_CONFIGURED");
  });
});
