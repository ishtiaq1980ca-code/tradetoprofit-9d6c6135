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
import uuid

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
BRIDGE_VERSION = 2026080602                       # server rejects older scripts to prevent unsafe SL/TP execution
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
USD_TRAIL_TRIGGER = 1.5                           # legacy config value; ATR/R gates now exclusively control trailing
USD_BE_LOCK = 0.40                                # safety buffer only; v502 never installs a flat dollar-profit stop
USD_TRAIL_START   = 2.5                           # step trailing begins at +$2.50 profit
USD_TRAIL_STEP = 1.0                              # ladder: +$2.5 → lock $1.5, +$3.5 → lock $2.5, ...
WIDE_TRAIL_ADX = 35.0                             # PHASE 10 §8: ADX > 35 → wider (2×) trailing step
# --- Chandelier Exit trailing (replaces the fixed-$ ladder) ---
CHANDELIER_ATR_MULT = 3.0                         # BUY: highest-since-entry − ATR×3 | SELL: lowest-since-entry + ATR×3
CHANDELIER_TRIGGER_R = 1.3                        # full 3.0×ATR chandelier from +1.3R onward
CHANDELIER_ATR_PERIOD = 14                        # same 14-period ATR used for SL sizing
CHANDELIER_ATR_TTL_SEC = 60.0                     # cache ATR per symbol for a minute
# --- Graduated gap-zone trail (0.5R → 1.3R) ---
GRADUATED_TRIGGER_R = 0.9                         # loose ATR trail starts here instead of a flat $0.40 lock
GRADUATED_ATR_MULT_START = 4.5                    # wide at +0.5R
GRADUATED_ATR_MULT_END = 3.0                      # tightens linearly to the chandelier mult by +1.3R
TRAIL_MIN_LOCK_FRACTION = 0.50                    # cap trail distance so it always locks >=50% of the run-up (all symbols)
# --- Gradual-bleed rescue (slow reversal signature: 241 trades / -$1,870) ---
# A trade that has been in profit for hours and is quietly giving back its peak
# without momentum support is the "gradual_bleed" loser. Fast winners
# (clean_run ~38 min) never satisfy the age gate, so they keep the normal
# 0.9R / 50% behaviour untouched.
BLEED_ENABLED = True
BLEED_MIN_PROFIT_MINUTES = 90.0                   # must have been in profit this long before the rescue can arm
BLEED_MIN_PEAK_USD = 0.75                         # ignore noise trades that never made real money
BLEED_GIVEBACK_FRACTION = 0.35                    # peak→current giveback that flags a slow reversal
BLEED_ADX_SUPPORT = 22.0                          # ADX at/above this still counts as momentum support → no rescue
BLEED_ATR_MULT = 1.2                              # tight ATR trail once the bleed signature is confirmed
BLEED_LOCK_FRACTION = 0.75                        # lock >=75% of the run-up on bleeding trades
MAX_SEND_RETRIES = 3                              # retry MT5 order_send on REQUOTE/PRICE_OFF/TIMEOUT
PARTIAL_TP_R = 1.0                                # (unused when PARTIAL_TP_PCT = 0)
PARTIAL_TP_PCT = 0.0                              # DISABLED — ride full lot to TP / trailing SL
# --- Trailing throttle ---
TRAIL_MIN_INTERVAL_SEC = 5.0                      # do not modify same ticket more than once every N seconds
TRAIL_MIN_STEP_USD = 0.10                         # new SL must lock at least this many extra USD vs last saved SL
TRAIL_TP_PROGRESS_GATE = 0.0                      # steps are discrete now, no extra TP-progress gate needed
# --- Market structure exit (Smart Trailing v2 §3) ---
STRUCTURE_EXIT_ENABLED = True                     # close early when structure/trend flips against an open trade
STRUCTURE_TF_MIN = 15                             # timeframe (minutes) used for structure analysis
STRUCTURE_CHECK_SEC = 20.0                        # how often to re-evaluate structure per ticket
STRUCTURE_EXIT_MAX_PROFIT = 0.0                   # only exit early while trade is at/below this floating profit

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
        "USD_TRAIL_TRIGGER", "USD_BE_LOCK", "USD_TRAIL_START", "USD_TRAIL_STEP", "WIDE_TRAIL_ADX",
        "CHANDELIER_ATR_MULT", "CHANDELIER_TRIGGER_R", "CHANDELIER_ATR_PERIOD",
        "GRADUATED_TRIGGER_R", "GRADUATED_ATR_MULT_START", "GRADUATED_ATR_MULT_END",
        "TRAIL_MIN_LOCK_FRACTION",
        "MIN_RISK_REWARD", "MIN_TP_SPREAD_MULT", "MIN_SL_SPREAD_MULT",
        "MAX_ADVERSE_ENTRY_DRIFT_PCT", "MAX_FAVORABLE_ENTRY_DRIFT_PCT", "PRICE_SOURCE_MISMATCH_BYPASS_PCT",
        "PARTIAL_TP_R", "PARTIAL_TP_PCT", "MAX_SEND_RETRIES",
        "STRUCTURE_EXIT_ENABLED", "STRUCTURE_TF_MIN", "STRUCTURE_CHECK_SEC", "STRUCTURE_EXIT_MAX_PROFIT",
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

# ============= PHASE 11: logging, state, watchdog config =============
HEARTBEAT_SEC = 5.0                               # §1 heartbeat every 5 seconds
HEARTBEAT_BACKOFF = [5, 10, 20, 30]               # §2 exponential retry ladder
WATCHDOG_SEC = 10.0                               # §5 watchdog interval

import os
import logging
import threading

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
LOG_FILE = os.path.join(LOG_DIR, "bridge.log")
STATE_FILE = os.path.join(LOG_DIR, "trailing_state.json")
PROCESS_SESSION_ID = uuid.uuid4().hex[:12]
try:
    os.makedirs(LOG_DIR, exist_ok=True)
    _LOGGER = logging.getLogger("aurumai.bridge")
    _LOGGER.setLevel(logging.INFO)
    if not _LOGGER.handlers:
        _fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
        _fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        _LOGGER.addHandler(_fh)
