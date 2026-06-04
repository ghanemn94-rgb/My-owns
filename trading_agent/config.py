"""Central configuration for the US Stock Trading Agent.

All settings live here. Secrets (the Anthropic API key) are read from the
environment first so the key never has to be committed to source control.
"""

import os

# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------
# Prefer the environment variable; fall back to an inline value for local use.
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# The Claude model used for trade reasoning.
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")

# ---------------------------------------------------------------------------
# Capital & risk settings
# ---------------------------------------------------------------------------
STARTING_CAPITAL = 100_000          # paper money only
MAX_POSITIONS = 5                   # max concurrent open positions
MAX_RISK_PER_TRADE = 0.02           # 2% of portfolio risked per trade (hard cap)
STOP_LOSS_DEFAULT = 0.05            # 5% default stop distance
TAKE_PROFIT_DEFAULT = 0.10          # 10% default take-profit distance
MIN_ML_CONFIDENCE = 0.60            # minimum ML probability to consider a long
MAX_DAILY_DRAWDOWN = 0.10           # halt new trades if down >10% intraday
RETRAIN_EVERY_N_TRADES = 50         # retrain general model cadence
SYMBOL_MODEL_MIN_TRADES = 20        # min closed trades to train a symbol model
EVALUATE_EVERY_N_TRADES = 10        # model self-evaluation cadence

# ---------------------------------------------------------------------------
# Market / risk regime thresholds
# ---------------------------------------------------------------------------
VIX_HIGH = 30.0                     # above this -> halve position sizes
VIX_MEDIUM = 20.0                   # above this -> elevated fear
SPY_DOWN_THRESHOLD = -0.015         # SPY down >1.5% -> only shorts / cash
MIN_MARKET_BREADTH = 0.30           # breadth below this -> avoid new longs
MIN_FACTORS_TO_TRADE = 3            # signal-alignment factors required to trade

# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------
WATCHLIST = [
    "AAPL", "MSFT", "NVDA", "TSLA", "AMZN",
    "GOOGL", "META", "AMD", "JPM", "NFLX",
]

# Breadth is sampled from this representative basket of large caps.
BREADTH_UNIVERSE = WATCHLIST + ["SPY", "QQQ", "DIA", "IWM"]

# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------
LOOP_INTERVAL_MINUTES = 5           # cadence of the live trading loop
MARKET_OPEN = "09:30"               # ET
MARKET_CLOSE = "16:00"              # ET

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODELS_DIR = os.path.join(BASE_DIR, "models")
DB_PATH = os.path.join(DATA_DIR, "trades.db")
GENERAL_MODEL_PATH = os.path.join(MODELS_DIR, "trading_model.pkl")
FEATURE_IMPORTANCE_PATH = os.path.join(MODELS_DIR, "feature_importance.json")
SYMBOL_MODEL_PATH = os.path.join(MODELS_DIR, "symbol_{symbol}_model.pkl")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)
