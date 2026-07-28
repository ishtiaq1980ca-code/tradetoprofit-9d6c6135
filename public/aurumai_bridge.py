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
# TIP: Create a file named `aurumai_config.py` in the SAME folder as this
# script and put your personal settings there. Any variable you define in
# that file overrides the defaults below, so you only edit it ONCE and every
# future bridge update keeps your login + broker symbols intact.
#
# Example aurumai_config.py:
#     BRIDGE_TOKEN = "AURUM-XXXX-XXXX"
#     MT5_LOGIN    = 12345678
#     MT5_PASS     = "your-password"
#     MT5_SERVER   = "YourBroker-Demo"
#     SYMBOL_OVERRIDES = {
#         "XAUUSD": "XAUUSD.i",
#         "EURUSD": "EURUSD.i",
#     }
BRIDGE_VERSION = 2026072801                       # server rejects older scripts to prevent unsafe SL/TP execution
BASE_URL     = "https://tradetoprofit.lovable.app" # paste only the Base URL from the MT5 Bridge page
BRIDGE_TOKEN = ""                                 # paste your active Bridge token / license token
MT5_LOGIN    = 0                                  # your MT5 demo account number (or leave 0 to use whichever account is already logged in on the MT5 terminal)
MT5_PASS     = ""                                 # your MT5 password (leave blank to reuse the terminal's logged-in session)
MT5_SERVER   = ""                                 # your broker server (leave blank to reuse the terminal's logged-in session)
POLL_SEC     = 0.2                                # turbo polling; server also rejects stale fills
SLIPPAGE     = 3                                  # in points; keep low so late/bad fills are rejected
MAGIC        = 770077                             # unique magic number for AurumAI trades
TRAILING_ATR_MULT = 1.0                           # trailing stop in ATR units
MAX_ADVERSE_ENTRY_DRIFT_PCT = 0.0020              # 0.20% adverse move allowed — signals execute immediately, rarely rejected as "stale"
MAX_FAVORABLE_ENTRY_DRIFT_PCT = 0.0060            # 0.60% favorable move allowed; SL/TP are rebuilt around live MT5 fill
PRICE_SOURCE_MISMATCH_BYPASS_PCT = 0.0030         # >0.30% dashboard-vs-broker gap is feed mismatch; rebuild from MT5 price
MIN_TP_SPREAD_MULT = 3.0                          # TP must be at least 3× live spread from entry
MIN_SL_SPREAD_MULT = 2.0                          # SL must be at least 2× live spread from entry
MIN_RISK_REWARD = 1.25                            # built-in strategy: ATR SL 2.2 / ATR TP 2.8 (RR ≈ 1.27)
USD_TRAIL_TRIGGER = 0.5                           # start protecting once floating profit is at least +$0.50
USD_TRAIL_STEP = 0.5                              # tight ratchet: +$1 locks +$0.50, +$1.50 locks +$1.00
MAX_SEND_RETRIES = 3                              # retry MT5 order_send on REQUOTE/PRICE_OFF/TIMEOUT
PARTIAL_TP_R = 1.0                                # at +1R close PARTIAL_TP_PCT of lot, move SL to BE for remainder
PARTIAL_TP_PCT = 0.50                             # 50% partial close
# --- Trailing throttle ---
TRAIL_MIN_INTERVAL_SEC = 5.0                      # do not modify same ticket more than once every N seconds
TRAIL_MIN_STEP_USD = 0.10                         # new SL must lock at least this many extra USD vs last saved SL
TRAIL_TP_PROGRESS_GATE = 0.65                     # once SL is already in profit, only advance after 65% of the way to TP

# ============= AUTO-DETECT MODE =============
# The bridge now auto-detects your broker account (login/server) from the
# already-open MT5 terminal, and auto-discovers every AurumAI symbol on your
# broker (XAUUSD → XAUUSDm, XAUUSD.i, GOLD, etc.).  You do NOT need to
# maintain a SYMBOL_OVERRIDES dict any more — every broker's naming style is
# probed automatically.  Leave SYMBOL_OVERRIDES empty; only add an entry
# below if auto-detection maps a symbol wrong.
SYMBOL_OVERRIDES: dict[str, str] = {}


