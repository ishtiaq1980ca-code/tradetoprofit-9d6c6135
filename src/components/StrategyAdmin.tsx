// Admin-only CRUD for custom trading strategies. Each strategy targets a
// symbol (or all pairs), tunes the indicator filters, and is picked up by
// the bot scanner in priority order.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStrategies, type CustomStrategy } from "@/lib/strategies";
import { DEFAULT_PARAMS } from "@/lib/strategy";
import { useBot } from "@/lib/tradingBot";
import { SYMBOLS } from "@/lib/format";
import { allProfiles } from "@/lib/pairProfiles";
import { toast } from "sonner";
import { Sparkles, Trash2, Pencil, X, Cpu, BookOpen } from "lucide-react";

type Draft = {
  id?: string;
  name: string;
  symbol: string; // "ALL" or one of SYMBOLS
  enabled: boolean;
  min_confidence: number;
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiBuyMax: number;
  rsiSellMin: number;
  useMacd: boolean;
  adxMin: number;
  atrSlMult: number;
  atrTpMult: number;
  notes: string;
};

const blank: Draft = {
  name: "",
  symbol: "ALL",
  enabled: true,
  min_confidence: 40,
  emaFast: DEFAULT_PARAMS.emaFast,
  emaSlow: DEFAULT_PARAMS.emaSlow,
  rsiPeriod: DEFAULT_PARAMS.rsiPeriod,
  rsiBuyMax: 85,
  rsiSellMin: 15,
  useMacd: false,
  adxMin: DEFAULT_PARAMS.adxMin,
  atrSlMult: DEFAULT_PARAMS.atrSlMult,
  atrTpMult: DEFAULT_PARAMS.atrTpMult,
  notes: "",
};

function toDraft(s: CustomStrategy): Draft {
  const p = s.params ?? {};
  return {
    id: s.id,
    name: s.name,
    symbol: s.symbol ?? "ALL",
    enabled: s.enabled,
    min_confidence: s.min_confidence,
    emaFast: p.emaFast ?? DEFAULT_PARAMS.emaFast,
    emaSlow: p.emaSlow ?? DEFAULT_PARAMS.emaSlow,
    rsiPeriod: p.rsiPeriod ?? DEFAULT_PARAMS.rsiPeriod,
    rsiBuyMax: p.rsiBuyMax ?? 85,
    rsiSellMin: p.rsiSellMin ?? 15,
    useMacd: p.useMacd ?? false,
    adxMin: p.adxMin ?? DEFAULT_PARAMS.adxMin,
    atrSlMult: p.atrSlMult ?? DEFAULT_PARAMS.atrSlMult,
    atrTpMult: p.atrTpMult ?? DEFAULT_PARAMS.atrTpMult,
    notes: s.notes ?? "",
  };
}

