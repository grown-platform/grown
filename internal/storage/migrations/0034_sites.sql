-- 0034: Sites (internal site builder, a Google Sites style clone).
--
-- A site is a single website owned by a user within an org. Its full
-- page/block tree is stored as an opaque JSONB document (`content`) so the
-- editor can evolve the block model client-side without schema churn. The
-- whole tree is upserted on update. `published` gates the public view route.

CREATE TABLE IF NOT EXISTS grown.sites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id)  ON DELETE RESTRICT,
    owner_id    UUID NOT NULL REFERENCES grown.users(id) ON DELETE RESTRICT,
    name        TEXT  NOT NULL DEFAULT '',
    content     JSONB NOT NULL DEFAULT '{}',
    published   BOOLEAN NOT NULL DEFAULT false,
    trashed_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sites_org_idx
  ON grown.sites (org_id) WHERE trashed_at IS NULL;
