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
}

export interface AlertDetail extends Alert {
  image_base64: string | null;
}

export type LiveMessage =
  | { type: 'NEW_ALERT' | 'UPDATED_CONFIRMATION' | 'SIMULATED_TRIGGER'; is_new: boolean; alert: Alert }
  | { type: 'STATUS_CHANGE'; event_id: string; alert: Alert }
  | { type: 'DELETE_ALERT'; event_id: string };
