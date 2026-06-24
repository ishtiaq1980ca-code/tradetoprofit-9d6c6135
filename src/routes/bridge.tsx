import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Copy, CheckCircle2, Database, MonitorUp, Radar, ShieldCheck, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLicense } from "@/hooks/useLicense";

export const Route = createFileRoute("/bridge")({
  head: () => ({ meta: [{ title: "MT5 Bridge — AurumAI" }, { name: "description", content: "Install the Python bridge to connect AurumAI to your MetaTrader 5 terminal." }] }),
  component: BridgePage,
});

const BRIDGE_URL = typeof window !== "undefined" ? window.location.origin : "";

function BridgePage() {
  const [copied, setCopied] = useState<string | null>(null);
  const { license, valid } = useLicense();
  const copy = (k: string, v: string) => { navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(null), 1500); toast.success("Copied"); };

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6 max-w-4xl">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">MT5 Bridge</h1>
          <p className="text-sm text-muted-foreground">
            AurumAI generates signals in the cloud; the Python bridge runs on your Windows PC or VPS
            (where MT5 is installed) and executes them on your account.
          </p>
        </header>

        <Card className="border-gold/30 bg-card/70">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">Bridge endpoint <Badge variant="outline" className="border-bull/40 text-bull">Live</Badge></CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 font-mono-tabular text-xs">
            <Row k="Base URL" v={BRIDGE_URL} onCopy={() => copy("u", BRIDGE_URL)} copied={copied === "u"} />
            <Row k="Bridge token" v={valid && license?.token ? license.token : "Use your active license token here"} onCopy={() => license?.token && copy("b", license.token)} copied={copied === "b"} />
            <Row k="Poll signals" v={`GET ${BRIDGE_URL}/api/public/bridge/poll`} onCopy={() => copy("p", `${BRIDGE_URL}/api/public/bridge/poll`)} copied={copied === "p"} />
            <Row k="Report account" v={`POST ${BRIDGE_URL}/api/public/bridge/account`} onCopy={() => copy("a", `${BRIDGE_URL}/api/public/bridge/account`)} copied={copied === "a"} />
            <Row k="Report trade" v={`POST ${BRIDGE_URL}/api/public/bridge/trades`} onCopy={() => copy("t", `${BRIDGE_URL}/api/public/bridge/trades`)} copied={copied === "t"} />
            <p className="pt-1 font-sans text-xs text-muted-foreground">
              Only paste Base URL and Bridge token into the Python file. The three GET/POST links are used automatically by the script.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/70">
          <CardHeader><CardTitle className="text-base">Setup (10 minutes)</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Step n={1} title="Install MetaTrader 5 + log in to your demo account">
              Download MT5 from your broker, log in, and make sure XAUUSD plus the FX majors are visible in Market Watch.
            </Step>
            <Step n={2} title="Install Python 3.10+ on the same Windows machine">
              The <code className="rounded bg-muted px-1">MetaTrader5</code> Python package only runs on Windows.
            </Step>
            <Step n={3} title="Install bridge dependencies">
              <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background/60 p-3 text-xs">{`pip install MetaTrader5 requests`}</pre>
            </Step>
            <Step n={4} title="Download the bridge script">
              <a href="/aurumai_bridge.py" download className="inline-block mt-1">
                <Button size="sm"><Download className="mr-1.5 h-4 w-4" /> aurumai_bridge.py</Button>
              </a>
            </Step>
            <Step n={5} title="Configure and run">
              Open the script, set <code className="rounded bg-muted px-1">BASE_URL</code> to the URL above,
              paste your <code className="rounded bg-muted px-1">Bridge token</code> into
              <code className="rounded bg-muted px-1">BRIDGE_TOKEN</code>, and add
              your MT5 login. Every request now sends
              <code className="rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code> — calls
              without it are rejected with 401.
              Then run: <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background/60 p-3 text-xs">{`python aurumai_bridge.py`}</pre>
              The bridge posts a live MT5 heartbeat before polling, auto-reconnects if MT5 goes stale, and then executes orders on MT5.
            </Step>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/70">
          <CardHeader><CardTitle className="text-base">Signal pipeline</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-5">
              <PipelineStep icon={<Radar className="h-4 w-4" />} title="Scan" text="Browser bot scans live candles every 1s." />
              <PipelineStep icon={<Database className="h-4 w-4" />} title="Queue" text="Accepted signal is written to the backend signals queue." />
              <PipelineStep icon={<Zap className="h-4 w-4" />} title="Lease" text="Bridge polls every 0.2s and leases fresh pending signals." />
              <PipelineStep icon={<MonitorUp className="h-4 w-4" />} title="MT5" text="Python sends the order directly into the local MT5 terminal." />
              <PipelineStep icon={<ShieldCheck className="h-4 w-4" />} title="Confirm" text="MT5 fill, SL and TP are reported back to the dashboard." />
            </div>
            <div className="rounded-md border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-muted-foreground">
              Signals do not go directly from the website to MT5 because MT5 runs on your Windows machine. The backend queue is the handoff point; the updated bridge keeps one HTTPS session open, polls faster, skips MT5 pre-check round trips, and refuses old bridge versions that can create bad SL/TP.
            </div>
          </CardContent>
        </Card>

        <Card className="border-bear/30 bg-card/70">
          <CardHeader><CardTitle className="text-base text-bear">Safety notes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>· Bridge endpoints require a bearer token (<code className="rounded bg-muted px-1">BRIDGE_API_TOKEN</code>). Keep it secret — anyone with the token can submit fake account snapshots or trades.</p>
            <p>· Always run on a demo account for at least two weeks. Past synthetic backtest performance is not a guarantee of real results.</p>
            <p>· The bridge respects the daily loss limit set on the Settings page: once breached, no new orders are sent for the rest of the day.</p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Row({ k, v, onCopy, copied }: { k: string; v: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
        <div className="truncate text-xs">{v}</div>
      </div>
      <Button size="icon" variant="ghost" onClick={onCopy} className="shrink-0">
        {copied ? <CheckCircle2 className="h-4 w-4 text-bull" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-gold/40 bg-gold/10 text-xs font-semibold text-gold">{n}</div>
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function PipelineStep({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-gold">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}