except Exception as _e:  # logging must never break trading
    _LOGGER = None
    print(f"Log file unavailable ({_e}) — console logging only")

_builtin_print = print


def print(*args, **kwargs):  # noqa: A001 - console + logs/bridge.log with timestamps
    msg = " ".join(str(a) for a in args)
    try:
        if _LOGGER is not None:
            _LOGGER.info(msg)
    except Exception:
        pass
    _builtin_print(*args, **kwargs)


def _acquire_single_instance() -> None:
    """Refuse a second bridge process for the same Windows user/session.

    A named Windows mutex is released by the OS even after a crash, unlike a
    PID/lock file which can remain stale. On non-Windows systems this is a no-op
    because the MetaTrader5 package itself is Windows-only in production.
    """
    if globals().get("_BRIDGE_MUTEX_HANDLE"):
        return
    if os.name != "nt":
        return
    try:
        import ctypes
        mutex_name = f"Local\\AurumAI_MT5_Bridge_{MAGIC}"
        handle = ctypes.windll.kernel32.CreateMutexW(None, False, mutex_name)
        if not handle or ctypes.windll.kernel32.GetLastError() == 183:
            print(f"FATAL: another AurumAI bridge instance is already running (mutex={mutex_name}).")
            raise SystemExit(2)
        globals()["_BRIDGE_MUTEX_HANDLE"] = handle
    except SystemExit:
        raise
    except Exception as e:
        print(f"WARNING: duplicate-process mutex unavailable: {e}")


MT5_LOCK = threading.RLock()
HEARTBEAT_NOW = threading.Event()
CONN = {
    "state": "RECOVERING",       # CONNECTED | RECONNECTING | OFFLINE | RECOVERING
    "mt5": False,
    "internet": True,
    "server": False,
    "last_heartbeat_ok": 0.0,
    "last_heartbeat_try": 0.0,
    "heartbeat_fail": 0,
    "last_poll_ok": 0.0,
}
_LAST_SERVER_REASON = {"reason": "", "ts": 0.0}
_LAST_HB_LOG = {"ts": 0.0}


def set_state(state: str, why: str = "") -> None:
    if CONN["state"] != state:
        CONN["state"] = state
        print(f"STATE → {state}" + (f" ({why})" if why else ""))


def _hb_log(msg: str) -> None:
    """Heartbeat success lines are frequent — log to file, console every 60s."""
    try:
        if _LOGGER is not None:
            _LOGGER.info(msg)
    except Exception:
        pass
    now = time.time()
    if now - _LAST_HB_LOG["ts"] > 60:
        _LAST_HB_LOG["ts"] = now
        _builtin_print(f"{dt.datetime.now().strftime('%H:%M:%S')} {msg} — state {CONN['state']}")


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


def _post_json_result(path: str, payload: dict, timeout: int = 10) -> tuple[bool, dict | None, str]:
    """Same as _post_json but returns the parsed JSON body of the response."""
    for attempt in range(2):
        try:
            r = SESSION.post(f"{BASE_URL}{path}", json=payload, timeout=timeout)
            if not r.ok:
                return False, None, f"HTTP {r.status_code}: {r.text[:240]}"
            try:
                return True, r.json(), ""
            except Exception:
                return True, None, ""
        except Exception as e:
            if _is_conn_error(e) and attempt == 0:
                _reset_session()
                continue
            return False, None, str(e)
    return False, None, "unknown network error"



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


def ensure_mt5(force: bool = False) -> bool:
    """PHASE 11 §3/§9 — verify initialize/login/terminal_info/account_info and
    reconnect automatically. Thread-safe; never raises."""
    with MT5_LOCK:
        try:
            if not force:
                term = mt5.terminal_info()
                info = mt5.account_info()
                if term is not None and getattr(term, "connected", True) and info is not None:
                    CONN["mt5"] = True
                    return True
            print(f"MT5 connection lost/stale ({mt5.last_error()}) — reconnecting")
            CONN["mt5"] = False
            set_state("RECONNECTING", "mt5 reconnect started")
            try:
                mt5.shutdown()
            except Exception:
                pass
            time.sleep(1)
            ok = connect_mt5()
            CONN["mt5"] = bool(ok)
            if ok:
                print("MT5 reconnect success")
                set_state("RECOVERING", "mt5 reconnected, awaiting heartbeat")
            return ok
        except Exception as e:
            print(f"MT5 reconnect exception: {e}")
            CONN["mt5"] = False
            return False


def mt5_ready() -> bool:
    """Keep the terminal connection alive before polling/placing trades."""
    return ensure_mt5()


def report_account() -> bool:
    """PHASE 11 §1 — full heartbeat payload. Returns True only when the
    dashboard accepted it."""
    if not ensure_mt5():
        print("Heartbeat failed: MT5 is not connected")
        return False
    with MT5_LOCK:
        info = mt5.account_info()
        term = mt5.terminal_info()
        if info is None:
            print(f"Heartbeat failed: MT5 account_info error {mt5.last_error()}")
            CONN["mt5"] = False
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
        "terminal_connected": bool(getattr(term, "connected", True)) if term is not None else False,
        "timestamp": now.isoformat(),
        "bridge_version": BRIDGE_VERSION,
    }
    ok = _post_json("/api/public/bridge/account", payload)
    CONN["server"] = bool(ok)
    return ok


# ============= PHASE 11: heartbeat + watchdog threads =============

def request_heartbeat(reason: str = "") -> None:
    """Ask the heartbeat thread to fire immediately."""
    if reason:
        print(f"Heartbeat requested: {reason}")
    HEARTBEAT_NOW.set()


