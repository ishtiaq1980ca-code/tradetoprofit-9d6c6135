import { ShieldAlert, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { sendBreachWebhook, useCircuitBreaker } from "@/lib/circuitBreaker";
import { toast } from "sonner";
import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Loss limits + outbound alert configuration for the circuit breaker. */
export function RiskGuardPanel() {
  const cb = useCircuitBreaker();
  const [confirmOff, setConfirmOff] = useState(false);

  const test = async () => {
    if (!cb.webhookUrl) return toast.error("Enter a webhook URL first");
    await sendBreachWebhook({
      type: "daily",
      limitPct: cb.maxDailyLossPct,
      lossPct: cb.maxDailyLossPct,
      lossUsd: -1,
      baseline: 100,
      at: Date.now(),
      message: "Test alert from AurumAI risk guard.",
    });
    const err = useCircuitBreaker.getState().lastWebhookError;
    if (err) toast.error(`Webhook failed: ${err}`);
    else toast.success("Test alert sent");
  };

  return (
    <Card className="border-border/60 bg-card/70">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-gold" /> Risk Guard / Circuit Breaker
        </CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{cb.enabled ? "Armed" : "Off"}</span>
          <Switch checked={cb.enabled} onCheckedChange={cb.setEnabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border border-border/60 px-3 py-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium">
                Daily Loss Limit — {cb.dailyLimitEnabled ? "Enabled" : "Disabled"}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {cb.dailyLimitEnabled
                  ? "Blocks new entries and shows the red banner when the daily loss is hit."
                  : "Daily loss is ignored — weekly and monthly limits still apply."}
              </div>
            </div>
            <Switch
              checked={cb.dailyLimitEnabled}
              onCheckedChange={(v) => {
                if (!v) setConfirmOff(true);
                else cb.setDailyLimitEnabled(true);
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Daily loss %</Label>
            <Input
              type="number"
              step="0.5"
              disabled={!cb.dailyLimitEnabled}
              className={cb.dailyLimitEnabled ? "" : "opacity-50"}
              value={cb.maxDailyLossPct}
              onChange={(e) => cb.setLimit("daily", +e.target.value || 3)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Weekly loss %</Label>
            <Input type="number" step="0.5" value={cb.maxWeeklyLossPct} onChange={(e) => cb.setLimit("weekly", +e.target.value || 8)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Monthly loss %</Label>
            <Input type="number" step="0.5" value={cb.maxMonthlyLossPct} onChange={(e) => cb.setLimit("monthly", +e.target.value || 12)} />
          </div>
        </div>


        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div>
            <div className="text-xs">Close open positions when tripped</div>
            <div className="text-[10px] text-muted-foreground">Default off — only new entries are blocked.</div>
          </div>
          <Switch checked={cb.closePositionsOnTrip} onCheckedChange={cb.setClosePositionsOnTrip} />
        </div>

        <div className="space-y-2 rounded-md border border-border/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs">Webhook alerts (Telegram / Slack / Discord / custom)</span>
            <Switch checked={cb.webhookEnabled} onCheckedChange={cb.setWebhookEnabled} />
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="https://hooks.slack.com/… or https://api.telegram.org/bot<token>/sendMessage?chat_id=…"
              value={cb.webhookUrl}
              onChange={(e) => cb.setWebhookUrl(e.target.value)}
            />
            <Button variant="outline" size="icon" onClick={test}><Send className="h-4 w-4" /></Button>
          </div>
          {cb.lastWebhookError && <p className="text-[11px] text-bear">Last error: {cb.lastWebhookError}</p>}
        </div>

        {cb.breach && (
          <div className="rounded-md border border-bear/60 bg-bear/10 p-3 text-xs text-bear">
            Currently tripped: {cb.breach.message}
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable the daily loss limit?</AlertDialogTitle>
            <AlertDialogDescription>
              Turning this off means the bot will keep trading even during large losses.
              Weekly and monthly limits stay active. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it on</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cb.setDailyLimitEnabled(false);
                toast.warning("Daily loss limit disabled — the bot will keep trading through drawdowns");
              }}
            >
              Turn it off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
