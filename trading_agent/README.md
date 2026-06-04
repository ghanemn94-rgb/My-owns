# 🤖 US Stock Trading Agent (Paper Trading)

A production-grade, **paper-trading-only** US equities agent with three cooperating layers:

1. **Core Agent** — a Claude-powered reasoning engine that decides like a professional trader.
2. **Machine Learning** — a RandomForest model that learns from the agent's own closed trades.
3. **Self-improvement loop** — memory, lessons-learned, and periodic retraining so the agent gets smarter over time.

> ⚠️ **No real money. No brokerage connection. Ever.** Every trade is simulated against a SQLite ledger.

---

## Architecture

```
trading_agent/
├── main.py              # CLI entry point + interactive menu
├── agent.py             # Core Claude reasoning loop (5-step framework) + live loop
├── tools.py             # All trading tools (price, TA, market, news, ML, memory, execute…)
├── risk_manager.py      # Hard risk rules: 2% per trade, position caps, drawdown halt
├── portfolio.py         # Cash, positions, P&L, Sharpe, drawdown
├── dashboard.py         # Live terminal dashboard
├── backtest.py          # Historical replay that trains the ML model
├── config.py            # Settings & API key (from env)
├── db.py                # SQLite schema + canonical feature columns
├── ml/
│   ├── feature_engineer.py  # Indicators + canonical feature vector
│   ├── trainer.py           # General + per-symbol RandomForest training
│   ├── predictor.py         # Real-time predictions (neutral on cold start)
│   └── evaluator.py         # Model self-evaluation + weekly report
└── memory/
    ├── trade_memory.py      # Lessons learned, recurring mistakes
    ├── pattern_store.py     # Per-symbol win-rate / timing / signal analytics
    └── context_builder.py   # Builds the "AGENT MEMORY BRIEF" for Claude
```

## Setup

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY="sk-ant-..."   # optional; without it the agent uses a transparent rule-based fallback
python main.py
```

## Usage

```bash
python main.py              # interactive menu (8 options)
python main.py run          # live loop (market hours only)
python main.py run --force  # run cycles regardless of market hours (demo)
python main.py backtest     # build trade history + train the model
python main.py retrain      # force-retrain the ML model
```

## The 5-step decision framework

Before every trade Claude must work through:

1. **Market check** — VIX, SPY trend, breadth. (VIX>30 → halve size; SPY down >1.5% → cash/shorts; breadth<30% → no new longs.)
2. **Signal quality** — needs ≥3 aligned factors (technical, ML>60%, sentiment, volume) or it SKIPs.
3. **Memory check** — win rate on this symbol, repeated mistakes, recent losses.
4. **Risk check** — ≤2% risk per trade, ≤5 positions, halt if intraday drawdown >10%.
5. **Final decision** — `BUY / SELL / HOLD / SKIP` with full written reasoning and "what would change my mind".

### Guardrails (never overridden)
- ML is an **input only** — it never makes the decision.
- If Claude and ML **strongly disagree**, the trade is skipped.
- The risk engine caps size *after* Claude decides; the 2% rule is absolute.
- Every decision — including every SKIP — is logged with reasoning.

## How it learns

- Features are captured at decision time and joined to the realised outcome when a trade closes.
- The general model retrains every `RETRAIN_EVERY_N_TRADES` closed trades; symbols with ≥20 trades get their own model that overrides the general one.
- The evaluator checks calibration every 10 trades and flags sub-55% accuracy for retraining.
- Lessons-learned and per-symbol patterns are fed back into Claude's context each cycle.

## Configuration (`config.py`)

| Setting | Default |
|---|---|
| `STARTING_CAPITAL` | 100,000 |
| `MAX_POSITIONS` | 5 |
| `MAX_RISK_PER_TRADE` | 0.02 |
| `STOP_LOSS_DEFAULT` | 0.05 |
| `MIN_ML_CONFIDENCE` | 0.60 |
| `RETRAIN_EVERY_N_TRADES` | 50 |

Default watchlist: `AAPL, MSFT, NVDA, TSLA, AMZN, GOOGL, META, AMD, JPM, NFLX`.
