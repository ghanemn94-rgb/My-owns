"""Trading tools exposed to the Claude agent.

Every function here is a self-contained tool the agent can call. They all fail
gracefully: a market-data outage, a missing symbol, or the market being closed
returns a structured ``{"error": ...}`` payload rather than raising, so the
agent loop never crashes mid-cycle.

PAPER TRADING ONLY — there is no brokerage connection anywhere in this file.
"""

from datetime import datetime, timezone

import config
import db
import portfolio
import risk_manager
from ml import feature_engineer, predictor
from memory import context_builder, trade_memory

try:
    import logging
    import yfinance as yf
    # yfinance logs HTTP errors directly; quiet it so a data outage doesn't
    # spam the dashboard. We surface failures via structured return values.
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
except Exception:  # pragma: no cover - import guard
    yf = None


# ---------------------------------------------------------------------------
# Market-data helpers (with a per-process cache)
# ---------------------------------------------------------------------------
_price_cache = {}        # symbol -> last known price (for portfolio valuation)
_history_cache = {}      # (symbol, period, interval) -> DataFrame


def _history(symbol, period="1y", interval="1d", use_cache=True):
    """Fetch OHLCV history via yfinance with simple caching and error handling."""
    key = (symbol, period, interval)
    if use_cache and key in _history_cache:
        return _history_cache[key]
    if yf is None:
        return None
    try:
        df = yf.Ticker(symbol).history(period=period, interval=interval)
        if df is None or df.empty:
            return None
        _history_cache[key] = df
        return df
    except Exception:
        return None


def clear_market_cache():
    """Drop cached market data — called once per agent cycle for fresh quotes."""
    _history_cache.clear()


def price_lookup():
    """Return the latest-known price map for portfolio valuation."""
    return dict(_price_cache)


