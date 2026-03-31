-- Migration 002: place_photos and place_kidspot_meta for curation queue
-- Safe to run multiple times (IF NOT EXISTS guards).

DO $$ BEGIN
  CREATE TYPE curation_status AS ENUM ('pendente', 'aprovado', 'rejeitado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS place_photos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id         TEXT NOT NULL REFERENCES places_kidspot(place_id) ON DELETE CASCADE,
  url              TEXT NOT NULL,
  photo_reference  TEXT,
  is_cover         BOOLEAN NOT NULL DEFAULT FALSE,
  "order"          INTEGER NOT NULL DEFAULT 0,
  deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS place_photos_place_id_idx ON place_photos (place_id);
CREATE INDEX IF NOT EXISTS place_photos_cover_idx    ON place_photos (place_id, is_cover);

CREATE TABLE IF NOT EXISTS place_kidspot_meta (
  place_id         TEXT PRIMARY KEY REFERENCES places_kidspot(place_id) ON DELETE CASCADE,
  name             TEXT,
  address          TEXT,
  category         TEXT,
  kid_score        INTEGER,
  ai_evidences     JSONB,
  curation_status  curation_status NOT NULL DEFAULT 'pendente',
  description      TEXT,
  custom_criteria  JSONB,
  curated_by       TEXT,
  curated_at       TIMESTAMPTZ,
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS place_kidspot_meta_status_idx ON place_kidspot_meta (curation_status);
CREATE INDEX IF NOT EXISTS place_kidspot_meta_city_idx   ON place_kidspot_meta (place_id);
