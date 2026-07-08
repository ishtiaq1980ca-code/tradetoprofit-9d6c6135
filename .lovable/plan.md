
# Bot Upgrade Plan — 5 Prompts, Step by Step

Ye plan aap ke diye huwy 5 prompts ko end-to-end implement karega. Sabhi mojooda pair names (EURUSD, GBPUSD, USDJPY, AUDUSD, NZDUSD, USDCAD, USDCHF, XAUUSD) aur mojooda MT5 account/bridge wiring as-is rahenge.

---

## Prompt 1 — Pair Configuration (Editable Settings)

**Kya banega:**
- Har FX pair (EURUSD, GBPUSD, USDJPY, AUDUSD, NZDUSD, USDCAD, USDCHF) ke liye alag config row.
- XAUUSD ki alag config (wider ATR stop, gold-specific RR, spread cap).
- Naya `pair_settings` table (per-user, RLS scoped to `auth.uid()`), fields:
  - symbol, enabled, ema_fast, ema_slow, rsi_period, rsi_lower, rsi_upper, adx_min, atr_period, atr_sl_mult, rr_target, max_spread_pct, min_confidence, risk_per_trade_pct, max_lot.
- Migration seeds default row per pair for existing users.
- Naya route `/settings/pairs` — editable table (input per field, save button).
- `src/lib/pairProfiles.ts` runtime override: bot loads DB rows and merges over static defaults.

## Prompt 2 — Strategy Engine + AI Confidence

**Kya banega (in `src/lib/signalGenerator.ts` + `src/lib/strategies.ts`):**
- Confirmations required (all must pass):
  1. EMA50/EMA200 trend alignment
  2. RSI in configured band (not overbought/oversold against direction)
  3. MACD histogram crossover in trade direction
  4. ADX ≥ pair's `adx_min`
  5. ATR active (within min/max ATR% band)
  6. Multi-timeframe: M15 signal + H1 trend agreement
- **AI confidence score (0-100):** weighted sum of the 6 checks + slope strength + MACD histogram momentum + session bonus.
- **Hard gate: only emit signal if `confidence >= 85`.**
- Confidence stored on `signals` row (new column `confidence numeric`).

## Prompt 4 — Risk Management

**In `src/lib/riskEngine.ts` + `src/lib/execution.ts` + `public/aurumai_bridge.py`:**
- **Dynamic lot sizing:** lot = (equity × risk_per_trade_pct) / (SL_pips × pip_value), clamped to `max_lot`.
- **Daily loss limit:** already exists via `bot_settings.max_daily_loss` — keep.
- **Daily profit target:** naya field `daily_profit_target` in `bot_settings`; jab hit, bot din ke liye pause.
- **Max open trades:** 15 total, XAUUSD priority (already done, keep).
- **Break-even:** +0.5 USD (already in bridge).
- **Trailing stop:** dynamic FX-safe (already in bridge, keep).
- **Partial profit booking:** at +1R close 50% of lot, move SL to BE for remainder — implemented in bridge's position manager.

## Prompt 5 — MT5 Execution

**In `public/aurumai_bridge.py` + `src/routes/api/public/bridge/*`:**
- **Queue optimization:** poll interval 200ms, batch fetch up to 20 signals (already done).
- **Retry logic:** on MT5 `TRADE_RETCODE_REQUOTE`/`PRICE_OFF`/`TIMEOUT` retry up to 3× with fresh price.
- **SL/TP validation:** enforce broker `stops_level`, min distance check; auto-adjust if inside minimum distance (or reject with reason).
- **Duplicate trade prevention:** bridge checks open positions by `(symbol, side, magic)` — skip if same-direction open with matching comment/signal-id.
- **Detailed logging:** every attempt logged to new `execution_log` table (signal_id, symbol, action, retcode, retry_count, latency_ms, error).
- **Faster execution:** immediate execute on receive (already done, no queueing beyond leasing).

## Prompt 6 — Analytics

**Naya route `/analytics`:**
- Win rate per pair (from `trades` table, closed only)
- P&L (daily, weekly, cumulative) — line chart
- Drawdown (running peak-equity vs current)
- Rejection reasons — group by `signals.reason` where status=rejected
- AI confidence history — scatter of confidence vs realized P&L per trade

Uses recharts (already in stack). All queries via `requireSupabaseAuth` server fns.

---

## Technical section

### DB migrations (2 migrations)
1. `pair_settings` table + RLS + seed defaults; add `confidence` column to `signals`; add `daily_profit_target` to `bot_settings`.
2. `execution_log` table + RLS.

### Files to create
- `src/routes/settings.pairs.tsx`
- `src/routes/analytics.tsx`
- `src/lib/pairSettings.functions.ts` (load/save)
- `src/lib/analytics.functions.ts`
- `src/lib/executionLog.functions.ts`

### Files to edit
- `src/lib/pairProfiles.ts` — merge DB overrides
- `src/lib/signalGenerator.ts` — add MTF + confidence scorer + 85 gate
- `src/lib/riskEngine.ts` — dynamic lot + daily profit target
- `src/lib/execution.ts` — pass confidence, dedupe check
- `src/routes/api/public/bridge/poll.ts` — include confidence in payload
- `src/routes/api/public/bridge/trades.ts` — log to execution_log
- `public/aurumai_bridge.py` — retry logic, stops_level validation, dedupe by symbol+side, partial profit at +1R, execution logging POST
- `src/components/AppShell.tsx` — nav links for `/settings/pairs` and `/analytics`

### Rollout
- Delivered in 5 sequential turns (Prompt 1 → 2 → 4 → 5 → 6) so each stage can be verified before the next.
- Bridge version bumped once at end so users re-download `aurumai_bridge.py` only once.

Confirm and I'll start with Prompt 1 (DB migration + pair settings page).
