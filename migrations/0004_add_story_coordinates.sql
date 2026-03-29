ALTER TABLE "partner_stories"
  ADD COLUMN IF NOT EXISTS "place_lat" numeric,
  ADD COLUMN IF NOT EXISTS "place_lng" numeric;

CREATE INDEX IF NOT EXISTS "partner_stories_lat_lng_idx"
  ON "partner_stories" ("place_lat", "place_lng");

-- Backfill coordinates for demo stories (matched by Google Place ID)
-- Pizzaria Paulicéia in Franca, SP
UPDATE "partner_stories"
SET place_lat = -20.5267, place_lng = -47.3882
WHERE place_id = 'ChIJtW8r_iamsJQR_9WSriZRmmk'
  AND place_lat IS NULL;

-- Gasparini Restaurante in Franca, SP
UPDATE "partner_stories"
SET place_lat = -20.5413, place_lng = -47.4059
WHERE place_id = 'ChIJz9M2aiWmsJQRv62CGnvGHbk'
  AND place_lat IS NULL;
