from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Tick:
    symbol: str
    epoch: float
    price: float
    received_at: float

    def to_record(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class PaperSignal:
    symbol: str
    timestamp: float
    probability: float
    price: float
    risk_amount: float
    reason: str
    mode: str = "PAPER_ONLY"

    def to_record(self) -> dict:
        return asdict(self)
