CREATE TABLE IF NOT EXISTS generic_plan_snapshots (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  graph_id TEXT NOT NULL,
  ugs_revision INTEGER NOT NULL CHECK (ugs_revision > 0),
  snapshot_id TEXT NOT NULL,
  publication_visual_plan_hash TEXT NOT NULL CHECK (publication_visual_plan_hash ~ '^[0-9a-f]{64}$'),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, user_id, device_id, graph_id, ugs_revision, snapshot_id)
);

CREATE INDEX IF NOT EXISTS generic_plan_snapshots_owner_created_idx
  ON generic_plan_snapshots (tenant_id, user_id, device_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS generic_plan_snapshots_owner_pvp_hash_uidx
  ON generic_plan_snapshots (tenant_id, user_id, device_id, publication_visual_plan_hash);

CREATE OR REPLACE FUNCTION reject_generic_plan_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'generic_plan_snapshots are immutable';
END;
$$;

DROP TRIGGER IF EXISTS generic_plan_snapshots_immutable ON generic_plan_snapshots;
CREATE TRIGGER generic_plan_snapshots_immutable
BEFORE UPDATE OR DELETE ON generic_plan_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_generic_plan_snapshot_mutation();
