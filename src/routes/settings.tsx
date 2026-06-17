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
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { updateBotSettings } from "@/lib/settings.functions";
import { useBot, triggerManualScan } from "@/lib/tradingBot";
import { useAccount } from "@/lib/paperTrading";
import { SYMBOLS } from "@/lib/format";
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
    if (!form) return;
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

  const presetAggressive = () => {
    bot.setMinConfidence(35); bot.setRiskPct(1); bot.setAtrSlMult(2.0); bot.setAtrTpMult(0.5);
    bot.setEmaFast(9); bot.setEmaSlow(21); bot.setAdxMin(10); bot.setScanInterval(6_000); bot.setMaxOpenTrades(6);
    toast.success("Aggressive preset applied — many small wins");
  };
  const presetBalanced = () => {
    bot.setMinConfidence(40); bot.setRiskPct(1); bot.setAtrSlMult(2.5); bot.setAtrTpMult(0.7);
    bot.setEmaFast(9); bot.setEmaSlow(21); bot.setAdxMin(12); bot.setScanInterval(8_000); bot.setMaxOpenTrades(4);
    toast.success("Balanced preset applied (target ~80% win rate)");
  };
  const presetConservative = () => {
    bot.setMinConfidence(60); bot.setRiskPct(0.5); bot.setAtrSlMult(1.5); bot.setAtrTpMult(2.0);
    bot.setEmaFast(20); bot.setEmaSlow(50); bot.setAdxMin(20); bot.setScanInterval(30_000); bot.setMaxOpenTrades(2);
    toast.success("Conservative preset applied");
  };

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6 max-w-4xl">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Bot & Strategy Settings</h1>
          <p className="text-sm text-muted-foreground">Live controls for the paper-trading bot. Changes apply instantly to the next scan.</p>
        </header>

        <Card className="border-gold/30 bg-card/70">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Bot className="h-4 w-4 text-gold" /> Paper Trading Bot</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Runs locally in this browser. Scans every {Math.round(bot.scanIntervalMs / 1000)}s.</p>
            </div>
            <Badge variant="outline" className={bot.enabled ? "border-bull/40 text-bull" : "border-border text-muted-foreground"}>
              {bot.haltedToday ? "Halted (daily loss)" : bot.enabled ? "Active" : "Idle"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => { bot.setEnabled(!bot.enabled); if (!bot.enabled) triggerManualScan(); }} className={bot.enabled ? "bg-bear text-primary-foreground hover:bg-bear/90" : "bg-gold text-primary-foreground hover:bg-gold/90"}>
                {bot.enabled ? <><Pause className="mr-1 h-3.5 w-3.5" /> Stop bot</> : <><Play className="mr-1 h-3.5 w-3.5" /> Start bot</>}
              </Button>
              <Button size="sm" variant="outline" onClick={() => triggerManualScan()}><Zap className="mr-1 h-3.5 w-3.5" /> Scan now</Button>
              <Button size="sm" variant="outline" onClick={() => { bot.setHalted(false); toast.success("Daily halt cleared"); }}>Clear halt</Button>
              <Button size="sm" variant="outline" onClick={() => { if (confirm("Reset paper account to $10,000? All positions and history are wiped.")) { resetAccount(); toast.success("Account reset"); } }}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset account
              </Button>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Presets</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={presetAggressive}>Aggressive</Button>
                <Button size="sm" variant="outline" className="border-gold/40 text-gold" onClick={presetBalanced}>Balanced · 80% win-rate</Button>
                <Button size="sm" variant="outline" onClick={presetConservative}>Conservative</Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <F label="Min confidence (%)"><N v={bot.minConfidence} on={bot.setMinConfidence} /></F>
              <F label="Risk per trade (%)"><N v={bot.riskPct} on={bot.setRiskPct} step="0.1" /></F>
              <F label="Max daily loss (%)"><N v={bot.maxDailyLossPct} on={bot.setMaxDailyLossPct} step="0.5" /></F>
              <F label="Scan interval (s)"><N v={Math.round(bot.scanIntervalMs / 1000)} on={(v) => bot.setScanInterval(Math.max(2, v) * 1000)} /></F>
              <F label="Max open trades (total)"><N v={bot.maxOpenTrades} on={bot.setMaxOpenTrades} /></F>
              <F label="Max trades per symbol"><N v={bot.maxTradesPerSymbol} on={bot.setMaxTradesPerSymbol} /></F>
              <F label="Max daily trades"><N v={bot.maxDailyTrades} on={bot.setMaxDailyTrades} /></F>

              <F label="EMA fast"><N v={bot.emaFast} on={bot.setEmaFast} /></F>
              <F label="EMA slow"><N v={bot.emaSlow} on={bot.setEmaSlow} /></F>
              <F label="RSI period"><N v={bot.rsiPeriod} on={bot.setRsiPeriod} /></F>
              <F label="RSI overbought (no BUY above)"><N v={bot.rsiBuyMax} on={bot.setRsiBuyMax} /></F>
              <F label="RSI oversold (no SELL below)"><N v={bot.rsiSellMin} on={bot.setRsiSellMin} /></F>
              <F label="ADX min"><N v={bot.adxMin} on={bot.setAdxMin} /></F>
              <F label="ATR SL ×"><N v={bot.atrSlMult} on={bot.setAtrSlMult} step="0.1" /></F>
              <F label="ATR TP ×"><N v={bot.atrTpMult} on={bot.setAtrTpMult} step="0.1" /></F>
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2">
                <Label className="text-xs">MACD confirmation</Label>
                <Switch checked={bot.useMacd} onCheckedChange={bot.setUseMacd} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2">
                <Label className="text-xs">Pause on weekend</Label>
                <Switch checked={bot.pauseOnWeekend} onCheckedChange={bot.setPauseOnWeekend} />
              </div>
            </div>



            <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Pairs to trade</Label>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => bot.setEnabledSymbols([...SYMBOLS])}>All</Button>
                  <Button size="sm" variant="ghost" onClick={() => bot.setEnabledSymbols(["XAUUSD"])}>Gold only</Button>
                  <Button size="sm" variant="ghost" onClick={() => bot.setEnabledSymbols([])}>None</Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {SYMBOLS.map((s) => (
                  <label key={s} className="flex items-center gap-2 rounded border border-border/60 bg-card/40 px-2.5 py-1.5 text-sm cursor-pointer">
                    <Checkbox checked={bot.enabledSymbols.includes(s)} onCheckedChange={() => bot.toggleSymbol(s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3 rounded-md border border-border/60 bg-background/40 p-4">
              <F label="Lot mode">
                <Select value={bot.lotMode} onValueChange={(v) => bot.setLotMode(v as "auto" | "fixed")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (risk-based)</SelectItem>
                    <SelectItem value="fixed">Fixed lot size</SelectItem>
                  </SelectContent>
                </Select>
              </F>
              <F label={`Fixed lot size${bot.lotMode === "auto" ? " (ignored)" : ""}`}>
                <N v={bot.fixedLot} on={bot.setFixedLot} step="0.01" />
              </F>
            </div>

            <div className="grid gap-4 md:grid-cols-3 rounded-md border border-gold/30 bg-background/40 p-4">
              <div className="md:col-span-3 flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">USD trailing stop</Label>
                  <p className="text-xs text-muted-foreground">Once a trade's floating profit reaches the trigger, the SL ratchets up to lock profit.</p>
                </div>
                <Switch checked={useAccount((s) => s.useUsdTrail)} onCheckedChange={useAccount.getState().setUseUsdTrail} />
              </div>
              <F label="Trigger profit ($)">
                <N v={useAccount((s) => s.trailTriggerUsd)} on={useAccount.getState().setTrailTriggerUsd} step="0.5" />
              </F>
              <F label="Lock profit step ($)">
                <N v={useAccount((s) => s.trailStepUsd)} on={useAccount.getState().setTrailStepUsd} step="0.5" />
              </F>
            </div>

            <p className="text-xs text-muted-foreground">
              Tip: For ~80% win-rate, keep <b>ATR TP ×</b> small (0.5–0.8) and <b>ATR SL ×</b> wide (2.0–3.0). Default trail locks $1 of profit once a trade is +$3.
            </p>
          </CardContent>
        </Card>

        {form ? <>
        <header className="pt-4"><h2 className="text-lg font-semibold">Cloud settings (for MT5 bridge)</h2><p className="text-xs text-muted-foreground">Synced to the database. Used by the Python MT5 bridge when connected.</p></header>

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
          <Button onClick={save}><Save className="mr-1.5 h-4 w-4" /> Save cloud settings</Button>
        </div>
        </> : null}
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
