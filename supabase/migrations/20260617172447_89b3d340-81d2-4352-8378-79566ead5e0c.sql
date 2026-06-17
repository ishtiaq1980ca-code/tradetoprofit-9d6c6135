CREATE TABLE public.strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  symbol text,
  enabled boolean NOT NULL DEFAULT true,
  min_confidence integer NOT NULL DEFAULT 40,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.strategies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.strategies TO authenticated;
GRANT ALL ON public.strategies TO service_role;

ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view strategies"
  ON public.strategies FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert strategies"
  ON public.strategies FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update strategies"
  ON public.strategies FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete strategies"
  ON public.strategies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER strategies_set_updated_at
  BEFORE UPDATE ON public.strategies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();