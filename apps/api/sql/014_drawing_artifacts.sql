DO $$
BEGIN
  IF to_regclass('public.drawing_local_proposals') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'drawing_local_proposals'
         AND column_name = 'owner_id'
     ) THEN
    EXECUTE 'ALTER TABLE drawing_local_proposals RENAME TO drawing_local_proposals_legacy_unscoped';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS drawing_local_proposals (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[0-9a-fA-F]{64}$'),
  proposal JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, proposal_hash)
);

CREATE TABLE IF NOT EXISTS drawing_artifacts (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('ugs', 'pvp', 'qa')),
  artifact_hash TEXT NOT NULL CHECK (artifact_hash ~ '^[0-9a-fA-F]{64}$'),
  artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, artifact_kind, artifact_hash)
);

CREATE INDEX IF NOT EXISTS drawing_artifacts_owner_created_idx
ON drawing_artifacts (owner_id, created_at DESC);
