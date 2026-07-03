"""
AurumAI MT5 Bridge
==================
Runs on the Windows machine where MetaTrader 5 is installed.
Polls AurumAI for trade signals, executes them on MT5, and reports
account state + executed trades back to the dashboard.

Setup:
    pip install MetaTrader5 requests

Edit the CONFIG section below, then:
    python aurumai_bridge.py
"""

import time
import datetime as dt
import json
import sys

try:
    import MetaTrader5 as mt5
except ImportError:
    print("ERROR: MetaTrader5 package not installed. Run: pip install MetaTrader5")
    sys.exit(1)

import requests

# ============= CONFIG =============
BRIDGE_VERSION = 2026070301                       # server rejects older scripts to prevent unsafe SL/TP execution
BASE_URL     = "https://tradetoprofit.lovable.app" # paste only the Base URL from the MT5 Bridge page
BRIDGE_TOKEN = ""                                 # paste your active Bridge token / license token
MT5_LOGIN    = 0                                  # your MT5 demo account number
MT5_PASS     = ""                                 # your MT5 password
MT5_SERVER   = ""                                 # your broker server, e.g. "MetaQuotes-Demo"
POLL_SEC     = 0.2                                # turbo polling; server also rejects stale fills
SLIPPAGE     = 3                                  # in points; keep low so late/bad fills are rejected
MAGIC        = 770077                             # unique magic number for AurumAI trades
TRAILING_ATR_MULT = 1.0                           # trailing stop in ATR units
MAX_ADVERSE_ENTRY_DRIFT_PCT = 0.0020              # 0.20% adverse move allowed — signals execute immediately, rarely rejected as "stale"
MAX_FAVORABLE_ENTRY_DRIFT_PCT = 0.0060            # 0.60% favorable move allowed; SL/TP are rebuilt around live MT5 fill
MIN_TP_SPREAD_MULT = 3.0                          # TP must be at least 3× live spread from entry
MIN_SL_SPREAD_MULT = 2.0                          # SL must be at least 2× live spread from entry
MIN_RISK_REWARD = 1.8                             # all pairs: TP must be at least 1.8× SL distance (matches server floor)
USD_TRAIL_TRIGGER = 0.5                           # start protecting once floating profit is at least +$0.50 (fast BE + trail)
USD_TRAIL_STEP = 0.5                              # tight ratchet: +$1 locks +$0.50, +$1.50 locks +$1.00 — cuts losses fast, closes trades sooner

# Symbol overrides: map AurumAI signal symbol -> EXACT broker symbol name shown
# in your MT5 Market Watch. In MT5: right-click Market Watch -> "Symbols" ->
# search "XAU" or "GOLD" -> copy the exact USD-quoted name (NOT XAUEUR).
# Common broker variants: "XAUUSD.i", "XAUUSDm", "XAUUSD#", "XAUUSD.pro", "GOLD", "GOLD.i"
SYMBOL_OVERRIDES = {
    "XAUUSD": "",   # <-- paste your broker's exact USD-quoted gold symbol here
}
# ==================================

HEADERS = {"Authorization": f"Bearer {BRIDGE_TOKEN}", "X-Aurum-Bridge-Version": str(BRIDGE_VERSION)}
SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def _post_json(path: str, payload: dict, timeout: int = 10) -> bool:
    """Post to the dashboard and print server-side validation errors."""
    try:
        r = SESSION.post(f"{BASE_URL}{path}", json=payload, timeout=timeout)
        if not r.ok:
            print(f"POST {path} HTTP {r.status_code}: {r.text[:240]}")
            return False
        return True
    except Exception as e:
        print(f"POST {path} failed: {e}")
        return False


