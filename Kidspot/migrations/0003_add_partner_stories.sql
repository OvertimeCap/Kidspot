CREATE TABLE IF NOT EXISTS "partner_stories" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "place_id" text NOT NULL,
  "place_name" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "story_photos" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "story_id" varchar NOT NULL REFERENCES "partner_stories"("id"),
  "photo_data" text NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "partner_stories_place_id_idx" ON "partner_stories" ("place_id");
CREATE INDEX IF NOT EXISTS "partner_stories_expires_at_idx" ON "partner_stories" ("expires_at");
CREATE INDEX IF NOT EXISTS "story_photos_story_id_idx" ON "story_photos" ("story_id");
