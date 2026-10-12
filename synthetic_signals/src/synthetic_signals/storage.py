from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from .domain import Tick


class ParquetTickStore:
    """Escritura por lotes fuera del camino crítico de ticks."""

    def __init__(self, directory: str, flush_size: int = 500):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.flush_size = flush_size
        self.queue: asyncio.Queue[Tick] = asyncio.Queue(maxsize=10_000)
        self._part = 0

    def enqueue(self, tick: Tick) -> None:
        try:
            self.queue.put_nowait(tick)
        except asyncio.QueueFull:
            # El sistema debe degradar con seguridad antes que bloquear la ingesta.
            pass

    async def run(self) -> None:
        batch: list[dict] = []
        while True:
            try:
                tick = await asyncio.wait_for(self.queue.get(), timeout=2.0)
                batch.append(tick.to_record())
            except TimeoutError:
                pass
            if len(batch) >= self.flush_size or (batch and self.queue.empty()):
                stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
                path = self.directory / f"ticks-{stamp}-{self._part:04d}.parquet"
                await asyncio.to_thread(pd.DataFrame(batch).to_parquet, path, index=False)
                self._part += 1
                batch.clear()
