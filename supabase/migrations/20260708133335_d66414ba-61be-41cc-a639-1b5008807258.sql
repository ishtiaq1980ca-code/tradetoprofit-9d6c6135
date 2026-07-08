
-- Prompt 1 + 4 + 5 groundwork: pair_settings table, daily_profit_target on bot_settings, execution_log table.

-- 1. pair_settings (global, admin-editable single row per symbol)
CREATE TABLE public.pair_settings (
  symbol text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  ema_fast integer NOT NULL DEFAULT 50,
  ema_slow integer NOT NULL DEFAULT 200,
  rsi_period integer NOT NULL DEFAULT 14,
  rsi_lower numeric NOT NULL DEFAULT 30,
  rsi_upper numeric NOT NULL DEFAULT 70,
  adx_min numeric NOT NULL DEFAULT 20,
  atr_period integer NOT NULL DEFAULT 14,
  atr_sl_mult numeric NOT NULL DEFAULT 2.8,
  rr_target numeric NOT NULL DEFAULT 2.15,
  max_spread_pct numeric NOT NULL DEFAULT 0.03,
  min_confidence numeric NOT NULL DEFAULT 85,
  risk_per_trade_pct numeric NOT NULL DEFAULT 0.75,
  max_lot numeric NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pair_settings TO authenticated;
GRANT ALL ON public.pair_settings TO service_role;

ALTER TABLE public.pair_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pair_settings licensed read" ON public.pair_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_active_license(auth.uid()));

CREATE POLICY "pair_settings admin write" ON public.pair_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER pair_settings_updated BEFORE UPDATE ON public.pair_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed defaults for the 7 FX pairs + XAUUSD
INSERT INTO public.pair_settings (symbol, adx_min, atr_sl_mult, rr_target, max_spread_pct, min_confidence, risk_per_trade_pct, max_lot) VALUES
  ('EURUSD', 12, 2.8, 2.15, 0.02,  85, 0.75, 1.0),
  ('GBPUSD', 14, 3.0, 2.15, 0.025, 85, 0.75, 1.0),
  ('USDJPY', 14, 3.0, 2.15, 0.02,  85, 0.75, 1.0),
  ('AUDUSD', 12, 2.8, 2.15, 0.025, 85, 0.75, 1.0),
  ('NZDUSD', 12, 2.8, 2.15, 0.03,  85, 0.75, 1.0),
  ('USDCAD', 12, 2.8, 2.15, 0.025, 85, 0.75, 1.0),
  ('USDCHF', 12, 2.8, 2.15, 0.025, 85, 0.75, 1.0),
  ('XAUUSD', 10, 3.0, 2.20, 0.08,  85, 0.50, 0.5);

-- 2. daily_profit_target on bot_settings
ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS daily_profit_target numeric NOT NULL DEFAULT 5.0;

-- 3. execution_log (bridge-side attempts, retries, errors)
CREATE TABLE public.execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  side text,
  action text NOT NULL,
  retcode integer,
  retry_count integer NOT NULL DEFAULT 0,
  latency_ms integer,
  mt5_ticket bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_execution_log_created ON public.execution_log (created_at DESC);
CREATE INDEX idx_execution_log_symbol ON public.execution_log (symbol, created_at DESC);

GRANT SELECT ON public.execution_log TO authenticated;
GRANT ALL ON public.execution_log TO service_role;

ALTER TABLE public.execution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "execution_log licensed read" ON public.execution_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_active_license(auth.uid()));
