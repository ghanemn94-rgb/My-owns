"""Context builder.

Assembles the rich "AGENT MEMORY BRIEF" that is handed to Claude before every
decision. It stitches together per-symbol stats, the best historical signal,
recurring mistakes, recent losses and the current ML read into a compact,
readable briefing — the agent's working memory.
"""

from memory import trade_memory, pattern_store


def build_symbol_memory(symbol):
    """Structured memory for a single symbol (used by the get_agent_memory tool)."""
    stats = pattern_store.symbol_stats(symbol)
    best_signal = pattern_store.best_signal_for(symbol)
    best_time = pattern_store.best_time_of_day(symbol)
    holds = pattern_store.hold_time_analysis(symbol)
    mistakes = trade_memory.recent_mistakes(symbol, limit=3)
    recurring = [
        m for m in trade_memory.identify_recurring_mistakes() if m["symbol"] == symbol
    ]

    return {
        "symbol": symbol,
        "stats": stats,
        "best_signal": best_signal,
        "best_time_of_day": best_time,
        "hold_times": holds,
        "recent_mistakes": mistakes,
        "recurring_mistake": recurring[0] if recurring else None,
    }


def build_brief(symbol, ml_prediction, market_context):
    """Produce the human-readable AGENT MEMORY BRIEF string for Claude."""
    mem = build_symbol_memory(symbol)
    stats = mem["stats"]
    lines = ["AGENT MEMORY BRIEF:"]

    if stats["trades"] > 0:
        lines.append(
            f"- {symbol}: {stats['trades']} trades, {stats['win_rate']}% win rate, "
            f"avg return {stats['avg_return']:+.2f}%"
        )
    else:
        lines.append(f"- {symbol}: no prior trades on record (no symbol history yet).")

    if mem["best_signal"] and mem["best_signal"]["trades"] > 0:
        bs = mem["best_signal"]
        lines.append(
            f"- Best signal for {symbol}: {bs['signal']} "
            f"({bs['win_rate']}% win rate over {bs['trades']} trades)"
        )

    if mem["best_time_of_day"]:
        bt = mem["best_time_of_day"]
        lines.append(
            f"- Best time window: {bt['best_window']} ({bt['win_rate']}% win rate)"
        )

    if mem["recurring_mistake"]:
        rm = mem["recurring_mistake"]
        lines.append(
            f"- ⚠ Recurring mistake: {rm['losses']} losses on {symbol} "
            f"(avg {rm['avg_loss_pct']}%). Do not repeat the same setup."
        )

    if mem["hold_times"]["avg_hold_winners_hours"] is not None:
        h = mem["hold_times"]
        lines.append(
            f"- Hold time — winners: {h['avg_hold_winners_hours']}h, "
            f"losers: {h['avg_hold_losers_hours']}h"
        )

    # ML read.
    prob = ml_prediction.get("probability", 50.0)
    conf = ml_prediction.get("confidence", "none")
    lines.append(f"- Current model confidence on this setup: {prob}% ({conf})")
    if ml_prediction.get("historical_accuracy"):
        ha = ml_prediction["historical_accuracy"]
        lines.append(
            f"- Historical accuracy of this signal pattern: "
            f"{ha['win_rate_pct']}% over {ha['sample_size']} trades"
        )

    # Last losses across the book — am I repeating a pattern?
    last_losses = trade_memory.recent_mistakes(limit=3)
    if last_losses:
        joined = "; ".join(
            f"{m['symbol']} {m['return_pct']:.1f}%" for m in last_losses
        )
        lines.append(f"- Last 3 losses (any symbol): {joined}")

    # Top lessons.
    lessons = trade_memory.top_lessons(limit=3)
    if lessons:
        lines.append("- Top lessons learned:")
        for l in lessons:
            lines.append(f"    • [{l['lesson_type']}] {l['description']}")

    # Market regime.
    regime = market_context.get("regime", "unknown")
    lines.append(
        f"- Today's market regime: {regime} "
        f"(SPY {market_context.get('spy_trend', '?')}, "
        f"VIX {market_context.get('vix_level', '?')})"
    )

    return "\n".join(lines)
