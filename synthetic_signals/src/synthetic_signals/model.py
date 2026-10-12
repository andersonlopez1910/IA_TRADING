from __future__ import annotations

from pathlib import Path
import joblib
import numpy as np


class SpikeClassifier:
    """Carga un modelo previamente entrenado; no inventa probabilidades si falta."""

    def __init__(self, path: str):
        self.path = Path(path)
        self.bundle = joblib.load(self.path) if self.path.exists() else None

    @property
    def ready(self) -> bool:
        return self.bundle is not None

    @property
    def spike_threshold(self) -> float | None:
        if not self.bundle:
            return None
        return float(self.bundle["spike_return_threshold"])

    def probability(self, vector: np.ndarray) -> float | None:
        if not self.bundle:
            return None
        return float(self.bundle["model"].predict_proba(vector.reshape(1, -1))[0, 1])
