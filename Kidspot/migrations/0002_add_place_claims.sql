CREATE TYPE "public"."claim_status" AS ENUM('pending', 'approved', 'denied');

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "linked_place_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "linked_place_name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "linked_place_address" text;

CREATE TABLE IF NOT EXISTS "place_claims" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "place_id" text NOT NULL,
  "place_name" text NOT NULL,
  "place_address" text NOT NULL,
  "place_photo_reference" text,
  "contact_phone" text NOT NULL,
  "status" "claim_status" NOT NULL DEFAULT 'pending',
  "admin_user_id" varchar REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "reviewed_by" varchar REFERENCES "users"("id"),
  "reviewed_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS place_claims_one_approved_per_place ON place_claims (place_id) WHERE status = 'approved';
