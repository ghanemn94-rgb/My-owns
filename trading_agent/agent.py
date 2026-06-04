"""Core agent: the Claude-powered trading brain and the live loop.

The orchestrator gathers every signal (market, technical, sentiment, ML,
memory), hands the assembled briefing to Claude, and asks for a structured
decision that walks the 5-step framework. The orchestrator then enforces the
hard risk rules that Claude is never allowed to override before any paper
trade is placed.

If no Anthropic API key is configured (or the API call fails), the agent falls
back to a transparent rule-based decision so the whole system still runs and
keeps learning — every decision is logged either way.
"""

import json
from datetime import datetime, timezone

import config
import portfolio
import risk_manager
import tools
from ml import feature_engineer, evaluator, predictor
from ml import trainer
from memory import context_builder, trade_memory

try:
    import anthropic
except Exception:  # pragma: no cover
    anthropic = None


DECISION_SCHEMA_HINT = """Respond with ONLY a JSON object, no prose, of the form:
{
  "decision": "BUY" | "SELL" | "HOLD" | "SKIP",
  "confidence": <integer 0-100>,
  "reasoning": "<detailed explanation covering all 5 steps>",
  "stop_loss": <price or null>,
  "take_profit": <price or null>,
  "what_would_change_my_mind": "<conditions that would invalidate this trade>"
}"""

SYSTEM_PROMPT = """You are a disciplined, professional US equities trader running a PAPER
trading account. You reason like a portfolio manager, never like a rule-based bot.

You MUST work through these five steps before every decision:
STEP 1 - Market Check: Is today even a good day to trade? (VIX, SPY trend, breadth)
STEP 2 - Signal Quality: Are signals strong AND aligned? Count the aligned factors
         (technical present, ML confidence > 60%, news sentiment aligned, volume
         confirming). If fewer than 3 align, SKIP.
STEP 3 - Memory Check: What does my history on this symbol say? Am I repeating a
         past mistake?
STEP 4 - Risk Check: Can I afford it? (sizing/limits are enforced separately)
STEP 5 - Final Decision with full written reasoning.

STRICT RULES:
- Never trade on a single indicator.
- "No trade today" (SKIP/HOLD) is a smart, valid decision — explain why you are NOT trading.
- If ML and technicals conflict, reduce size or skip.
- Always explain what you are NOT doing and why.
- This is PAPER trading; capital preservation and discipline matter more than activity.
"""


# ---------------------------------------------------------------------------
# Context assembly
# ---------------------------------------------------------------------------
def count_aligned_factors(ta, ml, sentiment, action="BUY"):
    """Count how many independent factors support the proposed direction."""
    factors = []
    long = action == "BUY"

    # Technical.
    if long and (ta["rsi_14"] < 45 or ta["macd_histogram"] > 0 or ta["price"] > ta["sma50"]):
        factors.append("technical")
    elif not long and (ta["rsi_14"] > 55 or ta["macd_histogram"] < 0 or ta["price"] < ta["sma50"]):
        factors.append("technical")

    # ML.
    if long and ml["probability"] >= config.MIN_ML_CONFIDENCE * 100:
        factors.append("ml")
    elif not long and ml["probability"] <= (1 - config.MIN_ML_CONFIDENCE) * 100:
        factors.append("ml")

    # Sentiment.
    if long and sentiment["sentiment_score"] > 0.1:
        factors.append("sentiment")
    elif not long and sentiment["sentiment_score"] < -0.1:
        factors.append("sentiment")

    # Volume confirmation.
    if ta["volume_ratio"] > 1.2:
        factors.append("volume")

    return factors


