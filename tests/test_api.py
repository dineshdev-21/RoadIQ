"""
tests/test_api.py
Integration tests for the FastAPI server.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

SAMPLE_SENSOR = {
    "vehicle_speed": 45.0,
    "imu_z_rms": 1.5,
    "gyro_x_peak": 22.0,
    "peak_frequency": 14.0,
    "kurtosis": 5.5,
    "suspension_deflection_d": 18.0,
    "suspension_onset_rate_r": 1.2,
    "visual_confidence": 0.94,
}

VALID_ALERT = {
    "latitude": 31.3260,
    "longitude": 75.5762,
    "vehicle_speed": 48.5,
    "anomaly_class": "Pothole",
    "sensor_snapshot": {
        "imu_z_rms": 1.5,
        "gyro_x_peak": 22.0,
        "peak_frequency": 14.0,
        "kurtosis": 5.5,
        "suspension_deflection_d": 18.0,
        "suspension_onset_rate_r": 1.2,
        "visual_confidence": 0.94,
    }
}


# ---------------------------------------------------------------------------
# 1. Health endpoint
# ---------------------------------------------------------------------------
def test_health_endpoint():
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "healthy"


# ---------------------------------------------------------------------------
# 2. Alerts listing
# ---------------------------------------------------------------------------
def test_alerts_endpoint():
    r = client.get("/api/alerts")
    assert r.status_code == 200
    data = r.json()
    assert "alerts" in data


# ---------------------------------------------------------------------------
# 3. Stats endpoint
# ---------------------------------------------------------------------------
def test_stats_endpoint():
    r = client.get("/api/stats")
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# 4. predict-risk valid input → 200 or 503 (model may not be trained)
# ---------------------------------------------------------------------------
def test_predict_risk_valid():
    r = client.post("/api/predict-risk", json=SAMPLE_SENSOR)
    assert r.status_code in (200, 503), (
        f"Expected 200 or 503, got {r.status_code}: {r.text}"
    )
    if r.status_code == 200:
        data = r.json()
        assert "predicted_risk" in data, "Response missing 'predicted_risk' key"


# ---------------------------------------------------------------------------
# 5. predict-risk invalid input → 422
# ---------------------------------------------------------------------------
def test_predict_risk_invalid_input():
    # Missing required fields (vehicle_speed, imu_z_rms, peak_frequency, etc.)
    r = client.post("/api/predict-risk", json={"vehicle_speed": 50.0})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 6. GeoJSON endpoint
# ---------------------------------------------------------------------------
def test_geojson_endpoint():
    r = client.get("/api/alerts/geojson")
    assert r.status_code == 200
    data = r.json()
    assert data.get("type") == "FeatureCollection"


# ---------------------------------------------------------------------------
# 7. Original ingest endpoint
# ---------------------------------------------------------------------------
def test_original_ingest():
    r = client.post("/api/alerts", json=VALID_ALERT)
    assert r.status_code == 201
