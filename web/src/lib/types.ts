export type AnomalyClass = 'Pothole' | 'Manhole Cover' | 'Speed Bump' | 'Rough Patch';
export type Status = 'New' | 'Under Review' | 'Dispatched' | 'In Repair' | 'Resolved';

export interface SensorSnapshot {
  imu_z_rms?: number;
  gyro_x_peak?: number;
  peak_frequency?: number;
  kurtosis?: number;
  suspension_deflection_d?: number;
  suspension_onset_rate_r?: number;
  visual_confidence?: number;
}

/** An alert as the list endpoints send it: no image, `has_image` says whether the detail has one. */
export interface Alert {
  event_id: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  vehicle_id: string;
  vehicle_speed: number;
  anomaly_class: AnomalyClass | string;
  severity_score: number;
  severity_label: string;
  priority_flag: boolean;
  municipal_action: string;
  estimated_depth_cm: number;
  sensor_snapshot: SensorSnapshot;
  ward_id: string;
  road_name: string;
  status: Status | string;
  assigned_crew: string | null;
  notes: string | null;
  confirmation_count: number;
  high_confidence: boolean;
  reporting_vehicles: string[];
  created_at: string;
  updated_at: string;
  has_image: boolean;
  /** PWD repair window, computed server-side from severity and report time. */
  sla_hours: number;
  sla_deadline: string;
  sla_remaining_minutes: number;
  sla_elapsed_pct: number;
  sla_status: SlaStatus;
}

export type SlaStatus = 'breached' | 'at_risk' | 'on_track' | 'met';

export interface AlertDetail extends Alert {
  image_base64: string | null;
}

export type LiveMessage =
  | { type: 'NEW_ALERT' | 'UPDATED_CONFIRMATION' | 'SIMULATED_TRIGGER'; is_new: boolean; alert: Alert }
  | { type: 'STATUS_CHANGE'; event_id: string; alert: Alert }
  | { type: 'DELETE_ALERT'; event_id: string };

export interface RiskPrediction {
  predicted_risk: 'Low' | 'Medium' | 'High' | null;
  risk_class: number | null;
  confidence: number | null;
  probabilities: { low: number | null; medium: number | null; high: number | null };
  model_available: boolean;
}

export interface WardMetrics {
  ward_id: string;
  ward_short: string;
  health_score: number;
  health_grade: string;
  open_alerts: number;
  critical_open: number;
  sla_breached: number;
  sla_at_risk: number;
  sla_compliance_pct: number;
}

export interface SlaUrgentAlert {
  event_id: string;
  road_name: string;
  ward_id: string;
  severity_score: number;
  sla_remaining_minutes: number;
  sla_status: SlaStatus;
}

export interface WardAnalytics {
  generated_at: string;
  corridor_summary: {
    overall_health_score: number;
    overall_health_grade: string;
    open_alerts: number;
    resolved_alerts: number;
    sla_breached_count: number;
    sla_at_risk_count: number;
    sla_compliance_pct: number;
    avg_estimated_depth_cm: number;
  };
  wards: WardMetrics[];
  sla_alerts: SlaUrgentAlert[];
  severity_breakdown: Record<string, number>;
  status_breakdown: Record<string, number>;
}
