
-- Remove permissive public write policies on all tables.
-- Reads stay public (single-user dashboard with no auth). Writes go through
-- server functions that use the service role and bypass RLS.

DROP POLICY IF EXISTS "settings public insert" ON public.bot_settings;
DROP POLICY IF EXISTS "settings public write"  ON public.bot_settings;

DROP POLICY IF EXISTS "signals public insert"  ON public.signals;
DROP POLICY IF EXISTS "signals public write"   ON public.signals;

DROP POLICY IF EXISTS "trades public insert"   ON public.trades;
DROP POLICY IF EXISTS "trades public write"    ON public.trades;

DROP POLICY IF EXISTS "snap public insert"     ON public.account_snapshots;

DROP POLICY IF EXISTS "bt public insert"       ON public.backtest_runs;
DROP POLICY IF EXISTS "bt public delete"       ON public.backtest_runs;

-- Revoke direct anon/authenticated write privileges. Service role retains
-- full access (used by server functions).
REVOKE INSERT, UPDATE, DELETE ON public.bot_settings       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.signals            FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.trades             FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.account_snapshots  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.backtest_runs      FROM anon, authenticated;

GRANT ALL ON public.bot_settings       TO service_role;
GRANT ALL ON public.signals            TO service_role;
GRANT ALL ON public.trades             TO service_role;
GRANT ALL ON public.account_snapshots  TO service_role;
GRANT ALL ON public.backtest_runs      TO service_role;
