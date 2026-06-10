-- 0021: Forms (Google Forms–style surveys & quizzes).
--
-- A form has a title/description plus an ordered list of questions. The
-- questions are stored as a JSONB array (each item: id, type, title,
-- description, required, options[], scale config, etc.) — keeping the model
-- flexible without a separate questions table.
--
-- Responses are individual submissions: a JSONB object mapping question id ->
-- answer (string for text/choice/date/scale, array of strings for checkboxes).
-- Summaries are computed on read by aggregating responses.

CREATE TABLE IF NOT EXISTS grown.forms (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    title         TEXT  NOT NULL DEFAULT '',
    description   TEXT  NOT NULL DEFAULT '',
    questions     JSONB NOT NULL DEFAULT '[]',
    -- Per-form settings (collect email, limit one response, accept responses,
    -- show progress bar, shuffle, confirmation message). Stored as JSON so the
    -- shape can grow without a migration.
    settings      JSONB NOT NULL DEFAULT '{}',
    accepting     BOOLEAN NOT NULL DEFAULT true,
    trashed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forms_org_idx
  ON grown.forms (org_id) WHERE trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS grown.form_responses (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id       UUID NOT NULL REFERENCES grown.forms(id) ON DELETE CASCADE,
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    -- respondent_id is the submitting user when known (NULL for anonymous).
    respondent_id UUID REFERENCES grown.users(id) ON DELETE SET NULL,
    respondent_email TEXT NOT NULL DEFAULT '',
    -- answers maps question id -> answer value (string or array of strings).
    answers       JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_responses_form_idx
  ON grown.form_responses (form_id, created_at DESC);