def _get_json(path: str, timeout: int = 5) -> tuple[bool, dict | None, str]:
    """GET JSON through one persistent HTTPS session for lower latency."""
    try:
        r = SESSION.get(f"{BASE_URL}{path}", timeout=timeout)
        if not r.ok:
            return False, None, f"HTTP {r.status_code}: {r.text[:160]}"
        try:
            return True, r.json(), ""
        except Exception:
            return False, None, f"non-JSON response. Check BASE_URL; current value is {BASE_URL}"
    except Exception as e:
        return False, None, str(e)


def connect_mt5() -> bool:
    if not mt5.initialize(login=MT5_LOGIN, password=MT5_PASS, server=MT5_SERVER):
        print(f"MT5 init failed: {mt5.last_error()}")
        return False
    info = mt5.account_info()
    if info is None:
        print(f"MT5 account_info failed: {mt5.last_error()}")
        return False
    print(f"Connected: {info.login} @ {info.server} | bal={info.balance} eq={info.equity}")
    return True


def mt5_ready() -> bool:
    """Keep the terminal connection alive before polling/placing trades."""
    if mt5.account_info() is not None:
        return True
    print(f"MT5 connection stale/lost: {mt5.last_error()} — reconnecting")
    try:
        mt5.shutdown()
    except Exception:
        pass
    time.sleep(1)
    return connect_mt5()


def report_account() -> bool:
    if not mt5_ready():
        print("Account heartbeat skipped: MT5 is not connected")
        return False
    info = mt5.account_info()
    if info is None:
        print(f"MT5 account_info failed: {mt5.last_error()}")
        return False
    now = dt.datetime.now(dt.UTC)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    history = mt5.history_deals_get(today, now) or []
    daily_pnl = sum(d.profit for d in history if d.magic == MAGIC)
    positions = mt5.positions_get() or []
    payload = {
        "balance": float(info.balance),
        "equity": float(info.equity),
        "margin": float(info.margin),
        "free_margin": float(info.margin_free),
        "open_positions": len(positions),
        "daily_pnl": float(daily_pnl),
        "mode": "demo" if "demo" in (info.server or "").lower() else "real",
        "login": str(getattr(info, "login", "") or ""),
        "name": str(getattr(info, "name", "") or ""),
        "server": str(getattr(info, "server", "") or ""),
        "company": str(getattr(info, "company", "") or ""),
        "currency": str(getattr(info, "currency", "") or ""),
        "leverage": int(getattr(info, "leverage", 0) or 0),
    }
    return _post_json("/api/public/bridge/account", payload)


_SYMBOL_CACHE: dict[str, str] = {}
_FILLING_CACHE: dict[str, int] = {}


def _quote_currency_ok(name: str, original: str, want_quote: str) -> bool:
    """Accept broker suffixes (EURUSDm, USDJPY.pro) but reject wrong-quote symbols."""
    other_quotes = {"EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"}
    other_quotes.discard(want_quote)
    upper = name.upper()
    wanted_pair = original.upper()
    # Normal FX pairs include the base currency by design (EURUSD contains EUR),
    # so only require that the exact pair appears before any broker suffix.
    if len(wanted_pair) == 6 and wanted_pair[:3] in other_quotes:
        return wanted_pair in upper
    if want_quote not in upper:
        return False
    for q in other_quotes:
        # base+wrong-quote pattern e.g. "XAUEUR"
        if q in upper.replace(want_quote, "", 1):
            return False
    return True


