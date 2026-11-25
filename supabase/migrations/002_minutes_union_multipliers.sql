-- ============================================================================
-- MIGRAÇÃO 002: Precisão em Minutos (HH:MM), Sindicato/Ramo e Multiplicadores
-- Aplicada no Supabase em 2026-11-24
-- ============================================================================

ALTER TABLE public.bh_params
  ADD COLUMN IF NOT EXISTS daily_minutes integer,
  ADD COLUMN IF NOT EXISTS union_mode text DEFAULT 'sector' CHECK (union_mode IN ('union', 'sector', 'custom')),
  ADD COLUMN IF NOT EXISTS union_code text DEFAULT 'ti_sindpd',
  ADD COLUMN IF NOT EXISTS company_sector text DEFAULT 'tecnologia',
  ADD COLUMN IF NOT EXISTS overtime_multiplier numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS holiday_multiplier numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS state_uf text DEFAULT 'SP',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.bh_params
SET daily_minutes = ROUND(COALESCE(daily_hours, 8) * 60)::integer
WHERE daily_minutes IS NULL;

ALTER TABLE public.bh_params
  ALTER COLUMN daily_minutes SET DEFAULT 480,
  ALTER COLUMN daily_minutes SET NOT NULL;

ALTER TABLE public.bh_entries
  ADD COLUMN IF NOT EXISTS minutes integer,
  ADD COLUMN IF NOT EXISTS worked_minutes integer,
  ADD COLUMN IF NOT EXISTS multiplier numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'manual' CHECK (category IN ('holiday', 'overtime', 'time_off', 'adjustment', 'manual')),
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE public.bh_entries
SET
  minutes = ROUND(COALESCE(hours, 0) * 60)::integer,
  worked_minutes = ROUND(COALESCE(hours, 0) * 60)::integer
WHERE minutes IS NULL;

ALTER TABLE public.bh_entries
  ALTER COLUMN minutes SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bh_entries_user_date
  ON public.bh_entries (user_id, date ASC, created_at ASC);
