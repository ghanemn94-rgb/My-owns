"""Live terminal dashboard rendering.

Renders the boxed status panel printed every agent cycle. Uses colorama for
colour when available and degrades to plain text otherwise. Box padding is
computed from the *visible* width (ANSI colour codes stripped, emoji counted as
double-width) so the borders stay aligned regardless of colouring.
"""

import re
from datetime import datetime

import config
import portfolio
import tools
from ml import evaluator, trainer

try:
    from colorama import Fore, Style, init as _cinit
    _cinit()
    _COLOR = True
except Exception:  # pragma: no cover
    _COLOR = False

    class _Dummy:
        def __getattr__(self, _):
            return ""

    Fore = Style = _Dummy()


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_WIDE_RE = re.compile(r"[\U0001F000-\U0001FAFF☀-➿]")


def _c(text, color):
    return f"{color}{text}{Style.RESET_ALL}" if _COLOR else str(text)


def _vlen(text):
    """Visible display width: strip ANSI codes, count emoji as width 2."""
    plain = _ANSI_RE.sub("", text)
    return len(plain) + len(_WIDE_RE.findall(plain))


def _truncate(text, max_visible):
    """Truncate plain text (no ANSI) to a maximum visible width."""
    if _vlen(text) <= max_visible:
        return text
    return text[: max(0, max_visible - 1)] + "…"


def _arrow(pct):
    if pct is None:
        return "—"
    return "▲" if pct >= 0 else "▼"


def render_dashboard(market, decisions, state, closed_now):
    pstatus = tools.get_portfolio_status()

    spy_pct = market.get("spy_change_pct")
    spy_arrow = _arrow(spy_pct)
    spy_color = Fore.GREEN if (spy_pct or 0) >= 0 else Fore.RED
    vix = market.get("vix_level")
    vix_interp = market.get("vix_interpretation", "").title()

    day_start = state.get("day_start_value") or pstatus["total_value"]
    day_pnl = pstatus["total_value"] - day_start
    pnl_color = Fore.GREEN if day_pnl >= 0 else Fore.RED

    latest = evaluator.latest_training_record()
    closed = trainer.closed_trade_count()
    if latest:
        model_line = f"Trained on {latest['total_predictions']} trades"
        acc_line = f"Accuracy: {latest['accuracy']*100:.0f}% | Version: {latest['model_version']}"
    else:
        model_line = f"Not trained yet ({closed} closed trades)"
        acc_line = "Accuracy: n/a | Version: 0"

    last_decision = state.get("last_decision", "—")
    last_reason = "—"
    for d in decisions:
        if d.get("decision") == "SKIP":
            last_reason = d.get("reasoning", "") or "—"
        last_decision = f"{d['decision']} {d.get('symbol','')}".strip()

    win_rate = pstatus["win_rate"]
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    width = 54
    inner = width - 3  # space available for content after "│ " ... "│"

    def row(text):
        pad = max(0, inner - _vlen(text))
        return "│ " + text + " " * pad + "│"

    bar = "├" + "─" * (width - 2) + "┤"
    last_reason = _truncate(last_reason, inner - len("Reason: "))

    lines = [
        "┌" + "─" * (width - 2) + "┐",
        row(_c(f"🤖 TRADING AGENT - {ts}", Fore.CYAN)),
        bar,
        row(
            f"Market: SPY {_c(spy_arrow, spy_color)} "
            f"{(spy_pct if spy_pct is not None else 0):+.2f}% | "
            f"VIX: {vix} ({vix_interp})"
        ),
        row(
            f"Portfolio: ${pstatus['total_value']:,.0f} | "
            f"Day P&L: {_c(f'{day_pnl:+,.0f}', pnl_color)}"
        ),
        row(
            f"Open: {pstatus['open_count']}/{pstatus['max_positions']} | "
            f"Cash: ${pstatus['cash']:,.0f}"
        ),
        bar,
        row(f"ML Model: {model_line}"),
        row(f"{acc_line}"),
        bar,
        row(f"Last Decision: {last_decision}"),
        row(f"Reason: {last_reason}"),
        bar,
        row(
            f"Today: {state.get('today_trades', 0)} trades | "
            f"Win rate: {win_rate:.0f}%"
        ),
    ]
    if closed_now:
        lines.append(bar)
        for c in closed_now[:3]:
            ret = c.get("return_pct")
            col = Fore.GREEN if (ret or 0) >= 0 else Fore.RED
            lines.append(
                row(_c(f"Closed {c['symbol']} ({c['reason']}) {ret:+.2f}%", col))
            )
    lines.append("└" + "─" * (width - 2) + "┘")
    return "\n".join(lines)
