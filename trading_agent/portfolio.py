"""Portfolio tracker.

Tracks cash, open positions and realised history on top of the SQLite store.
All position rows live in the ``trades`` table: an OPEN trade is one with no
exit yet, a CLOSED trade has exit price/time and a realised return.

This module deliberately knows nothing about *why* a trade was made — it just
keeps the books. Pricing for unrealised P&L is injected by the caller (the
tools layer) so the portfolio has no direct market-data dependency.
"""

import math
from datetime import datetime, timezone

import db


def _now():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Cash
# ---------------------------------------------------------------------------
def get_cash():
    with db.get_conn() as conn:
        row = conn.execute("SELECT cash FROM account WHERE id = 1").fetchone()
        return float(row["cash"]) if row else 0.0


def get_starting_capital():
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT starting_capital FROM account WHERE id = 1"
        ).fetchone()
        return float(row["starting_capital"]) if row else 0.0


def _adjust_cash(conn, delta):
    conn.execute("UPDATE account SET cash = cash + ? WHERE id = 1", (delta,))


# ---------------------------------------------------------------------------
# Positions
# ---------------------------------------------------------------------------
def get_open_positions():
    """Return a list of open positions as dicts."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM trades WHERE status = 'OPEN' ORDER BY entry_time"
        ).fetchall()
        return [dict(r) for r in rows]

def get_open_position(symbol):
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM trades WHERE status = 'OPEN' AND symbol = ? LIMIT 1",
            (symbol,),
        ).fetchone()
        return dict(row) if row else None


def open_count():
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM trades WHERE status = 'OPEN'"
        ).fetchone()
        return int(row["c"])


def open_position(symbol, action, quantity, entry_price, stop_loss,
                  take_profit, reasoning, confidence, ml_prediction):
    """Record a new open position and debit cash. Returns the trade id."""
    cost = quantity * entry_price
    with db.transaction() as conn:
        cur = conn.execute(
            """
            INSERT INTO trades (
                symbol, action, quantity, entry_price, entry_time,
                stop_loss, take_profit, reasoning, confidence_score,
                ml_prediction, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
            """,
            (
                symbol, action, quantity, entry_price, _now(),
                stop_loss, take_profit, reasoning, confidence, ml_prediction,
            ),
        )
        # A BUY (long) spends cash; a SELL (short) frees margin but we model it
        # simply by also reserving the notional so risk stays bounded.
        _adjust_cash(conn, -cost)
        return cur.lastrowid


def close_position(trade_id, exit_price, hit_stop=False, hit_target=False):
    """Close an open position, credit cash and record the realised return."""
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT * FROM trades WHERE id = ? AND status = 'OPEN'", (trade_id,)
        ).fetchone()
        if row is None:
            return None
        row = dict(row)

        qty = row["quantity"]
        entry = row["entry_price"]
        if row["action"] == "BUY":
            return_pct = (exit_price - entry) / entry if entry else 0.0
            proceeds = qty * exit_price
        else:  # short
            return_pct = (entry - exit_price) / entry if entry else 0.0
            proceeds = qty * entry + (entry - exit_price) * qty

        was_profitable = 1 if return_pct > 0 else 0
        conn.execute(
            """
            UPDATE trades
               SET exit_price = ?, exit_time = ?, return_pct = ?,
                   was_profitable = ?, hit_stop = ?, hit_target = ?,
                   status = 'CLOSED'
             WHERE id = ?
            """,
            (
                exit_price, _now(), return_pct * 100.0, was_profitable,
                1 if hit_stop else 0, 1 if hit_target else 0, trade_id,
            ),
        )
        _adjust_cash(conn, proceeds)
        row.update(
            exit_price=exit_price,
            return_pct=return_pct * 100.0,
            was_profitable=was_profitable,
            hit_stop=hit_stop,
            hit_target=hit_target,
        )
        return row


# ---------------------------------------------------------------------------
# Valuation & metrics
# ---------------------------------------------------------------------------
def positions_market_value(price_lookup):
    """Sum the current market value of open positions.

    ``price_lookup`` maps symbol -> current price. Missing prices fall back to
    entry price so a data outage never crashes valuation.
    """
    total = 0.0
    for pos in get_open_positions():
        price = price_lookup.get(pos["symbol"]) or pos["entry_price"]
        total += pos["quantity"] * price
    return total


def total_value(price_lookup):
    return get_cash() + positions_market_value(price_lookup)


def unrealized_pnl(price_lookup):
    """Return per-position unrealised P&L dicts."""
    out = []
    for pos in get_open_positions():
        price = price_lookup.get(pos["symbol"]) or pos["entry_price"]
        entry = pos["entry_price"]
        if pos["action"] == "BUY":
            pnl = (price - entry) * pos["quantity"]
            pct = (price - entry) / entry * 100 if entry else 0.0
        else:
            pnl = (entry - price) * pos["quantity"]
            pct = (entry - price) / entry * 100 if entry else 0.0
        out.append(
            {
                "trade_id": pos["id"],
                "symbol": pos["symbol"],
                "action": pos["action"],
                "quantity": pos["quantity"],
                "entry_price": entry,
                "current_price": price,
                "unrealized_pnl": round(pnl, 2),
                "unrealized_pct": round(pct, 2),
            }
        )
    return out


def closed_trades():
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM trades WHERE status = 'CLOSED' ORDER BY exit_time"
        ).fetchall()
        return [dict(r) for r in rows]


def performance_metrics():
    """Win rate, average return, Sharpe ratio and max drawdown on closed trades."""
    trades = closed_trades()
    if not trades:
        return {
            "total_trades": 0,
            "win_rate": 0.0,
            "avg_return": 0.0,
            "sharpe": 0.0,
            "max_drawdown": 0.0,
        }

    returns = [t["return_pct"] for t in trades if t["return_pct"] is not None]
    wins = [r for r in returns if r > 0]
    win_rate = len(wins) / len(returns) * 100 if returns else 0.0
    avg_return = sum(returns) / len(returns) if returns else 0.0

    # Sharpe on per-trade returns (risk-free assumed 0 for paper trading).
    if len(returns) > 1:
        mean = avg_return
        var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
        std = math.sqrt(var)
        sharpe = (mean / std) * math.sqrt(len(returns)) if std else 0.0
    else:
        sharpe = 0.0

    # Equity-curve max drawdown from cumulative compounded returns.
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    for r in returns:
        equity *= 1 + r / 100.0
        peak = max(peak, equity)
        dd = (peak - equity) / peak if peak else 0.0
        max_dd = max(max_dd, dd)

    return {
        "total_trades": len(returns),
        "win_rate": round(win_rate, 1),
        "avg_return": round(avg_return, 2),
        "sharpe": round(sharpe, 2),
        "max_drawdown": round(max_dd * 100, 2),
    }
