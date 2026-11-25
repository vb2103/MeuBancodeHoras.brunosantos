-- ============================================================================
-- MIGRAÇÃO 001: Estrutura Inicial (bh_params & bh_entries) + RLS
-- Documentação do schema base do projeto SaldoHoras no Supabase
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bh_params (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text,
  daily_hours numeric NOT NULL DEFAULT 8,
  expiry_days integer NOT NULL DEFAULT 180,
  manager_email text,
  manager_phone text
);

CREATE TABLE IF NOT EXISTS public.bh_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  title text NOT NULL,
  type text NOT NULL CHECK (type IN ('credit', 'debit')),
  hours numeric NOT NULL,
  status text NOT NULL CHECK (status IN ('realized', 'planned')),
  expiry date,
  notes text
);

ALTER TABLE public.bh_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bh_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bh_params_owner_all ON public.bh_params;
CREATE POLICY bh_params_owner_all
  ON public.bh_params
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS bh_entries_owner_all ON public.bh_entries;
CREATE POLICY bh_entries_owner_all
  ON public.bh_entries
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
