import { randomUUID } from "node:crypto";
import pg from "pg";

process.env.NODE_ENV = "development";
process.env.PORT = "4190";
process.env.SESSION_SECRET = "durable-admin-control-plane-smoke-session-secret";
process.env.STORAGE_DRIVER = "postgres";
process.env.DATABASE_URL = "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio";
process.env.LEASE_DRIVER = "redis";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.REQUIRE_DEVICE_PROOF = "false";
process.env.ADMIN_EMAIL = "admin@example.com";
process.env.ADMIN_PASSWORD = "durable-admin-control-plane-smoke-password";

const { buildDefaultApp } = await import("../apps/api/src/app.ts");
const { Client } = pg;
const email = `durable-admin-${randomUUID()}@example.com`;
const password = "password-123";
let app;
let userId;
let deviceId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function inject(options) {
  const response = await app.inject(options);
  const payload = response.json();
  return { response, payload };
}

try {
  app = await buildDefaultApp();

  const registered = await inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password,
      device: {
        name: "Durable Acceptance PC",
        publicKey: "durable-public-key",
        fingerprintHash: `durable-${randomUUID()}`,
        clientVersion: "0.1.0",
        osVersion: "Windows 11",
      },
    },
  });
  assert(registered.response.statusCode === 201, `registration failed: ${JSON.stringify(registered.payload)}`);
  userId = registered.payload.user.id;
  deviceId = registered.payload.device.id;

  const login = await inject({ method: "POST", url: "/api/auth/login", payload: { email, password, deviceId } });
  assert(login.response.statusCode === 200, `login failed: ${JSON.stringify(login.payload)}`);
  const userToken = login.payload.accessToken;
  const sessionId = login.payload.session.id;

  const adminLogin = await inject({ method: "POST", url: "/api/admin/auth/login", payload: { email: "admin@example.com", password: process.env.ADMIN_PASSWORD } });
  assert(adminLogin.response.statusCode === 200, `admin login failed: ${JSON.stringify(adminLogin.payload)}`);
  const adminHeaders = { authorization: `Bearer ${adminLogin.payload.accessToken}` };

  const disabled = await inject({
    method: "POST",
    url: `/api/admin/users/${userId}/status`,
    headers: adminHeaders,
    payload: { status: "disabled", reason: "durable admin control-plane acceptance" },
  });
  assert(disabled.response.statusCode === 200 && disabled.payload.user.status === "disabled", "durable user disable failed");

  const oldSession = await inject({ method: "GET", url: "/api/auth/session", headers: { authorization: `Bearer ${userToken}` } });
  assert(oldSession.response.statusCode === 401 && oldSession.payload.error.code === "SESSION_REVOKED", "durable old token was not revoked");

  const sessions = await inject({ method: "GET", url: "/api/admin/sessions", headers: adminHeaders });
  const storedSession = sessions.payload.sessions.find((item) => item.id === sessionId);
  assert(storedSession?.status === "revoked", "durable session status was not persisted as revoked");

  const audits = await inject({ method: "GET", url: "/api/admin/audit-logs", headers: adminHeaders });
  assert(audits.payload.records.some((item) => item.action === "user.disabled" && item.targetId === userId), "durable user audit was not persisted");
  assert(audits.payload.records.some((item) => item.action === "session.revoked" && item.targetId === sessionId), "durable session audit was not persisted");

  const enabled = await inject({
    method: "POST",
    url: `/api/admin/users/${userId}/status`,
    headers: adminHeaders,
    payload: { status: "active", reason: "durable admin control-plane acceptance cleared" },
  });
  assert(enabled.response.statusCode === 200 && enabled.payload.user.status === "active", "durable user enable failed");

  const freshLogin = await inject({ method: "POST", url: "/api/auth/login", payload: { email, password, deviceId } });
  assert(freshLogin.response.statusCode === 200 && typeof freshLogin.payload.accessToken === "string", "durable fresh login failed");

  console.log(JSON.stringify({
    storage: "postgres",
    lease: "redis",
    userDisabledAndReenabled: true,
    sessionRevokedPersisted: true,
    auditPersisted: true,
    freshLoginIssuedToken: true,
  }));
} finally {
  await app?.close().catch(() => {});
  if (userId) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.query("DELETE FROM audit_logs WHERE target_id = $1 OR metadata->>'userId' = $1 OR metadata->>'deviceId' = $2", [userId, deviceId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    } finally {
      await client.end().catch(() => {});
    }
  }
}