def resolve_symbol(original: str) -> str | None:
    if original in _SYMBOL_CACHE:
        return _SYMBOL_CACHE[original]

    # 1) Honor explicit override from CONFIG (skip quote-currency guardrail —
    #    user has explicitly told us this is the right broker symbol).
    override = (SYMBOL_OVERRIDES.get(original) or "").strip()
    if override:
        if mt5.symbol_select(override, True):
            _SYMBOL_CACHE[original] = override
            print(f"Mapped {original} -> broker symbol {override} (override)")
            return override
        print(f"SYMBOL_OVERRIDES['{original}'] = '{override}' not found on broker; check spelling in Market Watch")
        return None

    want_quote = original[-3:].upper() if len(original) >= 6 else "USD"
    base = original[:-3] if len(original) >= 6 else original
    candidates = [
        original,
        f"{original}m", f"{original}.", f"{original}_", f"{original}#", f"{original}.i", f"{original}.pro",
    ]
    if original == "XAUUSD":
        candidates += ["GOLD", "Gold", "XAUUSDm", "XAUUSD.", "XAUUSD_", "XAUUSD#"]
    for c in candidates:
        if _quote_currency_ok(c, original, want_quote) and mt5.symbol_select(c, True):
            _SYMBOL_CACHE[original] = c
            if c != original:
                print(f"Mapped {original} -> broker symbol {c}")
            return c
    # broad search but filter out wrong-quote variants
    matches = mt5.symbols_get(f"*{base}*") or []
    for m in matches:
        if _quote_currency_ok(m.name, original, want_quote) and mt5.symbol_select(m.name, True):
            _SYMBOL_CACHE[original] = m.name
            print(f"Mapped {original} -> broker symbol {m.name}")
            return m.name
    available = ", ".join(sorted({m.name for m in matches})[:10]) or "(none)"
    print(
        f"symbol_select failed for {original}; no {want_quote}-quoted variant found.\n"
        f"  Available {base}* symbols on your broker: {available}\n"
        f"  Fix: set SYMBOL_OVERRIDES['{original}'] in the CONFIG section to the exact broker name."
    )
    return None


def _normalize_stops(symbol: str, is_buy: bool, price: float, sl: float, tp: float,
                     sig_entry: float, spread: float) -> tuple[float, float] | None:
    info = mt5.symbol_info(symbol)
    if info is None:
        return None
    point = info.point or 0.01
    digits = info.digits or 2
    min_dist = max(info.trade_stops_level, 10) * point  # broker minimum
    min_sl_dist = max(min_dist, spread * MIN_SL_SPREAD_MULT, point * 10)
    min_tp_dist = max(min_dist, spread * MIN_TP_SPREAD_MULT, point * 10)
    original_sl_dist = abs(sig_entry - sl) if sig_entry > 0 else abs(price - sl)
    original_tp_dist = abs(sig_entry - tp) if sig_entry > 0 else abs(price - tp)
    rr = original_tp_dist / max(original_sl_dist, point)
    if not (MIN_RISK_REWARD <= rr <= 6.0):
        rr = 2.0

    # Always rebuild SL/TP around the actual broker fill price. If we keep the
    # old dashboard TP after price has moved, SELL entries can end up with a TP
    # only a few points away while SL remains huge. Re-anchoring preserves the
    # intended risk distance and guarantees TP is on the profitable side.
    sl_dist = max(original_sl_dist, min_sl_dist)
    tp_dist = max(original_tp_dist, min_tp_dist, sl_dist * rr)
    sl = price - sl_dist if is_buy else price + sl_dist
    tp = price + tp_dist if is_buy else price - tp_dist

    return round(sl, digits), round(tp, digits)


def _entry_drift_reject_reason(is_buy: bool, live_price: float, sig_entry: float,
                               sig_sl: float, spread: float, label: str) -> str | None:
    """Reject only genuinely stale/bad prices.

    The old bridge used one tiny 0.03% drift limit in both directions. That
    blocked valid momentum fills after the price moved in the trade's favor.
    We now keep adverse moves tight, allow larger favorable moves, and still
    rebuild SL/TP around the actual MT5 price so TP stays spread-aware.
    """
    if sig_entry <= 0 or live_price <= 0:
        return None
    drift = (live_price - sig_entry) / sig_entry
    if abs(drift) >= 0.05:
        return None  # different quote scale / broker symbol variant; stop normalization handles it

    # If price has already invalidated the idea by crossing the original SL,
    # do not chase it. Favorable movement is allowed up to the wider limit.
    if (is_buy and live_price <= sig_sl) or ((not is_buy) and live_price >= sig_sl):
        return f"stale signal: {label}={live_price} already crossed original SL {sig_sl}"

    adverse = (is_buy and drift < 0) or ((not is_buy) and drift > 0)
    base_limit = MAX_ADVERSE_ENTRY_DRIFT_PCT if adverse else MAX_FAVORABLE_ENTRY_DRIFT_PCT
    spread_pct = abs(spread / sig_entry) if sig_entry > 0 else 0
    limit = max(base_limit, spread_pct * (4 if adverse else 10))
    if abs(drift) > limit:
        direction = "adverse" if adverse else "favorable"
        return (
            f"stale signal: {label}={live_price} vs signal_entry={sig_entry} "
            f"{direction}_drift={abs(drift)*100:.3f}% > {limit*100:.2f}%"
        )
    return None


