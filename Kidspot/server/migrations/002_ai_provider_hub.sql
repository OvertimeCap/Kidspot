-- Migration 002: AI Provider Hub tables
-- Creates ai_providers and pipeline_routing tables.
-- Safe to run multiple times (IF NOT EXISTS guards).

-- Enums
DO $$ BEGIN
  CREATE TYPE ai_provider AS ENUM ('openai', 'anthropic', 'perplexity', 'google');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pipeline_stage AS ENUM ('place_discovery', 'review_analysis', 'description_generation', 'score_calculation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AI Providers table
CREATE TABLE IF NOT EXISTS ai_providers (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider      ai_provider NOT NULL UNIQUE,
  encrypted_key TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  tested_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pipeline routing table
CREATE TABLE IF NOT EXISTS pipeline_routing (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  stage            pipeline_stage NOT NULL UNIQUE,
  primary_provider ai_provider,
  model            TEXT,
  fallback_order   JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default routing rows for all pipeline stages
INSERT INTO pipeline_routing (stage, primary_provider, model, fallback_order)
VALUES
  ('place_discovery',        'openai', 'gpt-4o-mini', '[]'),
  ('review_analysis',        'openai', 'gpt-4o-mini', '[]'),
  ('description_generation', 'openai', 'gpt-4o-mini', '[]'),
  ('score_calculation',      'openai', 'gpt-4o-mini', '[]')
ON CONFLICT (stage) DO NOTHING;
