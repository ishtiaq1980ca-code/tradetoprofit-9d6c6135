
DROP POLICY IF EXISTS "snap public read" ON public.account_snapshots;
DROP POLICY IF EXISTS "signals public read" ON public.signals;
DROP POLICY IF EXISTS "trades public read" ON public.trades;
DROP POLICY IF EXISTS "bt public read" ON public.backtest_runs;
DROP POLICY IF EXISTS "settings public read" ON public.bot_settings;

REVOKE SELECT ON public.account_snapshots, public.signals, public.trades, public.backtest_runs, public.bot_settings FROM anon;

CREATE POLICY "snap authenticated read" ON public.account_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "signals authenticated read" ON public.signals FOR SELECT TO authenticated USING (true);
CREATE POLICY "trades authenticated read" ON public.trades FOR SELECT TO authenticated USING (true);
CREATE POLICY "bt authenticated read" ON public.backtest_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings authenticated read" ON public.bot_settings FOR SELECT TO authenticated USING (true);
