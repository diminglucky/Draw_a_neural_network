CREATE TABLE IF NOT EXISTS drawing_evidence_packs (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evidence_pack_hash TEXT NOT NULL CHECK (evidence_pack_hash ~ '^[0-9a-fA-F]{64}$'),
  pack JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, evidence_pack_hash)
);

CREATE TABLE IF NOT EXISTS drawing_local_proposals (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[0-9a-fA-F]{64}$'),
  proposal JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, proposal_hash)
);

CREATE INDEX IF NOT EXISTS drawing_evidence_packs_owner_created_idx
ON drawing_evidence_packs (owner_id, created_at DESC);
