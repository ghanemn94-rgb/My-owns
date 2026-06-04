"""Demo market-data feed.

When the live environment has no network access to Yahoo Finance (e.g. a
locked-down cloud sandbox), this module provides realistic synthetic OHLCV so
the full agent + dashboard can be run and demonstrated offline. Prices are a
deterministic random walk per symbol (stable across cycles) with a small live
jitter on the most recent bar so the dashboard visibly moves each cycle.

Enable with ``demo_data.install()`` or ``python main.py run --demo``.
This is for demonstration only — real runs use the live Yahoo feed in tools.py.
"""

import time

import numpy as np
import pandas as pd

import tools

# Plausible recent price levels for the watchlist + market instruments.
_BASE_PRICES = {
    "AAPL": 210, "MSFT": 450, "NVDA": 130, "TSLA": 250, "AMZN": 190,
    "GOOGL": 175, "META": 500, "AMD": 160, "JPM": 200, "NFLX": 650,
    "SPY": 540, "QQQ": 470, "DIA": 400, "IWM": 205, "^VIX": 15.5,
    "XLK": 230, "XLF": 45, "XLE": 90, "XLV": 145,
}


def _generate(symbol, n=260):
    base = _BASE_PRICES.get(symbol, 100.0)
    rng = np.random.default_rng(abs(hash(symbol)) % 100000)

    # VIX behaves differently (mean-reverting, higher vol) than equities.
    if symbol == "^VIX":
        vol, drift = 0.06, 0.0
    else:
        vol, drift = 0.018, 0.0004

    rets = rng.normal(drift, vol, n)
    close = base * np.cumprod(1 + rets)
    close = close * (base / close[0])  # scale so the series starts near base

    # Keep the VIX in a believable range (it is mean-reverting in reality).
    if symbol == "^VIX":
        close = np.clip(close, 11.0, 34.0)

    volume = rng.integers(5_000_000, 60_000_000, n).astype(float)

    # For ~half the watchlist symbols, engineer a fresh oversold pullback into
    # an established uptrend (a classic "buy the dip" setup) so the agent has
    # genuine, varied opportunities to reason about in the demo.
    if symbol not in ("^VIX", "SPY", "QQQ", "DIA", "IWM", "XLK", "XLF", "XLE", "XLV"):
        if abs(hash(symbol)) % 2 == 0:
            close[-6:] = close[-7] * np.array([0.985, 0.97, 0.955, 0.945, 0.94, 0.945])
            volume[-1] *= 2.2  # capitulation volume spike

    # Small live jitter on the final bar, refreshed each cycle so the dashboard
    # visibly moves between cycles.
    jitter = np.random.default_rng(int(time.time()) // 20 + abs(hash(symbol)) % 7)
    close[-1] = close[-1] * (1 + jitter.normal(0, 0.004))

    high = close * (1 + np.abs(rng.normal(0, 0.004, n)))
    low = close * (1 - np.abs(rng.normal(0, 0.004, n)))
    openp = np.concatenate([[close[0]], close[:-1]])

    idx = pd.date_range(end=pd.Timestamp.today().normalize(), periods=n, freq="B")
    return pd.DataFrame(
        {"Open": openp, "High": high, "Low": low, "Close": close, "Volume": volume},
        index=idx,
    )


def seed_and_train(n_trades=140):
    """Seed a batch of synthetic closed trades and train the model so the demo
    starts with a trained ML layer contributing real predictions."""
    import random

    import config
    import portfolio
    from ml import feature_engineer, trainer, predictor
    from memory import trade_memory

    rng = random.Random(7)
    market = {"spy_trend_numeric": 1, "vix_level": 15.5, "vix_change_today": 0.0,
              "market_breadth_score": 0.6}
    for _ in range(n_trades):
        sym = rng.choice(config.WATCHLIST)
        rsi = rng.uniform(20, 80)
        macd_h = rng.uniform(-1, 1)
        vol = rng.uniform(0.8, 2.5)
        feats = feature_engineer.build_feature_dict(
            {"price": 100, "rsi": rsi, "macd_signal_line": 0,
             "macd_histogram": macd_h, "sma20": 99, "sma50": 98,
             "sma200": 95, "bb_position": 0.5, "atr_normalized": 0.02,
             "volume_ratio": vol},
            market, {"sentiment_score": 0.0},
        )
        tid = portfolio.open_position(sym, "BUY", 5, 100.0, 95.0, 110.0,
                                      "demo seed", 60, 55)
        feature_engineer.save_features(tid, feats)
        # A clean, learnable edge: oversold RSI with bullish MACD and a volume
        # spike wins most of the time; everything else mostly loses. Light
        # noise keeps it realistic without destroying the signal.
        edge = (rsi < 45) and (macd_h > 0) and (vol > 1.3)
        if edge:
            win = 1 if rng.random() < 0.85 else 0
        else:
            win = 1 if rng.random() < 0.30 else 0
        closed = portfolio.close_position(tid, 108.0 if win else 94.0,
                                          hit_stop=not win, hit_target=win)
        trade_memory.record_trade_lesson(closed)

    result = trainer.train_general_model()
    predictor.clear_cache()
    return result


def install():
    """Patch the tools data layer to serve synthetic data instead of Yahoo."""
    cache = {}

    def demo_history(symbol, period="1y", interval="1d", use_cache=True):
        # Cache per cycle; tools.clear_market_cache() drops it for fresh quotes.
        if symbol not in cache:
            cache[symbol] = _generate(symbol)
        return cache[symbol]

    def demo_clear():
        cache.clear()

    tools._history = demo_history
    tools.clear_market_cache = demo_clear
    # No live news in demo mode; sentiment falls back to neutral gracefully.
    print("📡 DEMO DATA MODE active — synthetic market data (no network needed).")
