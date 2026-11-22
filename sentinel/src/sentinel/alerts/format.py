"""Formatage des messages Telegram (texte brut, lisible sur téléphone).

Message n°1 : l'alerte, courte, envoyée immédiatement.
Message n°2 : le rapport argumenté, envoyé en réponse au n°1, hors chemin critique.

Tout le contenu du rapport est dérivé de RÈGLES explicites appliquées aux indicateurs
(aucun texte généré au hasard). La section « Contre-arguments » n'est jamais vide : elle
contient au minimum les faiblesses connues de la stratégie, mesurées en backtest.
Vocabulaire interdit par le cahier des charges : « garanti », « sûr », « argent facile ».
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

from sentinel.alerts.events import RiskEvent
from sentinel.core.models import Market, Timeframe
from sentinel.indicators.engine import IndicatorSnapshot
from sentinel.indicators.structure import Trend
from sentinel.pipeline.strategy_detector import AlertContext
from sentinel.strategies.base import Side

TELEGRAM_MAX = 4096
FORBIDDEN_WORDS = ("garanti", "sûr ", "argent facile")
NNBSP = " "  # espace fine insécable : séparateur de milliers français


def fmt_num(x: float, decimals: int) -> str:
    s = f"{x:,.{decimals}f}"
    return s.replace(",", NNBSP).replace(".", ",")


def fmt_price(x: float) -> str:
    """Nombre de décimales adapté à l'ordre de grandeur (BTC 67 450 ; SOL 70,32 ; 0,4306)."""
    ax = abs(x)
    if ax >= 1000:
        return fmt_num(x, 0)
    if ax >= 100:
        return fmt_num(x, 1)
    if ax >= 1:
        return fmt_num(x, 2)
    return fmt_num(x, 4)


def fmt_pct(x: float, decimals: int = 1, signed: bool = False) -> str:
    s = f"{x * 100:+.{decimals}f}" if signed else f"{x * 100:.{decimals}f}"
    return s.replace(".", ",") + f"{NNBSP}%"


def fmt_r(x: float) -> str:
    return f"{x:+.2f}".replace(".", ",") + " R"


def _base_asset(symbol: str) -> str:
    return symbol[:-4] if symbol.endswith("USDT") else symbol


def fmt_qty(q: float) -> str:
    if q >= 100:
        return fmt_num(q, 1)
    if q >= 1:
        return fmt_num(q, 3)
    digits = max(4, -math.floor(math.log10(q)) + 3) if q > 0 else 4
    return fmt_num(q, min(digits, 8))


def _channel_note(c: AlertContext) -> str:
    """Précise si le canal est déjà actif ou encore sous le stop initial (cas fréquent juste
    après une cassure) : sinon on croirait que le stop effectif est le canal."""
    lvl, s = c.exit_channel_level, c.setup
    if lvl is None:
        return ""
    long = s.side is Side.LONG
    active = lvl > s.stop if long else lvl < s.stop
    if active:
        return f", actuellement {fmt_price(lvl)} : c'est le stop effectif"
    return (
        f", actuellement {fmt_price(lvl)} ; il ne prend le relais que lorsqu'il dépasse "
        f"le stop initial {fmt_price(s.stop)}"
    )


