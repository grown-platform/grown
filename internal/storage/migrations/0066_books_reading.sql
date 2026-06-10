-- 0066: Books reading features — per-user progress, bookmarks, highlights, shelves.
--
-- All tables are additive (IF NOT EXISTS) so re-running is safe.

-- book_progress: per-user reading position for a book (upsert on checkpoint).
CREATE TABLE IF NOT EXISTS grown.book_progress (
    user_id     UUID NOT NULL REFERENCES grown.users(id)  ON DELETE CASCADE,
    book_id     UUID NOT NULL REFERENCES grown.books(id)  ON DELETE CASCADE,
    locator     TEXT NOT NULL DEFAULT '',
    percent     INTEGER NOT NULL DEFAULT 0
                CHECK (percent BETWEEN 0 AND 100),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS book_progress_book_idx
    ON grown.book_progress (book_id);

-- book_bookmarks: named position markers within a book, per user.
CREATE TABLE IF NOT EXISTS grown.book_bookmarks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id)   ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES grown.users(id)  ON DELETE CASCADE,
    book_id     UUID NOT NULL REFERENCES grown.books(id)  ON DELETE CASCADE,
    locator     TEXT NOT NULL DEFAULT '',
    label       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_bookmarks_user_book_idx
    ON grown.book_bookmarks (user_id, book_id);
CREATE INDEX IF NOT EXISTS book_bookmarks_org_idx
    ON grown.book_bookmarks (org_id);

-- book_highlights: highlighted passage with optional note + color, per user.
CREATE TABLE IF NOT EXISTS grown.book_highlights (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES grown.orgs(id)   ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES grown.users(id)  ON DELETE CASCADE,
    book_id       UUID NOT NULL REFERENCES grown.books(id)  ON DELETE CASCADE,
    locator       TEXT NOT NULL DEFAULT '',
    selected_text TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    color         TEXT NOT NULL DEFAULT 'yellow',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_highlights_user_book_idx
    ON grown.book_highlights (user_id, book_id);
CREATE INDEX IF NOT EXISTS book_highlights_org_idx
    ON grown.book_highlights (org_id);

-- book_shelves: named collections of books, owned by a user within an org.
CREATE TABLE IF NOT EXISTS grown.book_shelves (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES grown.orgs(id)   ON DELETE CASCADE,
    owner_user_id  UUID NOT NULL REFERENCES grown.users(id)  ON DELETE CASCADE,
    name           TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_shelves_owner_idx
    ON grown.book_shelves (org_id, owner_user_id);

-- book_shelf_items: membership mapping shelf → book.
CREATE TABLE IF NOT EXISTS grown.book_shelf_items (
    shelf_id    UUID NOT NULL REFERENCES grown.book_shelves(id) ON DELETE CASCADE,
    book_id     UUID NOT NULL REFERENCES grown.books(id)         ON DELETE CASCADE,
    PRIMARY KEY (shelf_id, book_id)
);

CREATE INDEX IF NOT EXISTS book_shelf_items_book_idx
    ON grown.book_shelf_items (book_id);
