"""Le score de confluence prédit-il la qualité des trades ? Validation honnête.

    uv run python scripts/validate_score.py   # → reports/phase5_score.md + reports/stats/score.json

Méthode : on rejoue l'historique à travers le chemin LIVE (StrategyDetector, mêmes moteurs
1j + 4h) pour obtenir le score exact qu'aurait affiché chaque alerte, puis on l'associe au R
du trade backtest correspondant.

Critère (fixé avant exécution) : validé si, EN ÉCHANTILLON ET HORS ÉCHANTILLON,
  (a) la corrélation de rang (Spearman) score ↔ R est positive, et
  (b) l'espérance du tiers supérieur des scores dépasse celle du tiers inférieur.
Limite : ~60 trades au total → faible puissance statistique ; un « non validé » veut dire
« pas de preuve », pas « preuve du contraire ».
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from sentinel.alerts.format import format_alert
from sentinel.backtest.costs import CostModel
from sentinel.backtest.data import load_bars, ms
from sentinel.backtest.engine import Backtester
from sentinel.core.config import load_config
from sentinel.core.logging import configure_logging
from sentinel.core.models import Market, StreamKey, Timeframe
from sentinel.indicators.engine import IndicatorEngine
from sentinel.pipeline.strategy_detector import AlertContext, StrategyDetector
from sentinel.strategies.donchian import DonchianParams, DonchianTrend
from sentinel.strategies.registry import strategy_factory

ROOT = Path("data/archive")
OOS = ms("2023-01-01")


def ranks(x: Sequence[float]) -> np.ndarray:
    order = np.argsort(x, kind="stable")
    r = np.empty(len(x))
    r[order] = np.arange(len(x))
    return r


def spearman(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) < 3:
        return float("nan")
    return float(np.corrcoef(ranks(a), ranks(b))[0, 1])


def terciles(pairs: list[tuple[int, float]]) -> tuple[float, float, float, int]:
    s = sorted(pairs)
    n = len(s) // 3
    lo, mid, hi = s[:n], s[n:-n] if n else s, s[-n:] if n else s
    m = lambda xs: float(np.mean([r for _, r in xs])) if xs else float("nan")  # noqa: E731
    return m(lo), m(mid), m(hi), n


def main() -> None:
    configure_logging("ERROR")
    cfg = load_config("config/config.yaml")
    name, entry = "donchian_trend", cfg.strategies["donchian_trend"]
    bars = {
        StreamKey(Market.SPOT, s, tf): load_bars(ROOT, Market.SPOT, s, tf)
        for s in cfg.watchlist
        for tf in (Timeframe.H4, Timeframe.D1)
    }
    engines = {k: IndicatorEngine(k, cfg.indicators, strict_gaps=False) for k in bars}
    det = StrategyDetector(
        strategy_factory(name, entry), entry.markets, engines, cfg.risk, {}, format_alert
    )
    events = sorted(
        ((b.close_time_ms, -k.timeframe.seconds, k, b) for k, v in bars.items() for b in v),
        key=lambda e: (e[0], e[1]),
    )
    ctxs: dict[tuple[str, int], AlertContext] = {}
    for _, _, k, b in events:
        snap = engines[k].update(b)
        if snap is not None:
            sig = det.evaluate(snap, b)
            if sig is not None and isinstance(sig.payload, AlertContext):
                ctxs[(b.symbol, sig.payload.setup.time_ms)] = sig.payload

    rows: list[tuple[str, int, int, float]] = []  # (symbole, signal_ms, score, R)
    for s in cfg.watchlist:
        bt = Backtester(lambda: DonchianTrend(DonchianParams()), CostModel.for_market(Market.SPOT))
        for t in bt.run(
            s, Market.SPOT, {Timeframe.D1: bars[StreamKey(Market.SPOT, s, Timeframe.D1)]}
        ):
            c = ctxs.get((s, t.signal_ms))
            if c is not None and c.score is not None:
                rows.append((s, t.signal_ms, c.score.total, t.r_net))

    L = [
        "# Phase 5 — Le score de confluence prédit-il les trades ?",
        "",
        "_Généré par `uv run python scripts/validate_score.py`._",
        "",
        f"Trades appariés (Donchian spot, BTC/ETH/SOL) : **{len(rows)}**.",
        "",
        "| Période | Trades | Spearman score↔R | Esp. tiers bas | Esp. tiers milieu | "
        "Esp. tiers haut | Taille d'un tiers |",
        "|---|---|---|---|---|---|---|",
    ]
    verdict = {}
    for per, cond in (("In-sample", lambda t: t < OOS), ("Hors échantillon", lambda t: t >= OOS)):
        sub = [(sc, r) for _, t, sc, r in rows if cond(t)]
        rho = spearman([a for a, _ in sub], [b for _, b in sub])
        lo, mid, hi, n = terciles(sub)
        verdict[per] = bool(rho > 0 and hi > lo)
        L.append(
            f"| {per} | {len(sub)} | {rho:+.2f} | {lo:+.2f} R | {mid:+.2f} R | {hi:+.2f} R | {n} |"
        )
    validated = all(verdict.values())
    L += ["", "**Composantes du score à chaque signal** (moyenne) :", ""]
    comp_names = sorted({c.name for x in ctxs.values() if x.score for c in x.score.components})
    for cn in comp_names:
        vals = [
            c.points / c.max_points
            for x in ctxs.values()
            if x.score
            for c in x.score.components
            if c.name == cn
        ]
        L.append(f"- {cn} : {np.mean(vals):.0%} des points en moyenne ({len(vals)} signaux)")
    L += [
        "",
        f"**Verdict : {'VALIDÉ' if validated else 'NON VALIDÉ'}** "
        f"(in-sample {'✅' if verdict['In-sample'] else '❌'}, hors échantillon "
        f"{'✅' if verdict['Hors échantillon'] else '❌'}).",
        "",
    ]
    if validated:
        L.append(
            "Le score peut servir de seuil d'alerte (`alerts.min_score`), avec prudence vu "
            "la taille de l'échantillon."
        )
    else:
        L.append(
            "Conséquence : le score reste **affiché à titre indicatif**, n'ajoute ni ne "
            "retire aucune alerte, et le seuil `alerts.min_score` reste à 0. Il sera "
            "réévalué avec les trades du paper trading (le score de chaque alerte est "
            "journalisé)."
        )
    Path("reports").mkdir(exist_ok=True)
    Path("reports/phase5_score.md").write_text("\n".join(L), encoding="utf-8")
    Path("reports/stats/score.json").write_text(
        json.dumps(
            {"validated": validated, "verdict": verdict, "n": len(rows)},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print("\n".join(L))


if __name__ == "__main__":
    main()
