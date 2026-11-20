import { useEffect, useRef, useState } from 'preact/hooks';
import { RefreshCw, X } from 'lucide-preact';
import type { WardAnalytics as Data } from '../lib/types';
import { fetchWardAnalytics } from '../lib/api';
import { SLA_LABELS, slaRemaining, timeOfDay, wardLabel } from '../lib/format';

interface Props {
  open: boolean;
  onClose: () => void;
  onWard: (ward: string) => void;
  onAlert: (id: string) => void;
  onOverdue: () => void;
}

type State = { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ready'; d: Data };

const STATUS_ORDER = ['New', 'Under Review', 'Dispatched', 'In Repair', 'Resolved'];

/** Ward road health and SLA compliance, from GET /api/analytics/wards. */
export function WardAnalytics({ open, onClose, onWard, onAlert, onOverdue }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ s: 'loading' });

  const load = () => {
    setState({ s: 'loading' });
    fetchWardAnalytics()
      .then((d) => setState({ s: 'ready', d }))
      .catch((e) => setState({ s: 'error', msg: (e as Error).message }));
  };

  useEffect(() => {
    const dlg = ref.current!;
    if (open && !dlg.open) {
      dlg.showModal();
      load();
    } else if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <dialog ref={ref} id="analyticsDrawer" class="drawer" aria-labelledby="analytics-title" onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}>
      <header class="drawer-head">
        <h2 id="analytics-title">Ward road health</h2>
        {state.s === 'ready' && <p class="muted">Worked out at <time class="num" dateTime={state.d.generated_at}>{timeOfDay(state.d.generated_at)}</time></p>}
        <div class="drawer-actions">
          <button type="button" id="btnRefreshAnalytics" class="btn btn--tool" onClick={load} disabled={state.s === 'loading'}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
          <button type="button" class="icon-btn" aria-label="Close ward analytics" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="drawer-body">
        {state.s === 'loading' && <p class="muted drawer-state">Working out ward health…</p>}
        {state.s === 'error' && (
          <div class="drawer-state" role="alert">
            <p>The ward figures did not load: {state.msg}.</p>
            <button type="button" class="btn" onClick={load}>Try again</button>
          </div>
        )}
        {state.s === 'ready' && <Report d={state.d} onWard={onWard} onAlert={onAlert} onOverdue={onOverdue} />}
      </div>
    </dialog>
  );
}

function Report({ d, onWard, onAlert, onOverdue }: { d: Data } & Pick<Props, 'onWard' | 'onAlert' | 'onOverdue'>) {
  const c = d.corridor_summary;
  const sevTotal = Object.values(d.severity_breakdown).reduce((a, b) => a + b, 0) || 1;
  return (
    <>
      <dl class="stats stats--drawer">
        <div>
          <dt>Corridor health</dt>
          <dd><b class="num">{c.overall_health_score.toFixed(0)}</b> <span class={`grade grade--${c.overall_health_grade.toLowerCase()}`}>{c.overall_health_grade}</span></dd>
          <dd class="stat-note">{c.open_alerts} open, {c.resolved_alerts} resolved</dd>
        </div>
        <div>
          <dt>SLA compliance</dt>
          <dd><b class="num">{c.sla_compliance_pct.toFixed(0)}%</b></dd>
          <dd class="stat-note">Average depth {c.avg_estimated_depth_cm.toFixed(1)}&nbsp;cm</dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd><b class="num">{c.sla_breached_count}</b></dd>
          <dd class="stat-note">Past the PWD repair window</dd>
        </div>
        <div>
          <dt>Due soon</dt>
          <dd><b class="num">{c.sla_at_risk_count}</b></dd>
          <dd class="stat-note">Under a quarter of the window left</dd>
        </div>
      </dl>

      <section class="drawer-section" aria-labelledby="mix-head">
        <h3 id="mix-head">Severity mix and pipeline</h3>
        <div class="mix-bar" role="img" aria-label={`Reports by severity: ${[5, 4, 3, 2, 1].map((s) => `${s}: ${d.severity_breakdown[String(s)] ?? 0}`).join(', ')}`}>
          {[5, 4, 3, 2, 1].map((s) => {
            const n = d.severity_breakdown[String(s)] ?? 0;
            return n ? <span class={`sev-${s}`} style={{ flexGrow: n / sevTotal }} key={s}>{n}</span> : null;
          })}
        </div>
        <ol class="pipeline">
          {STATUS_ORDER.map((st) => (
            <li key={st}><span class="num">{d.status_breakdown[st] ?? 0}</span> {st}</li>
          ))}
        </ol>
      </section>

      <section class="drawer-section" aria-labelledby="wards-head">
        <h3 id="wards-head">Wards, weakest first</h3>
        <table class="ledger">
          <thead>
            <tr><th scope="col">Ward</th><th scope="col">Grade</th><th scope="col" class="r">Health</th><th scope="col" class="r">Open</th><th scope="col" class="r">Overdue</th><th scope="col" class="r">On time</th></tr>
          </thead>
          <tbody>
            {d.wards.map((w) => (
              <tr key={w.ward_id}>
                <th scope="row">
                  <button type="button" class="link-btn" onClick={() => onWard(w.ward_id.split(' - ')[0])}>{wardLabel(w.ward_id)}</button>
                </th>
                <td><span class={`grade grade--${w.health_grade.toLowerCase()}`}>{w.health_grade}</span></td>
                <td class="r num">{w.health_score.toFixed(0)}</td>
                <td class="r num">{w.open_alerts}</td>
                <td class="r num">{w.sla_breached}</td>
                <td class="r num">{w.sla_compliance_pct.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section class="drawer-section" aria-labelledby="watch-head">
        <div class="section-row">
          <h3 id="watch-head">SLA watchlist</h3>
          <button type="button" id="btnFilterOverdueFromDrawer" class="btn btn--tool" onClick={onOverdue}>Show overdue in the queue</button>
        </div>
        {d.sla_alerts.length === 0 ? (
          <p class="muted">Every open report is inside its repair window.</p>
        ) : (
          <ol class="watchlist">
            {d.sla_alerts.map((a) => (
              <li key={a.event_id}>
                <button type="button" class="watch-row" onClick={() => onAlert(a.event_id)}>
                  <span class={`sev sev-${a.severity_score}`} aria-label={`Severity ${a.severity_score}`}>{a.severity_score}</span>
                  <span class="row-main">
                    <span class="row-road">{a.road_name}</span>
                    <span class="row-sub">{wardLabel(a.ward_id)}</span>
                  </span>
                  <span class={`sla sla--${a.sla_status}`}>{SLA_LABELS[a.sla_status]}</span>
                  <span class="num watch-time">{slaRemaining(a.sla_remaining_minutes)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
