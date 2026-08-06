CREATE TABLE public.close_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  mt5_ticket bigint not null,
  symbol text not null,
  side text not null,
  reason text not null,
  kind text not null default 'structure_invalidated',
  status text not null default 'pending',
  leased_at timestamptz,
  executed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

CREATE UNIQUE INDEX close_requests_open_ticket_idx
  ON public.close_requests (mt5_ticket)
  WHERE status IN ('pending','sent');

GRANT SELECT, INSERT ON public.close_requests TO authenticated;
GRANT ALL ON public.close_requests TO service_role;

ALTER TABLE public.close_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "close_requests owner read" ON public.close_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "close_requests owner insert" ON public.close_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);