# ---------------------------------------------------------------------------------------
def format_alert(c: AlertContext) -> str:
    s, b, sz = c.setup, c.bar, c.size
    long = s.side is Side.LONG
    icon, word = ("🟢", "LONG") if long else ("🔴", "SHORT")
    mkt = "spot" if b.key.market is Market.SPOT else "perp"
    risk = abs(s.signal_close - s.stop)
    lines = [
        f"{icon} {word} {b.symbol} ({mkt}) | {c.horizon} | Score : n/d (phase 5)",
        f"Entrée ≈ {fmt_price(s.signal_close)} (ouverture suivante) | Stop : {fmt_price(s.stop)} "
        f"({fmt_pct(-sz.stop_distance_pct if long else sz.stop_distance_pct, signed=True)})",
    ]
    if math.isinf(s.tp1_r):
        lines.append(
            f"Objectif : aucun — sortie au stop suiveur (plus {'bas' if long else 'haut'} "
            f"{s.exit_channel} j{_channel_note(c)})"
        )
        sign = 1 if long else -1
        lines.append(
            f"Repères : +2R = {fmt_price(s.signal_close + sign * 2 * risk)} | "
            f"+4R = {fmt_price(s.signal_close + sign * 4 * risk)} (pas des objectifs)"
        )
        if c.stats and c.stats.avg_loss_r:
            lines.append(
                f"R/R : ouvert — en backtest, gain moyen {fmt_r(c.stats.avg_win_r)} "
                f"vs perte moyenne {fmt_r(c.stats.avg_loss_r)}"
            )
    else:
        sign = 1 if long else -1
        tp1 = s.signal_close + sign * s.tp1_r * risk
        lines.append(
            f"TP1 : {fmt_price(tp1)} ({s.tp1_frac:.0%}) puis stop suiveur "
            f"{s.trail_atr:g} ATR | R/R TP1 : {s.tp1_r:.1f}".replace(".", ",")
        )
    base = _base_asset(b.symbol)
    capped = " ⚠️ plafonné (spot sans levier)" if sz.capped else ""
    lines.append(
        f"Risque : {fmt_num(sz.risk_pct, 1)}{NNBSP}% = {fmt_num(sz.risk_amount, 2)}{NNBSP}€ → "
        f"taille suggérée : {fmt_qty(sz.qty)} {base} (≈ {fmt_num(sz.notional, 0)}{NNBSP}€, "
        f"{fmt_pct(sz.capital_share, 0)} du capital){capped}"
    )
    if sz.risk_pct <= 0:
        lines.append(
            f"⛔ Plafond de risque ouvert atteint ({fmt_num(c.open_risk_pct, 1)}{NNBSP}% déjà "
            "engagés sur des actifs corrélés) : ne pas prendre ce trade."
        )
    elif sz.risk_pct < c.base_risk_pct:
        lines.append(
            f"⚠️ Taille réduite : {fmt_num(c.open_risk_pct, 1)}{NNBSP}% déjà engagés, plafond "
            f"de risque ouvert total {fmt_num(c.max_open_risk_pct, 1)}{NNBSP}%."
        )
    if sz.liq_distance_pct is not None:
        lines.append(
            f"Perp : levier {sz.leverage:.1f}×, liquidation ≈ "
            f"{fmt_pct(sz.liq_distance_pct)} de l'entrée".replace(".", ",")
        )
    lines.append(f"Stratégie : {s.reason} — {c.strategy_label}")
    lines.append("Smart money : module non actif (phase 6)")
    if c.stats:
        st = c.stats
        lines.append(
            f"Backtest ({base} {mkt}, cette stratégie) : {st.n} trades, win rate "
            f"{fmt_pct(st.win_rate, 0)}, espérance {fmt_r(st.expectancy_r)} | hors échantillon "
            f"2023+ : {st.oos_n} trades, {fmt_r(st.oos_expectancy_r)}"
        )
    else:
        lines.append("Backtest : statistiques indisponibles (lancer le script de recherche)")
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------
def _trend_word(s: IndicatorSnapshot | None) -> str:
    if s is None or s.ema.get(50) is None:
        return "n/d"
    above = s.close > (s.ema[50] or 0)
    struct = {Trend.UP: "HH/HL", Trend.DOWN: "LH/LL", Trend.NEUTRAL: "mixte"}[s.trend]
    arrow = (
        "↑"
        if above and s.trend is Trend.UP
        else "↓"
        if (not above and s.trend is Trend.DOWN)
        else "→"
    )
    return f"{arrow} ({'au-dessus' if above else 'sous'} EMA50, structure {struct})"


def _regime(d: IndicatorSnapshot) -> str:
    e50, e200 = d.ema.get(50), d.ema.get(200)
    if e50 is None or e200 is None:
        return "indéterminé (historique insuffisant)"
    if d.close > e50 > e200:
        return "tendance haussière de fond (close > EMA50 > EMA200)"
    if d.close < e50 < e200:
        return "tendance baissière de fond (close < EMA50 < EMA200)"
    return "régime mixte / transition (moyennes non alignées)"


