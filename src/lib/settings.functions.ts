import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SettingsSchema = z.object({
  enabled: z.boolean(),
  account_mode: z.enum(["demo", "real"]),
  risk_per_trade: z.number().min(0).max(10),
  max_daily_loss: z.number().min(0).max(100),
  ema_fast: z.number().int().min(2).max(500),
  ema_slow: z.number().int().min(2).max(1000),
  rsi_period: z.number().int().min(2).max(200),
  adx_min: z.number().min(0).max(100),
  atr_period: z.number().int().min(2).max(200),
  atr_sl_mult: z.number().min(0).max(20),
  atr_tp_mult: z.number().min(0).max(20),
  trailing_atr_mult: z.number().min(0).max(20),
  min_confidence: z.number().min(0).max(100),
  max_spread_pips: z.number().min(0).max(1000),
  partial_close_pct: z.number().min(0).max(100),
});

export const updateBotSettings = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SettingsSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("bot_settings").update(data).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
