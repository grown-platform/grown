-- 0042: Per-object ACL grants (per-user sharing for Drive + Docs, extensible).
--
-- A row grants grantee_user_id a role on a single object identified by
-- (object_type, object_id). This is the cross-org sharing primitive: a grant
-- lets a user who is NOT a member of the object's owning org open that one
-- object, at the granted role. It does NOT widen org membership — only the
-- specific object becomes visible (see docs/sharing-and-personal-orgs.md).
--
-- object_type is an app-defined string: 'drive_file' or 'docs_document' today;
-- other apps can reuse this table by adopting their own type string. object_id
-- is intentionally NOT a foreign key (it spans multiple tables); the owning
-- service is responsible for resolving/cleaning it. grantee_user_id IS a FK so
-- deleting a user removes their grants.
--
-- role mirrors the link-share roles: viewer (read), commenter (read + comment),
-- editor (read + write). granted_by is the user who created the grant.

CREATE TABLE IF NOT EXISTS grown.object_grants (
    object_type      TEXT NOT NULL,
    object_id        UUID NOT NULL,
    grantee_user_id  UUID NOT NULL REFERENCES grown.users(id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor')),
    granted_by       UUID REFERENCES grown.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (object_type, object_id, grantee_user_id)
);

-- "Shared with me" lookups: all objects of a type granted to a given user.
CREATE INDEX IF NOT EXISTS object_grants_grantee_idx
    ON grown.object_grants (grantee_user_id, object_type);
