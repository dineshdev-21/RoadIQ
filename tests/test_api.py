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


# ---------------------------------------------------------------------------
# 8. Single alert fetch + 404
# ---------------------------------------------------------------------------
def test_fetch_alert_detail():
    # Ingest an alert to ensure at least one exists
    ingest = client.post("/api/alerts", json=VALID_ALERT)
    assert ingest.status_code == 201
    event_id = ingest.json()["event_id"]

    r = client.get(f"/api/alerts/{event_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["event_id"] == event_id

    # 404 for missing alert
    r_missing = client.get("/api/alerts/nonexistent-event-id")
    assert r_missing.status_code == 404


# ---------------------------------------------------------------------------
# 9. Alert status patch + 404
# ---------------------------------------------------------------------------
def test_patch_alert():
    ingest = client.post("/api/alerts", json=VALID_ALERT)
    assert ingest.status_code == 201
    event_id = ingest.json()["event_id"]

    patch_r = client.patch(
        f"/api/alerts/{event_id}",
        json={"status": "In Repair", "notes": "Dispatched crew PB-PW-03"}
    )
    assert patch_r.status_code == 200
    patched_data = patch_r.json()
    assert patched_data["status"] == "In Repair"

    patch_missing = client.patch(
        "/api/alerts/nonexistent-event-id",
        json={"status": "Resolved"}
    )
    assert patch_missing.status_code == 404


# ---------------------------------------------------------------------------
# 10. Alert delete + 404
# ---------------------------------------------------------------------------
def test_delete_alert():
    ingest = client.post("/api/alerts", json=VALID_ALERT)
    assert ingest.status_code == 201
    event_id = ingest.json()["event_id"]

    del_r = client.delete(f"/api/alerts/{event_id}")
    assert del_r.status_code == 200
    assert del_r.json()["deleted_id"] == event_id

    # Deleting again should yield 404
    del_r2 = client.delete(f"/api/alerts/{event_id}")
    assert del_r2.status_code == 404


# ---------------------------------------------------------------------------
# 11. Export CSV endpoint
# ---------------------------------------------------------------------------
def test_export_csv():
    r = client.get("/api/export/csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    assert "attachment" in r.headers.get("content-disposition", "")
    assert "Event ID" in r.text


# ---------------------------------------------------------------------------
# 12. Export GeoJSON endpoint
# ---------------------------------------------------------------------------
def test_export_geojson():
    r = client.get("/api/export/geojson")
    assert r.status_code == 200
    assert "application/geo+json" in r.headers.get("content-type", "")
    assert "attachment" in r.headers.get("content-disposition", "")
    data = r.json()
    assert data.get("type") == "FeatureCollection"
    assert "features" in data


# ---------------------------------------------------------------------------
# 13. Ward analytics endpoint
# ---------------------------------------------------------------------------
def test_ward_analytics():
    r = client.get("/api/analytics/wards")
    assert r.status_code == 200
    data = r.json()
    assert "corridor_summary" in data
    assert "wards" in data


# ---------------------------------------------------------------------------
# 14. Reseed endpoint
# ---------------------------------------------------------------------------
def test_reseed_endpoint():
    r = client.post("/api/seed")
    assert r.status_code == 200
    assert r.json().get("status") == "success"
