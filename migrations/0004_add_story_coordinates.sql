ALTER TABLE "partner_stories"
  ADD COLUMN IF NOT EXISTS "place_lat" numeric,
  ADD COLUMN IF NOT EXISTS "place_lng" numeric;

CREATE INDEX IF NOT EXISTS "partner_stories_lat_lng_idx"
  ON "partner_stories" ("place_lat", "place_lng");
