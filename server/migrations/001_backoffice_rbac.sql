-- Migration 001: Backoffice RBAC tables
-- Run once to create backoffice_users and audit_log tables.
-- Safe to run multiple times (IF NOT EXISTS guards).

-- Enums
DO $$ BEGIN
  CREATE TYPE backoffice_role AS ENUM ('super_admin', 'admin', 'curador', 'analista');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE backoffice_user_status AS ENUM ('ativo', 'pendente', 'inativo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backoffice users
CREATE TABLE IF NOT EXISTS backoffice_users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT NOT NULL,
  email                    TEXT NOT NULL,
  password_hash            TEXT,
  role                     backoffice_role NOT NULL,
  status                   backoffice_user_status NOT NULL DEFAULT 'pendente',
  invite_token             TEXT,
  invite_token_expires_at  TIMESTAMPTZ,
  created_by               UUID,
  last_active_at           TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS backoffice_users_email_unique ON backoffice_users (email);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  user_email      TEXT NOT NULL,
  user_role       TEXT NOT NULL,
  action          TEXT NOT NULL,
  module          TEXT NOT NULL,
  target_id       TEXT,
  payload_before  JSONB,
  payload_after   JSONB,
  ip              TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_user_id_idx   ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS audit_log_module_idx    ON audit_log (module);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
