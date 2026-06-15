import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { updateBotSettings } from "@/lib/settings.functions";
import { useBot, triggerManualScan } from "@/lib/tradingBot";
import { useAccount } from "@/lib/paperTrading";
import { toast } from "sonner";
import { Bot, Play, Pause, RotateCcw, Save, Zap } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — AurumAI" }, { name: "description", content: "Configure strategy parameters, risk limits, and trading mode." }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const bot = useBot();
  const resetAccount = useAccount((s) => s.reset);
  const { data } = useQuery({
    queryKey: ["bot_settings"],
    queryFn: async () => (await supabase.from("bot_settings").select("*").eq("id", 1).maybeSingle()).data,
  });
  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  const save = async () => {
    try {
      await updateBotSettings({
        data: {
          enabled: !!form.enabled, account_mode: form.account_mode,
          risk_per_trade: +form.risk_per_trade, max_daily_loss: +form.max_daily_loss,
          ema_fast: +form.ema_fast, ema_slow: +form.ema_slow, rsi_period: +form.rsi_period,
          adx_min: +form.adx_min, atr_period: +form.atr_period, atr_sl_mult: +form.atr_sl_mult,
          atr_tp_mult: +form.atr_tp_mult, trailing_atr_mult: +form.trailing_atr_mult,
          min_confidence: +form.min_confidence, max_spread_pips: +form.max_spread_pips,
          partial_close_pct: +form.partial_close_pct,
        },
      });
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["bot_settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    }
  };

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6 max-w-4xl">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Strategy, risk, and execution controls. Changes apply on next signal scan.</p>
        </header>

        <Card className="border-border/60 bg-card/70">
          <CardHeader><CardTitle className="text-base">Bot Mode</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center justify-between md:col-span-2 rounded-md border border-border/60 bg-background/40 px-4 py-3">
              <div>
                <div className="font-medium">Bot enabled</div>
                <div className="text-xs text-muted-foreground">When off, no new signals are queued for MT5.</div>
              </div>
              <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
            </div>
            <F label="Account">
              <Select value={form.account_mode} onValueChange={(v) => set("account_mode", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="demo">Demo</SelectItem>
                  <SelectItem value="real">Real (live money)</SelectItem>
                </SelectContent>
              </Select>
            </F>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/70">
          <CardHeader><CardTitle className="text-base">Risk Management</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <F label="Risk per trade (%)"><N v={form.risk_per_trade} on={(v) => set("risk_per_trade", v)} step="0.05" /></F>
            <F label="Max daily loss (%)"><N v={form.max_daily_loss} on={(v) => set("max_daily_loss", v)} step="0.1" /></F>
            <F label="Min confidence (%)"><N v={form.min_confidence} on={(v) => set("min_confidence", v)} /></F>
            <F label="Max spread (pips)"><N v={form.max_spread_pips} on={(v) => set("max_spread_pips", v)} /></F>
            <F label="Partial close (%)"><N v={form.partial_close_pct} on={(v) => set("partial_close_pct", v)} /></F>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/70">
          <CardHeader><CardTitle className="text-base">Strategy Parameters</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <F label="EMA fast"><N v={form.ema_fast} on={(v) => set("ema_fast", v)} /></F>
            <F label="EMA slow"><N v={form.ema_slow} on={(v) => set("ema_slow", v)} /></F>
            <F label="RSI period"><N v={form.rsi_period} on={(v) => set("rsi_period", v)} /></F>
            <F label="ADX min"><N v={form.adx_min} on={(v) => set("adx_min", v)} /></F>
            <F label="ATR period"><N v={form.atr_period} on={(v) => set("atr_period", v)} /></F>
            <F label="ATR SL multiplier"><N v={form.atr_sl_mult} on={(v) => set("atr_sl_mult", v)} step="0.1" /></F>
            <F label="ATR TP multiplier"><N v={form.atr_tp_mult} on={(v) => set("atr_tp_mult", v)} step="0.1" /></F>
            <F label="Trailing ATR ×"><N v={form.trailing_atr_mult} on={(v) => set("trailing_atr_mult", v)} step="0.1" /></F>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={save}><Save className="mr-1.5 h-4 w-4" /> Save settings</Button>
        </div>
      </div>
    </AppShell>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
function N({ v, on, step = "1" }: { v: number; on: (v: number) => void; step?: string }) {
  return <Input type="number" step={step} value={v} onChange={(e) => on(+e.target.value)} />;
}