def report_trade_failure(sig: dict, symbol: str, reason: str, mt5_ticket: int | None = None):
    print(f"trade failed {sig.get('side')} {symbol}: {reason}")
    _post_json("/api/public/bridge/trades", {
            "signal_id": sig.get("id"),
            "mt5_ticket": mt5_ticket,
            "symbol": sig.get("symbol") or symbol,
            "side": sig.get("side"),
            "entry": float(sig.get("entry") or sig.get("price") or 0),
            "stop_loss": float(sig.get("stop_loss") or 0),
            "take_profit": float(sig.get("take_profit") or 0),
            "lot": float(sig.get("lot") or 0.01),
            "status": "cancelled",
            "failure_reason": reason,
        })


def _close_position(position, reason: str) -> bool:
    tick = mt5.symbol_info_tick(position.symbol)
    if tick is None:
        print(f"cannot close bad fill ticket={position.ticket}: no live tick ({reason})")
        return False
    is_buy_position = position.type == mt5.POSITION_TYPE_BUY
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": position.symbol,
        "position": position.ticket,
        "volume": position.volume,
        "type": mt5.ORDER_TYPE_SELL if is_buy_position else mt5.ORDER_TYPE_BUY,
        "price": tick.bid if is_buy_position else tick.ask,
        "deviation": SLIPPAGE,
        "magic": MAGIC,
        "comment": "AurumAI risk-close",
        "type_time": mt5.ORDER_TIME_GTC,
    }
    res = _send_with_supported_filling(req)
    if res is not None and res.retcode == mt5.TRADE_RETCODE_DONE:
        print(f"closed bad fill ticket={position.ticket}: {reason}")
        return True
    print(f"FAILED to close bad fill ticket={position.ticket}: {reason}; retcode={res.retcode if res else 'None'} {res.comment if res else ''}")
    return False


def _modify_position_stops(position, sl: float, tp: float) -> bool:
    req = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": position.symbol,
        "position": position.ticket,
        "sl": sl,
        "tp": tp,
        "magic": MAGIC,
        "comment": "AurumAI RR-fix",
    }
    res = mt5.order_send(req)
    if res is not None and res.retcode == mt5.TRADE_RETCODE_DONE:
        return True
    print(f"SLTP modify failed ticket={position.ticket}: retcode={res.retcode if res else 'None'} {res.comment if res else ''}")
    return False


def _value_per_price_unit(symbol: str, volume: float) -> float:
    """Account-currency value of a 1.0 price-unit move for this position."""
    info = mt5.symbol_info(symbol)
    if info is not None:
        tick_size = float(info.trade_tick_size or info.point or 0)
        tick_value = float(info.trade_tick_value or 0)
        if tick_size > 0 and tick_value > 0:
            return abs(tick_value / tick_size) * volume
    upper = symbol.upper()
    if "XAU" in upper or "GOLD" in upper:
        return 100.0 * volume
    if "JPY" in upper:
        return 1000.0 * volume
    return 100000.0 * volume


