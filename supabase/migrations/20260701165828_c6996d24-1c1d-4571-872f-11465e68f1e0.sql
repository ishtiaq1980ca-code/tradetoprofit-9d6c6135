
ALTER TABLE public.account_snapshots ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE INDEX IF NOT EXISTS idx_account_snapshots_user_id ON public.account_snapshots(user_id);

DROP POLICY IF EXISTS "snap licensed read" ON public.account_snapshots;
CREATE POLICY "snap owner or admin read" ON public.account_snapshots
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR user_id = auth.uid()
  );
