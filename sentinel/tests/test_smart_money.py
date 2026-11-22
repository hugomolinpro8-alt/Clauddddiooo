"""Phase 6 : la mécanique de sélection et de rejeu est vérifiée sur des cas calculables."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from sentinel.core.models import Market
from sentinel.smart_money.selection import (
    DAY_MS,
    CopyCosts,
    Criteria,
    PriceBook,
    copy_replay,
    evaluate,
    martingale_share,
    prefilter,
    track_record,
)
from sentinel.smart_money.service import SmartMoneyTracker, parse_positions
from sentinel.strategies.base import Side

NOW = int(datetime(2026, 11, 22, tzinfo=UTC).timestamp() * 1000)


def _portfolio(monthly_pnl: list[float], av: float = 1_000_000.0) -> dict[str, Any]:
    """Un point par mois, PnL cumulé."""
    start = NOW - len(monthly_pnl) * 30 * DAY_MS
    cum, pnl_hist, av_hist = 0.0, [], []
    for i, m in enumerate(monthly_pnl):
        t = start + i * 30 * DAY_MS
        cum += m
        pnl_hist.append([t, str(cum)])
        av_hist.append([t, str(av)])
    return {"perpAllTime": {"pnlHistory": pnl_hist, "accountValueHistory": av_hist}}


def test_track_record_regular_vs_one_big_hit() -> None:
    regular = track_record(_portfolio([0, 20e3, 15e3, -5e3, 25e3, 18e3, 22e3, -3e3, 30e3]), NOW)
    assert regular is not None
    assert regular.history_days >= 240
    assert regular.positive_months >= 0.6 and regular.best_month_share < 0.5
    lucky = track_record(_portfolio([0, -2e3, -3e3, 400e3, -1e3, -2e3, 1e3]), NOW)
    assert lucky is not None and lucky.best_month_share > 0.9  # un seul gros coup
    assert lucky.positive_months < 0.6


def test_drawdown_relative_to_account() -> None:
    r = track_record(_portfolio([0, 100e3, -400e3, 50e3]), NOW)
    assert r is not None and r.pnl_drawdown == pytest.approx(0.4)


def _fill(t: int, coin: str, side: str, sz: float, px: float, start: float) -> dict[str, Any]:
    return {
        "time": t,
        "coin": coin,
        "side": side,
        "sz": str(sz),
        "px": str(px),
        "startPosition": str(start),
    }


def test_martingale_detected() -> None:
    # long 1 à 100, renforce 1, 2, 4 en baissant : doublement de mise en perte
    mart = [
        _fill(1, "BTC", "B", 1, 100, 0),
        _fill(2, "BTC", "B", 1, 95, 1),
        _fill(3, "BTC", "B", 2, 90, 2),
        _fill(4, "BTC", "B", 4, 85, 4),
        _fill(5, "BTC", "A", 8, 88, 8),
    ]
    assert martingale_share(mart) == pytest.approx(1.0)
    # renforts dans le sens du gain (pyramide) : pas une martingale
    pyramid = [
        _fill(1, "BTC", "B", 2, 100, 0),
        _fill(2, "BTC", "B", 1, 105, 2),
        _fill(3, "BTC", "B", 1, 110, 3),
        _fill(4, "BTC", "A", 4, 112, 4),
    ]
    assert martingale_share(pyramid) == 0.0


def test_copy_replay_exact_pnl_with_delay_fees_and_min_size() -> None:
    """Eux : compte 100 000 $, long 1 BTC à 50 000 puis vente à 55 000.
    Moi : 3 000 $ → 0,03 BTC. Délai 60 s : j'achète au prix 1 min plus tard (50 100) et je
    vends 1 min plus tard (54 900)."""
    t0 = 1_000_000_000_000
    candles = {
        "BTC": [{"t": t0 + 60_000, "c": 50_100.0}, {"t": t0 + 3_600_000 + 60_000, "c": 54_900.0}]
    }
    fills = [_fill(t0, "BTC", "B", 1, 50_000, 0), _fill(t0 + 3_600_000, "BTC", "A", 1, 55_000, 1)]
    costs = CopyCosts(capital=3_000, taker_fee=0.0005, slippage=0.0)
    res = copy_replay(fills, [(t0 - 1, 100_000.0)], PriceBook(candles), costs)
    q = 0.03
    expected = q * (54_900 - 50_100) - 0.0005 * q * (50_100 + 54_900)
    assert res.trades == 2
    assert res.pnl == pytest.approx(expected)
    assert res.avg_leverage == pytest.approx(0.5, abs=0.3)
    # compte énorme → ma part tombe sous l'ordre minimum de 10 $ : non copiable
    tiny = copy_replay(fills, [(t0 - 1, 100_000_000.0)], PriceBook(candles), costs)
    assert tiny.trades == 0 and tiny.skipped_small == 2  # achat ET vente sous le minimum


def test_prefilter_and_evaluate() -> None:
    rows = [
        {
            "ethAddress": "0xgood",
            "accountValue": "500000",
            "windowPerformances": [
                ["month", {"roi": "0.02"}],
                ["allTime", {"pnl": "300000", "roi": "0.6", "vlm": "5e7"}],
            ],
        },
        {
            "ethAddress": "0xsmall",
            "accountValue": "5000",
            "windowPerformances": [
                ["month", {"roi": "0.5"}],
                ["allTime", {"pnl": "300000", "roi": "9", "vlm": "5e7"}],
            ],
        },
        {
            "ethAddress": "0xbleeding",
            "accountValue": "900000",
            "windowPerformances": [
                ["month", {"roi": "-0.3"}],
                ["allTime", {"pnl": "900000", "roi": "1", "vlm": "5e8"}],
            ],
        },
    ]
    out = prefilter(rows, Criteria(), 10)
    assert [o["address"] for o in out] == ["0xgood"]
    rec = track_record(_portfolio([0, 20e3, 15e3, -5e3, 25e3, 18e3, 22e3, -3e3, 30e3]), NOW)
    v = evaluate("0xgood", 5e5, rec, [], None, Criteria())
    assert not v.selected and v.checks["rejeu de copie"] is False  # jamais retenu sans rejeu


def test_tracker_view_same_and_opposite() -> None:
    state_long = {
        "assetPositions": [
            {
                "position": {
                    "coin": "BTC",
                    "szi": "2.0",
                    "entryPx": "60000",
                    "positionValue": "122000",
                    "leverage": {"type": "cross", "value": 5},
                    "liquidationPx": "48000",
                }
            }
        ]
    }
    state_short = {
        "assetPositions": [
            {
                "position": {
                    "coin": "BTC",
                    "szi": "-1.0",
                    "entryPx": "61000",
                    "positionValue": "61000",
                    "leverage": {"type": "cross", "value": 3},
                    "liquidationPx": None,
                }
            }
        ]
    }
    p = parse_positions(state_long)[0]
    assert p.side is Side.LONG and p.liq_distance() == pytest.approx((61000 - 48000) / 61000)
    tr = SmartMoneyTracker(None, ["0xaaaa1111", "0xbbbb2222", "0xcccc3333"])  # type: ignore[arg-type]
    tr.positions = {
        "0xaaaa1111": parse_positions(state_long),
        "0xbbbb2222": parse_positions(state_short),
        "0xcccc3333": [],
    }
    v = tr.view(Market.SPOT, "BTCUSDT", Side.LONG)
    assert v is not None and (v.same_side, v.opposite_side, v.tracked) == (1, 1, 3)
    assert "5×" in " ".join(v.details)
    assert tr.view(Market.SPOT, "ETHUSDT", Side.LONG).same_side == 0  # type: ignore[union-attr]
    assert SmartMoneyTracker(None, []).view(Market.SPOT, "BTCUSDT", Side.LONG) is None  # type: ignore[arg-type]


def test_twr_drawdown_ignores_deposits_and_withdrawals() -> None:
    """Compte qui gagne régulièrement +1 %/période, mais dont le propriétaire retire 90 % des
    fonds au milieu : le PnL cumulé reste croissant, l'indice aussi → drawdown nul.
    L'ancienne mesure (chute PnL / valeur médiane) ne voyait pas les retraits."""
    from sentinel.smart_money.selection import twr_drawdown

    av, pnl, cap, cum = [], [], 1_000_000.0, 0.0
    for i in range(20):
        if i == 10:
            cap *= 0.1  # retrait
        av.append((i, cap))
        pnl.append((i, cum))
        cum += 0.01 * cap
        cap *= 1.01
    assert twr_drawdown(av, pnl) == pytest.approx(0.0)
    # une vraie perte de 30 % du capital présent est bien mesurée
    av2 = [(0, 1e6), (1, 1e6), (2, 0.7e6)]
    pnl2 = [(0, 0.0), (1, 0.0), (2, -0.3e6)]
    assert twr_drawdown(av2, pnl2) == pytest.approx(0.3)


