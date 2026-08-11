import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL || "postgres://synapse:synapse-local-only@127.0.0.1:54329/synapse_studio";
const migration = readFileSync(resolve(process.cwd(), "apps/api/sql/001_foundation.sql"), "utf8");
const userId = `smoke-${randomUUID()}`;
const email = `${userId}@example.com`;

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
  await first.query(
    `INSERT INTO users (id, email, password_hash, status, roles, created_at)
     VALUES ($1, $2, 'smoke-hash', 'active', '["user"]'::jsonb, NOW())`,
    [userId, email],
  );
  await first.end();
  first = null;

  second = await connect();
  const result = await second.query("SELECT id, email FROM users WHERE id = $1", [userId]);
  if (result.rows.length !== 1 || result.rows[0].email !== email) {
    throw new Error("PostgreSQL persistence readback did not return the inserted user");
  }
  await second.query("DELETE FROM users WHERE id = $1", [userId]);
  await second.end();
  second = null;
  console.log(`PostgreSQL smoke OK: persisted and read back ${email}`);
} catch (error) {
  console.error(`PostgreSQL smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await first?.end().catch(() => {});
  await second?.end().catch(() => {});
}
