"""Historical backtest engine.

Replays daily bars over a window and runs the same feature/ML pipeline the live
agent uses, so the database fills with realistic trades the ML layer can learn
from. To keep backtests fast and free, the *decision* here is a transparent
rule + ML scoring policy rather than a Claude API call per bar (Claude drives
the live loop). Exits are simulated against stop-loss / take-profit on each
subsequent bar.

The backtest writes into a fresh copy of the database so it never corrupts the
live paper-trading book.
"""

from datetime import datetime, timezone

import config
import db
import portfolio
import risk_manager
from ml import feature_engineer, predictor, trainer
from memory import trade_memory

try:
    import yfinance as yf
except Exception:  # pragma: no cover
    yf = None


def _score(indicators, ml_prob, sentiment_score=0.0):
    score = 50.0
    if indicators["rsi"] < 35:
        score += 18
    elif indicators["rsi"] > 70:
        score -= 18
    if indicators["macd_histogram"] > 0:
        score += 10
    if indicators["price"] > indicators["sma50"]:
        score += 8
    if indicators["volume_ratio"] > 1.5:
        score += 6
    score = 0.5 * score + 0.4 * ml_prob + 0.1 * ((sentiment_score + 1) / 2 * 100)
    return score


def run_backtest(symbols=None, period="2y", reset=True, min_score=62, verbose=True):
    """Run a backtest over the watchlist. Returns a summary dict."""
    if yf is None:
        return {"error": "yfinance unavailable; cannot backtest."}

    symbols = symbols or config.WATCHLIST
    if reset:
        db.reset_db()

    histories = {}
    for sym in symbols:
        try:
            df = yf.Ticker(sym).history(period=period, interval="1d")
            if df is not None and not df.empty and len(df) > 220:
                histories[sym] = df.reset_index()
        except Exception:
            continue

    if not histories:
        return {"error": "No historical data fetched."}

    # Neutral market context for backtest features (kept simple & consistent).
    market = {"spy_trend_numeric": 0, "vix_level": 18.0, "vix_change_today": 0.0,
              "market_breadth_score": 0.5}

    total_bars = min(len(df) for df in histories.values())
    placed = 0

    # Walk forward; warm-up of 200 bars for SMA200.
    for i in range(200, total_bars - 11):
        for sym, df in histories.items():
            window = df.iloc[: i + 1].rename(
                columns={"Open": "Open", "High": "High", "Low": "Low",
                         "Close": "Close", "Volume": "Volume"}
            )
            try:
                ind = feature_engineer.compute_indicators(window)
            except Exception:
                continue

            entry = ind["price"]
            feats = feature_engineer.build_feature_dict(ind, market, {"sentiment_score": 0.0})
            ml = predictor.predict(sym, feats)
            score = _score(ind, ml["probability"])

            if score < min_score:
                continue
            if portfolio.get_open_position(sym):
                continue
            if portfolio.open_count() >= config.MAX_POSITIONS:
                continue

            stop, target = risk_manager.default_stop_and_target(entry, "BUY")
            equity = portfolio.total_value({})
            shares = risk_manager.calculate_position_size(entry, stop, equity)
            if shares <= 0:
                continue

            tid = portfolio.open_position(
                symbol=sym, action="BUY", quantity=shares, entry_price=entry,
                stop_loss=stop, take_profit=target,
                reasoning=f"[backtest] score {score:.1f}, ml {ml['probability']}%",
                confidence=score, ml_prediction=ml["probability"],
            )
            feature_engineer.save_features(tid, feats)
            placed += 1

            # Simulate the next up-to-10 bars for an exit.
            exit_price, hit_stop, hit_target = entry, False, False
            for j in range(i + 1, min(i + 11, len(df))):
                hi = float(df.iloc[j]["High"])
                lo = float(df.iloc[j]["Low"])
                if lo <= stop:
                    exit_price, hit_stop = stop, True
                    break
                if hi >= target:
                    exit_price, hit_target = target, True
                    break
                exit_price = float(df.iloc[j]["Close"])
            closed = portfolio.close_position(tid, exit_price, hit_stop, hit_target)
            if closed:
                trade_memory.record_trade_lesson(closed)

    # Train on the generated history.
    train_result = trainer.train_general_model()
    predictor.clear_cache()
    metrics = portfolio.performance_metrics()

    summary = {
        "symbols": list(histories.keys()),
        "bars_per_symbol": total_bars,
        "trades_placed": placed,
        "performance": metrics,
        "final_value": round(portfolio.total_value({}), 2),
        "model_training": train_result,
    }
    if verbose:
        print("\n===== BACKTEST SUMMARY =====")
        print(f"Symbols: {', '.join(summary['symbols'])}")
        print(f"Trades placed: {placed}")
        print(f"Win rate: {metrics['win_rate']}% | Avg return: {metrics['avg_return']}% "
              f"| Sharpe: {metrics['sharpe']} | Max DD: {metrics['max_drawdown']}%")
        print(f"Final portfolio value: ${summary['final_value']:,.2f}")
        if train_result.get("trained"):
            print(f"Model trained: acc {train_result['accuracy']:.0%}, "
                  f"v{train_result['version']} on {train_result['n_samples']} samples")
        else:
            print(f"Model training: {train_result.get('reason')}")
    return summary
