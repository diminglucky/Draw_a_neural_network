import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "apps/api/sql/001_foundation.sql",
  "infra/docker-compose.yml",
  "apps/api/src/store-factory.ts",
];
const missingFiles = requiredFiles.filter((file) => !existsSync(resolve(root, file)));
if (missingFiles.length > 0) {
  throw new Error(`Missing foundation files: ${missingFiles.join(", ")}`);
}

const sql = readFileSync(resolve(root, "apps/api/sql/001_foundation.sql"), "utf8");
const requiredSql = [
  "CREATE TABLE users",
  "CREATE TABLE devices",
  "CREATE TABLE device_keys",
  "CREATE TABLE sessions",
  "CREATE TABLE plans",
  "CREATE TABLE subscriptions",
  "CREATE TABLE entitlements",
  "CREATE TABLE jobs",
  "CREATE TABLE job_events",
  "CREATE TABLE admin_users",
  "CREATE TABLE audit_logs",
  "CREATE UNIQUE INDEX sessions_one_active_per_user",
];
const missingSql = requiredSql.filter((identifier) => !sql.includes(identifier));
if (missingSql.length > 0) {
  throw new Error(`Missing SQL identifiers: ${missingSql.join(", ")}`);
}

const compose = readFileSync(resolve(root, "infra/docker-compose.yml"), "utf8");
if (!compose.includes("postgres:") || !compose.includes("redis:")) {
  throw new Error("Docker Compose must define postgres and redis services");
}

console.log("Foundation boundary OK: durable schema, PostgreSQL/Redis services, and production store guard are present.");
