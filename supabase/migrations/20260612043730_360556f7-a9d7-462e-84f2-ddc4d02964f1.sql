
-- Bot settings (single row, id=1)
CREATE TABLE public.bot_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT false,
  account_mode TEXT NOT NULL DEFAULT 'demo' CHECK (account_mode IN ('demo','real')),
  symbols TEXT[] NOT NULL DEFAULT ARRAY['XAUUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF'],
  risk_per_trade NUMERIC NOT NULL DEFAULT 0.75,
  max_daily_loss NUMERIC NOT NULL DEFAULT 3.0,
  ema_fast INTEGER NOT NULL DEFAULT 50,
  ema_slow INTEGER NOT NULL DEFAULT 200,
  rsi_period INTEGER NOT NULL DEFAULT 14,
  adx_min NUMERIC NOT NULL DEFAULT 20,
  atr_period INTEGER NOT NULL DEFAULT 14,
  atr_sl_mult NUMERIC NOT NULL DEFAULT 1.5,
  atr_tp_mult NUMERIC NOT NULL DEFAULT 3.0,
  trailing_atr_mult NUMERIC NOT NULL DEFAULT 1.0,
  min_confidence NUMERIC NOT NULL DEFAULT 75,
  max_spread_pips NUMERIC NOT NULL DEFAULT 30,
  partial_close_pct NUMERIC NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);
GRANT SELECT, INSERT, UPDATE ON public.bot_settings TO anon, authenticated;
GRANT ALL ON public.bot_settings TO service_role;
ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings public read" ON public.bot_settings FOR SELECT USING (true);
CREATE POLICY "settings public write" ON public.bot_settings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "settings public insert" ON public.bot_settings FOR INSERT WITH CHECK (true);

INSERT INTO public.bot_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Signals queued for the MT5 bridge
CREATE TABLE public.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  entry NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  take_profit NUMERIC NOT NULL,
  lot NUMERIC NOT NULL,
  risk_pct NUMERIC NOT NULL,
  confidence NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','executed','rejected','expired')),
  mt5_ticket BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.signals TO anon, authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signals public read" ON public.signals FOR SELECT USING (true);
CREATE POLICY "signals public write" ON public.signals FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "signals public insert" ON public.signals FOR INSERT WITH CHECK (true);
CREATE INDEX idx_signals_status ON public.signals(status, created_at DESC);

-- Trades log
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  mt5_ticket BIGINT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  entry NUMERIC NOT NULL,
  exit NUMERIC,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  lot NUMERIC NOT NULL,
  profit NUMERIC,
  pips NUMERIC,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.trades TO anon, authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trades public read" ON public.trades FOR SELECT USING (true);
CREATE POLICY "trades public write" ON public.trades FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "trades public insert" ON public.trades FOR INSERT WITH CHECK (true);
CREATE INDEX idx_trades_status ON public.trades(status, opened_at DESC);

-- Account snapshots from the bridge
CREATE TABLE public.account_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  balance NUMERIC NOT NULL,
  equity NUMERIC NOT NULL,
  margin NUMERIC NOT NULL DEFAULT 0,
  free_margin NUMERIC NOT NULL DEFAULT 0,
  open_positions INTEGER NOT NULL DEFAULT 0,
  daily_pnl NUMERIC NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'demo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.account_snapshots TO anon, authenticated;
GRANT ALL ON public.account_snapshots TO service_role;
ALTER TABLE public.account_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snap public read" ON public.account_snapshots FOR SELECT USING (true);
CREATE POLICY "snap public insert" ON public.account_snapshots FOR INSERT WITH CHECK (true);
CREATE INDEX idx_snap_created ON public.account_snapshots(created_at DESC);

-- Backtest runs
CREATE TABLE public.backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  start_balance NUMERIC NOT NULL,
  end_balance NUMERIC NOT NULL,
  total_trades INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  win_rate NUMERIC NOT NULL,
  profit_factor NUMERIC NOT NULL,
  max_drawdown NUMERIC NOT NULL,
  net_profit NUMERIC NOT NULL,
  params JSONB NOT NULL,
  equity_curve JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.backtest_runs TO anon, authenticated;
GRANT ALL ON public.backtest_runs TO service_role;
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bt public read" ON public.backtest_runs FOR SELECT USING (true);
CREATE POLICY "bt public insert" ON public.backtest_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "bt public delete" ON public.backtest_runs FOR DELETE USING (true);

-- updated_at trigger for settings
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER bot_settings_updated BEFORE UPDATE ON public.bot_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
