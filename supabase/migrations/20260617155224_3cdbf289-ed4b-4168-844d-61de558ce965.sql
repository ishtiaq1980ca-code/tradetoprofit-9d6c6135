
-- One-shot bootstrap: first user can claim admin if no admin exists yet
CREATE OR REPLACE FUNCTION public.claim_admin_if_none()
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
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin')
  ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_admin_if_none() TO authenticated;

-- Admin: generate a license token in one call
CREATE OR REPLACE FUNCTION public.admin_generate_token(
  _token text,
  _days integer DEFAULT 30,
  _notes text DEFAULT NULL
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
  IF uid IS NULL OR NOT public.has_role(uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  INSERT INTO public.license_tokens (token, expires_at, notes, created_by, status)
  VALUES (upper(_token), now() + make_interval(days => _days), _notes, uid, 'active')
  RETURNING * INTO out_row;
  RETURN out_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_generate_token(text, integer, text) TO authenticated;

-- Admin: list users with their license summary
CREATE OR REPLACE FUNCTION public.list_users_basic()
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  is_admin boolean,
  active_token text,
  token_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.display_name,
    public.has_role(p.id, 'admin'::app_role),
    lt.token,
    lt.expires_at
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT token, expires_at FROM public.license_tokens
    WHERE user_id = p.id AND status = 'active'
    ORDER BY expires_at DESC LIMIT 1
  ) lt ON true
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_users_basic() TO authenticated;
