import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, BarChart3, ClipboardCheck, Coins, KeyRound, LayoutDashboard, ListChecks, LogOut, Menu, PlugZap, ScrollText, Settings, ShieldCheck, Signal } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useBot } from "@/lib/tradingBot";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/hooks/useAuth";
import { useLicense } from "@/hooks/useLicense";
import { useIsAdmin } from "@/hooks/useIsAdmin";

const baseNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/signals", label: "Signals", icon: Signal },
  { to: "/decisions", label: "Decisions", icon: ScrollText },
  { to: "/report", label: "Audit Report", icon: ClipboardCheck },
  { to: "/currency-report", label: "Currency Report", icon: Coins },
  { to: "/positions", label: "Positions", icon: ListChecks },
  { to: "/backtest", label: "Backtest", icon: BarChart3 },
  { to: "/bridge", label: "MT5 Bridge", icon: PlugZap },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;
const adminNav = { to: "/admin", label: "Admin", icon: ShieldCheck } as const;


function NavList({ pathname, onNavigate, items }: { pathname: string; onNavigate?: () => void; items: ReadonlyArray<{ to: string; label: string; icon: any }> }) {
  return (
    <nav className="flex flex-1 flex-col gap-1">
      {items.map((n) => {
        const Icon = n.icon;
        const active = pathname === n.to;
        return (
          <Link
            key={n.to}
            to={n.to}
            onClick={onNavigate}
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
  );
}


function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 px-2">
      <div className="grid h-9 w-9 place-items-center rounded-md bg-gold text-primary-foreground glow-gold">
        <Activity className="h-5 w-5" />
      </div>
      <div>
        <div className="text-sm font-semibold tracking-tight">AurumAI</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Forex Bot</div>
      </div>
    </Link>
  );
}

function LicenseSyncer() {
  const { valid, loading } = useLicense();
  const setLicenseValid = useBot((s) => s.setLicenseValid);
  useEffect(() => {
    if (loading) return;
    setLicenseValid(valid);
    // Note: do NOT flip bot.enabled off when license is transiently invalid.
    // The runScan() license gate already blocks trades without a valid license,
    // and toggling enabled here causes the bot to switch off whenever the user
    // navigates back / the license refetches.
  }, [valid, loading, setLicenseValid]);
  return null;
}

function UserFooter() {
  const { user, signOut } = useAuth();
  const { license, valid } = useLicense();
  if (!user) return null;
  const expDays = license ? Math.max(0, Math.ceil((new Date(license.expires_at).getTime() - Date.now()) / 86400000)) : 0;
  return (
    <div className="mt-4 space-y-2 rounded-md border border-border/60 bg-card/50 p-3 text-[11px]">
      <div className="truncate font-medium text-foreground">{user.email}</div>
      <div className="flex items-center gap-1.5">
        <KeyRound className="h-3 w-3" />
        {valid ? (
          <span className="text-bull">License active · {expDays}d left</span>
        ) : (
          <span className="text-bear">No active license</span>
        )}
      </div>
      <Button variant="outline" size="sm" className="w-full h-7 text-[11px]" onClick={() => signOut()}>
        <LogOut className="h-3 w-3 mr-1" /> Sign out
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const { isAdmin } = useIsAdmin();
  const items = useMemo(() => (isAdmin ? [...baseNav, adminNav] : [...baseNav]), [isAdmin]);
  return (
    <AuthGate>
      <div className="flex min-h-screen">
        <LicenseSyncer />


        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-60 flex-col border-r border-border bg-sidebar p-4">
          <div className="mb-8"><Brand /></div>
          <NavList pathname={pathname} items={items} />
          <UserFooter />
        </aside>

        <main className="flex-1 min-w-0 pb-20 md:pb-0">
          {/* Mobile top bar */}
          <div className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-background/95 backdrop-blur px-3 py-2">
            <Brand />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64 p-4 flex flex-col">
                <div className="mb-6"><Brand /></div>
                <NavList pathname={pathname} items={items} onNavigate={() => setOpen(false)} />
                <UserFooter />
              </SheetContent>
            </Sheet>
          </div>

          {children}

          {/* Mobile bottom tab bar */}
          <nav className={cn("md:hidden fixed bottom-0 inset-x-0 z-30 grid border-t border-border bg-background/95 backdrop-blur", isAdmin ? "grid-cols-8" : "grid-cols-7")}>
            {items.map((n) => {
              const Icon = n.icon;
              const active = pathname === n.to;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px]",
                    active ? "text-gold" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate max-w-full px-1">{n.label}</span>
                </Link>
              );
            })}
          </nav>
        </main>
      </div>
    </AuthGate>
  );
}

