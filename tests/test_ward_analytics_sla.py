"""
Unit & Integration Tests for RoadIQ Ward Analytics & SLA Compliance Tracker
Runs with Python's standard unittest module against an isolated temporary SQLite DB.
"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import database
from severity import compute_sla_status, compute_ward_health_score, health_grade


class TestSlaAndHealthScoring(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 18, 12, 0, 0, tzinfo=timezone.utc)

    def test_sla_on_track_for_fresh_s5_alert(self):
        created = (self.now - timedelta(hours=2)).isoformat()
        sla = compute_sla_status(5, created, "New", now=self.now)
        self.assertEqual(sla["sla_hours"], 24)
        self.assertEqual(sla["sla_status"], "on_track")
        self.assertEqual(sla["sla_remaining_minutes"], 22 * 60)
        self.assertAlmostEqual(sla["sla_elapsed_pct"], 8.3, places=1)

    def test_sla_at_risk_within_last_quarter_window(self):
        # S-5 has 24h SLA -> 25% remaining is 6h; 20h elapsed leaves 4h -> at_risk
        created = (self.now - timedelta(hours=20)).isoformat()
        sla = compute_sla_status(5, created, "Dispatched", now=self.now)
        self.assertEqual(sla["sla_status"], "at_risk")
        self.assertEqual(sla["sla_remaining_minutes"], 4 * 60)

    def test_sla_breached_when_past_deadline(self):
        # S-4 has 48h SLA -> 60h elapsed is 12h overdue
        created = (self.now - timedelta(hours=60)).isoformat()
        sla = compute_sla_status(4, created, "New", now=self.now)
        self.assertEqual(sla["sla_hours"], 48)
        self.assertEqual(sla["sla_status"], "breached")
        self.assertEqual(sla["sla_remaining_minutes"], -12 * 60)
        self.assertGreater(sla["sla_elapsed_pct"], 100.0)

    def test_sla_met_when_resolved_and_supports_z_suffix(self):
        created = "2026-11-17T12:00:00Z"
        resolved = "2026-11-17T20:00:00Z"
        sla = compute_sla_status(5, created, "Resolved", resolved_at_iso=resolved, now=self.now)
        self.assertEqual(sla["sla_status"], "met")
        self.assertEqual(sla["sla_remaining_minutes"], 16 * 60)

    def test_ward_health_score_penalties_and_grades(self):
        self.assertEqual(compute_ward_health_score([]), 100.0)
        self.assertEqual(health_grade(85.0), "Good")
        self.assertEqual(health_grade(65.0), "Fair")
        self.assertEqual(health_grade(45.0), "Poor")
        self.assertEqual(health_grade(25.0), "Critical")

        # 1 open S-5 breached + high_confidence => 14 + 4 + 2 = 20 penalty => 80.0
        alerts = [{"severity_score": 5, "sla_status": "breached", "high_confidence": True}]
        self.assertEqual(compute_ward_health_score(alerts), 80.0)

        # Clamped at 0.0 under extreme defect load
        heavy = [{"severity_score": 5, "sla_status": "breached", "high_confidence": True}] * 10
        self.assertEqual(compute_ward_health_score(heavy), 0.0)


class TestWardAnalyticsDatabase(unittest.TestCase):
    def setUp(self):
        self.orig_db_path = database.DB_PATH
        self.temp_dir = tempfile.TemporaryDirectory()
        database.DB_PATH = os.path.join(self.temp_dir.name, "test_roadiq.db")
        database.init_db()
        self.now = datetime(2026, 11, 18, 12, 0, 0, tzinfo=timezone.utc)

        # Insert 4 realistic alerts across 2 wards
        sample_alerts = [
            {
                "event_id": "TEST-1",
                "timestamp": (self.now - timedelta(hours=36)).isoformat(),  # S-5 breached by 12h
                "latitude": 31.2505,
                "longitude": 75.7112,
                "vehicle_id": "PB-08-BUS-402",
                "vehicle_speed": 48.0,
                "anomaly_class": "Pothole",
                "severity_score": 5,
                "ward_id": "Ward 4 - GT Road NH-44",
                "road_name": "NH-44 Chaheru Flyover",
                "status": "New",
                "sensor_snapshot": {
                    "imu_z_rms": 2.1,
                    "peak_frequency": 15.0,
                    "suspension_deflection_d": 24.0,
                    "suspension_onset_rate_r": 1.8,
                },
            },
            {
                "event_id": "TEST-2",
                "timestamp": (self.now - timedelta(hours=42)).isoformat(),  # S-4 at_risk (6h left of 48h)
                "latitude": 31.2520,
                "longitude": 75.7130,
                "vehicle_id": "PB-09-PATROL-01",
                "vehicle_speed": 44.0,
                "anomaly_class": "Manhole Cover",
                "severity_score": 4,
                "ward_id": "Ward 4 - GT Road NH-44",
                "road_name": "NH-44 Service Lane",
                "status": "Dispatched",
                "sensor_snapshot": {
                    "imu_z_rms": 1.6,
                    "peak_frequency": 13.0,
                    "suspension_deflection_d": 18.0,
                    "suspension_onset_rate_r": 1.2,
                },
            },
            {
                "event_id": "TEST-3",
                "timestamp": (self.now - timedelta(hours=3)).isoformat(),  # S-2 on_track
                "latitude": 31.2536,
                "longitude": 75.7042,
                "vehicle_id": "PB-08-BUS-118",
                "vehicle_speed": 39.0,
                "anomaly_class": "Speed Bump",
                "severity_score": 2,
                "ward_id": "Ward 1 - LPU University Zone",
                "road_name": "LPU Main Gate Feeder",
                "status": "New",
                "sensor_snapshot": {
                    "imu_z_rms": 0.9,
                    "peak_frequency": 4.2,
                    "suspension_deflection_d": 8.0,
                    "suspension_onset_rate_r": 0.4,
                },
            },
            {
                "event_id": "TEST-4",
                "timestamp": (self.now - timedelta(hours=80)).isoformat(),  # Resolved => SLA met
                "latitude": 31.2560,
                "longitude": 75.7060,
                "vehicle_id": "PB-08-CAB-921",
                "vehicle_speed": 42.0,
                "anomaly_class": "Pothole",
                "severity_score": 3,
                "ward_id": "Ward 1 - LPU University Zone",
                "road_name": "LPU Approach Road",
                "status": "Resolved",
                "sensor_snapshot": {
                    "imu_z_rms": 1.2,
                    "peak_frequency": 11.0,
                    "suspension_deflection_d": 13.0,
                    "suspension_onset_rate_r": 0.8,
                },
            },
        ]

        for payload in sample_alerts:
            database.insert_or_deduplicate(payload)

    def tearDown(self):
        database.DB_PATH = self.orig_db_path
        self.temp_dir.cleanup()

    def test_ward_analytics_aggregation_and_sorting(self):
        analytics = database.get_ward_analytics(now=self.now)
        summary = analytics["corridor_summary"]

        self.assertEqual(summary["total_alerts"], 4)
        self.assertEqual(summary["open_alerts"], 3)
        self.assertEqual(summary["resolved_alerts"], 1)
        self.assertEqual(summary["sla_breached_count"], 1)
        self.assertEqual(summary["sla_at_risk_count"], 1)
        self.assertEqual(summary["sla_on_track_count"], 1)
        self.assertEqual(summary["sla_compliance_pct"], 75.0)

        # Ward 4 has worse health score than Ward 1 -> must appear first
        wards = analytics["wards"]
        self.assertEqual(len(wards), 2)
        self.assertEqual(wards[0]["ward_short"], "Ward 4")
        self.assertEqual(wards[1]["ward_short"], "Ward 1")
        self.assertLess(wards[0]["health_score"], wards[1]["health_score"])
        self.assertEqual(wards[0]["sla_breached"], 1)
        self.assertEqual(wards[0]["sla_at_risk"], 1)
        self.assertEqual(wards[1]["sla_breached"], 0)

        # Urgent SLA watchlist contains breached + at_risk, sorted most overdue first
        urgent = analytics["sla_alerts"]
        self.assertEqual(len(urgent), 2)
        self.assertEqual(urgent[0]["event_id"], "TEST-1")
        self.assertEqual(urgent[0]["sla_status"], "breached")
        self.assertEqual(urgent[1]["event_id"], "TEST-2")
        self.assertEqual(urgent[1]["sla_status"], "at_risk")

    def test_get_alerts_sla_status_filter_and_geojson_enrichment(self):
        resolved_only = database.get_alerts(sla_status="met")
        self.assertEqual(len(resolved_only), 1)
        self.assertEqual(resolved_only[0]["event_id"], "TEST-4")

        geojson = database.get_geojson_collection()
        self.assertEqual(len(geojson["features"]), 4)
        props = geojson["features"][0]["properties"]
        self.assertIn("sla_status", props)
        self.assertIn("sla_hours", props)
        self.assertIn("sla_deadline", props)
        self.assertIn("sla_remaining_minutes", props)

    def test_get_stats_uses_complete_aggregate(self):
        stats = database.get_stats()
        self.assertEqual(stats["total_events"], 4)
        self.assertEqual(stats["total_potholes"], 2)
        self.assertEqual(stats["total_manholes"], 1)
        self.assertEqual(stats["total_speed_bumps"], 1)
        self.assertEqual(stats["total_rough_patches"], 0)
        self.assertEqual(stats["critical_priority_count"], 2)
        self.assertEqual(stats["pending_dispatch_count"], 2)
        self.assertEqual(stats["in_repair_count"], 0)
        self.assertEqual(stats["resolved_count"], 1)
        self.assertEqual(stats["avg_severity"], 3.5)


if __name__ == "__main__":
    unittest.main()
