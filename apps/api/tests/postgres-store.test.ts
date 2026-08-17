import { describe, expect, it } from "vitest";
import type { Session } from "../src/domain.js";
import type { FigureDraftRevisionPayload } from "../src/figure-draft-payload.js";
import type { FigureAnalysisRecord } from "../src/figure-analysis.js";
import { PostgresFoundationStore, type PoolLike, type QueryResult } from "../src/postgres-store.js";
import { InMemoryFoundationStore } from "../src/store.js";

const userRow = {
  id: "user-1",
  email: "user@example.com",
  password_hash: "argon-hash",
  status: "active",
  roles: ["user"],
  created_at: "2026-08-11T00:00:00.000Z",
  last_login_at: null,
};

function safeRevisionPayload(): FigureDraftRevisionPayload {
  return {
    taskIntent: {
      action: "analyze_network" as const,
      sourceMode: "code" as const,
      requestedArtifact: "structure_only" as const,
      referencesDraftId: null,
      userConstraints: {
        orientation: "auto" as const,
        density: "standard" as const,
        printMode: "auto" as const,
        requiresNativeVisio: false,
      },
    },
    evidence: [{
      id: "fact-input",
      subject: "input",
      predicate: "declares",
      value: "input tensor",
      confidence: 0.9,
      source: { sourceId: "source-1", kind: "code" as const, name: "model.py" },
    }],
    canonicalNetworkIR: {
      version: 2 as const,
      figure: { id: "figure-1", title: "CNN", description: null },
      tensors: [],
      nodes: [{
        id: "input",
        op: "input" as const,
        inputTensorIds: [],
        outputTensorIds: [],
        confidence: 0.9,
        sourceEvidenceIds: ["fact-input"],
        repeats: null,
      }],
      edges: [],
      groups: [],
      unresolved: [],
    },
    blockingQuestions: [],
    resolvedConfirmations: [],
    warnings: [],
    readyForVisio: false as const,
  };
}

const draftRow = {
  id: "draft-1",
  user_id: "user-1",
  conversation_id: "conversation-1",
  status: "ready_for_preview",
  current_revision: 1,
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
};

