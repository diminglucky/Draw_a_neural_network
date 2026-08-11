-- Adds durable fencing to databases initialized before the session fencing slice.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS lease_fencing_token BIGINT NOT NULL DEFAULT 1;
