"""Real-time ML predictions.

Loads the latest trained model (symbol-specific if available, otherwise the
general model) and scores the current opportunity. If no model has been trained
yet, returns a neutral 50% so the agent degrades gracefully on a cold start.

The output feeds Claude as *additional context only* — per the project rules,
the model never makes the decision itself.
"""

import json
import os

import joblib
import numpy as np

import config
import db
from ml import feature_engineer


_cache = {"general": None, "symbol": {}}


def _load_general():
    if _cache["general"] is None and os.path.exists(config.GENERAL_MODEL_PATH):
        _cache["general"] = joblib.load(config.GENERAL_MODEL_PATH)
    return _cache["general"]


def _load_symbol(symbol):
    if symbol not in _cache["symbol"]:
        path = config.SYMBOL_MODEL_PATH.format(symbol=symbol)
        _cache["symbol"][symbol] = joblib.load(path) if os.path.exists(path) else None
    return _cache["symbol"][symbol]


def clear_cache():
    """Force models to reload (call after retraining)."""
    _cache["general"] = None
    _cache["symbol"] = {}


def _top_features(model, vector, n=3):
    """Approximate the features that drove this prediction: importance * |z|."""
    if not hasattr(model, "feature_importances_"):
        return []
    importances = model.feature_importances_
    arr = np.array(vector, dtype=float)
    # Standardise loosely so large-magnitude raw values don't dominate.
    contributions = importances * (np.abs(arr) + 1e-6)
    order = np.argsort(contributions)[::-1][:n]
    return [
        {
            "feature": db.FEATURE_COLUMNS[i],
            "value": round(float(arr[i]), 4),
            "importance": round(float(importances[i]), 4),
        }
        for i in order
    ]


def _historical_accuracy_for_pattern(symbol):
    """Win rate of past closed trades on this symbol — a proxy for how reliable
    this signal pattern has been historically."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT AVG(was_profitable) AS wr, COUNT(*) AS c "
            "FROM trades WHERE status='CLOSED' AND symbol=?",
            (symbol,),
        ).fetchone()
    if row and row["c"]:
        return round((row["wr"] or 0.0) * 100, 1), int(row["c"])
    return None, 0


def predict(symbol, feature_dict):
    """Return a prediction dict for Claude.

    Keys: probability (0-100), confidence (low/medium/high), model_used,
    top_features, historical_accuracy.
    """
    vector = feature_engineer.to_vector(feature_dict)

    model = _load_symbol(symbol)
    model_used = f"symbol:{symbol}"
    if model is None:
        model = _load_general()
        model_used = "general"

    if model is None:
        return {
            "probability": 50.0,
            "confidence": "none",
            "model_used": "none (cold start)",
            "top_features": [],
            "historical_accuracy": None,
            "note": "No model trained yet; returning neutral 50%.",
        }

    try:
        proba = model.predict_proba(np.array(vector).reshape(1, -1))[0]
        classes = list(model.classes_)
        prob_profit = proba[classes.index(1)] if 1 in classes else 0.5
    except Exception as exc:  # malformed model / feature drift
        return {
            "probability": 50.0,
            "confidence": "none",
            "model_used": "error",
            "top_features": [],
            "historical_accuracy": None,
            "note": f"Prediction failed, defaulting to 50%: {exc}",
        }

    probability = round(float(prob_profit) * 100, 1)
    distance = abs(probability - 50)
    if distance >= 20:
        confidence = "high"
    elif distance >= 10:
        confidence = "medium"
    else:
        confidence = "low"

    hist_wr, hist_n = _historical_accuracy_for_pattern(symbol)
    return {
        "probability": probability,
        "confidence": confidence,
        "model_used": model_used,
        "top_features": _top_features(model, vector),
        "historical_accuracy": (
            {"win_rate_pct": hist_wr, "sample_size": hist_n} if hist_n else None
        ),
    }
