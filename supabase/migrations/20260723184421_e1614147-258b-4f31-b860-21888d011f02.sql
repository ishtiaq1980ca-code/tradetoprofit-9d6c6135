
-- Add user_id ownership to trades and backtest_runs, then scope SELECT policies
-- so each licensed user only sees their own rows (admin still sees all).

ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS trades_user_id_idx ON public.trades(user_id);

ALTER TABLE public.backtest_runs ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS backtest_runs_user_id_idx ON public.backtest_runs(user_id);

-- Backfill trades.user_id from the license_tokens.mt5_account mapping when possible.
-- Trades have no account column, so we can only backfill when a single license
-- owner is present; leave NULL otherwise (admin still reads them).
-- Skipped: no reliable join key available. Historical rows remain NULL and are
-- only visible to admins under the new policy.

DROP POLICY IF EXISTS "trades licensed read" ON public.trades;
CREATE POLICY "trades owner or admin read"
  ON public.trades FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (user_id IS NOT NULL AND auth.uid() = user_id)
  );

DROP POLICY IF EXISTS "bt licensed read" ON public.backtest_runs;
CREATE POLICY "backtest owner or admin read"
  ON public.backtest_runs FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (user_id IS NOT NULL AND auth.uid() = user_id)
  );
