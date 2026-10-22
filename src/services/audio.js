/**
 * POS Audio Feedback Service (Zero Dependencies)
 * Uses Web Audio API synthesizers to produce crisp commercial register sounds:
 * - Scan Success: High crisp beep (1800Hz)
 * - Scan Error: Low double-buzzer (180Hz)
 * - Payment Complete: Upward two-tone chime (587Hz -> 880Hz)
 */

let audioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

// User preference persistence
export function isAudioEnabled() {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem('pos_sound_enabled') !== 'false';
}

export function setAudioEnabled(enabled) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('pos_sound_enabled', enabled ? 'true' : 'false');
  }
}

export function toggleAudioEnabled() {
  const next = !isAudioEnabled();
  setAudioEnabled(next);
  return next;
}

/**
 * High-pitched crisp scan confirmation beep (1800Hz, 70ms)
 */
export function playScanSuccessSound() {
  if (!isAudioEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, ctx.currentTime);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.07);
  } catch (err) {
    console.debug('Audio play failed:', err);
  }
}

/**
 * Low-pitched double warning buzzer for errors/not found (180Hz, 2 pulses)
 */
export function playScanErrorSound() {
  if (!isAudioEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const playPulse = (startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, startTime);

      gain.gain.setValueAtTime(0.22, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    playPulse(now, 0.09);
    playPulse(now + 0.12, 0.09);
  } catch (err) {
    console.debug('Audio play failed:', err);
  }
}

/**
 * Melodic upward two-tone chime for completed checkouts (587Hz -> 880Hz)
 */
export function playPaymentSuccessSound() {
  if (!isAudioEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Tone 1: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.1);

    // Tone 2: A5 (880 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.09);
    gain2.gain.setValueAtTime(0.25, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.28);
  } catch (err) {
    console.debug('Audio play failed:', err);
  }
}