export function StrategyAdmin() {
  const { list, fetch, upsert, remove, toggle } = useStrategies();
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch(true); }, [fetch]);

  const grouped = useMemo(() => {
    const g: Record<string, CustomStrategy[]> = {};
    for (const s of list) {
      const k = s.symbol ?? "ALL";
      (g[k] ??= []).push(s);
    }
    return g;
  }, [list]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return toast.error("Name required");
    setBusy(true);
    try {
      await upsert({
        id: draft.id,
        name: draft.name.trim(),
        symbol: draft.symbol === "ALL" ? null : draft.symbol,
        enabled: draft.enabled,
        min_confidence: draft.min_confidence,
        notes: draft.notes || null,
        params: {
          emaFast: draft.emaFast,
          emaSlow: draft.emaSlow,
          rsiPeriod: draft.rsiPeriod,
          rsiBuyMax: draft.rsiBuyMax,
          rsiSellMin: draft.rsiSellMin,
          useMacd: draft.useMacd,
          adxMin: draft.adxMin,
          atrPeriod: DEFAULT_PARAMS.atrPeriod,
          atrSlMult: draft.atrSlMult,
          atrTpMult: draft.atrTpMult,
          minConfidence: draft.min_confidence,
          riskPct: DEFAULT_PARAMS.riskPct,
        },
      });
      toast.success(draft.id ? "Strategy updated" : "Strategy created");
      setDraft(blank); setEditing(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    }
    setBusy(false);
  };

  const startEdit = (s: CustomStrategy) => {
    setDraft(toDraft(s));
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancel = () => { setDraft(blank); setEditing(false); };

  const del = async (id: string) => {
    if (!confirm("Delete this strategy?")) return;
    try { await remove(id); toast.success("Deleted"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const num = (v: string, fallback: number) => {
    const n = Number(v); return Number.isFinite(n) ? n : fallback;
  };

  return (
    <div className="space-y-4">
      <ManualStrategyPanel />
      <BuiltInStrategyPanel />
      <Card className="border-border/60 bg-card/70">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Custom Strategies ({list.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Build per-pair strategies. The bot runs all enabled strategies that match a symbol in priority
          order and opens the first signal that fires. Built-in can run as a fallback (toggle above).
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border/40 p-4 bg-background/40">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{draft.id ? "Edit strategy" : "New strategy"}</h3>
            {editing && (
              <Button type="button" size="sm" variant="ghost" onClick={cancel}>
                <X className="h-3.5 w-3.5 mr-1" /> Cancel edit
              </Button>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label className="text-xs">Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Gold trend rider" />
            </div>
            <div>
              <Label className="text-xs">Pair</Label>
              <Select value={draft.symbol} onValueChange={(v) => setDraft({ ...draft, symbol: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All pairs</SelectItem>
                  {SYMBOLS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Min confidence (%)</Label>
              <Input type="number" min={0} max={100} value={draft.min_confidence}
                onChange={(e) => setDraft({ ...draft, min_confidence: num(e.target.value, 40) })} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div><Label className="text-xs">EMA fast</Label>
              <Input type="number" min={2} value={draft.emaFast} onChange={(e) => setDraft({ ...draft, emaFast: num(e.target.value, 9) })} /></div>
            <div><Label className="text-xs">EMA slow</Label>
              <Input type="number" min={3} value={draft.emaSlow} onChange={(e) => setDraft({ ...draft, emaSlow: num(e.target.value, 21) })} /></div>
            <div><Label className="text-xs">RSI period</Label>
              <Input type="number" min={2} value={draft.rsiPeriod} onChange={(e) => setDraft({ ...draft, rsiPeriod: num(e.target.value, 14) })} /></div>
            <div><Label className="text-xs">ADX min</Label>
              <Input type="number" min={0} value={draft.adxMin} onChange={(e) => setDraft({ ...draft, adxMin: num(e.target.value, 12) })} /></div>
            <div><Label className="text-xs">RSI buy max</Label>
              <Input type="number" min={50} max={100} value={draft.rsiBuyMax} onChange={(e) => setDraft({ ...draft, rsiBuyMax: num(e.target.value, 85) })} /></div>
            <div><Label className="text-xs">RSI sell min</Label>
              <Input type="number" min={0} max={50} value={draft.rsiSellMin} onChange={(e) => setDraft({ ...draft, rsiSellMin: num(e.target.value, 15) })} /></div>
            <div><Label className="text-xs">ATR × SL</Label>
              <Input type="number" step={0.1} min={0.1} value={draft.atrSlMult} onChange={(e) => setDraft({ ...draft, atrSlMult: num(e.target.value, 2.5) })} /></div>
            <div><Label className="text-xs">ATR × TP</Label>
              <Input type="number" step={0.1} min={0.1} value={draft.atrTpMult} onChange={(e) => setDraft({ ...draft, atrTpMult: num(e.target.value, 0.7) })} /></div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={draft.useMacd} onCheckedChange={(v) => setDraft({ ...draft, useMacd: v })} />
              Require MACD confirmation
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              Enabled
            </label>
          </div>

          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="When to use, what it's tuned for…" />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : draft.id ? "Update strategy" : "Create strategy"}</Button>
          </div>
        </form>

        <div className="space-y-4">
          {Object.keys(grouped).length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-6">No strategies yet. Build one above.</div>
          )}
          {Object.entries(grouped).map(([sym, items]) => (
            <div key={sym}>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                {sym === "ALL" ? "All pairs" : sym}
              </div>
              <div className="space-y-2">
                {items.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded border border-border/40 px-3 py-2 bg-background/30">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{s.name}</span>
                        <Badge variant="outline" className={s.enabled ? "border-bull/40 text-bull" : "border-border/40 text-muted-foreground"}>
                          {s.enabled ? "on" : "off"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          EMA {s.params.emaFast ?? "·"}/{s.params.emaSlow ?? "·"} · RSI {s.params.rsiPeriod ?? "·"} · ADX≥{s.params.adxMin ?? "·"} · conf≥{s.min_confidence}%
                        </span>
                      </div>
                      {s.notes && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{s.notes}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch checked={s.enabled} onCheckedChange={(v) => toggle(s.id, v)} />
                      <Button size="sm" variant="ghost" onClick={() => startEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => del(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      </Card>
    </div>
  );
}

function BuiltInStrategyPanel() {
  const bot = useBot();
  const num = (v: string, fb: number) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
  return (
    <Card className="border-border/60 bg-card/70">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4" /> Built-in Strategy
              <Badge variant="outline" className={bot.useBuiltInStrategy ? "border-bull/40 text-bull" : "border-border/40 text-muted-foreground"}>
                {bot.useBuiltInStrategy ? "on" : "off"}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              The default multi-filter engine. Turn off to run only your custom strategies.
            </p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={bot.useBuiltInStrategy} onCheckedChange={bot.setUseBuiltInStrategy} />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={bot.builtInFallback} onCheckedChange={bot.setBuiltInFallback} disabled={!bot.useBuiltInStrategy} />
              Fallback after customs
            </label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div><Label className="text-xs">Min confidence (%)</Label>
            <Input type="number" min={0} max={100} value={bot.minConfidence} onChange={(e) => bot.setMinConfidence(num(e.target.value, 40))} disabled={!bot.useBuiltInStrategy} /></div>
          <div><Label className="text-xs">EMA fast</Label>
            <Input type="number" min={2} value={bot.emaFast} onChange={(e) => bot.setEmaFast(num(e.target.value, 9))} disabled={!bot.useBuiltInStrategy} /></div>
          <div><Label className="text-xs">EMA slow</Label>
            <Input type="number" min={3} value={bot.emaSlow} onChange={(e) => bot.setEmaSlow(num(e.target.value, 21))} disabled={!bot.useBuiltInStrategy} /></div>
          <div><Label className="text-xs">RSI period</Label>
            <Input type="number" min={2} value={bot.rsiPeriod} onChange={(e) => bot.setRsiPeriod(num(e.target.value, 14))} disabled={!bot.useBuiltInStrategy} /></div>
          <div><Label className="text-xs">RSI buy max</Label>
            <Input type="number" min={50} max={100} value={bot.rsiBuyMax} onChange={(e) => bot.setRsiBuyMax(num(e.target.value, 85))} disabled={!bot.useBuiltInStrategy} /></div>
          <div><Label className="text-xs">RSI sell min</Label>
            <Input type="number" min={0} max={50} value={bot.rsiSellMin} onChange={(e) => bot.setRsiSellMin(num(e.target.value, 15))} disabled={!bot.useBuiltInStrategy} /></div>
          <div><Label className="text-xs">ADX min</Label>
            <Input type="number" min={0} value={bot.adxMin} onChange={(e) => bot.setAdxMin(num(e.target.value, 12))} disabled={!bot.useBuiltInStrategy} /></div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={bot.useMacd} onCheckedChange={bot.setUseMacd} disabled={!bot.useBuiltInStrategy} />
              Require MACD
            </label>
          </div>
          <div><Label className="text-xs">ATR × SL</Label>
            <Input type="number" step={0.1} min={0.1} value={bot.atrSlMult} onChange={(e) => bot.setAtrSlMult(num(e.target.value, 2.5))} disabled={!bot.useBuiltInStrategy} /></div>
          <div><Label className="text-xs">ATR × TP</Label>
            <Input type="number" step={0.1} min={0.1} value={bot.atrTpMult} onChange={(e) => bot.setAtrTpMult(num(e.target.value, 0.7))} disabled={!bot.useBuiltInStrategy} /></div>
        </div>
      </CardContent>
    </Card>
  );
}

function ManualStrategyPanel() {
  const profiles = useMemo(() => allProfiles(), []);
  const fx = profiles.filter((p) => p.strategy === "fx_multi_confirmation");
  const gold = profiles.filter((p) => p.strategy === "gold_multi_confirmation");
  const sample = fx[0];
  return (
    <Card className="border-bull/40 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-bull" />
          Manual Multi-Confirmation Strategy (PDF)
          <Badge variant="outline" className="border-bull/40 text-bull">active · built-in</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Detailed Forex Strategy Manual — automatically applied to every FX pair. Gold (XAUUSD) uses its own dedicated playbook.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border/40 bg-background/40 p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">FX pairs ({fx.length})</div>
          <div className="grid gap-x-4 gap-y-1 md:grid-cols-2 text-xs">
            <div><span className="text-muted-foreground">Timeframes:</span> H4 trend / H1 confirmation / M15 entry</div>
            <div><span className="text-muted-foreground">Trend filter:</span> EMA {sample?.emaFast}/{sample?.emaSlow}</div>
            <div><span className="text-muted-foreground">RSI({sample?.rsiPeriod}):</span> BUY {sample?.rsiBuyMin}–{sample?.rsiOverbought} · SELL {sample?.rsiOversold}–{sample?.rsiSellMax}</div>
            <div><span className="text-muted-foreground">ADX min:</span> {sample?.adxMin}</div>
            <div><span className="text-muted-foreground">MACD:</span> cross required</div>
            <div><span className="text-muted-foreground">Risk:</span> ATR SL {sample?.atrSlMult}× · RR 1:{sample?.rrTarget}</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {fx.map((p) => (
              <Badge key={p.symbol} variant="outline" className="border-border/40 text-[10px]">{p.symbol}</Badge>
            ))}
          </div>
        </div>

        {gold.map((p) => (
          <div key={p.symbol} className="rounded-lg border border-border/40 bg-background/40 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Gold — {p.symbol}</div>
            <div className="grid gap-x-4 gap-y-1 md:grid-cols-2 text-xs">
              <div><span className="text-muted-foreground">Trend:</span> EMA {p.emaFast}/{p.emaSlow}</div>
              <div><span className="text-muted-foreground">RSI({p.rsiPeriod}):</span> {p.rsiOversold}/{p.rsiOverbought}</div>
              <div><span className="text-muted-foreground">ADX min:</span> {p.adxMin}</div>
              <div><span className="text-muted-foreground">Risk:</span> ATR SL {p.atrSlMult}× · RR 1:{p.rrTarget}</div>
              <div className="md:col-span-2"><span className="text-muted-foreground">Sessions:</span> 24h (Sydney/Tokyo/London/NY)</div>
            </div>
          </div>
        ))}

        <p className="text-[11px] text-muted-foreground">
          Ye strategy code mein built-in hai (per-pair profiles). Isko tune karne ke liye "Custom Strategies" mein specific pair ke liye override banayein.
        </p>
      </CardContent>
    </Card>
  );
}
