CREATE TABLE public.economic_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  currency text NOT NULL,
  impact text NOT NULL,
  at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'feed',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (at, currency, title)
);
GRANT SELECT ON public.economic_events TO anon;
GRANT SELECT ON public.economic_events TO authenticated;
GRANT ALL ON public.economic_events TO service_role;
ALTER TABLE public.economic_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Economic events are readable by everyone" ON public.economic_events FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.calendar_feed_state (
  id integer NOT NULL PRIMARY KEY DEFAULT 1,
  last_ok timestamptz,
  last_attempt timestamptz,
  last_error text,
  backoff_until timestamptz,
  event_count integer NOT NULL DEFAULT 0,
  active_source text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_feed_state_singleton CHECK (id = 1)
);
GRANT SELECT ON public.calendar_feed_state TO anon;
GRANT SELECT ON public.calendar_feed_state TO authenticated;
GRANT ALL ON public.calendar_feed_state TO service_role;
ALTER TABLE public.calendar_feed_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Calendar feed state readable by everyone" ON public.calendar_feed_state FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.calendar_feed_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE INDEX economic_events_at_idx ON public.economic_events (at);