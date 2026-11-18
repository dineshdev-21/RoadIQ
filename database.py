"""
RoadIQ Database & Fleet De-Duplication Engine
SQLite persistent store with Haversine spatial clustering (< 10-12m)
"""

import sqlite3
import json
import math
import os
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Tuple
from severity import (
    calculate_severity,
    get_severity_info,
    compute_sla_status,
    compute_ward_health_score,
    health_grade,
)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "roadiq.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        event_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        vehicle_id TEXT NOT NULL,
        vehicle_speed REAL NOT NULL,
        anomaly_class TEXT NOT NULL,
        severity_score INTEGER NOT NULL,
        severity_label TEXT NOT NULL,
        priority_flag INTEGER NOT NULL DEFAULT 0,
        municipal_action TEXT NOT NULL,
        estimated_depth_cm REAL NOT NULL,
        image_base64 TEXT,
        sensor_snapshot_json TEXT NOT NULL,
        ward_id TEXT NOT NULL,
        road_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'New',
        assigned_crew TEXT,
        notes TEXT,
        confirmation_count INTEGER NOT NULL DEFAULT 1,
        high_confidence INTEGER NOT NULL DEFAULT 0,
        reporting_vehicles_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_coords ON alerts(latitude, longitude)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity_score)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_ward ON alerts(ward_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_class ON alerts(anomaly_class)")
    conn.commit()
    conn.close()

def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance between two GPS coordinates in meters"""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

    return R * c

def find_spatial_duplicate(cursor, lat: float, lon: float, anomaly_class: str, threshold_meters: float = 12.0) -> Optional[dict]:
    """
    Finds active nearby defect of the same class within threshold distance (default 12 meters)
    Uses bounding box pre-filter for performance, then exact Haversine.
    """
    # 1 deg lat ~ 111,000 m. 15m is ~ 0.00015 deg
    lat_delta = (threshold_meters * 1.5) / 111000.0
    lon_delta = (threshold_meters * 1.5) / (111000.0 * math.cos(math.radians(lat)))

    cursor.execute("""
        SELECT * FROM alerts 
        WHERE anomaly_class = ? 
          AND status != 'Resolved'
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
    """, (anomaly_class, lat - lat_delta, lat + lat_delta, lon - lon_delta, lon + lon_delta))

    candidates = cursor.fetchall()
    for row in candidates:
        dist = haversine_distance_meters(lat, lon, row["latitude"], row["longitude"])
        if dist <= threshold_meters:
            return dict(row)
    return None

def row_to_dict(row: sqlite3.Row, now: Optional[datetime] = None) -> dict:
    d = dict(row)
    d["priority_flag"] = bool(d["priority_flag"])
    d["high_confidence"] = bool(d["high_confidence"])
    d["sensor_snapshot"] = json.loads(d["sensor_snapshot_json"]) if d.get("sensor_snapshot_json") else {}
    d["reporting_vehicles"] = json.loads(d["reporting_vehicles_json"]) if d.get("reporting_vehicles_json") else []
    sla_info = compute_sla_status(
        severity_score=d["severity_score"],
        timestamp_iso=d["timestamp"],
        status=d["status"],
        resolved_at_iso=d.get("updated_at") if d["status"] == "Resolved" else None,
        now=now,
    )
    d.update(sla_info)
    return d

def insert_or_deduplicate(alert_data: dict) -> Tuple[dict, bool]:
    """
    Fleet de-duplication:
    Merges alerts within 10-12m so one pothole does not create multiple tickets.
    Increments confirmation count and sets high_confidence when count >= 3.
    Returns (alert_dict, is_new_entry)
    """
    conn = get_connection()
    cursor = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()

    lat = alert_data["latitude"]
    lon = alert_data["longitude"]
    anomaly_class = alert_data["anomaly_class"]
    snapshot = alert_data["sensor_snapshot"]
    
    # Calculate severity if not provided or to ensure formula consistency
    d_mm = snapshot.get("suspension_deflection_d", 0.0)
    r_mm_ms = snapshot.get("suspension_onset_rate_r", 0.0)
    calc_score, label, action, auto_flag, depth_cm = calculate_severity(d_mm, r_mm_ms)
    
    severity_score = alert_data.get("severity_score") or calc_score
    severity_info = get_severity_info(severity_score)
    priority_flag = alert_data.get("priority_flag") if alert_data.get("priority_flag") is not None else severity_info["flagged"]

    # Check for duplicate within 12 meters
    existing = find_spatial_duplicate(cursor, lat, lon, anomaly_class, threshold_meters=12.0)

    if existing:
        existing_id = existing["event_id"]
        vehicles = json.loads(existing["reporting_vehicles_json"]) if existing["reporting_vehicles_json"] else []
        new_vehicle = alert_data.get("vehicle_id", "PB-FLEET-UNKNOWN")
        if new_vehicle not in vehicles:
            vehicles.append(new_vehicle)
        
        new_count = existing["confirmation_count"] + 1
        new_high_conf = 1 if new_count >= 3 else existing["high_confidence"]
        
        # If new sighting has higher severity or newly flagged, elevate it
        updated_severity = max(existing["severity_score"], severity_score)
        updated_info = get_severity_info(updated_severity)
        updated_flag = 1 if (existing["priority_flag"] or priority_flag or new_high_conf and updated_severity >= 3) else 0

        cursor.execute("""
            UPDATE alerts SET
                confirmation_count = ?,
                high_confidence = ?,
                reporting_vehicles_json = ?,
                severity_score = ?,
                severity_label = ?,
                municipal_action = ?,
                priority_flag = ?,
                updated_at = ?
            WHERE event_id = ?
        """, (
            new_count,
            new_high_conf,
            json.dumps(vehicles),
            updated_severity,
            updated_info["label"],
            updated_info["action"],
            updated_flag,
            now_iso,
            existing_id
        ))
        conn.commit()
        
        cursor.execute("SELECT * FROM alerts WHERE event_id = ?", (existing_id,))
        updated_row = cursor.fetchone()
        conn.close()
        return row_to_dict(updated_row), False
    else:
        # Insert as new event
        event_id = alert_data.get("event_id") or str(datetime.now().timestamp())
        timestamp = alert_data.get("timestamp") or now_iso
        vehicle_id = alert_data.get("vehicle_id", "PB-08-FLEET-104")
        vehicles = [vehicle_id]
        
        cursor.execute("""
            INSERT INTO alerts (
                event_id, timestamp, latitude, longitude, vehicle_id, vehicle_speed,
                anomaly_class, severity_score, severity_label, priority_flag,
                municipal_action, estimated_depth_cm, image_base64,
                sensor_snapshot_json, ward_id, road_name, status,
                assigned_crew, notes, confirmation_count, high_confidence,
                reporting_vehicles_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            event_id,
            timestamp,
            lat,
            lon,
            vehicle_id,
            alert_data.get("vehicle_speed", 45.0),
            anomaly_class,
            severity_score,
            severity_info["label"],
            1 if priority_flag else 0,
            severity_info["action"],
            depth_cm,
            alert_data.get("image_base64"),
            json.dumps(snapshot),
            alert_data.get("ward_id", "Ward 4 - GT Road NH-44"),
            alert_data.get("road_name", "NH-44 Phagwara-Jalandhar Corridor"),
            alert_data.get("status", "New"),
            None,
            alert_data.get("notes"),
            1,
            0,
            json.dumps(vehicles),
            now_iso,
            now_iso
        ))
        conn.commit()
        
        cursor.execute("SELECT * FROM alerts WHERE event_id = ?", (event_id,))
        new_row = cursor.fetchone()
        conn.close()
        return row_to_dict(new_row), True

