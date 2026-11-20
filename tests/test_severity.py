"""
RoadIQ Severity Estimation & Municipal Triage Unit Tests
Verifies mathematical formulation S = clip(round(0.15 * D + 2.0 * R), 1, 5),
depth proxy calibration, and municipal SLA priority mappings.
Compatible with both pytest and standard library unittest.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from severity import calculate_severity, get_severity_info, SEVERITY_MAPPING

class TestSeverityCalculation(unittest.TestCase):
    """Test mathematical bounds, clipping, and depth proxy calculation"""

    def test_lower_bound_clipping(self):
        """Minimum severity must be clipped to 1 even with 0 or negative inputs"""
        score, label, action, flagged, depth = calculate_severity(d_mm=0.0, r_mm_ms=0.0)
        self.assertEqual(score, 1)
        self.assertEqual(label, "Minor")
        self.assertFalse(flagged)
        self.assertGreaterEqual(depth, 1.0)

    def test_negative_inputs_clipping(self):
        """Negative deflection/rate should be clipped to minimum severity 1"""
        score, label, action, flagged, depth = calculate_severity(d_mm=-10.0, r_mm_ms=-2.0)
        self.assertEqual(score, 1)
        self.assertEqual(label, "Minor")
        self.assertFalse(flagged)
        self.assertGreaterEqual(depth, 1.0)

    def test_upper_bound_clipping(self):
        """Maximum severity must be clipped to 5 for massive potholes"""
        score, label, action, flagged, depth = calculate_severity(d_mm=50.0, r_mm_ms=5.0)
        self.assertEqual(score, 5)
        self.assertEqual(label, "Critical")
        self.assertTrue(flagged)

    def test_critical_severity_threshold(self):
        """Verify severity 5 threshold (e.g. D=24.0mm, R=1.8mm/ms)"""
        # raw = 0.15 * 24.0 + 2.0 * 1.8 = 3.6 + 3.6 = 7.2 -> round = 7 -> clip = 5
        score, label, action, flagged, depth = calculate_severity(d_mm=24.0, r_mm_ms=1.8)
        self.assertEqual(score, 5)
        self.assertEqual(label, "Critical")
        self.assertTrue(flagged)
        self.assertGreater(depth, 5.0)

    def test_high_severity_threshold(self):
        """Verify severity 4 threshold (e.g. D=18.0mm, R=1.2mm/ms)"""
        score, label, action, flagged, depth = calculate_severity(d_mm=18.0, r_mm_ms=0.6)
        # raw = 2.7 + 1.2 = 3.9 -> round = 4
        self.assertEqual(score, 4)
        self.assertEqual(label, "High")
        self.assertTrue(flagged)

    def test_medium_and_low_severity_thresholds(self):
        """Verify severity 2 and 3 thresholds"""
        # S=2: D=8.0, R=0.4 -> raw = 1.2 + 0.8 = 2.0 -> round = 2
        score2, label2, _, flagged2, _ = calculate_severity(d_mm=8.0, r_mm_ms=0.4)
        self.assertEqual(score2, 2)
        self.assertEqual(label2, "Low")
        self.assertFalse(flagged2)

        # S=3: D=12.0, R=0.6 -> raw = 1.8 + 1.2 = 3.0 -> round = 3
        score3, label3, _, flagged3, _ = calculate_severity(d_mm=12.0, r_mm_ms=0.6)
        self.assertEqual(score3, 3)
        self.assertEqual(label3, "Medium")
        self.assertFalse(flagged3)

    def test_depth_proxy_formula(self):
        """Depth proxy must follow calibrated OLS: depth = round(max(1.0, 0.22*D + 0.5*R), 1)"""
        d = 20.0
        r = 1.4
        expected_depth = round(max(1.0, 0.22 * d + 0.5 * r), 1)
        _, _, _, _, depth = calculate_severity(d, r)
        self.assertEqual(depth, expected_depth)


class TestSeverityMetadata(unittest.TestCase):
    """Test municipal SLA mappings and color codes"""

    def test_all_severity_levels_defined(self):
        for s in range(1, 6):
            info = get_severity_info(s)
            self.assertIn("label", info)
            self.assertIn("action", info)
            self.assertIn("badge_color", info)
            self.assertIn("flagged", info)
            self.assertIn("sla_hours", info)

    def test_critical_sla_is_24_hours(self):
        info = get_severity_info(5)
        self.assertEqual(info["sla_hours"], 24)
        self.assertTrue(info["flagged"])

    def test_high_sla_is_48_hours(self):
        info = get_severity_info(4)
        self.assertEqual(info["sla_hours"], 48)
        self.assertTrue(info["flagged"])

    def test_fallback_for_unknown_severity(self):
        """Unknown severity level defaults to level 1"""
        info = get_severity_info(99)
        self.assertEqual(info["label"], "Minor")


if __name__ == "__main__":
    unittest.main()
