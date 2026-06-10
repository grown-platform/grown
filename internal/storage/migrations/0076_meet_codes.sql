-- 0076: short meeting codes for Meet.
--
-- Adds a human-readable code (e.g. abc-defg-hij) to each meet room so
-- participants can share a stable, typed-friendly link. The code is unique
-- across the table (globally); room isolation is still org-scoped in queries.

ALTER TABLE grown.meet_rooms ADD COLUMN IF NOT EXISTS code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS meet_rooms_code_idx ON grown.meet_rooms (code);
