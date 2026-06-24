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
BASE_URL     = "https://tradetoprofit.lovable.app" # paste only the Base URL from the MT5 Bridge page
BRIDGE_TOKEN = ""                                 # paste your active Bridge token / license token
MT5_LOGIN    = 0                                  # your MT5 demo account number
MT5_PASS     = ""                                 # your MT5 password
MT5_SERVER   = ""                                 # your broker server, e.g. "MetaQuotes-Demo"
POLL_SEC     = 1                                  # how often to poll for new signals
SLIPPAGE     = 20                                 # in points
MAGIC        = 770077                             # unique magic number for AurumAI trades
TRAILING_ATR_MULT = 1.0                           # trailing stop in ATR units
MAX_ENTRY_DRIFT_PCT = 0.0015                      # 0.15% — reject fills if live price drifted too far from signal entry

# Symbol overrides: map AurumAI signal symbol -> EXACT broker symbol name shown
# in your MT5 Market Watch. In MT5: right-click Market Watch -> "Symbols" ->
# search "XAU" or "GOLD" -> copy the exact USD-quoted name (NOT XAUEUR).
# Common broker variants: "XAUUSD.i", "XAUUSDm", "XAUUSD#", "XAUUSD.pro", "GOLD", "GOLD.i"
SYMBOL_OVERRIDES = {
    "XAUUSD": "",   # <-- paste your broker's exact USD-quoted gold symbol here
}
# ==================================

HEADERS = {"Authorization": f"Bearer {BRIDGE_TOKEN}"}


def _post_json(path: str, payload: dict, timeout: int = 10) -> bool:
    """Post to the dashboard and print server-side validation errors."""
    try:
        r = requests.post(f"{BASE_URL}{path}", json=payload, headers=HEADERS, timeout=timeout)
        if not r.ok:
            print(f"POST {path} HTTP {r.status_code}: {r.text[:240]}")
            return False
        return True
    except Exception as e:
        print(f"POST {path} failed: {e}")
        return False


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
    }
    return _post_json("/api/public/bridge/account", payload)


_SYMBOL_CACHE: dict[str, str] = {}


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
                     sig_entry: float) -> tuple[float, float] | None:
    info = mt5.symbol_info(symbol)
    if info is None:
        return None
    point = info.point or 0.01
    digits = info.digits or 2
    min_dist = max(info.trade_stops_level, 10) * point  # broker minimum

    # If the broker symbol is on a very different price scale (different quote
    # currency, contract size, etc.), the SL/TP from the dashboard signal will
    # be meaningless. Rebuild them around the live price preserving the
    # original SL/TP distance.
    if sig_entry > 0 and abs(price - sig_entry) / sig_entry > 0.05:
        sl_dist = abs(sig_entry - sl)
        tp_dist = abs(sig_entry - tp)
        sl = price - sl_dist if is_buy else price + sl_dist
        tp = price + tp_dist if is_buy else price - tp_dist

    # Enforce broker minimum distance
    if is_buy:
        if price - sl < min_dist: sl = price - min_dist
        if tp - price < min_dist: tp = price + min_dist
    else:
        if sl - price < min_dist: sl = price + min_dist
        if price - tp < min_dist: tp = price - min_dist

    return round(sl, digits), round(tp, digits)


def report_trade_failure(sig: dict, symbol: str, reason: str):
    print(f"trade failed {sig.get('side')} {symbol}: {reason}")
    _post_json("/api/public/bridge/trades", {
            "signal_id": sig.get("id"),
            "mt5_ticket": None,
            "symbol": sig.get("symbol") or symbol,
            "side": sig.get("side"),
            "entry": float(sig.get("entry") or sig.get("price") or 0),
            "stop_loss": float(sig.get("stop_loss") or 0),
            "take_profit": float(sig.get("take_profit") or 0),
            "lot": float(sig.get("lot") or 0.01),
            "status": "cancelled",
            "failure_reason": reason,
        })


def _send_with_supported_filling(req: dict):
    # Brokers differ by symbol: some reject IOC/FOK with retcode 10030.
    # Try all common fill policies without delaying order placement.
    tried = []
    for filling in (mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN):
        req["type_filling"] = filling
        tried.append(str(filling))
        check = mt5.order_check(req)
        if check is None:
            print(f"order_check failed for filling={filling}: {mt5.last_error()}")
            continue
        if check.retcode not in (0, mt5.TRADE_RETCODE_DONE):
            if check.retcode in (10030, 10018):
                continue
            print(f"order_check rejected filling={filling}: {check.retcode} {check.comment}")
            return check
        res = mt5.order_send(req)
        if res is not None and res.retcode == mt5.TRADE_RETCODE_DONE:
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
    normalized = _normalize_stops(symbol, is_buy, price,
                                  float(sig["stop_loss"]), float(sig["take_profit"]),
                                  float(sig.get("entry") or sig.get("price") or 0))
    if normalized is None:
        print(f"symbol_info failed for {symbol}")
        return False
    sl, tp = normalized
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
            requests.post(f"{BASE_URL}/api/public/bridge/trades", headers=HEADERS, timeout=10, json={
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
    print(f"AurumAI bridge online, polling {BASE_URL} every {POLL_SEC}s")
    last_acct = 0
    while True:
        try:
            if not mt5_ready():
                time.sleep(POLL_SEC)
                continue

            # Send a fresh heartbeat before taking any signal lease. If this
            # stops updating, the dashboard correctly shows MT5 as stale and
            # the browser bot will pause new queues instead of pretending the
            # trade was executed.
            if time.time() - last_acct > 15:
                report_account()
                sync_closed_trades()
                last_acct = time.time()

            r = requests.get(f"{BASE_URL}/api/public/bridge/poll", headers=HEADERS, timeout=10)
            if r.ok:
                try:
                    data = r.json()
                except Exception:
                    print(f"poll returned non-JSON. Check BASE_URL; current value is {BASE_URL}")
                    data = {"enabled": False, "signals": []}
                if data.get("enabled") and data.get("signals"):
                    for sig in data["signals"]:
                        execute_signal(sig)
                elif data.get("reason"):
                    print(f"Bot disabled by server: {data['reason']}")
            else:
                print(f"poll HTTP {r.status_code}: {r.text[:160]}")
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
