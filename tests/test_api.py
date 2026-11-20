"""API contract tests: lean list payloads, image on demand, live events, stats."""

import pytest
from fastapi.testclient import TestClient

import database


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", str(tmp_path / "test.db"))
    database.init_db()
    from server import app
    with TestClient(app) as c:
        yield c


def alert_payload(lat=31.2505, lon=75.7112, cls="Pothole", d=22.4, r=1.75, vehicle="PB-08-BUS-402"):
    return {
        "latitude": lat,
        "longitude": lon,
        "vehicle_id": vehicle,
        "vehicle_speed": 46.5,
        "anomaly_class": cls,
        "ward_id": "Ward 4 - GT Road NH-44",
        "road_name": "NH-44 Chaheru Flyover Northbound",
        "image_base64": "data:image/svg+xml;base64,PHN2Zy8+",
        "sensor_snapshot": {
            "imu_z_rms": 1.78,
            "gyro_x_peak": 26.4,
            "peak_frequency": 14.8,
            "kurtosis": 6.2,
            "suspension_deflection_d": d,
            "suspension_onset_rate_r": r,
            "visual_confidence": 0.96,
        },
    }


def test_list_omits_image_but_flags_it(client):
    client.post("/api/alerts", json=alert_payload())
    body = client.get("/api/alerts").json()
    assert body["count"] == 1
    alert = body["alerts"][0]
    assert "image_base64" not in alert
    assert alert["has_image"] is True
    assert alert["sensor_snapshot"]["suspension_deflection_d"] == 22.4


def test_detail_keeps_image(client):
    event_id = client.post("/api/alerts", json=alert_payload()).json()["event_id"]
    alert = client.get(f"/api/alerts/{event_id}").json()
    assert alert["image_base64"].startswith("data:image/svg+xml")
    assert alert["has_image"] is True


def test_ingest_response_and_broadcast_are_lean(client):
    with client.websocket_connect("/ws/live") as ws:
        res = client.post("/api/alerts", json=alert_payload())
        msg = ws.receive_json()
    assert res.status_code == 201
    assert "image_base64" not in res.json()["alert"]
    assert msg["type"] == "NEW_ALERT"
    assert "image_base64" not in msg["alert"]
    assert msg["alert"]["has_image"] is True


def test_duplicate_within_12m_confirms_instead_of_creating(client):
    client.post("/api/alerts", json=alert_payload(vehicle="A"))
    client.post("/api/alerts", json=alert_payload(lat=31.25055, vehicle="B"))  # ~5.5 m north
    res = client.post("/api/alerts", json=alert_payload(vehicle="C")).json()
    assert res["action"] == "de_duplicated_and_confirmed"
    assert res["confirmation_count"] == 3
    assert res["high_confidence"] is True
    assert client.get("/api/alerts").json()["count"] == 1


def test_patch_broadcasts_lean_status_change(client):
    event_id = client.post("/api/alerts", json=alert_payload()).json()["event_id"]
    with client.websocket_connect("/ws/live") as ws:
        updated = client.patch(f"/api/alerts/{event_id}", json={"status": "Dispatched", "assigned_crew": "Circle 3"}).json()
        msg = ws.receive_json()
    assert updated["status"] == "Dispatched"
    assert msg["type"] == "STATUS_CHANGE"
    assert "image_base64" not in msg["alert"]


def test_stats_counts(client):
    client.post("/api/alerts", json=alert_payload())  # S5 pothole
    client.post("/api/alerts", json=alert_payload(lat=31.26, cls="Manhole Cover", d=8.0, r=0.5))  # S2
    stats = client.get("/api/stats").json()
    assert stats["total_events"] == 2
    assert stats["total_potholes"] == 1
    assert stats["total_manholes"] == 1
    assert stats["critical_priority_count"] == 1
    assert stats["pending_dispatch_count"] == 2
    assert stats["avg_severity"] == 3.5


def test_empty_stats(client):
    stats = client.get("/api/stats").json()
    assert stats["total_events"] == 0
    assert stats["avg_severity"] == 0.0


def test_csv_and_geojson(client):
    client.post("/api/alerts", json=alert_payload())
    csv_res = client.get("/api/export/csv")
    assert csv_res.status_code == 200
    assert csv_res.text.splitlines()[0].startswith("Event ID,")
    geo = client.get("/api/alerts/geojson").json()
    assert geo["features"][0]["properties"]["has_image"] is True


def test_list_is_gzipped(client):
    for i in range(10):
        client.post("/api/alerts", json=alert_payload(lat=31.25 + i * 0.01))
    res = client.get("/api/alerts", headers={"Accept-Encoding": "gzip"})
    assert res.headers.get("content-encoding") == "gzip"


def test_patch_of_one_field_leaves_the_others(client):
    event_id = client.post("/api/alerts", json=alert_payload()).json()["event_id"]
    client.patch(f"/api/alerts/{event_id}", json={"status": "Dispatched"})
    updated = client.patch(f"/api/alerts/{event_id}", json={"notes": "Cones placed"}).json()
    assert updated["status"] == "Dispatched"
    assert updated["notes"] == "Cones placed"
