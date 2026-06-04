"""Model self-evaluation.

Runs after every N closed trades to check whether the stored ML predictions
actually tracked reality:

  * Did high-confidence predictions beat low-confidence ones?
  * Is overall directional accuracy above the floor?
  * If accuracy drops below the configured threshold, flag for retraining.

Also produces a human-readable weekly performance summary.
"""

from datetime import datetime, timedelta, timezone

import config
import db


ACCURACY_FLOOR = 0.55


def _scored_trades():
    """Closed trades that carried a real ML prediction (not the neutral 50)."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT symbol, ml_prediction, was_profitable, return_pct, exit_time "
            "FROM trades WHERE status='CLOSED' AND ml_prediction IS NOT NULL "
            "AND was_profitable IS NOT NULL"
        ).fetchall()
    return [dict(r) for r in rows]


def evaluate():
    """Compare predictions vs outcomes. Returns a metrics dict."""
    trades = _scored_trades()
    graded = [t for t in trades if abs(t["ml_prediction"] - 50.0) > 1e-6]
    if not graded:
        return {
            "evaluated": False,
            "reason": "No model-scored trades yet.",
            "needs_retrain": False,
        }

    correct = 0
    high_conf_correct = high_conf_total = 0
    low_conf_correct = low_conf_total = 0
    for t in graded:
        predicted_win = t["ml_prediction"] >= 50.0
        actual_win = bool(t["was_profitable"])
        hit = predicted_win == actual_win
        correct += int(hit)
        if abs(t["ml_prediction"] - 50.0) >= 15:
            high_conf_total += 1
            high_conf_correct += int(hit)
        else:
            low_conf_total += 1
            low_conf_correct += int(hit)

    accuracy = correct / len(graded)
    high_acc = high_conf_correct / high_conf_total if high_conf_total else None
    low_acc = low_conf_correct / low_conf_total if low_conf_total else None

    result = {
        "evaluated": True,
        "sample_size": len(graded),
        "accuracy": round(accuracy, 3),
        "high_confidence_accuracy": round(high_acc, 3) if high_acc is not None else None,
        "low_confidence_accuracy": round(low_acc, 3) if low_acc is not None else None,
        "confidence_is_calibrated": (
            high_acc is not None and low_acc is not None and high_acc > low_acc
        ),
        "needs_retrain": accuracy < ACCURACY_FLOOR,
    }
    return result


def maybe_evaluate():
    """Evaluate on the configured cadence."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM trades WHERE status='CLOSED'"
        ).fetchone()
    count = int(row["c"])
    if count > 0 and count % config.EVALUATE_EVERY_N_TRADES == 0:
        return evaluate()
    return {"evaluated": False, "reason": "Not at evaluation cadence."}


def latest_training_record():
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM model_performance ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def weekly_report():
    """Build a human-readable weekly model-performance summary."""
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM model_performance WHERE date >= ? ORDER BY date",
            (since,),
        ).fetchall()
    training_runs = [dict(r) for r in rows]
    evaluation = evaluate()
    latest = latest_training_record()

    lines = ["===== WEEKLY MODEL PERFORMANCE REPORT ====="]
    if latest:
        lines.append(
            f"Latest model: v{latest['model_version']} | "
            f"train accuracy {latest['accuracy']:.0%} | "
            f"precision {latest['precision_score']:.0%} | "
            f"recall {latest['recall']:.0%}"
        )
    else:
        lines.append("No model trained yet.")

    if evaluation.get("evaluated"):
        lines.append(
            f"Live accuracy on {evaluation['sample_size']} scored trades: "
            f"{evaluation['accuracy']:.0%}"
        )
        if evaluation["high_confidence_accuracy"] is not None:
            lines.append(
                f"High-confidence accuracy: {evaluation['high_confidence_accuracy']:.0%} "
                f"| Low-confidence: {evaluation['low_confidence_accuracy']:.0%} "
                f"| Calibrated: {evaluation['confidence_is_calibrated']}"
            )
        if evaluation["needs_retrain"]:
            lines.append("⚠ Accuracy below floor — retraining recommended.")
    else:
        lines.append("Live evaluation: not enough scored trades yet.")

    lines.append(f"Training runs in last 7 days: {len(training_runs)}")
    return "\n".join(lines)
