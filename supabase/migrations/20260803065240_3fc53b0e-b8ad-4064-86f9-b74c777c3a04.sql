CREATE TABLE public.trade_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES public.trades(id) ON DELETE CASCADE,
  mt5_ticket bigint,
  symbol text NOT NULL,
  side text NOT NULL,
  opened_at timestamptz,
  closed_at timestamptz,
  duration_sec integer,
  entry numeric,
  exit numeric,
  stop_loss numeric,
  take_profit numeric,
  lot numeric,
  profit numeric,
  pips numeric,
  r_multiple numeric,
  outcome text NOT NULL DEFAULT 'breakeven',
  behavior text NOT NULL DEFAULT 'unknown',
  session text,
  htf_trend text,
  swing text,
  structure_note text,
  key_level numeric,
  atr numeric,
  atr_pct numeric,
  adx numeric,
  rsi numeric,
  quality_score numeric,
  confidence numeric,
  strategy text,
  pattern_keys text[] NOT NULL DEFAULT '{}',
  lessons text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX trade_reviews_user_trade_uidx ON public.trade_reviews (user_id, trade_id) WHERE trade_id IS NOT NULL;
CREATE UNIQUE INDEX trade_reviews_user_ticket_uidx ON public.trade_reviews (user_id, mt5_ticket) WHERE mt5_ticket IS NOT NULL;
CREATE INDEX trade_reviews_user_closed_idx ON public.trade_reviews (user_id, closed_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_reviews TO authenticated;
GRANT ALL ON public.trade_reviews TO service_role;

ALTER TABLE public.trade_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trade_reviews owner read" ON public.trade_reviews
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "trade_reviews owner insert" ON public.trade_reviews
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "trade_reviews owner update" ON public.trade_reviews
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "trade_reviews owner delete" ON public.trade_reviews
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trade_reviews_set_updated_at
  BEFORE UPDATE ON public.trade_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.strategy_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_key text NOT NULL,
  dimension text NOT NULL,
  adjustment numeric NOT NULL,
  previous_adjustment numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  win_rate numeric,
  avg_r numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX strategy_adjustments_user_created_idx ON public.strategy_adjustments (user_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.strategy_adjustments TO authenticated;
GRANT ALL ON public.strategy_adjustments TO service_role;

ALTER TABLE public.strategy_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_adjustments owner read" ON public.strategy_adjustments
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "strategy_adjustments owner insert" ON public.strategy_adjustments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "strategy_adjustments owner delete" ON public.strategy_adjustments
  FOR DELETE TO authenticated USING (auth.uid() = user_id);