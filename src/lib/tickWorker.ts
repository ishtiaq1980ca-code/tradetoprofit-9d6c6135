// Background tick + network Web Worker. Runs off the main thread so browser
// tab throttling cannot stall the bot.
//
// Responsibilities:
//   1. Emit a heartbeat tick every intervalMs so the main thread can drive
//      scans without being subject to background throttling.
//   2. Periodically fetch FX + gold price anchors and post them back so the
//      price feed stays live even when the tab is hidden.
//   3. Perform the actual MT5 signal insert (POST to Supabase REST) on
//      request, so the network call itself does not depend on the main
//      thread being awake.
//
// The MT5 bridge itself is NOT touched — this only relays signals into the
// same `signals` table the bridge already polls.

type StartMsg = {
  type: "start";
  intervalMs?: number;
  anchorMs?: number;
  supabaseUrl?: string;
  supabaseKey?: string;
  token?: string | null;
};
type SetTokenMsg = { type: "setToken"; token: string | null };
type InsertSignalMsg = {
  type: "insertSignal";
  reqId: number;
  row: Record<string, unknown>;
  token?: string | null;
};
type StopMsg = { type: "stop" };
type PingMsg = { type: "ping" };

type InMsg = StartMsg | SetTokenMsg | InsertSignalMsg | StopMsg | PingMsg;

let started = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let anchorTimer: ReturnType<typeof setInterval> | null = null;
let supabaseUrl = "";
let supabaseKey = "";
let authToken: string | null = null;
const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);
const SIGNAL_TIMEOUT_MS = 5_000;

async function fetchAnchors() {
  let rates: Record<string, number> | null = null;
  let xau: number | null = null;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (r.ok) {
      const j: any = await r.json();
      if (j?.rates) rates = j.rates;
    }
  } catch { /* offline */ }
  try {
    const r = await fetch("https://api.gold-api.com/price/XAU", { cache: "no-store" });
    if (r.ok) {
      const j: any = await r.json();
      if (j?.price) xau = Number(j.price);
    }
  } catch { /* offline */ }
  if (rates || xau != null) {
    post({ type: "anchor", rates, xau, at: Date.now() });
  }
}

async function insertSignal(reqId: number, row: Record<string, unknown>, tokenOverride?: string | null) {
  const token = tokenOverride ?? authToken;
  if (!supabaseUrl || !supabaseKey || !token) {
    post({ type: "signalResult", reqId, error: "auth token unavailable" });
    return;
  }
  let abortId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    abortId = setTimeout(() => controller.abort(), SIGNAL_TIMEOUT_MS);
    const res = await fetch(`${supabaseUrl}/rest/v1/signals`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      post({ type: "signalResult", reqId, status: res.status, error: text || `${res.status} ${res.statusText}` });
      return;
    }
    post({ type: "signalResult", reqId, status: res.status, error: null });
  } catch (e: any) {
    const message = e?.name === "AbortError" ? "worker signal timeout" : (e?.message ?? "network error");
    post({ type: "signalResult", reqId, error: message });
  } finally {
    if (abortId) clearTimeout(abortId);
  }
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const data = e.data;
  if (!data || typeof data !== "object") return;
  switch (data.type) {
    case "start": {
      if (data.supabaseUrl) supabaseUrl = data.supabaseUrl;
      if (data.supabaseKey) supabaseKey = data.supabaseKey;
      if (typeof data.token !== "undefined") authToken = data.token;
      if (started) return;
      started = true;
      const ms = Math.max(250, data.intervalMs ?? 1000);
      const anchorMs = Math.max(5_000, data.anchorMs ?? 30_000);
      tickTimer = setInterval(() => post({ type: "tick", at: Date.now() }), ms);
      // Kick anchor immediately + on interval.
      void fetchAnchors();
      anchorTimer = setInterval(() => { void fetchAnchors(); }, anchorMs);
      post({ type: "ready", at: Date.now() });
      break;
    }
    case "setToken":
      authToken = data.token;
      break;
    case "insertSignal":
      void insertSignal(data.reqId, data.row, data.token);
      break;
    case "ping":
      post({ type: "pong", at: Date.now() });
      break;
    case "stop":
      started = false;
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      if (anchorTimer) { clearInterval(anchorTimer); anchorTimer = null; }
      break;
  }
};
export {};
