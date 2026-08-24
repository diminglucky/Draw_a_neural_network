CREATE TABLE IF NOT EXISTS private_input_receipts (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('typed_text', 'pytorch_source', 'architecture_description', 'sketch')),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('text/plain', 'text/markdown', 'text/x-python', 'application/json', 'image/png', 'image/jpeg', 'image/webp')),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-fA-F]{64}$'),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  retention TEXT NOT NULL CHECK (retention IN ('ephemeral', 'owner_revision')),
  content_handle TEXT NOT NULL,
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, receipt_id),
  UNIQUE (owner_id, content_handle)
);

CREATE TABLE IF NOT EXISTS private_input_receipt_batches (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_hash TEXT NOT NULL CHECK (batch_hash ~ '^[0-9a-fA-F]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id, batch_hash)
);

CREATE TABLE IF NOT EXISTS private_input_receipt_batch_items (
  owner_id TEXT NOT NULL,
  batch_hash CHAR(64) NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  receipt_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, batch_hash, ordinal),
  UNIQUE (owner_id, batch_hash, receipt_id),
  FOREIGN KEY (owner_id, batch_hash)
    REFERENCES private_input_receipt_batches(owner_id, batch_hash) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, receipt_id)
    REFERENCES private_input_receipts(owner_id, receipt_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS private_input_receipt_batches_lookup_idx
ON private_input_receipt_batch_items (owner_id, batch_hash, ordinal);
