"""Per-symbol pattern analytics.

Mines the trade + feature history for a symbol to answer questions like:
  * What is my win rate on this symbol?
  * Which time of day / day of week has worked best?
  * How long do winners run vs losers?
  * Which signal "shape" (e.g. RSI oversold + volume spike) tends to win?

These analytics are descriptive (computed on demand from the DB) rather than a
separate persisted store, which keeps them always consistent with the trade log.
"""

from datetime import datetime

import db


def _parse(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def symbol_stats(symbol):
    """Overall win rate / average return / trade count for a symbol."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n, AVG(was_profitable) AS wr, AVG(return_pct) AS ar "
            "FROM trades WHERE status='CLOSED' AND symbol=?",
            (symbol,),
        ).fetchone()
    n = int(row["n"] or 0)
    return {
        "symbol": symbol,
        "trades": n,
        "win_rate": round((row["wr"] or 0.0) * 100, 1) if n else 0.0,
        "avg_return": round(row["ar"] or 0.0, 2) if n else 0.0,
    }


def win_rate_by_signal(symbol):
    """Classify each closed trade by the dominant technical signal present at
    entry and report win rate per signal type."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT t.was_profitable AS win, f.rsi_14, f.macd_histogram, "
            "f.volume_ratio, f.news_sentiment_score "
            "FROM trades t JOIN features f ON f.trade_id=t.id "
            "WHERE t.status='CLOSED' AND t.symbol=?",
            (symbol,),
        ).fetchall()

    buckets = {}
    for r in rows:
        signal = _classify_signal(r)
        b = buckets.setdefault(signal, {"wins": 0, "total": 0})
        b["total"] += 1
        b["wins"] += int(bool(r["win"]))

    return {
        sig: {
            "trades": b["total"],
            "win_rate": round(b["wins"] / b["total"] * 100, 1) if b["total"] else 0.0,
        }
        for sig, b in buckets.items()
    }


def _classify_signal(row):
    rsi = row["rsi_14"]
    macd_h = row["macd_histogram"]
    vol = row["volume_ratio"]
    sent = row["news_sentiment_score"]

    factors = []
    if rsi is not None and rsi < 35:
        factors.append("RSI_oversold")
    elif rsi is not None and rsi > 65:
        factors.append("RSI_overbought")
    if macd_h is not None and macd_h > 0:
        factors.append("MACD_bull")
    if vol is not None and vol > 1.5:
        factors.append("volume_spike")
    if sent is not None and sent > 0.2:
        factors.append("positive_news")

    if not factors:
        return "neutral"
    if len(factors) >= 3:
        return "all_aligned"
    return "+".join(factors)


def hold_time_analysis(symbol):
    """Average hold time (hours) for winning vs losing trades."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT was_profitable AS win, entry_time, exit_time "
            "FROM trades WHERE status='CLOSED' AND symbol=?",
            (symbol,),
        ).fetchall()

    win_hours, loss_hours = [], []
    for r in rows:
        start, end = _parse(r["entry_time"]), _parse(r["exit_time"])
        if not (start and end):
            continue
        hours = (end - start).total_seconds() / 3600.0
        (win_hours if r["win"] else loss_hours).append(hours)

    def avg(xs):
        return round(sum(xs) / len(xs), 1) if xs else None

    return {
        "avg_hold_winners_hours": avg(win_hours),
        "avg_hold_losers_hours": avg(loss_hours),
    }


def best_time_of_day(symbol):
    """Which time-of-day bucket has the best win rate for this symbol."""
    labels = {0: "morning", 1: "midday", 2: "power_hour"}
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT f.time_of_day_num AS tod, t.was_profitable AS win "
            "FROM trades t JOIN features f ON f.trade_id=t.id "
            "WHERE t.status='CLOSED' AND t.symbol=?",
            (symbol,),
        ).fetchall()

    buckets = {}
    for r in rows:
        b = buckets.setdefault(labels.get(r["tod"], "unknown"), {"wins": 0, "total": 0})
        b["total"] += 1
        b["wins"] += int(bool(r["win"]))

    if not buckets:
        return None
    best = max(
        buckets.items(),
        key=lambda kv: (kv[1]["wins"] / kv[1]["total"]) if kv[1]["total"] else 0,
    )
    return {
        "best_window": best[0],
        "win_rate": round(best[1]["wins"] / best[1]["total"] * 100, 1)
        if best[1]["total"] else 0.0,
    }


def best_signal_for(symbol):
    """The signal type with the highest win rate (min 1 trade) for a symbol."""
    by_signal = win_rate_by_signal(symbol)
    if not by_signal:
        return None
    best = max(by_signal.items(), key=lambda kv: kv[1]["win_rate"])
    return {"signal": best[0], **best[1]}