def _heartbeat_loop() -> None:
    fails = 0
    while True:
        delay = HEARTBEAT_SEC
        try:
            CONN["last_heartbeat_try"] = time.time()
            ok = report_account()
            if ok:
                fails = 0
                CONN["last_heartbeat_ok"] = time.time()
                CONN["heartbeat_fail"] = 0
                CONN["internet"] = True
                if CONN["mt5"]:
                    set_state("CONNECTED", "heartbeat sent")
                _hb_log("heartbeat sent")
            else:
                fails += 1
                CONN["heartbeat_fail"] = fails
                delay = HEARTBEAT_BACKOFF[min(fails - 1, len(HEARTBEAT_BACKOFF) - 1)]
                print(f"Heartbeat failed ({fails}) — retrying in {delay}s")
                set_state("RECOVERING", "heartbeat failed")
                if fails >= 2:
                    _reset_session()
                    ensure_mt5(force=True)
        except Exception as e:
            fails += 1
            CONN["heartbeat_fail"] = fails
            delay = HEARTBEAT_BACKOFF[min(fails - 1, len(HEARTBEAT_BACKOFF) - 1)]
            print(f"Heartbeat exception ({fails}): {e} — retrying in {delay}s")
        # never stop sending future heartbeats
        HEARTBEAT_NOW.wait(delay)
        HEARTBEAT_NOW.clear()


def _internet_ok() -> bool:
    import socket
    from urllib.parse import urlparse
    host = urlparse(BASE_URL).hostname or "tradetoprofit.lovable.app"
    port = 443 if BASE_URL.startswith("https") else 80
    try:
        with socket.create_connection((host, port), timeout=4):
            return True
    except Exception:
        return False


def _watchdog_loop() -> None:
    """PHASE 11 §5 — every 10s verify internet, MT5, login, heartbeat age."""
    was_online = True
    while True:
        try:
            online = _internet_ok()
            CONN["internet"] = online
            if not online:
                if was_online:
                    print("Watchdog: internet disconnected — retrying forever, no restart needed")
                was_online = False
                set_state("OFFLINE", "internet down")
            else:
                if not was_online:
                    print("Watchdog: internet restored — resuming")
                    _reset_session()
                    request_heartbeat("internet restored")
                was_online = True

            if not ensure_mt5():
                print("Watchdog: MT5 terminal unavailable — waiting for it to return")
            hb_age = time.time() - CONN["last_heartbeat_ok"] if CONN["last_heartbeat_ok"] else 1e9
            if hb_age > 20:
                request_heartbeat(f"heartbeat age {int(min(hb_age, 99999))}s")
            poll_age = time.time() - CONN["last_poll_ok"] if CONN["last_poll_ok"] else 1e9
            if poll_age > 60 and online:
                print("Watchdog: polling looks stalled — resetting HTTPS session")
                _reset_session()
        except Exception as e:
            print(f"Watchdog exception (ignored): {e}")
        time.sleep(WATCHDOG_SEC)


def start_background_threads() -> None:
    threading.Thread(target=_heartbeat_loop, name="heartbeat", daemon=True).start()
    threading.Thread(target=_watchdog_loop, name="watchdog", daemon=True).start()
    print("Heartbeat thread (5s) and watchdog thread (10s) started")


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


def process_close_requests() -> None:
    """Structure-invalidation early exits.

    The dashboard queues market-close requests when a position's structural
    thesis is invalidated (swing level broken on a confirmed close, or the
    entry-timeframe trend flipped). This closes those tickets at market and
    reports the result back. Entry execution and trailing stops are untouched.
    """
    ok, data, err = _get_json("/api/public/bridge/close_requests", timeout=5)
    if not ok or not data:
        if err:
            _log_net_err("close_requests poll failed:", err)
        return
    reqs = data.get("requests") or []
    if not reqs:
        return

    positions = mt5.positions_get() or []
    by_ticket = {int(p.ticket): p for p in positions}

    for req in reqs:
        rid = req.get("id")
        ticket = int(req.get("mt5_ticket") or 0)
        reason = str(req.get("reason") or "structure invalidated")
        pos = by_ticket.get(ticket)
        if pos is None:
            # Already gone (SL/TP/manual close) — ack so it is not retried.
            _post_json("/api/public/bridge/close_requests",
                       {"id": rid, "ok": True, "error": None})
            continue

        t0 = time.time()
        closed = _close_position(pos, f"structure invalidated: {reason}")
        latency = int((time.time() - t0) * 1000)
        _log_execution(None, pos.symbol,
                       "BUY" if pos.type == mt5.POSITION_TYPE_BUY else "SELL",
                       "structure_exit" if closed else "structure_exit_failed",
                       None, 0, latency, ticket,
                       reason if closed else f"close failed: {reason}")
        print(f"structure exit ticket={ticket} {pos.symbol} -> {'closed' if closed else 'FAILED'} ({reason})")
        _post_json("/api/public/bridge/close_requests",
                   {"id": rid, "ok": bool(closed),
                    "error": None if closed else "MT5 close failed"})


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
    # HARD GUARD: never write a stop-loss that sits on (or within a hair of)
    # the entry price — that turns any retrace into a 0.00 round-trip close.
    try:
        _entry = float(position.price_open)
        _info = mt5.symbol_info(position.symbol)
        _pt = float(_info.point) if _info else 0.00001
        if sl and _entry > 0 and abs(float(sl) - _entry) < _pt * 3:
            print(f"!! BLOCKED zero-distance SL ticket={position.ticket} sl={sl} entry={_entry} — modify refused")
            return False
    except Exception:
        pass
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


def _stop_is_on_entry(symbol: str, entry: float, sl: float) -> bool:
    """True when SL sits on (or within a hair of) the entry price."""
    if not sl or entry <= 0:
        return False
    info = mt5.symbol_info(symbol)
    point = float(info.point) if info else 0.00001
    return abs(float(sl) - float(entry)) < point * 3


def _report_trailing_update(position) -> None:
    _entry = float(position.price_open)
    _sl = float(position.sl or 0)
    if _stop_is_on_entry(position.symbol, _entry, _sl):
        # Never publish a break-even-on-entry stop to the dashboard; the server
        # rejects it anyway and it hides the real risk on the position.
        print(f"!! SL sits on entry ticket={position.ticket} entry={_entry} sl={_sl} — not reporting; fix requires this bridge version")
        return
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
_R_BY_TICKET: dict[int, float] = {}               # original 1R distance (entry → initial SL) per ticket
_EXTREME_BY_TICKET: dict[int, float] = {}         # highest (BUY) / lowest (SELL) price since entry
_ATR_CACHE: dict[str, tuple] = {}                 # symbol -> (timestamp, atr)
_LAST_TRAIL_DIAG_TS: dict[int, float] = {}
_LAST_STATE_SAVE_TS = 0.0


