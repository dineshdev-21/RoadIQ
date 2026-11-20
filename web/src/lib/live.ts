import type { LiveMessage } from './types';

export type LiveState = 'connecting' | 'live' | 'offline';

/**
 * Opens /ws/live and reconnects with backoff (1 s doubling to 30 s). Returns a close function.
 * onReopen runs after every reconnect (not the first open), so the caller can refetch what it missed.
 */
export function connectLive(onMessage: (m: LiveMessage) => void, onState: (s: LiveState) => void, onReopen?: () => void): () => void {
  let socket: WebSocket | null = null;
  let retry = 1000;
  let timer: number | undefined;
  let closed = false;
  let opened = false;

  const open = () => {
    onState('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${proto}//${location.host}/ws/live`);
    socket.onopen = () => {
      retry = 1000;
      onState('live');
      if (opened) onReopen?.();
      opened = true;
    };
    socket.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data) as LiveMessage);
      } catch (err) {
        console.warn('Ignored a live message that was not JSON', err);
      }
    };
    socket.onclose = () => {
      if (closed) return;
      onState('offline');
      timer = window.setTimeout(open, retry);
      retry = Math.min(retry * 2, 30_000);
    };
  };

  open();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    socket?.close();
  };
}
