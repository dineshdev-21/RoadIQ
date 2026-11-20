import type { Alert, AlertDetail, RiskPrediction, SensorSnapshot, WardAnalytics } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ? String(body.detail) : `The server answered ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const fetchAlerts = () =>
  request<{ count: number; alerts: Alert[] }>('/api/alerts?limit=500').then((d) => d.alerts);

export const fetchAlert = (id: string, signal?: AbortSignal) =>
  request<AlertDetail>(`/api/alerts/${encodeURIComponent(id)}`, { signal });

export interface WorkOrder {
  status: string;
  assigned_crew: string;
  notes: string;
}

export const saveWorkOrder = (id: string, order: Partial<WorkOrder>) =>
  request<Alert>(`/api/alerts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });

export const triggerSimulation = () => request<unknown>('/api/simulator/trigger', { method: 'POST' });

export const reseedCorridor = () => request<unknown>('/api/seed', { method: 'POST' });

export const CSV_EXPORT_URL = '/api/export/csv';

export const fetchWardAnalytics = () => request<WardAnalytics>('/api/analytics/wards');

/** POST /api/predict-risk answers 503 until ml/train.py has produced a model. */
export async function predictRisk(speed: number, s: SensorSnapshot, signal?: AbortSignal): Promise<RiskPrediction | 'unavailable'> {
  const res = await fetch('/api/predict-risk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_speed: speed, ...s }),
    signal,
  });
  if (res.status === 503) return 'unavailable';
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  return res.json() as Promise<RiskPrediction>;
}
