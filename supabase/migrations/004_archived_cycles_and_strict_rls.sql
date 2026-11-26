-- ============================================================================
-- MIGRAÇÃO 004: Ciclos Arquivados (jsonb) e Auditoria Estrita de RLS Multiusuário
-- Execute no SQL Editor do Supabase (idempotente)
-- ============================================================================

-- 1. Coluna archived_cycles em bh_params para sincronizar ciclos encerrados entre dispositivos
ALTER TABLE public.bh_params
  ADD COLUMN IF NOT EXISTS archived_cycles jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bh_params_archived_cycles_is_array'
      AND conrelid = 'public.bh_params'::regclass
  ) THEN
    ALTER TABLE public.bh_params
      ADD CONSTRAINT bh_params_archived_cycles_is_array
      CHECK (jsonb_typeof(archived_cycles) = 'array');
  END IF;
END $$;

-- 2. Bloqueio de acesso anônimo ou público nas tabelas do usuário
REVOKE ALL ON TABLE public.bh_params FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.bh_entries FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bh_params TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bh_entries TO authenticated;

-- 3. Ativação forçada de Row Level Security (RLS)
ALTER TABLE public.bh_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bh_params FORCE ROW LEVEL SECURITY;

ALTER TABLE public.bh_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bh_entries FORCE ROW LEVEL SECURITY;

-- 4. Políticas estritas e explícitas por operação (SELECT, INSERT, UPDATE, DELETE) em bh_params
DROP POLICY IF EXISTS bh_params_owner_all ON public.bh_params;
DROP POLICY IF EXISTS bh_params_owner_select ON public.bh_params;
DROP POLICY IF EXISTS bh_params_owner_insert ON public.bh_params;
DROP POLICY IF EXISTS bh_params_owner_update ON public.bh_params;
DROP POLICY IF EXISTS bh_params_owner_delete ON public.bh_params;

CREATE POLICY bh_params_owner_select
  ON public.bh_params
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY bh_params_owner_insert
  ON public.bh_params
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY bh_params_owner_update
  ON public.bh_params
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY bh_params_owner_delete
  ON public.bh_params
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- 5. Políticas estritas e explícitas por operação (SELECT, INSERT, UPDATE, DELETE) em bh_entries
DROP POLICY IF EXISTS bh_entries_owner_all ON public.bh_entries;
DROP POLICY IF EXISTS bh_entries_owner_select ON public.bh_entries;
DROP POLICY IF EXISTS bh_entries_owner_insert ON public.bh_entries;
DROP POLICY IF EXISTS bh_entries_owner_update ON public.bh_entries;
DROP POLICY IF EXISTS bh_entries_owner_delete ON public.bh_entries;

CREATE POLICY bh_entries_owner_select
  ON public.bh_entries
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY bh_entries_owner_insert
  ON public.bh_entries
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY bh_entries_owner_update
  ON public.bh_entries
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY bh_entries_owner_delete
  ON public.bh_entries
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);