def confluences_and_risks(c: AlertContext) -> tuple[list[str], list[str]]:
    """Règles explicites → (signaux alignés, contre-arguments). Les contre-arguments
    incluent toujours les faiblesses connues de la stratégie."""
    snap, long = c.snap, c.setup.side is Side.LONG
    pro: list[str] = []
    con: list[str] = []
    d = c.multi_tf.get(Timeframe.D1) or snap
    e50, e200 = d.ema.get(50), d.ema.get(200)
    if e50 and e200:
        aligned = (d.close > e50 > e200) if long else (d.close < e50 < e200)
        against = (d.close < e200) if long else (d.close > e200)
        if aligned:
            pro.append("Tendance de fond journalière alignée (close / EMA50 / EMA200).")
        if against:
            con.append(
                "Le prix est du mauvais côté de l'EMA200 journalière : cassure contre "
                "la tendance de fond, taux d'échec historiquement plus élevé."
            )
    want, opposite = (Trend.UP, Trend.DOWN) if long else (Trend.DOWN, Trend.UP)
    agree: list[Timeframe] = []
    disagree: list[Timeframe] = []
    for tf in (Timeframe.H4, Timeframe.H1):
        ts = c.multi_tf.get(tf)
        if ts is None:
            continue
        if ts.trend is want:
            agree.append(tf)
        elif ts.trend is opposite:
            disagree.append(tf)
    if agree:
        pro.append("Structure alignée sur " + ", ".join(tf.value for tf in agree) + ".")
    if disagree:
        con.append(
            "Structure opposée sur "
            + ", ".join(tf.value for tf in disagree)
            + " : les unités de temps inférieures ne confirment pas encore."
        )
    if snap.relvol is not None:
        if snap.relvol >= 1.5:
            pro.append(
                f"Volume {snap.relvol:.1f}× la moyenne 20 j : cassure soutenue.".replace(
                    ".", ",", 1
                )
            )
        elif snap.relvol < 1.0:
            con.append(
                f"Volume faible ({snap.relvol:.1f}× la moyenne) : une cassure sans "
                "volume échoue plus souvent.".replace(".", ",", 1)
            )
    if snap.macd and snap.macd.hist is not None and (snap.macd.hist > 0) == long:
        pro.append(
            "Momentum MACD dans le sens du trade (histogramme "
            + ("positif" if long else "négatif")
            + ")."
        )
    if snap.rsi is not None:
        if (long and snap.rsi > 75) or (not long and snap.rsi < 25):
            con.append(
                f"RSI {snap.rsi:.0f} : marché en excès, un repli vers le stop est "
                "probable avant toute continuation."
            )
        elif (long and 55 <= snap.rsi <= 75) or (not long and 25 <= snap.rsi <= 45):
            pro.append(f"RSI {snap.rsi:.0f} : momentum sans excès.")
    e20, atr = snap.ema.get(20), snap.atr
    if e20 and atr:
        ext = (snap.close - e20) / atr * (1 if long else -1)
        if ext > 3:
            con.append(
                f"Prix étiré : {ext:.1f} ATR au-delà de l'EMA20 ; entrée moins "
                "favorable, stop large en valeur.".replace(".", ",", 1)
            )
    if snap.resistance and long and atr and snap.resistance.price - snap.close < atr:
        con.append(
            f"Résistance proche à {fmt_price(snap.resistance.price)} "
            f"({snap.resistance.touches} contact(s)), à moins d'1 ATR."
        )
    if snap.support and not long and atr and snap.close - snap.support.price < atr:
        con.append(f"Support proche à {fmt_price(snap.support.price)}, à moins d'1 ATR.")
    if c.size.capped:
        con.append(
            "Taille plafonnée par le capital : le risque réel est inférieur au risque "
            "prévu (stop trop serré pour du spot sans levier)."
        )
    if c.other_positions:
        n = len(c.other_positions) + 1
        con.append(
            f"Risque corrélé : position(s) déjà ouverte(s) selon la stratégie — "
            f"{', '.join(c.other_positions)}. BTC/ETH/SOL chutent ensemble : avec celle-ci, "
            f"≈ {fmt_num(n * c.size.risk_pct, 1)}{NNBSP}% du capital exposé au même choc "
            f"(plafond : {fmt_num(c.max_open_risk_pct, 1)}{NNBSP}%)."
        )
    else:
        con.append(
            "Corrélation : BTC, ETH et SOL évoluent ensemble ; une autre position ouverte "
            "sur l'un d'eux cumule le risque."
        )
    con.extend(c.profile_warnings)
    return pro, con


