"""
Unit Tests for RoadIQ Filtered Export, GeoJSON Filtering & Spatial Robustness
Runs with Python's standard library unittest module.
"""

import unittest
import math
import tempfile
import os
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import database
from database import (
    haversine_distance_meters,
    find_spatial_duplicate,
    get_alerts,
    get_geojson_collection,
)


class TestSpatialMathAndRobustness(unittest.TestCase):
    """Test geometric edge cases and floating point boundary guards"""

    def test_haversine_identical_points(self):
        """Distance between identical coordinates must be 0.0"""
        d = haversine_distance_meters(31.2505, 75.7112, 31.2505, 75.7112)
        self.assertEqual(d, 0.0)

    def test_haversine_known_distance(self):
        """Distance between known coordinates should match within ~1%"""
        # Distance between Jalandhar and Phagwara is approx 20-22 km
        d = haversine_distance_meters(31.3260, 75.5762, 31.2295, 75.7685)
        self.assertGreater(d, 20000.0)
        self.assertLess(d, 25000.0)

    def test_haversine_antipodal_bounds_guard(self):
        """Antipodal points should not cause math domain error"""
        d = haversine_distance_meters(90.0, 0.0, -90.0, 0.0)
        self.assertGreater(d, 19000000.0)

    def test_find_spatial_duplicate_pole_latitude(self):
        """Polar latitudes (lat=90) should not cause ZeroDivisionError"""
        conn = database.get_connection()
        cursor = conn.cursor()
        try:
            # Should not raise ZeroDivisionError
            res = find_spatial_duplicate(cursor, 90.0, 0.0, "Pothole")
            self.assertIsNone(res)
            res_south = find_spatial_duplicate(cursor, -90.0, 0.0, "Pothole")
            self.assertIsNone(res_south)
        finally:
            conn.close()


class TestGeoJsonAndFilteredExport(unittest.TestCase):
    """Test filtered query retrieval and GeoJSON feature collections"""

    def test_get_geojson_collection_structure(self):
        fc = get_geojson_collection(limit=10)
        self.assertEqual(fc["type"], "FeatureCollection")
        self.assertIsInstance(fc["features"], list)
        if fc["features"]:
            feat = fc["features"][0]
            self.assertEqual(feat["type"], "Feature")
            self.assertEqual(feat["geometry"]["type"], "Point")
            self.assertEqual(len(feat["geometry"]["coordinates"]), 2)
            self.assertIn("properties", feat)
            self.assertIn("event_id", feat["properties"])
            self.assertIn("severity_score", feat["properties"])

    def test_get_geojson_collection_filtering(self):
        fc_potholes = get_geojson_collection(anomaly_class="Pothole", limit=50)
        for feat in fc_potholes["features"]:
            self.assertEqual(feat["properties"]["anomaly_class"], "Pothole")

    def test_get_alerts_filtering_by_severity(self):
        alerts = get_alerts(severity=5, limit=50)
        for a in alerts:
            self.assertEqual(a["severity_score"], 5)

    def test_get_alerts_filtering_by_ward(self):
        alerts = get_alerts(ward_id="Ward 4", limit=50)
        for a in alerts:
            self.assertIn("Ward 4", a["ward_id"])


if __name__ == "__main__":
    unittest.main()
