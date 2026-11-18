"""
RoadIQ Municipal REST API & WebSocket Server
FastAPI backend with real-time alert feed, GIS GeoJSON export, and edge simulator
"""

import json
import csv
import io
import random
from typing import List, Optional
from datetime import datetime, timezone
import uuid

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
import os

from models import AlertCreate, AlertUpdate, AlertResponse, MunicipalStats, WardAnalyticsResponse
from database import (
    insert_or_deduplicate,
    get_alerts,
    get_alert_by_id,
    update_alert,
    delete_alert,
    get_stats,
    get_geojson_collection,
    get_ward_analytics,
    init_db
)
from seed_data import seed_database, LOCATIONS, VEHICLE_FLEET, generate_svg_defect_image
from severity import calculate_severity
from pydantic import BaseModel, Field as PydanticField

# Predictive Risk Intelligence imports (loaded lazily — model may not exist yet)
try:
    from ml.predict import RiskPredictor
    from ml.model import XGB_MODEL_PATH
    _ML_AVAILABLE = True
except ImportError:
    _ML_AVAILABLE = False
    XGB_MODEL_PATH = "models/xgb_risk_model.joblib"

app = FastAPI(
    title="RoadIQ Municipal Command Center API",
    description="Multi-Sensor Fusion Edge AI Pothole Detection & Municipal Reporting Framework",
    version="1.0.0"
)

# Enable CORS for dashboard and external clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections for live push notifications
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        for dead in dead_connections:
            self.disconnect(dead)

manager = ConnectionManager()

# Predictive Risk Intelligence - loaded once at startup
risk_predictor: Optional[RiskPredictor if _ML_AVAILABLE else object] = None  # type: ignore

# Mount static assets
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.on_event("startup")
def on_startup():
    global risk_predictor
    init_db()
    # Predictive Risk Intelligence — initialise if ML module is available
    if _ML_AVAILABLE:
        import os as _os
        model_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), XGB_MODEL_PATH)
        risk_predictor = RiskPredictor(model_path=model_path)
    else:
        risk_predictor = None

@app.get("/", response_class=HTMLResponse)
async def serve_dashboard():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>RoadIQ API is running. Place index.html in /static</h1>")

# ---------------------------------------------------------------------------
# Predictive Risk Intelligence — Request model
# ---------------------------------------------------------------------------
class RiskPredictionRequest(BaseModel):
    vehicle_speed: float = PydanticField(..., ge=0, le=180, description="Vehicle speed in km/h")
    imu_z_rms: float = PydanticField(..., ge=0, description="Z-axis RMS acceleration in g")
    gyro_x_peak: float = PydanticField(0.0, description="Gyro X peak in deg/s")
    peak_frequency: float = PydanticField(..., ge=0, description="FFT peak frequency in Hz")
    kurtosis: float = PydanticField(3.0, description="Spectral kurtosis")
    suspension_deflection_d: float = PydanticField(..., ge=0, description="Suspension deflection in mm")
    suspension_onset_rate_r: float = PydanticField(..., ge=0, description="Suspension onset rate in mm/ms")
    visual_confidence: float = PydanticField(0.92, ge=0.0, le=1.0, description="Visual model confidence")

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "RoadIQ Municipal Command Center",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "edge_sync_protocol": "MPU-6050 200 Hz Interrupt / 500us Window",
        "model_architecture": "MobileNetV2 (1280) + IMU (12) + Susp (4) -> XGBoost (1296D)"
    }

@app.get("/api/stats", response_model=MunicipalStats)
def fetch_stats():
    return get_stats()

@app.get("/api/analytics/wards", response_model=WardAnalyticsResponse)
def fetch_ward_analytics():
    """Returns per-ward Road Health Scores, SLA compliance breakdown, and overdue escalation watchlist"""
    return get_ward_analytics()

@app.get("/api/alerts")
def list_alerts(
    severity: Optional[int] = Query(None, ge=1, le=5, description="Filter by severity 1-5"),
    anomaly_class: Optional[str] = Query(None, description="Pothole, Manhole Cover, Speed Bump, Rough Patch"),
    ward_id: Optional[str] = Query(None, description="Filter by ward name or circle"),
    status: Optional[str] = Query(None, description="New, Under Review, Dispatched, In Repair, Resolved"),
    search: Optional[str] = Query(None, description="Keyword search road name, ward, or notes"),
    only_flagged: Optional[bool] = Query(None, description="Only critical/flagged priority S=4-5 alerts"),
    sla_status: Optional[str] = Query(None, description="Filter by SLA status: breached, at_risk, on_track, met"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0)
):
    alerts = get_alerts(
        severity=severity,
        anomaly_class=anomaly_class,
        ward_id=ward_id,
        status=status,
        search=search,
        only_flagged=only_flagged,
        sla_status=sla_status,
        limit=limit,
        offset=offset
    )
    return {"count": len(alerts), "alerts": alerts}