# --- Load personal overrides from aurumai_config.py if present ---
try:
    import aurumai_config as _cfg  # type: ignore
    _OVERRIDABLE = (
        "BASE_URL", "BRIDGE_TOKEN", "MT5_LOGIN", "MT5_PASS", "MT5_SERVER",
        "POLL_SEC", "SLIPPAGE", "MAGIC",
        "USD_TRAIL_TRIGGER", "USD_TRAIL_STEP",
        "MIN_RISK_REWARD", "MIN_TP_SPREAD_MULT", "MIN_SL_SPREAD_MULT",
        "MAX_ADVERSE_ENTRY_DRIFT_PCT", "MAX_FAVORABLE_ENTRY_DRIFT_PCT", "PRICE_SOURCE_MISMATCH_BYPASS_PCT",
        "PARTIAL_TP_R", "PARTIAL_TP_PCT", "MAX_SEND_RETRIES",
    )
    for _k in _OVERRIDABLE:
        if hasattr(_cfg, _k):
            globals()[_k] = getattr(_cfg, _k)
    if hasattr(_cfg, "SYMBOL_OVERRIDES") and isinstance(_cfg.SYMBOL_OVERRIDES, dict):
        SYMBOL_OVERRIDES = {**SYMBOL_OVERRIDES, **_cfg.SYMBOL_OVERRIDES}
    print("Loaded personal settings from aurumai_config.py")
except ImportError:
    print("No aurumai_config.py found — using values from this file. Create aurumai_config.py to preserve settings across updates.")
except Exception as _e:
    print(f"aurumai_config.py load error: {_e}")
# ==================================

HEADERS = {"Authorization": f"Bearer {BRIDGE_TOKEN}", "X-Aurum-Bridge-Version": str(BRIDGE_VERSION)}


def _new_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    # Retry TCP/DNS/SSL hiccups (typical "port=443" transient errors) via
    # urllib3 retries on the HTTPS adapter so a single dropped keep-alive
    # does not surface as a poll failure.
    try:
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        retry = Retry(
            total=3, connect=3, read=2, backoff_factor=0.3,
            status_forcelist=(502, 503, 504),
            allowed_methods=frozenset(["GET", "POST"]),
            raise_on_status=False,
        )
        s.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=8))
        s.mount("http://", HTTPAdapter(max_retries=retry))
    except Exception:
        pass
    return s


SESSION = _new_session()
_LAST_NET_ERR = {"msg": "", "count": 0, "ts": 0.0}


def _reset_session():
    """Drop the current HTTPS session on connection errors so the next
    request opens a fresh TCP/TLS socket instead of reusing a dead one."""
    global SESSION
    try:
        SESSION.close()
    except Exception:
        pass
    SESSION = _new_session()


def _is_conn_error(exc: Exception) -> bool:
    from requests.exceptions import ConnectionError as ReqConnErr, Timeout, SSLError
    return isinstance(exc, (ReqConnErr, Timeout, SSLError))


def _log_net_err(prefix: str, err: str):
    """Rate-limit repeated network errors so the log isn't spammed with
    identical 'port=443' lines when the internet is briefly down."""
    now = time.time()
    if _LAST_NET_ERR["msg"] == err and now - _LAST_NET_ERR["ts"] < 30:
        _LAST_NET_ERR["count"] += 1
        return
    if _LAST_NET_ERR["count"] > 0:
        print(f"  (previous network error repeated {_LAST_NET_ERR['count']}x)")
    _LAST_NET_ERR["msg"] = err
    _LAST_NET_ERR["ts"] = now
    _LAST_NET_ERR["count"] = 0
    print(f"{prefix} {err}")


def _post_json(path: str, payload: dict, timeout: int = 10) -> bool:
    """Post to the dashboard and print server-side validation errors."""
    for attempt in range(2):
        try:
            r = SESSION.post(f"{BASE_URL}{path}", json=payload, timeout=timeout)
            if not r.ok:
                print(f"POST {path} HTTP {r.status_code}: {r.text[:240]}")
                return False
            return True
        except Exception as e:
            if _is_conn_error(e) and attempt == 0:
                _reset_session()
                continue
            _log_net_err(f"POST {path} failed:", str(e))
            return False
    return False


def _get_json(path: str, timeout: int = 5) -> tuple[bool, dict | None, str]:
    """GET JSON through one persistent HTTPS session for lower latency."""
    for attempt in range(2):
        try:
            r = SESSION.get(f"{BASE_URL}{path}", timeout=timeout)
            if not r.ok:
                return False, None, f"HTTP {r.status_code}: {r.text[:160]}"
            try:
                return True, r.json(), ""
            except Exception:
                return False, None, f"non-JSON response. Check BASE_URL; current value is {BASE_URL}"
        except Exception as e:
            if _is_conn_error(e) and attempt == 0:
                _reset_session()
                continue
            return False, None, str(e)
    return False, None, "unknown network error"



