
CREATE OR REPLACE FUNCTION public.set_bot_enabled(_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(uid, 'admin'::app_role) OR public.has_active_license(uid)) THEN
    RAISE EXCEPTION 'Active license required';
  END IF;
  UPDATE public.bot_settings SET enabled = _enabled, updated_at = now() WHERE id = 1;
  RETURN _enabled;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_bot_enabled(boolean) TO authenticated;

-- Turn it on now so the bridge starts executing the queued signals
UPDATE public.bot_settings SET enabled = true WHERE id = 1;
