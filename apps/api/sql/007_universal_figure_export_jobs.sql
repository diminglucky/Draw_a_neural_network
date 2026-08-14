ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('chat', 'code-analysis', 'image-analysis', 'visio-export', 'universal-figure-export'));
