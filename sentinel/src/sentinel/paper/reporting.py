"""Textes /stats, /status et rapport hebdomadaire, à partir de l'état du paper trader."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime

import numpy as np

from sentinel.core.models import Market
from sentinel.paper.tracker import PaperTracker, PaperTrade

DAY_MS = 86_400_000


def _r(x: float) -> str:
    return f"{x:+.2f} R".replace(".", ",")


def _eur(x: float) -> str:
    return f"{x:+.2f} €".replace(".", ",")


def strategy_block(
    tracker: PaperTracker, strategy: str, market: Market, ref_mean: float | None
) -> list[str]:
    closed = [t for t in tracker.closed(strategy) if t.market is market and t.result]
    r = [t.result.r_net for t in closed if t.result is not None]
    lines = [f"• {strategy} ({market.value}) : {len(r)} trades clôturés"]
    if r:
        wins = sum(x > 0 for x in r)
        lines.append(
            f"  win rate {wins / len(r):.0%}, espérance {_r(float(np.mean(r)))}, total "
            f"{_r(sum(r))}, {_eur(sum(t.pnl_eur() for t in closed))}"
        )
    if ref_mean is not None:
        lines.append(f"  backtest hors échantillon : espérance {_r(ref_mean)}")
    d = tracker.divergence(strategy, market)
    if d is None:
        lines.append(
            f"  comparaison statistique : pas encore assez de trades (minimum {tracker.div_min})"
        )
    else:
        verdict = "⚠️ DIVERGENCE — suspension proposée" if d.diverging else "compatible"
        lines.append(f"  écart vs backtest : probabilité malchance {d.p_value:.0%} → {verdict}")
    return lines


def positions_block(tracker: PaperTracker) -> list[str]:
    act = tracker.active()
    if not act:
        return ["Aucune position papier ouverte."]
    out = []
    for t in act:
        if t.status == "pending":
            out.append(
                f"• {t.symbol} {t.setup.side.name.lower()} : en attente d'entrée "
                f"(stop {t.setup.stop:g})"
            )
        elif t.pos is not None:
            out.append(
                f"• {t.symbol} {t.setup.side.name.lower()} depuis "
                f"{datetime.fromtimestamp(t.pos.t.entry_ms / 1000, UTC):%d/%m} : entrée "
                f"{t.pos.t.entry:g}, stop actuel {t.pos.stop:g}, latent {_r(t.latent_r())} "
                f"({_eur(t.pnl_eur())})"
            )
    return out


def stats_text(
    tracker: PaperTracker, strategies: Mapping[str, list[Market]], ref_means: Mapping[str, float]
) -> str:
    eq = tracker.equity()
    L = [
        "📊 STATISTIQUES PAPER TRADING",
        f"Équité papier {eq:.2f} € (capital {tracker.risk.capital_eur:.0f} €, "
        f"plus haut {tracker.peak_equity:.2f} €, drawdown {tracker.drawdown() * 100:.1f} %)",
        (
            f"Risque ouvert : {tracker.open_risk_pct():.2f} % / "
            f"{tracker.risk.max_open_risk_pct:g} %"
        ).replace(".", ","),
        "",
    ]
    for name, markets in strategies.items():
        for m in markets:
            L += strategy_block(tracker, name, m, ref_means.get(f"{name}:{m.value}"))
    L += ["", "Positions :", *positions_block(tracker)]
    if tracker.breaker_tripped:
        L += ["", "⛔ Coupe-circuit actif : alertes en mode observation."]
    return "\n".join(L)


def weekly_text(
    tracker: PaperTracker,
    strategies: Mapping[str, list[Market]],
    ref_means: Mapping[str, float],
    week_start_ms: int,
    ops: Mapping[str, int],
    alerts_this_week: int,
    latency: Mapping[str, float],
    smart_money_lines: Sequence[str] = ("• Module non actif.",),
) -> str:
    week: list[PaperTrade] = [
        t for t in tracker.closed() if t.result and t.result.exit_ms >= week_start_ms
    ]
    wr = [t.result.r_net for t in week if t.result is not None]
    start = datetime.fromtimestamp(week_start_ms / 1000, UTC)
    L = [f"🗓️ RAPPORT HEBDOMADAIRE — semaine du {start:%d/%m/%Y}", ""]
    L.append("Cette semaine")
    L.append(f"• Alertes envoyées : {alerts_this_week}")
    L.append(
        f"• Trades papier clôturés : {len(wr)}"
        + (f", {_r(sum(wr))}, {_eur(sum(t.pnl_eur() for t in week))}" if wr else "")
    )
    L.append(
        (
            f"• Équité papier : {tracker.equity():.2f} € "
            f"(drawdown {tracker.drawdown() * 100:.1f} %)"
        ).replace(".", ",")
    )
    L += ["", "Performance par stratégie (depuis le début, vs backtest)"]
    for name, markets in strategies.items():
        for m in markets:
            L += strategy_block(tracker, name, m, ref_means.get(f"{name}:{m.value}"))
    L += ["", "Smart money", *smart_money_lines]
    L += ["", "Positions ouvertes", *positions_block(tracker)]
    L += ["", "Erreurs et points à corriger"]
    labels = {
        "feed_stale": "coupures de flux détectées",
        "gap": "trous de données (rechargés)",
        "gap_unfillable": "trous impossibles à combler",
        "backfill_failed": "échecs de rechargement",
        "send_failure": "échecs d'envoi Telegram",
        "latency_over_target": "alertes au-delà de l'objectif de latence",
        "report_failure": "échecs de rapport / graphique",
        "breaker_tripped": "déclenchements du coupe-circuit",
        "divergence": "divergences paper/backtest",
    }
    issues = [f"• {ops[k]} {v}" for k, v in labels.items() if ops.get(k)]
    L += issues or ["• Aucun incident enregistré."]
    if latency.get("n"):
        L.append(
            f"• Latence système des alertes : p50 {latency['system_ms_p50']:.0f} ms, "
            f"p99 {latency['system_ms_p99']:.0f} ms (objectif 500 ms)"
        )
    L += ["", "Rappel : aide à la décision ; aucune performance future n'est assurée."]
    return "\n".join(L)


def smart_money_effect(
    outcomes: Sequence[tuple[str | None, float]], min_each: int = 5
) -> list[str]:
    """Le smart money améliore-t-il réellement les trades ? Compare le R moyen des trades
    papier dont l'alerte avait ≥ 1 portefeuille suivi dans le même sens, aux autres."""
    with_sm: list[float] = []
    without: list[float] = []
    for sm, r in outcomes:
        same = int(sm.split("/")[0]) if sm else 0
        (with_sm if same > 0 else without).append(r)
    if len(with_sm) < min_each or len(without) < min_each:
        return [
            f"• Apport mesuré : pas assez de données ({len(with_sm)} trades avec smart money "
            f"aligné, {len(without)} sans ; minimum {min_each} de chaque)."
        ]
    a, b = float(np.mean(with_sm)), float(np.mean(without))
    verdict = "améliore" if a > b else "N'AMÉLIORE PAS — son poids dans le score doit baisser"
    return [
        f"• Trades avec smart money aligné : {len(with_sm)}, espérance {_r(a)} ; sans : "
        f"{len(without)}, espérance {_r(b)} → {verdict} (petit échantillon, prudence)."
    ]
