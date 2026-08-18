ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bot';
UPDATE public.trades SET source = 'bot' WHERE source IS NULL;
ALTER TABLE public.trades ADD CONSTRAINT trades_source_chk CHECK (source IN ('bot','manual'));
CREATE INDEX IF NOT EXISTS trades_source_idx ON public.trades (source);

ALTER TABLE public.trade_reviews ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bot';
ALTER TABLE public.trade_reviews ADD CONSTRAINT trade_reviews_source_chk CHECK (source IN ('bot','manual'));
CREATE INDEX IF NOT EXISTS trade_reviews_source_idx ON public.trade_reviews (source);