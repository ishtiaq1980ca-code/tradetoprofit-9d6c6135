# ============================================================================
# aurumai_config.py — OPTIONAL personal settings for the AurumAI MT5 bridge.
# ============================================================================
#
# This file is 100% OPTIONAL. The bot trades fine WITHOUT it.
#
# What it does:
#   The main `aurumai_bridge.py` script is overwritten every time you download
#   a new version from the MT5 Bridge page. If you put your BRIDGE_TOKEN,
#   MT5 login, or symbol overrides directly inside aurumai_bridge.py, you
#   will lose them on every update. This file survives updates.
#
# How to use:
#   1. Place this file in the SAME folder as aurumai_bridge.py.
#   2. Fill in only the values you want to override. Delete or comment out
#      the rest — anything left blank falls back to auto-detect from MT5.
#   3. Run `py aurumai_bridge.py` as usual. You should see:
#        "Loaded personal settings from aurumai_config.py"
#
# You can leave every value below blank / commented and the bridge will
# still work — it auto-detects the MT5 account currently logged in and
# auto-maps every broker symbol.
# ============================================================================

# --- Cloud endpoint (rarely needs changing) ---
# BASE_URL = "https://tradetoprofit.lovable.app"

# --- Your Bridge token / active license token from the MT5 Bridge page ---
BRIDGE_TOKEN = ""

# --- MT5 credentials (leave all three blank/0 to auto-detect the account
#     that is already logged in on the open MT5 terminal) ---
MT5_LOGIN  = 0
MT5_PASS   = ""
MT5_SERVER = ""

# --- Symbol overrides ---
# The bridge auto-maps every AurumAI symbol to your broker's naming style
# (e.g. XAUUSD -> XAUUSDm on Exness). You only need an entry here if
# auto-detection fails for a specific pair. Example:
#   SYMBOL_OVERRIDES = {
#       "XAUUSD": "GOLD.raw",
#       "EURUSD": "EURUSD.pro",
#   }
SYMBOL_OVERRIDES: dict[str, str] = {}
