GRANT INSERT ON public.signals TO authenticated;
GRANT UPDATE, INSERT ON public.bot_settings TO authenticated;

DROP POLICY IF EXISTS "signals authenticated insert" ON public.signals;
CREATE POLICY "signals authenticated insert"
  ON public.signals FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "bot_settings authenticated update" ON public.bot_settings;
CREATE POLICY "bot_settings authenticated update"
  ON public.bot_settings FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bot_settings authenticated insert" ON public.bot_settings;
CREATE POLICY "bot_settings authenticated insert"
  ON public.bot_settings FOR INSERT TO authenticated
  WITH CHECK (true);

INSERT INTO public.bot_settings (id, enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;