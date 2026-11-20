import { useEffect, useRef } from 'preact/hooks';
import { Search, Users } from 'lucide-preact';
import type { Alert } from '../lib/types';
import type { Counts, Filters, Tab } from '../lib/queue';
import { CLASSES, SEVERITY_WINDOW, WARDS, timeOfDay } from '../lib/format';

interface Props {
  rows: Alert[];
  counts: Counts;
  filters: Filters;
  load: 'loading' | 'ready' | 'error';
  loadError: string;
  selectedId: string | null;
  flashId: string | null;
  onFilters: (patch: Partial<Filters>) => void;
  onClear: () => void;
  onRetry: () => void;
  onSelect: (id: string) => void;
}

const TABS: { id: Tab; label: string; count: keyof Counts }[] = [
  { id: 'all', label: 'All', count: 'total' },
  { id: 'critical', label: 'Severity 4 and 5', count: 'critical' },
  { id: 'dispatched', label: 'Dispatched', count: 'dispatched' },
  { id: 'resolved', label: 'Resolved', count: 'resolved' },
];

const statusClass = (s: string) => `status status--${s.toLowerCase().replace(/\s+/g, '-')}`;

export function Queue(p: Props) {
  const flashRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    flashRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [p.flashId]);

  // A pin clicked on the map brings its row into view.
  useEffect(() => {
    if (p.selectedId) document.getElementById(`card-${p.selectedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [p.selectedId]);

  const filtered = p.filters.severity || p.filters.cls || p.filters.ward || p.filters.q || p.filters.tab !== 'all';

  return (
    <section class="queue" aria-labelledby="queue-title">
      <div class="queue-head">
        <h2 id="queue-title">Repair queue</h2>
        <div class="tabs" role="tablist" aria-label="Queue view">
          {TABS.map((t) => (
            <button
              type="button"
              role="tab"
              class="tab feed-tab"
              data-tab={t.id}
              aria-selected={p.filters.tab === t.id}
              onClick={() => p.onFilters({ tab: t.id })}
            >
              {t.label} <span class="num tab-count">{p.counts[t.count]}</span>
            </button>
          ))}
        </div>
        <label class="search">
          <Search size={16} aria-hidden="true" />
          <span class="visually-hidden">Search the queue</span>
          <input
            id="triageSearchInput"
            type="search"
            name="q"
            autocomplete="off"
            placeholder="Road, ward, ID or vehicle"
            value={p.filters.q}
            onInput={(e) => p.onFilters({ q: e.currentTarget.value })}
          />
        </label>
        <div class="filters">
          <label class="field-inline">
            <span>Severity</span>
            <select id="filterSeverity" value={p.filters.severity} onChange={(e) => p.onFilters({ severity: e.currentTarget.value })}>
              <option value="">Any</option>
              {[5, 4, 3, 2, 1].map((s) => (
                <option value={String(s)}>{s}, {SEVERITY_WINDOW[s].toLowerCase()}</option>
              ))}
            </select>
          </label>
          <label class="field-inline">
            <span>Class</span>
            <select id="filterClass" value={p.filters.cls} onChange={(e) => p.onFilters({ cls: e.currentTarget.value })}>
              <option value="">Any</option>
              {CLASSES.map((c) => <option value={c}>{c}</option>)}
            </select>
          </label>
          <label class="field-inline">
            <span>Ward</span>
            <select id="filterWard" value={p.filters.ward} onChange={(e) => p.onFilters({ ward: e.currentTarget.value })}>
              <option value="">Any</option>
              {WARDS.map(([v, label]) => <option value={v}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div class="queue-body" id="incidentList" aria-busy={p.load === 'loading'}>
        {p.load === 'loading' && (
          <ol class="rows" aria-label="Loading the queue">
            {Array.from({ length: 7 }, () => (
              <li class="row row--skeleton" aria-hidden="true"><span /><span /><span /></li>
            ))}
          </ol>
        )}

        {p.load === 'error' && (
          <div class="state" role="alert">
            <p class="state-title">The queue did not load.</p>
            <p>{p.loadError}. Check that the RoadIQ server is running, then try again.</p>
            <button type="button" class="btn" onClick={p.onRetry}>Try again</button>
          </div>
        )}

        {p.load === 'ready' && p.rows.length === 0 && (
          <div class="state">
            {filtered ? (
              <>
                <p class="state-title">Nothing matches these filters.</p>
                <p>{p.counts.total} reports are hidden by the current view.</p>
                <button type="button" class="btn" id="btnResetFilters" onClick={p.onClear}>Clear filters</button>
              </>
            ) : (
              <>
                <p class="state-title">No defects reported yet.</p>
                <p>Reports appear here as edge units on the corridor post them.</p>
              </>
            )}
          </div>
        )}

        {p.load === 'ready' && p.rows.length > 0 && (
          <ol class="rows">
            {p.rows.map((a) => (
              <li
                key={a.event_id}
                id={`card-${a.event_id}`}
                ref={a.event_id === p.flashId ? flashRef : undefined}
                class={`row${a.event_id === p.flashId ? ' row--new' : ''}`}
              >
                <button
                  type="button"
                  class="row-button"
                  aria-current={a.event_id === p.selectedId ? 'true' : undefined}
                  onClick={() => p.onSelect(a.event_id)}
                >
                  <span class={`sev sev-${a.severity_score}`} aria-label={`Severity ${a.severity_score}`}>{a.severity_score}</span>
                  <span class="row-main">
                    <span class="row-road">{a.road_name}</span>
                    <span class="row-sub">{a.anomaly_class}, {SEVERITY_WINDOW[a.severity_score]?.toLowerCase()}</span>
                  </span>
                  <span class="row-figures">
                    <span class="num">{a.estimated_depth_cm.toFixed(1)}&nbsp;cm</span>
                    {a.confirmation_count >= 3 && (
                      <span class="confirmed" title={`Confirmed by ${a.confirmation_count} vehicles`}>
                        <Users size={14} aria-hidden="true" />
                        <span class="num">{a.confirmation_count}</span>
                        <span class="visually-hidden"> vehicles</span>
                      </span>
                    )}
                  </span>
                  <span class="row-foot">
                    <span class={statusClass(a.status)}>{a.status}</span>
                    <time class="num" dateTime={a.timestamp}>{timeOfDay(a.timestamp)}</time>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