def connect_mt5() -> bool:
    """Connect to MT5.

    Auto-detect mode: if MT5_LOGIN is 0 / MT5_PASS or MT5_SERVER is blank,
    just call mt5.initialize() and reuse whichever account the MetaTrader 5
    terminal is already logged in with. This means the same script works
    across any broker / any account without editing credentials.
    """
    have_creds = bool(MT5_LOGIN) and bool(MT5_PASS) and bool(MT5_SERVER)
    if have_creds:
        ok = mt5.initialize(login=MT5_LOGIN, password=MT5_PASS, server=MT5_SERVER)
    else:
        # Reuse the terminal's active session (whatever broker/account is open).
        ok = mt5.initialize()
    if not ok:
        print(f"MT5 init failed: {mt5.last_error()}")
        print("  If you have not opened MetaTrader 5 and logged in yet, do that first — the bridge will auto-detect the account.")
        return False
    info = mt5.account_info()
    if info is None:
        print(f"MT5 account_info failed: {mt5.last_error()}")
        return False
    print("─" * 72)
    print("BROKER ACCOUNT AUTO-DETECTED")
    print(f"  Login    : {info.login}")
    print(f"  Server   : {info.server}")
    print(f"  Broker   : {getattr(info, 'company', '') or '(unknown)'}")
    print(f"  Name     : {getattr(info, 'name', '') or '(n/a)'}")
    print(f"  Currency : {getattr(info, 'currency', '') or '(n/a)'}  |  Leverage 1:{getattr(info, 'leverage', 0) or 0}")
    print(f"  Balance  : {info.balance}  |  Equity {info.equity}")
    print("─" * 72)
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
    # Cover every naming convention a broker might use for FX or metals.
    candidates = [
        original,
        f"{original}m", f"{original}.m", f"{original}.i", f"{original}.pro", f"{original}.raw",
        f"{original}.r", f"{original}c", f"{original}.c", f"{original}.a", f"{original}.ecn",
        f"{original}.", f"{original}_", f"{original}#", f"{original}-", f"{original}+", f"{original}!",
        original.lower(), original.capitalize(),
    ]
    if original == "XAUUSD":
        candidates += [
            "GOLD", "Gold", "gold", "XAUUSDm", "XAUUSD.i", "XAUUSD.pro", "XAUUSD.raw",
            "XAUUSD.", "XAUUSD_", "XAUUSD#", "XAUUSDc", "XAUUSD+", "GOLD.i", "GOLDm", "GOLD.pro",
        ]
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
    # Preserve existing TP when caller passes 0 — many brokers interpret tp=0
    # in TRADE_ACTION_SLTP as "remove TP", which cancels the RR target.
    if tp is None or tp <= 0:
        tp = float(position.tp or 0)
    req = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": position.symbol,
        "position": int(position.ticket),
        "sl": float(sl),
        "tp": float(tp),
        "magic": MAGIC,
        "comment": "AurumAI SL-update",
    }
    for attempt in range(3):
        res = mt5.order_send(req)
        if res is None:
            print(f"SLTP modify no response ticket={position.ticket} attempt={attempt+1}")
            time.sleep(0.2); continue
        # DONE + NO_CHANGES (already at target) both count as success so
        # trailing keeps advancing instead of getting stuck on the first attempt.
        if res.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL, 10025):
            return True
        # Transient / requote conditions — refresh price and retry once.
        if res.retcode in (mt5.TRADE_RETCODE_REQUOTE, mt5.TRADE_RETCODE_PRICE_OFF, mt5.TRADE_RETCODE_PRICE_CHANGED, 10021):
            time.sleep(0.2); continue
        # Invalid stops — clamp harder against a fresh tick and try once more.
        if res.retcode in (mt5.TRADE_RETCODE_INVALID_STOPS, 10016):
            tick = mt5.symbol_info_tick(position.symbol)
            info = mt5.symbol_info(position.symbol)
            if tick and info:
                point = float(info.point or 0.00001)
                min_dist = max(float(info.trade_stops_level or 0), float(info.trade_freeze_level or 0), 10.0) * point
                is_buy = position.type == mt5.POSITION_TYPE_BUY
                if is_buy:
                    req["sl"] = float(min(sl, float(tick.bid) - min_dist * 1.5))
                else:
                    req["sl"] = float(max(sl, float(tick.ask) + min_dist * 1.5))
                continue
        print(f"SLTP modify failed ticket={position.ticket} attempt={attempt+1}: retcode={res.retcode} {res.comment}")
        return False
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


