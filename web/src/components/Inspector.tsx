import { useEffect, useRef, useState } from 'preact/hooks';
import { LocateFixed, MapPin, X } from 'lucide-preact';
import type { Alert } from '../lib/types';
import { fetchAlert, saveWorkOrder, type WorkOrder } from '../lib/api';
import { SEVERITY_WINDOW, SLA_LABELS, STATUSES, STATUS_LABELS, fullTime, num, slaRemaining, timeOfDay, wardLabel } from '../lib/format';
import { RiskCard } from './RiskCard';

interface Props {
  alert: Alert;
  onClose: () => void;
  onSaved: (a: Alert) => void;
  onShowOnMap: (a: Alert) => void;
}

type Image = { state: 'loading' } | { state: 'none' } | { state: 'ready'; src: string } | { state: 'error' };

export function Inspector({ alert, onClose, onSaved, onShowOnMap }: Props) {
  const id = alert.event_id;
  const headRef = useRef<HTMLHeadingElement>(null);
  const [image, setImage] = useState<Image>({ state: 'loading' });
  const [status, setStatus] = useState(alert.status);
  const [crew, setCrew] = useState(alert.assigned_crew ?? '');
  const [notes, setNotes] = useState(alert.notes ?? '');
  // Fields the operator has edited; live updates refresh only the others, and Save sends only these.
  const [touched, setTouched] = useState<Set<'status' | 'crew' | 'notes'>>(new Set());
  const touch = (f: 'status' | 'crew' | 'notes') => setTouched((t) => (t.has(f) ? t : new Set(t).add(f)));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  // Another operator's change arrives live: take it into every field this operator has not edited.
  useEffect(() => {
    if (!touched.has('status')) setStatus(alert.status);
    if (!touched.has('crew')) setCrew(alert.assigned_crew ?? '');
    if (!touched.has('notes')) setNotes(alert.notes ?? '');
  }, [alert.status, alert.assigned_crew, alert.notes]);

  // The parent mounts one Inspector per report (keyed by id), so this runs once per report.
  useEffect(() => {
    headRef.current?.focus();
    if (!alert.has_image) {
      setImage({ state: 'none' });
      return;
    }
    setImage({ state: 'loading' });
    const ctrl = new AbortController();
    fetchAlert(id, ctrl.signal)
      .then((d) => setImage(d.image_base64 ? { state: 'ready', src: d.image_base64 } : { state: 'none' }))
      .catch((e) => {
        if (e.name !== 'AbortError') setImage({ state: 'error' });
      });
    return () => ctrl.abort();
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const snap = alert.sensor_snapshot ?? {};
  const d = snap.suspension_deflection_d ?? 0;
  const r = snap.suspension_onset_rate_r ?? 0;
  const raw = 0.15 * d + 2.0 * r;

  async function save(e: Event) {
    e.preventDefault();
    const order: Partial<WorkOrder> = {};
    if (touched.has('status')) order.status = status;
    if (touched.has('crew')) order.assigned_crew = crew.trim();
    if (touched.has('notes')) order.notes = notes.trim();
    if (Object.keys(order).length === 0) {
      setSaveError('Nothing has changed since this report opened.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const updated = await saveWorkOrder(id, order);
      onSaved(updated);
      setTouched(new Set());
      setSavedAt(timeOfDay(updated.updated_at));
    } catch (err) {
      setSaveError(`The work order was not saved: ${(err as Error).message}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside class="inspector" id="inspectModal" aria-labelledby="modalRoadName">
      <header class="entry-head">
        <span>{alert.anomaly_class}</span>
        <span class="num" id="modalEventId">{alert.event_id}</span>
        <button type="button" class="icon-btn icon-btn--on-ink" id="modalCloseBtn" aria-label="Close the inspection" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div class="entry-scroll">
        <div class="entry-title">
          <h2 id="modalRoadName" ref={headRef} tabIndex={-1}>{alert.road_name}</h2>
          <p class="entry-meta">
            <span id="modalWard">{wardLabel(alert.ward_id)}</span>
            <br />
            <time id="modalTimestamp" class="num" dateTime={alert.timestamp}>{fullTime(alert.timestamp)}</time>, reported by <span class="num">{alert.vehicle_id}</span> at <span class="num">{alert.vehicle_speed}&nbsp;km/h</span>
          </p>
        </div>

        <figure class="dashcam">
          {image.state === 'ready' && (
            <img id="modalDefectImg" src={image.src} width={400} height={250} alt={`Dashcam frame of the ${alert.anomaly_class.toLowerCase()} on ${alert.road_name}`} />
          )}
          {image.state === 'loading' && <div class="dashcam-wait" aria-label="Loading the dashcam frame" />}
          {image.state === 'none' && <p class="dashcam-note">No dashcam frame came with this report.</p>}
          {image.state === 'error' && <p class="dashcam-note">The dashcam frame did not load. Close and reopen this report to try again.</p>}
        </figure>

        <section class="severity" aria-labelledby="sev-head">
          <div class={`sev-figure sev-${alert.severity_score}`} id="modalSevBubble">{alert.severity_score}</div>
          <div>
            <h3 id="sev-head">{alert.severity_label}, {SEVERITY_WINDOW[alert.severity_score]?.toLowerCase()}</h3>
            <p id="modalSevLabel" class="muted">{alert.municipal_action}</p>
          </div>
          <div class="equation">
            <code id="modalSevCalculation">
              0.15 × {num(d)} mm + 2.0 × {num(r, 2)} mm/ms = {raw.toFixed(2)}
            </code>
            <p class="muted">
              Rounded and held between 1 and 5, that scores {alert.severity_score}. Depth is about <strong class="num" id="modalDepthCm">{alert.estimated_depth_cm.toFixed(1)}&nbsp;cm</strong>, from the fit across 120 measured potholes (r&nbsp;=&nbsp;0.87).
            </p>
          </div>
        </section>

        {alert.sla_deadline && (
          <section class="sla-block" id="modalSlaBlock" aria-labelledby="sla-head">
            <div class="section-row">
              <h3 id="sla-head">Repair window, {alert.sla_hours}&nbsp;h</h3>
              <span class={`sla sla--${alert.sla_status}`} id="modalSlaStatusBadge">{SLA_LABELS[alert.sla_status]}</span>
            </div>
            <div class="sla-track" role="img" aria-label={`${Math.min(100, alert.sla_elapsed_pct).toFixed(0)}% of the window used`}>
              <span class={`sla-fill sla-fill--${alert.sla_status}`} style={{ transform: `scaleX(${Math.min(100, alert.sla_elapsed_pct) / 100})` }} />
            </div>
            <p class="muted" id="modalSlaCountdown">
              {alert.sla_status === 'met' ? 'Resolved inside the window. ' : `${slaRemaining(alert.sla_remaining_minutes)}. `}
              Deadline <time class="num" dateTime={alert.sla_deadline}>{fullTime(alert.sla_deadline)}</time>.
            </p>
          </section>
        )}

        <RiskCard alert={alert} />

        <dl class="sensors notebook" aria-label="Sensor readings at the trigger">
          <div><dt>Vision confidence</dt><dd class="num" id="modalMetricVisual">{snap.visual_confidence != null ? `${(snap.visual_confidence * 100).toFixed(1)}%` : '–'}</dd></div>
          <div><dt>Vertical RMS</dt><dd class="num" id="modalMetricZrms">{num(snap.imu_z_rms, 2)}&nbsp;g</dd></div>
          <div><dt>Peak frequency</dt><dd class="num" id="modalMetricPeakFreq">{num(snap.peak_frequency)}&nbsp;Hz</dd></div>
          <div><dt>Deflection, D</dt><dd class="num" id="modalMetricDeflection">{num(d)}&nbsp;mm</dd></div>
          <div><dt>Onset rate, R</dt><dd class="num" id="modalMetricOnsetRate">{num(r, 2)}&nbsp;mm/ms</dd></div>
          <div><dt>Gyro peak</dt><dd class="num" id="modalMetricGyro">{num(snap.gyro_x_peak)}&nbsp;°/s</dd></div>
        </dl>

        <div class="place">
          <p class="num" id="modalCoords">{alert.latitude.toFixed(4)}° N, {alert.longitude.toFixed(4)}° E</p>
          <div class="place-actions">
            <a
              id="btnGoogleMaps"
              class="btn btn--tool"
              href={`https://www.google.com/maps/search/?api=1&query=${alert.latitude},${alert.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MapPin size={16} aria-hidden="true" />
              Google Maps
            </a>
            <button type="button" id="btnFocusOnMap" class="btn btn--tool" onClick={() => onShowOnMap(alert)}>
              <LocateFixed size={16} aria-hidden="true" />
              Zoom to it
            </button>
          </div>
        </div>

        <form class="work-order" onSubmit={save}>
          <h3>Work order</h3>
          <p class="muted" id="modalConfirmationText">
            {alert.confirmation_count >= 3
              ? `Confirmed by ${alert.confirmation_count} vehicles, so its priority is raised.`
              : `Seen by ${alert.confirmation_count} ${alert.confirmation_count === 1 ? 'vehicle' : 'vehicles'} so far.`}
          </p>
          <label class="field">
            <span>Status</span>
            <select id="modalStatusSelect" name="status" value={status} onChange={(e) => { setStatus(e.currentTarget.value); touch('status'); }}>
              {STATUSES.map((s) => <option value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label class="field">
            <span>Crew or contractor</span>
            <input id="modalCrewInput" name="assigned_crew" autocomplete="off" placeholder="Punjab PWD Circle 3" value={crew} onInput={(e) => { setCrew(e.currentTarget.value); touch('crew'); }} />
          </label>
          <label class="field">
            <span>Field notes</span>
            <textarea id="modalNotesInput" name="notes" rows={3} value={notes} onInput={(e) => { setNotes(e.currentTarget.value); touch('notes'); }} />
          </label>
          <p class={`form-line${saveError ? ' form-line--error' : ''}`} role="status">
            {saveError || (savedAt ? `Saved at ${savedAt}.` : '')}
          </p>
          <button type="submit" id="btnSaveWorkOrder" class="btn btn--primary" disabled={saving} aria-busy={saving}>
            {saving ? 'Saving…' : 'Save work order'}
          </button>
        </form>
      </div>
    </aside>
  );
}
