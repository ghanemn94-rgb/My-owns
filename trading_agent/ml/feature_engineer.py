"""Feature engineering.

This module is the single source of truth for turning raw market data into
both human-readable technical indicators (used by the tools layer) and the
canonical ML feature vector (used by the trainer / predictor). Keeping both in
one place guarantees that what Claude sees, what gets stored, and what the
model trains on are computed identically.
"""

from datetime import datetime, timezone

import numpy as np
import pandas as pd

import db


# ---------------------------------------------------------------------------
# Raw technical indicators from an OHLCV DataFrame
# ---------------------------------------------------------------------------
def compute_indicators(df: pd.DataFrame) -> dict:
    """Compute the core technical indicators from a price DataFrame.

    Expects columns: Open, High, Low, Close, Volume. Uses the ``ta`` library
    when available and falls back to pandas implementations otherwise. Returns
    raw numeric values; interpretation happens in the tools layer.
    """
    close = df["Close"].astype(float)
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    volume = df["Volume"].astype(float)

    price = float(close.iloc[-1])

    rsi = _rsi(close, 14)
    macd_line, signal_line, hist = _macd(close)
    sma20 = float(close.rolling(20).mean().iloc[-1]) if len(close) >= 20 else price
    sma50 = float(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else price
    sma200 = float(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else price

    bb_mid, bb_up, bb_low = _bollinger(close, 20, 2)
    band = (bb_up - bb_low) or 1e-9
    bb_position = (price - bb_low) / band  # 0 = lower band, 1 = upper band

    atr = _atr(high, low, close, 14)
    atr_norm = atr / price if price else 0.0

    vol_today = float(volume.iloc[-1])
    vol_avg20 = float(volume.rolling(20).mean().iloc[-1]) if len(volume) >= 20 else vol_today
    volume_ratio = vol_today / vol_avg20 if vol_avg20 else 1.0

    return {
        "price": round(price, 2),
        "rsi": round(rsi, 2),
        "macd_line": round(macd_line, 4),
        "macd_signal_line": round(signal_line, 4),
        "macd_histogram": round(hist, 4),
        "sma20": round(sma20, 2),
        "sma50": round(sma50, 2),
        "sma200": round(sma200, 2),
        "bb_upper": round(bb_up, 2),
        "bb_lower": round(bb_low, 2),
        "bb_position": round(bb_position, 3),
        "atr": round(atr, 4),
        "atr_normalized": round(atr_norm, 4),
        "volume_today": vol_today,
        "volume_avg20": vol_avg20,
        "volume_ratio": round(volume_ratio, 2),
    }


def _rsi(close, period):
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    val = rsi.iloc[-1]
    return float(val) if not np.isnan(val) else 50.0


def _macd(close, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return float(macd_line.iloc[-1]), float(signal_line.iloc[-1]), float(hist.iloc[-1])


def _bollinger(close, period, num_std):
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    up = mid + num_std * std
    low = mid - num_std * std
    last_mid = float(mid.iloc[-1]) if not np.isnan(mid.iloc[-1]) else float(close.iloc[-1])
    last_up = float(up.iloc[-1]) if not np.isnan(up.iloc[-1]) else last_mid
    last_low = float(low.iloc[-1]) if not np.isnan(low.iloc[-1]) else last_mid
    return last_mid, last_up, last_low


def _atr(high, low, close, period):
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    atr = tr.rolling(period).mean().iloc[-1]
    return float(atr) if not np.isnan(atr) else 0.0


# ---------------------------------------------------------------------------
# Canonical ML feature vector
# ---------------------------------------------------------------------------
def _time_of_day_num(now):
    """0 = morning (before 12:00), 1 = midday, 2 = power hour (after 15:00)."""
    hour = now.hour
    if hour < 12:
        return 0
    if hour < 15:
        return 1
    return 2


def build_feature_dict(indicators, market, sentiment, now=None):
    """Combine technical / market / context signals into the canonical dict.

    Every key in ``db.FEATURE_COLUMNS`` is present, defaulting to a neutral
    value if a piece of upstream data is missing.
    """
    now = now or datetime.now(timezone.utc)
    price = indicators.get("price") or 0.0

    def dist(sma):
        return (price - sma) / sma if sma else 0.0

    feats = {
        "rsi_14": indicators.get("rsi", 50.0),
        "macd_signal": indicators.get("macd_signal_line", 0.0),
        "macd_histogram": indicators.get("macd_histogram", 0.0),
        "price_vs_sma20": round(dist(indicators.get("sma20", price)), 4),
        "price_vs_sma50": round(dist(indicators.get("sma50", price)), 4),
        "price_vs_sma200": round(dist(indicators.get("sma200", price)), 4),
        "bollinger_position": indicators.get("bb_position", 0.5),
        "atr_normalized": indicators.get("atr_normalized", 0.0),
        "volume_ratio": indicators.get("volume_ratio", 1.0),
        "spy_trend": market.get("spy_trend_numeric", 0),
        "vix_level": market.get("vix_level", 18.0),
        "vix_change_today": market.get("vix_change_today", 0.0),
        "market_breadth_score": market.get("market_breadth_score", 0.5),
        "sector_performance": sentiment.get("sector_performance", 0.0),
        "days_to_earnings": sentiment.get("days_to_earnings", 99),
        "news_sentiment_score": sentiment.get("sentiment_score", 0.0),
        "time_of_day_num": _time_of_day_num(now),
        "day_of_week": now.weekday(),
    }
    # Guarantee every canonical column exists.
    for col in db.FEATURE_COLUMNS:
        feats.setdefault(col, 0.0)
    return feats


def to_vector(feature_dict):
    """Ordered numeric vector aligned to ``db.FEATURE_COLUMNS``."""
    return [float(feature_dict.get(col, 0.0)) for col in db.FEATURE_COLUMNS]


def save_features(trade_id, feature_dict):
    """Persist the feature row for a trade so the model can train on it later."""
    cols = ", ".join(["trade_id"] + db.FEATURE_COLUMNS)
    placeholders = ", ".join(["?"] * (len(db.FEATURE_COLUMNS) + 1))
    values = [trade_id] + to_vector(feature_dict)
    with db.transaction() as conn:
        conn.execute(
            f"INSERT OR REPLACE INTO features ({cols}) VALUES ({placeholders})",
            values,
        )
