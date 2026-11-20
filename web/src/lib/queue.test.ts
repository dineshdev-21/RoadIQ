import { describe, expect, it } from 'vitest';
import type { Alert } from './types';
import { EMPTY_FILTERS, applyLive, byPriority, countAlerts, exportQuery, filtersFromSearch, filtersToSearch, matches } from './queue';

const base: Alert = {
  event_id: 'RIQ-1', timestamp: '2026-11-19T10:00:00+00:00', latitude: 31.25, longitude: 75.71,
  vehicle_id: 'PB-08-BUS-402', vehicle_speed: 46, anomaly_class: 'Pothole', severity_score: 5,
  severity_label: 'Critical', priority_flag: true, municipal_action: 'Same-day', estimated_depth_cm: 5.8,
  sensor_snapshot: {}, ward_id: 'Ward 4 - GT Road NH-44', road_name: 'NH-44 Chaheru Flyover',
  status: 'New', assigned_crew: null, notes: null, confirmation_count: 1, high_confidence: false,
  reporting_vehicles: ['PB-08-BUS-402'], created_at: '2026-11-19T10:00:00+00:00',
  updated_at: '2026-11-19T10:00:00+00:00', has_image: true,
  sla_hours: 24, sla_deadline: '2026-11-20T10:00:00+00:00', sla_remaining_minutes: 600, sla_elapsed_pct: 58, sla_status: 'on_track',
};
const make = (o: Partial<Alert>): Alert => ({ ...base, ...o });

describe('matches', () => {
  it('keeps resolved severity 5 out of the priority tab', () => {
    const f = { ...EMPTY_FILTERS, tab: 'critical' as const };
    expect(matches(make({}), f)).toBe(true);
    expect(matches(make({ status: 'Resolved' }), f)).toBe(false);
    expect(matches(make({ severity_score: 3 }), f)).toBe(false);
  });

  it('matches a ward by its number without matching Ward 1 against Ward 10', () => {
    const f = { ...EMPTY_FILTERS, ward: 'Ward 1' };
    expect(matches(make({ ward_id: 'Ward 1 - LPU University Zone' }), f)).toBe(true);
    expect(matches(make({ ward_id: 'Ward 10 - Elsewhere' }), f)).toBe(false);
  });

  it('searches road, ward, id and vehicle, case-insensitively', () => {
    expect(matches(make({}), { ...EMPTY_FILTERS, q: 'chaheru' })).toBe(true);
    expect(matches(make({}), { ...EMPTY_FILTERS, q: 'bus-402' })).toBe(true);
    expect(matches(make({}), { ...EMPTY_FILTERS, q: 'law gate' })).toBe(false);
  });

  it('filters by severity and class', () => {
    expect(matches(make({}), { ...EMPTY_FILTERS, severity: '5', cls: 'Pothole' })).toBe(true);
    expect(matches(make({}), { ...EMPTY_FILTERS, severity: '4' })).toBe(false);
    expect(matches(make({}), { ...EMPTY_FILTERS, cls: 'Speed Bump' })).toBe(false);
  });
});

describe('url state', () => {
  it('round-trips filters and drops defaults', () => {
    const f = { tab: 'dispatched' as const, severity: '4', cls: 'Manhole Cover', ward: 'Ward 2', q: 'gate' };
    expect(filtersFromSearch(filtersToSearch(f))).toEqual(f);
    expect(filtersToSearch(EMPTY_FILTERS)).toBe('');
  });

  it('rejects junk values', () => {
    expect(filtersFromSearch('?tab=nope&sev=9')).toEqual(EMPTY_FILTERS);
  });
});

describe('ordering and counts', () => {
  it('puts flagged, then severe, then recent first', () => {
    const a = make({ event_id: 'a', priority_flag: false, severity_score: 3 });
    const b = make({ event_id: 'b', priority_flag: true, severity_score: 4 });
    const c = make({ event_id: 'c', priority_flag: true, severity_score: 4, updated_at: '2026-11-19T11:00:00+00:00' });
    expect([a, b, c].sort(byPriority).map((x) => x.event_id)).toEqual(['c', 'b', 'a']);
  });

  it('counts each queue', () => {
    const c = countAlerts([
      make({}),
      make({ status: 'Resolved' }),
      make({ status: 'Dispatched', anomaly_class: 'Manhole Cover', severity_score: 2, confirmation_count: 3 }),
    ]);
    expect(c).toEqual({ total: 3, critical: 1, overdue: 0, dispatched: 1, resolved: 1, confirmed: 1, potholes: 2, manholes: 1 });
  });
});

describe('applyLive', () => {
  const list = [make({ event_id: 'a' }), make({ event_id: 'b' })];

  it('prepends a new alert and replaces a confirmed one in place', () => {
    expect(applyLive(list, { type: 'NEW_ALERT', is_new: true, alert: make({ event_id: 'c' }) }).map((a) => a.event_id)).toEqual(['c', 'a', 'b']);
    const confirmed = applyLive(list, { type: 'UPDATED_CONFIRMATION', is_new: false, alert: make({ event_id: 'b', confirmation_count: 2 }) });
    expect(confirmed[1].confirmation_count).toBe(2);
    expect(confirmed).toHaveLength(2);
  });

  it('removes a deleted alert and ignores unknown ids', () => {
    expect(applyLive(list, { type: 'DELETE_ALERT', event_id: 'a' }).map((a) => a.event_id)).toEqual(['b']);
    expect(applyLive(list, { type: 'DELETE_ALERT', event_id: 'zz' })).toBe(list);
    expect(applyLive(list, { type: 'STATUS_CHANGE', event_id: 'zz', alert: make({ event_id: 'zz' }) })).toBe(list);
  });
});

describe('sla overdue', () => {
  it('shows only open reports past their window', () => {
    const f = { ...EMPTY_FILTERS, tab: 'overdue' as const };
    expect(matches(make({ sla_status: 'breached' }), f)).toBe(true);
    expect(matches(make({ sla_status: 'breached', status: 'Resolved' }), f)).toBe(false);
    expect(matches(make({ sla_status: 'at_risk' }), f)).toBe(false);
    expect(countAlerts([make({ sla_status: 'breached' }), make({})]).overdue).toBe(1);
  });
});

describe('exportQuery', () => {
  it('maps the view onto the CSV endpoint parameters', () => {
    expect(exportQuery(EMPTY_FILTERS)).toBe('');
    const q = new URLSearchParams(exportQuery({ tab: 'overdue', severity: '5', cls: 'Pothole', ward: 'Ward 4', q: ' gt road ' }));
    expect(Object.fromEntries(q)).toEqual({ severity: '5', anomaly_class: 'Pothole', ward_id: 'Ward 4', search: 'gt road', sla_status: 'breached' });
    expect(exportQuery({ ...EMPTY_FILTERS, tab: 'critical' })).toBe('?only_flagged=true');
  });
});
