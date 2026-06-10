-- 0059: Contact groups (labels) and starred column guard.
--
-- Adds a first-class contact_groups table (a group is a named label owned by
-- an org user), a many-to-many contact_group_members join table, and ensures
-- the starred column exists on grown.contacts (it was present from 0013 but
-- is guarded here so the migration is safe to apply over any schema state).

-- Ensure starred exists (it was added in 0013; this is a no-op guard).
ALTER TABLE grown.contacts
    ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;

-- Named contact groups (labels backed by a proper table).
CREATE TABLE IF NOT EXISTS grown.contact_groups (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_groups_org_idx
    ON grown.contact_groups (org_id);

-- Many-to-many: a contact can belong to multiple groups, a group can have
-- multiple contacts.
CREATE TABLE IF NOT EXISTS grown.contact_group_members (
    group_id   UUID NOT NULL REFERENCES grown.contact_groups(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES grown.contacts(id)       ON DELETE CASCADE,
    PRIMARY KEY (group_id, contact_id)
);

CREATE INDEX IF NOT EXISTS contact_group_members_contact_idx
    ON grown.contact_group_members (contact_id);