def _save_trailing_state(force: bool = False) -> None:
    """Persist immutable R and running extremes so bridge updates/restarts do
    not forget positions that already had their stop moved into profit."""
    global _LAST_STATE_SAVE_TS
    now = time.time()
    if not force and now - _LAST_STATE_SAVE_TS < 5.0:
        return
    _LAST_STATE_SAVE_TS = now
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        payload = {
            "r": {str(k): v for k, v in _R_BY_TICKET.items()},
            "extreme": {str(k): v for k, v in _EXTREME_BY_TICKET.items()},
            "last_sl": {str(k): v for k, v in _LAST_SL_BY_TICKET.items()},
        }
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"))
        os.replace(tmp, STATE_FILE)
    except Exception as e:
        print(f"trailing state save failed: {e}")


def _load_trailing_state() -> None:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            payload = json.load(f)
        for key, target in (("r", _R_BY_TICKET), ("extreme", _EXTREME_BY_TICKET), ("last_sl", _LAST_SL_BY_TICKET)):
            for ticket, value in (payload.get(key) or {}).items():
                target[int(ticket)] = float(value)
        print(f"Loaded persistent trailing state for {len(_R_BY_TICKET)} ticket(s)")
    except FileNotFoundError:
        return
    except Exception as e:
        print(f"trailing state load failed: {e}")


def _recover_original_r(position, is_buy: bool, entry: float, old_sl: float, tp: float) -> tuple[float | None, str]:
    """Recover original 1R after a restart, even when the live SL is already
    profitable. Prefer the broker's opening-order SL; TP/2 is a last-resort
    reconstruction because this bridge opens normalized plans at 2R by default."""
    try:
        orders = mt5.history_orders_get(position=int(position.ticket)) or []
        for order in sorted(orders, key=lambda item: int(getattr(item, "time_setup_msc", 0) or 0)):
            sl = float(getattr(order, "sl", 0) or 0)
            if sl > 0 and ((is_buy and sl < entry) or ((not is_buy) and sl > entry)):
                return abs(entry - sl), "broker-opening-order"
    except Exception:
        pass
    if old_sl > 0 and ((is_buy and old_sl < entry) or ((not is_buy) and old_sl > entry)):
        return abs(entry - old_sl), "live-initial-sl"
    if tp > 0 and ((is_buy and tp > entry) or ((not is_buy) and tp < entry)):
        return abs(tp - entry) / 2.0, "tp-distance/2-fallback"
    return None, "unavailable"


def _trail_diag(position, action: str, detail: str) -> None:
    """Send compact trailing evidence to the existing remote execution log."""
    ticket = int(position.ticket)
    now = time.time()
    if action != "trail_move" and now - _LAST_TRAIL_DIAG_TS.get(ticket, 0.0) < 60.0:
        return
    _LAST_TRAIL_DIAG_TS[ticket] = now
    _log_execution(None, position.symbol,
                   "BUY" if position.type == mt5.POSITION_TYPE_BUY else "SELL",
                   action, None, 0, None, ticket,
                   f"bridge={BRIDGE_VERSION} session={PROCESS_SESSION_ID} pid={os.getpid()} {detail}")


def _current_atr(symbol: str, period: int = CHANDELIER_ATR_PERIOD):
    """14-period ATR on the structure timeframe — the same ATR family used for
    SL sizing. Cached briefly so trailing does not hammer MT5 history."""
    now = time.time()
    cached = _ATR_CACHE.get(symbol)
    if cached and now - cached[0] < CHANDELIER_ATR_TTL_SEC:
        return cached[1]
    try:
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 0, period * 6)
        if rates is None or len(rates) < period + 3:
            return None
        highs = [float(r["high"]) for r in rates][:-1]
        lows = [float(r["low"]) for r in rates][:-1]
        closes = [float(r["close"]) for r in rates][:-1]
        a = _atr_last(highs, lows, closes, period)
        if a is None or a <= 0:
            return None
        _ATR_CACHE[symbol] = (now, a)
        return a
    except Exception:
        return None
_LAST_TRAIL_ATTEMPT_TS: dict[int, float] = {}     # last time we even considered modifying this ticket


