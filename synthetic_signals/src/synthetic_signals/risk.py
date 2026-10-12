from __future__ import annotations

from dataclasses import dataclass
import time


@dataclass
class RiskState:
    daily_pnl: float = 0.0
    kill_switch: bool = False
    reason: str = ""


class RiskManager:
    """Fail closed: cualquier anomalía bloquea señales, no abre posiciones."""

    def __init__(self, balance: float, risk_percent: float, max_daily_drawdown_percent: float, max_feed_silence_seconds: float, max_tick_gap_seconds: float):
        self.balance = balance
        self.risk_percent = risk_percent
        self.max_daily_drawdown_percent = max_daily_drawdown_percent
        self.max_feed_silence_seconds = max_feed_silence_seconds
        self.max_tick_gap_seconds = max_tick_gap_seconds
        self.state = RiskState()
        self.last_tick_received_at = 0.0
        self.last_tick_epoch: float | None = None

    def observe_tick(self, epoch: float, received_at: float) -> None:
        if self.last_tick_epoch is not None and epoch < self.last_tick_epoch:
            self.trip("Tick fuera de orden")
        if self.last_tick_epoch is not None and epoch - self.last_tick_epoch > self.max_tick_gap_seconds:
            self.trip("Hueco excesivo en el flujo de ticks")
        self.last_tick_epoch = epoch
        self.last_tick_received_at = received_at

    def update_paper_pnl(self, amount: float) -> None:
        self.state.daily_pnl += amount
        if abs(min(self.state.daily_pnl, 0.0)) / self.balance >= self.max_daily_drawdown_percent / 100:
            self.trip("Límite de pérdida diaria alcanzado")

    def trip(self, reason: str) -> None:
        self.state.kill_switch = True
        self.state.reason = reason

    def healthy(self) -> bool:
        if self.state.kill_switch:
            return False
        if time.time() - self.last_tick_received_at > self.max_feed_silence_seconds:
            self.trip("Feed de ticks obsoleto")
            return False
        return True

    def paper_risk_amount(self) -> float:
        return self.balance * self.risk_percent / 100
