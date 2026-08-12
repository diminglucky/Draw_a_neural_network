-- Durable Agent request usage. PostgreSQL is the quota source of truth;
-- Redis is intentionally not involved in quota correctness.

UPDATE plans
SET limits = limits || '{"agentChatsPerMonth": 10}'::jsonb
WHERE id = 'trial' AND NOT (limits ? 'agentChatsPerMonth');

CREATE TABLE agent_usage_periods (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('agentChatRequests')),
  period_start TIMESTAMPTZ NOT NULL,
  limit_snapshot INTEGER NOT NULL CHECK (limit_snapshot > 0),
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, metric, period_start)
);

CREATE TABLE agent_usage_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('agentChatRequests')),
  period_start TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  limit_snapshot INTEGER NOT NULL CHECK (limit_snapshot > 0),
  consumed INTEGER NOT NULL CHECK (consumed >= 0),
  state TEXT NOT NULL CHECK (state IN ('accepted', 'completed', 'failed', 'unknown')),
  outcome TEXT NULL,
  provider TEXT NULL,
  error_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ NULL,
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (user_id, metric, period_start)
    REFERENCES agent_usage_periods(user_id, metric, period_start)
    ON DELETE CASCADE
);

CREATE INDEX agent_usage_periods_user_idx
ON agent_usage_periods (user_id, period_start DESC);

CREATE INDEX agent_usage_ledger_state_idx
ON agent_usage_ledger (state, created_at);

CREATE INDEX agent_usage_ledger_user_period_idx
ON agent_usage_ledger (user_id, metric, period_start);
