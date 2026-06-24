
-- 1) Tighten read access on shared bot data tables: only admins or active license holders may read.
DROP POLICY IF EXISTS "snap authenticated read" ON public.account_snapshots;
DROP POLICY IF EXISTS "bt authenticated read" ON public.backtest_runs;
DROP POLICY IF EXISTS "trades authenticated read" ON public.trades;

CREATE POLICY "snap licensed read"
  ON public.account_snapshots FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_active_license(auth.uid()));

CREATE POLICY "bt licensed read"
  ON public.backtest_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_active_license(auth.uid()));

CREATE POLICY "trades licensed read"
  ON public.trades FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_active_license(auth.uid()));

-- 2) Revoke EXECUTE on SECURITY DEFINER functions from anon/public.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.has_active_license(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_license(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_generate_token(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_generate_token(text, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_admin_if_none() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_admin_if_none() TO authenticated;

REVOKE ALL ON FUNCTION public.list_users_basic() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_users_basic() TO authenticated;

REVOKE ALL ON FUNCTION public.redeem_license_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_license_token(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_bot_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bot_enabled(boolean) TO authenticated;
