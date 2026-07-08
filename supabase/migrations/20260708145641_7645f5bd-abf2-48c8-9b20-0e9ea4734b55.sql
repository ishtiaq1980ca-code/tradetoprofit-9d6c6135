
-- Add restrictive deny-write policies for authenticated and anon roles.
-- Service role bypasses RLS, so backend/bridge writes continue to work.

CREATE POLICY "Deny client inserts" ON public.account_snapshots FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "Deny client updates" ON public.account_snapshots FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "Deny client deletes" ON public.account_snapshots FOR DELETE TO authenticated, anon USING (false);

CREATE POLICY "Deny client inserts" ON public.backtest_runs FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "Deny client updates" ON public.backtest_runs FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "Deny client deletes" ON public.backtest_runs FOR DELETE TO authenticated, anon USING (false);

CREATE POLICY "Deny client inserts" ON public.execution_log FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "Deny client updates" ON public.execution_log FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "Deny client deletes" ON public.execution_log FOR DELETE TO authenticated, anon USING (false);

CREATE POLICY "Deny client inserts" ON public.trades FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "Deny client updates" ON public.trades FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "Deny client deletes" ON public.trades FOR DELETE TO authenticated, anon USING (false);
