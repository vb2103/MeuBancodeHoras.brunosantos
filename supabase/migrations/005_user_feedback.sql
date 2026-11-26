-- ============================================================================
-- MIGRAÇÃO 005: Canal de Feedback de Usuários (Sugestões e Problemas)
-- Execute no SQL Editor do Supabase (idempotente)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bh_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('sugestao', 'problema')),
  mensagem text NOT NULL CHECK (char_length(trim(mensagem)) BETWEEN 5 AND 2000),
  versao_app text NOT NULL DEFAULT '1.0.0',
  plataforma text NOT NULL CHECK (plataforma IN ('mobile', 'desktop')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bh_feedback_user_id
  ON public.bh_feedback (user_id);

-- Segurança e privacidade: usuários podem apenas enviar feedback, nunca ler feedbacks de terceiros
REVOKE ALL ON TABLE public.bh_feedback FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.bh_feedback TO anon, authenticated;

ALTER TABLE public.bh_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bh_feedback FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bh_feedback_insert_authenticated ON public.bh_feedback;
DROP POLICY IF EXISTS bh_feedback_insert_anon ON public.bh_feedback;

CREATE POLICY bh_feedback_insert_authenticated
  ON public.bh_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = (select auth.uid()));

CREATE POLICY bh_feedback_insert_anon
  ON public.bh_feedback
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);
