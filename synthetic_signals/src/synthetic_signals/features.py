from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Sequence

import numpy as np

from .domain import Tick
from .indicators import atr_from_ticks, ema, rsi

FEATURE_NAMES = [
    "return_1", "return_3", "return_5", "return_10", "return_20",
    "price_to_ema_5", "price_to_ema_13", "price_to_ema_34",
    "rsi_7", "rsi_14", "realized_vol_20", "zscore_50", "range_50",
    "atr_proxy_14", "ticks_since_spike", "tick_velocity", "tick_gap_std",
    "last_spike_magnitude", "drawdown_from_50_high",
]


@dataclass
class FeatureState:
    last_spike_index: int | None = None
    last_spike_magnitude: float = 0.0


class BoomFeatureEngine:
    """Genera features causales: nunca utiliza ticks futuros."""

    def __init__(self, spike_return_threshold: float):
        self.spike_return_threshold = spike_return_threshold
        self.state = FeatureState()

    @staticmethod
    def required_ticks() -> int:
        return 55

    def build(self, ticks: Sequence[Tick]) -> np.ndarray | None:
        if len(ticks) < self.required_ticks():
            return None
        prices = np.asarray([tick.price for tick in ticks], dtype=float)
        epochs = np.asarray([tick.epoch for tick in ticks], dtype=float)
        log_returns = np.diff(np.log(prices))
        last_return = float(log_returns[-1])
        index = len(ticks) - 1

        # El spike se marca por un umbral derivado del set de entrenamiento.
        if last_return >= self.spike_return_threshold:
            self.state.last_spike_index = index
            self.state.last_spike_magnitude = last_return

        recent_50 = prices[-50:]
        gaps = np.diff(epochs[-50:])
        ticks_since_spike = index - self.state.last_spike_index if self.state.last_spike_index is not None else len(ticks)
        high_50 = recent_50.max()
        vector = np.array([
            log_returns[-1], log_returns[-3:].sum(), log_returns[-5:].sum(),
            log_returns[-10:].sum(), log_returns[-20:].sum(),
            prices[-1] - ema(prices[-5:], 5),
            prices[-1] - ema(prices[-13:], 13),
            prices[-1] - ema(prices[-34:], 34),
            rsi(prices, 7), rsi(prices, 14),
            log_returns[-20:].std(),
            (prices[-1] - recent_50.mean()) / (recent_50.std() + 1e-12),
            recent_50.max() - recent_50.min(),
            atr_from_ticks(prices, 14),
            float(ticks_since_spike),
            1.0 / (gaps.mean() + 1e-12),
            gaps.std(), self.state.last_spike_magnitude,
            (prices[-1] - high_50) / (high_50 + 1e-12),
        ], dtype=float)
        return vector


def infer_spike_threshold(prices: np.ndarray, quantile: float = 0.995) -> float:
    """El umbral se aprende solo sobre entrenamiento, no se codifica como '30 pips'."""
    returns = np.diff(np.log(prices.astype(float)))
    return float(np.quantile(returns, quantile))


def build_feature_matrix(ticks: Sequence[Tick], spike_threshold: float) -> tuple[np.ndarray, np.ndarray]:
    engine = BoomFeatureEngine(spike_threshold)
    rows: list[np.ndarray] = []
    indices: list[int] = []
    buffer: deque[Tick] = deque(maxlen=2_000)
    for index, tick in enumerate(ticks):
        buffer.append(tick)
        vector = engine.build(buffer)
        if vector is not None:
            rows.append(vector)
            indices.append(index)
    return np.asarray(rows), np.asarray(indices, dtype=int)
