-- Phase-2 user-owned, append-only publication-figure analysis revisions.
CREATE TABLE IF NOT EXISTS figure_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('needs_confirmation', 'ready_for_preview', 'failed')),
  current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS figure_drafts_user_updated_idx
ON figure_drafts (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS figure_draft_revisions (
  draft_id TEXT NOT NULL REFERENCES figure_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('needs_confirmation', 'ready_for_preview', 'failed')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (draft_id, revision)
);

CREATE OR REPLACE FUNCTION reject_figure_draft_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'figure_draft_revisions is append-only';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS figure_draft_revisions_append_only ON figure_draft_revisions;
CREATE TRIGGER figure_draft_revisions_append_only
BEFORE UPDATE OR DELETE ON figure_draft_revisions
FOR EACH ROW
EXECUTE FUNCTION reject_figure_draft_revision_mutation();
