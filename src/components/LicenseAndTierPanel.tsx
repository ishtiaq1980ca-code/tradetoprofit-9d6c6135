import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { useLicense } from "@/hooks/useLicense";
import { useAccount } from "@/lib/paperTrading";
import { useBot, currentTier, tierLotCap } from "@/lib/tradingBot";
import { toast } from "sonner";
import { fmt } from "@/lib/format";

export function LicenseAndTierPanel() {
  const { license, valid, redeem, refresh } = useLicense();
  const balance = useAccount((s) => s.balance);
  const positions = useAccount((s) => s.positions);
  const tierMode = useBot((s) => s.tierMode);
  const manualTier = useBot((s) => s.manualTier);
  const useTierLimits = useBot((s) => s.useTierLimits);
  const setTierMode = useBot((s) => s.setTierMode);
  const setManualTier = useBot((s) => s.setManualTier);
  const setUseTierLimits = useBot((s) => s.setUseTierLimits);

  const tier = currentTier();
  const cap = tierLotCap(tier);
  const used = positions.reduce((s, p) => s + p.lot, 0);
  const remaining = Math.max(0, cap - used);

  const [tokenInput, setTokenInput] = useState("");
  const [mt5, setMt5] = useState(license?.mt5_account ?? "");
  const [busy, setBusy] = useState(false);
  const expDays = license
    ? Math.max(0, Math.ceil((new Date(license.expires_at).getTime() - Date.now()) / 86400000))
    : 0;

  async function onRedeem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await redeem(tokenInput, mt5);
    setBusy(false);
    if ("error" in res && res.error) toast.error(res.error);
    else {
      toast.success("License activated");
      setTokenInput("");
      refresh();
    }
  }

  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-gold" />
          <CardTitle className="text-base font-medium">License & Account Tier</CardTitle>
        </div>
        {valid ? (
          <Badge variant="outline" className="border-bull/40 text-bull">
            <ShieldCheck className="mr-1 h-3 w-3" /> Active · {expDays}d left
          </Badge>
        ) : (
          <Badge variant="outline" className="border-bear/40 text-bear">
            <ShieldAlert className="mr-1 h-3 w-3" /> No active license
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!valid && (
          <form onSubmit={onRedeem} className="grid gap-2 md:grid-cols-[1fr_1fr_auto] items-end">
            <div>
              <Label htmlFor="tok" className="text-xs">Token</Label>
              <Input id="tok" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="AURUM-XXXX-XXXX" autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="mt5" className="text-xs">MT5 account # (optional)</Label>
              <Input id="mt5" value={mt5} onChange={(e) => setMt5(e.target.value)} placeholder="12345678" />
            </div>
            <Button type="submit" disabled={busy}>Activate</Button>
          </form>
        )}
        {valid && license && (
          <div className="grid gap-3 md:grid-cols-3 text-xs">
            <div>
              <div className="text-muted-foreground">Token</div>
              <div className="font-mono">{license.token}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Expires</div>
              <div>{new Date(license.expires_at).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">MT5 binding</div>
              <div>{license.mt5_account ?? "—"}</div>
            </div>
          </div>
        )}

        <div className="rounded-md border border-border/60 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Account tier (risk limits)</div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={useTierLimits} onChange={(e) => setUseTierLimits(e.target.checked)} />
              Enforce tier lot caps
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-4 items-end">
            <div>
              <Label className="text-xs">Tier source</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                value={tierMode}
                onChange={(e) => setTierMode(e.target.value as "auto" | "manual")}
              >
                <option value="auto">Auto (from balance)</option>
                <option value="manual">Manual override</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Tier</Label>
              {tierMode === "manual" ? (
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={manualTier}
                  onChange={(e) => setManualTier(Number(e.target.value) as 500 | 1000 | 2000)}
                >
                  <option value={500}>$500 — 3 × 0.01</option>
                  <option value={1000}>$1000 — 6 × 0.01</option>
                  <option value={2000}>$2000 — 10 × 0.01</option>
                </select>
              ) : (
                <div className="mt-1 rounded-md border border-input bg-background px-2 py-1 text-sm">
                  {tier ? `$${tier} (balance ${fmt.money(balance)})` : `Disabled (< $500)`}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Lot exposure</div>
              <div className="mt-1 font-mono-tabular text-sm">
                {used.toFixed(2)} / {cap.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Remaining</div>
              <div className="mt-1 font-mono-tabular text-sm text-gold">
                {remaining.toFixed(2)} lots ({Math.floor(remaining / 0.01)} × 0.01)
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tier rules: $500 → up to 3 simultaneous 0.01 lots · $1000 → 6 · $2000 → 10. Bot blocks new trades when the cap is reached and waits for closes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
