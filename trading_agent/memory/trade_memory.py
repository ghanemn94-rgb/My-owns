"""Trade memory & lessons-learned system.

When a trade closes we record a structured lesson: what triggered the trade,
what the reasoning was, what actually happened, and the takeaway. Over time the
agent mines these for recurring mistakes and most-profitable patterns, and
surfaces the top lessons to Claude before each decision.
"""

from datetime import datetime, timezone

import db


def record_trade_lesson(trade):
    """Derive and store a lesson from a freshly-closed trade row (dict)."""
    symbol = trade["symbol"]
    ret = trade.get("return_pct") or 0.0
    profitable = bool(trade.get("was_profitable"))
    hit_stop = bool(trade.get("hit_stop"))
    hit_target = bool(trade.get("hit_target"))

    if profitable:
        lesson_type = "win"
        outcome = f"+{ret:.2f}%"
        if hit_target:
            desc = f"{symbol}: take-profit hit ({outcome}). Setup worked as planned."
        else:
            desc = f"{symbol}: closed profitably ({outcome})."
        impact = min(abs(ret) / 10.0, 1.0)
    else:
        lesson_type = "loss"
        outcome = f"{ret:.2f}%"
        if hit_stop:
            desc = f"{symbol}: stopped out ({outcome}). Stop protected capital."
        else:
            desc = f"{symbol}: closed at a loss ({outcome})."
        impact = -min(abs(ret) / 10.0, 1.0)

    add_lesson(lesson_type, desc, symbol, impact)


def add_lesson(lesson_type, description, symbol=None, impact_score=0.0):
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO lessons (date, lesson_type, description, symbol, impact_score) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                datetime.now(timezone.utc).isoformat(),
                lesson_type, description, symbol, impact_score,
            ),
        )


def recent_mistakes(symbol=None, limit=3):
    """Return the most recent losing trades' reasoning so the agent can check
    whether it is about to repeat a mistake."""
    query = (
        "SELECT symbol, return_pct, reasoning, exit_time FROM trades "
        "WHERE status='CLOSED' AND was_profitable=0"
    )
    params = []
    if symbol:
        query += " AND symbol=?"
        params.append(symbol)
    query += " ORDER BY exit_time DESC LIMIT ?"
    params.append(limit)
    with db.get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def top_lessons(limit=5):
    """The highest-|impact| lessons across all history (wins and losses)."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM lessons ORDER BY ABS(impact_score) DESC, date DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def identify_recurring_mistakes(min_occurrences=2):
    """Cluster losing trades by symbol to flag repeated mistakes.

    A simple but effective heuristic: if a symbol has lost multiple times,
    that is a recurring mistake worth warning Claude about.
    """
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT symbol, COUNT(*) AS losses, AVG(return_pct) AS avg_loss "
            "FROM trades WHERE status='CLOSED' AND was_profitable=0 "
            "GROUP BY symbol HAVING losses >= ? ORDER BY losses DESC",
            (min_occurrences,),
        ).fetchall()
    return [
        {
            "symbol": r["symbol"],
            "losses": r["losses"],
            "avg_loss_pct": round(r["avg_loss"] or 0.0, 2),
        }
        for r in rows
    ]


def most_profitable_patterns(limit=5):
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT symbol, COUNT(*) AS wins, AVG(return_pct) AS avg_win "
            "FROM trades WHERE status='CLOSED' AND was_profitable=1 "
            "GROUP BY symbol ORDER BY avg_win DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {
            "symbol": r["symbol"],
            "wins": r["wins"],
            "avg_win_pct": round(r["avg_win"] or 0.0, 2),
        }
        for r in rows
    ]
