"""Model training.

Trains a RandomForest classifier to predict whether a trade will be
profitable, using the feature rows captured at decision time joined to the
realised outcome of each closed trade.

  * General model:  trained on all closed trades (cadence = every N trades).
  * Symbol models:  trained per symbol once a symbol has enough history; these
                    override the general model for that specific stock.

Models, feature importances and a running version counter are persisted to the
``models/`` directory and the ``model_performance`` table.
"""

import json
import os
from datetime import datetime, timezone

import joblib
import numpy as np

import config
import db


def _load_dataset(symbol=None):
    """Return (X, y) numpy arrays from closed trades with stored features."""
    query = (
        "SELECT t.was_profitable AS y, f.* "
        "FROM trades t JOIN features f ON f.trade_id = t.id "
        "WHERE t.status = 'CLOSED' AND t.was_profitable IS NOT NULL"
    )
    params = ()
    if symbol:
        query += " AND t.symbol = ?"
        params = (symbol,)

    with db.get_conn() as conn:
        rows = [dict(r) for r in conn.execute(query, params).fetchall()]

    if not rows:
        return np.empty((0, len(db.FEATURE_COLUMNS))), np.empty((0,))

    X = np.array([[r[c] for c in db.FEATURE_COLUMNS] for r in rows], dtype=float)
    y = np.array([int(r["y"]) for r in rows], dtype=int)
    return X, y


def _version():
    """Increment-style version = number of general training runs so far + 1."""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT MAX(model_version) AS v FROM model_performance"
        ).fetchone()
    return (row["v"] or 0) + 1


def train_general_model():
    """Train the all-symbols model. Returns a metrics dict (or a reason)."""
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, precision_score, recall_score

    X, y = _load_dataset()
    if len(y) < 10 or len(set(y)) < 2:
        return {
            "trained": False,
            "reason": f"Need >=10 closed trades with both outcomes; have {len(y)}.",
        }

    stratify = y if len(set(y)) == 2 and np.bincount(y).min() >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=stratify
    )

    model = RandomForestClassifier(
        n_estimators=200, max_depth=6, min_samples_leaf=3,
        class_weight="balanced", random_state=42,
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    metrics = {
        "trained": True,
        "version": _version(),
        "n_samples": int(len(y)),
        "accuracy": float(accuracy_score(y_test, preds)),
        "precision": float(precision_score(y_test, preds, zero_division=0)),
        "recall": float(recall_score(y_test, preds, zero_division=0)),
    }

    joblib.dump(model, config.GENERAL_MODEL_PATH)

    importance = {
        col: float(imp)
        for col, imp in sorted(
            zip(db.FEATURE_COLUMNS, model.feature_importances_),
            key=lambda kv: kv[1], reverse=True,
        )
    }
    with open(config.FEATURE_IMPORTANCE_PATH, "w") as fh:
        json.dump(importance, fh, indent=2)

    _log_training(metrics)
    return metrics


def train_symbol_model(symbol):
    """Train a symbol-specific model if the symbol has enough history."""
    from sklearn.ensemble import RandomForestClassifier

    X, y = _load_dataset(symbol)
    if len(y) < config.SYMBOL_MODEL_MIN_TRADES or len(set(y)) < 2:
        return {
            "trained": False,
            "reason": (
                f"{symbol}: need >={config.SYMBOL_MODEL_MIN_TRADES} trades with "
                f"both outcomes; have {len(y)}."
            ),
        }

    model = RandomForestClassifier(
        n_estimators=150, max_depth=5, min_samples_leaf=2,
        class_weight="balanced", random_state=42,
    )
    model.fit(X, y)
    joblib.dump(model, config.SYMBOL_MODEL_PATH.format(symbol=symbol))
    return {"trained": True, "symbol": symbol, "n_samples": int(len(y))}


def maybe_train_symbol_models():
    """Train symbol models for every symbol that now qualifies."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT symbol, COUNT(*) AS c FROM trades "
            "WHERE status='CLOSED' GROUP BY symbol"
        ).fetchall()
    results = {}
    for r in rows:
        if r["c"] >= config.SYMBOL_MODEL_MIN_TRADES:
            results[r["symbol"]] = train_symbol_model(r["symbol"])
    return results


def _log_training(metrics):
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO model_performance
                (date, accuracy, precision_score, recall,
                 total_predictions, correct_predictions, model_version)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.now(timezone.utc).isoformat(),
                metrics["accuracy"], metrics["precision"], metrics["recall"],
                metrics["n_samples"],
                int(round(metrics["accuracy"] * metrics["n_samples"])),
                metrics["version"],
            ),
        )


def closed_trade_count():
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM trades WHERE status='CLOSED'"
        ).fetchone()
    return int(row["c"])


def maybe_retrain():
    """Retrain the general model when the closed-trade count crosses a multiple
    of ``RETRAIN_EVERY_N_TRADES``. Also refreshes qualifying symbol models."""
    count = closed_trade_count()
    if count > 0 and count % config.RETRAIN_EVERY_N_TRADES == 0:
        general = train_general_model()
        symbols = maybe_train_symbol_models()
        return {"triggered": True, "general": general, "symbols": symbols}
    return {"triggered": False, "closed_trades": count}