def _apply_usd_trailing_stop(position) -> bool:
    """Move SL only forward using an ATR/R-based Chandelier Exit.

    v502 deliberately has no fixed-dollar fallback. v501's fallback installed
    an entry + USD_BE_LOCK stop whenever the position had reached $1.50 but had
    not reached +0.5R (or when the wide ATR candidate was behind entry). That
    was the exact source of repeated $0.40/$0.41 closes in live history.

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

    # Capture the extreme and immutable original 1R distance BEFORE any
    # activation return. v501 returned at the dollar-profit gate first, which
    # meant both pieces of state started too late in the position lifecycle.
    cur_price = float(tick.bid if is_buy else tick.ask)
    prev_ext = _EXTREME_BY_TICKET.get(ticket)
    extreme = cur_price if prev_ext is None else (max(prev_ext, cur_price) if is_buy else min(prev_ext, cur_price))
    _EXTREME_BY_TICKET[ticket] = extreme

    # Recover original R across updates/restarts. v502 only accepted a live
    # losing-side SL, so a position previously moved to +$0.40 had r_dist=None
    # forever and silently skipped all graduated/chandelier calculations.
    r_dist = _R_BY_TICKET.get(ticket)
    if r_dist is None:
        r_dist, r_source = _recover_original_r(position, is_buy, entry, old_sl, tp)
        if r_dist and r_dist > 0:
            _R_BY_TICKET[ticket] = r_dist
            _LAST_SL_BY_TICKET.setdefault(ticket, old_sl)
            _save_trailing_state(force=True)
            _trail_diag(position, "trail_state", f"recovered_r={r_dist:.{digits}f} source={r_source} entry={entry} sl={old_sl} tp={tp}")
        else:
            _trail_diag(position, "trail_skip", f"reason=no-original-r source={r_source} entry={entry} sl={old_sl} tp={tp}")

    moved = (cur_price - entry) if is_buy else (entry - cur_price)
    move_r = (moved / r_dist) if (r_dist and r_dist > 0) else 0.0
    if move_r < float(GRADUATED_TRIGGER_R):
        _save_trailing_state()
        _trail_diag(position, "trail_skip", f"reason=below-trigger move_r={move_r:.4f} r={r_dist or 0:.{digits}f} price={cur_price} entry={entry} sl={old_sl}")
        return False

    atr_now = _current_atr(position.symbol)
    if atr_now is None or atr_now <= 0:
        # Never substitute a dollar lock when market-data history is missing.
        _trail_diag(position, "trail_skip", f"reason=no-atr move_r={move_r:.4f} r={r_dist or 0:.{digits}f} price={cur_price}")
        return False

    # Graduated protection: 4.5×ATR at +0.5R tightening linearly to
    # 3.0×ATR at +1.3R, then the plain chandelier from +1.3R onward.
    if move_r >= CHANDELIER_TRIGGER_R:
        mult = float(CHANDELIER_ATR_MULT)
        label = "chandelier"
    else:
        span = max(1e-9, float(CHANDELIER_TRIGGER_R) - float(GRADUATED_TRIGGER_R))
        t = min(1.0, max(0.0, (move_r - float(GRADUATED_TRIGGER_R)) / span))
        mult = float(GRADUATED_ATR_MULT_START) + t * (
            float(GRADUATED_ATR_MULT_END) - float(GRADUATED_ATR_MULT_START)
        )
        label = "graduated"
    adx_now = _current_adx(position.symbol)
    if adx_now is not None and adx_now > WIDE_TRAIL_ADX:
        mult = mult * 1.25      # strong trend → give the runner more room
    dist = atr_now * mult
    # Symbol-agnostic cap: on pairs where ATR is large relative to the R
    # distance (most crosses/JPY pairs), mult x ATR exceeds the whole run-up,
    # so the raw level always sits behind entry and the trail never engages.
    # Cap the distance so we always lock at least TRAIL_MIN_LOCK_FRACTION of
    # the achieved move from entry.
    run = abs(extreme - entry)
    capped = False
    if run > 0:
        max_dist = run * (1.0 - float(TRAIL_MIN_LOCK_FRACTION))
        if max_dist < dist:
            dist = max_dist
            capped = True
    raw_sl = (extreme - dist) if is_buy else (extreme + dist)
    mode = f"{label} {mult:.2f}xATR @ {move_r:.2f}R ATR={atr_now:.{digits}f}{' capped' if capped else ''}"


    # A wide Chandelier level can legitimately remain behind entry near +0.5R.
    # In that case preserve the existing initial SL. Do NOT replace it with a
    # flat $0.40 lock: wait until the ATR candidate itself protects profit.
    entry_buf = max(point, (float(USD_BE_LOCK) * 0.5) / vpu)
    if (is_buy and raw_sl <= entry + entry_buf) or ((not is_buy) and raw_sl >= entry - entry_buf):
        _trail_diag(position, "trail_skip", f"reason=raw-not-profitable mode={mode} extreme={extreme} raw_sl={raw_sl} entry={entry} old_sl={old_sl}")
        return False

    # Hard guard: the trailing SL must stay strictly in profit. If the broker's
    # min-stop clamp would push it onto (or behind) the entry price, skip the
    # move entirely rather than parking a zero-distance stop on entry.
    min_lock_move = max(point, (float(USD_BE_LOCK) * 0.5) / vpu)
    if is_buy:
        max_allowed_sl = float(tick.bid) - min_dist
        new_sl = min(raw_sl, max_allowed_sl)
        if new_sl <= entry + min_lock_move:
            _trail_diag(position, "trail_skip", f"reason=clamp-not-profitable mode={mode} raw_sl={raw_sl} clamped={new_sl} min_dist={min_dist}")
            return False
        better = old_sl <= 0 or new_sl > old_sl + point
    else:
        min_allowed_sl = float(tick.ask) + min_dist
        new_sl = max(raw_sl, min_allowed_sl)
        if new_sl >= entry - min_lock_move:
            _trail_diag(position, "trail_skip", f"reason=clamp-not-profitable mode={mode} raw_sl={raw_sl} clamped={new_sl} min_dist={min_dist}")
            return False
        better = old_sl <= 0 or new_sl < old_sl - point
    if not better:
        _trail_diag(position, "trail_skip", f"reason=not-better mode={mode} candidate={new_sl} old_sl={old_sl} extreme={extreme}")
        return False

    new_sl = round(new_sl, digits)

    # Rule 2: compare against our own memory of the last SL we moved to,
    # requiring at least TRAIL_MIN_STEP_USD additional locked profit.
    last_sl = _LAST_SL_BY_TICKET.get(ticket)
    if last_sl is not None:
        extra_move = abs(new_sl - last_sl)
        extra_usd = extra_move * vpu
        if extra_usd < TRAIL_MIN_STEP_USD:
            _trail_diag(position, "trail_skip", f"reason=min-step mode={mode} candidate={new_sl} last_sl={last_sl} extra_usd={extra_usd:.4f}")
            return False

    if _modify_position_stops(position, new_sl, tp):
        _LAST_SL_BY_TICKET[ticket] = new_sl
        _save_trailing_state(force=True)
        refreshed = _find_position_after_fill(position.symbol, ticket, None, allow_latest=False) or position
        print(f"Trailing SL moved ticket={ticket} profit=${float(position.profit or 0):.2f} sl={new_sl} [{mode}]")
        _trail_diag(position, "trail_move", f"profit={float(position.profit or 0):.2f} old_sl={old_sl} new_sl={new_sl} raw_sl={raw_sl} extreme={extreme} min_dist={min_dist} {mode}")
        _report_trailing_update(refreshed)
        return True
    return False



_PARTIAL_TAKEN: set[int] = set()


def _apply_partial_tp(position) -> bool:
    """Prompt 4: at +1R close PARTIAL_TP_PCT of lot and move SL to breakeven.
    Uses the position's original SL distance as 1R."""
    if PARTIAL_TP_PCT <= 0:
        return False  # partial-close disabled
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



_LAST_STRUCT_CHECK_TS: dict[int, float] = {}


