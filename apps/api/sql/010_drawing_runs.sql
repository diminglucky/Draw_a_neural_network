CREATE TABLE IF NOT EXISTS drawing_runs (
  run_id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN (
    'received', 'input_accepted', 'analyzing', 'awaiting_interpreter', 'candidate_structure',
    'awaiting_clarification', 'formal_ugs', 'composing_pvp', 'preview_ready', 'awaiting_page_binding',
    'page_bound', 'awaiting_apply_confirmation', 'applying', 'readback_verified', 'cancelled',
    'rejected', 'failed', 'conflicted'
  )),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  intent JSONB NOT NULL,
  artifact_hashes JSONB NOT NULL,
  private_receipt_ids JSONB NOT NULL,
  start_idempotency_key TEXT NOT NULL,
  start_request_hash TEXT NOT NULL CHECK (start_request_hash ~* '^[a-f0-9]{64}$'),
  clarification JSONB NULL,
  preview JSONB NULL,
  error_category TEXT NOT NULL CHECK (error_category IN (
    'none', 'validation', 'provider_unavailable', 'provider_timeout', 'provider_invalid',
    'worker', 'conflict', 'cancelled'
  )),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS drawing_runs_start_idempotency_idx
ON drawing_runs (owner_id, device_id, start_idempotency_key);

CREATE INDEX IF NOT EXISTS drawing_runs_owner_updated_idx
ON drawing_runs (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS drawing_run_events (
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'received', 'analyzed', 'proposed', 'formalized', 'clarified',
    'composed', 'bound', 'applied', 'readback', 'failed'
  )),
  artifact_hashes JSONB NOT NULL,
  error_category TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, run_id, event_id),
  UNIQUE (owner_id, run_id, idempotency_key),
  FOREIGN KEY (owner_id, run_id) REFERENCES drawing_runs(owner_id, run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS drawing_run_events_owner_revision_idx
ON drawing_run_events (owner_id, run_id, revision, occurred_at);
