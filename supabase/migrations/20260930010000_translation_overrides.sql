-- Admin-edited translations. The bundled catalogue in lib/i18n/messages stays the default; a row here
-- replaces the value for one (locale, key). Deleting the row restores the bundled text.

CREATE TABLE IF NOT EXISTS public.translation_overrides (
  locale text NOT NULL CHECK (locale IN ('en')),
  key text NOT NULL,
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 2000),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (locale, key)
);

REVOKE ALL ON public.translation_overrides FROM PUBLIC, anon, authenticated;
ALTER TABLE public.translation_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_data_api_clients" ON public.translation_overrides;
CREATE POLICY "deny_data_api_clients" ON public.translation_overrides AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
