from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import yaml


@dataclass(frozen=True)
class Settings:
    symbol: str = "BOOM1000"
    websocket_url: str = "wss://api.derivws.com/trading/v1/options/ws/public"
    tick_buffer_size: int = 2_000
    history_count: int = 1_000
    prediction_horizon_ticks: int = 25
    signal_probability_threshold: float = 0.80
    max_feed_silence_seconds: float = 5.0
    max_tick_gap_seconds: float = 3.0
    max_daily_drawdown_percent: float = 1.0
    paper_balance: float = 1_000.0
    paper_risk_percent: float = 0.25
    storage_directory: str = "data"
    model_path: str = "models/boom1000_spike_model.joblib"


def load_settings(path: str | Path = "config.yaml") -> Settings:
    """Carga el YAML; si no existe, utiliza ajustes seguros por defecto."""
    file_path = Path(path)
    if not file_path.exists():
        return Settings()
    with file_path.open(encoding="utf-8") as source:
        data = yaml.safe_load(source) or {}
    valid = {field: value for field, value in data.items() if field in Settings.__dataclass_fields__}
    return Settings(**valid)