function draftInput() {
  return {
    id: "draft-1",
    userId: "user-1",
    conversationId: "conversation-1",
    status: "ready_for_preview" as const,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

function analysisRecord(overrides: Partial<FigureAnalysisRecord> = {}): FigureAnalysisRecord {
  return {
    id: "analysis-1",
    userId: "user-1",
    sourceId: "source-1",
    sourceName: "model.py",
    sourceMimeType: "text/x-python",
    sourceBytes: 12,
    sourceSha256: "a".repeat(64),
    kind: "pytorch-source",
    status: "ready_for_preview",
    architectureIR: null,
    unresolved: [],
    blockingQuestion: null,
    evidenceGraph: { version: 2, facts: [], relations: [] },
    evidenceSummary: { version: 2, facts: [], relations: [] },
    sourceRef: { sourceRecordId: "source-record-1", retentionClass: "analysis_source", sourceSha256: "a".repeat(64), bytes: 12 },
    warnings: [],
    capabilityVersion: "pytorch-static-linear-v0",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function analysisRow(record: FigureAnalysisRecord, idempotencyKey = "analysis-key-1", requestHash = "request-hash-1") {
  return {
    id: record.id,
    user_id: record.userId,
    source_id: record.sourceId,
    source_name: record.sourceName,
    source_mime_type: record.sourceMimeType,
    source_bytes: record.sourceBytes,
    source_sha256: record.sourceSha256,
    kind: record.kind,
    status: record.status,
    architecture_ir: record.architectureIR,
    unresolved: record.unresolved,
    blocking_question: record.blockingQuestion,
    evidence_graph: record.evidenceGraph,
    evidence_summary: record.evidenceSummary,
    source_record_id: record.sourceRef.sourceRecordId,
    retention_class: record.sourceRef.retentionClass,
    source_ref_sha256: record.sourceRef.sourceSha256,
    source_ref_bytes: record.sourceRef.bytes,
    warnings: record.warnings,
    capability_version: record.capabilityVersion,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function fakePool(result: QueryResult = { rows: [userRow], rowCount: 1 }) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: PoolLike = {
    async query(text, values = []) {
      calls.push({ text, values });
      return result;
    },
    async connect() {
      return {
        query: async (text: string, values: readonly unknown[] = []) => {
          calls.push({ text, values });
          return result;
        },
        release() {},
      };
    },
    async end() {},
  };
  return { pool, calls };
}

describe("PostgresFoundationStore", () => {
  it("creates revision 1 transactionally and maps the persisted draft", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const releaseErrors: Array<Error | undefined> = [];
    const revisionRow = {
      draft_id: "draft-1", revision: 1, status: "ready_for_preview", payload: JSON.stringify(safeRevisionPayload()),
      created_at: "2026-08-14T00:00:00.000Z",
    };
    const client = {
      async query(text: string, values: readonly unknown[] = []) {
        calls.push({ text, values });
        if (text.includes("INSERT INTO figure_drafts")) return { rows: [draftRow], rowCount: 1 };
        if (text.includes("INSERT INTO figure_draft_revisions")) return { rows: [revisionRow], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release(error?: Error) { releaseErrors.push(error); },
    };
    const pool: PoolLike = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; } };
    const store = new PostgresFoundationStore(pool);

    const created = await store.createFigureDraft(draftInput(), safeRevisionPayload());

    expect(created).toMatchObject({
      draft: { id: "draft-1", userId: "user-1", currentRevision: 1 },
      revision: { draftId: "draft-1", revision: 1, payload: safeRevisionPayload() },
    });
    expect(calls[0]?.text).toBe("BEGIN");
    expect(calls.some((call) => call.text.includes("INSERT INTO figure_drafts") && call.values.includes("user-1"))).toBe(true);
    expect(calls.at(-1)?.text).toBe("COMMIT");
    expect(releaseErrors).toEqual([undefined]);
  });

  it("preserves the original draft insert error and destroys the client when rollback also fails", async () => {
    const calls: string[] = [];
    const insertError = new Error("draft revision insert failed");
    const releaseErrors: Array<Error | undefined> = [];
    const client = {
      async query(text: string) {
        calls.push(text);
        if (text.includes("INSERT INTO figure_draft_revisions")) throw insertError;
        if (text.includes("INSERT INTO figure_drafts")) return { rows: [draftRow], rowCount: 1 };
        if (text === "ROLLBACK") throw new Error("rollback connection failure");
        return { rows: [], rowCount: 0 };
      },
      release(error?: Error) { releaseErrors.push(error); },
    };
    const pool: PoolLike = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; } };
    const store = new PostgresFoundationStore(pool);

    await expect(store.createFigureDraft(draftInput(), safeRevisionPayload())).rejects.toBe(insertError);

    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(releaseErrors).toEqual([insertError]);
  });

  it("rejects an unsafe payload before opening a PostgreSQL transaction", async () => {
    let connected = false;
    const pool: PoolLike = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() {
        connected = true;
        throw new Error("must not connect for an invalid payload");
      },
    };
    const store = new PostgresFoundationStore(pool);

    await expect(store.createFigureDraft(
      draftInput(),
      { ...safeRevisionPayload(), outputPath: "C:\\secret\\figure.vsdx" } as unknown as FigureDraftRevisionPayload,
    )).rejects.toThrow(/payload|forbidden|unrecognized|invalid/i);
    expect(connected).toBe(false);
  });

  it("appends revision 2 after a successful owner-scoped CAS and releases a healthy client", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const releaseErrors: Array<Error | undefined> = [];
    const nextPayload = {
      ...safeRevisionPayload(),
      resolvedConfirmations: [{ questionId: "merge-kind", value: "add" }],
    };
    const updatedRow = { ...draftRow, current_revision: 2, updated_at: "2026-08-14T00:01:00.000Z" };
    const client = {
      async query(text: string, values: readonly unknown[] = []) {
        calls.push({ text, values });
        if (text.includes("UPDATE figure_drafts")) return { rows: [updatedRow], rowCount: 1 };
        if (text.includes("INSERT INTO figure_draft_revisions")) {
          return { rows: [{ draft_id: "draft-1", revision: 2, status: "ready_for_preview", payload: JSON.stringify(nextPayload), created_at: "2026-08-14T00:01:00.000Z" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release(error?: Error) { releaseErrors.push(error); },
    };
    const pool: PoolLike = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; } };
    const store = new PostgresFoundationStore(pool);

    await expect(store.appendFigureDraftRevision({
      userId: "user-1",
      draftId: "draft-1",
      expectedRevision: 1,
      status: "ready_for_preview",
      payload: nextPayload,
      createdAt: "2026-08-14T00:01:00.000Z",
    })).resolves.toMatchObject({
      conflict: false,
      draft: { userId: "user-1", currentRevision: 2 },
      revision: { revision: 2, payload: nextPayload },
    });

    expect(calls[0]?.text).toBe("BEGIN");
    expect(calls.some((call) => call.text.includes("UPDATE figure_drafts") && call.values.slice(0, 3).join(":") === "draft-1:user-1:1")).toBe(true);
    expect(calls.some((call) => call.text.includes("INSERT INTO figure_draft_revisions") && call.values.includes(2))).toBe(true);
    expect(calls.at(-1)?.text).toBe("COMMIT");
    expect(releaseErrors).toEqual([undefined]);
  });

  it("rolls back a failed revision append and destroys the client with the original error", async () => {
    const calls: string[] = [];
    const insertError = new Error("append revision insert failed");
    const releaseErrors: Array<Error | undefined> = [];
    const client = {
      async query(text: string) {
        calls.push(text);
        if (text.includes("UPDATE figure_drafts")) return { rows: [{ ...draftRow, current_revision: 2 }], rowCount: 1 };
        if (text.includes("INSERT INTO figure_draft_revisions")) throw insertError;
        return { rows: [], rowCount: 0 };
      },
      release(error?: Error) { releaseErrors.push(error); },
    };
    const pool: PoolLike = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; } };
    const store = new PostgresFoundationStore(pool);

    await expect(store.appendFigureDraftRevision({
      userId: "user-1",
      draftId: "draft-1",
      expectedRevision: 1,
      status: "ready_for_preview",
      payload: safeRevisionPayload(),
      createdAt: "2026-08-14T00:01:00.000Z",
    })).rejects.toBe(insertError);

    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
    expect(releaseErrors).toEqual([insertError]);
  });

  it("rolls back a CAS conflict and releases the client as healthy", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const releaseErrors: Array<Error | undefined> = [];
    const client = {
      async query(text: string, values: readonly unknown[] = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      release(error?: Error) { releaseErrors.push(error); },
    };
    const pool: PoolLike = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; } };
    const store = new PostgresFoundationStore(pool);

    await expect(store.appendFigureDraftRevision({
      userId: "user-1",
      draftId: "draft-1",
      expectedRevision: 1,
      status: "ready_for_preview",
      payload: safeRevisionPayload(),
      createdAt: "2026-08-14T00:00:00.000Z",
    })).resolves.toMatchObject({ conflict: true });

    expect(calls.some((call) => call.text.includes("UPDATE figure_drafts") && call.values.includes(1))).toBe(true);
    expect(calls.at(-1)?.text).toBe("ROLLBACK");
    expect(releaseErrors).toEqual([undefined]);
  });

  it("binds both draft and revision reads to the owning user", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const pool: PoolLike = {
      async query(text, values = []) {
        calls.push({ text, values });
        if (text.includes("FROM figure_draft_revisions")) {
          return { rows: [{ draft_id: "draft-1", revision: 1, status: "ready_for_preview", payload: JSON.stringify(safeRevisionPayload()), created_at: "2026-08-14T00:00:00.000Z" }], rowCount: 1 };
        }
        return { rows: [draftRow], rowCount: 1 };
      },
      async connect() { throw new Error("not used"); },
    };
    const store = new PostgresFoundationStore(pool);

    await expect(store.getFigureDraft("user-1", "draft-1")).resolves.toMatchObject({ userId: "user-1" });
    await expect(store.getFigureDraftRevision("user-1", "draft-1", 1)).resolves.toMatchObject({ draftId: "draft-1", revision: 1 });

    expect(calls[0]?.text).toMatch(/id\s*=\s*\$1\s+AND\s+user_id\s*=\s*\$2/i);
    expect(calls[0]?.values).toEqual(["draft-1", "user-1"]);
    expect(calls[1]?.text).toMatch(/JOIN figure_drafts d[\s\S]+d\.user_id\s*=\s*\$1[\s\S]+r\.draft_id\s*=\s*\$2[\s\S]+r\.revision\s*=\s*\$3/i);
    expect(calls[1]?.values).toEqual(["user-1", "draft-1", 1]);
  });

  it("revalidates PostgreSQL revision payloads on read", async () => {
    const pool: PoolLike = {
      async query() {
        return {
          rows: [{
            draft_id: "draft-1",
            revision: 1,
            status: "ready_for_preview",
            payload: JSON.stringify({ ...safeRevisionPayload(), requestHeaders: { authorization: "Bearer secret" } }),
            created_at: "2026-08-14T00:00:00.000Z",
          }],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    };
    const store = new PostgresFoundationStore(pool);

    await expect(store.getFigureDraftRevision("user-1", "draft-1", 1)).rejects.toThrow(/payload|forbidden|unrecognized|invalid/i);
  });
  it("maps a user row and uses parameterized SQL for writes", async () => {
    const { pool, calls } = fakePool();
    const store = new PostgresFoundationStore(pool);

    const user = await store.createUser({
      id: "user-1",
      email: "user@example.com",
      passwordHash: "argon-hash",
      status: "active",
      roles: ["user"],
      createdAt: "2026-08-11T00:00:00.000Z",
      lastLoginAt: null,
    });

    expect(user).toMatchObject({ id: "user-1", email: "user@example.com", passwordHash: "argon-hash", roles: ["user"] });
    expect(calls[0].text).toContain("INSERT INTO users");
    expect(calls[0].text).toContain("$1");
    expect(calls[0].text).not.toContain("user@example.com");
    expect(calls[0].values).toContain("user@example.com");
  });

  it("returns null for a missing user and maps nullable timestamps", async () => {
    const { pool } = fakePool({ rows: [], rowCount: 0 });
    const store = new PostgresFoundationStore(pool);

    await expect(store.findUserByEmail("missing@example.com")).resolves.toBeNull();
  });

  it("writes the required created_at field for subscriptions", async () => {
    const { pool, calls } = fakePool({
      rows: [{ id: "sub-1", user_id: "user-1", plan_id: "trial", status: "trialing", starts_at: "2026-08-11T00:00:00.000Z", ends_at: null }],
      rowCount: 1,
    });
    const store = new PostgresFoundationStore(pool);
    await store.createSubscription({
      id: "sub-1", userId: "user-1", plan: "trial", status: "trialing",
      startsAt: "2026-08-11T00:00:00.000Z", endsAt: null, features: ["foundation"], limits: { foundationJobsPerMonth: 10 },
    });

    expect(calls[0].text).toContain("created_at");
    expect(calls[0].text).toContain("NOW()");
  });

  it("persists and atomically consumes device challenges", async () => {
    const challengeRow = {
      id: "challenge-1", user_id: "user-1", device_id: "device-1", challenge: "opaque-challenge",
      expires_at: "2026-08-11T00:02:00.000Z", consumed_at: "2026-08-11T00:01:00.000Z", created_at: "2026-08-11T00:00:00.000Z",
    };
    const { pool, calls } = fakePool({ rows: [challengeRow], rowCount: 1 });
    const store = new PostgresFoundationStore(pool);
    await expect(store.createDeviceChallenge({
      id: "challenge-1", userId: "user-1", deviceId: "device-1", value: "opaque-challenge",
      expiresAt: "2026-08-11T00:02:00.000Z", consumedAt: null, createdAt: "2026-08-11T00:00:00.000Z",
    })).resolves.toMatchObject({ value: "opaque-challenge" });
    await expect(store.consumeDeviceChallenge("challenge-1", new Date("2026-08-11T00:01:00.000Z"))).resolves.toMatchObject({ id: "challenge-1" });
    expect(calls[0].text).toContain("INSERT INTO device_challenges");
    expect(calls[1].text).toContain("consumed_at IS NULL");
    expect(calls[1].text).toContain("expires_at > $2");
  });

  it("claims an active session inside a transaction with a user row lock", async () => {
    const calls: string[] = [];
    let released = false;
    const client = {
      async query(text: string) {
        calls.push(text);
        if (text.includes("SELECT id FROM users")) return { rows: [{ id: "user-1" }], rowCount: 1 };
        if (text.includes("FROM sessions")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release() { released = true; },
    };
    const pool: PoolLike = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
    };
    const store = new PostgresFoundationStore(pool);
    const session: Session = {
      id: "session-1",
      userId: "user-1",
      deviceId: "device-1",
      status: "active",
      accessTokenId: "token-1",
      startedAt: "2026-08-11T00:00:00.000Z",
      lastHeartbeatAt: "2026-08-11T00:00:00.000Z",
      leaseExpiresAt: "2026-08-11T00:01:00.000Z",
      leaseFencingToken: 1,
      revokedAt: null,
    };

    await expect(store.claimActiveSession("user-1", session, new Date("2026-08-11T00:00:00.000Z"))).resolves.toBe(true);
    expect(calls[0]).toBe("BEGIN");
    expect(calls.some((text) => text.includes("FOR UPDATE"))).toBe(true);
    expect(calls.at(-1)).toBe("COMMIT");
    expect(released).toBe(true);
  });

  it("writes the fencing token and rejects a conditional update when no token-matching row exists", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const pool: PoolLike = {
      async query(text, values = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        return { async query(text, values = []) { calls.push({ text, values }); return { rows: [], rowCount: 0 }; }, release() {} };
      },
    };
    const store = new PostgresFoundationStore(pool);
    const session: Session = {
      id: "session-1", userId: "user-1", deviceId: "device-1", status: "active", accessTokenId: "token-1",
      startedAt: "2026-08-11T00:00:00.000Z", lastHeartbeatAt: "2026-08-11T00:00:00.000Z", leaseExpiresAt: "2026-08-11T00:01:00.000Z", leaseFencingToken: 7, revokedAt: null,
    };

    await expect(store.updateSession(session, 7)).resolves.toBeNull();
    expect(calls[0].text).toContain("lease_fencing_token");
    expect(calls[0].text).toContain("status = 'active'");
    expect(calls[0].values).toContain(7);
  });

  it("rolls back and releases the client when session insertion fails", async () => {
    const calls: string[] = [];
    let released = false;
    const client = {
      async query(text: string) {
        calls.push(text);
        if (text.includes("INSERT INTO sessions")) throw Object.assign(new Error("database unavailable"), { code: "XX000" });
        if (text.includes("SELECT id FROM users")) return { rows: [{ id: "user-1" }], rowCount: 1 };
        if (text.includes("FROM sessions")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release() { released = true; },
    };
    const pool: PoolLike = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; } };
    const store = new PostgresFoundationStore(pool);

    await expect(store.claimActiveSession("user-1", {
      id: "session-1", userId: "user-1", deviceId: "device-1", status: "active", accessTokenId: "token-1",
      startedAt: "2026-08-11T00:00:00.000Z", lastHeartbeatAt: "2026-08-11T00:00:00.000Z", leaseExpiresAt: "2026-08-11T00:01:00.000Z", leaseFencingToken: 1, revokedAt: null,
    }, new Date("2026-08-11T00:00:00.000Z"))).rejects.toThrow("database unavailable");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(released).toBe(true);
  });

  it("reserves agent usage inside a locked transaction and inserts a ledger row", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    let released = false;
    const periodRow = {
      user_id: "user-1",
      metric: "agentChatRequests",
      period_start: "2026-08-01T00:00:00.000Z",
      limit_snapshot: 2,
      consumed: 0,
      updated_at: "2026-08-11T00:00:00.000Z",
    };
    const reservationRow = {
      id: "usage-1",
      user_id: "user-1",
      metric: "agentChatRequests",
      period_start: "2026-08-01T00:00:00.000Z",
      idempotency_key: "req-1",
      request_hash: "hash-1",
      amount: 1,
      limit_snapshot: 2,
      consumed: 1,
      state: "accepted",
      outcome: null,
      provider: null,
      error_code: null,
      created_at: "2026-08-11T00:00:00.000Z",
      finalized_at: null,
    };
    const client = {
      async query(text: string, values: readonly unknown[] = []) {
        calls.push({ text, values });
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [], rowCount: 0 };
        if (text.includes("FROM agent_usage_periods") && text.includes("FOR UPDATE")) return { rows: [periodRow], rowCount: 1 };
        if (text.includes("FROM agent_usage_ledger")) return { rows: [], rowCount: 0 };
        if (text.includes("UPDATE agent_usage_periods")) return { rows: [{ ...periodRow, consumed: 1 }], rowCount: 1 };
        if (text.includes("INSERT INTO agent_usage_ledger")) return { rows: [reservationRow], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release() { released = true; },
    };
    const pool: PoolLike = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
    };
    const store = new PostgresFoundationStore(pool);

    await expect(store.reserveAgentUsage({
      userId: "user-1",
      metric: "agentChatRequests",
      periodStart: "2026-08-01T00:00:00.000Z",
      idempotencyKey: "req-1",
      requestHash: "hash-1",
      amount: 1,
      limit: 2,
    })).resolves.toMatchObject({ id: "usage-1", consumed: 1, remaining: 1, state: "accepted" });

    expect(calls[0].text).toBe("BEGIN");
    expect(calls.some((call) => call.text.includes("FROM agent_usage_periods") && call.text.includes("FOR UPDATE"))).toBe(true);
    expect(calls.some((call) => call.text.includes("consumed + $"))).toBe(true);
    expect(calls.some((call) => call.text.includes("FROM agent_usage_ledger"))).toBe(true);
    expect(calls.at(-1)?.text).toBe("COMMIT");
    expect(released).toBe(true);
  });

  it("rolls back an agent usage reservation when the monthly quota is exhausted", async () => {
    const calls: string[] = [];
    let released = false;
    const client = {
      async query(text: string) {
        calls.push(text);
        if (text.includes("FROM agent_usage_periods") && text.includes("FOR UPDATE")) {
          return {
            rows: [{ user_id: "user-1", metric: "agentChatRequests", period_start: "2026-08-01T00:00:00.000Z", limit_snapshot: 1, consumed: 1, updated_at: "2026-08-11T00:00:00.000Z" }],
            rowCount: 1,
          };
        }
        if (text.includes("UPDATE agent_usage_periods")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release() { released = true; },
    };
    const pool: PoolLike = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; } };
    const store = new PostgresFoundationStore(pool);

    await expect(store.reserveAgentUsage({
      userId: "user-1",
      metric: "agentChatRequests",
      periodStart: "2026-08-01T00:00:00.000Z",
      idempotencyKey: "req-2",
      requestHash: "hash-2",
      amount: 1,
      limit: 1,
    })).resolves.toBeNull();

    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(released).toBe(true);
  });

  it("finalizes only an accepted agent usage ledger row", async () => {
    const { pool, calls } = fakePool({
      rows: [{
        id: "usage-1", user_id: "user-1", metric: "agentChatRequests", period_start: "2026-08-01T00:00:00.000Z",
        idempotency_key: "req-1", request_hash: "hash-1", amount: 1, limit_snapshot: 2, consumed: 1,
        state: "failed", outcome: "provider_error", provider: "local-deterministic", error_code: "AGENT_PROVIDER_FAILED",
        created_at: "2026-08-11T00:00:00.000Z", finalized_at: "2026-08-11T00:01:00.000Z",
      }],
      rowCount: 1,
    });
    const store = new PostgresFoundationStore(pool);

    await expect(store.finalizeAgentUsage({ id: "usage-1", state: "failed", outcome: "provider_error", provider: "local-deterministic", errorCode: "AGENT_PROVIDER_FAILED" })).resolves.toMatchObject({ state: "failed", outcome: "provider_error" });
    expect(calls[0].text).toContain("UPDATE agent_usage_ledger");
    expect(calls[0].text).toContain("state = 'accepted'");
  });

  it("stores figure analysis with owner scope and idempotency in memory", async () => {
    const store = new InMemoryFoundationStore();
    const record = analysisRecord();

    await expect(store.createFigureAnalysisIdempotent({
      record,
      sourceCode: "class SecretModel: pass",
      idempotencyKey: "analysis-key-1",
      requestHash: "request-hash-1",
    })).resolves.toMatchObject({ record, duplicate: false, requestHashMatches: true });

    await expect(store.createFigureAnalysisIdempotent({
      record: { ...record, id: "analysis-duplicate" },
      sourceCode: "class DifferentModel: pass",
      idempotencyKey: "analysis-key-1",
      requestHash: "request-hash-1",
    })).resolves.toMatchObject({ record, duplicate: true, requestHashMatches: true });

    await expect(store.createFigureAnalysisIdempotent({
      record: { ...record, id: "analysis-conflict" },
      sourceCode: "class DifferentModel: pass",
      idempotencyKey: "analysis-key-1",
      requestHash: "request-hash-2",
    })).resolves.toMatchObject({ record, duplicate: true, requestHashMatches: false });

    await expect(store.getFigureAnalysis("user-1", "analysis-1")).resolves.toEqual(record);
    await expect(store.getFigureAnalysis("other-user", "analysis-1")).resolves.toBeNull();
  });

  it("persists the retained source and analysis record in one PostgreSQL transaction", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const record = analysisRecord();
    const row = analysisRow(record);
    let inserted = false;
    const client = {
      async query(text: string, values: readonly unknown[] = []) {
        calls.push({ text, values });
        if (text.includes("INSERT INTO figure_analyses")) {
          if (inserted) return { rows: [], rowCount: 0 };
          inserted = true;
          return { rows: [row], rowCount: 1 };
        }
        if (text.includes("FROM figure_analyses")) return { rows: inserted ? [row] : [], rowCount: inserted ? 1 : 0 };
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const pool: PoolLike = {
      async query(text, values = []) {
        calls.push({ text, values });
        return text.includes("FROM figure_analyses") ? { rows: inserted ? [row] : [], rowCount: inserted ? 1 : 0 } : { rows: [], rowCount: 0 };
      },
      async connect() { return client; },
    };
    const store = new PostgresFoundationStore(pool);

    await expect(store.createFigureAnalysisIdempotent({
      record,
      sourceCode: "class SecretModel: pass",
      idempotencyKey: "analysis-key-1",
      requestHash: "request-hash-1",
    })).resolves.toMatchObject({ record, duplicate: false, requestHashMatches: true });

    expect(calls[0]?.text).toBe("BEGIN");
    expect(calls.some((call) => call.text.includes("INSERT INTO figure_analysis_sources") && call.values.includes("class SecretModel: pass"))).toBe(true);
    expect(calls.some((call) => call.text.includes("INSERT INTO figure_analyses") && call.values.includes("analysis-1"))).toBe(true);
    expect(calls.at(-1)?.text).toBe("COMMIT");

    await expect(store.getFigureAnalysis("user-1", "analysis-1")).resolves.toEqual(record);
    const read = calls.at(-1);
    expect(read?.text).toMatch(/FROM figure_analyses/);
    expect(read?.values).toEqual(["user-1", "analysis-1"]);
  });
});
