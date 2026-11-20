"""
RoadIQ Data Models
Multi-Sensor Fusion Edge AI & Municipal Reporting Framework
"""

from typing import Optional, List, Dict
from datetime import datetime, timezone
import uuid
from pydantic import BaseModel, Field

class SensorSnapshot(BaseModel):
    imu_z_rms: float = Field(..., description="Z-axis RMS acceleration in g")
    gyro_x_peak: float = Field(0.0, description="X-axis Gyro peak in deg/s")
    peak_frequency: float = Field(..., description="256-pt FFT peak frequency in Hz (8-20 Hz for potholes)")
    kurtosis: float = Field(3.0, description="Spectral kurtosis metric")
    suspension_deflection_d: float = Field(..., description="Potentiometer maximum deflection in mm")
    suspension_onset_rate_r: float = Field(..., description="Suspension onset rate in mm/ms")
    visual_confidence: float = Field(0.92, description="MobileNetV2 1280-D defect classification confidence")
    fft_energy: Optional[float] = Field(None, description="Energy across 256-sample window")

class AlertCreate(BaseModel):
    event_id: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: Optional[str] = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    vehicle_id: str = Field(default="PB-08-FLEET-104")
    vehicle_speed: float = Field(..., ge=0, le=180, description="Vehicle speed in km/h at trigger moment")
    anomaly_class: str = Field(..., description="Pothole, Speed Bump, Manhole Cover, Rough Patch, Normal Road")
    severity_score: Optional[int] = Field(None, ge=1, le=5)
    priority_flag: Optional[bool] = None
    image_base64: Optional[str] = None
    sensor_snapshot: SensorSnapshot
    ward_id: Optional[str] = "Ward 4 - GT Road NH-44"
    road_name: Optional[str] = "NH-44 National Highway (Phagwara-Jalandhar Section)"
    notes: Optional[str] = None

class AlertUpdate(BaseModel):
    status: Optional[str] = Field(None, description="New, Under Review, Dispatched, In Repair, Resolved")
    assigned_crew: Optional[str] = None
    notes: Optional[str] = None
    priority_flag: Optional[bool] = None
    ward_id: Optional[str] = None

class AlertResponse(BaseModel):
    event_id: str
    timestamp: str
    latitude: float
    longitude: float
    vehicle_id: str
    vehicle_speed: float
    anomaly_class: str
    severity_score: int
    severity_label: str
    priority_flag: bool
    municipal_action: str
    estimated_depth_cm: float
    image_base64: Optional[str]
    sensor_snapshot: SensorSnapshot
    ward_id: str
    road_name: str
    status: str
    assigned_crew: Optional[str]
    notes: Optional[str]
    confirmation_count: int
    high_confidence: bool
    reporting_vehicles: List[str]
    sla_hours: Optional[int] = None
    sla_deadline: Optional[str] = None
    sla_remaining_minutes: Optional[int] = None
    sla_elapsed_pct: Optional[float] = None
    sla_status: Optional[str] = None
    created_at: str
    updated_at: str

class MunicipalStats(BaseModel):
    total_events: int
    total_potholes: int
    total_manholes: int
    total_speed_bumps: int
    total_rough_patches: int
    critical_priority_count: int
    pending_dispatch_count: int
    in_repair_count: int
    resolved_count: int
    multi_vehicle_confirmed: int
    avg_severity: float
    avg_edge_latency_ms: float
    overall_accuracy_pct: float
    false_positive_rate_pct: float
    scanned_corridor_km: float


class CorridorAnalyticsSummary(BaseModel):
    overall_health_score: float
    overall_health_grade: str
    total_alerts: int
    open_alerts: int
    resolved_alerts: int
    sla_breached_count: int
    sla_at_risk_count: int
    sla_on_track_count: int
    sla_compliance_pct: float
    avg_estimated_depth_cm: float


class WardMetrics(BaseModel):
    ward_id: str
    ward_short: str
    health_score: float
    health_grade: str
    total_alerts: int
    open_alerts: int
    resolved_alerts: int
    critical_open: int
    sla_breached: int
    sla_at_risk: int
    sla_on_track: int
    sla_compliance_pct: float
    avg_severity: float
    avg_depth_cm: float
    confirmed_hotspots: int
    severity_distribution: Dict[str, int]
    class_distribution: Dict[str, int]


class SlaUrgentAlert(BaseModel):
    event_id: str
    road_name: str
    ward_id: str
    anomaly_class: str
    severity_score: int
    severity_label: str
    status: str
    assigned_crew: Optional[str] = None
    sla_hours: int
    sla_deadline: str
    sla_remaining_minutes: int
    sla_elapsed_pct: float
    sla_status: str
    confirmation_count: int
    latitude: float
    longitude: float


class WardAnalyticsResponse(BaseModel):
    generated_at: str
    corridor_summary: CorridorAnalyticsSummary
    wards: List[WardMetrics]
    sla_alerts: List[SlaUrgentAlert]
    severity_breakdown: Dict[str, int]
    status_breakdown: Dict[str, int]