# ---------------------------------------------------------------------------
# 1. Price
# ---------------------------------------------------------------------------
def get_stock_price(symbol: str) -> dict:
    df = _history(symbol, period="5d", interval="1d")
    if df is None:
        return {"symbol": symbol, "error": "Price data unavailable (market closed or network down)."}
    last = df.iloc[-1]
    price = float(last["Close"])
    _price_cache[symbol] = price
    return {
        "symbol": symbol,
        "price": round(price, 2),
        "open": round(float(last["Open"]), 2),
        "day_high": round(float(last["High"]), 2),
        "day_low": round(float(last["Low"]), 2),
        "volume": int(last["Volume"]),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# 2. Technical analysis
# ---------------------------------------------------------------------------
def get_technical_analysis(symbol: str) -> dict:
    df = _history(symbol, period="1y", interval="1d")
    if df is None or len(df) < 30:
        return {"symbol": symbol, "error": "Insufficient history for technical analysis."}

    ind = feature_engineer.compute_indicators(df)
    _price_cache[symbol] = ind["price"]

    interp = []
    if ind["rsi"] < 30:
        interp.append("RSI oversold (<30) — potential bounce.")
    elif ind["rsi"] > 70:
        interp.append("RSI overbought (>70) — potential pullback.")
    else:
        interp.append(f"RSI neutral ({ind['rsi']}).")

    if ind["macd_histogram"] > 0:
        interp.append("MACD bullish (histogram positive).")
    else:
        interp.append("MACD bearish (histogram negative).")

    price = ind["price"]
    trend_bits = []
    trend_bits.append("above" if price > ind["sma20"] else "below")
    interp.append(
        f"Price {trend_bits[-1]} SMA20; "
        f"{'above' if price > ind['sma50'] else 'below'} SMA50; "
        f"{'above' if price > ind['sma200'] else 'below'} SMA200."
    )

    if ind["bb_position"] > 1:
        interp.append("Price above upper Bollinger Band (stretched).")
    elif ind["bb_position"] < 0:
        interp.append("Price below lower Bollinger Band (stretched).")

    if ind["volume_ratio"] > 1.5:
        interp.append(f"Volume spike ({ind['volume_ratio']}x 20-day avg).")
    elif ind["volume_ratio"] < 0.6:
        interp.append("Volume well below average (weak participation).")

    interp.append(f"ATR (volatility) is {ind['atr_normalized']*100:.1f}% of price.")

    return {
        "symbol": symbol,
        "price": price,
        "rsi_14": ind["rsi"],
        "macd_line": ind["macd_line"],
        "macd_signal_line": ind["macd_signal_line"],
        "macd_histogram": ind["macd_histogram"],
        "sma20": ind["sma20"],
        "sma50": ind["sma50"],
        "sma200": ind["sma200"],
        "bollinger_upper": ind["bb_upper"],
        "bollinger_lower": ind["bb_lower"],
        "bollinger_position": ind["bb_position"],
        "atr": ind["atr"],
        "atr_normalized": ind["atr_normalized"],
        "volume_ratio": ind["volume_ratio"],
        "interpretation": " ".join(interp),
        "_indicators": ind,  # internal: passed to feature engineering
    }


# ---------------------------------------------------------------------------
# 3. Market context
# ---------------------------------------------------------------------------
def _pct_change(df, lookback=1):
    if df is None or len(df) <= lookback:
        return None
    closes = df["Close"]
    return float((closes.iloc[-1] - closes.iloc[-1 - lookback]) / closes.iloc[-1 - lookback])


def get_market_context() -> dict:
    spy = _history("SPY", period="1mo", interval="1d")
    spy_change = _pct_change(spy, 1)

    if spy_change is None:
        spy_trend, spy_trend_num = "unknown", 0
    elif spy_change > 0.002:
        spy_trend, spy_trend_num = "up", 1
    elif spy_change < -0.002:
        spy_trend, spy_trend_num = "down", -1
    else:
        spy_trend, spy_trend_num = "sideways", 0

    vix = _history("^VIX", period="5d", interval="1d")
    vix_level = float(vix["Close"].iloc[-1]) if vix is not None else 18.0
    vix_change = _pct_change(vix, 1) or 0.0
    if vix_level > config.VIX_HIGH:
        vix_interp = "high fear"
    elif vix_level > config.VIX_MEDIUM:
        vix_interp = "medium fear"
    else:
        vix_interp = "low fear"

    # Market breadth — fraction of the basket advancing today.
    advancing = total = 0
    for sym in config.BREADTH_UNIVERSE:
        ch = _pct_change(_history(sym, period="5d", interval="1d"), 1)
        if ch is None:
            continue
        total += 1
        if ch > 0:
            advancing += 1
    breadth = advancing / total if total else 0.5

    # Sector rotation: compare a couple of major sector ETFs over 5 days.
    sector_signals = {}
    for etf in ("XLK", "XLF", "XLE", "XLV"):
        ch5 = _pct_change(_history(etf, period="1mo", interval="1d"), 5)
        if ch5 is not None:
            sector_signals[etf] = round(ch5 * 100, 2)

    regime = f"{spy_trend}/{vix_interp}"

    return {
        "spy_trend": spy_trend,
        "spy_trend_numeric": spy_trend_num,
        "spy_change_pct": round(spy_change * 100, 2) if spy_change is not None else None,
        "vix_level": round(vix_level, 2),
        "vix_change_today": round(vix_change * 100, 2),
        "vix_interpretation": vix_interp,
        "market_breadth_score": round(breadth, 2),
        "breadth_advancing": advancing,
        "breadth_total": total,
        "sector_rotation": sector_signals,
        "regime": regime,
        "safe_to_trade_longs": (
            spy_trend != "down"
            and breadth >= config.MIN_MARKET_BREADTH
            and (spy_change is None or spy_change > config.SPY_DOWN_THRESHOLD)
        ),
    }


# ---------------------------------------------------------------------------
# 4. News sentiment
# ---------------------------------------------------------------------------
_POSITIVE = {
    "beat", "beats", "surge", "surges", "rally", "rallies", "upgrade", "upgraded",
    "record", "strong", "growth", "gains", "soar", "soars", "outperform", "buy",
    "bullish", "approval", "approved", "wins", "win", "boost", "raise", "raised",
    "profit", "profits", "jump", "jumps", "high", "positive", "expands",
}
_NEGATIVE = {
    "miss", "misses", "plunge", "plunges", "downgrade", "downgraded", "weak",
    "loss", "losses", "lawsuit", "probe", "investigation", "recall", "cuts",
    "cut", "warning", "warns", "bearish", "decline", "declines", "drop", "drops",
    "fall", "falls", "fraud", "halt", "slump", "negative", "disappointing", "fear",
}
_EVENT_KEYWORDS = {
    "earnings": "earnings", "fda": "FDA decision", "merger": "merger",
    "acquisition": "acquisition", "guidance": "guidance update",
    "dividend": "dividend", "split": "stock split", "sec": "regulatory",
}


def get_news_sentiment(symbol: str) -> dict:
    headlines = []
    if yf is not None:
        try:
            raw = yf.Ticker(symbol).news or []
            for item in raw[:10]:
                title = item.get("title") or item.get("content", {}).get("title")
                if title:
                    headlines.append(title)
        except Exception:
            headlines = []

    score = 0
    pos_hits = neg_hits = 0
    events = set()
    for h in headlines:
        words = {w.strip(".,!?:;\"'").lower() for w in h.split()}
        p = len(words & _POSITIVE)
        n = len(words & _NEGATIVE)
        pos_hits += p
        neg_hits += n
        score += p - n
        for kw, label in _EVENT_KEYWORDS.items():
            if kw in words or kw in h.lower():
                events.add(label)

    total_hits = pos_hits + neg_hits
    norm_score = (pos_hits - neg_hits) / total_hits if total_hits else 0.0
    if norm_score > 0.15:
        sentiment = "positive"
    elif norm_score < -0.15:
        sentiment = "negative"
    else:
        sentiment = "neutral"

    days_to_earnings = _days_to_earnings(symbol)
    earnings_soon = days_to_earnings is not None and days_to_earnings <= 5

    # Sector performance proxy: this stock's 5d return vs SPY's 5d return.
    sector_perf = 0.0
    stock_5d = _pct_change(_history(symbol, period="1mo", interval="1d"), 5)
    spy_5d = _pct_change(_history("SPY", period="1mo", interval="1d"), 5)
    if stock_5d is not None and spy_5d is not None:
        sector_perf = round((stock_5d - spy_5d) * 100, 2)

    return {
        "symbol": symbol,
        "headline_count": len(headlines),
        "headlines": headlines[:5],
        "sentiment": sentiment,
        "sentiment_score": round(norm_score, 3),
        "positive_signals": pos_hits,
        "negative_signals": neg_hits,
        "days_to_earnings": days_to_earnings if days_to_earnings is not None else 99,
        "earnings_within_5_days": earnings_soon,
        "major_events": sorted(events),
        "sector_performance": sector_perf,
    }


def _days_to_earnings(symbol):
    if yf is None:
        return None
    try:
        cal = yf.Ticker(symbol).calendar
        date = None
        if isinstance(cal, dict):
            ed = cal.get("Earnings Date")
            if isinstance(ed, (list, tuple)) and ed:
                date = ed[0]
            else:
                date = ed
        if date is None:
            return None
        if hasattr(date, "to_pydatetime"):
            date = date.to_pydatetime()
        if isinstance(date, datetime):
            delta = (date.date() - datetime.now(timezone.utc).date()).days
            return delta if delta >= 0 else None
        # date-like
        delta = (date - datetime.now(timezone.utc).date()).days
        return delta if delta >= 0 else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 5. ML prediction
# ---------------------------------------------------------------------------
def get_ml_prediction(symbol: str, features: dict) -> dict:
    return predictor.predict(symbol, features)


# ---------------------------------------------------------------------------
# 6. Agent memory
# ---------------------------------------------------------------------------
def get_agent_memory(symbol: str) -> dict:
    return context_builder.build_symbol_memory(symbol)


# ---------------------------------------------------------------------------
# 7. Watchlist scan
# ---------------------------------------------------------------------------
def _technical_score(ta):
    """0-100 technical attractiveness for a long setup."""
    score = 50.0
    rsi = ta["rsi_14"]
    if rsi < 30:
        score += 20
    elif rsi < 45:
        score += 8
    elif rsi > 70:
        score -= 20
    if ta["macd_histogram"] > 0:
        score += 12
    else:
        score -= 8
    if ta["price"] > ta["sma50"]:
        score += 8
    if ta["price"] > ta["sma200"]:
        score += 6
    if ta["volume_ratio"] > 1.5:
        score += 6
    return max(0.0, min(100.0, score))


def scan_watchlist() -> list:
    """Rank watchlist symbols by combined technical + ML + sentiment score."""
    market = get_market_context()
    results = []
    for symbol in config.WATCHLIST:
        ta = get_technical_analysis(symbol)
        if "error" in ta:
            continue
        sentiment = get_news_sentiment(symbol)
        feats = feature_engineer.build_feature_dict(ta["_indicators"], market, sentiment)
        ml = get_ml_prediction(symbol, feats)

        tech_score = _technical_score(ta)
        ml_score = ml["probability"]
        sent_score = (sentiment["sentiment_score"] + 1) / 2 * 100  # -1..1 -> 0..100
        combined = round(0.4 * tech_score + 0.4 * ml_score + 0.2 * sent_score, 1)

        results.append(
            {
                "symbol": symbol,
                "combined_score": combined,
                "technical_score": round(tech_score, 1),
                "ml_score": ml_score,
                "sentiment_score": round(sent_score, 1),
                "price": ta["price"],
                "rsi": ta["rsi_14"],
                "sentiment": sentiment["sentiment"],
                "earnings_within_5_days": sentiment["earnings_within_5_days"],
            }
        )

    results.sort(key=lambda r: r["combined_score"], reverse=True)
    return results


# ---------------------------------------------------------------------------
# 8. Execute paper trade
# ---------------------------------------------------------------------------
def execute_paper_trade(symbol, action, quantity, reasoning,
                        stop_loss=None, take_profit=None,
                        confidence=None, ml_prediction=None,
                        features=None) -> dict:
    """Open a paper position. Sets stop/target automatically if not provided,
    persists full reasoning + features for ML, and returns a confirmation."""
    action = action.upper()
    if action not in ("BUY", "SELL"):
        return {"error": f"Invalid action '{action}'. Use BUY or SELL."}

    price_info = get_stock_price(symbol)
    if "error" in price_info:
        return {"error": f"Cannot price {symbol}: {price_info['error']}"}
    entry_price = price_info["price"]

    if quantity <= 0:
        return {"error": "Quantity must be positive."}

    if stop_loss is None or take_profit is None:
        d_stop, d_target = risk_manager.default_stop_and_target(entry_price, action)
        stop_loss = stop_loss or d_stop
        take_profit = take_profit or d_target

    if action == "BUY" and quantity * entry_price > portfolio.get_cash() + 1e-6:
        return {"error": "Insufficient cash for this trade."}

    trade_id = portfolio.open_position(
        symbol=symbol, action=action, quantity=quantity, entry_price=entry_price,
        stop_loss=stop_loss, take_profit=take_profit, reasoning=reasoning,
        confidence=confidence, ml_prediction=(ml_prediction or {}).get("probability"),
    )

    if features:
        feature_engineer.save_features(trade_id, features)

    return {
        "status": "FILLED",
        "trade_id": trade_id,
        "symbol": symbol,
        "action": action,
        "quantity": quantity,
        "entry_price": entry_price,
        "stop_loss": stop_loss,
        "take_profit": take_profit,
        "cash_remaining": round(portfolio.get_cash(), 2),
    }


# ---------------------------------------------------------------------------
# 9. Monitor open positions
# ---------------------------------------------------------------------------
def monitor_open_positions() -> list:
    """Check every open position; close on stop/target; flag thesis changes."""
    actions = []
    for pos in portfolio.get_open_positions():
        symbol = pos["symbol"]
        price_info = get_stock_price(symbol)
        if "error" in price_info:
            actions.append({"symbol": symbol, "status": "no_data"})
            continue
        price = price_info["price"]
        stop, target = pos["stop_loss"], pos["take_profit"]
        hit_stop = hit_target = False

        if pos["action"] == "BUY":
            if stop and price <= stop:
                hit_stop = True
            elif target and price >= target:
                hit_target = True
        else:  # short
            if stop and price >= stop:
                hit_stop = True
            elif target and price <= target:
                hit_target = True

        if hit_stop or hit_target:
            closed = portfolio.close_position(
                pos["id"], price, hit_stop=hit_stop, hit_target=hit_target
            )
            if closed:
                trade_memory.record_trade_lesson(closed)
            actions.append(
                {
                    "symbol": symbol,
                    "status": "closed",
                    "reason": "stop_loss" if hit_stop else "take_profit",
                    "exit_price": price,
                    "return_pct": round(closed["return_pct"], 2) if closed else None,
                }
            )
        else:
            # Thesis-change check: has the technical picture flipped against us?
            ta = get_technical_analysis(symbol)
            alert = None
            if "error" not in ta:
                if pos["action"] == "BUY" and ta["macd_histogram"] < 0 and ta["rsi_14"] > 70:
                    alert = "Long thesis weakening: MACD turned negative while overbought."
                elif pos["action"] == "SELL" and ta["macd_histogram"] > 0 and ta["rsi_14"] < 30:
                    alert = "Short thesis weakening: MACD turned positive while oversold."
            actions.append(
                {
                    "symbol": symbol,
                    "status": "holding",
                    "current_price": price,
                    "stop_loss": stop,
                    "take_profit": target,
                    "thesis_alert": alert,
                }
            )
    return actions


# ---------------------------------------------------------------------------
# 10. Portfolio status
# ---------------------------------------------------------------------------
def get_portfolio_status() -> dict:
    pl = price_lookup()
    # Refresh prices for open positions so valuation is current.
    for pos in portfolio.get_open_positions():
        if pos["symbol"] not in pl:
            info = get_stock_price(pos["symbol"])
            if "error" not in info:
                pl[pos["symbol"]] = info["price"]

    cash = portfolio.get_cash()
    positions = portfolio.unrealized_pnl(pl)
    total_val = portfolio.total_value(pl)
    metrics = portfolio.performance_metrics()
    start = portfolio.get_starting_capital()

    return {
        "cash": round(cash, 2),
        "total_value": round(total_val, 2),
        "starting_capital": start,
        "total_return_pct": round((total_val - start) / start * 100, 2) if start else 0.0,
        "open_positions": positions,
        "open_count": len(positions),
        "max_positions": config.MAX_POSITIONS,
        "unrealized_pnl_total": round(sum(p["unrealized_pnl"] for p in positions), 2),
        "win_rate": metrics["win_rate"],
        "avg_return": metrics["avg_return"],
        "sharpe": metrics["sharpe"],
        "max_drawdown": metrics["max_drawdown"],
        "total_closed_trades": metrics["total_trades"],
    }