_LAST_SL_BY_TICKET: dict[int, float] = {}         # remembers the SL we last successfully moved to
_LAST_TRAIL_ATTEMPT_TS: dict[int, float] = {}     # last time we even considered modifying this ticket


def _apply_usd_trailing_stop(position) -> bool:
    """Move SL only forward. Once profit clears broker's min-stop distance
    the SL snaps to breakeven, then ratchets in USD_TRAIL_STEP increments.

    Throttling rules (per user request):
      1. Do not modify the same ticket more often than TRAIL_MIN_INTERVAL_SEC.
      2. Remember last successfully moved SL per ticket in memory and skip
         if the new candidate does not lock at least TRAIL_MIN_STEP_USD extra.
      3. If SL is already in profit (past entry), only advance once price has
         travelled TRAIL_TP_PROGRESS_GATE of the way from entry toward TP.
      4. Print only when SL is actually moved (handled at the bottom).
    """
    if position.magic != MAGIC:
        return False
    ticket = int(position.ticket)

    # Rule 1: time-based throttle so we don't hammer the broker on every tick.
    now = time.time()
    last_ts = _LAST_TRAIL_ATTEMPT_TS.get(ticket, 0.0)
    if now - last_ts < TRAIL_MIN_INTERVAL_SEC:
        return False
    _LAST_TRAIL_ATTEMPT_TS[ticket] = now

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
    min_dist = max(float(info.trade_stops_level or 0), float(info.trade_freeze_level or 0), 10.0) * point
    vpu = _value_per_price_unit(position.symbol, float(position.volume or 0))
    if entry <= 0 or vpu <= 0:
        return False

    be_required_usd = min_dist * vpu + 0.05
    effective_trigger = max(USD_TRAIL_TRIGGER, be_required_usd)
    if profit < effective_trigger:
        return False

    # Rule 3: if the current SL is already in profit territory, wait until
    # price has covered TRAIL_TP_PROGRESS_GATE of the way to TP before
    # advancing SL again. This stops "trail every few cents" behaviour.
    sl_already_positive = (
        old_sl > 0 and ((is_buy and old_sl > entry) or ((not is_buy) and old_sl < entry))
    )
    if sl_already_positive and tp > 0:
        cur_price = float(tick.bid if is_buy else tick.ask)
        tp_total = abs(tp - entry)
        tp_moved = (cur_price - entry) if is_buy else (entry - cur_price)
        if tp_total > 0 and (tp_moved / tp_total) < TRAIL_TP_PROGRESS_GATE:
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

    # Rule 2: compare against our own memory of the last SL we moved to,
    # requiring at least TRAIL_MIN_STEP_USD additional locked profit.
    last_sl = _LAST_SL_BY_TICKET.get(ticket)
    if last_sl is not None:
        extra_move = abs(new_sl - last_sl)
        extra_usd = extra_move * vpu
        if extra_usd < TRAIL_MIN_STEP_USD:
            return False

    if _modify_position_stops(position, new_sl, tp):
        _LAST_SL_BY_TICKET[ticket] = new_sl
        refreshed = _find_position_after_fill(position.symbol, ticket, None, allow_latest=False) or position
        print(f"Trailing SL moved ticket={ticket} profit=${profit:.2f} sl={new_sl} (trigger=${effective_trigger:.2f})")
        _report_trailing_update(refreshed)
        return True
    return False



_PARTIAL_TAKEN: set[int] = set()


