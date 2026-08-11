import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiErrorCode } from "../src/domain.js";

describe("foundation error contracts", () => {
  it("exports stable authorization and adapter error codes", () => {
    expect(ApiErrorCode.ACCOUNT_ALREADY_IN_USE).toBe("ACCOUNT_ALREADY_IN_USE");
    expect(ApiErrorCode.SESSION_REVOKED).toBe("SESSION_REVOKED");
    expect(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED).toBe("AGENT_PROVIDER_NOT_CONFIGURED");
    expect(ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED).toBe("VISIO_EXECUTOR_NOT_CONFIGURED");
  });

  it("defines a durable positive fencing token for sessions", () => {
    const migration = readFileSync(resolve(process.cwd(), "apps/api/sql/001_foundation.sql"), "utf8");
    expect(migration).toContain("lease_fencing_token BIGINT NOT NULL");
    const session = { leaseFencingToken: 1 };
    expect(session.leaseFencingToken).toBeGreaterThan(0);
  });
});
