import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, BarChart3, LayoutDashboard, ListChecks, PlugZap, Settings, Signal } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MarketEngine } from "@/hooks/usePriceFeed";
import { BotEngine } from "@/lib/tradingBot";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/signals", label: "Signals", icon: Signal },
  { to: "/positions", label: "Positions", icon: ListChecks },
  { to: "/backtest", label: "Backtest", icon: BarChart3 },
  { to: "/bridge", label: "MT5 Bridge", icon: PlugZap },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-screen">
      <MarketEngine />
      <aside className="hidden md:flex w-60 flex-col border-r border-border bg-sidebar p-4">
        <Link to="/" className="mb-8 flex items-center gap-2 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-gold text-primary-foreground glow-gold">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">AurumAI</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Forex Bot</div>
          </div>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = pathname === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent text-gold"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-4 rounded-md border border-border/60 bg-card/50 p-3 text-[11px] text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulse" />
            <span className="font-medium text-foreground">Paper Trading</span>
          </div>
          Virtual $10,000. Live ticks anchored to public FX/gold spot.
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
