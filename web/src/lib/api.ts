import type { Alert, AlertDetail } from './types';

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