def _ema_series(values, period: int):
    if not values or period <= 0 or len(values) < period:
        return None
    k = 2.0 / (period + 1.0)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema


def _rsi_last(closes, period: int = 14):
    if len(closes) < period + 2:
        return None
    gains = losses = 0.0
    for k in range(1, period + 1):
        d = closes[k] - closes[k - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    gains /= period
    losses /= period
    for k in range(period + 1, len(closes)):
        d = closes[k] - closes[k - 1]
        gains = (gains * (period - 1) + max(d, 0.0)) / period
        losses = (losses * (period - 1) + max(-d, 0.0)) / period
    if losses == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + gains / losses)


def _macd_hist_last2(closes):
    """Return (hist, prev_hist) of the standard 12/26/9 MACD."""
    if len(closes) < 60:
        return None, None
    def ema_list(vals, period):
        k = 2.0 / (period + 1.0)
        out = []
        e = sum(vals[:period]) / period
        out.append(e)
        for v in vals[period:]:
            e = v * k + e * (1 - k)
            out.append(e)
        return out
    ef, es = ema_list(closes, 12), ema_list(closes, 26)
    n = min(len(ef), len(es))
    macd_line = [ef[len(ef) - n + i] - es[len(es) - n + i] for i in range(n)]
    if len(macd_line) < 12:
        return None, None
    sig = ema_list(macd_line, 9)
    m = min(len(macd_line), len(sig))
    hist = [macd_line[len(macd_line) - m + i] - sig[len(sig) - m + i] for i in range(m)]
    return hist[-1], hist[-2]


def _atr_last(highs, lows, closes, period: int = 14):
    if len(closes) < period + 2:
        return None
    trs = []
    for k in range(1, len(closes)):
        trs.append(max(highs[k] - lows[k], abs(highs[k] - closes[k - 1]), abs(lows[k] - closes[k - 1])))
    a = sum(trs[:period]) / period
    for t in trs[period:]:
        a = (a * (period - 1) + t) / period
    return a


def _current_adx(symbol: str, period: int = 14):
    """ADX on the structure timeframe — used for dynamic trailing speed."""
    try:
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 0, 120)
        if rates is None or len(rates) < period * 3:
            return None
        highs = [float(r["high"]) for r in rates][:-1]
        lows = [float(r["low"]) for r in rates][:-1]
        closes = [float(r["close"]) for r in rates][:-1]
        tr = pdm = mdm = 0.0
        adx_vals = []
        prev_adx = None
        dxs = []
        for k in range(1, len(closes)):
            up = highs[k] - highs[k - 1]
            dn = lows[k - 1] - lows[k]
            p = up if (up > dn and up > 0) else 0.0
            m = dn if (dn > up and dn > 0) else 0.0
            t = max(highs[k] - lows[k], abs(highs[k] - closes[k - 1]), abs(lows[k] - closes[k - 1]))
            tr = tr - tr / period + t
            pdm = pdm - pdm / period + p
            mdm = mdm - mdm / period + m
            if tr <= 0:
                continue
            pdi = 100.0 * pdm / tr
            mdi = 100.0 * mdm / tr
            denom = pdi + mdi
            if denom > 0:
                dxs.append(100.0 * abs(pdi - mdi) / denom)
        if len(dxs) < period:
            return None
        adx = sum(dxs[:period]) / period
        for d in dxs[period:]:
            adx = (adx * (period - 1) + d) / period
        return adx
    except Exception:
        return None


def _structure_flipped(symbol: str, is_buy: bool) -> str | None:
    """PHASE 10 §2/§6 — confirmed reversal only. ALL of the following must be
    true before an early exit is allowed (single candles / pullbacks ignored):
      trend flip + BOS + close beyond structure + 2 candles + RSI + MACD + ATR.
    """
    tf_map = {1: mt5.TIMEFRAME_M1, 5: mt5.TIMEFRAME_M5, 15: mt5.TIMEFRAME_M15,
              30: mt5.TIMEFRAME_M30, 60: mt5.TIMEFRAME_H1}
    tf = tf_map.get(int(STRUCTURE_TF_MIN), mt5.TIMEFRAME_M15)
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, 220)
    if rates is None or len(rates) < 80:
        return None
    closes = [float(r["close"]) for r in rates]
    opens = [float(r["open"]) for r in rates]
    highs = [float(r["high"]) for r in rates]
    lows = [float(r["low"]) for r in rates]
    # drop the still-forming candle
    closes, opens, highs, lows = closes[:-1], opens[:-1], highs[:-1], lows[:-1]
    if len(closes) < 70:
        return None

    ema_fast = _ema_series(closes, 50)
    ema_slow = _ema_series(closes, min(200, len(closes) - 1))
    if ema_fast is None or ema_slow is None:
        return None
    trend_bull = ema_fast >= ema_slow
    price = closes[-1]

    # 1. Trend flip against the position
    trend_flip = (not trend_bull) if is_buy else trend_bull
    # 2/3. Break of structure + close beyond the broken level
    recent_high, prev_high = max(highs[-20:]), max(highs[-40:-20])
    recent_low, prev_low = min(lows[-20:]), min(lows[-40:-20])
    if is_buy:
        bos = recent_low < prev_low
        close_beyond = price < prev_low
    else:
        bos = recent_high > prev_high
        close_beyond = price > prev_high
    # 4. Two consecutive confirmed candles in the reversal direction
    if is_buy:
        two_candles = closes[-1] < opens[-1] and closes[-2] < opens[-2]
    else:
        two_candles = closes[-1] > opens[-1] and closes[-2] > opens[-2]
    # 5. RSI reversal
    r = _rsi_last(closes, 14)
    rsi_ok = r is not None and (r < 45 if is_buy else r > 55)
    # 6. MACD reversal
    h, hp = _macd_hist_last2(closes)
    if h is None:
        macd_ok = False
    else:
        macd_ok = (h < 0 and h <= hp) if is_buy else (h > 0 and h >= hp)
    # 7. ATR confirms real momentum (anti-noise)
    a = _atr_last(highs, lows, closes, 14)
    leg = abs(closes[-1] - closes[-3])
    atr_ok = a is not None and a > 0 and leg >= a * 0.8

    if trend_flip and bos and close_beyond and two_candles and rsi_ok and macd_ok and atr_ok:
        return (f"confirmed reversal: trend flip + BOS + close beyond structure + 2 candles "
                f"+ RSI {r:.1f} + MACD {h:.5f} + ATR momentum {leg:.5f}/{a:.5f}")
    return None


