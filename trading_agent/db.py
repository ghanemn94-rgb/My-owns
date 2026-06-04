"""SQLite access layer and schema management.

A single module owns the database connection and schema so every other layer
(portfolio, memory, ML) talks to one consistent store. Connections use
``check_same_thread=False`` and a row factory so callers get dict-like rows.
"""

import sqlite3
from contextlib import contextmanager

import config

# Canonical, ordered list of ML feature columns. Every layer that builds,
# stores, trains on, or predicts from features imports this so the feature
# vector ordering is guaranteed identical end to end.
FEATURE_COLUMNS = [
    # technical
    "rsi_14",
    "macd_signal",
    "macd_histogram",
    "price_vs_sma20",
    "price_vs_sma50",
    "price_vs_sma200",
    "bollinger_position",
    "atr_normalized",
    "volume_ratio",
    # market
    "spy_trend",
    "vix_level",
    "vix_change_today",
    "market_breadth_score",
    "sector_performance",
    # context
    "days_to_earnings",
    "news_sentiment_score",
    "time_of_day_num",
    "day_of_week",
]


def get_conn():
    """Return a configured SQLite connection (dict-style rows)."""
    conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def transaction():
    """Context manager that commits on success and rolls back on error."""
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Create all tables and seed the account row if needed."""
    feature_cols_sql = ",\n            ".join(
        f"{col} REAL" for col in FEATURE_COLUMNS
    )

    with transaction() as conn:
        conn.executescript(
            f"""
            CREATE TABLE IF NOT EXISTS account (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                cash REAL NOT NULL,
                starting_capital REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,              -- BUY or SELL (short)
                quantity REAL NOT NULL,
                entry_price REAL NOT NULL,
                entry_time TEXT NOT NULL,
                exit_price REAL,
                exit_time TEXT,
                return_pct REAL,
                was_profitable INTEGER,            -- 1/0
                stop_loss REAL,
                take_profit REAL,
                hit_stop INTEGER DEFAULT 0,
                hit_target INTEGER DEFAULT 0,
                reasoning TEXT,
                confidence_score REAL,
                ml_prediction REAL,
                status TEXT NOT NULL DEFAULT 'OPEN' -- OPEN or CLOSED
            );

            CREATE TABLE IF NOT EXISTS features (
                trade_id INTEGER PRIMARY KEY,
                {feature_cols_sql},
                FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                lesson_type TEXT NOT NULL,
                description TEXT NOT NULL,
                symbol TEXT,
                impact_score REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS model_performance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                accuracy REAL,
                precision_score REAL,
                recall REAL,
                total_predictions INTEGER,
                correct_predictions INTEGER,
                model_version INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
            CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
            """
        )

        row = conn.execute("SELECT id FROM account WHERE id = 1").fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO account (id, cash, starting_capital) VALUES (1, ?, ?)",
                (config.STARTING_CAPITAL, config.STARTING_CAPITAL),
            )


def reset_db():
    """Drop everything and re-seed. Used by backtests / a clean start."""
    with transaction() as conn:
        for table in ("features", "trades", "lessons", "model_performance", "account"):
            conn.execute(f"DROP TABLE IF EXISTS {table}")
    init_db()
