-- Initial schema for grown-workspace.
--
-- We isolate all our tables under a `grown` schema (not `public`) so a shared
-- Postgres instance can host multiple apps without clashing.

CREATE SCHEMA IF NOT EXISTS grown;

CREATE TABLE IF NOT EXISTS grown.schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
