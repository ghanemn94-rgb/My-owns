"""Risk management engine.

Enforces the hard rules that Claude is never allowed to override:
  * max 2% portfolio risk per trade
  * max N open positions
  * no new trades once intraday drawdown exceeds the configured limit
  * VIX-based position-size scaling

Position sizing is risk-based: shares are derived from the dollar amount we are
willing to lose (``MAX_RISK_PER_TRADE`` of equity) divided by the per-share
stop distance, so a wider stop automatically means a smaller position.
"""

import math

import config
import portfolio


def vix_size_multiplier(vix_level):
    """Scale position sizes down in high-fear regimes."""
    if vix_level is None:
        return 1.0
    if vix_level > config.VIX_HIGH:
        return 0.5
    if vix_level > config.VIX_MEDIUM:
        return 0.75
    return 1.0


def calculate_position_size(entry_price, stop_loss, equity, vix_level=None):
    """Return the number of shares to trade under the 2% risk rule.

    Risk dollars = equity * MAX_RISK_PER_TRADE, scaled by the VIX multiplier.
    Shares = risk_dollars / per-share stop distance, then capped so the
    notional never exceeds available cash.
    """
    if entry_price <= 0 or stop_loss <= 0:
        return 0

    per_share_risk = abs(entry_price - stop_loss)
    if per_share_risk <= 0:
        # Degenerate stop -> fall back to the default stop distance.
        per_share_risk = entry_price * config.STOP_LOSS_DEFAULT

    risk_dollars = equity * config.MAX_RISK_PER_TRADE * vix_size_multiplier(vix_level)
    shares = math.floor(risk_dollars / per_share_risk)

    # Never spend more cash than we have.
    cash = portfolio.get_cash()
    max_affordable = math.floor(cash / entry_price) if entry_price else 0
    shares = min(shares, max_affordable)
    return max(shares, 0)


def default_stop_and_target(entry_price, action):
    """Default stop-loss / take-profit prices around an entry."""
    if action == "BUY":
        stop = entry_price * (1 - config.STOP_LOSS_DEFAULT)
        target = entry_price * (1 + config.TAKE_PROFIT_DEFAULT)
    else:  # short
        stop = entry_price * (1 + config.STOP_LOSS_DEFAULT)
        target = entry_price * (1 - config.TAKE_PROFIT_DEFAULT)
    return round(stop, 2), round(target, 2)


def daily_drawdown(price_lookup, day_start_value):
    """Fraction down from the value at the start of the day (0..1, positive)."""
    if not day_start_value:
        return 0.0
    current = portfolio.total_value(price_lookup)
    dd = (day_start_value - current) / day_start_value
    return max(dd, 0.0)


def check_trade_allowed(action, entry_price, stop_loss, shares,
                        price_lookup, day_start_value, vix_level=None):
    """Validate a proposed trade against every hard rule.

    Returns ``(allowed: bool, reasons: list[str])``. ``reasons`` always
    explains the decision so the agent can log *why* a trade was blocked.
    """
    reasons = []
    allowed = True

    # 1. Position count cap.
    if portfolio.open_count() >= config.MAX_POSITIONS:
        allowed = False
        reasons.append(
            f"Max positions reached ({config.MAX_POSITIONS}); no new trades."
        )

    # 2. Intraday drawdown halt.
    dd = daily_drawdown(price_lookup, day_start_value)
    if dd > config.MAX_DAILY_DRAWDOWN:
        allowed = False
        reasons.append(
            f"Daily drawdown {dd*100:.1f}% exceeds limit "
            f"{config.MAX_DAILY_DRAWDOWN*100:.0f}%; trading halted."
        )

    # 3. Valid size.
    if shares <= 0:
        allowed = False
        reasons.append("Calculated position size is zero (insufficient cash/risk).")

    # 4. 2% risk cap — verify the *actual* risk of the sized trade.
    if shares > 0 and entry_price > 0:
        per_share_risk = abs(entry_price - stop_loss) or (
            entry_price * config.STOP_LOSS_DEFAULT
        )
        risk_dollars = per_share_risk * shares
        equity = portfolio.total_value(price_lookup)
        risk_fraction = risk_dollars / equity if equity else 1.0
        # Allow a tiny tolerance for rounding shares.
        if risk_fraction > config.MAX_RISK_PER_TRADE + 1e-4:
            allowed = False
            reasons.append(
                f"Trade risk {risk_fraction*100:.2f}% exceeds the "
                f"{config.MAX_RISK_PER_TRADE*100:.0f}% per-trade cap."
            )

    # 5. Affordability for longs.
    if action == "BUY":
        cost = shares * entry_price
        if cost > portfolio.get_cash() + 1e-6:
            allowed = False
            reasons.append("Insufficient cash for this long position.")

    if allowed:
        reasons.append("All risk checks passed.")
    return allowed, reasons
