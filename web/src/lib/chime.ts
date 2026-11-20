let ctx: AudioContext | null = null;

/** Two tones for severity 4 and 5, one soft ping otherwise; synthesised, no audio files. */
export function playChime(critical: boolean) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const length = critical ? 0.35 : 0.25;
    if (critical) {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1174.66, now + 0.12);
      gain.gain.setValueAtTime(0.16, now);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
    }
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    osc.start(now);
    osc.stop(now + length);
  } catch (err) {
    console.warn('Alert sound unavailable', err);
  }
}
