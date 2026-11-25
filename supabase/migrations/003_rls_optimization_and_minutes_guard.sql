-- ============================================================================
-- MIGRAÇÃO 003 (Recomendada): Blindagem RLS, Trigger Fallback de Minutos e Segurança
-- Execute no SQL Editor do Supabase caso deseje eliminar os avisos dos Advisors
-- ============================================================================

-- 1. Trigger de fallback e consistência para bh_entries (minutes <-> hours)
CREATE OR REPLACE FUNCTION public.bh_sync_entry_minutes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.minutes IS NULL AND NEW.hours IS NOT NULL THEN
    NEW.minutes := ROUND(NEW.hours * 60)::integer;
  END IF;
  IF NEW.hours IS NULL AND NEW.minutes IS NOT NULL THEN
    NEW.hours := ROUND((NEW.minutes::numeric / 60.0), 4);
  END IF;
  IF NEW.worked_minutes IS NULL THEN
    NEW.worked_minutes := NEW.minutes;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bh_entries_sync_minutes ON public.bh_entries;
CREATE TRIGGER trg_bh_entries_sync_minutes
  BEFORE INSERT OR UPDATE ON public.bh_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.bh_sync_entry_minutes();

-- 2. Trigger de updated_at e fallback para bh_params (daily_minutes <-> daily_hours)
CREATE OR REPLACE FUNCTION public.bh_touch_params_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.daily_minutes IS NULL AND NEW.daily_hours IS NOT NULL THEN
    NEW.daily_minutes := ROUND(NEW.daily_hours * 60)::integer;
  END IF;
  IF NEW.daily_hours IS NULL AND NEW.daily_minutes IS NOT NULL THEN
    NEW.daily_hours := ROUND((NEW.daily_minutes::numeric / 60.0), 4);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bh_params_updated_at ON public.bh_params;
CREATE TRIGGER trg_bh_params_updated_at
  BEFORE INSERT OR UPDATE ON public.bh_params
  FOR EACH ROW
  EXECUTE FUNCTION public.bh_touch_params_updated_at();

-- 3. Otimização de RLS (initplan): evita reavaliação de auth.uid() por linha
DROP POLICY IF EXISTS bh_params_owner_all ON public.bh_params;
CREATE POLICY bh_params_owner_all
  ON public.bh_params
  FOR ALL
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS bh_entries_owner_all ON public.bh_entries;
CREATE POLICY bh_entries_owner_all
  ON public.bh_entries
  FOR ALL
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- 4. Restringir função utilitária SECURITY DEFINER para não ficar exposta via RPC público
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
