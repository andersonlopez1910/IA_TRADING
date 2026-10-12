from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import average_precision_score, brier_score_loss, precision_recall_fscore_support
from sklearn.model_selection import TimeSeriesSplit

from .domain import Tick
from .features import FEATURE_NAMES, build_feature_matrix, infer_spike_threshold


def label_future_spikes(prices: np.ndarray, horizon: int, threshold: float) -> np.ndarray:
    """Etiqueta positiva si el máximo retorno futuro supera el umbral entrenado."""
    labels = np.zeros(len(prices), dtype=int)
    for index in range(len(prices) - horizon):
        future_return = np.log(prices[index + 1:index + horizon + 1].max() / prices[index])
        labels[index] = int(future_return >= threshold)
    return labels


def load_ticks(input_path: str) -> list[Tick]:
    files = sorted(Path().glob(input_path))
    if not files:
        raise FileNotFoundError(f"No hay datos que coincidan con: {input_path}")
    frame = pd.concat([pd.read_parquet(file) for file in files], ignore_index=True)
    frame = frame.sort_values("epoch").drop_duplicates("epoch")
    return [Tick(str(row.symbol), float(row.epoch), float(row.price), float(row.received_at)) for row in frame.itertuples()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Entrena un clasificador de spikes sin fuga temporal.")
    parser.add_argument("--input", default="data/*.parquet")
    parser.add_argument("--output", default="models/boom1000_spike_model.joblib")
    parser.add_argument("--horizon", type=int, default=25)
    args = parser.parse_args()

    ticks = load_ticks(args.input)
    if len(ticks) < 5_000:
        raise ValueError("Se necesitan al menos 5.000 ticks; use una muestra histórica mayor para un modelo serio.")

    split_at = int(len(ticks) * 0.60)
    train_prices = np.asarray([tick.price for tick in ticks[:split_at]])
    threshold = infer_spike_threshold(train_prices)
    features, indices = build_feature_matrix(ticks, threshold)
    labels_by_tick = label_future_spikes(np.asarray([tick.price for tick in ticks]), args.horizon, threshold)
    labels = labels_by_tick[indices]

    # Split estrictamente cronológico: no barajar ticks.
    train_end = int(len(features) * 0.60)
    validation_end = int(len(features) * 0.80)
    x_train, y_train = features[:train_end], labels[:train_end]
    x_test, y_test = features[validation_end:], labels[validation_end:]
    if y_train.sum() < 20 or y_test.sum() < 5:
        raise ValueError("Muy pocos eventos positivos; amplíe la historia o ajuste el horizonte/umbral.")

    base = RandomForestClassifier(n_estimators=400, min_samples_leaf=10, max_features="sqrt", class_weight="balanced_subsample", n_jobs=-1, random_state=42)
    model = CalibratedClassifierCV(base, method="isotonic", cv=TimeSeriesSplit(n_splits=4))
    model.fit(x_train, y_train)
    probabilities = model.predict_proba(x_test)[:, 1]
    predictions = probabilities >= 0.80
    precision, recall, f1, _ = precision_recall_fscore_support(y_test, predictions, average="binary", zero_division=0)
    metrics = {
        "average_precision": float(average_precision_score(y_test, probabilities)),
        "brier_score": float(brier_score_loss(y_test, probabilities)),
        "precision_at_0.80": float(precision), "recall_at_0.80": float(recall),
        "f1_at_0.80": float(f1), "positive_rate_test": float(y_test.mean()),
        "samples_train": int(len(x_train)), "samples_test": int(len(x_test)),
    }
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "feature_names": FEATURE_NAMES, "spike_return_threshold": threshold, "horizon_ticks": args.horizon}, output)
    output.with_suffix(".metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps({"model": str(output), "threshold": threshold, **metrics}, indent=2))


if __name__ == "__main__":
    main()
