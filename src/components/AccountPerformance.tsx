// Account Performance card. Shows Daily / Weekly / Monthly profit %
// relative to the account's original starting capital.
//
// Two modes:
//   - "paper"  (dashboard): reads from local paper trading store.
//   - "live"   (admin panel): reads from public.account_snapshots grouped by
//              MT5 mode (demo/real). Baseline = earliest snapshot per mode.
//
// This is presentation only — no changes to MT5 bridge / execution.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAccount, floatingPnl } from "@/lib/paperTrading";
import { usePriceFeed } from "@/hooks/usePriceFeed";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TrendingUp } from "lucide-react";

type Row = {
  label: string;
  mode: string;
  starting: number;
  current: number;
  day: number;   // %
  week: number;  // %
  month: number; // %
  currentUsd: number;
  totalUsd: number;
};

function pctCell(v: number) {
  const tone = v > 0 ? "text-bull" : v < 0 ? "text-bear" : "text-muted-foreground";
  const sign = v > 0 ? "+" : "";
  return <span className={cn("font-mono-tabular", tone)}>{sign}{v.toFixed(2)}%</span>;
}

function PerformanceTable({ rows, title, hint }: { rows: Row[]; title: string; hint?: string }) {
  return (
    <Card className="border-border/60 bg-card/70">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 opacity-70" /> {title}
        </CardTitle>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2 text-right">Original Capital</th>
              <th className="px-3 py-2 text-right">Current</th>
              <th className="px-3 py-2 text-right">Today</th>
              <th className="px-3 py-2 text-right">This Week</th>
              <th className="px-3 py-2 text-right">This Month</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No data yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/40">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.label}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.mode}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono-tabular">{fmt.money(r.starting)}</td>
                <td className="px-3 py-2 text-right font-mono-tabular">{fmt.money(r.current)}</td>
                <td className="px-3 py-2 text-right">{pctCell(r.day)}</td>
                <td className="px-3 py-2 text-right">{pctCell(r.week)}</td>
                <td className="px-3 py-2 text-right">{pctCell(r.month)}</td>
                <td className="px-3 py-2 text-right">
                  <div>{pctCell(r.totalUsd / (r.starting || 1) * 100)}</div>
                  <div className={cn("text-[10px] font-mono-tabular", r.totalUsd >= 0 ? "text-bull" : "text-bear")}>
                    {r.totalUsd >= 0 ? "+" : ""}{fmt.money(r.totalUsd)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function PaperAccountPerformance() {
  const balance = useAccount((s) => s.balance);
  const starting = useAccount((s) => s.startingBalance);
  const positions = useAccount((s) => s.positions);
  const history = useAccount((s) => s.history);
  const feed = usePriceFeed();

  const row = useMemo<Row>(() => {
    const floating = floatingPnl(positions, feed.prices);
    const equity = balance + floating;
    const now = Date.now();
    const dayAgo = now - 24 * 3600 * 1000;
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    const monthAgo = now - 30 * 24 * 3600 * 1000;
    const sumSince = (t: number) => history.filter((h) => h.closedAt >= t).reduce((s, h) => s + h.profit, 0);
    const dayPnl = sumSince(dayAgo) + floating;
    const weekPnl = sumSince(weekAgo) + floating;
    const monthPnl = sumSince(monthAgo) + floating;
    const base = starting || 1;
    return {
      label: "Paper Trading",
      mode: "paper",
      starting,
      current: equity,
      currentUsd: equity,
      day: (dayPnl / base) * 100,
      week: (weekPnl / base) * 100,
      month: (monthPnl / base) * 100,
      totalUsd: equity - starting,
    };
  }, [balance, starting, positions, history, feed.prices]);

  return <PerformanceTable rows={[row]} title="Account Performance" hint="% of original capital" />;
}

export function LiveAccountsPerformance() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const monthAgo = new Date(Date.now() - 32 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("account_snapshots")
        .select("balance, equity, mode, login, name, server, company, currency, created_at")
        .gte("created_at", monthAgo)
        .order("created_at", { ascending: true })
        .limit(10000);
      if (cancelled) return;
      if (error) { setErr(error.message); return; }

      type Snap = { balance: number; created_at: string; login: string | null; name: string | null; server: string | null; company: string | null; currency: string | null; mode: string };
      // Group by login (fallback to mode if login missing on older snapshots)
      const byKey = new Map<string, Snap[]>();
      for (const r of data ?? []) {
        const key = (r.login && String(r.login).trim()) || `mode:${r.mode}`;
        const arr = byKey.get(key) ?? [];
        arr.push({
          balance: Number(r.equity ?? r.balance),
          created_at: r.created_at,
          login: r.login ?? null,
          name: r.name ?? null,
          server: r.server ?? null,
          company: r.company ?? null,
          currency: r.currency ?? null,
          mode: r.mode,
        });
        byKey.set(key, arr);
      }

      const now = Date.now();
      const findAtOrBefore = (arr: Snap[], t: number) => {
        let best = arr[0]?.balance ?? 0;
        for (const p of arr) {
          if (new Date(p.created_at).getTime() <= t) best = p.balance; else break;
        }
        return best;
      };

      const out: Row[] = [];
      for (const [, arr] of byKey.entries()) {
        if (arr.length === 0) continue;
        const last = arr[arr.length - 1];
        const starting = arr[0].balance;
        const current = last.balance;
        const dayRef = findAtOrBefore(arr, now - 24 * 3600 * 1000);
        const weekRef = findAtOrBefore(arr, now - 7 * 24 * 3600 * 1000);
        const monthRef = findAtOrBefore(arr, now - 30 * 24 * 3600 * 1000);
        const base = starting || 1;
        const loginLabel = last.login ? `#${last.login}` : (last.mode === "real" ? "MT5 Live" : "MT5 Demo");
        const nameLabel = last.name || last.company || last.server || (last.mode === "real" ? "Live Account" : "Demo Account");
        out.push({
          label: `${nameLabel} · ${loginLabel}`,
          mode: `${last.mode.toUpperCase()}${last.server ? ` · ${last.server}` : ""}${last.currency ? ` · ${last.currency}` : ""}`,
          starting,
          current,
          currentUsd: current,
          day: ((current - dayRef) / base) * 100,
          week: ((current - weekRef) / base) * 100,
          month: ((current - monthRef) / base) * 100,
          totalUsd: current - starting,
        });
      }
      // Live accounts first, then by highest current balance
      out.sort((a, b) => {
        const aLive = a.mode.startsWith("REAL") ? 0 : 1;
        const bLive = b.mode.startsWith("REAL") ? 0 : 1;
        if (aLive !== bLive) return aLive - bLive;
        return b.current - a.current;
      });
      setRows(out);
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="space-y-2">
      <PerformanceTable rows={rows} title="Live Accounts Performance" hint="Real MT5 accounts · updates every 30s" />
      {err && <div className="text-xs text-bear px-1">{err}</div>}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider text-muted-foreground px-1">
          <Badge variant="outline">Grouped by MT5 login · baseline = earliest snapshot in the last 30 days</Badge>
        </div>
      )}
    </div>
  );
}
