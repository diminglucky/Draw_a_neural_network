CREATE TABLE IF NOT EXISTS drawing_workflow_checkpoints (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('json', 'bytes')),
  checkpoint_data BYTEA NOT NULL,
  metadata_type TEXT NOT NULL CHECK (metadata_type IN ('json', 'bytes')),
  metadata_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, device_id, run_id, revision, checkpoint_ns, checkpoint_id),
  FOREIGN KEY (owner_id, run_id) REFERENCES drawing_runs(owner_id, run_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS drawing_workflow_checkpoints_thread_idx
ON drawing_workflow_checkpoints (thread_id, checkpoint_ns, checkpoint_id);

CREATE INDEX IF NOT EXISTS drawing_workflow_checkpoints_latest_idx
ON drawing_workflow_checkpoints (owner_id, device_id, run_id, revision, checkpoint_ns, created_at DESC, checkpoint_id DESC);

CREATE TABLE IF NOT EXISTS drawing_workflow_checkpoint_writes (
  owner_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  write_index INTEGER NOT NULL,
  channel TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('json', 'bytes')),
  value_data BYTEA NOT NULL,
  PRIMARY KEY (owner_id, device_id, run_id, revision, checkpoint_ns, checkpoint_id, task_id, write_index),
  FOREIGN KEY (owner_id, device_id, run_id, revision, checkpoint_ns, checkpoint_id)
    REFERENCES drawing_workflow_checkpoints(owner_id, device_id, run_id, revision, checkpoint_ns, checkpoint_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS drawing_workflow_checkpoint_writes_lookup_idx
ON drawing_workflow_checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, write_index);
