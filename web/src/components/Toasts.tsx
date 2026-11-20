import { X } from 'lucide-preact';

export interface Toast {
  id: number;
  text: string;
  tone: 'alert' | 'error' | 'info';
  alertId?: string;
}

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  onInspect: (alertId: string) => void;
}

export function Toasts({ toasts, onDismiss, onInspect }: Props) {
  return (
    <div class="toasts" id="toastContainer" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast toast--${t.tone}`}>
          <p>{t.text}</p>
          {t.alertId && (
            <button type="button" class="toast-action" onClick={() => { onInspect(t.alertId!); onDismiss(t.id); }}>
              Inspect
            </button>
          )}
          <button type="button" class="icon-btn icon-btn--on-ink" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
