CREATE TYPE "scan_frequency" AS ENUM ('diaria', 'semanal', 'quinzenal', 'mensal');

CREATE TABLE IF NOT EXISTS "cities" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "nome" text NOT NULL,
  "estado" text NOT NULL,
  "latitude" numeric NOT NULL,
  "longitude" numeric NOT NULL,
  "raio_km" integer NOT NULL DEFAULT 10,
  "frequencia" "scan_frequency" NOT NULL DEFAULT 'semanal',
  "parametros_prompt" jsonb,
  "ativa" boolean NOT NULL DEFAULT true,
  "ultima_varredura" timestamp,
  "criado_em" timestamp DEFAULT now() NOT NULL
);
