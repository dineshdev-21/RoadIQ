import type { Alert, LiveMessage } from './types';

export type Tab = 'all' | 'critical' | 'overdue' | 'dispatched' | 'resolved';

export interface Filters {
  tab: Tab;
  severity: string;
  cls: string;
  ward: string;
  q: string;
}

export const EMPTY_FILTERS: Filters = { tab: 'all', severity: '', cls: '', ward: '', q: '' };

const TABS: Tab[] = ['all', 'critical', 'overdue', 'dispatched', 'resolved'];
const URL_KEYS = { severity: 'sev', cls: 'class', ward: 'ward', q: 'q' } as const;

export function filtersFromSearch(search: string): Filters {
  const p = new URLSearchParams(search);
  const tab = p.get('tab') as Tab;
  return {
    tab: TABS.includes(tab) ? tab : 'all',
    severity: /^[1-5]$/.test(p.get(URL_KEYS.severity) ?? '') ? p.get(URL_KEYS.severity)! : '',
    cls: p.get(URL_KEYS.cls) ?? '',
    ward: p.get(URL_KEYS.ward) ?? '',
    q: p.get(URL_KEYS.q) ?? '',
  };
}

export function filtersToSearch(f: Filters): string {
  const p = new URLSearchParams();
  if (f.tab !== 'all') p.set('tab', f.tab);
  for (const key of Object.keys(URL_KEYS) as (keyof typeof URL_KEYS)[]) {
    if (f[key]) p.set(URL_KEYS[key], f[key]);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const isOpenPriority = (a: Alert) => a.severity_score >= 4 && a.status !== 'Resolved';
export const isOverdue = (a: Alert) => a.status !== 'Resolved' && a.sla_status === 'breached';

export function matches(a: Alert, f: Filters): boolean {
  if (f.tab === 'critical' && !isOpenPriority(a)) return false;
  if (f.tab === 'overdue' && !isOverdue(a)) return false;
  if (f.tab === 'dispatched' && a.status !== 'Dispatched') return false;
  if (f.tab === 'resolved' && a.status !== 'Resolved') return false;
  if (f.severity && a.severity_score !== Number(f.severity)) return false;
  if (f.cls && a.anomaly_class !== f.cls) return false;
  if (f.ward && !a.ward_id.startsWith(`${f.ward} `) && a.ward_id !== f.ward) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${a.road_name} ${a.ward_id} ${a.event_id} ${a.vehicle_id}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** The server's order: flagged first, then severity, then most recently touched. */
export function byPriority(a: Alert, b: Alert): number {
  return (
    Number(b.priority_flag) - Number(a.priority_flag) ||
    b.severity_score - a.severity_score ||
    (b.updated_at > a.updated_at ? 1 : b.updated_at < a.updated_at ? -1 : 0)
  );
}

export interface Counts {
  total: number;
  critical: number;
  overdue: number;
  dispatched: number;
  resolved: number;
  confirmed: number;
  potholes: number;
  manholes: number;
}

export function countAlerts(alerts: Alert[]): Counts {
  const c: Counts = { total: alerts.length, critical: 0, overdue: 0, dispatched: 0, resolved: 0, confirmed: 0, potholes: 0, manholes: 0 };
  for (const a of alerts) {
    if (isOpenPriority(a)) c.critical++;
    if (isOverdue(a)) c.overdue++;
    if (a.status === 'Dispatched') c.dispatched++;
    if (a.status === 'Resolved') c.resolved++;
    if (a.confirmation_count >= 3) c.confirmed++;
    if (a.anomaly_class === 'Pothole') c.potholes++;
    if (a.anomaly_class === 'Manhole Cover') c.manholes++;
  }
  return c;
}

/** Applies one live event to the list, returning a new list (or the same one when nothing changed). */
export function applyLive(alerts: Alert[], msg: LiveMessage): Alert[] {
  if (msg.type === 'DELETE_ALERT') {
    return alerts.some((a) => a.event_id === msg.event_id) ? alerts.filter((a) => a.event_id !== msg.event_id) : alerts;
  }
  const next = msg.alert;
  const i = alerts.findIndex((a) => a.event_id === next.event_id);
  if (i === -1) return msg.type === 'STATUS_CHANGE' ? alerts : [next, ...alerts];
  return alerts.map((a, j) => (j === i ? next : a));
}

/** The CSV export's query for the current view, in the server's parameter names. */
export function exportQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.severity) p.set('severity', f.severity);
  if (f.cls) p.set('anomaly_class', f.cls);
  if (f.ward) p.set('ward_id', f.ward);
  if (f.q.trim()) p.set('search', f.q.trim());
  if (f.tab === 'critical') p.set('only_flagged', 'true');
  if (f.tab === 'overdue') p.set('sla_status', 'breached');
  if (f.tab === 'dispatched') p.set('status', 'Dispatched');
  if (f.tab === 'resolved') p.set('status', 'Resolved');
  const s = p.toString();
  return s ? `?${s}` : '';
}