def _apply_partial_tp(position) -> bool:
    """Prompt 4: at +1R close PARTIAL_TP_PCT of lot and move SL to breakeven.
    Uses the position's original SL distance as 1R."""
    if position.magic != MAGIC:
        return False
    ticket = int(position.ticket)
    if ticket in _PARTIAL_TAKEN:
        return False
    tick = mt5.symbol_info_tick(position.symbol)
    info = mt5.symbol_info(position.symbol)
    if tick is None or info is None:
        return False
    entry = float(position.price_open)
    sl = float(position.sl or 0)
    if entry <= 0 or sl <= 0:
        return False
    is_buy = position.type == mt5.POSITION_TYPE_BUY
    r_dist = abs(entry - sl)
    if r_dist <= 0:
        return False
    price = float(tick.bid if is_buy else tick.ask)
    move = (price - entry) if is_buy else (entry - price)
    if move < r_dist * PARTIAL_TP_R:
        return False
    step = float(info.volume_step or 0.01)
    min_vol = float(info.volume_min or 0.01)
    close_vol = round(round(float(position.volume) * PARTIAL_TP_PCT / step) * step, 2)
    if close_vol < min_vol or close_vol >= float(position.volume):
        _PARTIAL_TAKEN.add(ticket)
        return False
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": position.symbol,
        "position": ticket,
        "volume": close_vol,
        "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
        "price": price,
        "deviation": SLIPPAGE,
        "magic": MAGIC,
        "comment": "AurumAI partial +1R",
        "type_time": mt5.ORDER_TIME_GTC,
    }
    res = _send_with_supported_filling(req)
    if res is not None and res.retcode == mt5.TRADE_RETCODE_DONE:
        _PARTIAL_TAKEN.add(ticket)
        print(f"Partial +1R closed {close_vol} of ticket={ticket} @ {price}")
        # Move remainder SL to BE
        refreshed = _find_position_after_fill(position.symbol, ticket, None, allow_latest=False)
        if refreshed is not None:
            digits = int(info.digits or 5)
            _modify_position_stops(refreshed, round(entry, digits), float(refreshed.tp or position.tp or 0))
            _report_trailing_update(refreshed)
        _log_execution(None, position.symbol, "BUY" if is_buy else "SELL", "partial_tp",
                       res.retcode, 0, None, ticket, None)
        return True
    return False


def manage_trailing_stops() -> int:
    positions = mt5.positions_get() or []
    moved = 0
    for p in positions:
        try:
            _apply_partial_tp(p)
            if _apply_usd_trailing_stop(p):
                moved += 1
        except Exception as e:
            print(f"trailing failed ticket={getattr(p, 'ticket', '?')}: {e}")
    return moved


def _log_execution(signal_id, symbol, side, action, retcode, retry_count, latency_ms, ticket, error):
    """Prompt 5: detailed logging of every MT5 execution attempt."""
    try:
        _post_json("/api/public/bridge/execution_log", {
            "signal_id": signal_id or None,
            "symbol": symbol,
            "side": side,
            "action": action,
            "retcode": int(retcode) if retcode is not None else None,
            "retry_count": int(retry_count),
            "latency_ms": int(latency_ms) if latency_ms is not None else None,
            "mt5_ticket": int(ticket) if ticket else None,
            "error": (error or "")[:400] or None,
        }, timeout=3)
    except Exception:
        pass


# Prompt 5: retcodes worth retrying (transient market conditions)
_RETRY_RETCODES = {10004, 10008, 10021, 10024, 10027, 10031}  # REQUOTE, PRICE_OFF, TIMEOUT, PRICE_CHANGED, ORDER_CHANGED, CONNECTION


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


