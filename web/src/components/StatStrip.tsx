import type { Counts } from '../lib/queue';

// Field-prototype benchmarks from the project's README (Punjab corridor, 3,200 labelled events).
const EDGE_LATENCY_MS = 87;
const ACCURACY_PCT = 94.3;
const FALSE_POSITIVE_PCT = 4.1;

export function StatStrip({ counts, ready }: { counts: Counts; ready: boolean }) {
  const n = (v: number) => (ready ? v : '–');
  return (
    <dl class="stats" aria-label="Corridor summary">
      <div>
        <dt>Reports on the corridor</dt>
        <dd><b class="num" id="kpiTotalEvents">{n(counts.total)}</b></dd>
        <dd class="stat-note">
          <span id="kpiPotholeCount">{n(counts.potholes)} potholes</span>, <span id="kpiManholeCount">{n(counts.manholes)} manhole covers</span>
        </dd>
      </div>
      <div>
        <dt>Open at severity 4 and 5</dt>
        <dd><b class="num" id="kpiCriticalCount">{n(counts.critical)}</b></dd>
        <dd class="stat-note">Same-day and 48&nbsp;h PWD dispatch</dd>
      </div>
      <div>
        <dt>Confirmed hotspots</dt>
        <dd><b class="num" id="kpiConfirmedCount">{n(counts.confirmed)}</b></dd>
        <dd class="stat-note">3 or more vehicles within 12&nbsp;m</dd>
      </div>
      <div>
        <dt>Edge inference</dt>
        <dd><b class="num" id="kpiLatency">{EDGE_LATENCY_MS}&nbsp;ms</b></dd>
        <dd class="stat-note">{ACCURACY_PCT}% accuracy, {FALSE_POSITIVE_PCT}% false positives on a Raspberry Pi 4</dd>
      </div>
    </dl>
  );
}
