// Signature "compass rose" gauge — the dashboard centerpiece.
// Purely presentational: it renders metrics passed in as props.

import { useMemo } from "react";
import { cn } from "@/lib/utils";

export type CompassMetric = {
  label: string;
  /** Raw display value, e.g. "41.2%" */
  display: string;
  /** Normalized 0..1 score used for the spoke fill + composite health. */
  score: number;
};

const RADIUS = 108;
const CENTER = 130;

function polar(angleDeg: number, r: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(a), y: CENTER + r * Math.sin(a) };
}

export function CompassGauge({
  metrics,
  className,
  caption,
}: {
  metrics: CompassMetric[];
  className?: string;
  caption?: string;
}) {
  const health = useMemo(() => {
    if (metrics.length === 0) return 0;
    const sum = metrics.reduce((acc, m) => acc + Math.min(1, Math.max(0, m.score)), 0);
    return sum / metrics.length;
  }, [metrics]);

  // Needle sweeps the full rose: 0 health -> due south-west, 1 -> due north.
  const needleAngle = -140 + health * 280;
  const tip = polar(needleAngle, RADIUS - 26);
  const tailA = polar(needleAngle + 150, 16);
  const tailB = polar(needleAngle - 150, 16);

  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg viewBox="0 0 260 260" className="w-full max-w-[300px]" role="img" aria-label="Bot health compass">
        <defs>
          <radialGradient id="compassFace" cx="50%" cy="40%">
            <stop offset="0%" stopColor="var(--card)" />
            <stop offset="100%" stopColor="var(--background)" />
          </radialGradient>
          <linearGradient id="needleGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--gold)" />
            <stop offset="100%" stopColor="var(--brass)" />
          </linearGradient>
        </defs>

        <circle cx={CENTER} cy={CENTER} r={RADIUS + 14} fill="url(#compassFace)" stroke="var(--border)" />
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--gold)" strokeOpacity={0.35} />
        <circle cx={CENTER} cy={CENTER} r={RADIUS - 34} fill="none" stroke="var(--border)" strokeDasharray="2 6" />

        {ticks.map((t) => {
          const major = t % 90 === 0;
          const outer = polar(t, RADIUS);
          const inner = polar(t, RADIUS - (major ? 12 : 6));
          return (
            <line
              key={t}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke="var(--gold)"
              strokeOpacity={major ? 0.7 : 0.25}
              strokeWidth={major ? 1.6 : 1}
            />
          );
        })}

        {/* Spokes: one per metric, length scaled by its score */}
        {metrics.map((m, i) => {
          const angle = (360 / metrics.length) * i;
          const len = 26 + Math.min(1, Math.max(0, m.score)) * (RADIUS - 48);
          const p = polar(angle, len);
          const label = polar(angle, RADIUS - 6);
          return (
            <g key={m.label}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={p.x}
                y2={p.y}
                stroke="var(--gold)"
                strokeOpacity={0.55}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <circle cx={p.x} cy={p.y} r={3.5} fill="var(--gold)" />
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.x > CENTER + 4 ? "start" : label.x < CENTER - 4 ? "end" : "middle"}
                dominantBaseline={label.y > CENTER ? "hanging" : "auto"}
                className="fill-muted-foreground"
                style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" }}
              >
                {m.label}
              </text>
            </g>
          );
        })}

        {/* Needle */}
        <polygon
          points={`${tip.x},${tip.y} ${tailA.x},${tailA.y} ${tailB.x},${tailB.y}`}
          fill="url(#needleGold)"
          stroke="var(--gold)"
          strokeOpacity={0.6}
        />
        <circle cx={CENTER} cy={CENTER} r={7} fill="var(--background)" stroke="var(--gold)" strokeWidth={1.5} />

        <text
          x={CENTER}
          y={CENTER + 46}
          textAnchor="middle"
          className="fill-foreground font-mono-tabular"
          style={{ fontSize: 30, fontWeight: 600 }}
        >
          {Math.round(health * 100)}
        </text>
        <text
          x={CENTER}
          y={CENTER + 62}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 8, letterSpacing: "0.24em" }}
        >
          HEALTH
        </text>
      </svg>

      <div className="mt-2 grid w-full grid-cols-2 gap-2">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{m.label}</div>
            <div className="font-mono-tabular text-base text-foreground">{m.display}</div>
          </div>
        ))}
      </div>
      {caption && <p className="mt-2 text-center text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}
