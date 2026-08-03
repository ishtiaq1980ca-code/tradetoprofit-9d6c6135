import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DEFAULT_FEED_URL, newsBlockFor, refreshCalendarFeed, startCalendarAutoRefresh,
  useEconomicCalendar, type NewsImpact,
} from "@/lib/economicCalendar";
import { useBot } from "@/lib/tradingBot";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "XAU"];

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function NewsFilterPanel({ editable = false }: { editable?: boolean }) {
  const cal = useEconomicCalendar();
  const symbols = useBot((s) => s.enabledSymbols);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => { startCalendarAutoRefresh(); }, []);
  useEffect(() => { void refreshCalendarFeed(true); }, [cal.feedUrl]);

  const paused = useMemo(
    () =>
      symbols
        .map((s) => ({ symbol: s, block: newsBlockFor(s, now) }))
        .filter((r) => r.block.blocked),
    [symbols, now, cal.events, cal.enabled, cal.bufferBeforeMin, cal.bufferAfterMin, cal.includeMedium],
  );

  const feedEvents = useMemo(() => cal.events.filter((e) => e.source === "feed"), [cal.events]);
  const upcomingHigh = useMemo(
    () => cal.events.filter((e) => e.impact === "high" && e.at >= now).length,
    [cal.events, now],
  );
  const feedOk = cal.lastFeedOk > 0 && feedEvents.length > 0;

  const upcoming = useMemo(
    () => cal.events.filter((e) => e.at + cal.bufferAfterMin * 60_000 >= now).slice(0, 12),
    [cal.events, cal.bufferAfterMin, now],
  );


  return (
    <Card className="border-border/60 bg-card/70">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-gold" /> Economic News Filter
        </CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{cal.enabled ? "Active" : "Off"}</span>
          <Switch checked={cal.enabled} onCheckedChange={cal.setEnabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
            feedOk ? "border-bull/40 bg-bull/10" : cal.lastFeedError ? "border-bear/50 bg-bear/10" : "border-border/60 bg-muted/20",
          )}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", cal.feedLoading && "animate-spin")} />
          <div className="min-w-0 flex-1">
            {feedOk ? (
              <span>
                Auto feed live — {feedEvents.length} events synced, <b>{upcomingHigh}</b> upcoming high-impact.
                <span className="text-muted-foreground"> Updated {ago(cal.lastFeedOk)}.</span>
              </span>
            ) : cal.lastFeedError ? (
              <span className="text-bear">Auto feed unavailable: {cal.lastFeedError} — manual events only.</span>
            ) : (
              <span className="text-muted-foreground">Fetching economic calendar…</span>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void refreshCalendarFeed(true)}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>


        {paused.length > 0 ? (
          <div className="space-y-1.5 rounded-md border border-bear/50 bg-bear/10 p-3">
            {paused.map(({ symbol, block }) => (
              <div key={symbol} className="flex items-start gap-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bear" />
                <span>
                  <b>{symbol}</b> entries paused — {block.event?.title}
                  {typeof block.minutesUntil === "number" &&
                    (block.minutesUntil >= 0 ? ` in ${block.minutesUntil} min` : ` ${Math.abs(block.minutesUntil)} min ago`)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            No pairs paused for news right now.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Buffer before (min)</Label>
            <Input type="number" value={cal.bufferBeforeMin} onChange={(e) => cal.setBufferBefore(+e.target.value || 0)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Buffer after (min)</Label>
            <Input type="number" value={cal.bufferAfterMin} onChange={(e) => cal.setBufferAfter(+e.target.value || 0)} />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <span className="text-xs">Also block medium-impact events</span>
          <Switch checked={cal.includeMedium} onCheckedChange={cal.setIncludeMedium} />
        </div>

        <div>
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Upcoming high-impact events
          </div>
          {upcoming.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No events scheduled. Add releases (NFP, FOMC, CPI, central-bank speeches) below.
            </p>
          ) : (
            <div className="space-y-1">
              {upcoming.map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-xs">
                  <Badge variant="outline" className="font-mono-tabular">{e.currency}</Badge>
                  <span className={cn("truncate", e.impact === "high" ? "text-foreground" : "text-muted-foreground")}>{e.title}</span>
                  <span className="ml-auto shrink-0 font-mono-tabular text-muted-foreground">
                    {new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {editable && (
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => cal.removeEvent(e.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {editable && <EventComposer />}

        {editable && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Optional calendar feed URL (JSON)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="https://…/calendar.json"
                value={cal.feedUrl}
                onChange={(e) => cal.setFeedUrl(e.target.value)}
              />
              <Button variant="outline" size="icon" onClick={() => refreshCalendarFeed(true).then(() => toast.success("Feed refreshed"))}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {cal.lastFeedError && <p className="text-[11px] text-bear">Feed error: {cal.lastFeedError}</p>}
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Limitation: no free public economic-calendar API is reliably available from the browser, so this filter runs
          on the manual event list above by default. Point it at your own JSON feed to automate it.
        </p>
      </CardContent>
    </Card>
  );
}

function EventComposer() {
  const add = useEconomicCalendar((s) => s.addEvent);
  const clearPast = useEconomicCalendar((s) => s.clearPast);
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [impact, setImpact] = useState<NewsImpact>("high");
  const [when, setWhen] = useState("");

  const submit = () => {
    const at = Date.parse(when);
    if (!title.trim()) return toast.error("Event title required");
    if (!isFinite(at)) return toast.error("Pick a valid date & time");
    add({ title: title.trim(), currency, impact, at });
    setTitle(""); setWhen("");
    toast.success("Event added");
  };

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Add event</div>
      <Input placeholder="e.g. FOMC Rate Decision" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={impact} onValueChange={(v) => setImpact(v as NewsImpact)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="high">High impact</SelectItem>
            <SelectItem value="medium">Medium impact</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={submit}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>
        <Button size="sm" variant="outline" onClick={() => { clearPast(); toast.success("Past events cleared"); }}>
          Clear past
        </Button>
      </div>
    </div>
  );
}
