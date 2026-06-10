-- 0017: Mail rules (filters).
--
-- Per-user filters applied at delivery: match on from/to/subject substrings,
-- then act — apply a label, move to a folder, forward (redirect) to an address,
-- mark read, and/or star. For the local backend these run on internal delivery;
-- for the mailcow bridge they would translate to Sieve (future).

CREATE TABLE IF NOT EXISTS grown.mail_rules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id      UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    name          TEXT NOT NULL DEFAULT '',
    match_from    TEXT NOT NULL DEFAULT '',
    match_to      TEXT NOT NULL DEFAULT '',
    match_subject TEXT NOT NULL DEFAULT '',
    act_label     TEXT NOT NULL DEFAULT '',
    act_folder    TEXT NOT NULL DEFAULT '',
    act_forward   TEXT NOT NULL DEFAULT '',
    act_mark_read BOOLEAN NOT NULL DEFAULT false,
    act_star      BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_rules_owner_idx ON grown.mail_rules (owner_id);
