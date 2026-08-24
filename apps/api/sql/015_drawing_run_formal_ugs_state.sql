BEGIN;

DO $$
DECLARE
  legacy_row_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO legacy_row_count
  FROM drawing_runs
  WHERE status = 'awaiting_apply_confirmation';

  IF legacy_row_count > 0 THEN
    RAISE EXCEPTION 'Migration 015 blocked: % drawing_runs rows remain in legacy awaiting_apply_confirmation status', legacy_row_count
      USING HINT = 'Inspect and resolve each legacy run with the deployed pre-015 workflow before rerunning this migration; no rows were rewritten.';
  END IF;
END $$;

ALTER TABLE drawing_runs
  ADD COLUMN IF NOT EXISTS formal_ugs_hash TEXT NULL;

DO $$
DECLARE
  invalid_hash_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO invalid_hash_count
  FROM drawing_runs
  WHERE formal_ugs_hash IS NOT NULL
    AND formal_ugs_hash !~* '^[a-f0-9]{64}$';

  IF invalid_hash_count > 0 THEN
    RAISE EXCEPTION 'Migration 015 blocked: % drawing_runs rows contain a non-SHA-256 formal_ugs_hash', invalid_hash_count
      USING HINT = 'Correct or remove the invalid formal_ugs_hash values before rerunning this migration; no rows were rewritten.';
  END IF;
END $$;

DO $$
DECLARE
  legacy_constraint_name TEXT;
  formal_hash_constraint_name TEXT;
BEGIN
  FOR legacy_constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.drawing_runs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%awaiting_apply_confirmation%'
  LOOP
    EXECUTE format('ALTER TABLE drawing_runs DROP CONSTRAINT %I', legacy_constraint_name);
  END LOOP;

  FOR formal_hash_constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.drawing_runs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%formal_ugs_hash%'
  LOOP
    EXECUTE format('ALTER TABLE drawing_runs DROP CONSTRAINT %I', formal_hash_constraint_name);
  END LOOP;
END $$;

ALTER TABLE drawing_runs
  DROP CONSTRAINT IF EXISTS drawing_runs_status_check,
  ADD CONSTRAINT drawing_runs_status_check CHECK (status IN (
    'received', 'input_accepted', 'analyzing', 'awaiting_interpreter', 'candidate_structure',
    'awaiting_clarification', 'formal_ugs', 'composing_pvp', 'preview_ready', 'awaiting_page_binding',
    'page_bound', 'applying', 'readback_verified', 'cancelled', 'rejected', 'failed', 'conflicted'
  )),
  ADD CONSTRAINT drawing_runs_formal_ugs_hash_check
    CHECK (formal_ugs_hash IS NULL OR formal_ugs_hash ~* '^[a-f0-9]{64}$');

COMMIT;
