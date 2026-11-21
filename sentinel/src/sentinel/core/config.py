"""Configuration : paramètres non secrets en YAML, secrets uniquement via l'environnement (.env).

Les secrets sont typés `SecretStr` : `print(settings)` ou un log affichent `**********`,
jamais la valeur. Il faut appeler `.get_secret_value()` explicitement pour l'utiliser.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from sentinel.core.models import Market, Timeframe


class BinanceEndpoints(BaseModel):
    spot_ws: str = "wss://stream.binance.com:9443"
    spot_rest: str = "https://api.binance.com"
    perp_ws: str = "wss://fstream.binance.com"
    perp_rest: str = "https://fapi.binance.com"

    def ws(self, market: Market) -> str:
        return self.spot_ws if market is Market.SPOT else self.perp_ws

    def rest(self, market: Market) -> str:
        return self.spot_rest if market is Market.SPOT else self.perp_rest


class FeedConfig(BaseModel):
    stale_after_s: float = Field(60.0, gt=0, description="Silence max avant alerte FLUX COUPÉ")
    reconnect_min_backoff_s: float = Field(0.5, gt=0)
    reconnect_max_backoff_s: float = Field(30.0, gt=0)
    ping_interval_s: float = Field(20.0, gt=0)


class HistoryConfig(BaseModel):
    warmup_bars: int = Field(500, ge=50)
    cache_dir: Path = Path("data/cache")


class IndicatorConfig(BaseModel):
    ema_periods: list[int] = [20, 50, 200]
    sma_periods: list[int] = [20]
    rsi_period: int = 14
    macd: tuple[int, int, int] = (12, 26, 9)
    atr_period: int = 14
    bb_period: int = 20
    bb_k: float = 2.0
    relvol_period: int = 20
    hl_lookback: int = 20
    swing_k: int = 3
    sr_tolerance_pct: float = 0.4
    sr_max_levels: int = 12


class LatencyConfig(BaseModel):
    target_ms: float = 500.0


class RiskConfig(BaseModel):
    capital_eur: float = Field(3000.0, gt=0)
    risk_per_trade_pct: float = Field(0.5, gt=0, le=2.0)
    max_drawdown_pct: float = Field(10.0, gt=0)


class AppConfig(BaseModel):
    watchlist: list[str] = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    markets: list[Market] = [Market.SPOT, Market.PERP]
    timeframes: list[Timeframe] = [Timeframe.M15, Timeframe.H1, Timeframe.H4, Timeframe.D1]
    signal_mode: Literal["close", "intrabar"] = "close"
    binance: BinanceEndpoints = BinanceEndpoints()
    feed: FeedConfig = FeedConfig()
    history: HistoryConfig = HistoryConfig()
    indicators: IndicatorConfig = IndicatorConfig()
    latency: LatencyConfig = LatencyConfig()
    risk: RiskConfig = RiskConfig()

    @field_validator("watchlist")
    @classmethod
    def _upper(cls, v: list[str]) -> list[str]:
        return [s.strip().upper() for s in v]


class Secrets(BaseSettings):
    """Lu depuis les variables d'environnement / fichier .env — jamais depuis le YAML."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    telegram_bot_token: SecretStr | None = None
    telegram_chat_id: str | None = None


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(*paths: Path | str) -> AppConfig:
    """Charge et fusionne un ou plusieurs YAML (le dernier l'emporte)."""
    data: dict[str, Any] = {}
    for p in paths:
        loaded = yaml.safe_load(Path(p).read_text(encoding="utf-8")) or {}
        if not isinstance(loaded, dict):
            raise ValueError(f"{p}: la racine YAML doit être un dictionnaire")
        data = _deep_merge(data, loaded)
    return AppConfig.model_validate(data)