def format_report(c: AlertContext, events: list[RiskEvent]) -> str:
    s, snap, b = c.setup, c.snap, c.bar
    long = s.side is Side.LONG
    d = c.multi_tf.get(Timeframe.D1) or snap
    pro, con = confluences_and_risks(c)
    t = datetime.fromtimestamp(b.close_time_ms / 1000, UTC).strftime("%d/%m/%Y %H:%M UTC")
    atr_pct = snap.atr / snap.close if snap.atr else 0.0
    L: list[str] = [f"📋 RAPPORT — {('LONG' if long else 'SHORT')} {b.symbol} · {t}", ""]

    L.append("🎯 Thèse")
    if math.isinf(s.tp1_r):
        L.append(
            f"Clôture à {fmt_price(s.signal_close)} : {s.reason}. En suivi de tendance, on "
            "ne prédit pas le sommet : on prend la tendance quand elle se confirme, avec "
            "une perte limitée si c'est un faux départ, et on laisse courir sinon."
        )
    else:
        L.append(f"Clôture à {fmt_price(s.signal_close)} : {s.reason}.")
    L.append("")
    L.append("🧭 Contexte")
    L.append(f"• Régime journalier : {_regime(d)}")
    L.append(f"• Volatilité : ATR 14 = {fmt_price(snap.atr or 0)} ({fmt_pct(atr_pct)} du prix)")
    for tf in (Timeframe.D1, Timeframe.H4, Timeframe.H1):
        if c.multi_tf.get(tf) is not None:
            L.append(f"• {tf.value} : {_trend_word(c.multi_tf[tf])}")
    levels = []
    if snap.support:
        levels.append(f"support {fmt_price(snap.support.price)} ({snap.support.touches}×)")
    if snap.resistance:
        levels.append(f"résistance {fmt_price(snap.resistance.price)} ({snap.resistance.touches}×)")
    if levels:
        L.append("• Niveaux clés : " + ", ".join(levels))
    if snap.relvol is not None:
        L.append(
            f"• Volume : {snap.relvol:.2f}× la moyenne des 20 dernières bougies".replace(".", ",")
        )
    L.append("")
    L.append("✅ Confluences")
    L.extend(f"• {p}" for p in pro) if pro else L.append(
        "• Aucune confluence supplémentaire au signal de base."
    )
    L.append("")
    L.append("⚠️ Contre-arguments")
    L.extend(f"• {x}" for x in con)
    L.append("")
    L.append("🛑 Invalidation")
    L.append(
        f"Stop initial {fmt_price(s.stop)} ({fmt_pct(c.size.stop_distance_pct)} du prix) : "
        f"au-delà, la cassure a échoué et la thèse est fausse. Il est fixé AVANT l'entrée "
        "et ne s'éloigne jamais."
    )
    L.append("")
    L.append("🧰 Gestion")
    if math.isinf(s.tp1_r):
        L.append(
            f"• Pas de prise de profit fixe. Stop suiveur = plus {'bas' if long else 'haut'} "
            f"des {s.exit_channel} dernières bougies{_channel_note(c)}. Le stop retenu est "
            "toujours le plus protecteur des deux (initial ou suiveur), mis à jour chaque "
            "jour, jamais desserré."
        )
        L.append("• Pas de sortie temporelle : la position vit tant que la tendance tient.")
    else:
        L.append(
            f"• {s.tp1_frac:.0%} à +{s.tp1_r:g}R, puis stop au point mort et suiveur "
            f"{s.trail_atr:g} ATR ; sortie après {s.time_stop_bars} bougies sans TP1."
        )
    L.append("• Toute gestion différente (allègement, renforcement) n'a PAS été testée.")
    L.append("")
    L.append("📅 Événements à risque")
    if events:
        L.extend(
            f"• {e.when.strftime('%d/%m %H:%M')} UTC — {e.name}"
            + (f" ({e.impact})" if e.impact else "")
            for e in events
        )
    else:
        L.append(
            "• Aucun événement listé dans config/events.yaml sur la période "
            "(calendrier tenu à la main : vérifier FOMC, CPI, résultats)."
        )
    L.append("")
    if c.stats:
        st = c.stats
        L.append(
            f"📊 Backtest {_base_asset(b.symbol)} : {st.n} trades, win rate "
            f"{fmt_pct(st.win_rate, 0)}, espérance {fmt_r(st.expectancy_r)}, gain moyen "
            f"{fmt_r(st.avg_win_r)} / perte moyenne {fmt_r(st.avg_loss_r)}. Hors "
            f"échantillon : {st.oos_n} trades, {fmt_r(st.oos_expectancy_r)}. Petit "
            "échantillon par actif : chiffres indicatifs."
        )
    L.append("Aide à la décision : aucun ordre n'est passé automatiquement, c'est toi qui décides.")
    text = "\n".join(L)
    if len(text) > TELEGRAM_MAX:
        text = text[: TELEGRAM_MAX - 20] + "\n… (tronqué)"
    return text
