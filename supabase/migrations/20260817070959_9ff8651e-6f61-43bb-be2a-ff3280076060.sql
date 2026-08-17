ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS blocked_hours_utc integer[] NOT NULL DEFAULT ARRAY[2,14,18,19,20,21]::integer[];

UPDATE public.bot_settings SET blocked_hours_utc = ARRAY[2,14,18,19,20,21]::integer[] WHERE blocked_hours_utc IS NULL OR array_length(blocked_hours_utc,1) IS NULL;