def get_alerts(
    severity: Optional[int] = None,
    anomaly_class: Optional[str] = None,
    ward_id: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    only_flagged: Optional[bool] = None,
    sla_status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
) -> List[dict]:
    conn = get_connection()
    cursor = conn.cursor()

    query = "SELECT * FROM alerts WHERE 1=1"
    params = []

    if severity is not None:
        query += " AND severity_score = ?"
        params.append(severity)
    if anomaly_class:
        query += " AND anomaly_class = ?"
        params.append(anomaly_class)
    if ward_id:
        query += " AND ward_id LIKE ?"
        params.append(f"%{ward_id}%")
    if status:
        query += " AND status = ?"
        params.append(status)
    if only_flagged:
        query += " AND priority_flag = 1"
    if search:
        query += " AND (road_name LIKE ? OR ward_id LIKE ? OR event_id LIKE ? OR notes LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term, term, term])

    query += " ORDER BY priority_flag DESC, severity_score DESC, updated_at DESC"
    if not sla_status:
        query += " LIMIT ? OFFSET ?"
        params.extend([limit, offset])

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    now = datetime.now(timezone.utc)
    alerts = [row_to_dict(r, now=now) for r in rows]
    if sla_status:
        target = sla_status.strip().lower()
        alerts = [a for a in alerts if a.get("sla_status") == target]
        alerts = alerts[offset : offset + limit]
    return alerts