def _report_trailing_update(position) -> None:
    _post_json("/api/public/bridge/trades", {
        "mt5_ticket": int(position.ticket),
        "symbol": position.symbol,
        "side": "BUY" if position.type == mt5.POSITION_TYPE_BUY else "SELL",
        "entry": float(position.price_open),
        "stop_loss": float(position.sl or 0),
        "take_profit": float(position.tp or 0),
        "lot": float(position.volume),
        "profit": float(position.profit or 0),
        "status": "open",
    }, timeout=3)


def _apply_usd_trailing_stop(position) -> bool:
    """Move SL only forward. Once profit clears broker's min-stop distance
    the SL snaps to breakeven, then ratchets in USD_TRAIL_STEP increments.
    On FX at 0.01 lots the $0.50 trigger alone is not enough because the
    broker's stop-level (usually 10 points ≈ 1 pip) blocks a BE stop until
    price has moved further — so we bump the required profit dynamically."""
    if position.magic != MAGIC:
        return False
    profit = float(position.profit or 0)
    tick = mt5.symbol_info_tick(position.symbol)
    info = mt5.symbol_info(position.symbol)
    if tick is None or info is None:
        return False

    is_buy = position.type == mt5.POSITION_TYPE_BUY
    entry = float(position.price_open)
    old_sl = float(position.sl or 0)
    tp = float(position.tp or 0)
    point = float(info.point or 0.00001)
    digits = int(info.digits or 5)
    min_dist = max(float(info.trade_stops_level or 0), 10.0) * point
    vpu = _value_per_price_unit(position.symbol, float(position.volume or 0))
    if entry <= 0 or vpu <= 0:
        return False

    # Minimum profit needed so that (bid/ask - min_dist) is at or above
    # breakeven. Without this on FX the SL move gets rejected silently and
    # trades sit at raw entry SL forever.
    be_required_usd = min_dist * vpu + 0.05
    effective_trigger = max(USD_TRAIL_TRIGGER, be_required_usd)
    if profit < effective_trigger:
        return False

    # Lock (profit - step) USD of profit. Below BE clamps to entry so we
    # never move SL backward into loss.
    lock_usd = max(0.0, profit - USD_TRAIL_STEP)
    lock_price_move = lock_usd / vpu
    raw_sl = entry + lock_price_move if is_buy else entry - lock_price_move

    if is_buy:
        max_allowed_sl = float(tick.bid) - min_dist
        new_sl = min(raw_sl, max_allowed_sl)
        if new_sl < entry:
            return False
        better = old_sl <= 0 or new_sl > old_sl + point
    else:
        min_allowed_sl = float(tick.ask) + min_dist
        new_sl = max(raw_sl, min_allowed_sl)
        if new_sl > entry:
            return False
        better = old_sl <= 0 or new_sl < old_sl - point
    if not better:
        return False

    new_sl = round(new_sl, digits)
    if _modify_position_stops(position, new_sl, tp):
        refreshed = _find_position_after_fill(position.symbol, int(position.ticket), None, allow_latest=False) or position
        print(f"Trailing SL moved ticket={position.ticket} profit=${profit:.2f} sl={new_sl} (trigger=${effective_trigger:.2f})")
        _report_trailing_update(refreshed)
        return True
    return False



def manage_trailing_stops() -> int:
    positions = mt5.positions_get() or []
    moved = 0
    for p in positions:
        try:
            if _apply_usd_trailing_stop(p):
                moved += 1
        except Exception as e:
            print(f"trailing failed ticket={getattr(p, 'ticket', '?')}: {e}")
    return moved


