ALTER TABLE generic_plan_snapshots
  ADD COLUMN IF NOT EXISTS confirmed_preview_hash TEXT;

DROP TRIGGER IF EXISTS generic_plan_snapshots_immutable ON generic_plan_snapshots;

WITH trusted_promotions AS (
  SELECT
    tenant_id,
    user_id,
    device_id,
    graph_id,
    ugs_revision,
    snapshot_id,
    MIN(RIGHT(reason, 64)) AS confirmed_preview_hash
  FROM generic_plan_snapshots
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(snapshot #> '{publicationVisualPlan,eligibility,formalReasons}') = 'array'
        THEN snapshot #> '{publicationVisualPlan,eligibility,formalReasons}'
      ELSE '[]'::jsonb
    END
  ) AS promotion(reason)
  WHERE snapshot #>> '{publicationVisualPlan,eligibility,kind}' = 'formal'
    AND snapshot #>> '{publicationVisualPlan,eligibility,qaStatus}' = 'passed'
    AND reason ~ '^visual-qa:pvp-qa-1:[a-f0-9]{64}$'
  GROUP BY tenant_id, user_id, device_id, graph_id, ugs_revision, snapshot_id
  HAVING COUNT(*) = 1
)
UPDATE generic_plan_snapshots AS snapshots
SET confirmed_preview_hash = trusted_promotions.confirmed_preview_hash
FROM trusted_promotions
WHERE snapshots.tenant_id = trusted_promotions.tenant_id
  AND snapshots.user_id = trusted_promotions.user_id
  AND snapshots.device_id = trusted_promotions.device_id
  AND snapshots.graph_id = trusted_promotions.graph_id
  AND snapshots.ugs_revision = trusted_promotions.ugs_revision
  AND snapshots.snapshot_id = trusted_promotions.snapshot_id
  AND snapshots.confirmed_preview_hash IS NULL;

CREATE OR REPLACE FUNCTION reject_generic_plan_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'generic_plan_snapshots are immutable';
END;
$$;

CREATE TRIGGER generic_plan_snapshots_immutable
BEFORE UPDATE OR DELETE ON generic_plan_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_generic_plan_snapshot_mutation();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM generic_plan_snapshots AS snapshots
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*) AS promotion_reason_count,
        MIN(RIGHT(reason, 64)) AS confirmed_preview_hash
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(snapshots.snapshot #> '{publicationVisualPlan,eligibility,formalReasons}') = 'array'
            THEN snapshots.snapshot #> '{publicationVisualPlan,eligibility,formalReasons}'
          ELSE '[]'::jsonb
        END
      ) AS promotion(reason)
      WHERE snapshots.snapshot #>> '{publicationVisualPlan,eligibility,kind}' = 'formal'
        AND snapshots.snapshot #>> '{publicationVisualPlan,eligibility,qaStatus}' = 'passed'
        AND reason ~ '^visual-qa:pvp-qa-1:[a-f0-9]{64}$'
    ) AS trusted_promotions
    WHERE trusted_promotions.promotion_reason_count <> 1
      OR snapshots.confirmed_preview_hash IS DISTINCT FROM trusted_promotions.confirmed_preview_hash
  ) THEN
    RAISE EXCEPTION 'generic_plan_snapshots confirmed preview hashes do not match one trusted QA promotion reason';
  END IF;
END;
$$;

ALTER TABLE generic_plan_snapshots
  ALTER COLUMN confirmed_preview_hash SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'generic_plan_snapshots_confirmed_preview_hash_check'
      AND conrelid = 'generic_plan_snapshots'::regclass
  ) THEN
    ALTER TABLE generic_plan_snapshots
      ADD CONSTRAINT generic_plan_snapshots_confirmed_preview_hash_check
      CHECK (confirmed_preview_hash ~ '^[0-9a-f]{64}$');
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS generic_plan_snapshots_owner_confirmed_preview_hash_uidx
  ON generic_plan_snapshots (tenant_id, user_id, device_id, confirmed_preview_hash);