def test_martingale_share_bounded_with_preexisting_position() -> None:
    """Bug corrigé : une position ouverte AVANT la fenêtre doit compter comme épisode."""
    fills = [
        _fill(1, "BTC", "B", 1, 95, 5),
        _fill(2, "BTC", "B", 1, 90, 6),
        _fill(3, "BTC", "B", 2, 85, 7),
        _fill(4, "BTC", "A", 9, 88, 9),
    ]
    assert 0.0 <= martingale_share(fills) <= 1.0


def test_copy_gross_leverage_cap() -> None:
    t0 = 1_000_000_000_000
    candles = {"BTC": [{"t": t0 + 60_000, "c": 50_000.0}]}
    # leur compte « vaut » 1 000 $ mais ils ont 1 BTC (50×) : copie plafonnée à 3× mon capital
    fills = [_fill(t0, "BTC", "B", 1, 50_000, 0)]
    res = copy_replay(
        fills,
        [(t0 - 1, 1_000.0)],
        PriceBook(candles),
        CopyCosts(capital=3_000, slippage=0.0, max_gross_leverage=3.0),
    )
    assert res.capped == 1 and res.trades == 1
    assert res.fees == pytest.approx(9_000 * 0.00045)  # notionnel 9 000 $ = 3 × 3 000 $