def _send_with_supported_filling(req: dict):
    # Brokers differ by symbol: some reject IOC/FOK with retcode 10030. Send
    # directly and cache the working fill policy; order_check adds avoidable MT5
    # round-trips and increases entry drift.
    symbol = req.get("symbol")
    cached = _FILLING_CACHE.get(symbol) if symbol else None
    policies = []
    if cached is not None:
        policies.append(cached)
    for p in (mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN):
        if p not in policies:
            policies.append(p)
    tried = []
    res = None
    for filling in policies:
        req["type_filling"] = filling
        tried.append(str(filling))
        res = mt5.order_send(req)
        if res is not None and res.retcode == mt5.TRADE_RETCODE_DONE:
            if symbol:
                _FILLING_CACHE[symbol] = filling
            return res
        if res is not None and res.retcode not in (10030, 10018):
            return res
    print(f"all filling modes rejected/failed: {', '.join(tried)}")
    return res if 'res' in locals() else None


def _find_position_after_fill(symbol: str, ticket: int | None, signal_id: str | None, allow_latest: bool = True):
    positions = mt5.positions_get(symbol=symbol) or []
    tagged = f"AurumAI {signal_id[:8]}" if signal_id else "AurumAI"
    for p in positions:
        if ticket and (p.ticket == ticket or p.identifier == ticket):
            return p
    for p in positions:
        if p.magic == MAGIC and tagged in (p.comment or ""):
            return p
    if not allow_latest:
        return None
    aurum_positions = [p for p in positions if p.magic == MAGIC]
    return aurum_positions[-1] if aurum_positions else None


def _report_open_position(sig: dict, original_symbol: str, position) -> bool:
    return _post_json("/api/public/bridge/trades", {
        "signal_id": sig.get("id"),
        "mt5_ticket": int(position.ticket),
        "symbol": original_symbol,
        "side": sig["side"],
        "entry": float(position.price_open),
        "stop_loss": float(position.sl or 0),
        "take_profit": float(position.tp or 0),
        "lot": float(position.volume),
        "status": "open",
    })


