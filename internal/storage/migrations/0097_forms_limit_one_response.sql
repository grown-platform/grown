-- 0097: Enforce Forms' "Limit to 1 response" setting.
--
-- The setting lives in the form's settings JSONB, which a partial index on
-- form_responses can't see. So each response records whether its form limited
-- responses at the time it was submitted (limit_one), and a partial unique
-- index makes a second limited response by the same signed-in user fail, even
-- when two submissions race.
--
-- Existing rows default to false, so forms that already hold duplicate
-- responses from one user still migrate cleanly. The service also rejects a
-- new submission when the user already has any response to the form, which
-- covers responses from before the setting was turned on.

ALTER TABLE grown.form_responses
  ADD COLUMN IF NOT EXISTS limit_one BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS form_responses_limit_one_uniq
  ON grown.form_responses (form_id, respondent_id)
  WHERE limit_one AND respondent_id IS NOT NULL;
