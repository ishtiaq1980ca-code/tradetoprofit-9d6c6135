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
POLL_SEC     = 5                                  # how often to poll for new signals
SLIPPAGE     = 20                                 # in points
MAGIC        = 770077                             # unique magic number for AurumAI trades
TRAILING_ATR_MULT = 1.0                           # trailing stop in ATR units
# ==================================

HEADERS = {"Authorization": f"Bearer {BRIDGE_TOKEN}"}


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


def report_account():
    info = mt5.account_info()
    if info is None:
        return
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
    try:
        requests.post(f"{BASE_URL}/api/public/bridge/account", json=payload, headers=HEADERS, timeout=10)
    except Exception as e:
        print(f"account report failed: {e}")


def execute_signal(sig: dict) -> bool:
    symbol = sig["symbol"]
    original_symbol = symbol
    if not mt5.symbol_select(symbol, True):
        # Many brokers expose Gold as XAUUSDm, XAUUSD., GOLD, etc. Try common
        # variants before giving up so queued dashboard signals can execute.
        candidates = [
            f"{original_symbol}m", f"{original_symbol}.", f"{original_symbol}_",
            "GOLD", "Gold", "XAUUSD", "XAUUSDm", "XAUUSD.", "XAUUSD_",
        ]
        matched = False
        for candidate in candidates:
            if mt5.symbol_select(candidate, True):
                symbol = candidate
                matched = True
                print(f"Mapped {original_symbol} -> broker symbol {symbol}")
                break
        if not matched:
            matches = mt5.symbols_get(f"*{original_symbol}*") or mt5.symbols_get("*XAU*") or []
            if matches and mt5.symbol_select(matches[0].name, True):
                symbol = matches[0].name
                matched = True
                print(f"Mapped {original_symbol} -> broker symbol {symbol}")
        if not matched:
            print(f"symbol_select failed for {original_symbol}; add your broker's Gold symbol to Market Watch")
            return False
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return False
    is_buy = sig["side"] == "BUY"
    price = tick.ask if is_buy else tick.bid
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": float(sig["lot"]),
        "type": mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
        "price": price,
        "sl": float(sig["stop_loss"]),
        "tp": float(sig["take_profit"]),
        "deviation": SLIPPAGE,
        "magic": MAGIC,
        "comment": f"AurumAI {sig['confidence']:.0f}%",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    res = mt5.order_send(req)
    if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
        print(f"order_send failed for {symbol}: {res.retcode if res else 'None'} {res.comment if res else ''}")
        return False
    print(f"Filled {sig['side']} {symbol} ticket={res.order} price={res.price}")
    try:
        requests.post(f"{BASE_URL}/api/public/bridge/trades", headers=HEADERS, timeout=10, json={
            "signal_id": sig["id"],
            "mt5_ticket": int(res.order),
            "symbol": original_symbol,
            "side": sig["side"],
            "entry": float(res.price),
            "stop_loss": float(sig["stop_loss"]),
            "take_profit": float(sig["take_profit"]),
            "lot": float(sig["lot"]),
            "status": "open",
        })
    except Exception as e:
        print(f"trade report failed: {e}")
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

        if time.time() - last_acct > 15:
            report_account()
            sync_closed_trades()
            last_acct = time.time()

        time.sleep(POLL_SEC)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Shutting down")
    finally:
        mt5.shutdown()