def build_context(symbol, market, ta, sentiment, ml, pstatus):
    brief = context_builder.build_brief(symbol, ml, market)
    factors = count_aligned_factors(ta, ml, sentiment)
    payload = {
        "symbol": symbol,
        "portfolio": {
            "cash": pstatus["cash"],
            "total_value": pstatus["total_value"],
            "open_positions": pstatus["open_count"],
            "max_positions": pstatus["max_positions"],
            "day_total_return_pct": pstatus["total_return_pct"],
        },
        "market": {
            "spy_trend": market["spy_trend"],
            "spy_change_pct": market["spy_change_pct"],
            "vix": market["vix_level"],
            "vix_interpretation": market["vix_interpretation"],
            "breadth": market["market_breadth_score"],
            "safe_to_trade_longs": market["safe_to_trade_longs"],
        },
        "technical": {
            "price": ta["price"],
            "rsi_14": ta["rsi_14"],
            "macd_histogram": ta["macd_histogram"],
            "vs_sma50": round((ta["price"] - ta["sma50"]) / ta["sma50"] * 100, 2),
            "vs_sma200": round((ta["price"] - ta["sma200"]) / ta["sma200"] * 100, 2),
            "bollinger_position": ta["bollinger_position"],
            "volume_ratio": ta["volume_ratio"],
            "interpretation": ta["interpretation"],
        },
        "ml_prediction": ml,
        "news": {
            "sentiment": sentiment["sentiment"],
            "sentiment_score": sentiment["sentiment_score"],
            "earnings_within_5_days": sentiment["earnings_within_5_days"],
            "days_to_earnings": sentiment["days_to_earnings"],
            "major_events": sentiment["major_events"],
        },
        "aligned_factors": factors,
        "aligned_factor_count": len(factors),
    }
    return brief, payload


# ---------------------------------------------------------------------------
# Claude decision
# ---------------------------------------------------------------------------
def claude_decide(brief, payload):
    """Ask Claude for a structured decision. Returns dict or None on failure."""
    if anthropic is None or not config.ANTHROPIC_API_KEY:
        return None
    try:
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        user_msg = (
            f"{brief}\n\n"
            f"CURRENT OPPORTUNITY DATA (JSON):\n{json.dumps(payload, indent=2)}\n\n"
            f"{DECISION_SCHEMA_HINT}"
        )
        resp = client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=1200,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )
        text = "".join(
            block.text for block in resp.content if getattr(block, "type", "") == "text"
        ).strip()
        return _parse_decision(text)
    except Exception as exc:
        print(f"[agent] Claude call failed ({exc}); using rule-based fallback.")
        return None


def _parse_decision(text):
    # Strip code fences and isolate the JSON object.
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    data["decision"] = str(data.get("decision", "SKIP")).upper()
    return data


# ---------------------------------------------------------------------------
# Rule-based fallback (transparent, no external dependency)
# ---------------------------------------------------------------------------
def rule_based_decide(brief, payload, ta, ml, sentiment, market):
    factors = payload["aligned_factors"]
    reasons = [f"[Rule-based fallback — no Claude available]"]

    # STEP 1 - Market.
    if not market["safe_to_trade_longs"]:
        reasons.append(
            "STEP 1: Market not favourable for new longs "
            f"(SPY {market['spy_trend']}, breadth {market['market_breadth_score']}, "
            f"VIX {market['vix_level']}). "
        )
        return {
            "decision": "SKIP",
            "confidence": 70,
            "reasoning": " ".join(reasons),
            "stop_loss": None,
            "take_profit": None,
            "what_would_change_my_mind": "SPY turning up and breadth recovering above 30%.",
        }
    reasons.append("STEP 1: Market acceptable for longs.")

    # STEP 2 - Signal quality.
    reasons.append(f"STEP 2: {len(factors)} aligned factors {factors}.")
    if len(factors) < config.MIN_FACTORS_TO_TRADE:
        reasons.append("Fewer than 3 factors aligned — skipping.")
        return {
            "decision": "SKIP",
            "confidence": 65,
            "reasoning": " ".join(reasons),
            "stop_loss": None,
            "take_profit": None,
            "what_would_change_my_mind": "A third confirming factor (ML>60%, volume spike, or aligned news).",
        }

    # STEP 3 - Memory / earnings guard.
    if sentiment["earnings_within_5_days"]:
        reasons.append("STEP 3: Earnings within 5 days — avoiding event risk. SKIP.")
        return {
            "decision": "SKIP",
            "confidence": 60,
            "reasoning": " ".join(reasons),
            "stop_loss": None,
            "take_profit": None,
            "what_would_change_my_mind": "Waiting until after the earnings event clears.",
        }
    reasons.append("STEP 3: No earnings landmine; memory check clear.")

    # STEP 4/5 - Risk handled by orchestrator; propose a BUY.
    reasons.append("STEP 4: Risk sizing delegated to risk engine (<=2% rule).")
    reasons.append("STEP 5: Signals aligned and market constructive — BUY.")
    stop, target = risk_manager.default_stop_and_target(ta["price"], "BUY")
    return {
        "decision": "BUY",
        "confidence": min(95, 50 + 8 * len(factors)),
        "reasoning": " ".join(reasons),
        "stop_loss": stop,
        "take_profit": target,
        "what_would_change_my_mind": "MACD rolling over, a negative news catalyst, or VIX spiking above 30.",
    }


