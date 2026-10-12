from __future__ import annotations

import numpy as np


def ema(values: np.ndarray, period: int) -> float:
    if values.size == 0:
        return float("nan")
    alpha = 2.0 / (period + 1.0)
    result = float(values[0])
    for value in values[1:]:
        result = alpha * float(value) + (1.0 - alpha) * result
    return result


def rsi(values: np.ndarray, period: int = 14) -> float:
    if values.size <= period:
        return 50.0
    delta = np.diff(values[-(period + 1):])
    average_gain = np.maximum(delta, 0).mean()
    average_loss = np.maximum(-delta, 0).mean()
    if average_loss <= 1e-12:
        return 100.0
    return float(100.0 - 100.0 / (1.0 + average_gain / average_loss))


def atr_from_ticks(values: np.ndarray, period: int = 14) -> float:
    """Proxy ATR: los ticks no incluyen OHLC; usa cambios absolutos de precio."""
    if values.size <= 1:
        return 0.0
    return float(np.abs(np.diff(values[-(period + 1):])).mean())