def _apply_structure_exit(position) -> bool:
    """Smart Trailing v2 §3: if setup is invalidated, take the small loss now
    instead of waiting for the full stop loss."""
    if not STRUCTURE_EXIT_ENABLED or position.magic != MAGIC:
        return False
    ticket = int(position.ticket)
    now = time.time()
    if now - _LAST_STRUCT_CHECK_TS.get(ticket, 0.0) < STRUCTURE_CHECK_SEC:
        return False
    _LAST_STRUCT_CHECK_TS[ticket] = now

    profit = float(position.profit or 0)
    # Never cut winners early (Golden Rule) — only rescue losing/flat trades.
    if profit > STRUCTURE_EXIT_MAX_PROFIT:
        return False
    is_buy = position.type == mt5.POSITION_TYPE_BUY
    reason = _structure_flipped(position.symbol, is_buy)
    if not reason:
        return False
    if _close_position(position, f"structure exit: {reason}"):
        print(f"Structure exit ticket={ticket} profit=${profit:.2f} — {reason}")
        return True
    return False


def manage_trailing_stops() -> int:
    positions = mt5.positions_get() or []
    moved = 0
    for p in positions:
        try:
            if _apply_structure_exit(p):
                moved += 1
                continue
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

        # Seed trailing state from the actual post-fill broker plan. This keeps
        # original R immutable even if the position manager first sees the
        # ticket after its SL has already changed, and starts extremes at entry.
        if live_sl > 0 and ((is_buy and live_sl < filled_price) or ((not is_buy) and live_sl > filled_price)):
            _R_BY_TICKET[ticket] = abs(filled_price - live_sl)
        _EXTREME_BY_TICKET[ticket] = filled_price
        _LAST_SL_BY_TICKET[ticket] = live_sl
        _save_trailing_state(force=True)
    else:
        filled_price = float(res.price or price)
        live_sl = float(sl)
        live_tp = float(tp)
        print(f"Filled {sig['side']} {symbol} deal/order={ticket}, position not visible yet; reporting fill")
    if _stop_is_on_entry(symbol, float(filled_price), float(live_sl)):
        print(f"!! REFUSING to report trade with stop_loss == entry ticket={ticket} entry={filled_price} sl={live_sl}")
        live_sl = 0.0
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


_CLOSED_REPORTED: set[int] = set()


def sync_closed_trades():
    """Report every AurumAI position that closed on the broker.

    Looks 7 days back (not 1) so a bridge restart or an outage cannot leave
    closes permanently unreported. Each exit deal is posted once per process
    and, unlike before, failures are printed instead of silently swallowed —
    the previous version dropped every error, which is why closes never
    reached the dashboard at all.
    """
    now = dt.datetime.now(dt.UTC)
    since = now - dt.timedelta(days=7)
    deals = mt5.history_deals_get(since, now) or []
    # Aggregate exit deals per position: partial closes produce several.
    exits: dict[int, dict] = {}
    for d in deals:
        if d.magic != MAGIC or d.entry != mt5.DEAL_ENTRY_OUT:
            continue
        pid = int(d.position_id)
        agg = exits.setdefault(pid, {
            "symbol": d.symbol, "volume": 0.0, "profit": 0.0,
            "price": float(d.price), "time": int(d.time),
            "side": "BUY" if d.type == mt5.DEAL_TYPE_SELL else "SELL",
        })
        agg["volume"] += float(d.volume)
        agg["profit"] += float(d.profit) + float(getattr(d, "swap", 0.0) or 0.0) + float(getattr(d, "commission", 0.0) or 0.0)
        if int(d.time) >= agg["time"]:
            agg["time"] = int(d.time)
            agg["price"] = float(d.price)

    open_tickets = {int(p.ticket) for p in (mt5.positions_get() or [])}
    sent = 0
    for pid, agg in exits.items():
        if pid in _CLOSED_REPORTED or pid in open_tickets:
            continue
        closed_at = dt.datetime.fromtimestamp(agg["time"], dt.UTC).replace(microsecond=0)
        ok = _post_json("/api/public/bridge/trades", {
            "mt5_ticket": pid,
            "symbol": agg["symbol"],
            "side": agg["side"],
            # `entry` is required by the schema but the server ignores it for
            # close reports and keeps the original fill price on the row.
            "entry": agg["price"],
            "exit": agg["price"],
            "lot": max(0.01, round(agg["volume"], 2)),
            "profit": round(agg["profit"], 2),
            "status": "closed",
            "closed_at": closed_at.isoformat().replace("+00:00", "Z"),
        })
        if ok:
            _CLOSED_REPORTED.add(pid)
            sent += 1
        else:
            print(f"close report FAILED ticket={pid} {agg['symbol']} profit={agg['profit']:.2f}")
    if sent:
        print(f"reported {sent} closed trade(s) to dashboard")



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


