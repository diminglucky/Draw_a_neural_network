CREATE TABLE IF NOT EXISTS plan_snapshots (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES figure_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  plan_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, user_id, draft_id, revision, plan_id),
  UNIQUE (tenant_id, user_id, plan_id)
);

CREATE TABLE IF NOT EXISTS viewed_plan_previews (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  plan_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  preview_artifact_hashes JSONB NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, user_id, device_id, draft_id, revision, plan_id),
  FOREIGN KEY (tenant_id, user_id, draft_id, revision, plan_id)
    REFERENCES plan_snapshots (tenant_id, user_id, draft_id, revision, plan_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plan_export_confirmation_nonces (
  nonce TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  plan_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  preview_artifact_hashes JSONB NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS plan_export_confirmation_nonces_unconsumed_idx
ON plan_export_confirmation_nonces (expires_at)
WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS universal_figure_export_requests (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_scope_hash TEXT NOT NULL CHECK (request_scope_hash ~ '^[a-f0-9]{64}$'),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, user_id, device_id, idempotency_key)
);