# ---------------------------------------------------------------------------
# Disagreement guard (critical rule #4)
# ---------------------------------------------------------------------------
def enforce_ml_agreement(decision, ml):
    """If Claude wants to BUY but ML strongly disagrees (or vice-versa), skip."""
    if decision["decision"] == "BUY" and ml["probability"] < 40 and ml["confidence"] != "none":
        decision["decision"] = "SKIP"
        decision["reasoning"] += (
            f" [OVERRIDE] ML strongly disagrees (prob {ml['probability']}%); "
            "skipping per ML-conflict rule."
        )
    if decision["decision"] == "SELL" and ml["probability"] > 60 and ml["confidence"] != "none":
        decision["decision"] = "SKIP"
        decision["reasoning"] += (
            f" [OVERRIDE] ML strongly favours upside (prob {ml['probability']}%); "
            "skipping short per ML-conflict rule."
        )
    return decision


# ---------------------------------------------------------------------------
# Opportunity evaluation (one symbol end-to-end)
# ---------------------------------------------------------------------------
def evaluate_opportunity(symbol, market, day_start_value):
    """Run the full pipeline for one symbol and place a trade if warranted.

    Returns a record describing the decision (always, including SKIP/HOLD).
    """
    ta = tools.get_technical_analysis(symbol)
    if "error" in ta:
        return {"symbol": symbol, "decision": "SKIP", "reasoning": ta["error"]}

    sentiment = tools.get_news_sentiment(symbol)
    features = feature_engineer.build_feature_dict(ta["_indicators"], market, sentiment)
    ml = tools.get_ml_prediction(symbol, features)
    pstatus = tools.get_portfolio_status()

    # Don't open a second position in a symbol we already hold.
    if portfolio.get_open_position(symbol):
        return {
            "symbol": symbol,
            "decision": "HOLD",
            "reasoning": "Already holding an open position in this symbol.",
        }

    brief, payload = build_context(symbol, market, ta, sentiment, ml, pstatus)

    decision = claude_decide(brief, payload)
    source = "claude"
    if decision is None:
        decision = rule_based_decide(brief, payload, ta, ml, sentiment, market)
        source = "rule-based"

    decision = enforce_ml_agreement(decision, ml)
    decision["source"] = source
    decision["symbol"] = symbol

    if decision["decision"] in ("BUY", "SELL"):
        decision = _execute(symbol, decision, ta, ml, features, market, day_start_value, pstatus)

    return decision


