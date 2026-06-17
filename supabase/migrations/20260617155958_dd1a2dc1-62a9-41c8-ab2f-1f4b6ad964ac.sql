
-- 1) Remove the over-permissive claim policy
DROP POLICY IF EXISTS "tokens claim or own update" ON public.license_tokens;

-- Owners can still update fields on tokens already bound to them (e.g. mt5_account),
-- but they cannot reassign user_id or claim unowned tokens.
CREATE POLICY "tokens owner update"
  ON public.license_tokens
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2) Token redemption via SECURITY DEFINER, requiring the token string
CREATE OR REPLACE FUNCTION public.redeem_license_token(
  _token text,
  _mt5_account text DEFAULT NULL
)
RETURNS public.license_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  out_row public.license_tokens;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _token IS NULL OR length(trim(_token)) = 0 THEN
    RAISE EXCEPTION 'Token required';
  END IF;

  UPDATE public.license_tokens
     SET user_id     = uid,
         mt5_account = COALESCE(_mt5_account, mt5_account),
         redeemed_at = now()
   WHERE token = upper(trim(_token))
     AND status = 'active'
     AND expires_at > now()
     AND user_id IS NULL
  RETURNING * INTO out_row;

  IF out_row.id IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or already-claimed token';
  END IF;

  RETURN out_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_license_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_license_token(text, text) TO authenticated;

-- 3) Lock down user_roles writes — only service_role (and SECURITY DEFINER fns
--    running as table owner) may insert/update/delete. authenticated/anon get
--    SELECT only (read is needed for has_role checks via RLS context).
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated, PUBLIC;
GRANT  SELECT ON public.user_roles TO authenticated;
GRANT  ALL    ON public.user_roles TO service_role;
