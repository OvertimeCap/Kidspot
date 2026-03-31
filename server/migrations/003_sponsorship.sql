-- Add impression/detail counters to places_kidspot
ALTER TABLE places_kidspot
  ADD COLUMN IF NOT EXISTS impression_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS detail_access_count INTEGER NOT NULL DEFAULT 0;

-- Create sponsorship_contract_status enum
DO $$ BEGIN
  CREATE TYPE sponsorship_contract_status AS ENUM ('ativo', 'expirado', 'cancelado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create sponsorship_plans table
CREATE TABLE IF NOT EXISTS sponsorship_plans (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  reference_price NUMERIC NOT NULL DEFAULT 0,
  benefits TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create sponsorship_contracts table
CREATE TABLE IF NOT EXISTS sponsorship_contracts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id TEXT NOT NULL REFERENCES places_kidspot(place_id),
  place_name TEXT NOT NULL,
  plan_id VARCHAR NOT NULL REFERENCES sponsorship_plans(id),
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  status sponsorship_contract_status NOT NULL DEFAULT 'ativo',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
