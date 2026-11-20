import { useEffect, useState } from 'preact/hooks';
import type { Alert, RiskPrediction } from '../lib/types';
import { predictRisk } from '../lib/api';

const PRIORITY: Record<string, string> = {
  Low: 'Schedule within 7 days',
  Medium: 'Inspect within 72 h',
  High: 'Priority dispatch, 24 to 48 h',
};

type State = { s: 'loading' } | { s: 'unavailable' } | { s: 'error' } | { s: 'ready'; p: RiskPrediction };

/** The ML model's second opinion, beside the deterministic severity score. */
export function RiskCard({ alert }: { alert: Alert }) {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    predictRisk(alert.vehicle_speed, alert.sensor_snapshot ?? {}, ctrl.signal)
      .then((r) => setState(r === 'unavailable' || !r.model_available ? { s: 'unavailable' } : { s: 'ready', p: r }))
      .catch((e) => {
        if (e.name !== 'AbortError') setState({ s: 'error' });
      });
    return () => ctrl.abort();
  }, [alert.event_id]);

  return (
    <section class="risk" aria-labelledby="risk-head" aria-busy={state.s === 'loading'}>
      <h3 id="risk-head">Predicted road risk</h3>
      {state.s === 'loading' && <p class="muted">Asking the risk model…</p>}
      {state.s === 'unavailable' && (
        <p class="muted">
          The risk model has not been trained yet. Run <code>python ml/train.py</code> on the server to turn predictions on.
        </p>
      )}
      {state.s === 'error' && <p class="muted">The risk model did not answer. Close and reopen this report to try again.</p>}
      {state.s === 'ready' && <Prediction p={state.p} />}
    </section>
  );
}

function Prediction({ p }: { p: RiskPrediction }) {
  const risk = p.predicted_risk ?? 'Unknown';
  const bars: [string, number | null][] = [
    ['Low', p.probabilities.low],
    ['Medium', p.probabilities.medium],
    ['High', p.probabilities.high],
  ];
  return (
    <>
      <dl class="risk-facts">
        <div><dt>Risk</dt><dd class={`risk-level risk-level--${risk.toLowerCase()}`}>{risk}</dd></div>
        <div><dt>Confidence</dt><dd class="num">{p.confidence != null ? `${(p.confidence * 100).toFixed(1)}%` : '–'}</dd></div>
        <div><dt>Maintenance</dt><dd>{PRIORITY[risk] ?? '–'}</dd></div>
      </dl>
      <div class="risk-bars" role="img" aria-label={`Probabilities: ${bars.map(([l, v]) => `${l} ${v != null ? Math.round(v * 100) : 0}%`).join(', ')}`}>
        {bars.map(([label, v]) => (
          <div class="risk-bar" key={label}>
            <span>{label}</span>
            <span class="risk-track"><span class={`risk-fill risk-fill--${label.toLowerCase()}`} style={{ transform: `scaleX(${v ?? 0})` }} /></span>
            <span class="num">{v != null ? `${Math.round(v * 100)}%` : '–'}</span>
          </div>
        ))}
      </div>
    </>
  );
}
