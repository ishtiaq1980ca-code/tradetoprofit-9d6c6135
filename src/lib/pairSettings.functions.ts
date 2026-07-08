import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PairSettingRow = {
  symbol: string;
  enabled: boolean;
  ema_fast: number;
  ema_slow: number;
  rsi_period: number;
  rsi_lower: number;
  rsi_upper: number;
  adx_min: number;
  atr_period: number;
  atr_sl_mult: number;
  rr_target: number;
  max_spread_pct: number;
  min_confidence: number;
  risk_per_trade_pct: number;
  max_lot: number;
};

const RowSchema = z.object({
  symbol: z.string().min(3),
  enabled: z.boolean(),
  ema_fast: z.number().int().min(2).max(500),
  ema_slow: z.number().int().min(2).max(1000),
  rsi_period: z.number().int().min(2).max(200),
  rsi_lower: z.number().min(0).max(100),
  rsi_upper: z.number().min(0).max(100),
  adx_min: z.number().min(0).max(100),
  atr_period: z.number().int().min(2).max(200),
  atr_sl_mult: z.number().min(0).max(20),
  rr_target: z.number().min(0.5).max(10),
  max_spread_pct: z.number().min(0).max(5),
  min_confidence: z.number().min(0).max(100),
  risk_per_trade_pct: z.number().min(0).max(10),
  max_lot: z.number().min(0.01).max(50),
});

export const listPairSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pair_settings")
      .select("*")
      .order("symbol", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PairSettingRow[];
  });

export const upsertPairSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => RowSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("pair_settings")
      .upsert(data, { onConflict: "symbol" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
