import time
import unittest

from synthetic_signals.domain import Tick
from synthetic_signals.features import BoomFeatureEngine
from synthetic_signals.risk import RiskManager


class FeatureAndRiskTests(unittest.TestCase):
    def test_feature_vector_has_expected_length(self):
        now = time.time()
        ticks = [Tick("BOOM1000", now + index, 1000 + index * 0.01, now + index) for index in range(60)]
        vector = BoomFeatureEngine(0.002).build(ticks)
        self.assertIsNotNone(vector)
        self.assertEqual(vector.shape, (19,))

    def test_out_of_order_tick_trips_kill_switch(self):
        risk = RiskManager(1000, 0.25, 1, 5, 10)
        risk.observe_tick(100, time.time())
        risk.observe_tick(99, time.time())
        self.assertTrue(risk.state.kill_switch)

    def test_daily_drawdown_trips_kill_switch(self):
        risk = RiskManager(1000, 0.25, 1, 5, 10)
        risk.update_paper_pnl(-10)
        self.assertTrue(risk.state.kill_switch)


if __name__ == "__main__":
    unittest.main()
