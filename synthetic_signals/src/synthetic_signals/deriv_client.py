from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable

import websockets

from .domain import Tick

TickHandler = Callable[[Tick], Awaitable[None]]
StatusHandler = Callable[[str], None]


class DerivPublicTickClient:
    """Cliente de solo lectura. No admite authorize, buy ni endpoints de cuenta."""

    def __init__(self, url: str, symbol: str, history_count: int, on_tick: TickHandler, on_status: StatusHandler):
        self.url, self.symbol, self.history_count = url, symbol, history_count
        self.on_tick, self.on_status = on_tick, on_status

    async def run_forever(self) -> None:
        delay = 1
        while True:
            try:
                self.on_status("Conectando al feed público de Deriv")
                async with websockets.connect(self.url, ping_interval=20, ping_timeout=10, close_timeout=5) as socket:
                    delay = 1
                    # Solicita velas/ticks históricos para calentar el buffer y luego ticks vivos.
                    await socket.send(json.dumps({"ticks_history": self.symbol, "end": "latest", "count": self.history_count, "style": "ticks", "req_id": 1}))
                    await socket.send(json.dumps({"ticks": self.symbol, "subscribe": 1, "req_id": 2}))
                    self.on_status("Feed público conectado")
                    async for raw in socket:
                        message = json.loads(raw)
                        if message.get("error"):
                            raise RuntimeError(message["error"].get("message", "Error no especificado de Deriv"))
                        await self._dispatch(message)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.on_status(f"Feed desconectado: {error}; reintento en {delay}s")
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)

    async def _dispatch(self, message: dict) -> None:
        now = time.time()
        history = message.get("history")
        if history:
            for price, epoch in zip(history.get("prices", []), history.get("times", []), strict=True):
                await self.on_tick(Tick(self.symbol, float(epoch), float(price), now))
        tick = message.get("tick")
        if tick and tick.get("symbol", self.symbol) == self.symbol:
            await self.on_tick(Tick(self.symbol, float(tick["epoch"]), float(tick["quote"]), now))
