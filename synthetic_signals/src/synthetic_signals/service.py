from __future__ import annotations

from collections import deque
import json
import time
from typing import Deque

from .config import Settings
from .deriv_client import DerivPublicTickClient
from .domain import PaperSignal, Tick
from .features import BoomFeatureEngine
from .model import SpikeClassifier
from .risk import RiskManager
from .storage import ParquetTickStore


class PaperSignalService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.buffer: Deque[Tick] = deque(maxlen=settings.tick_buffer_size)
        self.classifier = SpikeClassifier(settings.model_path)
        # El mismo umbral aprendido en entrenamiento se reutiliza en producción.
        self.feature_engine = BoomFeatureEngine(spike_return_threshold=self.classifier.spike_threshold or 0.001)
        self.risk = RiskManager(settings.paper_balance, settings.paper_risk_percent, settings.max_daily_drawdown_percent, settings.max_feed_silence_seconds, settings.max_tick_gap_seconds)
        self.store = ParquetTickStore(settings.storage_directory)
        self.last_signal_at = 0.0

    def status(self, message: str) -> None:
        print(json.dumps({"type": "status", "message": message, "at": time.time()}))

    async def on_tick(self, tick: Tick) -> None:
        self.risk.observe_tick(tick.epoch, tick.received_at)
        self.buffer.append(tick)
        self.store.enqueue(tick)
        if not self.classifier.ready or not self.risk.healthy():
            return
        vector = self.feature_engine.build(self.buffer)
        if vector is None:
            return
        probability = self.classifier.probability(vector)
        if probability is None or probability < self.settings.signal_probability_threshold:
            return
        # Debounce: no repetir la misma señal en cada tick.
        if tick.epoch - self.last_signal_at < self.settings.prediction_horizon_ticks:
            return
        self.last_signal_at = tick.epoch
        signal = PaperSignal(self.settings.symbol, tick.epoch, probability, tick.price, self.risk.paper_risk_amount(), "Probabilidad ML sobre umbral; feed y riesgo válidos")
        print(json.dumps({"type": "paper_signal", **signal.to_record()}))

    async def watchdog(self) -> None:
        """Cierra el camino de señales si un socket queda abierto pero deja de entregar ticks."""
        while not self.risk.state.kill_switch:
            await __import__("asyncio").sleep(1)
            if self.buffer and not self.risk.healthy():
                self.status(f"KILL SWITCH: {self.risk.state.reason}")

    async def run(self) -> None:
        client = DerivPublicTickClient(self.settings.websocket_url, self.settings.symbol, self.settings.history_count, self.on_tick, self.status)
        await __import__("asyncio").gather(client.run_forever(), self.store.run(), self.watchdog())
