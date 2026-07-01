ALTER TABLE public.account_snapshots
  ADD COLUMN IF NOT EXISTS login text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS server text,
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS leverage integer;
CREATE INDEX IF NOT EXISTS idx_snap_login_created ON public.account_snapshots(login, created_at DESC);