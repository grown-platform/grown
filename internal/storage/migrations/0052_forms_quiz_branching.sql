-- 0046: Forms – quiz mode, section branching, file-upload + time question types.
--
-- Quiz mode: forms.is_quiz flag; per-question points + correct_answers stored in
-- the JSONB questions array (no schema change needed for those — they live in the
-- existing questions JSONB). We only need to persist the auto-computed score on
-- the response row.
--
-- Section branching: sections + per-option go_to_section routing live in the
-- existing questions JSONB (no separate table needed).
--
-- New question types (time, file_upload): type is a text enum stored in JSONB
-- questions array — no schema change needed. For file_upload we record the
-- uploaded blob key in the response's answers JSONB as a special value, and we
-- also store file metadata in a side table so we can serve them.

-- 1. Quiz flag on the form (NULL / false = not a quiz).
ALTER TABLE grown.forms
  ADD COLUMN IF NOT EXISTS is_quiz BOOLEAN NOT NULL DEFAULT false;

-- 2. Score on the response (NULL = not a quiz response or not yet graded).
ALTER TABLE grown.form_responses
  ADD COLUMN IF NOT EXISTS score NUMERIC(10,2);

-- 3. File-upload attachments: per-answer blob references for the file_upload
--    question type. Each uploaded file is stored in the drive blob store; this
--    table links the file to its response + question.
CREATE TABLE IF NOT EXISTS grown.form_response_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES grown.form_responses(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE RESTRICT,
    blob_key    TEXT NOT NULL,
    filename    TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_response_files_response_idx
  ON grown.form_response_files (response_id);