def get_alert_by_id(event_id: str) -> Optional[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM alerts WHERE event_id = ?", (event_id,))
    row = cursor.fetchone()
    conn.close()
    return row_to_dict(row) if row else None

def update_alert(event_id: str, updates: dict) -> Optional[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    
    fields = []
    values = []
    
    if "status" in updates and updates["status"] is not None:
        fields.append("status = ?")
        values.append(updates["status"])
    if "assigned_crew" in updates and updates["assigned_crew"] is not None:
        fields.append("assigned_crew = ?")
        values.append(updates["assigned_crew"])
    if "notes" in updates and updates["notes"] is not None:
        fields.append("notes = ?")
        values.append(updates["notes"])
    if "priority_flag" in updates and updates["priority_flag"] is not None:
        fields.append("priority_flag = ?")
        values.append(1 if updates["priority_flag"] else 0)
    if "ward_id" in updates and updates["ward_id"] is not None:
        fields.append("ward_id = ?")
        values.append(updates["ward_id"])

    if not fields:
        conn.close()
        return get_alert_by_id(event_id)

    fields.append("updated_at = ?")
    values.append(datetime.now(timezone.utc).isoformat())
    values.append(event_id)

    query = f"UPDATE alerts SET {', '.join(fields)} WHERE event_id = ?"
    cursor.execute(query, values)
    conn.commit()
    conn.close()
    return get_alert_by_id(event_id)

def delete_alert(event_id: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM alerts WHERE event_id = ?", (event_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def get_stats() -> dict:
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN anomaly_class = 'Pothole' THEN 1 ELSE 0 END) AS potholes,
            SUM(CASE WHEN anomaly_class = 'Manhole Cover' THEN 1 ELSE 0 END) AS manholes,
            SUM(CASE WHEN anomaly_class = 'Speed Bump' THEN 1 ELSE 0 END) AS speed_bumps,
            SUM(CASE WHEN anomaly_class = 'Rough Patch' THEN 1 ELSE 0 END) AS rough_patches,
            SUM(CASE WHEN severity_score >= 4 AND status != 'Resolved' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'In Repair' THEN 1 ELSE 0 END) AS in_repair,
            SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) AS resolved,
            SUM(CASE WHEN high_confidence = 1 THEN 1 ELSE 0 END) AS confirmed,
            AVG(severity_score) AS avg_severity
        FROM alerts
    """)
    stats = cursor.fetchone()

    conn.close()

    return {
        "total_events": stats["total"],
        "total_potholes": stats["potholes"] or 0,
        "total_manholes": stats["manholes"] or 0,
        "total_speed_bumps": stats["speed_bumps"] or 0,
        "total_rough_patches": stats["rough_patches"] or 0,
        "critical_priority_count": stats["critical"] or 0,
        "pending_dispatch_count": stats["pending"] or 0,
        "in_repair_count": stats["in_repair"] or 0,
        "resolved_count": stats["resolved"] or 0,
        "multi_vehicle_confirmed": stats["confirmed"] or 0,
        "avg_severity": round(stats["avg_severity"] or 0.0, 2),
        "avg_edge_latency_ms": 87.0,  # Raspberry Pi 4 benchmark from DPR
        "overall_accuracy_pct": 94.3,  # 5-class field prototype from DPR
        "false_positive_rate_pct": 4.1,  # Day FPR from DPR
        "scanned_corridor_km": 12.0  # Punjab 12 km test corridor
    }

def get_geojson_collection() -> dict:
    """Generates GeoJSON FeatureCollection for Leaflet.js with rich properties"""
    alerts = get_alerts(limit=500)
    features = []

    for a in alerts:
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [a["longitude"], a["latitude"]]
            },
            "properties": {
                "event_id": a["event_id"],
                "timestamp": a["timestamp"],
                "anomaly_class": a["anomaly_class"],
                "severity_score": a["severity_score"],
                "severity_label": a["severity_label"],
                "priority_flag": a["priority_flag"],
                "municipal_action": a["municipal_action"],
                "estimated_depth_cm": a["estimated_depth_cm"],
                "vehicle_speed": a["vehicle_speed"],
                "vehicle_id": a["vehicle_id"],
                "ward_id": a["ward_id"],
                "road_name": a["road_name"],
                "status": a["status"],
                "confirmation_count": a["confirmation_count"],
                "high_confidence": a["high_confidence"],
                "sla_status": a.get("sla_status"),
                "sla_hours": a.get("sla_hours"),
                "sla_deadline": a.get("sla_deadline"),
                "sla_remaining_minutes": a.get("sla_remaining_minutes"),
                "sensor_snapshot": a["sensor_snapshot"],
                "has_image": bool(a.get("image_base64"))
            }
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features
    }


def _extract_ward_short(ward_id: str) -> str:
    """Extracts a concise ward prefix such as 'Ward 4' for filter dropdown matching."""
    if not ward_id:
        return "Unassigned"
    parts = ward_id.split(" - ", 1)
    return parts[0].strip() if parts else ward_id.strip()


def get_ward_analytics(now: Optional[datetime] = None) -> dict:
    """
    Aggregates per-ward Road Health Scores, severity & class distributions,
    and PWD SLA compliance metrics (breached, at-risk, on-track, met)
    across the monitored municipal corridor.
    """
    current_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM alerts")
    rows = cursor.fetchall()
    conn.close()

    alerts = [row_to_dict(r, now=current_utc) for r in rows]

    severity_breakdown = {str(s): 0 for s in range(1, 6)}
    status_breakdown = {
        "New": 0,
        "Under Review": 0,
        "Dispatched": 0,
        "In Repair": 0,
        "Resolved": 0,
    }

    wards_map: Dict[str, List[dict]] = {}
    sla_alerts: List[dict] = []

    total_breached = 0
    total_at_risk = 0
    total_on_track = 0
    total_open = 0
    total_resolved = 0
    depth_sum = 0.0

    for a in alerts:
        sev_key = str(a["severity_score"])
        if sev_key in severity_breakdown:
            severity_breakdown[sev_key] += 1

        st = a.get("status") or "New"
        status_breakdown[st] = status_breakdown.get(st, 0) + 1

        depth_sum += float(a.get("estimated_depth_cm") or 0.0)

        if st == "Resolved":
            total_resolved += 1
        else:
            total_open += 1

        sla_st = a.get("sla_status")
        if sla_st == "breached":
            total_breached += 1
        elif sla_st == "at_risk":
            total_at_risk += 1
        elif sla_st == "on_track":
            total_on_track += 1

        if sla_st in ("breached", "at_risk"):
            sla_alerts.append({
                "event_id": a["event_id"],
                "road_name": a["road_name"],
                "ward_id": a["ward_id"],
                "anomaly_class": a["anomaly_class"],
                "severity_score": a["severity_score"],
                "severity_label": a["severity_label"],
                "status": st,
                "assigned_crew": a.get("assigned_crew"),
                "sla_hours": a["sla_hours"],
                "sla_deadline": a["sla_deadline"],
                "sla_remaining_minutes": a["sla_remaining_minutes"],
                "sla_elapsed_pct": a["sla_elapsed_pct"],
                "sla_status": sla_st,
                "confirmation_count": a["confirmation_count"],
                "latitude": a["latitude"],
                "longitude": a["longitude"],
            })

        ward_key = a.get("ward_id") or "Unassigned Ward"
        wards_map.setdefault(ward_key, []).append(a)

    wards_list: List[dict] = []
    for ward_id, ward_alerts in wards_map.items():
        open_items = [x for x in ward_alerts if x.get("status") != "Resolved"]
        resolved_items = [x for x in ward_alerts if x.get("status") == "Resolved"]
        w_total = len(ward_alerts)
        w_breached = sum(1 for x in open_items if x.get("sla_status") == "breached")
        w_at_risk = sum(1 for x in open_items if x.get("sla_status") == "at_risk")
        w_on_track = sum(1 for x in open_items if x.get("sla_status") == "on_track")
        w_critical = sum(1 for x in open_items if x["severity_score"] >= 4)
        w_confirmed = sum(1 for x in ward_alerts if x.get("high_confidence"))
        w_avg_sev = round(sum(x["severity_score"] for x in ward_alerts) / w_total, 2) if w_total else 0.0
        w_avg_depth = round(sum(float(x.get("estimated_depth_cm") or 0.0) for x in ward_alerts) / w_total, 1) if w_total else 0.0
        w_compliance = round(((w_total - w_breached) / w_total) * 100.0, 1) if w_total else 100.0

        w_score = compute_ward_health_score(open_items)
        w_sev_dist = {str(s): 0 for s in range(1, 6)}
        w_class_dist: Dict[str, int] = {}
        for x in ward_alerts:
            s_key = str(x["severity_score"])
            if s_key in w_sev_dist:
                w_sev_dist[s_key] += 1
            cls = x.get("anomaly_class") or "Unknown"
            w_class_dist[cls] = w_class_dist.get(cls, 0) + 1

        wards_list.append({
            "ward_id": ward_id,
            "ward_short": _extract_ward_short(ward_id),
            "health_score": w_score,
            "health_grade": health_grade(w_score),
            "total_alerts": w_total,
            "open_alerts": len(open_items),
            "resolved_alerts": len(resolved_items),
            "critical_open": w_critical,
            "sla_breached": w_breached,
            "sla_at_risk": w_at_risk,
            "sla_on_track": w_on_track,
            "sla_compliance_pct": w_compliance,
            "avg_severity": w_avg_sev,
            "avg_depth_cm": w_avg_depth,
            "confirmed_hotspots": w_confirmed,
            "severity_distribution": w_sev_dist,
            "class_distribution": w_class_dist,
        })

    # Sort worst health score first, then by breached SLA count descending
    wards_list.sort(key=lambda w: (w["health_score"], -w["sla_breached"], -w["critical_open"]))

    # Sort urgent SLA watchlist: most overdue (lowest remaining minutes) first
    sla_alerts.sort(key=lambda item: (item["sla_remaining_minutes"], -item["severity_score"]))

    total_alerts = len(alerts)
    overall_health = round(sum(w["health_score"] for w in wards_list) / len(wards_list), 1) if wards_list else 100.0
    overall_compliance = round(((total_alerts - total_breached) / total_alerts) * 100.0, 1) if total_alerts else 100.0
    avg_depth = round(depth_sum / total_alerts, 1) if total_alerts else 0.0

    return {
        "generated_at": current_utc.isoformat(),
        "corridor_summary": {
            "overall_health_score": overall_health,
            "overall_health_grade": health_grade(overall_health),
            "total_alerts": total_alerts,
            "open_alerts": total_open,
            "resolved_alerts": total_resolved,
            "sla_breached_count": total_breached,
            "sla_at_risk_count": total_at_risk,
            "sla_on_track_count": total_on_track,
            "sla_compliance_pct": overall_compliance,
            "avg_estimated_depth_cm": avg_depth,
        },
        "wards": wards_list,
        "sla_alerts": sla_alerts,
        "severity_breakdown": severity_breakdown,
        "status_breakdown": status_breakdown,
    }


# Initialize schema on load
init_db()
