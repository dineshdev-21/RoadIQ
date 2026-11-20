import { useEffect, useState } from 'preact/hooks';
import { BarChart3, Bell, BellOff, Download, RotateCcw, Zap } from 'lucide-preact';
import type { LiveState } from '../lib/live';
import { CSV_EXPORT_URL } from '../lib/api';

const LIVE_TEXT: Record<LiveState, string> = { live: 'Live', connecting: 'Connecting', offline: 'Offline, retrying' };

/** Its own component so the once-a-second tick re-renders only the clock. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <time id="clockDisplay" class="clock num" dateTime={now.toISOString()}>
      {now.toISOString().slice(11, 19)} UTC
    </time>
  );
}

interface Props {
  live: LiveState;
  exportQuery: string;
  overdue: number;
  onAnalytics: () => void;
  simulating: boolean;
  chime: boolean;
  onSimulate: () => void;
  onReseed: () => void;
  onChime: () => void;
}

export function TopBar({ live, exportQuery, overdue, onAnalytics, simulating, chime, onSimulate, onReseed, onChime }: Props) {
  return (
    <header class="bar">
      <a class="wordmark" href="/" aria-label="RoadIQ, reload the command center">RoadIQ</a>
      <p class="corridor">Punjab NH-44 corridor, 12&nbsp;km, LPU to Phagwara</p>
      <span id="wsStatusBadge" class={`live live--${live}`} role="status">{LIVE_TEXT[live]}</span>
      <Clock />
      <div class="bar-actions">
        <button type="button" id="btnSimulate" class="btn btn--quiet" onClick={onSimulate} disabled={simulating} aria-busy={simulating}>
          <Zap size={16} aria-hidden="true" />
          <span class="label">Simulate edge hit</span>
        </button>
        <button type="button" id="btnWardAnalytics" class="btn btn--quiet" onClick={onAnalytics}>
          <BarChart3 size={16} aria-hidden="true" />
          <span class="label">Ward analytics</span>
          {overdue > 0 && <span class="count-badge num" aria-label={`${overdue} reports overdue`}>{overdue}</span>}
        </button>
        <a id="btnExportCsv" class="btn btn--quiet" href={`${CSV_EXPORT_URL}${exportQuery}`} download title={exportQuery ? 'Export the reports in this view' : 'Export every report'}>
          <Download size={16} aria-hidden="true" />
          <span class="label">Export CSV</span>
        </a>
        <button type="button" id="btnReseed" class="icon-btn" aria-label="Reseed the corridor with fresh sample data" title="Reseed the corridor" onClick={onReseed}>
          <RotateCcw size={18} aria-hidden="true" />
        </button>
        <button type="button" id="btnAudioToggle" class="icon-btn" aria-pressed={chime} aria-label="Sound for new reports" title={chime ? 'Sound on' : 'Sound off'} onClick={onChime}>
          {chime ? <Bell size={18} aria-hidden="true" /> : <BellOff size={18} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