@app.get("/api/alerts/geojson")
def fetch_geojson():
    """Returns GeoJSON FeatureCollection directly consumable by Leaflet.js"""
    return get_geojson_collection()

@app.get("/api/alerts/{event_id}")
def fetch_alert(event_id: str):
    alert = get_alert_by_id(event_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert

@app.post("/api/alerts", status_code=201)
async def ingest_alert(alert: AlertCreate):
    """
    Edge Ingestion Endpoint:
    Receives JSON payload from vehicle Raspberry Pi 4 edge unit,
    runs fleet de-duplication (< 10-12m distance check),
    saves to SQLite, and broadcasts real-time update to dashboard.
    """
    alert_dict = alert.dict()
    result, is_new = insert_or_deduplicate(alert_dict)

    # Broadcast event via WebSocket
    await manager.broadcast({
        "type": "NEW_ALERT" if is_new else "UPDATED_CONFIRMATION",
        "is_new": is_new,
        "alert": result
    })

    return {
        "status": "success",
        "action": "created" if is_new else "de_duplicated_and_confirmed",
        "event_id": result["event_id"],
        "confirmation_count": result["confirmation_count"],
        "high_confidence": result["high_confidence"],
        "severity_score": result["severity_score"],
        "priority_flag": result["priority_flag"],
        "alert": result
    }

@app.patch("/api/alerts/{event_id}")
async def patch_alert(event_id: str, updates: AlertUpdate):
    """Updates municipal triage status (e.g., Dispatched, In Repair, Resolved)"""
    existing = get_alert_by_id(event_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Alert not found")

    updated = update_alert(event_id, updates.dict(exclude_unset=True))
    await manager.broadcast({
        "type": "STATUS_CHANGE",
        "event_id": event_id,
        "alert": updated
    })
    return updated

@app.delete("/api/alerts/{event_id}")
async def remove_alert(event_id: str):
    success = delete_alert(event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")
    await manager.broadcast({
        "type": "DELETE_ALERT",
        "event_id": event_id
    })
    return {"status": "success", "deleted_id": event_id}

@app.get("/api/export/csv")
def export_csv():
    """Generates official PWD municipal work order CSV export for maintenance crews"""
    alerts = get_alerts(limit=1000)

    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "Event ID", "Timestamp (UTC)", "Latitude", "Longitude", "Road Name", "Ward / Circle",
        "Anomaly Class", "Severity Score", "Severity Label", "Priority Flag", "Estimated Depth (cm)",
        "Vehicle Speed (km/h)", "Municipal Action", "SLA Window (h)", "SLA Deadline (UTC)", "SLA Status",
        "Status", "Assigned Crew", "Confirmation Count",
        "Reporting Vehicle", "IMU Z-RMS (g)", "Peak Freq (Hz)", "Deflection D (mm)", "Onset Rate R (mm/ms)", "Notes"
    ])

    for a in alerts:
        snap = a.get("sensor_snapshot", {})
        writer.writerow([
            a["event_id"],
            a["timestamp"],
            a["latitude"],
            a["longitude"],
            a["road_name"],
            a["ward_id"],
            a["anomaly_class"],
            a["severity_score"],
            a["severity_label"],
            "YES (Same-Day)" if a["priority_flag"] else "NO",
            a["estimated_depth_cm"],
            a["vehicle_speed"],
            a["municipal_action"],
            a.get("sla_hours", ""),
            a.get("sla_deadline", ""),
            (a.get("sla_status") or "").upper(),
            a["status"],
            a.get("assigned_crew") or "Unassigned",
            a["confirmation_count"],
            a["vehicle_id"],
            snap.get("imu_z_rms", ""),
            snap.get("peak_frequency", ""),
            snap.get("suspension_deflection_d", ""),
            snap.get("suspension_onset_rate_r", ""),
            a.get("notes", "")
        ])

    output.seek(0)
    filename = f"RoadIQ_Municipal_Alerts_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.post("/api/simulator/trigger")
async def simulate_edge_event(
    forced_class: Optional[str] = None,
    forced_severity: Optional[int] = None
):
    """
    Edge Vehicle Simulator:
    Simulates a Raspberry Pi 4 edge unit driving on the Punjab corridor,
    triggering 2-stage anomaly detection, running 1296D fusion inference,
    computing severity, and pushing the alert.
    """
    loc = random.choice(LOCATIONS)
    lat = loc["lat_center"] + random.uniform(-0.0025, 0.0025)
    lon = loc["lon_center"] + random.uniform(-0.0025, 0.0025)

    anomaly_class = forced_class or ("Pothole" if random.random() < 0.75 else random.choice(["Manhole Cover", "Speed Bump"]))
    target_s = forced_severity or random.choices([2, 3, 4, 5], weights=[0.2, 0.35, 0.3, 0.15])[0]

    speed = round(random.uniform(38.0, 62.0), 1)
    vehicle = random.choice(VEHICLE_FLEET)
    timestamp_str = datetime.now(timezone.utc).isoformat()

    if target_s == 5:
        d_mm = round(random.uniform(22.0, 27.5), 1)
        r_mm_ms = round(random.uniform(1.6, 2.1), 2)
        imu_rms = round(random.uniform(1.8, 2.5), 2)
        peak_freq = round(random.uniform(12.0, 18.0), 1)
        kurtosis = round(random.uniform(6.0, 7.5), 2)
    elif target_s == 4:
        d_mm = round(random.uniform(16.0, 21.0), 1)
        r_mm_ms = round(random.uniform(1.15, 1.55), 2)
        imu_rms = round(random.uniform(1.4, 1.8), 2)
        peak_freq = round(random.uniform(11.0, 16.5), 1)
        kurtosis = round(random.uniform(5.2, 6.4), 2)
    elif target_s == 3:
        d_mm = round(random.uniform(11.0, 15.0), 1)
        r_mm_ms = round(random.uniform(0.75, 1.05), 2)
        imu_rms = round(random.uniform(1.05, 1.35), 2)
        peak_freq = round(random.uniform(9.5, 14.0), 1)
        kurtosis = round(random.uniform(4.4, 5.2), 2)
    else:
        d_mm = round(random.uniform(7.0, 10.5), 1)
        r_mm_ms = round(random.uniform(0.4, 0.65), 2)
        imu_rms = round(random.uniform(0.85, 1.05), 2)
        peak_freq = round(random.uniform(8.5, 12.0), 1)
        kurtosis = round(random.uniform(3.8, 4.4), 2)

    calc_s, label, action, auto_flag, depth_cm = calculate_severity(d_mm, r_mm_ms)
    img_url = generate_svg_defect_image(anomaly_class, calc_s, speed, lat, lon, timestamp_str)

    alert_dict = {
        "event_id": f"RIQ-LIVE-{random.randint(10000, 99999)}",
        "timestamp": timestamp_str,
        "latitude": lat,
        "longitude": lon,
        "vehicle_id": vehicle,
        "vehicle_speed": speed,
        "anomaly_class": anomaly_class,
        "severity_score": calc_s,
        "priority_flag": auto_flag,
        "image_base64": img_url,
        "ward_id": loc["ward_id"],
        "road_name": loc["road_name"],
        "status": "New",
        "notes": f"Simulated live edge trigger event from {vehicle}. 2-stage trigger RMS={imu_rms}g, Deflection={d_mm}mm.",
        "sensor_snapshot": {
            "imu_z_rms": imu_rms,
            "gyro_x_peak": round(random.uniform(15.0, 35.0), 1),
            "peak_frequency": peak_freq,
            "kurtosis": kurtosis,
            "suspension_deflection_d": d_mm,
            "suspension_onset_rate_r": r_mm_ms,
            "visual_confidence": round(random.uniform(0.91, 0.98), 3)
        }
    }

    result, is_new = insert_or_deduplicate(alert_dict)

    # WebSocket broadcast
    await manager.broadcast({
        "type": "SIMULATED_TRIGGER",
        "is_new": is_new,
        "alert": result
    })

    return {
        "status": "success",
        "simulated": True,
        "is_new": is_new,
        "event": result
    }

@app.post("/api/seed")
def reseed_data():
    seed_database()
    return {"status": "success", "message": "Database reseeded with fresh 12 km Punjab road corridor data."}

# ---------------------------------------------------------------------------
# Predictive Risk Intelligence — ML endpoint
# ---------------------------------------------------------------------------
@app.post("/api/predict-risk")
def predict_risk(request: RiskPredictionRequest):
    """
    Predictive Road Risk Intelligence endpoint.
    Returns ML-predicted risk category (Low/Medium/High) with confidence
    for a given set of sensor readings.
    This is SEPARATE from the existing deterministic severity formula.
    """
    is_available = getattr(risk_predictor, "available", getattr(risk_predictor, "model_available", False)) if risk_predictor else False
    if not is_available:
        raise HTTPException(
            status_code=503,
            detail="Predictive risk model not available. Run ml/train.py first to train the model."
        )
    sensor_dict = request.model_dump()
    try:
        result = risk_predictor.predict(sensor_dict)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return result

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection open and receive optional client ping
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
