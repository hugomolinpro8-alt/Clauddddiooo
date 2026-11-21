from __future__ import annotations

from datetime import date

from sentinel.core.models import Market, Timeframe
from sentinel.data.archive import funding_urls, kline_urls, parse_funding_csv, parse_kline_csv


def test_parse_kline_csv_handles_header_and_microseconds() -> None:
    text = (
        "open_time,open,high,low,close,volume,close_time,qv,n,tb,tq,ignore\n"
        "1546300800000,3701.2,3713.0,3675.0,3693.1,2991.9,1546315199999,0,0,0,0,0\n"
        # format 2025+ du spot : microsecondes
        "1735689600000000,93576.0,94000.0,93000.0,93800.0,10.0,1735703999999999,0,0,0,0,0\n"
    )
    rows = parse_kline_csv(text)
    assert len(rows) == 2
    assert rows[0][0] == 1546300800000 and rows[0][5] == 3693.1
    assert rows[1][0] == 1735689600000 and rows[1][1] == 1735703999999


def test_parse_funding_csv() -> None:
    text = "calc_time,funding_interval_hours,last_funding_rate\n1790812800001,8,0.00007981\n"
    assert parse_funding_csv(text) == [(1790812800001, 0.00007981)]


def test_urls_monthly_then_daily_for_current_month() -> None:
    urls = kline_urls(Market.PERP, "BTCUSDT", Timeframe.H4, date(2026, 9, 1), date(2026, 11, 3))
    assert urls[0].endswith("futures/um/monthly/klines/BTCUSDT/4h/BTCUSDT-4h-2026-09.zip")
    assert urls[1].endswith("BTCUSDT-4h-2026-10.zip")
    assert urls[2].endswith("daily/klines/BTCUSDT/4h/BTCUSDT-4h-2026-11-01.zip")
    assert len(urls) == 4  # 09, 10, puis 1er et 2 novembre (le 3 n'est pas terminé)
    assert len(funding_urls("BTCUSDT", date(2026, 9, 1), date(2026, 11, 3))) == 2
