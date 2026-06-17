
REVOKE EXECUTE ON FUNCTION public.claim_admin_if_none()                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_generate_token(text, integer, text)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_users_basic()                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_license_token(text, text)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)                 FROM PUBLIC, anon;
-- trigger function never needs direct execute
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                               FROM PUBLIC, anon, authenticated;
