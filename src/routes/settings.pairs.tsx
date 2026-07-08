import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { listPairSettings, upsertPairSetting, type PairSettingRow } from "@/lib/pairSettings.functions";

export const Route = createFileRoute("/settings/pairs")({
  head: () => ({
    meta: [
      { title: "Pair Settings — AurumAI" },
      { name: "description", content: "Per-pair strategy configuration for AurumAI." },
    ],
  }),
  errorComponent: ({ error }) => <div className="p-6 text-sm text-bear">Error: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
  component: PairSettingsPage,
});

const FIELDS: Array<{ key: keyof PairSettingRow; label: string; step?: string; kind?: "int" | "float" }> = [
  { key: "ema_fast", label: "EMA Fast", kind: "int" },
  { key: "ema_slow", label: "EMA Slow", kind: "int" },
  { key: "rsi_period", label: "RSI Period", kind: "int" },
  { key: "rsi_lower", label: "RSI Lower" },
  { key: "rsi_upper", label: "RSI Upper" },
  { key: "adx_min", label: "ADX Min" },
  { key: "atr_period", label: "ATR Period", kind: "int" },
  { key: "atr_sl_mult", label: "ATR SL Mult" },
  { key: "rr_target", label: "RR Target" },
  { key: "max_spread_pct", label: "Max Spread %" },
  { key: "min_confidence", label: "Min Confidence" },
  { key: "risk_per_trade_pct", label: "Risk / Trade %" },
  { key: "max_lot", label: "Max Lot" },
];

function PairSettingsPage() {
  const router = useRouter();
  const load = useServerFn(listPairSettings);
  const save = useServerFn(upsertPairSetting);
  const { data, isLoading } = useQuery({ queryKey: ["pair-settings"], queryFn: () => load() });
  const [rows, setRows] = useState<PairSettingRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => { if (data) setRows(data); }, [data]);

  const update = (sym: string, key: keyof PairSettingRow, value: number | boolean) => {
    setRows((prev) => prev.map((r) => (r.symbol === sym ? { ...r, [key]: value } : r)));
  };

  const submit = async (row: PairSettingRow) => {
    setSaving(row.symbol);
    try {
      await save({ data: row });
      toast.success(`${row.symbol} saved`);
      router.invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(null);
    }
  };

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Pair Settings</h1>
          <p className="text-sm text-muted-foreground">
            Per-pair strategy configuration. XAUUSD ki alag settings hain — gold ke liye wider ATR stop + specific RR.
          </p>
        </header>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="grid gap-4">
          {rows.map((row) => (
            <Card key={row.symbol} className="border-border/60 bg-card/70">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className={row.symbol === "XAUUSD" ? "text-gold" : ""}>{row.symbol}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.symbol === "XAUUSD" ? "Gold — priority" : "FX Major"}
                  </span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`en-${row.symbol}`} className="text-xs">Enabled</Label>
                  <Switch
                    id={`en-${row.symbol}`}
                    checked={row.enabled}
                    onCheckedChange={(v) => update(row.symbol, "enabled", v)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {FIELDS.map((f) => (
                    <div key={f.key as string}>
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{f.label}</Label>
                      <Input
                        type="number"
                        step={f.kind === "int" ? "1" : "0.01"}
                        value={String(row[f.key] ?? "")}
                        onChange={(e) => {
                          const n = f.kind === "int" ? parseInt(e.target.value || "0", 10) : parseFloat(e.target.value || "0");
                          update(row.symbol, f.key, Number.isFinite(n) ? n : 0);
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button size="sm" onClick={() => submit(row)} disabled={saving === row.symbol}>
                    {saving === row.symbol ? "Saving…" : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
