import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAnalytics } from "@/lib/analytics.functions";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, ScatterChart, Scatter, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — AurumAI" },
      { name: "description", content: "Win rate per pair, P&L, drawdown, rejection reasons, AI confidence history." },
    ],
  }),
  errorComponent: ({ error }) => <div className="p-6 text-sm text-bear">Error: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const fetchAnalytics = useServerFn(getAnalytics);
  const { data, isLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => fetchAnalytics(),
    refetchInterval: 15000,
  });

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">Trade performance, drawdown, rejection reasons, aur AI confidence history.</p>
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && (
          <>
            <Card className="border-border/60 bg-card/70">
              <CardHeader><CardTitle className="text-base">Win rate & P&L by pair</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr><th className="text-left py-2">Symbol</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Win %</th><th className="text-right">P&L</th></tr>
                    </thead>
                    <tbody>
                      {data.pairs.map((p) => (
                        <tr key={p.symbol} className="border-t border-border/40">
                          <td className="py-2 font-medium">{p.symbol}</td>
                          <td className="text-center">{p.trades}</td>
                          <td className="text-center text-bull">{p.wins}</td>
                          <td className="text-center text-bear">{p.losses}</td>
                          <td className="text-center">{p.winRate.toFixed(1)}%</td>
                          <td className={"text-right font-mono-tabular " + (p.pnl >= 0 ? "text-bull" : "text-bear")}>${p.pnl.toFixed(2)}</td>
                        </tr>
                      ))}
                      {data.pairs.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No closed trades yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="border-border/60 bg-card/70">
                <CardHeader><CardTitle className="text-base">Cumulative P&L</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer>
                      <LineChart data={data.pnlSeries}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="cumulative" stroke="hsl(var(--gold))" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Max drawdown: <span className="text-bear font-mono-tabular">${data.maxDrawdown.toFixed(2)}</span></p>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/70">
                <CardHeader><CardTitle className="text-base">Rejection reasons</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart data={data.rejections} layout="vertical" margin={{ left: 100 }}>
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="reason" tick={{ fontSize: 10 }} width={140} />
                        <Tooltip />
                        <Bar dataKey="count" fill="hsl(var(--destructive))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/60 bg-card/70">
              <CardHeader><CardTitle className="text-base">AI Confidence vs P&L</CardTitle></CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis type="number" dataKey="confidence" name="Confidence" domain={[80, 100]} tick={{ fontSize: 10 }} />
                      <YAxis type="number" dataKey="pnl" name="P&L" tick={{ fontSize: 10 }} />
                      <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                      <Scatter data={data.confidencePoints} fill="hsl(var(--gold))" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
