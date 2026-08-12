CREATE UNIQUE INDEX IF NOT EXISTS jobs_visio_idempotency_idx
ON jobs (user_id, type, ((input->>'idempotencyKey')))
WHERE type = 'visio-export' AND input ? 'idempotencyKey';
