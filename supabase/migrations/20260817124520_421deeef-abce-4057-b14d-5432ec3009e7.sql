
CREATE TABLE IF NOT EXISTS public.engine_candles (
  symbol text PRIMARY KEY,
  candles jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.engine_candles TO service_role;
ALTER TABLE public.engine_candles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.engine_lock (
  id integer PRIMARY KEY,
  locked_until timestamptz NOT NULL DEFAULT now(),
  holder text,
  last_run_at timestamptz,
  last_result jsonb
);
GRANT ALL ON public.engine_lock TO service_role;
ALTER TABLE public.engine_lock ENABLE ROW LEVEL SECURITY;
INSERT INTO public.engine_lock (id, locked_until) VALUES (1, now())
ON CONFLICT (id) DO NOTHING;
