
DROP POLICY IF EXISTS "settings authenticated read" ON public.bot_settings;
CREATE POLICY "bot_settings licensed read" ON public.bot_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_active_license(auth.uid()));

DROP POLICY IF EXISTS "signals authenticated read" ON public.signals;
CREATE POLICY "signals licensed read" ON public.signals
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_active_license(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can view strategies" ON public.strategies;
CREATE POLICY "strategies licensed read" ON public.strategies
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_active_license(auth.uid()));