def reconcile_open_trades():
    """Verify every position the dashboard still thinks is open.

    The dashboard can drift out of sync with the broker (missed close report,
    bridge outage, restart). For each open ticket we answer one of:
      verified : still in positions_get() -> leave alone
      closed   : exit deal recoverable from MT5 history -> backfill real
                 exit price / profit / close time
      missing  : broker knows nothing about it -> server flags it for review
                 once it is old enough

    Read-only against MT5; it never sends orders.
    """
    ok, data, err = _get_json("/api/public/bridge/reconcile", timeout=10)
    if not ok or not data:
        _log_net_err("reconcile fetch failed:", err)
        return
    rows = data.get("open") or []
    if not rows:
        return

    live = {int(p.ticket) for p in (mt5.positions_get() or [])}
    verdicts = []
    for row in rows:
        ticket = int(row.get("mt5_ticket") or 0)
        if not ticket:
            continue
        if ticket in live:
            verdicts.append({"mt5_ticket": ticket, "state": "verified"})
            continue

        # Not open — try to recover the real exit from deal history.
        try:
            deals = mt5.history_deals_get(position=ticket) or []
        except Exception:
            deals = []
        outs = [d for d in deals if d.entry == mt5.DEAL_ENTRY_OUT]
        if outs:
            profit = sum(
                float(d.profit)
                + float(getattr(d, "swap", 0.0) or 0.0)
                + float(getattr(d, "commission", 0.0) or 0.0)
                for d in outs
            )
            last = max(outs, key=lambda d: int(d.time))
            volume = sum(float(d.volume) for d in outs)
            closed_at = dt.datetime.fromtimestamp(int(last.time), dt.UTC).replace(microsecond=0)
            verdicts.append({
                "mt5_ticket": ticket,
                "state": "closed",
                "exit": float(last.price),
                "profit": round(profit, 2),
                "lot": max(0.01, round(volume, 2)),
                "closed_at": closed_at.isoformat().replace("+00:00", "Z"),
            })
            _CLOSED_REPORTED.add(ticket)
        else:
            verdicts.append({"mt5_ticket": ticket, "state": "missing"})

    if not verdicts:
        return
    ok2, res, err2 = _post_json_result("/api/public/bridge/reconcile", {"verdicts": verdicts}, timeout=20)
    if not ok2:
        _log_net_err("reconcile report failed:", err2)
        return
    res = res or {}
    if res.get("closed") or res.get("flagged"):
        print(
            f"reconciliation: {res.get('verified', 0)} still open, "
            f"{res.get('closed', 0)} backfilled as closed, {res.get('flagged', 0)} flagged for review"
        )


def main():
    # PHASE 11 §12 — the bridge NEVER exits. It boots into RECOVERING state,
    # starts the heartbeat + watchdog threads, and keeps polling forever.
    _acquire_single_instance()
    _load_trailing_state()
    set_state("RECOVERING", "bridge starting")
    attempt = 0
    while not ensure_mt5(force=True):
        attempt += 1
        wait = min(30, 3 * attempt)
        print(f"MT5 not ready (attempt {attempt}) — retrying in {wait}s. Bridge stays running.")
        time.sleep(wait)
    try:
        discover_all_symbols()
    except Exception as e:
        print(f"Symbol discovery error (non-fatal): {e}")

    start_background_threads()
    print(f"AurumAI bridge v{BRIDGE_VERSION} online, polling {BASE_URL} every {POLL_SEC}s")
    print(f"Detailed logs: {LOG_FILE}")
    _log_execution(None, "BRIDGE", None, "bridge_start", None, 0, None, None,
                   f"bridge={BRIDGE_VERSION} session={PROCESS_SESSION_ID} pid={os.getpid()} state_file={STATE_FILE}")

    last_closed_sync = 0.0
    last_reconcile = 0.0
    try:
        reconcile_open_trades()
        last_reconcile = time.time()
    except Exception as e:
        print(f"startup reconciliation error (non-fatal): {e}")
    waited_first_heartbeat = time.time()
    while True:
        try:
            # Wait for the very first heartbeat to unlock server polling, but
            # never block forever — the heartbeat thread keeps retrying.
            if CONN["last_heartbeat_ok"] == 0 and time.time() - waited_first_heartbeat < 30:
                request_heartbeat("initial heartbeat")
                time.sleep(0.5)
                continue

            if not mt5_ready():
                set_state("RECONNECTING", "MT5 not ready in poll loop")
                time.sleep(1.0)
                continue

            ok, data, err = _get_json("/api/public/bridge/poll", timeout=5)
            if ok and data is not None:
                CONN["server"] = True
                CONN["last_poll_ok"] = time.time()
                if CONN["state"] not in ("CONNECTED",) and CONN["mt5"] and CONN["last_heartbeat_ok"]:
                    set_state("CONNECTED", "polling resumed")
                reason = data.get("reason")
                if data.get("enabled") and data.get("signals"):
                    for sig in data["signals"]:
                        execute_signal(sig)
                    manage_trailing_stops()
                    process_close_requests()
                    continue
                elif reason:
                    _log_server_reason(reason, data)
            else:
                CONN["server"] = False
                _log_net_err("poll failed:", err)
                if CONN["state"] == "CONNECTED":
                    set_state("RECOVERING", f"poll error: {err[:80]}")

            manage_trailing_stops()
            process_close_requests()

            if time.time() - last_closed_sync > 60:
                sync_closed_trades()
                last_closed_sync = time.time()

            # Ghost-position sweep every 15 min: anything the dashboard still
            # calls open but the broker does not is closed or flagged.
            if time.time() - last_reconcile > 900:
                reconcile_open_trades()
                last_reconcile = time.time()
        except Exception as e:
            # PHASE 11 §6 — the polling loop can never terminate.
            if _is_conn_error(e):
                _reset_session()
            _log_net_err("poll loop exception:", str(e))
            set_state("RECOVERING", f"poll exception: {str(e)[:80]}")
            time.sleep(5)
            continue

        time.sleep(POLL_SEC)


def _log_server_reason(reason: str, data: dict) -> None:
    """PHASE 11 §4 — recover from server-side mt5_stale without a restart."""
    now = time.time()
    if now - _LAST_SERVER_REASON["ts"] < 15 and _LAST_SERVER_REASON["reason"] == reason:
        return
    _LAST_SERVER_REASON["reason"] = reason
    _LAST_SERVER_REASON["ts"] = now
    print(f"Server response: bot disabled ({reason})")
    if reason == "mt5_stale":
        set_state("RECOVERING", "server reported mt5_stale")
        ensure_mt5(force=True)
        _reset_session()
        request_heartbeat("mt5_stale recovery")
    elif reason == "bridge_update_required":
        print(f"  Download the latest aurumai_bridge.py (required v{data.get('requiredVersion')}).")


if __name__ == "__main__":
    while True:
        try:
            main()
        except KeyboardInterrupt:
            print("Shutting down")
            break
        except Exception as e:
            # Absolute last resort: restart the whole loop in-process.
            print(f"FATAL loop error, restarting bridge internals in 5s: {e}")
            time.sleep(5)
            continue
    try:
        mt5.shutdown()
    except Exception:
        pass