def _send_with_retry(req: dict, sig: dict, is_buy: bool):
    """Prompt 5: retry MT5 order on requote/price_off/timeout up to MAX_SEND_RETRIES.
    On each retry, refresh the market price so the broker doesn't reject as stale."""
    start = time.time()
    symbol = req["symbol"]
    sig_id = str(sig.get("id") or "")
    last_res = None
    for attempt in range(MAX_SEND_RETRIES + 1):
        if attempt > 0:
            tick = mt5.symbol_info_tick(symbol)
            if tick is not None:
                req["price"] = float(tick.ask if is_buy else tick.bid)
            time.sleep(0.15)
        res = _send_with_supported_filling(req)
        last_res = res
        if res is not None and res.retcode == mt5.TRADE_RETCODE_DONE:
            latency_ms = (time.time() - start) * 1000
            ticket = int(res.order or res.deal or 0)
            _log_execution(sig_id, symbol, sig.get("side"), "order_send", res.retcode, attempt, latency_ms, ticket, None)
            return res
        rc = res.retcode if res else None
        if rc is None or rc not in _RETRY_RETCODES:
            break
        print(f"order_send retry {attempt + 1}/{MAX_SEND_RETRIES} retcode={rc} {res.comment if res else ''}")
    latency_ms = (time.time() - start) * 1000
    err = f"{last_res.comment if last_res else 'no response'}"
    _log_execution(sig_id, symbol, sig.get("side"), "order_send_failed",
                   last_res.retcode if last_res else None, MAX_SEND_RETRIES, latency_ms, None, err)
    return last_res


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
    # If the broker connection has dropped (typical port=443 error), the last
    # cached tick may be many seconds/minutes old. Trusting it makes the drift
    # check reject every fresh signal. Force a reconnect + re-poll before
    # deciding the tick is unusable.
    def _tick_age(t) -> float:
        try:
            return max(0.0, time.time() - float(getattr(t, "time", 0) or 0))
        except Exception:
            return 0.0
    if tick is None or _tick_age(tick) > 15:
        print(f"stale/no tick for {symbol} (age={_tick_age(tick):.1f}s, last_error={mt5.last_error()}) — reconnecting MT5")
        try:
            mt5.shutdown()
        except Exception:
            pass
        time.sleep(1)
        if connect_mt5():
            mt5.symbol_select(symbol, True)
            tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        report_trade_failure(sig, symbol, "no live tick (broker connection down; check MT5 port=443)")
        return False
    tick_is_fresh = _tick_age(tick) <= 15
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
    # Prompt 5: duplicate trade prevention — skip if same-direction AurumAI position already open on this symbol.
    is_buy = sig["side"] == "BUY"
    existing = mt5.positions_get(symbol=symbol) or []
    for p in existing:
        if p.magic != MAGIC:
            continue
        p_is_buy = p.type == mt5.POSITION_TYPE_BUY
        if p_is_buy == is_buy:
            reason = f"duplicate suppressed: same-direction position ticket={p.ticket} already open on {symbol}"
            print(reason)
            _log_execution(str(sig.get("id") or ""), symbol, sig.get("side"), "dedupe_skip", None, 0, 0, p.ticket, reason)
            report_trade_failure(sig, symbol, reason)
            return False
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
    # Skip the drift check entirely when the broker tick itself is stale — the
    # comparison would be meaningless and would falsely reject good signals
    # during a transient port=443 disconnect.
    if sig_entry > 0 and tick_is_fresh:
        drift_pct = abs((price - sig_entry) / sig_entry) if sig_entry > 0 else 0
        if drift_pct <= PRICE_SOURCE_MISMATCH_BYPASS_PCT:
            stale_reason = _entry_drift_reject_reason(is_buy, price, sig_entry, sig_sl, spread, "live")
            if stale_reason:
                report_trade_failure(sig, symbol, stale_reason)
                return False
        elif drift_pct <= 0.02:
            print(f"{symbol} broker/dashboard price gap {drift_pct*100:.2f}% (live={price} sig={sig_entry}) — rebuilding SL/TP from MT5 price")
        else:
            print(f"{symbol} suspicious tick gap {drift_pct*100:.2f}% (live={price} sig={sig_entry}) — bypassing drift check, MT5 will validate on order_send")
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
    res = _send_with_retry(req, sig, is_buy)
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
            filled_drift_pct = abs((filled_price - sig_entry) / sig_entry)
            if filled_drift_pct <= PRICE_SOURCE_MISMATCH_BYPASS_PCT:
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


# Every symbol AurumAI signals across. Kept in sync with src/lib/format.ts.
AURUMAI_SYMBOLS = [
    "XAUUSD",
    "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
    "EURJPY", "GBPJPY", "AUDJPY", "NZDJPY", "CADJPY", "CHFJPY",
    "EURGBP", "EURAUD", "EURCAD", "EURCHF", "EURNZD",
    "GBPAUD", "GBPCAD", "GBPCHF", "GBPNZD",
    "AUDCAD", "AUDCHF", "AUDNZD", "NZDCAD", "NZDCHF", "CADCHF",
]


def discover_all_symbols() -> None:
    """Auto-detect every AurumAI symbol on the currently-connected broker.

    Runs once at startup so the user immediately sees which symbols are
    available on their broker (and which aren't) instead of finding out
    only when the first signal for that symbol arrives.
    """
    print("Auto-discovering broker symbols for AurumAI universe...")
    found: list[str] = []
    missing: list[str] = []
    for sym in AURUMAI_SYMBOLS:
        mapped = resolve_symbol(sym)
        if mapped:
            found.append(f"{sym}→{mapped}" if mapped != sym else sym)
        else:
            missing.append(sym)
    print(f"  ✓ Available on this broker ({len(found)}): {', '.join(found)}")
    if missing:
        print(f"  ✗ NOT available on this broker ({len(missing)}): {', '.join(missing)}")
        print("    (Signals for these will be reported as unavailable; no action needed.)")
    print("─" * 72)


def main():
    if not connect_mt5():
        sys.exit(1)
    discover_all_symbols()
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
                _log_net_err("poll failed:", err)

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
