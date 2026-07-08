UPDATE public.bot_settings SET max_daily_loss = 10, updated_at = now() WHERE id = 1;
ALTER TABLE public.bot_settings ALTER COLUMN max_daily_loss SET DEFAULT 10.0;