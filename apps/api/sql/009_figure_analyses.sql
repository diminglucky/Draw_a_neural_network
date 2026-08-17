CREATE TABLE IF NOT EXISTS figure_analysis_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~* '^[a-f0-9]{64}$'),
  source_bytes INTEGER NOT NULL CHECK (source_bytes > 0 AND source_bytes <= 200000),
  source_code TEXT NOT NULL,
  retention_class TEXT NOT NULL CHECK (retention_class = 'analysis_source'),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS figure_analysis_sources_owner_idx
ON figure_analysis_sources (user_id, created_at);

CREATE TABLE IF NOT EXISTS figure_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_mime_type TEXT NOT NULL CHECK (source_mime_type IN ('text/plain', 'text/markdown', 'text/x-python')),
  source_bytes INTEGER NOT NULL CHECK (source_bytes > 0 AND source_bytes <= 200000),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~* '^[a-f0-9]{64}$'),
  kind TEXT NOT NULL CHECK (kind = 'pytorch-source'),
  status TEXT NOT NULL CHECK (status IN ('needs_confirmation', 'candidate_structure', 'ready_for_preview', 'failed')),
  architecture_ir JSONB NULL,
  unresolved JSONB NOT NULL,
  blocking_question JSONB NULL,
  evidence_graph JSONB NOT NULL,
  evidence_summary JSONB NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES figure_analysis_sources(id) ON DELETE RESTRICT,
  source_ref_sha256 TEXT NOT NULL CHECK (source_ref_sha256 ~* '^[a-f0-9]{64}$'),
  source_ref_bytes INTEGER NOT NULL CHECK (source_ref_bytes > 0 AND source_ref_bytes <= 200000),
  warnings JSONB NOT NULL,
  capability_version TEXT NOT NULL CHECK (capability_version = 'pytorch-static-linear-v0'),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS figure_analyses_owner_created_idx
ON figure_analyses (user_id, created_at);
