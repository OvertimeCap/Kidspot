-- Migration 005: Pipeline blacklist table
-- Stores places permanently excluded from pipeline results.
-- Safe to run multiple times (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS pipeline_blacklist (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id TEXT NOT NULL UNIQUE,
  city_id VARCHAR REFERENCES cities(id),
  city_name TEXT,
  nome TEXT NOT NULL,
  tipo TEXT,
  excluido_em TIMESTAMP NOT NULL DEFAULT NOW(),
  excluido_por VARCHAR
);

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_blacklist_place_id_unique
  ON pipeline_blacklist (place_id);