def execute_signal(sig: dict) -> bool:
    original_symbol = sig["symbol"]
    if not mt5_ready():
        print(f"Skipping {sig.get('side')} {original_symbol}: MT5 terminal is offline")
        return False
    symbol = resolve_symbol(original_symbol)
    if symbol is None:
        report_trade_failure(sig, original_symbol, "broker symbol not found; set SYMBOL_OVERRIDES to exact Market Watch symbol")
        return False
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        report_trade_failure(sig, symbol, "no live tick")
        return False
    info = mt5.symbol_info(symbol)
    if info is None or not info.visible:
        report_trade_failure(sig, symbol, "symbol not visible/available")
        return False
    if info.trade_mode == mt5.SYMBOL_TRADE_MODE_DISABLED:
        report_trade_failure(sig, symbol, "symbol trade disabled by broker")
        return False
    already_open = _find_position_after_fill(symbol, None, str(sig.get("id") or ""), allow_latest=False)
    if already_open is not None:
        print(f"Signal {sig.get('id')} already has MT5 position ticket={already_open.ticket}; confirming instead of opening duplicate")
        return _report_open_position(sig, original_symbol, already_open)
    is_buy = sig["side"] == "BUY"
    price = tick.ask if is_buy else tick.bid
    spread = abs(float(tick.ask) - float(tick.bid))
    sig_entry = float(sig.get("entry") or sig.get("price") or 0)
    sig_sl = float(sig["stop_loss"])
    sig_tp = float(sig["take_profit"])
    # Reject malformed or already-consumed signals before MT5 order_send.
    if sig_entry > 0:
        if is_buy and not (sig_sl < sig_entry < sig_tp):
            report_trade_failure(sig, symbol, f"invalid BUY plan: sl={sig_sl} entry={sig_entry} tp={sig_tp}")
            return False
        if (not is_buy) and not (sig_tp < sig_entry < sig_sl):
            report_trade_failure(sig, symbol, f"invalid SELL plan: tp={sig_tp} entry={sig_entry} sl={sig_sl}")
            return False

    # Reject stale fills adaptively. Adverse moves stay tight; favorable moves
    # are allowed because SL/TP are rebuilt around the live MT5 entry below.
    if sig_entry > 0:
        stale_reason = _entry_drift_reject_reason(is_buy, price, sig_entry, sig_sl, spread, "live")
        if stale_reason:
            report_trade_failure(sig, symbol, stale_reason)
            return False
    normalized = _normalize_stops(symbol, is_buy, price,
                                  sig_sl, sig_tp,
                                  sig_entry, spread)
    if normalized is None:
        print(f"symbol_info failed for {symbol}")
        return False
    sl, tp = normalized
    sl_dist = abs(price - sl)
    tp_dist = abs(tp - price)
    rr_final = tp_dist / max(sl_dist, info.point or 0.00001)
    if rr_final < MIN_RISK_REWARD:
        report_trade_failure(sig, symbol, f"risk/reward too small after normalization: RR={rr_final:.2f} price={price} sl={sl} tp={tp}")
        return False
    if (is_buy and not (sl < price < tp)) or ((not is_buy) and not (tp < price < sl)):
        report_trade_failure(sig, symbol, f"normalized stops invalid: price={price} sl={sl} tp={tp}")
        return False
    volume = float(sig["lot"])
    min_vol = float(info.volume_min or 0.01)
    step = float(info.volume_step or 0.01)
    if volume < min_vol:
        volume = min_vol
    volume = round(round(volume / step) * step, 2)
    sig_id = str(sig.get("id") or "")
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": SLIPPAGE,
        "magic": MAGIC,
        "comment": f"AurumAI {sig_id[:8] or sig['confidence']:.0f}%" if not sig_id else f"AurumAI {sig_id[:8]}",
        "type_time": mt5.ORDER_TIME_GTC,
    }
    res = _send_with_supported_filling(req)
    if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
        report_trade_failure(
            sig, symbol,
            f"order_send retcode={res.retcode if res else 'None'} {res.comment if res else ''} price={price} sl={sl} tp={tp}",
        )
        return False
    ticket = int(res.order or res.deal or 0)
    position = None
    for _ in range(5):
        position = _find_position_after_fill(symbol, ticket, sig_id)
        if position is not None:
            break
        time.sleep(0.2)
    if position is not None:
        ticket = int(position.ticket)
        filled_price = float(position.price_open)
        live_sl = float(position.sl or 0)
        live_tp = float(position.tp or 0)

        if sig_entry > 0:
            stale_reason = _entry_drift_reject_reason(is_buy, filled_price, sig_entry, sig_sl, spread, "filled")
            if stale_reason:
                reason = stale_reason.replace("stale signal", "bad MT5 fill", 1)
                _close_position(position, reason)
                report_trade_failure(sig, symbol, reason, ticket)
                return False

        fixed = _normalize_stops(symbol, is_buy, filled_price, sig_sl, sig_tp, sig_entry, spread)
        if fixed is None:
            reason = "could not recalculate SL/TP after fill"
            _close_position(position, reason)
            report_trade_failure(sig, symbol, reason, ticket)
            return False
        fixed_sl, fixed_tp = fixed
        fixed_rr = abs(fixed_tp - filled_price) / max(abs(filled_price - fixed_sl), info.point or 0.00001)
        if fixed_rr < MIN_RISK_REWARD or (is_buy and not (fixed_sl < filled_price < fixed_tp)) or ((not is_buy) and not (fixed_tp < filled_price < fixed_sl)):
            reason = f"post-fill SL/TP invalid: fill={filled_price} sl={fixed_sl} tp={fixed_tp} RR={fixed_rr:.2f}"
            _close_position(position, reason)
            report_trade_failure(sig, symbol, reason, ticket)
            return False
        if abs(live_sl - fixed_sl) >= (info.point or 0.00001) or abs(live_tp - fixed_tp) >= (info.point or 0.00001):
            if not _modify_position_stops(position, fixed_sl, fixed_tp):
                reason = f"broker accepted entry but rejected safe SL/TP: fill={filled_price} sl={fixed_sl} tp={fixed_tp}"
                _close_position(position, reason)
                report_trade_failure(sig, symbol, reason, ticket)
                return False
            refreshed = _find_position_after_fill(symbol, ticket, sig_id, allow_latest=False)
            if refreshed is not None:
                position = refreshed
                live_sl = float(position.sl or fixed_sl)
                live_tp = float(position.tp or fixed_tp)
            else:
                live_sl = fixed_sl
                live_tp = fixed_tp
        if live_sl <= 0 or live_tp <= 0:
            print(f"Filled {sig['side']} {symbol} ticket={ticket}, but broker did not attach SL/TP; requested sl={sl} tp={tp}")
        else:
            print(f"Filled {sig['side']} {symbol} ticket={ticket} price={filled_price} sl={live_sl} tp={live_tp}")
    else:
        filled_price = float(res.price or price)
        live_sl = float(sl)
        live_tp = float(tp)
        print(f"Filled {sig['side']} {symbol} deal/order={ticket}, position not visible yet; reporting fill")
    ok = _post_json("/api/public/bridge/trades", {
        "signal_id": sig["id"],
        "mt5_ticket": ticket or None,
        "symbol": original_symbol,
        "side": sig["side"],
        "entry": filled_price,
        "stop_loss": live_sl,
        "take_profit": live_tp,
        "lot": volume,
        "status": "open",
    })
    if not ok:
        print("WARNING: MT5 filled the order, but dashboard confirmation failed. The order is on MT5; keep bridge running so sync can catch up.")
    return True


