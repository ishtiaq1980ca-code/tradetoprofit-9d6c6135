ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconcile_note text,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS trades_status_opened_at_idx ON public.trades (status, opened_at DESC);

CREATE OR REPLACE FUNCTION public.flag_stale_open_trades(_max_age_days integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.trades
     SET needs_review = true,
         reconcile_note = COALESCE(reconcile_note, 'No broker close report within ' || _max_age_days || ' days — flagged for review')
   WHERE status = 'open'
     AND needs_review = false
     AND opened_at < now() - make_interval(days => _max_age_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.flag_stale_open_trades(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_stale_open_trades(integer) TO service_role;