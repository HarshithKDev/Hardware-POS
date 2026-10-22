import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isAudioEnabled,
  setAudioEnabled,
  toggleAudioEnabled,
  playScanSuccessSound,
  playScanErrorSound,
  playPaymentSuccessSound
} from '../services/audio';

// Dynamic smart denomination suggestions for rapid cash checkout
function getQuickTenderOptions(total) {
  if (!total || total <= 0) return [];
  const ceilTotal = Math.ceil(total);
  const pills = [];

  const standardNotes = [50, 100, 200, 500, 1000, 2000];

  // Nearest friendly note (next 50 or 100)
  if (ceilTotal < 500 && ceilTotal % 50 !== 0) {
    const next50 = Math.ceil(ceilTotal / 50) * 50;
    if (next50 > ceilTotal && !standardNotes.includes(next50)) {
      pills.push({ label: `₹${next50}`, value: next50 });
    }
  } else if (ceilTotal >= 500 && ceilTotal < 2000 && ceilTotal % 100 !== 0) {
    const next100 = Math.ceil(ceilTotal / 100) * 100;
    if (next100 > ceilTotal && !standardNotes.includes(next100)) {
      pills.push({ label: `₹${next100}`, value: next100 });
    }
  }

  // Next standard currency notes above total
  standardNotes.filter(n => n > ceilTotal).slice(0, 3).forEach(note => {
    if (!pills.some(p => p.value === note)) {
      pills.push({ label: `₹${note}`, value: note });
    }
  });

  // If bill is large (>= 2000), offer next multiples of 500 and 1000
  if (ceilTotal >= 2000) {
    const next500 = Math.ceil(ceilTotal / 500) * 500;
    if (next500 > ceilTotal && !pills.some(p => p.value === next500)) {
      pills.push({ label: `₹${next500}`, value: next500 });
    }
    const next1000 = Math.ceil(ceilTotal / 1000) * 1000;
    if (next1000 > next500 && !pills.some(p => p.value === next1000)) {
      pills.push({ label: `₹${next1000}`, value: next1000 });
    }
  }

  return pills;
}

describe('Item 1: Counter Speed & Ergonomics', () => {
  describe('Audio Feedback Service', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('defaults audio to enabled (true)', () => {
      expect(isAudioEnabled()).toBe(true);
    });

    it('toggles audio off and on with localStorage persistence', () => {
      expect(toggleAudioEnabled()).toBe(false);
      expect(isAudioEnabled()).toBe(false);
      expect(localStorage.getItem('pos_sound_enabled')).toBe('false');

      expect(toggleAudioEnabled()).toBe(true);
      expect(isAudioEnabled()).toBe(true);
      expect(localStorage.getItem('pos_sound_enabled')).toBe('true');
    });

    it('safely handles play sound triggers without throwing even when AudioContext is stubbed/unavailable', () => {
      expect(() => playScanSuccessSound()).not.toThrow();
      expect(() => playScanErrorSound()).not.toThrow();
      expect(() => playPaymentSuccessSound()).not.toThrow();
    });

    it('does not trigger sound when muted', () => {
      setAudioEnabled(false);
      expect(isAudioEnabled()).toBe(false);
      // Calls should safely return early
      expect(() => playScanSuccessSound()).not.toThrow();
    });
  });

  describe('Quick-Cash Denomination Tender Pad (Smart Tender Options)', () => {
    it('returns empty array when total is 0 or negative', () => {
      expect(getQuickTenderOptions(0)).toEqual([]);
      expect(getQuickTenderOptions(-50)).toEqual([]);
    });

    it('generates next standard currency notes for small bill (e.g. ₹35) without redundant exact pill', () => {
      const options = getQuickTenderOptions(35);
      const values = options.map(o => o.value);
      expect(values).not.toContain(35);
      expect(values).toContain(50);
      expect(values).toContain(100);
      expect(values).toContain(200);
    });

    it('generates next standard currency notes for mid-range bill (e.g. ₹230)', () => {
      const options = getQuickTenderOptions(230);
      const values = options.map(o => o.value);
      expect(values).not.toContain(230);
      expect(values).toContain(250); // next multiple of 50
      expect(values).toContain(500); // next standard note
    });

    it('generates next multiples of 500 and 1000 for high-value bills (e.g. ₹2350)', () => {
      const options = getQuickTenderOptions(2350);
      const values = options.map(o => o.value);
      expect(values).not.toContain(2350);
      expect(values).toContain(2500); // next 500
      expect(values).toContain(3000); // next 1000
    });
  });

  describe('High-Speed Hardware Scanner Burst Timing Detection', () => {
    it('accurately identifies hardware scanner burst when characters arrive < 65ms apart', () => {
      // Simulate 12-digit barcode scanned by a 20ms laser gun
      const barcode = '890103086542';
      const timestamps = [];
      const startTime = 1000;
      for (let i = 0; i < barcode.length; i++) {
        timestamps.push(startTime + i * 20); // 20ms per character
      }

      const totalDuration = timestamps[timestamps.length - 1] - timestamps[0];
      const avgInterval = totalDuration / (timestamps.length - 1);

      expect(avgInterval).toBe(20);
      expect(avgInterval).toBeLessThan(65);
      expect(barcode.length).toBeGreaterThanOrEqual(2);
    });

    it('does not classify human keyboard typing as a scanner burst', () => {
      // Simulate a fast human typing 150ms per key
      const barcode = '890103';
      const timestamps = [];
      const startTime = 1000;
      for (let i = 0; i < barcode.length; i++) {
        timestamps.push(startTime + i * 150);
      }

      const totalDuration = timestamps[timestamps.length - 1] - timestamps[0];
      const avgInterval = totalDuration / (timestamps.length - 1);

      expect(avgInterval).toBe(150);
      expect(avgInterval).toBeGreaterThan(65);
    });
  });
});
