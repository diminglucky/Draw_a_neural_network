import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL || "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio";
const migration = readFileSync(resolve(process.cwd(), "apps/api/sql/001_foundation.sql"), "utf8");
const fencingMigration = readFileSync(resolve(process.cwd(), "apps/api/sql/002_session_fencing.sql"), "utf8");
const userId = `smoke-${randomUUID()}`;
const email = `${userId}@example.com`;
const deviceOneId = `device-${randomUUID()}`;
const deviceTwoId = `device-${randomUUID()}`;
const sessionOneId = `session-${randomUUID()}`;
const sessionTwoId = `session-${randomUUID()}`;

async function connect() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

let first;
let second;
try {
  first = await connect();
  const schema = await first.query("SELECT to_regclass('public.users') AS users_table");
  if (!schema.rows[0]?.users_table) await first.query(migration);
  await first.query(fencingMigration);
  await first.query(
    `INSERT INTO users (id, email, password_hash, status, roles, created_at)
     VALUES ($1, $2, 'smoke-hash', 'active', '["user"]'::jsonb, NOW())`,
    [userId, email],
  );
  await first.query(
    `INSERT INTO devices (id, user_id, name, fingerprint_hash, status, client_version, os_version, created_at)
     VALUES ($1, $2, 'Smoke Device A', 'smoke-fingerprint-a', 'active', '0.1.0', 'Windows 11', NOW()),
            ($3, $2, 'Smoke Device B', 'smoke-fingerprint-b', 'active', '0.1.0', 'Windows 11', NOW())`,
    [deviceOneId, userId, deviceTwoId],
  );
  await first.query(
    `INSERT INTO device_keys (device_id, public_key, algorithm, created_at)
     VALUES ($1, 'smoke-public-key-a', 'Ed25519', NOW()), ($2, 'smoke-public-key-b', 'Ed25519', NOW())`,
    [deviceOneId, deviceTwoId],
  );
  await first.query(
    `INSERT INTO sessions (id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token)
     VALUES ($1, $2, $3, 'active', $4, NOW(), NOW(), NOW() + INTERVAL '90 seconds', 1)`,
    [sessionOneId, userId, deviceOneId, `access-${randomUUID()}`],
  );

  let uniqueViolation = false;
  try {
    await first.query(
      `INSERT INTO sessions (id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token)
       VALUES ($1, $2, $3, 'active', $4, NOW(), NOW(), NOW() + INTERVAL '90 seconds', 2)`,
      [sessionTwoId, userId, deviceTwoId, `access-${randomUUID()}`],
    );
  } catch (error) {
    uniqueViolation = error?.code === "23505";
  }
  if (!uniqueViolation) throw new Error("PostgreSQL one-active-session invariant did not reject the competing session");

  await first.query("UPDATE sessions SET status = 'expired' WHERE id = $1", [sessionOneId]);
  await first.query(
    `INSERT INTO sessions (id, user_id, device_id, status, access_token_id, started_at, last_heartbeat_at, lease_expires_at, lease_fencing_token)
     VALUES ($1, $2, $3, 'active', $4, NOW(), NOW(), NOW() + INTERVAL '90 seconds', 2)`,
    [sessionTwoId, userId, deviceTwoId, `access-${randomUUID()}`],
  );

  const staleUpdate = await first.query(
    `UPDATE sessions SET last_heartbeat_at = NOW(), lease_expires_at = NOW() + INTERVAL '90 seconds'
     WHERE id = $1 AND status = 'active' AND lease_fencing_token = $2 RETURNING id`,
    [sessionOneId, 1],
  );
  if (staleUpdate.rowCount !== 0) throw new Error("Stale session fencing token updated an expired session");

  const staleTokenUpdate = await first.query(
    `UPDATE sessions SET last_heartbeat_at = NOW()
     WHERE id = $1 AND status = 'active' AND lease_fencing_token = $2 RETURNING id`,
    [sessionTwoId, 1],
  );
  if (staleTokenUpdate.rowCount !== 0) throw new Error("A stale fencing token updated the current session");

  const currentUpdate = await first.query(
    `UPDATE sessions SET last_heartbeat_at = NOW()
     WHERE id = $1 AND status = 'active' AND lease_fencing_token = $2 RETURNING id`,
    [sessionTwoId, 2],
  );
  if (currentUpdate.rowCount !== 1) throw new Error("The current fencing token could not update the active session");

  second = await connect();
  const result = await second.query("SELECT id, email FROM users WHERE id = $1", [userId]);
  if (result.rows.length !== 1 || result.rows[0].email !== email) {
    throw new Error("PostgreSQL persistence readback did not return the inserted user");
  }
  await second.end();
  second = null;
  await first.query("DELETE FROM users WHERE id = $1", [userId]);
  await first.end();
  first = null;
  console.log(`PostgreSQL smoke OK: persistence and session fencing accepted for ${email}`);
} catch (error) {
  console.error(`PostgreSQL smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await first?.end().catch(() => {});
  await second?.end().catch(() => {});
}
