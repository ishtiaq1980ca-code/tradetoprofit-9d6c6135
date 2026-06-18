
-- Lock down bot_settings writes to admins only
DROP POLICY IF EXISTS "bot_settings authenticated insert" ON public.bot_settings;
DROP POLICY IF EXISTS "bot_settings authenticated update" ON public.bot_settings;

CREATE POLICY "bot_settings admin insert" ON public.bot_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "bot_settings admin update" ON public.bot_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Remove overly broad owner-update on license_tokens.
-- Token redemption goes through the SECURITY DEFINER redeem_license_token RPC.
DROP POLICY IF EXISTS "tokens owner update" ON public.license_tokens;

-- Helper: does the caller hold an active, non-expired license?
CREATE OR REPLACE FUNCTION public.has_active_license(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.license_tokens
    WHERE user_id = _user_id
      AND status = 'active'
      AND expires_at > now()
  )
$$;

-- Restrict signal injection: only admins or licensed users (whose bots
-- legitimately queue trades) can insert into signals.
DROP POLICY IF EXISTS "signals authenticated insert" ON public.signals;

CREATE POLICY "signals licensed insert" ON public.signals
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_active_license(auth.uid())
  );