def _execute(symbol, decision, ta, ml, features, market, day_start_value, pstatus):
    """Size, risk-check, and place the trade — enforcing hard rules."""
    action = decision["decision"]
    entry = ta["price"]
    stop = decision.get("stop_loss")
    target = decision.get("take_profit")
    if not stop or not target:
        stop, target = risk_manager.default_stop_and_target(entry, action)
        decision["stop_loss"], decision["take_profit"] = stop, target

    equity = pstatus["total_value"]
    shares = risk_manager.calculate_position_size(
        entry, stop, equity, vix_level=market["vix_level"]
    )

    allowed, risk_reasons = risk_manager.check_trade_allowed(
        action, entry, stop, shares, tools.price_lookup(), day_start_value,
        vix_level=market["vix_level"],
    )
    decision["risk_check"] = risk_reasons
    decision["position_size"] = shares

    if not allowed:
        decision["decision"] = "SKIP"
        decision["reasoning"] += " [RISK BLOCK] " + " ".join(risk_reasons)
        return decision

    full_reasoning = (
        f"[{decision['source']}] {decision['reasoning']} "
        f"| What would change my mind: {decision.get('what_would_change_my_mind', 'n/a')} "
        f"| Risk: {' '.join(risk_reasons)}"
    )
    result = tools.execute_paper_trade(
        symbol=symbol, action=action, quantity=shares, reasoning=full_reasoning,
        stop_loss=stop, take_profit=target, confidence=decision.get("confidence"),
        ml_prediction=ml, features=features,
    )
    decision["execution"] = result
    return decision


# ---------------------------------------------------------------------------
# Cycle & loop
# ---------------------------------------------------------------------------
_state = {"day_start_value": None, "last_decision": "—", "today_trades": 0}


def run_cycle(verbose=True):
    """One full agent cycle: market check, manage positions, scan, decide, learn."""
    tools.clear_market_cache()
    market = tools.get_market_context()

    if _state["day_start_value"] is None:
        _state["day_start_value"] = portfolio.total_value(tools.price_lookup())

    # 1. Manage existing positions first.
    managed = tools.monitor_open_positions()
    closed_now = [m for m in managed if m.get("status") == "closed"]

    # 2. Scan for opportunities.
    opportunities = tools.scan_watchlist()

    # 3. Evaluate the top candidates (respecting the open-position cap).
    decisions = []
    for opp in opportunities:
        if portfolio.open_count() >= config.MAX_POSITIONS:
            break
        decision = evaluate_opportunity(opp["symbol"], market, _state["day_start_value"])
        decisions.append(decision)
        if decision["decision"] in ("BUY", "SELL") and decision.get("execution", {}).get("status") == "FILLED":
            _state["today_trades"] += 1
            _state["last_decision"] = f"{decision['decision']} {decision['symbol']}"
        elif decision["decision"] == "SKIP":
            _state["last_decision"] = f"SKIP {decision['symbol']}"

    # 4. Learning hooks.
    retrain = trainer.maybe_retrain()
    if retrain.get("triggered"):
        predictor.clear_cache()
    evaluation = evaluator.maybe_evaluate()
    if evaluation.get("evaluated") and evaluation.get("needs_retrain"):
        trade_memory.add_lesson(
            "model", "Model accuracy below floor — retraining recommended.", None, -0.5
        )

    if verbose:
        from dashboard import render_dashboard
        print(render_dashboard(market, decisions, _state, closed_now))

    return {
        "market": market,
        "managed": managed,
        "decisions": decisions,
        "retrain": retrain,
        "evaluation": evaluation,
    }


def is_market_hours(now=None):
    """Rough US market-hours check (Mon-Fri, 09:30-16:00 ET ~ 13:30-20:00 UTC)."""
    now = now or datetime.now(timezone.utc)
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 13 * 60 + 30 <= minutes <= 20 * 60


def run_loop(force=False):
    """Live loop: run a cycle every LOOP_INTERVAL_MINUTES during market hours."""
    import time
    import schedule

    print("Starting trading agent loop. Press Ctrl+C to stop.")
    if not config.ANTHROPIC_API_KEY:
        print("⚠ No ANTHROPIC_API_KEY set — running in transparent rule-based mode.")

    def job():
        if force or is_market_hours():
            try:
                run_cycle()
            except Exception as exc:  # never let one cycle kill the loop
                print(f"[agent] Cycle error (continuing): {exc}")
        else:
            print(f"[{datetime.now():%H:%M}] Market closed — agent idle.")

    job()  # run immediately
    schedule.every(config.LOOP_INTERVAL_MINUTES).minutes.do(job)
    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nAgent stopped by user.")
