// Tiny Web Worker that emits a heartbeat tick every second, unaffected by
// background-tab throttling. The main thread listens and drives the bot scan
// and price-feed anchor refresh so the bot keeps trading when the tab is
// minimized, backgrounded, or on another virtual desktop.
//
// Exported as a factory so Vite bundles it via `?worker`.

let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent) => {
  const data = e.data as { type: "start" | "stop"; intervalMs?: number };
  if (data?.type === "start") {
    if (started) return;
    started = true;
    const ms = Math.max(250, data.intervalMs ?? 1000);
    intervalId = setInterval(() => {
      (self as unknown as Worker).postMessage({ type: "tick", at: Date.now() });
    }, ms);
  } else if (data?.type === "stop") {
    started = false;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }
};
export {};
