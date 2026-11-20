import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Alert, LiveMessage } from './lib/types';
import { fetchAlerts, reseedCorridor, triggerSimulation } from './lib/api';
import { connectLive, type LiveState } from './lib/live';
import { playChime } from './lib/chime';
import { EMPTY_FILTERS, applyLive, byPriority, countAlerts, exportQuery, filtersFromSearch, filtersToSearch, matches, type Filters } from './lib/queue';
import { TopBar } from './components/TopBar';
import { StatStrip } from './components/StatStrip';
import { Queue } from './components/Queue';
import { MapPanel } from './components/MapPanel';
import { Inspector } from './components/Inspector';
import { Toasts, type Toast } from './components/Toasts';
import { WardAnalytics } from './components/WardAnalytics';

const TOAST_MS = 6000;

export function App() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [filters, setFilters] = useState<Filters>(() => filtersFromSearch(location.search));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; n: number } | null>(null);
  const [live, setLive] = useState<LiveState>('connecting');
  const [chime, setChime] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const chimeRef = useRef(chime);
  chimeRef.current = chime;
  const toastSeq = useRef(0);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list.slice(-2), { ...t, id }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  const loadAlerts = useCallback(async (quiet = false) => {
    if (!quiet) setLoad('loading');
    try {
      setAlerts(await fetchAlerts());
      setLoad('ready');
    } catch (e) {
      setLoadError((e as Error).message);
      setLoad('error');
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
    return connectLive((msg: LiveMessage) => {
      setAlerts((list) => applyLive(list, msg));
      if ((msg.type === 'NEW_ALERT' || msg.type === 'SIMULATED_TRIGGER') && msg.is_new) {
        const a = msg.alert;
        if (chimeRef.current) playChime(a.severity_score >= 4);
        toast({ tone: 'alert', text: `${a.anomaly_class}, severity ${a.severity_score}, on ${a.road_name}`, alertId: a.event_id });
        setFlashId(a.event_id);
      } else if (msg.type === 'SIMULATED_TRIGGER') {
        // The simulated hit landed within 12 m of an open report and was merged into it.
        const a = msg.alert;
        toast({ tone: 'info', text: `Another sighting of the ${a.anomaly_class.toLowerCase()} on ${a.road_name}, now seen by ${a.confirmation_count} vehicles`, alertId: a.event_id });
        setFlashId(a.event_id);
      }
      if (msg.type === 'DELETE_ALERT') setSelectedId((id) => (id === msg.event_id ? null : id));
    }, setLive, () => void loadAlerts(true));
  }, []);

  useEffect(() => {
    history.replaceState(null, '', `${location.pathname}${filtersToSearch(filters)}`);
  }, [filters]);

  const counts = useMemo(() => countAlerts(alerts), [alerts]);
  const rows = useMemo(() => alerts.filter((a) => matches(a, filters)).sort(byPriority), [alerts, filters]);
  const selected = useMemo(() => alerts.find((a) => a.event_id === selectedId) ?? null, [alerts, selectedId]);

  const close = useCallback(() => setSelectedId(null), []);
  const onSaved = useCallback((a: Alert) => setAlerts((list) => list.map((x) => (x.event_id === a.event_id ? a : x))), []);

  async function simulate() {
    setSimulating(true);
    try {
      await triggerSimulation();
    } catch (e) {
      toast({ tone: 'error', text: `The simulated hit failed: ${(e as Error).message}.` });
    } finally {
      setSimulating(false);
    }
  }

  async function reseed() {
    if (!confirm('Replace every report on the corridor with fresh sample data? Work orders are lost.')) return;
    try {
      await reseedCorridor();
      setSelectedId(null);
      await loadAlerts();
    } catch (e) {
      toast({ tone: 'error', text: `Reseeding failed: ${(e as Error).message}.` });
    }
  }

  return (
    <div class="shell">
      <a class="skip" href="#incidentList">Skip to the repair queue</a>
      <TopBar live={live} exportQuery={exportQuery(filters)} overdue={counts.overdue} onAnalytics={() => setAnalytics(true)} simulating={simulating} chime={chime} onSimulate={simulate} onReseed={reseed} onChime={() => setChime((c) => !c)} />
      <StatStrip counts={counts} ready={load === 'ready'} />
      <main class="work">
        <Queue
          rows={rows}
          counts={counts}
          filters={filters}
          load={load}
          loadError={loadError}
          selectedId={selectedId}
          flashId={flashId}
          onFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onClear={() => setFilters(EMPTY_FILTERS)}
          onRetry={() => loadAlerts()}
          onSelect={setSelectedId}
        />
        <MapPanel alerts={rows} selectedId={selectedId} focus={focus} onSelect={setSelectedId}>
          {selected && (
            <Inspector
              key={selected.event_id}
              alert={selected}
              onClose={close}
              onSaved={onSaved}
              onShowOnMap={(a) => {
                setFocus({ lat: a.latitude, lon: a.longitude, n: Date.now() });
                // Under 60rem the inspector covers the map, so get out of the way, as the old modal did
                if (matchMedia('(max-width: 60rem)').matches) setSelectedId(null);
              }}
            />
          )}
        </MapPanel>
      </main>
      <WardAnalytics
        open={analytics}
        onClose={() => setAnalytics(false)}
        onWard={(ward) => { setFilters({ ...EMPTY_FILTERS, ward }); setAnalytics(false); }}
        onAlert={(id) => { setSelectedId(id); setAnalytics(false); }}
        onOverdue={() => { setFilters({ ...EMPTY_FILTERS, tab: 'overdue' }); setAnalytics(false); }}
      />
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} onInspect={setSelectedId} />
    </div>
  );
}