def sync_closed_trades():
    """Report any closed positions opened by AurumAI in the last 24h."""
    now = dt.datetime.now(dt.UTC)
    since = now - dt.timedelta(days=1)
    deals = mt5.history_deals_get(since, now) or []
    seen = set()
    for d in deals:
        if d.magic != MAGIC or d.entry != mt5.DEAL_ENTRY_OUT:
            continue
        if d.position_id in seen:
            continue
        seen.add(d.position_id)
        try:
            SESSION.post(f"{BASE_URL}/api/public/bridge/trades", timeout=10, json={
                "mt5_ticket": int(d.position_id),
                "symbol": d.symbol,
                "side": "BUY" if d.type == mt5.DEAL_TYPE_SELL else "SELL",  # OUT is opposite
                "entry": float(d.price),
                "exit": float(d.price),
                "lot": float(d.volume),
                "profit": float(d.profit),
                "status": "closed",
                "closed_at": dt.datetime.fromtimestamp(d.time, dt.UTC).isoformat(),
            })
        except Exception:
            pass


def main():
    if not connect_mt5():
        sys.exit(1)
    print(f"AurumAI bridge v{BRIDGE_VERSION} online, polling {BASE_URL} every {POLL_SEC}s")
    last_acct = 0
    last_closed_sync = 0
    while True:
        try:
            if not mt5_ready():
                time.sleep(POLL_SEC)
                continue

            # First heartbeat unlocks server polling. Later heartbeats are sent
            # after polling so account/history sync does not delay execution.
            if last_acct == 0:
                report_account()
                last_acct = time.time()

            ok, data, err = _get_json("/api/public/bridge/poll", timeout=5)
            if ok and data is not None:
                if data.get("enabled") and data.get("signals"):
                    for sig in data["signals"]:
                        execute_signal(sig)
                    manage_trailing_stops()
                    # Poll again immediately after a burst so queued signals do
                    # not wait for another sleep cycle.
                    continue
                elif data.get("reason"):
                    print(f"Bot disabled by server: {data['reason']}")
            else:
                print(f"poll failed: {err}")

            manage_trailing_stops()

            if time.time() - last_acct > 15:
                report_account()
                last_acct = time.time()

            if time.time() - last_closed_sync > 60:
                sync_closed_trades()
                last_closed_sync = time.time()
        except Exception as e:
            print(f"poll failed: {e}")

        time.sleep(POLL_SEC)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Shutting down")
    finally:
        mt5.shutdown()
