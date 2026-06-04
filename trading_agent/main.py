"""CLI entry point for the US Stock Trading Agent.

Run with ``python main.py`` for the interactive menu, or pass a subcommand:
  python main.py run         # start the live loop
  python main.py run --force # run cycles regardless of market hours (demo)
  python main.py backtest    # run a historical backtest
  python main.py retrain      # force-retrain the ML model
"""

import sys

import config
import db


def _hr():
    print("=" * 54)


def menu():
    print(
        """
╔══════════════════════════════════════════════════╗
║        🤖  US STOCK TRADING AGENT  (PAPER)         ║
╠══════════════════════════════════════════════════╣
║  1. Start Agent (live trading loop)                ║
║  2. View Portfolio & Open Positions                ║
║  3. View Trade History & Performance               ║
║  4. View ML Model Performance                      ║
║  5. View Lessons Learned                           ║
║  6. Run Backtest (test on historical data)         ║
║  7. Force Retrain ML Model                         ║
║  8. Exit                                           ║
╚══════════════════════════════════════════════════╝
"""
    )


def view_portfolio():
    import tools

    status = tools.get_portfolio_status()
    _hr()
    print(f"  Total Value : ${status['total_value']:,.2f}")
    print(f"  Cash        : ${status['cash']:,.2f}")
    print(f"  Total Return: {status['total_return_pct']:+.2f}%")
    print(f"  Open        : {status['open_count']}/{status['max_positions']}")
    print(f"  Unrealized  : ${status['unrealized_pnl_total']:+,.2f}")
    _hr()
    if status["open_positions"]:
        print("  OPEN POSITIONS")
        for p in status["open_positions"]:
            print(
                f"   {p['symbol']:<6} {p['action']:<4} {p['quantity']:>6} @ "
                f"${p['entry_price']:>8.2f} | now ${p['current_price']:>8.2f} | "
                f"P&L {p['unrealized_pct']:+.2f}% (${p['unrealized_pnl']:+,.2f})"
            )
    else:
        print("  No open positions.")
    _hr()


def view_history():
    import portfolio

    trades = portfolio.closed_trades()
    metrics = portfolio.performance_metrics()
    _hr()
    print(f"  Closed trades: {metrics['total_trades']}")
    print(f"  Win rate     : {metrics['win_rate']}%")
    print(f"  Avg return   : {metrics['avg_return']}%")
    print(f"  Sharpe ratio : {metrics['sharpe']}")
    print(f"  Max drawdown : {metrics['max_drawdown']}%")
    _hr()
    for t in trades[-20:]:
        flag = "✓" if t["was_profitable"] else "✗"
        print(
            f"   {flag} {t['symbol']:<6} {t['action']:<4} "
            f"{t['entry_price']:>8.2f} -> {t['exit_price']:>8.2f} "
            f"({t['return_pct']:+.2f}%)"
        )
    if not trades:
        print("  No closed trades yet.")
    _hr()


def view_model():
    from ml import evaluator

    print(evaluator.weekly_report())
    ev = evaluator.evaluate()
    if ev.get("evaluated"):
        _hr()
        print(f"  Live scored sample: {ev['sample_size']}")
        print(f"  Live accuracy     : {ev['accuracy']*100:.0f}%")
        if ev["high_confidence_accuracy"] is not None:
            print(f"  High-conf accuracy: {ev['high_confidence_accuracy']*100:.0f}%")
            print(f"  Low-conf accuracy : {ev['low_confidence_accuracy']*100:.0f}%")
        print(f"  Needs retrain     : {ev['needs_retrain']}")
    _hr()


def view_lessons():
    from memory import trade_memory

    _hr()
    print("  TOP LESSONS LEARNED")
    for l in trade_memory.top_lessons(10):
        print(f"   [{l['lesson_type']:<6}] ({l['impact_score']:+.2f}) {l['description']}")
    print("\n  RECURRING MISTAKES")
    for m in trade_memory.identify_recurring_mistakes():
        print(f"   {m['symbol']}: {m['losses']} losses, avg {m['avg_loss_pct']}%")
    print("\n  MOST PROFITABLE PATTERNS")
    for p in trade_memory.most_profitable_patterns():
        print(f"   {p['symbol']}: {p['wins']} wins, avg {p['avg_win_pct']}%")
    _hr()


def run_backtest_cmd():
    import backtest

    print("Running backtest (this fetches historical data; may take a moment)...")
    backtest.run_backtest()


def force_retrain():
    from ml import trainer, predictor

    print("Force-retraining general model...")
    result = trainer.train_general_model()
    if result.get("trained"):
        print(
            f"✓ Trained v{result['version']} | accuracy {result['accuracy']:.0%} | "
            f"precision {result['precision']:.0%} | recall {result['recall']:.0%} "
            f"on {result['n_samples']} samples."
        )
    else:
        print(f"✗ Not trained: {result.get('reason')}")
    sym_results = trainer.maybe_train_symbol_models()
    for sym, r in sym_results.items():
        if r.get("trained"):
            print(f"  ✓ Symbol model {sym}: {r['n_samples']} samples.")
    predictor.clear_cache()


def start_agent(force=False):
    import agent

    agent.run_loop(force=force)


def interactive():
    while True:
        menu()
        choice = input("Select an option (1-8): ").strip()
        if choice == "1":
            start_agent()
        elif choice == "2":
            view_portfolio()
        elif choice == "3":
            view_history()
        elif choice == "4":
            view_model()
        elif choice == "5":
            view_lessons()
        elif choice == "6":
            run_backtest_cmd()
        elif choice == "7":
            force_retrain()
        elif choice == "8":
            print("Goodbye.")
            return
        else:
            print("Invalid choice.")
        input("\nPress Enter to continue...")


def main():
    db.init_db()
    if not config.ANTHROPIC_API_KEY:
        print("⚠ ANTHROPIC_API_KEY is not set — Claude reasoning will fall back to "
              "the transparent rule-based engine.\n")

    args = sys.argv[1:]
    if not args:
        interactive()
        return

    cmd = args[0]
    if cmd == "run":
        start_agent(force="--force" in args)
    elif cmd == "backtest":
        run_backtest_cmd()
    elif cmd == "retrain":
        force_retrain()
    elif cmd == "portfolio":
        view_portfolio()
    elif cmd == "history":
        view_history()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
