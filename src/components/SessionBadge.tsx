import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { activeSessions } from "@/lib/sessions";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export function SessionBadge() {
  const [s, setS] = useState(() => activeSessions());
  useEffect(() => {
    const id = setInterval(() => setS(activeSessions()), 30_000);
    return () => clearInterval(id);
  }, []);
  const closed = s.primary === "Closed";
  return (
    <Card className="border-border/60 bg-card/70">
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className={cn("grid h-9 w-9 place-items-center rounded-md border", closed ? "border-bear/40 text-bear" : "border-gold/40 text-gold")}>
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Market session</div>
            <div className="text-sm font-medium">{closed ? "Closed (weekend)" : `${s.primary}${s.active.length > 1 ? ` · overlap` : ""}`}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 justify-end">
          {(["Sydney", "Tokyo", "London", "New York"] as const).map((n) => {
            const on = s.active.includes(n as any);
            return (
              <Badge key={n} variant="outline" className={on ? "border-bull/40 text-bull" : "border-border text-muted-foreground"}>{n}</Badge>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
